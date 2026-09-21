/**
 * Tests del helper de la fila "Calidad" del replay: color por clase de
 * calidad y etiqueta por fuente de velocidad. `npm test` (node --test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { qualityColor, speedSourceLabel } from './qualityLabel.js';

describe('qualityColor', () => {
  it('verde para EXCELLENT y GOOD', () => {
    assert.equal(qualityColor('EXCELLENT'), 'success.main');
    assert.equal(qualityColor('GOOD'), 'success.main');
  });
  it('ámbar para DEGRADED', () => {
    assert.equal(qualityColor('DEGRADED'), 'warning.main');
  });
  it('rojo para POOR e INVALID', () => {
    assert.equal(qualityColor('POOR'), 'error.main');
    assert.equal(qualityColor('INVALID'), 'error.main');
  });
  it('null si no hay clase o es desconocida', () => {
    assert.equal(qualityColor(undefined), null);
    assert.equal(qualityColor(null), null);
    assert.equal(qualityColor('OTRA'), null);
  });
});

describe('speedSourceLabel', () => {
  const t = (key) => key;
  it('traduce las fuentes conocidas', () => {
    assert.equal(speedSourceLabel('doppler', t), 'replaySpeedSourceDoppler');
    assert.equal(speedSourceLabel('implied', t), 'replaySpeedSourceImplied');
    assert.equal(speedSourceLabel('unknown', t), 'replaySpeedSourceUnknown');
  });
  it('null si no hay fuente o es desconocida', () => {
    assert.equal(speedSourceLabel(undefined, t), null);
    assert.equal(speedSourceLabel('otra', t), null);
  });
});
