/**
 * Cache local-first de LECTURA sobre IndexedDB nativo (sin dependencias nuevas).
 *
 * Reglas de diseño:
 * - Nunca se persisten credenciales: password/token/sesión se eliminan al escribir.
 * - Namespacing por usuario autenticado: cada fila y cada meta llevan `namespace`
 *   ("user:<id>" o "anon"). La identidad se deriva de `state.session.user`; solo
 *   se usa el `id`, jamás el usuario completo.
 * - Cada tipo tiene su object store con `updatedAt` por escritura, para poder
 *   mostrar "Última actualización HH:MM" y decidir si el dato está stale.
 * - `idbFactory` es inyectable para poder testear con un fake en Node.
 */
export const LOCAL_STORE_TYPES = Object.freeze([
  'devices',
  'positions',
  'health',
  'events',
  'motion',
  'continuity',
]);

export const ANONYMOUS_NAMESPACE = 'anon';
export const META_STORE = '__meta';
export const DB_NAME = 'dmujeres-local-first';
export const DB_VERSION = 1;

const FORBIDDEN_KEYS = new Set([
  'password',
  'oldpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'session',
  'sessionid',
  'authorization',
  'credentials',
  'cookie',
]);

/** Namespace derivado de la sesión: solo el id, nunca credenciales. */
export const namespaceForUser = (user) => {
  const id = user?.id;
  if (id === undefined || id === null || id === '') {
    return ANONYMOUS_NAMESPACE;
  }
  return `user:${String(id)}`;
};

const sanitizeValue = (value, depth = 0) => {
  if (value == null) {
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (depth > 8) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  const clean = {};
  Object.keys(value).forEach((key) => {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      return;
    }
    const sanitized = sanitizeValue(value[key], depth + 1);
    if (sanitized !== undefined) {
      clean[key] = sanitized;
    }
  });
  return clean;
};

/** Identidad estable de un registro dentro de su tipo. */
export const recordId = (record, index = 0) => {
  if (record && record.id !== undefined && record.id !== null) {
    return String(record.id);
  }
  if (record && record.deviceId !== undefined && record.deviceId !== null) {
    if (record.fixTime) {
      return `${record.deviceId}:${record.fixTime}`;
    }
    return String(record.deviceId);
  }
  if (record && record.journeyId !== undefined && record.journeyId !== null) {
    return String(record.journeyId);
  }
  return `idx:${index}`;
};

/** ¿El dato cacheado supera la edad máxima aceptada? Sin timestamp válido: stale. */
export const isStale = (updatedAt, { now = Date.now(), maxAgeMs = 60_000 } = {}) => {
  const time = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt);
  if (!Number.isFinite(time)) {
    return true;
  }
  return now - time > maxAgeMs;
};

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });

const transactionToPromise = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });

const assertType = (type) => {
  if (!LOCAL_STORE_TYPES.includes(type)) {
    throw new Error(`Tipo local desconocido: ${type}`);
  }
};

/**
 * Store local-first parametrizable. Uso normal: instancia por defecto `localStore`.
 * En tests: `createLocalStore({ idbFactory: createFakeIndexedDB(), namespace: 'user:7' })`.
 */
