/**
 * Geometría canónica de ruta: EL pipeline único del que derivan la LÍNEA, las
 * FLECHAS, el replay y el trail en vivo. Nada dibuja geometría por su cuenta.
 *
 * Flujo:
 *   RAW POSITIONS → orden temporal → quality filtering → deduplication →
 *   gap detection → teleport filtering → spike filtering → (stops) →
 *   CANONICAL ROUTE GEOMETRY (chunks + distancias acumuladas)
 *
 * Después:
 *   CANONICAL ROUTE GEOMETRY ├── LINE (segmentos de los chunks)
 *                             ├── ARROWS (generateRouteArrows, por distancia)
 *                             ├── REPLAY (misma geometría)
 *                             ├── LIVE TRAIL (misma geometría)
 *                             └── estadísticas
 *
 * Por qué existe: la línea simplificaba por zoom (Douglas-Peucker + Chaikin)
 * mientras las flechas muestreaban `índice % stride` sobre otra lista. El
 * número de fixes NO es distancia (10 fixes = 50 m o 3 km), así que las
 * flechas salían entrecortadas e irregulares aunque la línea se viera
 * continua. Aquí ambas salen de los mismos chunks con las mismas distancias.
 *
 * Puro (sin React ni mapa): testeable con `node --test`.
 */
import {
  bearingDegrees,
  cleanRoutePositions,
  MAX_GAP_MS,
  splitByGapAndTeleport,
} from './pathDecimation.js';

/** Tope de flechas por render (guarda de render, NO mecanismo de espaciado). */
export const MAX_ARROWS = 2000;

/** Espaciado mínimo físico (m): por debajo domina el ruido GPS, no la ruta. */
export const MIN_ARROW_SPACING_M = 10;

/**
 * Pata máxima (ms) y (m) para INTERPOLAR flechas: una pata con dt mayor o
 * distancia mayor no tiene evidencia de continuidad: NUNCA se interpola flecha
 * sobre ella; solo se dibujan flechas sobre fixes reales. Los chunks ya se
 * cortan por fast-gap vía shouldCut, así que las patas largas rápidas dejan de
 * existir dentro de los chunks; este gate queda como defensa adicional para
 * las patas largas lentas dentro de un chunk (p.ej. paradas con 20 s entre
 * fixes o simplificaciones que estiran un tramo).
 */
export const ARROW_MAX_LEG_DT_MS = 20_000;
export const ARROW_MAX_LEG_M = 150;

/** Épsilon (m) para comparar distancias acumuladas sin duplicar vértices. */
const EPS_M = 1e-6;

/** Tope de velocidad (nudos) de la escala de color, igual que el trazo clásico. */
const SPEED_CAP_KNOTS = 65;

/** Distancia (m) haversine entre dos puntos {latitude, longitude}. */
export function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const la = toRad(a.latitude);
  const lb = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Instante (ms) de un punto o NaN (pares en vivo [lon, lat] no tienen tiempo). */
function timeOf(point) {
  if (Array.isArray(point)) {
    return NaN;
  }
  return Date.parse(point.fixTime || point.deviceTime || point.serverTime);
}

/**
 * Normaliza la entrada a objetos {latitude, longitude} conservando la
 * referencia original en `ref` (para click/color). Acepta objetos Traccar y
 * pares [longitude, latitude] del historial en vivo.
 */
function normalize(point) {
  if (Array.isArray(point)) {
    return { latitude: point[1], longitude: point[0], _live: true, ref: point };
  }
  return { ...point, ref: point };
}

/**
 * Construye la geometría canónica. Ordena por tiempo (estable: la entrada
 * desordenada rompía gaps/teleports/bearings), limpia con el pipeline único,
 * corta por huecos/teleports/cortes y acumula distancias por chunk.
 */
