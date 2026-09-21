/**
 * Tests de MotionStateV2 en el dashboard: segmentos por estado, colores y
 * duraciones. Puro con `node --test`; NO muta positions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_V2_COLORS,
  MOTION_V2_STATES,
  buildMotionV2Segments,
  formatMotionV2Duration,
  motionV2StateOf,
} from './motionV2.js';

const BASE = Date.parse('2026-09-12T12:00:00Z');

function pos(offsetMs, state, extra = {}) {
  return {
    fixTime: new Date(BASE + offsetMs).toISOString(),
    attributes: { motionStateV2: state, ...extra },
  };
}

describe('motionV2', () => {
  it('expone los 4 estados V2 y sus colores', () => {
    assert.deepEqual(MOTION_V2_STATES, ['MOVING', 'PAUSED', 'STOPPED', 'UNKNOWN']);
    assert.equal(MOTION_V2_COLORS.MOVING, '#4caf50');
    assert.equal(MOTION_V2_COLORS.PAUSED, '#ffb300');
    assert.equal(MOTION_V2_COLORS.STOPPED, '#2196f3');
    assert.equal(MOTION_V2_COLORS.UNKNOWN, '#9e9e9e');
  });

  it('lee el estado V2 del atributo del servidor', () => {
    assert.equal(motionV2StateOf({ attributes: { motionStateV2: 'PAUSED' } }), 'PAUSED');
    assert.equal(motionV2StateOf({ attributes: { motionStateV2: 'BOGUS' } }), null);
    assert.equal(motionV2StateOf({ attributes: {} }), null);
    assert.equal(motionV2StateOf(null), null);
  });

  it('construye segmentos continuos por estado', () => {
    const segments = buildMotionV2Segments([
      pos(0, 'MOVING'),
      pos(10000, 'MOVING'),
      pos(20000, 'PAUSED'),
      pos(30000, 'PAUSED'),
      pos(40000, 'MOVING'),
    ]);
    assert.equal(segments.length, 3);
    assert.deepEqual(segments[0], {
      state: 'MOVING',
      start: BASE,
      end: BASE + 20000,
      durationMs: 20000,
    });
    assert.deepEqual(segments[1], {
      state: 'PAUSED',
      start: BASE + 20000,
      end: BASE + 40000,
      durationMs: 20000,
    });
    assert.equal(segments[2].state, 'MOVING');
  });

  it('devuelve [] sin atributo V2 (datos históricos)', () => {
    assert.deepEqual(
      buildMotionV2Segments([
        { fixTime: new Date(BASE).toISOString(), attributes: {} },
        { fixTime: new Date(BASE + 1000).toISOString(), attributes: {} },
      ]),
      [],
    );
    assert.deepEqual(buildMotionV2Segments([]), []);
    assert.deepEqual(buildMotionV2Segments(undefined), []);
  });

  it('ordena temporalmente aunque entren desordenados', () => {
    const segments = buildMotionV2Segments([
      pos(30000, 'PAUSED'),
      pos(0, 'MOVING'),
      pos(10000, 'STOPPED'),
      pos(20000, 'STOPPED'),
    ]);
    assert.equal(segments.length, 3);
    assert.equal(segments[0].state, 'MOVING');
    assert.equal(segments[1].state, 'STOPPED');
    assert.equal(segments[2].state, 'PAUSED');
  });

  it('cubre UNKNOWN y no lo confunde con parada', () => {
    const segments = buildMotionV2Segments([
      pos(0, 'MOVING'),
      pos(10000, 'UNKNOWN'),
      pos(60000, 'STOPPED'),
    ]);
    assert.equal(segments.length, 3);
    assert.equal(segments[1].state, 'UNKNOWN');
    assert.equal(segments[1].durationMs, 50000);
    assert.equal(segments[2].state, 'STOPPED');
  });

  it('formato de duración legible', () => {
    assert.equal(formatMotionV2Duration(79000), '1m 19s');
    assert.equal(formatMotionV2Duration(29 * 60_000 + 34_000), '29m 34s');
    assert.equal(formatMotionV2Duration(7200_000 + 300_000), '2h 05m');
    assert.equal(formatMotionV2Duration(5000), '5s');
    assert.equal(formatMotionV2Duration(-10), '0s');
  });

  it('no muta el array de entrada (RAW es fuente de verdad)', () => {
    const input = [pos(10000, 'MOVING'), pos(0, 'PAUSED')];
    const copy = [...input];
    buildMotionV2Segments(input);
    assert.deepEqual(input, copy);
  });
});