export const createLocalStore = ({
  idbFactory = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
  dbName = DB_NAME,
  namespace = ANONYMOUS_NAMESPACE,
  now = Date.now,
} = {}) => {
  let dbPromise;
  let currentNamespace = namespace;
  const listeners = new Set();
  const refreshing = new Set();

  const isAvailable = () => Boolean(idbFactory);

  const open = () => {
    if (!idbFactory) {
      return Promise.reject(new Error('IndexedDB no disponible en este entorno'));
    }
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = idbFactory.open(dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          LOCAL_STORE_TYPES.forEach((type) => {
            if (!db.objectStoreNames.contains(type)) {
              const store = db.createObjectStore(type, { keyPath: 'key' });
              store.createIndex('namespace', 'namespace', { unique: false });
            }
          });
          if (!db.objectStoreNames.contains(META_STORE)) {
            const meta = db.createObjectStore(META_STORE, { keyPath: 'key' });
            meta.createIndex('namespace', 'namespace', { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
      });
      dbPromise.catch(() => {
        dbPromise = undefined;
      });
    }
    return dbPromise;
  };

  const emit = (event) => {
    const payload = { namespace: currentNamespace, ...event };
    listeners.forEach((listener) => listener(payload));
  };

  const putMany = async (type, records, { replace = false } = {}) => {
    assertType(type);
    const list = Array.isArray(records) ? records : [];
    const db = await open();
    const ns = currentNamespace;
    const updatedAt = now();
    const tx = db.transaction([type, META_STORE], 'readwrite');
    const done = transactionToPromise(tx);
    const store = tx.objectStore(type);
    const metaStore = tx.objectStore(META_STORE);
    if (replace) {
      const keys = await requestToPromise(store.index('namespace').getAllKeys(ns));
      keys.forEach((key) => store.delete(key));
    }
    list.forEach((record, index) => {
      const id = recordId(record, index);
      store.put({
        key: `${ns}::${id}`,
        namespace: ns,
        type,
        id,
        updatedAt,
        record: sanitizeValue(record),
      });
    });
    const count = await requestToPromise(store.index('namespace').count(ns));
    metaStore.put({ key: `${ns}::${type}`, namespace: ns, type, updatedAt, count });
    await done;
    emit({ change: 'put', type, updatedAt, count });
    return { type, namespace: ns, updatedAt, count, written: list.length };
  };

  const getAll = async (type) => {
    assertType(type);
    const db = await open();
    const tx = db.transaction(type, 'readonly');
    const done = transactionToPromise(tx);
    const rows = await requestToPromise(
      tx.objectStore(type).index('namespace').getAll(currentNamespace),
    );
    await done;
    return rows.map((row) => row.record);
  };

  const getMeta = async (type) => {
    if (type) {
      assertType(type);
    }
    const db = await open();
    const tx = db.transaction(META_STORE, 'readonly');
    const done = transactionToPromise(tx);
    const store = tx.objectStore(META_STORE);
    if (type) {
      const row = await requestToPromise(store.get(`${currentNamespace}::${type}`));
      await done;
      return row
        ? { type: row.type, namespace: row.namespace, updatedAt: row.updatedAt, count: row.count }
        : null;
    }
    const rows = await requestToPromise(store.index('namespace').getAll(currentNamespace));
    await done;
    const meta = {};
    rows.forEach((row) => {
      meta[row.type] = {
        type: row.type,
        namespace: row.namespace,
        updatedAt: row.updatedAt,
        count: row.count,
      };
    });
    return meta;
  };

  /** Elimina todos los datos + meta de un namespace (logout o cambio de usuario). */
  const clearUser = async (target = currentNamespace) => {
    const db = await open();
    const stores = [...LOCAL_STORE_TYPES, META_STORE];
    const tx = db.transaction(stores, 'readwrite');
    const done = transactionToPromise(tx);
    stores.forEach((storeName) => {
      const store = tx.objectStore(storeName);
      const request = store.index('namespace').getAllKeys(target);
      request.onsuccess = () => {
        request.result.forEach((key) => store.delete(key));
      };
    });
    await done;
    emit({ change: 'clear', clearedNamespace: target });
  };

  const getNamespace = () => currentNamespace;

  const setNamespace = (next) => {
    const normalized = next || ANONYMOUS_NAMESPACE;
    if (normalized === currentNamespace) {
      return currentNamespace;
    }
    currentNamespace = normalized;
    emit({ change: 'namespace' });
    return currentNamespace;
  };

  /**
   * Sincroniza el namespace con la sesión Redux. Al pasar a anónimo (logout) o
   * cambiar de usuario, limpia el namespace anterior para no dejar datos ajenos.
   */
  const syncSession = (user) => {
    const next = namespaceForUser(user);
    if (next === currentNamespace) {
      return currentNamespace;
    }
    const previous = currentNamespace;
    currentNamespace = next;
    if (previous !== ANONYMOUS_NAMESPACE) {
      clearUser(previous).catch(() => {});
    }
    emit({ change: 'namespace' });
    return currentNamespace;
  };

  const setRefreshing = (type, flag) => {
    if (flag) {
      refreshing.add(type);
    } else {
      refreshing.delete(type);
    }
    emit({ change: 'refreshing', refreshing: refreshing.size > 0 });
  };

  const isRefreshing = () => refreshing.size > 0;

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const close = () => {
    if (dbPromise) {
      dbPromise.then((db) => db.close()).catch(() => {});
      dbPromise = undefined;
    }
  };

  return {
    isAvailable,
    open,
    putMany,
    getAll,
    getMeta,
    clearUser,
    getNamespace,
    setNamespace,
    syncSession,
    setRefreshing,
    isRefreshing,
    subscribe,
    close,
  };
};

const localStore = createLocalStore();

export default localStore;
