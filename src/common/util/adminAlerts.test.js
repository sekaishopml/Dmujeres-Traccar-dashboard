/**
 * Tests de la lógica pura de la sección Alertas: agrupación por severidad
 * (crítica → advertencia → información) y formateo del estado del sistema.
 * Puro con `node --test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAgeHours,
  formatBytes,
  formatUptime,
  groupAlerts,
  severityRank,
  sortAlerts,
} from './adminAlerts.js';

describe('groupAlerts', () => {
  const alerts = [
    { severity: 'info', ts: 3, message: 'i' },
    { severity: 'critical', ts: 1, message: 'c1' },
    { severity: 'warning', ts: 2, message: 'w1' },
    { severity: 'critical', ts: 5, message: 'c2' },
  ];

  it('separa las tres severidades y conserva todo', () => {
    const groups = groupAlerts(alerts);
    assert.equal(groups.critical.length, 2);
    assert.equal(groups.warning.length, 1);
    assert.equal(groups.info.length, 1);
  });

  it('ordena por severidad y luego por ts descendente', () => {
    const groups = groupAlerts(alerts);
    assert.deepEqual(
      groups.critical.map((a) => a.message),
      ['c2', 'c1'],
    );
  });

  it('una severidad desconocida cae en info (no se pierde)', () => {
    const groups = groupAlerts([{ severity: 'rara', ts: 1 }]);
    assert.equal(groups.info.length, 1);
    assert.equal(groups.critical.length, 0);
  });

  it('soporta listas vacías o nulas', () => {
    assert.deepEqual(groupAlerts([]), { critical: [], warning: [], info: [] });
    assert.deepEqual(groupAlerts(null), { critical: [], warning: [], info: [] });
  });
});

describe('sortAlerts', () => {
  it('no muta la lista original', () => {
    const original = [
      { severity: 'warning', ts: 1 },
      { severity: 'critical', ts: 2 },
    ];
    const sorted = sortAlerts(original);
    assert.equal(original[0].severity, 'warning');
    assert.equal(sorted[0].severity, 'critical');
  });

  it('severityRank sigue el orden crítico > advertencia > info', () => {
    assert.ok(severityRank('critical') > severityRank('warning'));
    assert.ok(severityRank('warning') > severityRank('info'));
    assert.equal(severityRank('otra'), 0);
  });
});

describe('formatBytes', () => {
  it('formatea bytes, KB, MB y GB', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
    assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
  });

  it('devuelve null sin dato', () => {
    assert.equal(formatBytes(null), null);
    assert.equal(formatBytes(undefined), null);
  });
});

describe('formatAgeHours', () => {
  it('resume horas y días', () => {
    assert.equal(formatAgeHours(0), '<1 h');
    assert.equal(formatAgeHours(5), '5 h');
    assert.equal(formatAgeHours(30), '30 h');
    assert.equal(formatAgeHours(72), '3 d');
    assert.equal(formatAgeHours(null), null);
  });
});

describe('formatUptime', () => {
  it('resume minutos, horas y días', () => {
    assert.equal(formatUptime(90), '1 min');
    assert.equal(formatUptime(3 * 3600 + 20 * 60), '3 h 20 min');
    assert.equal(formatUptime(2 * 86400 + 4 * 3600), '2 d 4 h');
    assert.equal(formatUptime(null), null);
  });
});
