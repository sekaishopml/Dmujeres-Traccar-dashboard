/**
 * Guardas de estado con device ausente (crash del replay al montar el hook
 * antes de elegir equipo) y regla de estado operativo. `npm test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_DISABLED,
  getDeviceStateCause,
  getDeviceStateDisplayColor,
  getDeviceStateLabelKey,
  getDeviceStateMuiColor,
  selectDeviceState,
} from './shift.js';

describe('selectDeviceState sin device', () => {
  it('null y undefined caen a DESHABILITADO sin romper', () => {
    assert.equal(selectDeviceState(null, null), DEVICE_DISABLED);
    assert.equal(selectDeviceState(undefined, undefined), DEVICE_DISABLED);
    assert.equal(selectDeviceState(null, { speed: 10 }), DEVICE_DISABLED);
  });

  it('device online sin jornada activa es DESHABILITADO (nunca EN LÍNEA)', () => {
    const device = {
      status: 'online',
      lastUpdate: new Date().toISOString(),
      attributes: {},
    };
    assert.equal(selectDeviceState(device, { speed: 10 }), DEVICE_DISABLED);
  });
});

describe('getDeviceStateCause sin device', () => {
  it('null y undefined devuelven null (sin causa)', () => {
    assert.equal(getDeviceStateCause(null, null), null);
    assert.equal(getDeviceStateCause(undefined, undefined), null);
  });
});

describe('estado DESHABILITADO neutro', () => {
  it('chip gris, avatar neutral y etiqueta de deshabilitado', () => {
    assert.equal(getDeviceStateMuiColor(DEVICE_DISABLED), 'default');
    assert.equal(getDeviceStateDisplayColor(DEVICE_DISABLED), 'neutral');
    assert.equal(getDeviceStateLabelKey(DEVICE_DISABLED), 'deviceDisabled');
  });
});
