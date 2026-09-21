// routeSegmentation.js — R3-F13: segmentación de ruta basada en EVIDENCIA.
// Dominio puro (sin React/mapa). El frontend dibuja; esto decide.
//
// Principio (docs/audit/ROUTE_SEGMENTATION_AUDIT.md §3): el corte ya está
// calibrado por los datos (shouldCut: 100 m / 45 s / 200 m / 5 min / teleport);
// lo nuevo es DECIR QUÉ FUE cada discontinuidad y que corte y tipo salgan de la
// MISMA decisión. Nunca altera posiciones ni timestamps; solo lee.
//
// Tipos (regla 53 del operador: no ocultar incertidumbre):
//   OBSERVED_CONTINUOUS  continuidad observada (o parada real: dist ≤ 100 m)
//   CAPTURE_GAP          no hubo captura (GPS suspendido/sin fixes); se CORTA
//   DELIVERY_DELAY       captura válida que llegó tarde (lote/backfill); NO se corta
//   RECOVERY_GAP         interrupción de servicio con recuperación declarada; se CORTA
//   UNKNOWN              señales insuficientes; se CORTA de forma conservadora
//
// Prohibido: usar MAX_GAP_MS como única regla (§30), reglas por dispositivo (§52),
// map-matching para ocultar huecos (§34), alterar timestamps (§31).

import {
  MAX_GAP_MS,
  FAST_GAP_DT_MS,
  FAST_GAP_DIST_M,
  SAME_PLACE_M,
  isTeleport,
} from './pathDecimation.js';

/** Retraso de llegada (ms) a partir del cual el fix es DELIVERY_DELAY. */
export const DELIVERY_DELAY_MIN_MS = 10 * 60 * 1000;

/** Lote backfill: llegadas casi simultáneas de fixes con fixtimes separados. */
export const BACKFILL_BURST_SERVER_MS = 2000;
export const BACKFILL_BURST_FIX_MS = 45_000;

export const RouteSegmentType = {
  CONTINUOUS: 'OBSERVED_CONTINUOUS',
  CAPTURE_GAP: 'CAPTURE_GAP',
  DELIVERY_DELAY: 'DELIVERY_DELAY',
  RECOVERY_GAP: 'RECOVERY_GAP',
  UNKNOWN: 'UNKNOWN',
};

/** Instante (ms) del fix o NaN. (fixTime es la referencia; local en tc_*) */
function fixTimeMs(position) {
  const ms = Date.parse(position.fixTime || position.deviceTime || '');
  return Number.isFinite(ms) ? ms : NaN;
}

/** Recepción en server (ms) o NaN: misma base serializada que fixTime, el
 * offset estructural entre bases cancela al RESTAR (B-2 de la auditoría). */
function serverTimeMs(position) {
  const ms = Date.parse(position.serverTime || '');
  return Number.isFinite(ms) ? ms : NaN;
}

function haversineMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = ((b.latitude - a.latitude) * rad) / 2;
  const dLon = ((b.longitude - a.longitude) * rad) / 2;
  const h =
    Math.sin(dLat) * Math.sin(dLat) +
    Math.cos((a.latitude * rad)) * Math.cos((b.latitude * rad)) * Math.sin(dLon) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Clasifica la discontinuidad a→b (par consecutivo).
 * events: [{ timeMs, kind }] kind ∈ networkLost|networkRestored|presenceReconnect|recoveryAttempt|recoverySuccess
 * heartbeats: [{ timeMs }] (tc_mobile_messages positionid=0 del hueco).
 */
