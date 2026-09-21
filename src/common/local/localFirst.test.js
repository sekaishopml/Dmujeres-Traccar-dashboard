/**
 * Tests del puente write-through (UI -> Redux -> LocalStore) y de la
 * hidratación (LocalStore -> Redux). Se inyectan action creators y store
 * para no tocar el store global ni depender de IndexedDB real.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIndexedDB } from './fakeIdb.js';
import { createLocalStore } from './localStore.js';
import { hydrate, normalizeForCache, writeThrough } from './localFirst.js';

const dbName = () => `dmujeres-wt-${Math.random().toString(36).slice(2)}`;

const createStore = () =>
  createLocalStore({ idbFactory: createFakeIndexedDB(), dbName: dbName(), namespace: 'user:1' });

const makeActions = () => ({
  devices: {
    merge: (records) => ({ type: 'devices/update', payload: records }),
    replace: (records) => ({ type: 'devices/refresh', payload: records }),
  },
  positions: {
    merge: (records) => ({ type: 'session/updatePositions', payload: records }),
  },
  events: {
    merge: (records) => ({ type: 'events/add', payload: records }),
    replace: (records) => ({ type: 'events/refresh', payload: records }),
  },
  motion: {
    replace: (records) => ({ type: 'motion/set', payload: records }),
  },
  health: {},
  continuity: {},
});

const makeDispatch = () => {
  const actions = [];
  return { actions, dispatch: (action) => actions.push(action) };
};

describe('writeThrough: UI -> Redux -> LocalStore', () => {
  it('devices despacha update y persiste en caché', async () => {
    const store = createStore();
    const { dispatch, actions } = makeDispatch();
    await writeThrough(dispatch, 'devices', [{ id: 1, name: 'a' }], {
      actions: makeActions(),
      store,
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'devices/update');
    assert.deepEqual(actions[0].payload, [{ id: 1, name: 'a' }]);
    assert.equal((await store.getAll('devices')).length, 1);
  });

  it('mode replace usa refresh y reemplaza el snapshot local', async () => {
    const store = createStore();
    await store.putMany('devices', [{ id: 1 }, { id: 2 }]);
    const { dispatch, actions } = makeDispatch();
    await writeThrough(dispatch, 'devices', [{ id: 3 }], {
      actions: makeActions(),
      store,
      mode: 'replace',
    });
    assert.equal(actions[0].type, 'devices/refresh');
    assert.deepEqual(
      (await store.getAll('devices')).map((device) => device.id),
      [3],
    );
  });

  it('positions y events usan sus acciones de Redux', async () => {
    const store = createStore();
    const { dispatch, actions } = makeDispatch();
    const actionsMap = makeActions();
    await writeThrough(dispatch, 'positions', [{ deviceId: 1, id: 9 }], {
      actions: actionsMap,
      store,
    });
    await writeThrough(dispatch, 'events', [{ id: 7, eventTime: '2026-01-01T00:00:00Z' }], {
      actions: actionsMap,
      store,
    });
    assert.deepEqual(
      actions.map((action) => action.type),
      ['session/updatePositions', 'events/add'],
    );
  });

  it('motion normaliza el mapa a entradas con id pero despacha el mapa original', async () => {
    const store = createStore();
    const { dispatch, actions } = makeDispatch();
    const motion = { 5: [{ type: 'moving' }] };
    await writeThrough(dispatch, 'motion', motion, { actions: makeActions(), store });
    assert.deepEqual(actions[0].payload, motion);
    assert.deepEqual(await store.getAll('motion'), [{ id: '5', segments: [{ type: 'moving' }] }]);
  });

  it('health y continuity se cachean aunque no tengan slice de Redux', async () => {
    const store = createStore();
    const { dispatch, actions } = makeDispatch();
    await writeThrough(dispatch, 'health', [{ id: 1, state: 'LIVE' }], {
      actions: makeActions(),
      store,
    });
    await writeThrough(dispatch, 'continuity', [{ journeyId: 4 }], {
      actions: makeActions(),
      store,
    });
    assert.equal(actions.length, 0);
    assert.equal((await store.getAll('health')).length, 1);
    assert.equal((await store.getAll('continuity')).length, 1);
  });

  it('rechaza tipos desconocidos y dispatch inválido', async () => {
    const store = createStore();
    await assert.rejects(() => writeThrough(() => {}, 'inventado', [], { store }));
    await assert.rejects(() => writeThrough(null, 'devices', [], { store }));
  });
});

describe('hydrate: LocalStore -> Redux', () => {
  it('devices pinta la caché con refresh', async () => {
    const store = createStore();
    await store.putMany('devices', [{ id: 1, name: 'cache' }]);
    const { dispatch, actions } = makeDispatch();
    const cached = await hydrate(dispatch, 'devices', { actions: makeActions(), store });
    assert.equal(cached.length, 1);
    assert.equal(actions[0].type, 'devices/refresh');
    assert.equal(actions[0].payload[0].name, 'cache');
  });

  it('motion reconstruye el mapa por deviceId', async () => {
    const store = createStore();
    await store.putMany('motion', [
      { id: '5', segments: [{ type: 'moving' }] },
      { id: '6', segments: [{ type: 'stopped' }] },
    ]);
    const { dispatch, actions } = makeDispatch();
    await hydrate(dispatch, 'motion', { actions: makeActions(), store });
    assert.deepEqual(actions[0].payload, {
      5: [{ type: 'moving' }],
      6: [{ type: 'stopped' }],
    });
  });

  it('events hidrata ordenado del más reciente al más antiguo', async () => {
    const store = createStore();
    await store.putMany('events', [
      { id: 1, eventTime: '2026-01-01T10:00:00Z' },
      { id: 2, eventTime: '2026-01-01T12:00:00Z' },
    ]);
    const { dispatch, actions } = makeDispatch();
    await hydrate(dispatch, 'events', { actions: makeActions(), store });
    assert.deepEqual(
      actions[0].payload.map((event) => event.id),
      [2, 1],
    );
  });

  it('sin caché no despacha nada', async () => {
    const store = createStore();
    const { dispatch, actions } = makeDispatch();
    const cached = await hydrate(dispatch, 'devices', { actions: makeActions(), store });
    assert.deepEqual(cached, []);
    assert.equal(actions.length, 0);
  });
});

describe('normalizeForCache', () => {
  it('deja pasar arrays y convierte mapas', () => {
    assert.deepEqual(normalizeForCache('devices', [{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(normalizeForCache('motion', { 5: [] }), [{ id: '5', segments: [] }]);
    assert.deepEqual(normalizeForCache('devices', { a: { id: 1 } }), [{ id: 1 }]);
  });
});
