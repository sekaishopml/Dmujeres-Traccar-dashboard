/**
 * Fake mínimo de IndexedDB para tests en Node (no hay polyfill en el proyecto).
 * Implementa el subconjunto que usa `localStore`: open/upgrade, object stores
 * con keyPath, índices por `namespace`, put/get/delete/clear/getAll/getAllKeys/count
 * y transacciones con oncomplete. Solo para tests: no se importa desde la app.
 */
const clone = (value) =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const makeRequest = (produce, settle) => {
  const request = { result: undefined, error: null };
  let successHandler = null;
  let errorHandler = null;
  Object.defineProperty(request, 'onsuccess', {
    get: () => successHandler,
    set: (handler) => {
      successHandler = handler;
    },
    configurable: true,
  });
  Object.defineProperty(request, 'onerror', {
    get: () => errorHandler,
    set: (handler) => {
      errorHandler = handler;
    },
    configurable: true,
  });
  queueMicrotask(() => {
    try {
      request.result = produce();
      settle?.();
      successHandler?.({ target: request });
    } catch (error) {
      request.error = error;
      settle?.();
      errorHandler?.({ target: request });
    }
  });
  return request;
};

export const createFakeIndexedDB = () => {
  const databases = new Map();

  const namespaceRows = (data, keyPath, key) =>
    [...data.records.entries()].filter(([, row]) => row[keyPath] === key);

  const wrapStore = (data, track) => ({
    keyPath: data.keyPath,
    put: (value) =>
      track(() => {
        const recordKey = value[data.keyPath];
        if (recordKey === undefined) {
          throw new Error(`Falta la clave ${data.keyPath}`);
        }
        data.records.set(recordKey, clone(value));
        return recordKey;
      }),
    get: (key) => track(() => data.records.get(key)),
    delete: (key) =>
      track(() => {
        data.records.delete(key);
        return undefined;
      }),
    clear: () =>
      track(() => {
        data.records.clear();
        return undefined;
      }),
    index: (name) => {
      const index = data.indexes.get(name);
      if (!index) {
        throw new Error(`Índice inexistente: ${name}`);
      }
      const { keyPath } = index;
      return {
        getAll: (key) =>
          track(() => namespaceRows(data, keyPath, key).map(([, row]) => clone(row))),
        getAllKeys: (key) =>
          track(() => namespaceRows(data, keyPath, key).map(([recordKey]) => recordKey)),
        count: (key) => track(() => namespaceRows(data, keyPath, key).length),
      };
    },
  });

  const createTransaction = (db) => {
    let pending = 0;
    let completionScheduled = false;
    const settle = () => {
      pending -= 1;
      if (pending === 0 && !completionScheduled) {
        completionScheduled = true;
        setTimeout(() => {
          completionScheduled = false;
          if (pending === 0) {
            tx.oncomplete?.();
          }
        }, 0);
      }
    };
    const track = (produce) => {
      pending += 1;
      return makeRequest(produce, settle);
    };
    const tx = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      error: null,
      objectStore: (name) => {
        const data = db.stores.get(name);
        if (!data) {
          throw new Error(`Object store fuera de transacción: ${name}`);
        }
        return wrapStore(data, track);
      },
      abort: () => tx.onabort?.(),
    };
    return tx;
  };

  return {
    open: (name, version = 1) => {
      const request = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        try {
          let db = databases.get(name);
          const needsUpgrade = !db || db.version < version;
          if (!db) {
            const stores = new Map();
            db = {
              name,
              version,
              stores,
              close: () => {},
              objectStoreNames: {
                get length() {
                  return stores.size;
                },
                contains: (storeName) => stores.has(storeName),
                [Symbol.iterator]: () => stores.keys(),
              },
              createObjectStore: (storeName, options = {}) => {
                if (stores.has(storeName)) {
                  throw new Error(`Object store ya existe: ${storeName}`);
                }
                const data = { records: new Map(), keyPath: options.keyPath, indexes: new Map() };
                stores.set(storeName, data);
                return {
                  createIndex: (indexName, indexKeyPath) => {
                    data.indexes.set(indexName, { name: indexName, keyPath: indexKeyPath });
                    return { name: indexName, keyPath: indexKeyPath };
                  },
                };
              },
              transaction: (storeNames) => {
                const names = Array.isArray(storeNames) ? storeNames : [storeNames];
                names.forEach((storeName) => {
                  if (!stores.has(storeName)) {
                    throw new Error(`Object store inexistente: ${storeName}`);
                  }
                });
                return createTransaction(db);
              },
            };
            databases.set(name, db);
          }
          if (needsUpgrade) {
            db.version = version;
          }
          request.result = db;
          if (needsUpgrade) {
            request.onupgradeneeded?.({ target: request });
            if (request.error) {
              return;
            }
          }
          request.onsuccess?.({ target: request });
        } catch (error) {
          request.error = error;
          request.onerror?.({ target: request });
        }
      });
      return request;
    },
    deleteDatabase: (name) => {
      databases.delete(name);
      return makeRequest(() => undefined);
    },
  };
};

export default createFakeIndexedDB;