export function classifyBoundary(a, b, context = {}) {
  const fixA = fixTimeMs(a);
  const fixB = fixTimeMs(b);
  const dtMs = Number.isFinite(fixA) && Number.isFinite(fixB) ? fixB - fixA : NaN;
  const distM = haversineMeters(a, b);
  const srvA = serverTimeMs(a);
  const srvB = serverTimeMs(b);
  const deliveryDelayMsB =
    Number.isFinite(fixB) && Number.isFinite(srvB) ? srvB - fixB : NaN;
  const backfillBatch =
    Number.isFinite(srvB) && Number.isFinite(srvA) && Number.isFinite(fixB) && Number.isFinite(fixA)
      ? srvB - srvA <= BACKFILL_BURST_SERVER_MS && fixB - fixA > BACKFILL_BURST_FIX_MS
      : false;

  const signals = {
    captureDtMs: dtMs,
    captureDistM: distM,
    impliedSpeedMps: Number.isFinite(dtMs) && dtMs > 0 ? distM / (dtMs / 1000) : NaN,
    deliveryDelayMsA: Number.isFinite(fixA) && Number.isFinite(srvA) ? srvA - fixA : NaN,
    deliveryDelayMsB: deliveryDelayMsB,
    backfillBatch,
    hasDeliveryEvidence: Number.isFinite(srvB) || Number.isFinite(srvA),
  };

  const samePlace = distM <= SAME_PLACE_M;
  const gapRule =
    Number.isFinite(dtMs) && (dtMs > MAX_GAP_MS || (dtMs > FAST_GAP_DT_MS && distM > FAST_GAP_DIST_M));
  const cutRule = !samePlace && (gapRule || isTeleport(a, b));

  if (!Number.isFinite(dtMs) || dtMs <= 0) {
    return { type: RouteSegmentType.UNKNOWN, cut: false, signals: { ...signals, captureDtMs: dtMs } };
  }

  const events = Array.isArray(context.events) ? context.events : [];
  const heartbeats = Array.isArray(context.heartbeats) ? context.heartbeats : [];
  const hasEvidence =
    signals.hasDeliveryEvidence || events.length > 0 || heartbeats.length > 0;

  if (cutRule) {
    // Desambiguación por evidencia dentro del hueco [fixA, fixB]
    const inGap = (t) => Number.isFinite(t) && t > fixA && t < fixB;
    const recoveryEventsInGap = events.filter(
      (e) =>
        e.kind === 'networkLost' ||
        e.kind === 'networkRestored' ||
        e.kind === 'presenceReconnect' ||
        e.kind === 'recoveryAttempt' ||
        e.kind === 'recoverySuccess',
    ).filter((e) => inGap(e.timeMs));
    const heartbeatsInGap = heartbeats.filter((h) => inGap(h.timeMs)).length;

    let type = RouteSegmentType.UNKNOWN;
    if (!hasEvidence) {
      type = RouteSegmentType.UNKNOWN; // conservador: sin señales no se afirma nada
    } else if (heartbeatsInGap.length > 0) {
      // dispositivo vivo capturando presencia sin fixes → GPS suspendido
      type = RouteSegmentType.CAPTURE_GAP;
    } else if (recoveryEventsInGap.some((e) => e.kind === 'networkLost')) {
      type = RouteSegmentType.RECOVERY_GAP;
    } else {
      type = RouteSegmentType.CAPTURE_GAP;
    }
    return { type, cut: true, signals };
  }

  // Sin corte: la discontinuidad solo puede ser de ENTREGA (captura contigua
  // que llegó tarde) o continuidad. samePlace (≤100 m) nunca se corta: si
  // además llegó tarde, se anota DELIVERY_DELAY sobre la parada real.
  if (deliveryDelayMsB > DELIVERY_DELAY_MIN_MS || backfillBatch) {
    return { type: RouteSegmentType.DELIVERY_DELAY, cut: false, signals };
  }
  return { type: RouteSegmentType.CONTINUOUS, cut: false, signals };
}

/**
 * Analyzer principal: segmentos por par consecutivo. Los CUT marcan dónde la
 * línea NO debe dibujarse; los contiguos clasifican la pata.
 */
export function analyzeRouteSegments(positions, context = {}) {
  const segments = [];
  if (!Array.isArray(positions)) {
    return segments;
  }
  for (let i = 1; i < positions.length; i += 1) {
    const boundary = classifyBoundary(positions[i - 1], positions[i], context);
    segments.push({
      fromIndex: i - 1,
      toIndex: i,
      ...boundary,
    });
  }
  return segments;
}

/** Conteos por tipo (resumen de integridad por segmentación). */
export function segmentSummary(segments) {
  const summary = { captureGapCount: 0, deliveryDelayCount: 0, recoveryGapCount: 0, unknownCount: 0 };
  for (const s of segments || []) {
    if (s.type === RouteSegmentType.CAPTURE_GAP) summary.captureGapCount += 1;
    else if (s.type === RouteSegmentType.DELIVERY_DELAY) summary.deliveryDelayCount += 1;
    else if (s.type === RouteSegmentType.RECOVERY_GAP) summary.recoveryGapCount += 1;
    else if (s.type === RouteSegmentType.UNKNOWN) summary.unknownCount += 1;
  }
  return summary;
}
