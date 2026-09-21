/**
 * Tests del estado de salud derivado (F0-K): espejo honesto del
 * TrackingHealthPolicy de la app, sin inventar estados.
 * Puro con `node --test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SILENT_THRESHOLD_MS, deviceHealthState } from './shift.js';

describe('deviceHealthState', () => {
  const journeyDevice = { attributes: { 'mobile.journeyId': 5 }, lastUpdate: new Date().toISOString() };

  it('jornada inactiva - OFFLINE', () => {
    const r = deviceHealthState({ attributes: { 'mobile.journeyId': 0 } }, null);
    assert.equal(r, 'OFFLINE');
  });

  it('sin comunicación > 15 min - SILENT', () => {
    const device = {
      attributes: { 'mobile.journeyId': 5 },
      lastUpdate: new Date(Date.now() - SILENT_THRESHOLD_MS - 1000).toISOString(),
    };
    assert.equal(deviceHealthState(device, null), 'SILENT');
  });

  it('sin lastUpdate - SILENT (no inventa LIVE)', () => {
    const device = { attributes: { 'mobile.journeyId': 5 } };
    assert.equal(deviceHealthState(device, null), 'SILENT');
  });

  it('comunicación fresca con degradación de señal - DEGRADED', () => {
    const device = {
      attributes: { 'mobile.journeyId': 5, 'mobile.network': 'none' },
      lastUpdate: new Date().toISOString(),
    };
    const position = { speed: 5, attributes: {} };
    assert.equal(deviceHealthState(device, position), 'DEGRADED');
  });

  it('comunicación fresca señal OK movimiento - LIVE', () => {
    const position = { speed: 5, attributes: { accuracy: 5 } };
    assert.equal(deviceHealthState(journeyDevice, position), 'LIVE');
  });

  it('umbral 900s alineado al watchdog server', () => {
    assert.equal(SILENT_THRESHOLD_MS, 900_000);
  });
});
