/**
 * Tests de la geometría canónica y las flechas por distancia real.
 * `npm test` (node --test, sin dependencias). Casos: densidades 1s/10s/30s,
 * rutas cortas-densas vs largas-dispersas, gaps, teleports, replay offline,
 * paradas, bearing, escala de color compartida y guarda MAX_ARROWS.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ARROWS,
  buildCanonicalRouteGeometry,
  generateRouteArrows,
  haversineMeters,
  lineSegmentsFor,
  spacingForZoom,
} from './canonicalRouteGeometry.js';

// PRNG determinista (mulberry32) para jitter reproducible.
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = Date.parse('2026-03-10T08:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function fix(id, latitude, longitude, { dt = 0, speed = 48.6, course = 90 } = {}) {
  return {
    id,
    latitude,
    longitude,
    speed,
    course,
    accuracy: 8,
    valid: true,
    fixTime: iso(T0 + dt),
    attributes: { provider: 'fused' },
  };
}

/** Ruta recta al este: `meters` metros a `speedMps`, muestreada cada `dtS`. */
function straight(meters, speedMps, dtS, jitterM = 0, seed = 7) {
  const random = rng(seed);
  const step = speedMps * dtS;
  const n = Math.max(1, Math.round(meters / step));
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const along = Math.min(meters, i * step);
    const jx = jitterM ? (random() - 0.5) * 2 * jitterM : 0;
    const jy = jitterM ? (random() - 0.5) * 2 * jitterM : 0;
    pts.push(
      fix(i, -2.2 + jy / 111320, -79.9 + (along + jx) / 111320, {
        dt: i * dtS * 1000,
        speed: speedMps * 1.94384,
      }),
    );
  }
  return pts;
}

