import dayjs from 'dayjs';

// Estados visibles de la fila (chip) y del mapa, por precedencia estricta.
// El calendario ya no interviene: la jornada se lee del atributo del device
// `mobile.journeyId`.
export const DEVICE_DISABLED = 'deshabilitado';
export const DEVICE_NO_SIGNAL = 'sinSenal';
export const DEVICE_STOPPED = 'detenido';
export const DEVICE_ONLINE = 'enLinea';

// Velocidad bajo la cual se considera detenido (nudos; 0.5 kn ≈ 0.9 km/h).
export const STOPPED_MAX_SPEED_KNOTS = 0.5;

// Degradación de señal: RTT máximo (ms), antigüedad máxima de la última
// actualización (ms) y precisión máxima de la posición (m).
export const MAX_SIGNAL_RTT_MS = 2000;
export const MAX_LAST_UPDATE_AGE_MS = 120000;
export const MAX_POSITION_ACCURACY_M = 80;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Jornada activa: `mobile.journeyId` > 0 en los atributos del device.
export const isJourneyActive = (device) => toNumber(device?.attributes?.['mobile.journeyId']) > 0;


export const SILENT_THRESHOLD_MS = 900_000;

/**
 * Estado de salud de tracking derivado (LIVE/DEGRADED/SILENT/OFFLINE):
 * espejo del TrackingHealthPolicy de la app, con la evidencia visible
 * en el dashboard (lastUpdate = última comunicación del device).
 */
export const deviceHealthState = (device, position) => {
  if (!isJourneyActive(device)) {
    return 'OFFLINE';
  }
  const lastComms = device?.lastUpdate ? dayjs(device.lastUpdate).valueOf() : null;

  if (!lastComms || Date.now() - lastComms > SILENT_THRESHOLD_MS) {
    return 'SILENT';
  }
  if (isSignalDegraded(device, position)) {
    return 'DEGRADED';
  }
  return 'LIVE';
};

const isSignalDegraded = (device, position) =>
  device?.attributes?.['mobile.degraded'] === true ||
  toNumber(device?.attributes?.['mobile.rttMs']) > MAX_SIGNAL_RTT_MS ||
  toNumber(device?.attributes?.['mobile.signal']) === 0 ||
  device?.attributes?.['mobile.network'] === 'none' ||
  device?.status === 'offline' ||
  device?.status === 'unknown' ||
  (!!device?.lastUpdate &&
    Date.now() - dayjs(device.lastUpdate).valueOf() > MAX_LAST_UPDATE_AGE_MS) ||
  toNumber(position?.attributes?.accuracy) > MAX_POSITION_ACCURACY_M;

/**
 * Estado visible del dispositivo para la fila (chip + avatar) y el mapa.
 * Precedencia estricta:
 * 1. DESHABILITADO (gris): jornada no activa (`mobile.journeyId` <= 0),
 *    aunque el device esté online.
 * 2. SIN SEÑAL (naranja): jornada activa y degradación de señal
 *    (`mobile.degraded`, RTT > 2 s, `mobile.signal` 0, red 'none',
 *    offline/unknown, lastUpdate > 2 min o precisión GPS > 80 m).
 * 3. DETENIDO (gris): jornada activa, señal OK y speed < 0.5 nudos.
 * 4. EN LINEA (verde): jornada activa, señal OK y en movimiento.
 */
export const selectDeviceState = (device, position) => {
  if (!isJourneyActive(device)) {
    return DEVICE_DISABLED;
  }
  if (isSignalDegraded(device, position)) {
    return DEVICE_NO_SIGNAL;
  }
  if (Number(position?.speed) < STOPPED_MAX_SPEED_KNOTS) {
    return DEVICE_STOPPED;
  }
  return DEVICE_ONLINE;
};

export const getDeviceStateLabelKey = (deviceState) => {
  switch (deviceState) {
    case DEVICE_DISABLED:
      return 'deviceDisabled';
    case DEVICE_NO_SIGNAL:
      return 'deviceNoSignal';
    case DEVICE_STOPPED:
      return 'deviceStopped';
    case DEVICE_ONLINE:
      return 'deviceOnDutyOnline';
    default:
      return 'deviceDisabled';
  }
};

// Chip MUI: warning = naranja (SIN SEÑAL), success = verde (EN LINEA),
// info = azul (DETENIDO), default = gris (DESHABILITADO). Cada estado tiene
// su color: antes DETENIDO compartía el verde con EN LINEA y la letra
// cambiaba pero el color no.
export const getDeviceStateMuiColor = (deviceState) => {
  switch (deviceState) {
    case DEVICE_NO_SIGNAL:
      return 'warning';
    case DEVICE_ONLINE:
      return 'success';
    case DEVICE_STOPPED:
      return 'info';
    default:
      return 'default';
  }
};

