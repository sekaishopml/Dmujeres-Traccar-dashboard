import assert from 'node:assert';
import { describe, it } from 'node:test';
import { EVENT_TYPES, processEvents } from './eventDigest.js';

const e = (id, type, deviceId, minutes) => ({
  id,
  deviceId,
  type,
  eventTime: new Date(2026, 8, 20, 0, minutes).toISOString(),
});

describe('eventDigest', () => {
  it('fusiona conexión con problemas en un rango desde/hasta', () => {
    const rows = processEvents([
      { id: 2, deviceId: 5, type: 'mobilePresenceSuspect', eventTime: new Date(2026, 8, 20, 10, 10) },
      { id: 3, deviceId: 5, type: 'mobilePresenceRecovered', eventTime: new Date(2026, 8, 20, 10, 12) },
      { id: 1, deviceId: 5, type: 'mobileJourneyStarted', eventTime: new Date(2026, 8, 20, 9, 0) },
      { id: 4, deviceId: 5, type: 'mobileStalled', eventTime: new Date(2026, 8, 20, 9, 30) },
    ]);
    // 3 filas: jornada, problema de conexión (rango), fin. El stalled se descarta.
    assert.equal(rows.length, 2);
    const problem = rows.find((r) => r.type === 'mobileConnectionProblem');
    assert.equal(new Date(problem.attributes.since).getMinutes(), 10);
    assert.equal(new Date(problem.attributes.until).getMinutes(), 12);
    // La jornada sigue visible.
    assert.ok(rows.some((r) => r.type === 'mobileJourneyStarted'));
  });

  it('suspect sin recovered queda como problema abierto', () => {
    const rows = processEvents([
      { id: 9, deviceId: 5, type: 'mobilePresenceSuspect', eventTime: new Date(2026, 8, 20, 11, 0) },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'mobileConnectionProblem');
    assert.equal(rows[0].attributes.until, null);
  });

  it('solo sobreviven los tipos de la empresa', () => {
    const rows = processEvents([
      { id: 1, deviceId: 5, type: 'mobileDiagnostics' },
      { id: 10, deviceId: 5, type: 'deviceOnline' },
      { id: 11, deviceId: 5, type: 'mobileOtaManual' },
    ]);
    assert.deepEqual(
      rows.map((r) => r.type).sort(),
      ['mobileOtaManual'].sort(),
    );
    assert.equal(EVENT_TYPES.has('mobileStalled'), false);
  });
});
