/**
 * Puente de escritura/lectura entre Redux y LocalStore. NO se toca el store global:
 * la app sigue igual y el integrador llama a esta API.
 *
 * Escritura (tiempo real / REST):
 *   writeThrough(dispatch, 'devices', devices)      // Redux devices/update + cache
 *   writeThrough(dispatch, 'positions', positions)  // Redux session/updatePositions + cache
 *   writeThrough(dispatch, 'events', events)        // Redux events/add + cache
 *   writeThrough(dispatch, 'motion', motionMap)     // Redux motion/set + cache
 *   writeThrough(dispatch, 'health', rows)          // solo cache (derivado, sin slice)
 *   writeThrough(dispatch, 'continuity', entries)   // solo cache (derivado, sin slice)
 *   Con `{ mode: 'replace' }` se usa el refresh correspondiente y se reemplaza la caché.
 *
 * Lectura (hidratación stale-while-revalidate):
 *   await hydrate(dispatch, 'devices')  // pinta caché en Redux al instante
 *   await hydrateAll(dispatch)
 *
 * Sesión: `syncSession(user)` cambia el namespace y limpia el anterior en logout.
 *
 * Integración WebSocket sin tocar el store: en SocketController.jsx (líneas 152-166)
 * sustituir `dispatch(devicesActions.update(data.devices))` por
 * `writeThrough(dispatch, 'devices', data.devices)`, etc. El dispatch se hace aquí.
 */
import localStore, { LOCAL_STORE_TYPES } from './localStore.js';

export { LOCAL_STORE_TYPES };

export const DEFAULT_WRITE_MODES = Object.freeze({
  devices: 'merge',
  positions: 'merge',
  events: 'merge',
  motion: 'replace',
  health: 'replace',
  continuity: 'replace',
});

export const normalizeForCache = (type, records) => {
  if (type === 'motion' && records && !Array.isArray(records)) {
    return Object.entries(records).map(([deviceId, segments]) => ({ id: deviceId, segments }));
  }
  if (Array.isArray(records)) {
    return records;
  }
  return Object.values(records || {});
};

export const toReduxShape = (type, records) => {
  if (type === 'motion') {
    return Object.fromEntries(records.map((row) => [row.id, row.segments]));
  }
  if (type === 'events') {
    return [...records].sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));
  }
  return records;
};

let defaultActionsPromise;

const loadDefaultActions = () => {
  if (!defaultActionsPromise) {
    defaultActionsPromise = import('../../store/index.js').then((store) => ({
      devices: {
        merge: (records) => store.devicesActions.update(records),
        replace: (records) => store.devicesActions.refresh(records),
      },
      positions: {
        merge: (records) => store.sessionActions.updatePositions(records),
      },
      events: {
        merge: (records) => store.eventsActions.add(records),
        replace: (records) => store.eventsActions.refresh(records),
      },
      motion: {
        replace: (records) => store.motionActions.set(records),
      },
      health: {},
      continuity: {},
    }));
  }
  return defaultActionsPromise;
};

const assertType = (type) => {
  if (!LOCAL_STORE_TYPES.includes(type)) {
    throw new Error(`Tipo local desconocido: ${type}`);
  }
};

/**
 * UI -> Redux -> LocalStore. `dispatch` es el de react-redux; `actions` permite
 * inyectar action creators (tests) y evita cargar el store global en Node.
 */
export const writeThrough = async (dispatch, type, records, options = {}) => {
  assertType(type);
  if (typeof dispatch !== 'function') {
    throw new Error('writeThrough requiere dispatch');
  }
  const store = options.store || localStore;
  const mode = options.mode || DEFAULT_WRITE_MODES[type];
  const actions = options.actions || (await loadDefaultActions());
  const creators = actions[type] || {};
  const creator = creators[mode] || creators.merge || creators.replace;
  if (creator) {
    dispatch(creator(records));
  }
  return store.putMany(type, normalizeForCache(type, records), {
    replace: options.replace ?? mode === 'replace',
  });
};

/** Caché -> Redux (sin red). Devuelve los registros cacheados. */
export const hydrate = async (dispatch, type, options = {}) => {
  assertType(type);
  const store = options.store || localStore;
  const cached = await store.getAll(type);
  if (cached.length > 0) {
    const actions = options.actions || (await loadDefaultActions());
    const creators = actions[type] || {};
    const creator = creators.replace || creators.merge;
    if (creator) {
      dispatch(creator(toReduxShape(type, cached)));
    }
  }
  return cached;
};

export const hydrateAll = async (dispatch, options = {}) => {
  const result = {};
  for (const type of LOCAL_STORE_TYPES) {
    result[type] = await hydrate(dispatch, type, options);
  }
  return result;
};

export const readCache = (type) => localStore.getAll(type);

export const putCache = (type, records, options) => localStore.putMany(type, records, options);

export const syncSession = (user) => localStore.syncSession(user);

export const clearUser = (namespace) => localStore.clearUser(namespace);