export function buildCanonicalRouteGeometry(positions, options = {}) {
  const { hideInaccurate = true, accuracyThreshold = 250 } = options;
  const empty = {
    chunks: [],
    totalMeters: 0,
    pointCount: 0,
    stats: null,
    cuts: new Set(),
    speedMin: 0,
    speedMax: SPEED_CAP_KNOTS,
  };
  if (!Array.isArray(positions) || positions.length === 0) {
    return empty;
  }
  // Orden temporal estable (los reportes no siempre ordenan; el replay sí).
  const sorted = [...positions].sort((a, b) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) {
      return ta - tb;
    }
    return 0;
  });
  const {
    points: working,
    stats,
    cuts,
  } = cleanRoutePositions(sorted, {
    hideInaccurate,
    accuracyThreshold,
  });
  if (!working.length) {
    return { ...empty, stats, cuts };
  }
  const chunks = [];
  let totalMeters = 0;
  // splitByGapAndTeleport corta por hueco temporal/teleport; además se parte
  // por `cuts` (cuerdas sobre ocultos y saltos aislados): un segmento cortado
  // NO se dibuja y NINGUNA flecha puede interpolar sobre él.
  splitByGapAndTeleport(working, MAX_GAP_MS).forEach((gapChunk) => {
    let current = [];
    const flush = () => {
      if (current.length) {
        const chunk = finishChunk(current);
        totalMeters += chunk.lengthMeters;
        chunks.push(chunk);
      }
      current = [];
    };
    gapChunk.forEach((point) => {
      if (cuts.has(point) && current.length) {
        flush();
      }
      current.push(point);
    });
    flush();
  });
  const speeds = working.map((p) => Number(p.speed)).filter(Number.isFinite);
  return {
    chunks,
    totalMeters,
    pointCount: working.length,
    stats: stats ? { ...stats, totalMeters, chunkCount: chunks.length } : stats,
    cuts,
    speedMin: speeds.length ? Math.max(0, Math.min(...speeds)) : 0,
    speedMax: speeds.length ? Math.min(Math.max(...speeds), SPEED_CAP_KNOTS) : SPEED_CAP_KNOTS,
  };
}

/** Cierra un chunk: puntos normalizados + distancia acumulada por vértice. */
function finishChunk(rawPoints) {
  const points = rawPoints.map(normalize);
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  return { points, cumulative, lengthMeters: cumulative[cumulative.length - 1] };
}

/**
 * Espaciado físico (m) de flechas por zoom: crece al alejarse para mantener
 * densidad en pantalla. Rango validado numéricamente (bajo 80-120, medio
 * 50-80, alto 30-50, muy alto 15-30).
 */
export function spacingForZoom(zoom) {
  if (zoom <= 8) {
    return 120;
  }
  if (zoom === 9) {
    return 100;
  }
  if (zoom === 10) {
    return 80;
  }
  if (zoom === 11) {
    return 65;
  }
  if (zoom === 12) {
    return 50;
  }
  if (zoom === 13) {
    return 40;
  }
  if (zoom === 14) {
    return 30;
  }
  if (zoom === 15) {
    return 20;
  }
  return 15;
}

/**
 * Flechas por DISTANCIA REAL sobre la geometría canónica. Recorre cada chunk
 * independiente con distancia acumulada y emite una flecha cada `spacingMeters`
 * (interpolando la posición exacta sobre el segmento), más la de cierre del
 * chunk con guardia de separación. El rumbo sale de la geometría visible
 * (bearingDegrees sobre el segmento), nunca de position.course.
 *
 * Solo se interpolan flechas sobre patas con evidencia de continuidad
 * (dt <= ARROW_MAX_LEG_DT_MS y distancia <= ARROW_MAX_LEG_M): una pata mayor
 * no emite nada y la emisión retoma en el fix real siguiente; los gaps y
 * teleports ya parten los chunks (shouldCut), así que nunca hay flecha
 * atravesándolos.
 *
 * Devuelve { arrows, spacingMeters }: si los arrows superarían MAX_ARROWS, el
 * espaciado se relaja ×1.5 (uniforme, determinista) hasta encajar. Eso es una
 * guarda de render, no el mecanismo: el mecanismo siempre es la distancia.
 *
 * Cada flecha: { latitude, longitude, rotation, chunkId, distanceM,
 * refPosition, live } donde refPosition es el fix real más cercano (click/color)
 * y live indica si viene de un par [lon, lat] sin metadatos (trail en vivo).
 */
