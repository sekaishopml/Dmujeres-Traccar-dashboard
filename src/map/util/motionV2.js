/**
 * Segmentos de estado V2 para el replay: lee attributes.motionStateV2 de
 * cada posición (calculado por el SERVIDOR con MotionStateV2Engine) y
 * produce tramos continuos por estado.
 *
 * Estados: MOVING (verde), PAUSED (ámbar), STOPPED (azul), UNKNOWN (gris).
 * Puro, sin React: testeable con `node --test`. SOLO LECTURA: no muta ni
 * filtra positions.
 *
 * Nota: el atributo no existe en datos históricos; buildMotionV2Segments
 * devuelve [] y la UI oculta el panel (sin inventar estados).
 */

export const MOTION_V2_STATES = ['MOVING', 'PAUSED', 'STOPPED', 'UNKNOWN'];

export const MOTION_V2_COLORS = {
  MOVING: '#4caf50',
  PAUSED: '#ffb300',
  STOPPED: '#2196f3',
  UNKNOWN: '#9e9e9e',
};

export function motionV2StateOf(position) {
  const value = position?.attributes?.motionStateV2;
  return MOTION_V2_STATES.includes(value) ? value : null;
}

function fixTimeMs(position) {
  return Date.parse(position.fixTime || position.deviceTime || position.serverTime);
}

/**
 * Segmentos continuos por estado V2.
 * @returns [{ state, start, end, durationMs, reason }] con reason de la
 * última transición conocida (vaciado tras cambios de estado distintos).
 */
export function buildMotionV2Segments(positions) {
  if (!Array.isArray(positions) || !positions.length) {
    return [];
  }
  const sorted = [...positions]
    .filter((p) => motionV2StateOf(p) !== null && Number.isFinite(fixTimeMs(p)))
    .sort((a, b) => fixTimeMs(a) - fixTimeMs(b));
  if (!sorted.length) {
    return [];
  }
  const segments = [];
  let current = motionV2StateOf(sorted[0]);
  let start = fixTimeMs(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    const state = motionV2StateOf(sorted[i]);
    const time = fixTimeMs(sorted[i]);
    if (state !== current) {
      segments.push({
        state: current,
        start,
        end: time,
        durationMs: time - start,
      });
      current = state;
      start = time;
    }
  }
  segments.push({
    state: current,
    start,
    end: fixTimeMs(sorted[sorted.length - 1]),
    durationMs: fixTimeMs(sorted[sorted.length - 1]) - start,
  });
  return segments;
}

/** Duración legible "1m 19s" / "29m 34s" / "2h 05m". */
export function formatMotionV2Duration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}
