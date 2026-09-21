/**
 * Tests de la capa DMujeres (node --test): estados honestos, sin inventar
 * UNKNOWN→PASS y con denominadores de continuidad explícitos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOT_REPORTED,
  UNKNOWN,
  continuitySummary,
  fleetRow,
  formatDuration,
  sortFleet,
} from './dmujeresFleet.js';

describe('fleetRow', () => {
  it('sin atributos reporta UNKNOWN/NOT_REPORTED (nunca inventa)', () => {
    const row = fleetRow({ id: 1, name: 'qa-f0', lastUpdate: new Date().toISOString() });
    assert.equal(row.health, UNKNOWN);
    assert.equal(row.readiness, NOT_REPORTED);
    assert.equal(row.recovery, NOT_REPORTED);
    assert.equal(row.outbox, null);
    assert.equal(row.silent, false);
  });

  it('reporta los atributos mobile.* reales', () => {
    const row = fleetRow({
      id: 47,
      name: 'qa-f0',
      lastUpdate: new Date().toISOString(),
      attributes: {
        'mobile.healthState': 'DEGRADED',
        'mobile.journeyId': 1789614921876,
        'mobile.pending': '3',
        'mobile.recoveryState': 'BLOCKED',
        'mobile.readinessVerdict': 'READY',
        'mobile.oemKey': 'zte',
        'mobile.fcmTokenRegistered': true,
      },
    });
    assert.equal(row.health, 'DEGRADED');
    assert.equal(row.journeyActive, true);
    assert.equal(row.outbox, 3);
    assert.equal(row.recovery, 'BLOCKED');
    assert.equal(row.oemKey, 'zte');
    assert.equal(row.fcmRegistered, true);
  });

  it('marca silencio con >15 min sin actualización', () => {
    const row = fleetRow({
      id: 2,
      name: 'x',
      lastUpdate: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    assert.equal(row.silent, true);
  });
});

describe('continuitySummary', () => {
  it('sin summary devuelve null (no porcentaje inventado)', () => {
    assert.equal(continuitySummary(null), null);
    assert.equal(continuitySummary({ summary: {} }), null);
  });

  it('expone denominadores y el gap mayor', () => {
    const result = continuitySummary({
      summary: {
        journeyTimeMs: 11 * 3_600_000 + 26 * 60_000,
        trackingTimeMs: 62 * 60_000,
        gapTimeMs: 10 * 3_600_000,
        continuityPct: 9.02,
        fixes: 250,
        gaps: [{ startMs: 0, endMs: 10 * 3_600_000 }],
        gapThresholdMs: 300_000,
      },
    });
    assert.equal(result.journey, '11h 26m');
    assert.equal(result.tracking, '1h 2m');
    assert.equal(result.continuityPercent, '9.02');
    assert.equal(result.fixes, 250);
    assert.equal(result.biggestGapMs, 10 * 3_600_000);
    assert.equal(result.gapThresholdMs, 300_000);
  });
});

describe('formatDuration y sortFleet', () => {
  it('formatea duraciones y tolera nulos', () => {
    assert.equal(formatDuration(90 * 60_000), '1h 30m');
    assert.equal(formatDuration(42 * 60_000), '42m');
    assert.equal(formatDuration(null), '—');
  });

  it('ordena activos primero, luego silencio, luego nombre', () => {
    const rows = sortFleet([
      { name: 'b', journeyActive: false, silent: false },
      { name: 'c', journeyActive: true, silent: true },
      { name: 'a', journeyActive: false, silent: true },
    ]);
    assert.deepEqual(
      rows.map((r) => r.name),
      ['c', 'a', 'b'],
    );
  });
});
