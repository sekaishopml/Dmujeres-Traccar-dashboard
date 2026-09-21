import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DEVICE_TYPE, HEADER_TYPE, buildGroupedRows } from './deviceGrouping.js';

const groups = {
  3: { id: 3, name: 'DPTO. TECNICOS' },
  1: { id: 1, name: 'DPTO. MARKETING' },
  2: { id: 2, name: 'DPTO. VENTAS' },
};
const devices = [
  { id: 50, name: 'macias', groupId: 1 },
  { id: 2, name: 'santiago', groupId: 2 },
  { id: 43, name: 'pedro', groupId: 2 },
  { id: 39, name: 'joseph', groupId: 3 },
  { id: 37, name: 'admin' },
];

describe('deviceGrouping', () => {
  it('agrupa por departamento en orden alfabético y conserva el orden interno', () => {
    const rows = buildGroupedRows(devices, groups, {});
    assert.deepEqual(
      rows.map((row) => (row.type === HEADER_TYPE ? `#${row.group}` : row.device.name)),
      [
        '#DPTO. MARKETING', 'macias',
        '#DPTO. TECNICOS', 'joseph',
        '#DPTO. VENTAS', 'santiago', 'pedro',
        '#Sin grupo', 'admin',
      ],
    );
  });

  it('un grupo contraído deja solo su cabecera con el conteo', () => {
    const rows = buildGroupedRows(devices, groups, { 2: true });
    assert.deepEqual(
      rows.map((row) => (row.type === HEADER_TYPE ? `#${row.group}(${row.count})` : row.device.name)),
      [
        '#DPTO. MARKETING(1)', 'macias',
        '#DPTO. TECNICOS(1)', 'joseph',
        '#DPTO. VENTAS(2)',
        '#Sin grupo(1)', 'admin',
      ],
    );
  });

  it('sin dispositivos no hay filas', () => {
    assert.deepEqual(buildGroupedRows([], groups, {}), []);
  });

  it('las filas de dispositivo llevan el dispositivo completo', () => {
    const rows = buildGroupedRows(devices, groups, {});
    const firstDevice = rows.find((row) => row.type === DEVICE_TYPE);
    assert.equal(firstDevice.device.name, 'macias');
  });
});
