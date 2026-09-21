// routeSegmentation.test.js — R3-F13: matriz determinista A–G (docs/audit
// ROUTE_SEGMENTATION_AUDIT.md §4) + regresiones de los casos reales de hoy.
// Pure node --test (mismo patrón que arrowGates.test.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RouteSegmentType,
  classifyBoundary,
  analyzeRouteSegments,
  segmentSummary,
} from './routeSegmentation.js';

const T0 = Date.UTC(2026, 8, 17, 16, 0, 0); // 11:00 local (−05), base "tc_*"

function iso(ms) {
  return new Date(ms).toISOString();
}

// helper: punto con base tc_* (fixTime local serializado Z; serverTime misma base)
function pt(lat, lon, { fix, server, speed = 0, quality = 'GOOD' } = {}) {
  return {
    latitude: lat,
    longitude: lon,
    speed,
    fixTime: iso(fix),
    serverTime: iso(server ?? fix),
    attributes: { qualityClass: quality },
  };
}

const M_PER_DEG = 111320;

test('A: 60 s / 50 m → OBSERVED_CONTINUOUS sin corte', () => {
  const a = pt(-2.2, -79.9, { fix: T0 });
  const b = pt(-2.2005, -79.9, { fix: T0 + 60_000 });
  const r = classifyBoundary(a, b, {});
  assert.equal(r.type, RouteSegmentType.CONTINUOUS);
  assert.equal(r.cut, false);
  assert.ok(!r.signals.backfillBatch);
});

test('B: 20 min / 3000 m, EXCELLENT ambos, sin eventos → CAPTURE_GAP (cut)', () => {
  const a = pt(-2.2, -79.9, { fix: T0, quality: 'EXCELLENT' });
  const b = pt(-2.227, -79.9, { fix: T0 + 20 * 60 * 1000, quality: 'EXCELLENT' });
  const r = classifyBoundary(a, b, { events: [], heartbeats: [] });
  assert.equal(r.type, RouteSegmentType.CAPTURE_GAP);
  assert.equal(r.cut, true);
});

test('C: mismo lote de llegada (Δfix 50 s, mismo sitio) → DELIVERY_DELAY + backfillBatch', () => {
  const srv = iso(Date.parse('2026-09-17T20:14:25-05:00'));
  const mk = (lat, fixMs) => {
    const p = pt(lat, -79.9235, { fix: fixMs });
    p.serverTime = srv;
    return p;
  };
  const a = mk(-2.23936, Date.parse('2026-09-17T10:12:45-05:00'));
  const b = mk(-2.23958, Date.parse('2026-09-17T10:13:35-05:00'));
  const r = classifyBoundary(a, b, {});
  assert.equal(r.type, RouteSegmentType.DELIVERY_DELAY);
  assert.equal(r.cut, false);
  assert.equal(r.signals.backfillBatch, true);
  assert.ok(r.signals.deliveryDelayMsB > 10 * 60 * 60 * 1000);
});

test('D: hueco con NetworkLost→Restored + RECOVERY_SUCCESS y 0 heartbeats → RECOVERY_GAP', () => {
  const a = pt(-2.2, -79.9, { fix: T0 });
  const b = pt(-2.23, -79.9, { fix: T0 + 10 * 60 * 1000, quality: 'EXCELLENT' });
  const events = [
    { timeMs: T0 + 60_000, kind: 'networkLost' },
    { timeMs: T0 + 9 * 60_000, kind: 'recoverySuccess' },
    { timeMs: T0 + 9.5 * 60_000, kind: 'networkRestored' },
  ];
  const r = classifyBoundary(a, b, { events, heartbeats: [] });
  assert.equal(r.type, RouteSegmentType.RECOVERY_GAP);
  assert.equal(r.cut, true);
});

test('E: sin serverTime ni eventos; 8 min / 400 m → UNKNOWN conservador (cut)', () => {
  const a = {
    latitude: -2.2,
    longitude: -79.9,
    speed: 0,
    fixTime: iso(T0),
    attributes: {},
  }; // sin serverTime
  const b = { latitude: -2.2036, longitude: -79.9, speed: 0, fixTime: iso(T0 + 8 * 60_000), attributes: {} };
  const r = classifyBoundary(a, b, { events: [], heartbeats: [] });
  assert.equal(r.type, RouteSegmentType.UNKNOWN);
  assert.equal(r.cut, true);
});