export function generateRouteArrows(geometry, options = {}) {
  const maxArrows = Number(options.maxArrows) > 0 ? Number(options.maxArrows) : MAX_ARROWS;
  let spacing = Math.max(MIN_ARROW_SPACING_M, Number(options.spacingMeters) || 50);
  let result = collectArrows(geometry, spacing);
  let guard = 0;
  while (result.length > maxArrows && guard < 8) {
    spacing *= 1.5;
    guard += 1;
    result = collectArrows(geometry, spacing);
  }
  return { arrows: result, spacingMeters: spacing };
}

function collectArrows(geometry, spacing) {
  const arrows = [];
  (geometry.chunks || []).forEach((chunk, chunkId) => {
    walkChunk(chunk, chunkId, spacing, arrows);
  });
  return arrows;
}

function walkChunk(chunk, chunkId, spacing, out) {
  const { points, cumulative, lengthMeters } = chunk;
  if (points.length < 2 || !(lengthMeters > 0)) {
    return;
  }
  let next = spacing;
  let lastEmittedDist = -Infinity;
  const emit = (latitude, longitude, rotation, refNode, distanceM) => {
    out.push({
      latitude,
      longitude,
      rotation,
      chunkId,
      distanceM,
      refPosition: refNode.ref,
      live: refNode._live === true,
    });
    lastEmittedDist = distanceM;
  };
  for (let i = 0; i < points.length - 1 && next < lengthMeters - EPS_M; i += 1) {
    const legStart = cumulative[i];
    const legEnd = cumulative[i + 1];
    if (legEnd - legStart < 1e-9) {
      continue;
    }
    // Gate de continuidad: una pata con dt > ARROW_MAX_LEG_DT_MS o distancia
    // > ARROW_MAX_LEG_M no interpola flechas (serían fantasmas sobre datos sin
    // evidencia). Los puntos del chunk son objetos normalizados que conservan
    // fixTime; timeOf acepta objetos (NaN para pares en vivo: sin tiempo no se
    // puede juzgar el dt y manda solo la distancia). El cursor salta entera la
    // pata SIN emitir: si se dejara, la siguiente pata interpolaría con f<0
    // detrás de su inicio. La siguiente emisión retoma exactamente en el fix
    // real donde arranca la pata siguiente (f=0).
    const dtMs = timeOf(points[i + 1]) - timeOf(points[i]);
    const legDist = legEnd - legStart;
    if ((Number.isFinite(dtMs) && dtMs > ARROW_MAX_LEG_DT_MS) || legDist > ARROW_MAX_LEG_M) {
      next = Math.max(next, legEnd);
      continue;
    }
    while (next < legEnd - EPS_M && next < lengthMeters - EPS_M) {
      const f = (next - legStart) / (legEnd - legStart);
      const a = points[i];
      const b = points[i + 1];
      const refNode = f <= 0.5 ? a : b;
      emit(
        a.latitude + (b.latitude - a.latitude) * f,
        a.longitude + (b.longitude - a.longitude) * f,
        bearingDegrees(a, b),
        refNode,
        next,
      );
      next += spacing;
    }
  }
  // Cierre del chunk: todo tramo transitable muestra su dirección, con guardia
  // para no apilar sobre la última (nunca atraviesa gaps: cada chunk es propio).
  const minTail = Math.max(8, spacing * 0.25);
  if (lengthMeters >= 8 && lengthMeters - lastEmittedDist >= minTail) {
    let i = points.length - 2;
    while (i > 0 && cumulative[i + 1] - cumulative[i] < 1e-9) {
      i -= 1;
    }
    const a = points[i];
    const b = points[i + 1];
    emit(b.latitude, b.longitude, bearingDegrees(a, b), b, lengthMeters);
  }
}

/**
 * Segmentos de LÍNEA de la misma geometría que las flechas: pares consecutivos
 * por chunk con su velocidad (para el color). La línea y las flechas
 * representan EXACTAMENTE la misma ruta por construcción.
 */
export function lineSegmentsFor(geometry) {
  const segments = [];
  (geometry.chunks || []).forEach((chunk, chunkId) => {
    const { points } = chunk;
    for (let i = 0; i < points.length - 1; i += 1) {
      segments.push({
        a: points[i],
        b: points[i + 1],
        chunkId,
        speed: Number(points[i + 1].speed),
      });
    }
  });
  return segments;
}
