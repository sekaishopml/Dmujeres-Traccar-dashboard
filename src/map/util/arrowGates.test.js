/**
 * Tests de los gates anti "flechas fantasma": fast-gap (hueco de captura de
 * ~2 min en marcha con pantalla apagada, que antes se dibujaba como recta
 * cruda cruzando cuadras con flechas interpoladas que el slider no puede
 * seleccionar) y gate de continuidad ARROW_MAX_LEG_* (pata sin evidencia de
 * continuidad: NUNCA se interpola flecha sobre ella). `npm test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARROW_MAX_LEG_DT_MS,
  ARROW_MAX_LEG_M,
  buildCanonicalRouteGeometry,
  generateRouteArrows,
  haversineMeters,
  lineSegmentsFor,
} from './canonicalRouteGeometry.js';
import {
  FAST_GAP_DIST_M,
  FAST_GAP_DT_MS,
  MAX_GAP_MS,
  SAME_PLACE_M,
  shouldCut,
} from './pathDecimation.js';

const T0 = Date.parse('2026-03-10T08:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function fix(id, latitude, longitude, { dt = 0, speed = 19.4, course = 90 } = {}) {
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

/** Fix a `meters` al este de la base, con dt (ms) desde T0. */
const east = (id, meters, dtMs, opts) =>
  fix(id, -2.2, -79.9 + meters / 111320, { dt: dtMs, ...opts });

function deepFreeze(value) {
  if (value && typeof value !== 'string' && !Object.isFrozen(value)) {
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
    Object.freeze(value);
  }
  return value;
}

describe('constantes de los gates', () => {
  it('exponen el contrato esperado', () => {
    assert.equal(FAST_GAP_DT_MS, 45_000);
    // 100 m (antes 200): cierra la banda ciega 100-200 m del corte (§1.3 R3).
    assert.equal(FAST_GAP_DIST_M, 100);
    assert.equal(FAST_GAP_DIST_M, SAME_PLACE_M);
    assert.equal(ARROW_MAX_LEG_DT_MS, 20_000);
    assert.equal(ARROW_MAX_LEG_M, 150);
    assert.ok(FAST_GAP_DT_MS < MAX_GAP_MS);
  });
});

describe('fast-gap: hueco de captura en marcha (fix cada ~2 min, pantalla apagada)', () => {
  it('shouldCut corta con dt 126 s y 1335 m (caso real de hoy)', () => {
    assert.equal(shouldCut(east(1, 0, 0), east(2, 1335, 126 * 1000)), true);
  });

  it('dos fixes con hueco de captura: 2 chunks y 0 flechas interpoladas', () => {
    const g = buildCanonicalRouteGeometry([east(1, 0, 0), east(2, 1335, 126 * 1000)], {
      hideInaccurate: true,
    });
    assert.equal(g.chunks.length, 2);
    assert.equal(g.pointCount, 2);
    assert.equal(lineSegmentsFor(g).length, 0);
    assert.equal(generateRouteArrows(g, { spacingMeters: 20 }).arrows.length, 0);
  });

  it('hueco en medio de ruta: la línea se corta y ninguna flecha lo cruza', () => {
    const p0 = east(11, 0, 0);
    const p1 = east(12, 50, 5000);
    const p2 = east(13, 100, 10000);
    const q0 = east(14, 1435, 136000);
    const q1 = east(15, 1485, 141000);
    const q2 = east(16, 1535, 146000);
    const g = buildCanonicalRouteGeometry([p0, p1, p2, q0, q1, q2], { hideInaccurate: true });
    assert.equal(g.chunks.length, 2);
    assert.equal(lineSegmentsFor(g).length, 4);
    const { arrows } = generateRouteArrows(g, { spacingMeters: 20 });
    assert.equal(arrows.length, 10);
    const mid = { latitude: -2.2, longitude: -79.9 + 767 / 111320 };
    for (const arrow of arrows) {
      assert.ok(haversineMeters(arrow, mid) > 500, 'flecha dentro del hueco');
      assert.ok(
        arrow.refPosition === p0 ||
          arrow.refPosition === p1 ||
          arrow.refPosition === p2 ||
          arrow.refPosition === q0 ||
          arrow.refPosition === q1 ||
          arrow.refPosition === q2,
        'flecha sin fix real de referencia',
      );
    }
  });

  it('límites exactos no cortan por fast-gap (regla estricta >)', () => {
    assert.equal(shouldCut(east(1, 0, 0), east(2, 1335, FAST_GAP_DT_MS)), false);
    assert.equal(shouldCut(east(1, 0, 0), east(2, SAME_PLACE_M, 126 * 1000)), false);
  });

  it('banda 100-200 m cerrada: hueco >45 s con 100-200 m corta (R3 §1.3, R7 §7b)', () => {
    // Antes ni fast-gap (dist > 200) ni max-gap (dt > 5 min) la cortaban y se
    // dibujaba una recta de hasta 200 m sobre el hueco.
    assert.equal(shouldCut(east(1, 0, 0), east(2, 101, 126 * 1000)), true);
    assert.equal(shouldCut(east(1, 0, 0), east(2, 150, 60 * 1000)), true);
    assert.equal(shouldCut(east(1, 0, 0), east(2, 190, 46 * 1000)), true);
    // dt en el límite o menor (y velocidad plausible): no corta.
    assert.equal(shouldCut(east(1, 0, 0), east(2, 150, FAST_GAP_DT_MS)), false);
    assert.equal(shouldCut(east(1, 0, 0), east(2, 150, 44 * 1000)), false);
  });

  it('SAME_PLACE corta-circuita: parada con hueco largo no se corta', () => {
    const a = fix(1, -2.2, -79.9, { dt: 0, speed: 0 });
    const b = fix(2, -2.2, -79.9 + 30 / 111320, { dt: 10 * 60 * 1000, speed: 0 });
    assert.equal(shouldCut(a, b), false);
  });

  it('hueco > MAX_GAP_MS sigue cortando (regresión)', () => {
    const a = east(1, 0, 0);
    const b = east(2, 150, 20 * 60 * 1000);
    assert.equal(shouldCut(a, b), true);
  });

  it('teleport sigue cortando (regresión)', () => {
    const a = east(1, 0, 0, { speed: 0 });
    const b = east(2, 890, 10 * 1000, { speed: 0 });
    assert.equal(shouldCut(a, b), true);
    assert.equal(shouldCut(east(3, 0, 0), east(4, 50, 5000)), false);
  });
});

