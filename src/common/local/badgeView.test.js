/**
 * Tests del mapeo puro estado-de-red -> etiqueta visual.
 * Regla clave: con servidor caído nunca aparece LIVE.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_VIEWS, badgeColor, badgeView } from './badgeView.js';
import { NETWORK_STATES } from './networkState.js';

describe('badgeView', () => {
  it('LIVE con red y WebSocket, sin refresco', () => {
    assert.equal(
      badgeView({ network: NETWORK_STATES.LIVE, refreshing: false, hasCache: true }),
      BADGE_VIEWS.LIVE,
    );
  });

  it('refresco en curso muestra ACTUALIZANDO', () => {
    assert.equal(
      badgeView({ network: NETWORK_STATES.LIVE, refreshing: true, hasCache: true }),
      BADGE_VIEWS.UPDATING,
    );
  });

  it('DEGRADED con caché muestra DATOS LOCALES; sin caché no finge LIVE', () => {
    assert.equal(
      badgeView({ network: NETWORK_STATES.DEGRADED, refreshing: false, hasCache: true }),
      BADGE_VIEWS.LOCAL,
    );
    assert.equal(
      badgeView({ network: NETWORK_STATES.DEGRADED, refreshing: false, hasCache: false }),
      BADGE_VIEWS.UPDATING,
    );
  });

  it('servidor caído con caché -> DATOS LOCALES (nunca LIVE)', () => {
    assert.equal(
      badgeView({ network: NETWORK_STATES.RECONNECTING, refreshing: false, hasCache: true }),
      BADGE_VIEWS.LOCAL,
    );
  });

  it('sin red y sin caché -> SIN CONEXIÓN', () => {
    assert.equal(
      badgeView({ network: NETWORK_STATES.OFFLINE, refreshing: false, hasCache: false }),
      BADGE_VIEWS.OFFLINE,
    );
    assert.equal(
      badgeView({ network: NETWORK_STATES.RECONNECTING, refreshing: false, hasCache: false }),
      BADGE_VIEWS.OFFLINE,
    );
  });

  it('sin red pero con caché -> DATOS LOCALES', () => {
    assert.equal(
      badgeView({ network: NETWORK_STATES.OFFLINE, refreshing: false, hasCache: true }),
      BADGE_VIEWS.LOCAL,
    );
  });

  it('cada etiqueta tiene color MUI estable', () => {
    assert.equal(badgeColor(BADGE_VIEWS.LIVE), 'success');
    assert.equal(badgeColor(BADGE_VIEWS.UPDATING), 'info');
    assert.equal(badgeColor(BADGE_VIEWS.LOCAL), 'warning');
    assert.equal(badgeColor(BADGE_VIEWS.OFFLINE), 'error');
  });
});
