/**
 * Tests del núcleo stale-while-revalidate (`runLocalFirst`) con store y red
 * inyectados: caché inmediata, refresco de red, fallo honesto y offline.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIndexedDB } from './fakeIdb.js';
import { createLocalStore } from './localStore.js';
import { runLocalFirst } from './useLocalFirst.js';
import { NETWORK_STATES } from './networkState.js';

const dbName = () => `dmujeres-swr-${Math.random().toString(36).slice(2)}`;

const createStore = (now = () => 1000) =>
  createLocalStore({
    idbFactory: createFakeIndexedDB(),
    dbName: dbName(),
    namespace: 'user:1',
    now,
  });

const liveNetwork = { getState: () => ({ state: NETWORK_STATES.LIVE }) };

describe('runLocalFirst: stale-while-revalidate', () => {
  it('muestra caché primero y luego el dato de red, persistiéndolo', async () => {
    let clock = 1000;
    const store = createStore(() => clock);
    await store.putMany('devices', [{ id: 1, name: 'cache' }]);
    clock = 5000;
    const events = [];
    const result = await runLocalFirst({
      type: 'devices',
      store,
      network: liveNetwork,
      fetcher: async () => [{ id: 1, name: 'red' }],
      onData: (payload) => events.push(payload),
      maxAgeMs: 2000,
      now: () => clock,
    });
    assert.equal(events.length, 2);
    assert.equal(events[0].source, 'cache');
    assert.equal(events[0].records[0].name, 'cache');
    assert.equal(events[0].updatedAt, 1000);
    assert.equal(events[0].stale, true);
    assert.equal(events[1].source, 'network');
    assert.equal(events[1].records[0].name, 'red');
    assert.equal(events[1].updatedAt, 5000);
    assert.equal(result.ok, true);
    assert.equal(result.fromCache, false);
    assert.equal((await store.getAll('devices'))[0].name, 'red');
    assert.equal((await store.getMeta('devices')).updatedAt, 5000);
  });

  it('si la red falla conserva la caché y reporta el error', async () => {
    const store = createStore();
    await store.putMany('devices', [{ id: 1, name: 'cache' }]);
    const events = [];
    const result = await runLocalFirst({
      type: 'devices',
      store,
      network: liveNetwork,
      fetcher: async () => {
        throw new Error('sin servidor');
      },
      onData: (payload) => events.push(payload),
      now: () => 9000,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].source, 'cache');
    assert.equal(result.ok, true);
    assert.equal(result.fromCache, true);
    assert.equal(result.stale, true);
    assert.equal(result.error.message, 'sin servidor');
    assert.equal((await store.getAll('devices'))[0].name, 'cache');
  });

  it('sin red y sin caché no inventa datos (estado vacío honesto)', async () => {
    const store = createStore();
    const events = [];
    const result = await runLocalFirst({
      type: 'devices',
      store,
      network: liveNetwork,
      fetcher: async () => {
        throw new Error('sin servidor');
      },
      onData: (payload) => events.push(payload),
    });
    assert.equal(events.length, 0);
    assert.equal(result.ok, false);
    assert.deepEqual(result.records, []);
    assert.equal(result.updatedAt, null);
    assert.ok(result.error);
  });

  it('OFFLINE no dispara fetch y sirve lo cacheado', async () => {
    const store = createStore();
    await store.putMany('positions', [{ id: 1, latitude: 1 }]);
    let fetched = false;
    const events = [];
    const result = await runLocalFirst({
      type: 'positions',
      store,
      network: { getState: () => ({ state: NETWORK_STATES.OFFLINE }) },
      fetcher: async () => {
        fetched = true;
        return [{ id: 2 }];
      },
      onData: (payload) => events.push(payload),
    });
    assert.equal(fetched, false);
    assert.equal(result.skippedNetwork, true);
    assert.equal(result.ok, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, 'cache');
  });

  it('normalize permite fuentes con forma propia (p. ej. motion)', async () => {
    const store = createStore();
    const events = [];
    const result = await runLocalFirst({
      type: 'motion',
      store,
      network: liveNetwork,
      fetcher: async () => ({ 5: [{ type: 'moving' }] }),
      normalize: (value) => Object.entries(value).map(([id, segments]) => ({ id, segments })),
      onData: (payload) => events.push(payload),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(events[0].records, [{ id: '5', segments: [{ type: 'moving' }] }]);
    assert.deepEqual(await store.getAll('motion'), [{ id: '5', segments: [{ type: 'moving' }] }]);
  });

  it('marca y desmarca el refresco en el store', async () => {
    const store = createStore();
    const calls = [];
    const original = store.setRefreshing;
    store.setRefreshing = (type, flag) => {
      calls.push([type, flag]);
      original(type, flag);
    };
    await runLocalFirst({
      type: 'devices',
      store,
      network: liveNetwork,
      fetcher: async () => [],
    });
    assert.deepEqual(calls, [
      ['devices', true],
      ['devices', false],
    ]);
  });

  it('si IndexedDB no está disponible, el dato de red sigue visible', async () => {
    const store = createLocalStore({ idbFactory: undefined });
    const events = [];
    const result = await runLocalFirst({
      type: 'devices',
      store,
      network: liveNetwork,
      fetcher: async () => [{ id: 1 }],
      onData: (payload) => events.push(payload),
    });
    assert.equal(result.ok, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, 'network');
  });
});
