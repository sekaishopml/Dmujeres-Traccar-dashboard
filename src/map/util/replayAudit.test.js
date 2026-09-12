/**
 * Tests de auditoría de /replay: paradas, anomalías, offline, reloj,
 * integridad e inmutabilidad del RAW. `npm test` (node --test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeStops,
  clockAudit,
  FLAG,
  flagAnomalies,
  integritySummary,
  isOfflineSynced,
  offlinePeriods,
  syncDelayMs,
} from './replayAudit.js';

const T0 = Date.parse('2026-03-10T08:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

let nextId = 1;
function fix(
  lat,
  lon,
  { dt = 0, speed = 48.6, accuracy = 8, id = null, seq = null, extra = {} } = {},
) {
  const point = {
    id: id ?? nextId++,
    latitude: lat,
    longitude: lon,
    speed,
    course: 90,
    accuracy,
    valid: true,
    fixTime: iso(T0 + dt),
    deviceTime: iso(T0 + dt),
    attributes: { provider: 'fused', ...extra },
  };
  if (seq !== null && seq !== undefined) {
    point.sequence = seq;
    point.messageId = `dmj-test-${seq}`;
  }
  return point;
}

/** Tramo en marcha al este a `mps` con jitter opcional, desde startDt (ms). */
function leg(
  lat0,
  lon0,
  meters,
  mps,
  dtS,
  { jitterM = 0, seed = 3, idStart = 0, startDt = 0 } = {},
) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  const step = mps * dtS;
  const n = Math.max(1, Math.round(meters / step));
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    pts.push(
      fix(
        lat0 + (jitterM ? (rnd() * 2 * jitterM) / 111320 : 0),
        lon0 + (Math.min(meters, i * step) + (jitterM ? rnd() * 2 * jitterM : 0)) / 111320,
        { dt: startDt + i * dtS * 1000, speed: mps * 1.94384, id: idStart + i },
      ),
    );
  }
  return pts;
}

/** Parada quieta: N fixes mismo sitio con jitter de 3 m. */
function dwell(lat, lon, count, dtS, startDt, idStart) {
  const pts = [];
  for (let i = 0; i < count; i += 1) {
    const jx = ((i * 37) % 7) - 3;
    pts.push(
      fix(lat + jx * 0.00001, lon + ((i * 53) % 5) * 0.00001, {
        dt: startDt + i * dtS * 1000,
        speed: 0,
        accuracy: 12,
        id: idStart + i,
      }),
    );
  }
  return pts;
}

function snapshot(positions) {
  return JSON.stringify(
    positions.map((p) => [
      p.latitude,
      p.longitude,
      p.fixTime,
      p.deviceTime,
      p.speed,
      p.accuracy,
      p.sequence ?? null,
      p.messageId ?? null,
    ]),
  );
}

describe('paradas', () => {
  it('parada de 10 min: bounds exactos y fixes intactos', () => {
    const leg1 = leg(-2.2, -79.9, 500, 10, 10, { idStart: 1 });
    const stop = dwell(-2.2, -79.885, 61, 10, 600 * 1000, 1000);
    const leg2 = leg(-2.2, -79.885 + 100 / 111320, 500, 10, 10, {
      idStart: 2000,
      startDt: 1210 * 1000,
    });
    const pts = [...leg1, ...stop, ...leg2];
    const before = snapshot(pts);
    const stops = analyzeStops(pts);
    assert.equal(stops.length, 1);
    // La llegada es el primer fix quieto (el punto rápido previo no contamina).
    assert.equal(stops[0].index, leg1.length);
    assert.equal(stops[0].pointCount, 61);
    assert.equal(stops[0].arrivalTime, stop[0].fixTime);
    assert.equal(stops[0].durationMs, 600 * 1000);
    assert.ok(stops[0].accuracyMed !== null && stops[0].accuracyMed <= 20);
    assert.equal(snapshot(pts), before, 'RAW intacto');
  });

  it('parada de 30 min con 180 fixes: una sola parada', () => {
    const leg1 = leg(-2.2, -79.9, 300, 10, 10, { idStart: 1 });
    const stop = dwell(-2.2, -79.89, 180, 10, 400 * 1000, 500);
    const leg2 = leg(-2.2, -79.89 + 100 / 111320, 300, 10, 10, {
      idStart: 900,
      startDt: 2200 * 1000,
    });
    const pts = [...leg1, ...stop, ...leg2];
    const stops = analyzeStops(pts);
    assert.equal(stops.length, 1);
    assert.equal(stops[0].index, leg1.length);
    assert.equal(stops[0].pointCount, 180);
    assert.equal(stops[0].arrivalTime, stop[0].fixTime);
    assert.equal(stops[0].durationMs, 179 * 10 * 1000);
  });

  it('parada de 1 min: bajo el umbral (no se lista) pero fixes intactos y sin falsos', () => {
    const leg1 = leg(-2.2, -79.9, 300, 10, 10, { idStart: 1 });
    const stop = dwell(-2.2, -79.89, 7, 10, 400 * 1000, 500);
    const leg2 = leg(-2.2, -79.89 + 100 / 111320, 300, 10, 10, {
      idStart: 900,
      startDt: 500 * 1000,
    });
    const pts = [...leg1, ...stop, ...leg2];
    const before = snapshot(pts);
    assert.equal(analyzeStops(pts).length, 0);
    const flags = flagAnomalies(pts, {});
    const flagged = flags.filter((f) => f.includes(FLAG.TELEPORT) || f.includes(FLAG.SPEED));
    assert.equal(flagged.length, 0);
    assert.equal(snapshot(pts), before);
  });

  it('ruta con pocos fixes: 3 fixes en 10 min detectan parada', () => {
    const pts = [
      fix(-2.2, -79.9, { dt: 0, id: 1 }),
      fix(-2.20001, -79.90001, { dt: 5 * 60 * 1000, speed: 0, id: 2 }),
      fix(-2.2, -79.9, { dt: 10 * 60 * 1000, speed: 0, id: 3 }),
      fix(-2.2, -79.85, { dt: 11 * 60 * 1000, id: 4 }),
    ];
    const stops = analyzeStops(pts);
    assert.equal(stops.length, 1);
    assert.equal(stops[0].durationMs, 10 * 60 * 1000);
  });
});

