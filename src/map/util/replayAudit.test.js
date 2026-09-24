/**
 * Tests de auditoría de /replay: paradas, anomalías, offline, reloj,
 * integridad e inmutabilidad del RAW. `npm test` (node --test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeStops,
  buildReplayLine,
  clockAudit,
  FLAG,
  flagAnomalies,
  integritySummary,
  isInStopSpans,
  isOfflineSynced,
  linkTracksFor,
  offlinePeriods,
  splitMovingAndStops,
  syncDelayMs,
  toTrackPoint,
} from './replayAudit.js';
import { detectStops, shouldCut } from './pathDecimation.js';

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

describe('Pilay 2026-09-23: parada larga, picos aislados y sin accuracy', () => {
  const base = { lat: -2.2274, lon: -79.88844 };

  /** Fix de la app vieja 1.1.x: sin atributo accuracy (no se puede juzgar). */
  function withoutAccuracy(point) {
    const copy = { ...point };
    delete copy.accuracy;
    return copy;
  }

  /** Llegada/salida en marcha a ~240 m: sus fixes >150 m validan la parada. */
  function arrival(startDt, idStart) {
    return Array.from({ length: 8 }, (_, i) =>
      withoutAccuracy(
        fix(-2.2259 - i * 0.0002, -79.8869 - i * 0.0002, {
          dt: startDt + i * 10000,
          speed: 25,
          id: idStart + i,
        }),
      ),
    );
  }

  /** Estancia quieta de 140 fixes (65 s) con picos Doppler y sin accuracy. */
  function dwell(startDt, idStart, { farSpike = false } = {}) {
    const peaks = new Map([
      [81, 0.853],
      [86, 0.586],
      [106, 3.476],
    ]);
    return Array.from({ length: 140 }, (_, i) => {
      const jx = ((i * 37) % 7) - 3;
      const spike = farSpike && i === 50;
      return withoutAccuracy(
        fix(spike ? base.lat - 120 / 111320 : base.lat + jx * 0.00001, base.lon, {
          dt: startDt + i * 65000,
          speed: spike ? 8 : (peaks.get(i) ?? 0),
          id: idStart + i,
        }),
      );
    });
  }

  it('parada larga con pico aislado de 3.5 kn y sin accuracy: se detecta', () => {
    const pts = [
      ...arrival(0, 100),
      ...dwell(8 * 60000, 1000),
      ...arrival(8 * 60000 + 140 * 65000, 2000),
    ];
    const before = snapshot(pts);
    const stops = analyzeStops(pts);
    assert.equal(stops.length, 1);
    assert.ok(stops[0].durationMs >= 150 * 60000, `duración ${stops[0].durationMs}`);
    assert.equal(stops[0].accuracyMed, null, 'sin accuracy no se inventa precisión');
    assert.equal(snapshot(pts), before, 'RAW intacto');
  });

  it('un pico Doppler aislado y lejano que vuelve al lugar no parte la parada', () => {
    const pts = [
      ...arrival(0, 100),
      ...dwell(8 * 60000, 1000, { farSpike: true }),
      ...arrival(8 * 60000 + 140 * 65000, 2000),
    ];
    const stops = analyzeStops(pts);
    assert.equal(stops.length, 1);
    assert.ok(stops[0].durationMs >= 150 * 60000, `duración ${stops[0].durationMs}`);
  });

  it('deriva GPS lenta con jitter: la estancia larga se detecta (antes se perdía)', () => {
    const pts = [...arrival(0, 100)];
    // Deriva de 25 m en 2 h con jitter ±30 m que vuelve al centro entre picos:
    // el diámetro supera 2·radio pero el núcleo y el neto delatan quietud.
    const pattern = [0, 30, 0, -30];
    for (let m = 0; m <= 120; m += 1) {
      const drift = (25 * m) / 120;
      pts.push(
        fix(base.lat + (drift + pattern[m % 4]) / 111320, base.lon, {
          dt: 8 * 60000 + m * 60000,
          speed: 0,
          id: 1000 + m,
        }),
      );
    }
    pts.push(...arrival(8 * 60000 + 121 * 60000, 2000));
    const stops = analyzeStops(pts);
    assert.equal(stops.length, 1);
    assert.ok(stops[0].durationMs >= 120 * 60000, `duración ${stops[0].durationMs}`);
    assert.ok(stops[0].index > 0 && stops[0].index + stops[0].pointCount < pts.length);
  });

  it('crawl lento monótono (avance real) no inventa parada', () => {
    const pts = Array.from({ length: 8 }, (_, i) =>
      fix(-2.2274 + (i * 45) / 111320, -79.88844, { dt: i * 65000, speed: 1.3, id: i + 1 }),
    );
    assert.equal(detectStops(pts).length, 0);
    assert.equal(analyzeStops(pts).length, 0);
  });

  it('parada larga con hueco de cobertura: el movimiento a >10 min la valida', () => {
    const pts = [
      fix(-2.2 + 400 / 111320, -79.9, { dt: -20 * 60000, speed: 25, id: 1 }),
      fix(-2.2 + 360 / 111320, -79.9, { dt: -18 * 60000, speed: 25, id: 2 }),
      fix(-2.2 + 320 / 111320, -79.9, { dt: -16 * 60000, speed: 25, id: 3 }),
      ...Array.from({ length: 4 }, (_, i) =>
        fix(-2.2 + 100 / 111320, -79.9, { dt: (-14 + 2 * i) * 60000, speed: 0.5, id: 10 + i }),
      ),
      ...Array.from({ length: 61 }, (_, i) => {
        const jx = ((i * 37) % 7) - 3;
        return fix(-2.2 + jx * 0.00001, -79.9, { dt: (4 + 2 * i) * 60000, speed: 0, id: 100 + i });
      }),
      fix(-2.2 + 400 / 111320, -79.9, { dt: 146 * 60000, speed: 25, id: 900 }),
      fix(-2.2 + 900 / 111320, -79.9, { dt: 148 * 60000, speed: 25, id: 901 }),
    ];
    const stops = analyzeStops(pts);
    assert.equal(stops.length, 1);
    assert.ok(stops[0].durationMs >= 100 * 60000, `duración ${stops[0].durationMs}`);
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

describe('partición marcha/parada para el matcher', () => {
  // Ruta: marcha 0-40 s, parada 60-450 s (40 fixes), marcha desde 3600 s.
  const pts = (() => {
    const move1 = leg(-2.2, -79.9, 400, 10, 10, { idStart: 1, seq: 1 });
    const stop = dwell(-2.2, -79.88, 40, 10, 60 * 1000, 100);
    stop.forEach((p, i) => {
      p.sequence = 100 + i;
      p.messageId = `dmj-test-${100 + i}`;
    });
    const move2 = leg(-2.2, -79.88 + 150 / 111320, 400, 10, 10, {
      idStart: 500,
      startDt: 3600 * 1000,
    });
    move1.forEach((p, i) => {
      p.sequence = 1 + i;
      p.messageId = `dmj-test-${1 + i}`;
    });
    move2.forEach((p, i) => {
      p.sequence = 500 + i;
      p.messageId = `dmj-test-${500 + i}`;
    });
    return [...move1, ...stop, ...move2];
  })();

  it('split cubre todo sin huecos ni solapes', () => {
    const pieces = splitMovingAndStops(pts, analyzeStops(pts));
    assert.equal(pieces.map((p) => p.kind).join(','), 'move,stop,move');
    assert.equal(pieces[0].from, 0);
    assert.equal(pieces[pieces.length - 1].to, pts.length);
    for (let i = 1; i < pieces.length; i += 1) {
      assert.equal(pieces[i].from, pieces[i - 1].to);
    }
  });

  it('sin paradas: un solo tramo en marcha', () => {
    const moving = leg(-2.2, -79.9, 1000, 15, 10, { idStart: 1 });
    assert.deepEqual(splitMovingAndStops(moving, []), [
      { kind: 'move', from: 0, to: moving.length },
    ]);
    assert.deepEqual(splitMovingAndStops([], []), []);
  });

  it('parada total: un solo tramo parado', () => {
    const stop = dwell(-2.2, -79.88, 40, 10, 0, 1);
    const pieces = splitMovingAndStops(stop, analyzeStops(stop));
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0].kind, 'stop');
  });

  it('isInStopSpans respeta bordes [from, to)', () => {
    const spans = [{ from: 5, to: 45 }];
    assert.equal(isInStopSpans(4, spans), false);
    assert.equal(isInStopSpans(5, spans), true);
    assert.equal(isInStopSpans(44, spans), true);
    assert.equal(isInStopSpans(45, spans), false);
    assert.equal(isInStopSpans(0, null), false);
  });

  it('conectores solo si el par consecutivo es continuo (B-1, R3)', () => {
    const pieces = splitMovingAndStops(pts, analyzeStops(pts));
    const links = linkTracksFor(pieces, pts);
    // Nuevo contrato (B-1): el conector se omite si `shouldCut(a, b)` es true.
    // El fixture crudo tiene un salto temporal sintético en el borde marcha→
    // parada (dt negativo, 7.5 km) → ese conector NO se dibuja.
    let expected = 0;
    for (let i = 0; i + 1 < pieces.length; i += 1) {
      const a = pts[pieces[i].to - 1];
      const b = pts[pieces[i + 1].from];
      if (a && b && !shouldCut(a, b)) {
        expected += 1;
      }
    }
    assert.equal(links.length, expected);
    for (const link of links) {
      assert.equal(link.length, 2);
      assert.ok(link.every((p) => Array.isArray(p) && p.length === 3));
    }
    // Cada conector une exactamente el último fix de la pieza con el primero
    // de la siguiente (por eso se contaron así arriba).
  });

  it('línea unificada: match en marcha, honesto en parada, alineada', () => {
    const pieces = splitMovingAndStops(pts, analyzeStops(pts));
    const moveTracks = [
      [
        [1, 2],
        [3, 4],
      ],
    ];
    const serverSegments = [
      [
        [10, 20],
        [30, 40],
      ],
    ];
    const stopRaws = pieces
      .filter((p) => p.kind === 'stop')
      .map((p) => pts.slice(p.from, p.to).map(toTrackPoint));
    const { segments, tracks } = buildReplayLine({
      moveTracks,
      serverSegments,
      stopRaws,
      links: linkTracksFor(pieces, pts),
    });
    assert.equal(segments.length, tracks.length);
    // Marcha casada + paradas/links honestos (null).
    assert.deepEqual(segments[0], [
      [10, 20],
      [30, 40],
    ]);
    assert.ok(segments.slice(1).every((s) => s === null));
    // La parada viaja con sus fixes reales (indoor visible, no calle).
    const stopTrack = tracks[1];
    assert.ok(stopTrack.length >= 40);
    assert.equal(stopTrack[0][0], pts[pieces[1].from].longitude);
  });

  it('sin match del servidor: todo honesto, nada vacío', () => {
    const { segments, tracks } = buildReplayLine({
      moveTracks: [
        [
          [1, 2],
          [3, 4],
        ],
      ],
      serverSegments: null,
      stopRaws: [
        [
          [5, 6],
          [7, 8],
        ],
      ],
      links: [],
    });
    assert.equal(segments.length, 2);
    assert.ok(segments.every((s) => s === null));
    assert.deepEqual(tracks[0], [
      [1, 2],
      [3, 4],
    ]);
  });

  it('inmutable: partición y línea no tocan el RAW', () => {
    const before = snapshot(pts);
    const pieces = splitMovingAndStops(pts, analyzeStops(pts));
    buildReplayLine({
      moveTracks: [[[0, 0]]],
      serverSegments: null,
      stopRaws: pieces
        .filter((p) => p.kind === 'stop')
        .map((p) => pts.slice(p.from, p.to).map(toTrackPoint)),
      links: linkTracksFor(pieces, pts),
    });
    assert.equal(snapshot(pts), before);
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
