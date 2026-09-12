/**
 * Auditoría de replay DENTRO de /replay (ReplayPage): paradas enriquecidas,
 * anomalías por fix, periodos sin cobertura, reloj e integridad.
 *
 * REGLA DE ORO: todo es SOLO LECTURA. Ninguna función muta, filtra ni
 * reordena `positions`: RAW POSITIONS es la fuente de verdad (slider 1 fix =
 * 1 posición real). Detectar una anomalía NUNCA borra el fix: lo marca para
 * visualización/diagnóstico. La geometría de dibujo sigue siendo
 * CanonicalRouteGeometry (DISPLAY ONLY).
 *
 * Puro (sin React ni mapa): testeable con `node --test`.
 */
import {
  detectStops,
  isInaccurate,
  isTeleport,
  MAX_GAP_MS,
  SAME_PLACE_M,
  STOP_MIN_DURATION_MS,
  STOP_RADIUS_M,
} from './pathDecimation.js';
import { haversineMeters } from './canonicalRouteGeometry.js';

/** fixAgeSec (s) desde el que un fix cuenta como capturado sin cobertura. */
export const OFFLINE_SYNC_FIX_AGE_S = 300;

/** Retraso llegada−fix (ms) que cuenta como sincronizado sin fixAgeSec. */
export const OFFLINE_SYNC_DELAY_MS = 10 * 60 * 1000;

/** Desvío |serverReceivedAt − fixTime| (ms) que delata reloj inconsistente. */
export const CLOCK_SKEW_MS = 60 * 60 * 1000;

/** Velocidad implícita (m/s) imposible en vía terrestre (≈216 km/h). */
export const IMPOSSIBLE_SPEED_MPS = 60;

/** Códigos de anomalía por fix (estables para la UI y los tests). */
export const FLAG = {
  TELEPORT: 'teleport',
  GAP: 'gap',
  SPEED: 'speed',
  TIME: 'time',
  DUPLICATE: 'duplicate',
  LOW_ACCURACY: 'lowAccuracy',
  SYNCED: 'synced',
  CLOCK: 'clock',
};

/** Instante (ms) real del fix o NaN. Referencia principal de tiempos. */
export function fixTimeOf(position) {
  return Date.parse(position.fixTime || position.deviceTime || position.serverTime);
}