// Avatar: naranja (SIN SEÑAL), verde (EN LINEA), azul (DETENIDO) o neutral
// (DESHABILITADO).
export const getDeviceStateDisplayColor = (deviceState) => {
  switch (deviceState) {
    case DEVICE_NO_SIGNAL:
      return 'warning';
    case DEVICE_ONLINE:
      return 'success';
    case DEVICE_STOPPED:
      return 'info';
    default:
      return 'neutral';
  }
};

// Orden de lista pedido por la empresa (CCTV): EN LINEA primero, luego
// DETENIDOS, luego SIN SEÑAL y DESHABILITADOS al final; dentro de cada grupo
// el llamador ordena alfabéticamente.
export const getDeviceStateSortOrder = (deviceState) => {
  switch (deviceState) {
    case DEVICE_ONLINE:
      return 0;
    case DEVICE_STOPPED:
      return 1;
    case DEVICE_NO_SIGNAL:
      return 2;
    default:
      return 3; // DEVICE_DISABLED
  }
};

// Causa humana del SIN SEÑAL. La app nueva envía (y el server persiste) en
// `device.attributes`: `mobile.netCause` (ok|wifi_off_user|wifi_lost|
// mobile_data_off_suspected|no_coverage_suspected|airplane|no_internet|
// captive_suspected|sim_missing), `mobile.validated` y `mobile.causeAt`
// (epoch ms). Nada de esto es obligatorio: las apps viejas no lo mandan y
// los textos son blandos a propósito, así que no se filtra por `validated`.
const NET_CAUSE_I18N_KEY = {
  wifi_off_user: 'deviceCauseWifiOff',
  wifi_lost: 'deviceCauseWifiLost',
  mobile_data_off_suspected: 'deviceCauseMobileDataOff',
  mobile_data_off_user: 'deviceCauseMobileDataOff',
  no_coverage_suspected: 'deviceCauseNoCoverage',
  airplane: 'deviceCauseAirplane',
  no_internet: 'deviceCauseNoInternet',
  captive_suspected: 'deviceCauseCaptive',
  sim_missing: 'deviceCauseNoSim',
};

// Causa con tiempo ya incluido en el texto ("Sin señal desde hace X min"):
// la fila no debe añadirle otro "hace X min" detrás.
export const DEVICE_CAUSE_STALE_AGO = 'deviceCauseStaleAgo';
export const DEVICE_CAUSE_UNKNOWN = 'deviceCauseUnknown';

const toTimestamp = (value) => {
  if (value == null) {
    return null;
  }
  const timestamp = typeof value === 'number' ? value : dayjs(value).valueOf();
  return Number.isFinite(timestamp) ? timestamp : null;
};

/**
 * Motivo humano del estado visible, solo relevante con SIN SEÑAL.
 * Devuelve `{ key, params }` para traducir con `t(key)` + sustitución de
 * `{params}`, o `null` en cualquier otro estado. Nunca depende de que
 * `mobile.netCause` exista: sin causa informada cae a heurísticas por datos
 * (red 'none' → sin cobertura; lastUpdate viejo → hace X min; RTT > 2 s →
 * respuesta lenta; precisión > 80 m → GPS impreciso) y si nada es
 * concluyente, a "causa no confirmada".
 */
export const getDeviceStateCause = (device, position) => {
  if (selectDeviceState(device, position) !== DEVICE_NO_SIGNAL) {
    return null;
  }
  const netCause = device?.attributes?.['mobile.netCause'];
  if (typeof netCause === 'string' && NET_CAUSE_I18N_KEY[netCause]) {
    return { key: NET_CAUSE_I18N_KEY[netCause], params: {} };
  }
  if (device?.attributes?.['mobile.network'] === 'none') {
    return { key: 'deviceCauseNoCoverage', params: {} };
  }
  const staleAt =
    toTimestamp(device?.lastUpdate) ?? toTimestamp(device?.attributes?.['mobile.causeAt']);
  if (staleAt != null && Date.now() - staleAt > MAX_LAST_UPDATE_AGE_MS) {
    return {
      key: DEVICE_CAUSE_STALE_AGO,
      params: { minutes: Math.max(1, Math.round((Date.now() - staleAt) / 60000)) },
    };
  }
  if (toNumber(device?.attributes?.['mobile.rttMs']) > MAX_SIGNAL_RTT_MS) {
    return { key: 'deviceCauseSlowResponse', params: {} };
  }
  if (toNumber(position?.attributes?.accuracy) > MAX_POSITION_ACCURACY_M) {
    return { key: 'deviceCauseGpsInaccurate', params: {} };
  }
  return { key: DEVICE_CAUSE_UNKNOWN, params: {} };
};