test('F: 4m30s / 50 m misma cuadra → OBSERVED_CONTINUOUS sin corte automático', () => {
  const a = pt(-2.2, -79.9, { fix: T0 });
  const b = pt(-2.20045, -79.9, { fix: T0 + 270_000 });
  const r = classifyBoundary(a, b, {});
  assert.equal(r.type, RouteSegmentType.CONTINUOUS);
  assert.equal(r.cut, false);
});

test('G: 4m30s / 3278 m EXCELLENT → CAPTURE_GAP cut (reproducción macias 10:13→10:17)', () => {
  const a = pt(-2.23936, -79.923485, { fix: T0, quality: 'EXCELLENT', speed: 6.5 });
  const b = pt(-2.237603, -79.891149, {
    fix: T0 + 277_000,
    quality: 'EXCELLENT',
    speed: 0.7,
  });
  const r = classifyBoundary(a, b, { events: [], heartbeats: [] });
  assert.equal(r.type, RouteSegmentType.CAPTURE_GAP);
  assert.equal(r.cut, true);
  assert.ok(r.signals.impliedSpeedMps > 10);
});

test('regresión joseph: 103 m / 6 s corroborado doppler → NO corta (teleport gate)', () => {
  const a = pt(-2.2, -79.9, { fix: T0, speed: 27 });
  const b = pt(-2.20093, -79.9, { fix: T0 + 6_000, speed: 15 });
  const r = classifyBoundary(a, b, {});
  assert.equal(r.type, RouteSegmentType.CONTINUOUS);
  assert.equal(r.cut, false);
});

test('regresión stationary: 15 min / 3 m (mismo lugar) → sin corte', () => {
  const a = pt(-2.2, -79.9, { fix: T0 });
  const b = pt(-2.20002, -79.9, { fix: T0 + 900_000 });
  const r = classifyBoundary(a, b, {});
  assert.equal(r.type, RouteSegmentType.CONTINUOUS);
  assert.equal(r.cut, false);
});

test('heartbeats en el hueco (GPS suspendido, caso joseph) → CAPTURE_GAP', () => {
  const a = pt(-2.2, -79.9, { fix: T0 });
  const b = pt(-2.2214, -79.9, { fix: T0 + 921_000 });
  const r = classifyBoundary(a, b, {
    events: [],
    heartbeats: [{ timeMs: T0 + 300_000 }, { timeMs: T0 + 600_000 }],
  });
  assert.equal(r.type, RouteSegmentType.CAPTURE_GAP);
  assert.equal(r.cut, true);
});

test('analyzeRouteSegments: segmentos por par + resumen por tipo', () => {
  const a = pt(-2.2, -79.9, { fix: T0 });
  const b = pt(-2.2005, -79.9, { fix: T0 + 60_000 });
  const c = pt(-2.2274, -79.9, { fix: T0 + 20 * 60 * 1000, quality: 'EXCELLENT' });
  const segs = analyzeRouteSegments([a, b, c], {});
  assert.equal(segs.length, 2);
  assert.equal(segs[0].type, RouteSegmentType.CONTINUOUS);
  assert.equal(segs[1].type, RouteSegmentType.CAPTURE_GAP);
  const summary = segmentSummary(segs);
  assert.equal(summary.captureGapCount, 1);
  assert.equal(summary.unknownCount, 0);
});

test('MUST-NOT: la segmentación nunca altera las posiciones de entrada', () => {
  const a = pt(-2.2, -79.9, { fix: T0 });
  const b = pt(-2.23, -79.9, { fix: T0 + 900_000 });
  const beforeA = JSON.stringify(a);
  const beforeB = JSON.stringify(b);
  analyzeRouteSegments([a, b], {});
  assert.equal(JSON.stringify(a), beforeA);
  assert.equal(JSON.stringify(b), beforeB);
});
