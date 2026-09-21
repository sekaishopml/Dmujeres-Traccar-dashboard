/**
 * FASE 39: capa DMujeres del dashboard — utilidades PURAS, espejo honesto de
 * los estados que la app reporta en `mobile.*`. No inventa estados: si el
 * atributo no está, devuelve UNKNOWN/NOT_REPORTED.
 */

export const UNKNOWN = 'UNKNOWN';
export const NOT_REPORTED = 'NOT_REPORTED';

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Fila de flota para la tabla de salud (una por dispositivo). */
export const fleetRow = (device) => {
  const attributes = device?.attributes || {};
  const lastUpdate = device?.lastUpdate ? Date.parse(device.lastUpdate) : null;
  const silentMs = lastUpdate ? Date.now() - lastUpdate : null;
  return {
    id: device?.id,
    name: device?.name || device?.uniqueId || '',
    health: attributes['mobile.healthState'] || UNKNOWN,
    journeyActive: toNumber(attributes['mobile.journeyId']) > 0,
    gps: attributes['mobile.gps'] || UNKNOWN,
    network: attributes['mobile.network'] || UNKNOWN,
    outbox: toNumber(attributes['mobile.pending']),
    fixEnqueued: toNumber(attributes['mobile.fixEnqueued']),
    fixRejected: toNumber(attributes['mobile.fixRejected']),
    recovery: attributes['mobile.recoveryState'] || NOT_REPORTED,
    recoveryResult: attributes['mobile.recoveryResult'] || NOT_REPORTED,
    oemKey: attributes['mobile.oemKey'] || null,
    readiness: attributes['mobile.readinessVerdict'] || NOT_REPORTED,
    continuity: attributes['mobile.continuityState'] || NOT_REPORTED,
    continuityCause: attributes['mobile.continuityCause'] || '',
    manufacturer: attributes['mobile.vendor'] || device?.attributes?.manufacturer || '',
    model: attributes['mobile.model'] || '',
    androidVersion: attributes['mobile.androidVersion'] || '',
    appVersion: attributes['mobile.appVersion'] || '',
    fcmRegistered: attributes['mobile.fcmTokenRegistered'] === true,
    silentMs,
    silent: silentMs != null && silentMs > 15 * 60_000,
  };
};

/** Duración legible "Xh Ym" (sin segundos en la tabla). */
export const formatDuration = (ms) => {
  if (ms == null || ms === '') return '—';
  const value = toNumber(ms);
  if (value == null || value < 0) return '—';
  const totalMinutes = Math.floor(value / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

/**
 * Resumen de continuidad de una jornada. Denominadores explícitos; sin
 * `summary` devuelve null (nunca un porcentaje inventado).
 */
export const continuitySummary = (entry) => {
  const summary = entry?.summary;
  if (!summary || !summary.journeyTimeMs) {
    return null;
  }
  return {
    journey: formatDuration(summary.journeyTimeMs),
    tracking: formatDuration(summary.trackingTimeMs),
    gap: formatDuration(summary.gapTimeMs),
    continuityPercent: Number(summary.continuityPct).toFixed(2),
    fixes: summary.fixes,
    gaps: (summary.gaps || []).length,
    biggestGapMs: (summary.gaps || []).reduce(
      (max, gap) => Math.max(max, gap.endMs - gap.startMs),
      0,
    ),
    gapThresholdMs: summary.gapThresholdMs,
  };
};

/** Orden estable para tabla: jornada activa primero, luego silencio, luego nombre. */
export const sortFleet = (rows) =>
  [...rows].sort((a, b) => {
    if (a.journeyActive !== b.journeyActive) return a.journeyActive ? -1 : 1;
    if (a.silent !== b.silent) return a.silent ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