/**
 * Resuelve `{ key, params }` de `getDeviceStateCause` a texto con la
 * función `t` simple del proyecto (`(key) => data[key]`, sin interpolación),
 * sustituyendo `{nombre}` por cada param. Devuelve `null` sin causa.
 */
export const formatDeviceStateCause = (t, cause) => {
  if (!cause) {
    return null;
  }
  const template = t(cause.key);
  if (typeof template !== 'string' || !template) {
    return null;
  }
  return Object.entries(cause.params || {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    template,
  );
};

// Tipos de evento con detalle de causa en la campanita (drawer de Eventos).
const CAUSE_EVENT_TYPES = new Set([
  'mobileNetworkLost',
  'mobileWifiLost',
  'mobileNetworkRestored',
  'mobilePossiblePowerOff',
]);

const isCauseEvent = (event) => !!event && CAUSE_EVENT_TYPES.has(event.type);

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Causa del evento para la campanita, a partir de sus atributos
 * (`cause`, `network`, `confidence`, `silenceMinutes`,
 * `battery`/`lastBattery`). No depende de que existan los atributos nuevos
 * de device (`mobile.dataEnabled/simPresent/service/netConf`).
 * Devuelve `{ key, params, explicit }` traducible con
 * `formatDeviceStateCause` (`explicit:true` si `cause` vino en la whitelist
 * de `NET_CAUSE_I18N_KEY`, `false` si es heurística por red 'none'), o
 * `null` si el evento no es de red/silencio o no hay datos concluyentes.
 */
export const getEventCause = (event) => {
  if (!event || !CAUSE_EVENT_TYPES.has(event.type)) {
    return null;
  }
  const attrs = event?.attributes || {};
  const cause = attrs.cause;
  if (typeof cause === 'string' && NET_CAUSE_I18N_KEY[cause]) {
    return { key: NET_CAUSE_I18N_KEY[cause], params: {}, explicit: true };
  }
  if (attrs.network === 'none') {
    return { key: 'deviceCauseNoCoverage', params: {}, explicit: false };
  }
  // Sin datos concluyentes no se afirma nada (mejor solo la hora).
  return null;
};

/**
 * Línea de detalle del evento para la campanita:
 * `motivo · red · X min sin datos · batería N% · confirmado|posible`
 * (solo partes conocidas; los extras de silencio/batería/red se muestran
 * aunque no haya causa explícita). El marcador anti-trampas va al final y
 * solo si hay motivo: `confirmado` con `confidence==='confirmed'`,
 * `posible` con `suspected`/`"inferred"` o causa heurística
 * (`explicit:false`) o `confidence` ausente (eventos viejos; fail-safe a
 * posible, nunca se afirma confirmado sin `confirmed` explícito). Sin causa
 * no hay nada que calificar (solo extras o `null`). Devuelve `null` si no
 * hay nada que detallar (comportamiento actual).
 * Ejemplos (es): "Revisa tus datos · confirmado",
 * "Sin cobertura · posible", "Apagaste el WiFi · confirmado",
 * "Sin cobertura · 12 min sin datos · batería 20% · posible".
 */
export const formatEventCauseDetail = (t, event) => {
  const cause = getEventCause(event);
  if (!cause && !isCauseEvent(event)) {
    return null;
  }
  const parts = [];
  const causeText = formatDeviceStateCause(t, cause);
  if (causeText) {
    parts.push(causeText);
  }
  const attrs = event?.attributes || {};
  const silence = toFiniteNumber(attrs.silenceMinutes);
  const hasSilence = silence != null && silence > 0;
  const hasContext = !!causeText || hasSilence;
  const network = attrs.network;
  if (
    hasContext &&
    typeof network === 'string' &&
    network &&
    network !== 'none' &&
    network !== 'unknown'
  ) {
    parts.push(network);
  }
  if (hasSilence) {
    const template = t('deviceCauseSilence');
    if (typeof template === 'string' && template) {
      parts.push(template.replace('{minutes}', String(Math.max(1, Math.round(silence)))));
    }
  }
  const battery = toFiniteNumber(attrs.battery ?? attrs.lastBattery);
  if (hasContext && battery != null && battery >= 0) {
    const template = t('deviceCauseBattery');
    if (typeof template === 'string' && template) {
      parts.push(template.replace('{value}', String(Math.round(battery))));
    }
  }
  if (causeText) {
    const confidence = attrs.confidence;
    const markerKey = confidence === 'confirmed' ? 'deviceCauseConfirmed' : 'deviceCausePossible';
    const markerTemplate = t(markerKey);
    if (typeof markerTemplate === 'string' && markerTemplate) {
      parts.push(markerTemplate);
    }
  }
  return parts.length ? parts.join(' · ') : null;
};