describe('gate de continuidad de flechas (ARROW_MAX_LEG_*)', () => {
  const gatedLeg = (arrows, len, limitM) =>
    arrows.every((arrow) => arrow.distanceM <= limitM + 1e-6 || arrow.distanceM === len);

  it('pata lenta larga (dt 30 s, 180 m): línea sí, 0 flechas interpoladas', () => {
    const a = east(1, 0, 0);
    const b = east(2, 50, 5000);
    const c = east(3, 230, 35000);
    const g = buildCanonicalRouteGeometry([a, b, c], { hideInaccurate: true });
    assert.equal(g.chunks.length, 1);
    assert.equal(lineSegmentsFor(g).length, 2);
    const len = g.chunks[0].lengthMeters;
    const { arrows } = generateRouteArrows(g, { spacingMeters: 20 });
    assert.equal(arrows.length, 3);
    assert.ok(gatedLeg(arrows, len, 50), `flechas sobre la pata gated: ${JSON.stringify(arrows)}`);
    assert.equal(arrows[arrows.length - 1].distanceM, len);
    assert.equal(arrows[arrows.length - 1].refPosition, c);
  });

  it('pata rápida larga (dt 5 s, 170 m): el gate por distancia tampoco interpola', () => {
    const a = east(1, 0, 0);
    const b = east(2, 50, 5000);
    // 170 m (no 180): a 180 m en 5 s la implícita (36 m/s) sería teleport.
    const c = east(3, 220, 10000);
    const g = buildCanonicalRouteGeometry([a, b, c], { hideInaccurate: true });
    assert.equal(g.chunks.length, 1);
    assert.equal(lineSegmentsFor(g).length, 2);
    const len = g.chunks[0].lengthMeters;
    const { arrows } = generateRouteArrows(g, { spacingMeters: 20 });
    assert.equal(arrows.length, 3);
    assert.ok(gatedLeg(arrows, len, 50));
  });

  it('pata larga solo por dt (25 s, 100 m): el gate por tiempo tampoco interpola', () => {
    const a = east(1, 0, 0);
    const b = east(2, 50, 5000);
    const c = east(3, 150, 30000);
    const g = buildCanonicalRouteGeometry([a, b, c], { hideInaccurate: true });
    assert.equal(g.chunks.length, 1);
    assert.equal(lineSegmentsFor(g).length, 2);
    const len = g.chunks[0].lengthMeters;
    const { arrows } = generateRouteArrows(g, { spacingMeters: 20 });
    assert.equal(arrows.length, 3);
    assert.ok(gatedLeg(arrows, len, 50));
  });

  it('patas cortas (dt 5 s, 50 m) siguen interpolando igual que antes', () => {
    const pts = [0, 50, 100, 150, 200, 250].map((m, i) => east(1 + i, m, i * 5000));
    const g = buildCanonicalRouteGeometry(pts, { hideInaccurate: true });
    assert.equal(g.chunks.length, 1);
    const { arrows } = generateRouteArrows(g, { spacingMeters: 20 });
    assert.equal(arrows.length, 13);
    assert.ok(arrows[0].distanceM > 0 && arrows[0].distanceM < 49.9, 'no interpola');
    let previous = null;
    for (const arrow of arrows) {
      if (previous) {
        const d = haversineMeters(previous, arrow);
        assert.ok(d >= 8 && d <= 20.01, `separación ${d}`);
      }
      previous = arrow;
    }
  });

  it('tras una pata gated la emisión retoma en el fix real siguiente', () => {
    const a = east(1, 0, 0);
    const b = east(2, 50, 5000);
    const c = east(3, 230, 35000);
    const d = east(4, 280, 40000);
    const g = buildCanonicalRouteGeometry([a, b, c, d], { hideInaccurate: true });
    const chunk = g.chunks[0];
    const { arrows } = generateRouteArrows(g, { spacingMeters: 20 });
    const resumed = arrows.find((arrow) => arrow.distanceM === chunk.cumulative[2]);
    assert.ok(resumed, 'no retoma en el fix c');
    assert.equal(resumed.refPosition, c);
    for (const arrow of arrows) {
      assert.ok(
        arrow.distanceM <= chunk.cumulative[1] + 1e-6 ||
          arrow.distanceM >= chunk.cumulative[2] - 1e-6,
        `flecha interpolada sobre la pata gated: ${arrow.distanceM}`,
      );
    }
  });

  it('no muta el input (raw congelado)', () => {
    const input = deepFreeze([east(1, 0, 0), east(2, 1335, 126 * 1000), east(3, 2670, 252 * 1000)]);
    const snapshot = JSON.stringify(input);
    const g = buildCanonicalRouteGeometry(input, { hideInaccurate: true });
    assert.equal(g.chunks.length, 3);
    generateRouteArrows(g, { spacingMeters: 20 });
    lineSegmentsFor(g);
    assert.equal(JSON.stringify(input), snapshot);
    assert.ok(Object.isFrozen(input) && Object.isFrozen(input[0]));
  });
});