describe('anomalías: marcar, nunca borrar', () => {
  it('teleport 890 m/10 s lento, velocidad 140 m/s, tiempo regresivo, duplicado', () => {
    const a = fix(-2.2, -79.9, { dt: 0, speed: 5, id: 1 });
    const b = fix(-2.208, -79.9, { dt: 10 * 1000, speed: 0, id: 2 }); // ~890 m
    const c = fix(-2.208 + 140 / 111320, -79.9, { dt: 11 * 1000, speed: 140, id: 3 }); // 140 m/s
    const d = fix(-2.20802, -79.9, { dt: 10 * 1000, id: 4 }); // regresivo
    const e = { ...fix(-2.20802, -79.9, { dt: 12 * 1000, id: 5 }), fixTime: d.fixTime };
    const pts = [a, b, c, d, e];
    const before = snapshot(pts);
    const flags = flagAnomalies(pts, {});
    assert.ok(flags[1].includes(FLAG.TELEPORT), JSON.stringify(flags));
    assert.ok(flags[2].includes(FLAG.SPEED));
    assert.ok(flags[3].includes(FLAG.TIME));
    assert.ok(flags[4].includes(FLAG.DUPLICATE));
    assert.equal(pts.length, 5, 'ningún fix eliminado');
    assert.equal(snapshot(pts), before);
  });

  it('baja precisión se marca con el umbral dado', () => {
    const pts = [
      fix(-2.2, -79.9, { accuracy: 300, id: 1 }),
      fix(-2.2, -79.89, { accuracy: 10, id: 2 }),
    ];
    const flags = flagAnomalies(pts, { accuracyThreshold: 250 });
    assert.ok(flags[0].includes(FLAG.LOW_ACCURACY));
    assert.ok(!flags[1].includes(FLAG.LOW_ACCURACY));
  });

  it('GPS irregular sin falsos teleports', () => {
    const pts = leg(-2.2, -79.9, 3000, 15, 7, { jitterM: 9 });
    const flags = flagAnomalies(pts, {});
    const bad = flags.filter((f) => f.includes(FLAG.TELEPORT) || f.includes(FLAG.SPEED));
    assert.equal(bad.length, 0);
  });
});