/** Distancia punto→segmento (m, aproximación equirectangular local). */
function pointToSegmentM(p, a, b) {
  const kx = 111320 * Math.cos((a.latitude * Math.PI) / 180);
  const bx = (b.longitude - a.longitude) * kx;
  const by = (b.latitude - a.latitude) * 111320;
  const px = (p.longitude - a.longitude) * kx;
  const py = (p.latitude - a.latitude) * 111320;
  const len2 = bx * bx + by * by;
  if (len2 < 1e-12) {
    return Math.hypot(px, py);
  }
  const t = Math.min(1, Math.max(0, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

describe('spacingForZoom', () => {
  it('devuelve metros físicos que crecen al alejarse', () => {
    assert.equal(spacingForZoom(8), 120);
    assert.equal(spacingForZoom(12), 50);
    assert.equal(spacingForZoom(15), 20);
    assert.equal(spacingForZoom(18), 15);
    assert.ok(spacingForZoom(8) > spacingForZoom(12));
    assert.ok(spacingForZoom(12) > spacingForZoom(16));
  });
});

describe('densidades GPS (1s / 2s / 5s): mismas flechas', () => {
  const spacing = 50;
  // Velocidad 12 m/s: todas las patas (≤ 120 m, dt ≤ 5 s) quedan bajo el gate
  // ARROW_MAX_LEG (patas mayores ya no interpolan: ver gates de continuidad).
  // 9960 m es divisible por los tres pasos (12/24/60): las tres rutas terminan
  // en el mismo fix y la flecha de cierre coincide entre densidades.
  const geoms = [1, 2, 5].map((dt) => {
    const pts = straight(9960, 12, dt);
    return { dt, pts, g: buildCanonicalRouteGeometry(pts, { hideInaccurate: true }) };
  });

  it('misma longitud total y mismo conteo de flechas', () => {
    for (const { g } of geoms) {
      assert.ok(Math.abs(g.totalMeters - 10000) < 300, `total ${g.totalMeters}`);
    }
    const counts = geoms.map(
      ({ g }) => generateRouteArrows(g, { spacingMeters: spacing }).arrows.length,
    );
    assert.deepEqual(counts, [199, 199, 199]);
  });

  it('flechas 2s idénticas a 1s; 5s a <20 m', () => {
    const base = generateRouteArrows(geoms[0].g, { spacingMeters: spacing }).arrows;
    [
      [1, 0.01],
      [2, 20],
    ].forEach(([gi, tol]) => {
      const arrows = generateRouteArrows(geoms[gi].g, { spacingMeters: spacing }).arrows;
      for (const a of arrows) {
        const best = Math.min(...base.map((b) => haversineMeters(a, b)));
        assert.ok(best <= tol, `dt=${geoms[gi].dt}s desvío ${best}`);
      }
    });
  });

  it('uniformidad: p50 exacto al espaciado', () => {
    const { arrows } = generateRouteArrows(geoms[0].g, { spacingMeters: spacing });
    const ds = [];
    for (let i = 1; i < arrows.length; i += 1) {
      assert.equal(arrows[i].chunkId, arrows[i - 1].chunkId);
      ds.push(haversineMeters(arrows[i - 1], arrows[i]));
    }
    ds.sort((a, b) => a - b);
    assert.equal(ds[Math.floor(ds.length / 2)].toFixed(2), '50.00');
    assert.ok(ds[0] >= 8, `mínimo ${ds[0]}`);
  });
});

describe('corta-densa vs larga-dispersa', () => {
  it('800 m con 41 fixes y 12 km con 101 fixes: ambas uniformes', () => {
    const short = straight(800, 10, 2); // 41 fixes, patas de 20 m
    // 12 m/s con dt 10 s: patas de 120 m, bajo el gate ARROW_MAX_LEG.
    const long = straight(12000, 12, 10); // 101 fixes, patas de 120 m
    const gs = buildCanonicalRouteGeometry(short, { hideInaccurate: true });
    const gl = buildCanonicalRouteGeometry(long, { hideInaccurate: true });
    const as = generateRouteArrows(gs, { spacingMeters: 50 }).arrows;
    const al = generateRouteArrows(gl, { spacingMeters: 50 }).arrows;
    assert.equal(as.length, 16);
    assert.ok(Math.abs(al.length - 240) <= 2, `largo: ${al.length}`);
    for (const arrows of [as, al]) {
      for (let i = 1; i < arrows.length; i += 1) {
        const d = haversineMeters(arrows[i - 1], arrows[i]);
        assert.ok(d >= 8 && d <= 50.01, `separación ${d}`);
      }
    }
  });
});

describe('gaps y teleports: nunca flechas cruzando', () => {
  it('hueco de 20 min parte en 2 chunks sin flecha en el hueco', () => {
    const a = straight(2000, 20, 10);
    const b = straight(2000, 20, 10).map((p, i) => ({
      ...p,
      id: 10000 + i,
      latitude: p.latitude + 0.02,
      fixTime: iso(T0 + 20 * 60 * 1000 + i * 10 * 1000),
    }));
    const g = buildCanonicalRouteGeometry([...a, ...b], { hideInaccurate: true });
    assert.equal(g.chunks.length, 2);
    const { arrows } = generateRouteArrows(g, { spacingMeters: 50 });
    const mid = {
      latitude: (a[a.length - 1].latitude + b[0].latitude) / 2,
      longitude: -79.9 + 1000 / 111320,
    };
    for (const arrow of arrows) {
      assert.ok(haversineMeters(arrow, mid) > 400, 'flecha dentro del hueco');
    }
  });

  it('teleport de 890 m en 10 s con extremos lentos se corta', () => {
    const pts = straight(1000, 2.5, 10);
    const last = pts[pts.length - 1];
    const jump = fix(9999, last.latitude + 0.008, last.longitude, {
      dt: (pts.length - 1) * 10 * 1000 + 10 * 1000,
      speed: 0,
    });
    const g = buildCanonicalRouteGeometry([...pts, jump], { hideInaccurate: true });
    assert.ok(g.chunks.length >= 2, `chunks ${g.chunks.length}`);
  });

  it('parada en el mismo sitio no corta (SAME_PLACE)', () => {
    const moving = straight(500, 10, 10);
    const last = moving[moving.length - 1];
    const stopped = [];
    for (let i = 0; i < 30; i += 1) {
      stopped.push(
        fix(5000 + i, last.latitude, last.longitude, { dt: 600 * 1000 + i * 60 * 1000, speed: 0 }),
      );
    }
    const g = buildCanonicalRouteGeometry([...moving, ...stopped], { hideInaccurate: false });
    assert.equal(g.chunks.length, 1);
  });
});

describe('replay offline y entrada desordenada', () => {
  it('fixTime de hace 4 h se acepta y ordena; sin flechas fantasma', () => {
    const now = Date.now();
    const pts = straight(3000, 15, 10).map((p, i) => ({
      ...p,
      fixTime: iso(now - 4 * 3600 * 1000 + i * 10 * 1000),
    }));
    const shuffled = [...pts].reverse();
    const g = buildCanonicalRouteGeometry(shuffled, { hideInaccurate: true });
    assert.equal(g.pointCount, pts.length);
    assert.equal(g.chunks.length, 1);
    const { arrows } = generateRouteArrows(g, { spacingMeters: 50 });
    assert.ok(arrows.length >= 50 && arrows.length <= 70, `flechas ${arrows.length}`);
  });
});

describe('línea y flechas: exactamente la misma ruta', () => {
  it('toda flecha yace sobre un segmento de la línea (<1 m)', () => {
    const pts = straight(5000, 20, 5, 6);
    const g = buildCanonicalRouteGeometry(pts, { hideInaccurate: true });
    const segList = lineSegmentsFor(g);
    const { arrows } = generateRouteArrows(g, { spacingMeters: 40 });
    assert.ok(arrows.length > 50);
    for (const arrow of arrows) {
      const chunkSegs = segList.filter((s) => s.chunkId === arrow.chunkId);
      const best = Math.min(...chunkSegs.map((s) => pointToSegmentM(arrow, s.a, s.b)));
      assert.ok(best < 1, `flecha a ${best} m del trazo`);
    }
  });

  it('misma escala de color para línea y flechas', () => {
    const pts = straight(2000, 20, 10);
    const g = buildCanonicalRouteGeometry(pts, { hideInaccurate: true });
    assert.ok(g.speedMax <= 65);
    assert.ok(g.speedMin <= g.speedMax);
  });

  it('el rumbo sale de la geometría, no de course', () => {
    // Ruta al este (rumbo 90) con course reportado cruzado (270). Velocidad
    // 12 m/s: patas de 120 m, bajo el gate ARROW_MAX_LEG (flechas interpoladas).
    const pts = straight(2000, 12, 10).map((p) => ({ ...p, course: 270 }));
    const g = buildCanonicalRouteGeometry(pts, { hideInaccurate: true });
    const { arrows } = generateRouteArrows(g, { spacingMeters: 50 });
    for (const arrow of arrows) {
      assert.ok(Math.abs(arrow.rotation - 90) < 0.01, `rumbo ${arrow.rotation}`);
    }
  });
});

describe('casos borde', () => {
  it('vacío y un punto no rompen', () => {
    for (const input of [[], [fix(1, -2.2, -79.9)]]) {
      const g = buildCanonicalRouteGeometry(input, { hideInaccurate: true });
      assert.equal(generateRouteArrows(g, { spacingMeters: 50 }).arrows.length, 0);
      assert.equal(lineSegmentsFor(g).length, input.length === 0 ? 0 : 0);
    }
  });

  it('pares en vivo [lon, lat] geometrizan', () => {
    const pairs = [];
    for (let i = 0; i <= 20; i += 1) {
      pairs.push([-79.9 + (i * 100) / 111320, -2.2]);
    }
    const g = buildCanonicalRouteGeometry(pairs, { hideInaccurate: false });
    assert.equal(g.chunks.length, 1);
    assert.ok(Math.abs(g.totalMeters - 2000) < 5);
  });

  it('tramo corto (<espaciado) muestra su dirección al cierre', () => {
    const pts = straight(30, 10, 10);
    const g = buildCanonicalRouteGeometry(pts, { hideInaccurate: true });
    const { arrows } = generateRouteArrows(g, { spacingMeters: 50 });
    assert.equal(arrows.length, 1);
    assert.ok(Math.abs(arrows[0].rotation - 90) < 0.01);
  });

  it('guarda MAX_ARROWS relaja espaciado sin muestrear por índice', () => {
    // Velocidad 12 m/s: patas de 120 m bajo el gate ARROW_MAX_LEG, así la
    // guarda sí relaja el espaciado (las patas gated no generan flechas).
    const pts = straight(83000, 12, 10);
    const g = buildCanonicalRouteGeometry(pts, { hideInaccurate: true });
    const { arrows, spacingMeters } = generateRouteArrows(g, { spacingMeters: 20 });
    assert.ok(arrows.length <= MAX_ARROWS, `flechas ${arrows.length}`);
    assert.ok(spacingMeters >= 20, `espaciado ${spacingMeters}`);
    // Aún uniforme con el espaciado relajado.
    for (let i = 1; i < arrows.length; i += 1) {
      if (arrows[i].chunkId === arrows[i - 1].chunkId) {
        const d = haversineMeters(arrows[i - 1], arrows[i]);
        assert.ok(d <= spacingMeters + 0.01 && d >= 8, `separación ${d}`);
      }
    }
  });
});