/** Llegada al servidor (ms) o NaN si no viene en attributes. */
export function serverReceivedMs(position) {
  const raw = position.attributes?.serverReceivedAt;
  if (raw === undefined || raw === null || raw === '') {
    return NaN;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : NaN;
}

/** Segundos fix→encolado que reporta la app (0 = fresco) o 0 si no viene. */
export function fixAgeSecOf(position) {
  const raw = position.attributes?.fixAgeSec;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** Retraso de sincronización (ms): llegada − fix. NaN si falta algún extremo. */
export function syncDelayMs(position) {
  const fix = fixTimeOf(position);
  const received = serverReceivedMs(position);
  if (!Number.isFinite(fix) || !Number.isFinite(received)) {
    return NaN;
  }
  return received - fix;
}

/** Mediana de valores finitos o null si no hay ninguno. */
export function medianFinite(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Paradas enriquecidas sobre detectStops (misma detección, sin cambiar
 * umbrales): cada parada conserva TODOS sus fixes originales (pointCount) y
 * suma centro aproximado (mediana existente), precisión mediana del tramo,
 * llegada/salida/duración. No elimina nada.
 *
 * Ajuste de bordes (solo descriptor, el RAW no se toca): la tolerancia de
 * outliers de la detección absorbe el último fix en marcha previo (rápido y
 * lejos) y su hora contamina la llegada (p.ej. 9 min antes). Se recortan los
 * extremos a más de radiusM del centro: la llegada pasa a ser el primer fix
 * quieto real y el click del panel cae exactamente ahí. Los fixes recortados
 * siguen en `positions` (el slider los recorre igual).
 */
export function analyzeStops(
  positions,
  options,
  { radiusM = STOP_RADIUS_M, minDurationMs = STOP_MIN_DURATION_MS } = {},
) {
  const stops = detectStops(positions, options);
  const enriched = [];
  for (const stop of stops) {
    const center = { latitude: stop.latitude, longitude: stop.longitude };
    let from = stop.index;
    let end = stop.index + stop.pointCount;
    while (from + 1 < end && haversineMeters(positions[from], center) > radiusM) {
      from += 1;
    }
    while (end - 1 > from && haversineMeters(positions[end - 1], center) > radiusM) {
      end -= 1;
    }
    if (end - from < 2) {
      from = stop.index;
      end = stop.index + stop.pointCount;
    }
    const span = positions.slice(from, end);
    const arrival = span[0].fixTime || span[0].deviceTime || span[0].serverTime;
    const last = span[span.length - 1];
    const departure = last.fixTime || last.deviceTime || last.serverTime;
    const durationMs = Date.parse(departure) - Date.parse(arrival);
    // Si al quitar outliers el tramo queda bajo el umbral, nunca fue parada:
    // era absorción de la tolerancia (p.ej. 1 min listado como 7 min con la
    // llegada en un punto en marcha a 600 m). Se descarta, los fixes quedan.
    if (!(durationMs >= minDurationMs)) {
      continue;
    }
    enriched.push({
      ...stop,
      index: from,
      arrivalTime: arrival,
      departureTime: departure,
      durationMs,
      pointCount: span.length,
      accuracyMed: medianFinite(span.map((p) => Number(p.accuracy))),
      fixCount: span.length,
    });
  }
  return enriched;
}

/**
 * Banderas por índice (array paralelo a positions): teleport, hueco temporal,
 * velocidad imposible, tiempo regresivo, duplicado exacto, baja precisión,
 * sincronizado-offline y reloj inconsistente. Ningún fix se quita ni se mueve.
 */
export function flagAnomalies(positions, { accuracyThreshold = 250 } = {}) {
  const flags = positions.map(() => []);
  const push = (i, code) => {
    if (!flags[i].includes(code)) {
      flags[i].push(code);
    }
  };
  for (let i = 0; i < positions.length; i += 1) {
    const curr = positions[i];
    const prev = i > 0 ? positions[i - 1] : null;
    if (isInaccurate(curr, accuracyThreshold)) {
      push(i, FLAG.LOW_ACCURACY);
    }
    if (isOfflineSynced(curr)) {
      push(i, FLAG.SYNCED);
    }
    const skew = syncDelayMs(curr);
    if (Number.isFinite(skew) && Math.abs(skew) > CLOCK_SKEW_MS) {
      push(i, FLAG.CLOCK);
    }
    if (!prev) {
      continue;
    }
    const dt = fixTimeOf(curr) - fixTimeOf(prev);
    const sameFix =
      (curr.fixTime || curr.deviceTime || '') === (prev.fixTime || prev.deviceTime || '') &&
      curr.latitude === prev.latitude &&
      curr.longitude === prev.longitude;
    if (sameFix) {
      push(i, FLAG.DUPLICATE);
    }
    if (Number.isFinite(dt) && dt <= 0) {
      push(i, FLAG.TIME);
      continue;
    }
    const dist = haversineMeters(prev, curr);
    if (Number.isFinite(dt) && dt > MAX_GAP_MS && dist > SAME_PLACE_M) {
      push(i, FLAG.GAP);
    }
    if (isTeleport(prev, curr)) {
      push(i, FLAG.TELEPORT);
      continue;
    }
    if (Number.isFinite(dt) && dt > 0 && dist / (dt / 1000) > IMPOSSIBLE_SPEED_MPS) {
      push(i, FLAG.SPEED);
    }
  }
  return flags;
}

/** true si el fix se capturó sin cobertura y se sincronizó después. */
export function isOfflineSynced(position) {
  if (fixAgeSecOf(position) >= OFFLINE_SYNC_FIX_AGE_S) {
    return true;
  }
  const delay = syncDelayMs(position);
  return Number.isFinite(delay) && delay > OFFLINE_SYNC_DELAY_MS;
}

/**
 * Periodos sin cobertura: huecos temporales > MAX_GAP_MS con desplazamiento
 * real (> SAME_PLACE_M). Una parada larga en el mismo sitio NO es un hueco de
 * cobertura. La ruta completa se sigue mostrando; esto solo la anota.
 */
export function offlinePeriods(positions) {
  const periods = [];
  for (let i = 1; i < positions.length; i += 1) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const dt = fixTimeOf(curr) - fixTimeOf(prev);
    if (!Number.isFinite(dt) || dt <= MAX_GAP_MS) {
      continue;
    }
    if (haversineMeters(prev, curr) <= SAME_PLACE_M) {
      continue;
    }
    periods.push({
      fromIndex: i - 1,
      toIndex: i,
      fromTime: prev.fixTime || prev.deviceTime || prev.serverTime,
      toTime: curr.fixTime || curr.deviceTime || curr.serverTime,
      gapMs: dt,
    });
  }
  return periods;
}

/** Reloj: máximo |serverReceivedAt − fixTime| y cuántos superan el umbral. */
export function clockAudit(positions) {
  let maxSkewMs = 0;
  let skewedCount = 0;
  let checkedCount = 0;
  positions.forEach((position) => {
    const skew = syncDelayMs(position);
    if (!Number.isFinite(skew)) {
      return;
    }
    checkedCount += 1;
    maxSkewMs = Math.max(maxSkewMs, Math.abs(skew));
    if (Math.abs(skew) > CLOCK_SKEW_MS) {
      skewedCount += 1;
    }
  });
  return { maxSkewMs, skewedCount, checkedCount };
}

/**
 * Resumen de integridad para la línea discreta de /replay: conteos crudos,
 * nunca interpretaciones que oculten datos.
 */
export function integritySummary({ positions, stops, offlinePeriods: offline, flags, clock }) {
  const syncedCount = flags ? flags.filter((list) => list.includes(FLAG.SYNCED)).length : 0;
  const anomalyCount = flags ? flags.filter((list) => list.length > 0).length : 0;
  return {
    rawCount: positions.length,
    stopCount: stops.length,
    offlineCount: offline.length,
    syncedCount,
    anomalyCount,
    maxSkewMs: clock ? clock.maxSkewMs : 0,
  };
}