describe('offline y reloj', () => {
  it('hueco de 20 min en marcha = periodo sin cobertura; en parada no', () => {
    const moving = [
      ...leg(-2.2, -79.9, 1000, 15, 10, { idStart: 1 }),
      ...leg(-2.18, -79.9, 1000, 15, 10, { idStart: 500 }).map((p, i) => ({
        ...p,
        fixTime: iso(T0 + 20 * 60 * 1000 + 200 * 1000 + i * 10 * 1000),
      })),
    ];
    const periods = offlinePeriods(moving);
    assert.equal(periods.length, 1);
    assert.ok(periods[0].gapMs >= 20 * 60 * 1000);
    const parked = [
      ...leg(-2.2, -79.9, 300, 10, 10, { idStart: 1 }),
      ...dwell(-2.2, -79.89, 5, 10, 60 * 1000, 500),
    ];
    assert.equal(offlinePeriods(parked).length, 0);
  });

  it('fixAgeSec alto y retraso de llegada marcan sincronizado', () => {
    const a = fix(-2.2, -79.9, { id: 1, extra: { fixAgeSec: 400 } });
    const b = fix(-2.2, -79.89, { id: 2 });
    b.attributes.serverReceivedAt = iso(T0 + 20 * 60 * 1000);
    b.fixTime = iso(T0);
    assert.ok(isOfflineSynced(a));
    assert.ok(isOfflineSynced(b));
    assert.equal(syncDelayMs(b), 20 * 60 * 1000);
    const flags = flagAnomalies([a, b], {});
    assert.ok(flags[0].includes(FLAG.SYNCED));
    assert.ok(flags[1].includes(FLAG.SYNCED));
  });

  it('replay offline de 2 h: ruta completa y sincronizada', () => {
    const pts = [];
    for (let i = 0; i <= 720; i += 1) {
      pts.push(
        fix(-2.2 + (i % 5) * 0.00001, -79.9 + (i * 11) / 111320, {
          dt: i * 10 * 1000,
          id: 100 + i,
          extra: { fixAgeSec: 300 + i },
        }),
      );
    }
    const before = snapshot(pts);
    const flags = flagAnomalies(pts, {});
    assert.ok(flags.every((f) => f.includes(FLAG.SYNCED)));
    assert.equal(offlinePeriods(pts).length, 0);
    assert.equal(snapshot(pts), before);
  });

  it('reloj: desvío >1 h se marca, normal no', () => {
    const ok = fix(-2.2, -79.9, { id: 1 });
    ok.attributes.serverReceivedAt = iso(T0 + 5000);
    const bad = fix(-2.2, -79.89, { id: 2 });
    bad.attributes.serverReceivedAt = iso(T0 + 2 * 3600 * 1000);
    const audit = clockAudit([ok, bad]);
    assert.equal(audit.checkedCount, 2);
    assert.equal(audit.skewedCount, 1);
    assert.ok(audit.maxSkewMs >= 2 * 3600 * 1000);
    const flags = flagAnomalies([ok, bad], {});
    assert.ok(!flags[0].includes(FLAG.CLOCK));
    assert.ok(flags[1].includes(FLAG.CLOCK));
  });
});

describe('integridad', () => {
  it('resumen crudo: conteos sin interpretar', () => {
    const leg1 = leg(-2.2, -79.9, 500, 10, 10, { idStart: 1 });
    const stop = dwell(-2.2, -79.9 + 500 / 111320, 61, 10, 60 * 1000, 1000);
    const leg2 = leg(-2.2, -79.9 + 600 / 111320, 500, 10, 10, {
      idStart: 2000,
      startDt: 670 * 1000,
    });
    const pts = [...leg1, ...stop, ...leg2];
    const stops = analyzeStops(pts);
    const flags = flagAnomalies(pts, {});
    const offline = offlinePeriods(pts);
    const clock = clockAudit(pts);
    const summary = integritySummary({
      positions: pts,
      stops,
      offlinePeriods: offline,
      flags,
      clock,
    });
    assert.equal(summary.rawCount, pts.length);
    assert.equal(summary.stopCount, 1);
    assert.equal(summary.offlineCount, 0);
    assert.equal(summary.maxSkewMs, 0);
  });
});

describe('Santiago / Joseph / Test', () => {
  it('Santiago denso con jitter: sin tormenta de teleports', () => {
    const pts = leg(-2.2, -79.9, 8000, 12, 5, { jitterM: 9, seed: 11 });
    const flags = flagAnomalies(pts, {});
    const bad = flags.filter((f) => f.includes(FLAG.TELEPORT));
    assert.ok(bad.length <= 2, `teleports ${bad.length}`);
  });

  it('Joseph disperso (30 s): sin cortes falsos, periodo offline visible si hay hueco', () => {
    const pts = leg(-2.2, -79.9, 12000, 25, 30, { seed: 5 });
    const flags = flagAnomalies(pts, {});
    assert.ok(flags.flat().filter((f) => f === FLAG.TELEPORT).length === 0);
    const withGap = [
      ...pts.slice(0, 8),
      ...pts
        .slice(8)
        .map((p, i) => ({ ...p, fixTime: iso(T0 + 3600 * 1000 + (8 + i) * 30 * 1000) })),
    ];
    assert.equal(offlinePeriods(withGap).length, 1);
  });

  it('Test corto mixto: parada + hueco + duplicado preservados', () => {
    const stop = dwell(-2.2, -79.88, 40, 10, 0, 100);
    const after = leg(-2.2, -79.88 + 150 / 111320, 400, 10, 10, {
      idStart: 500,
      startDt: 3600 * 1000,
    });
    const dup = { ...after[after.length - 1] };
    const pts = [...stop, ...after, dup];
    const before = snapshot(pts);
    const stops = analyzeStops(pts);
    assert.equal(stops.length, 1);
    assert.equal(stops[0].pointCount, 40);
    assert.equal(offlinePeriods(pts).length, 1);
    const flags = flagAnomalies(pts, {});
    assert.ok(flags[flags.length - 1].includes(FLAG.DUPLICATE));
    assert.equal(snapshot(pts), before, 'inmutable');
  });
});
