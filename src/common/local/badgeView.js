/**
 * Mapeo puro estado-de-red -> etiqueta visual del badge. Sin React, testeable.
 * Etiquetas permitidas: LIVE / ACTUALIZANDO / DATOS LOCALES / SIN CONEXIÓN.
 */
import { NETWORK_STATES } from './networkState.js';

export const BADGE_VIEWS = Object.freeze({
  LIVE: 'LIVE',
  UPDATING: 'ACTUALIZANDO',
  LOCAL: 'DATOS LOCALES',
  OFFLINE: 'SIN CONEXIÓN',
});

export const badgeView = ({ network, refreshing = false, hasCache = false } = {}) => {
  if (network === NETWORK_STATES.OFFLINE) {
    return hasCache ? BADGE_VIEWS.LOCAL : BADGE_VIEWS.OFFLINE;
  }
  if (refreshing) {
    return BADGE_VIEWS.UPDATING;
  }
  if (network === NETWORK_STATES.LIVE) {
    return BADGE_VIEWS.LIVE;
  }
  if (network === NETWORK_STATES.DEGRADED) {
    return hasCache ? BADGE_VIEWS.LOCAL : BADGE_VIEWS.UPDATING;
  }
  return hasCache ? BADGE_VIEWS.LOCAL : BADGE_VIEWS.OFFLINE;
};

export const badgeColor = (view) => {
  switch (view) {
    case BADGE_VIEWS.LIVE:
      return 'success';
    case BADGE_VIEWS.UPDATING:
      return 'info';
    case BADGE_VIEWS.LOCAL:
      return 'warning';
    default:
      return 'error';
  }
};
