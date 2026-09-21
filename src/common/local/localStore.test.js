/**
 * Tests deterministas de `localStore` sobre un fake de IndexedDB inyectado.
 * Cubre: write/read con updatedAt, upsert/replace, stale, namespace por usuario,
 * limpieza en logout, filtrado de credenciales y fallback sin IndexedDB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIndexedDB } from './fakeIdb.js';
import { ANONYMOUS_NAMESPACE, createLocalStore, isStale, namespaceForUser } from './localStore.js';

const dbName = () => `dmujeres-test-${Math.random().toString(36).slice(2)}`;

const createStore = (namespace = 'user:7', now = () => 1000) =>
  createLocalStore({ idbFactory: createFakeIndexedDB(), dbName: dbName(), namespace, now });

const waitFor = async (predicate, timeoutMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
};

describe('localStore: escritura y lectura', () => {
  it('putMany guarda registros y getMeta registra updatedAt y count', async () => {
    const store = createStore();
    await store.putMany('devices', [
      { id: 1, name: 'uno' },
      { id: 2, name: 'dos' },
    ]);
    const devices = await store.getAll('devices');
    assert.equal(devices.length, 2);
    assert.deepEqual(devices.map((device) => device.id).sort(), [1, 2]);
    const meta = await store.getMeta('devices');
    assert.equal(meta.updatedAt, 1000);
    assert.equal(meta.count, 2);
    const allMeta = await store.getMeta();
    assert.equal(allMeta.devices.count, 2);
    assert.equal(allMeta.positions, undefined);
  });

  it('upsert por id no duplica y replace reemplaza el snapshot', async () => {
    const store = createStore();
    await store.putMany('devices', [{ id: 1, name: 'viejo' }]);
    await store.putMany('devices', [{ id: 1, name: 'nuevo' }]);
    let devices = await store.getAll('devices');
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, 'nuevo');
    assert.equal((await store.getMeta('devices')).count, 1);

    await store.putMany('devices', [{ id: 1 }, { id: 2 }]);
    await store.putMany('devices', [{ id: 3 }], { replace: true });
    devices = await store.getAll('devices');
    assert.deepEqual(
      devices.map((device) => device.id),
      [3],
    );
    assert.equal((await store.getMeta('devices')).count, 1);
  });

  it('posiciones sin id usan deviceId+fixTime como clave', async () => {
    const store = createStore();
    await store.putMany('positions', [
      { deviceId: 5, fixTime: 'a', latitude: 1 },
      { deviceId: 5, fixTime: 'b', latitude: 2 },
    ]);
    assert.equal((await store.getAll('positions')).length, 2);
    await store.putMany('positions', [{ deviceId: 5, fixTime: 'a', latitude: 9 }]);
    const positions = await store.getAll('positions');
    assert.equal(positions.length, 2);
    assert.equal(positions.find((position) => position.fixTime === 'a').latitude, 9);
  });

  it('notifica a los subscribers en put y clear', async () => {
    const store = createStore();
    const changes = [];
    const unsubscribe = store.subscribe((event) => changes.push(event.change));
    await store.putMany('devices', [{ id: 1 }]);
    await store.clearUser('user:7');
    unsubscribe();
    assert.deepEqual(changes, ['put', 'clear']);
  });

  it('sin idbFactory rechaza con error explícito (estado honesto)', async () => {
    const store = createLocalStore({ idbFactory: undefined });
    assert.equal(store.isAvailable(), false);
    await assert.rejects(() => store.getAll('devices'));
    await assert.rejects(() => store.putMany('devices', [{ id: 1 }]));
  });
});

describe('localStore: stale y timestamps', () => {
  it('isStale compara contra now y maxAgeMs', () => {
    assert.equal(isStale(1000, { now: 1400, maxAgeMs: 500 }), false);
    assert.equal(isStale(1000, { now: 1600, maxAgeMs: 500 }), true);
    assert.equal(isStale(null, { now: 1600, maxAgeMs: 500 }), true);
    assert.equal(isStale('no-es-fecha', { now: 1600, maxAgeMs: 500 }), true);
  });
});

describe('localStore: namespacing por usuario', () => {
  it('namespaceForUser usa solo el id y cae a anon sin sesión', () => {
    assert.equal(namespaceForUser({ id: 42, password: 'x' }), 'user:42');
    assert.equal(namespaceForUser(null), ANONYMOUS_NAMESPACE);
    assert.equal(namespaceForUser({}), ANONYMOUS_NAMESPACE);
  });

  it('dos usuarios en la misma DB no se ven entre sí', async () => {
    const idbFactory = createFakeIndexedDB();
    const name = dbName();
    const userA = createLocalStore({ idbFactory, dbName: name, namespace: 'user:1' });
    const userB = createLocalStore({ idbFactory, dbName: name, namespace: 'user:2' });
    await userA.putMany('devices', [{ id: 'a' }]);
    assert.equal((await userB.getAll('devices')).length, 0);
    await userB.putMany('devices', [{ id: 'b' }]);
    await userA.clearUser('user:1');
    assert.equal((await userA.getAll('devices')).length, 0);
    assert.deepEqual(
      (await userB.getAll('devices')).map((device) => device.id),
      ['b'],
    );
  });

  it('syncSession cambia namespace y limpia el anterior al hacer logout', async () => {
    const idbFactory = createFakeIndexedDB();
    const name = dbName();
    const store = createLocalStore({ idbFactory, dbName: name, namespace: ANONYMOUS_NAMESPACE });
    const reader = createLocalStore({ idbFactory, dbName: name, namespace: 'user:7' });

    await store.putMany('devices', [{ id: 'anon' }]);
    store.syncSession({ id: 7, password: 'no-se-guarda' });
    assert.equal(store.getNamespace(), 'user:7');
    await store.putMany('devices', [{ id: 'u7' }]);
    assert.equal((await reader.getAll('devices')).length, 1);

    store.syncSession(null);
    assert.equal(store.getNamespace(), ANONYMOUS_NAMESPACE);
    assert.equal(await waitFor(async () => (await reader.getAll('devices')).length === 0), true);
    assert.deepEqual(
      (await store.getAll('devices')).map((device) => device.id),
      ['anon'],
    );
  });
});

describe('localStore: seguridad', () => {
  it('nunca persiste password/token/sesión, ni anidados', async () => {
    const store = createStore();
    await store.putMany('devices', [
      {
        id: 1,
        name: 'visible',
        token: 'secreto',
        password: 'secreto',
        session: { token: 'secreto' },
        attributes: {
          authorization: 'Bearer secreto',
          mobile: { token: 'secreto', speed: 3 },
        },
      },
    ]);
    const [device] = await store.getAll('devices');
    assert.equal(device.name, 'visible');
    assert.equal(device.token, undefined);
    assert.equal(device.password, undefined);
    assert.equal(device.session, undefined);
    assert.equal(device.attributes.authorization, undefined);
    assert.equal(device.attributes.mobile.token, undefined);
    assert.equal(device.attributes.mobile.speed, 3);
  });
});
