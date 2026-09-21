/**
 * Núcleo puro (sin React) del patrón stale-while-revalidate:
 * 1. Si hay caché local, se entrega de inmediato con su `updatedAt`.
 * 2. Si la red no está caída, se refresca desde la fuente REST.
 * 3. Éxito -> se persiste en LocalStore y se entrega dato fresco.
 *    Fallo  -> se conserva la caché y se informa el error (sin inventar datos).
 *
 * `runLocalFirst` es inyectable (store/network/fetcher/now) para tests deterministas;
 * `useLocalFirst` es el envoltorio React que sincroniza namespace y aborta al desmontar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import localStore, { isStale, namespaceForUser } from './localStore.js';
import networkState, { NETWORK_STATES } from './networkState.js';

const defaultNormalize = (value) => {
  if (!Array.isArray(value)) {
    throw new Error('La fuente local-first debe devolver un array de registros');
  }
  return value;
};

export const runLocalFirst = async ({
  type,
  fetcher,
  onData,
  store = localStore,
  network = networkState,
  signal,
  maxAgeMs = 60_000,
  now = Date.now,
  normalize = defaultNormalize,
} = {}) => {
  let cached = [];
  let cachedAt = null;
  try {
    const meta = await store.getMeta(type);
    cached = await store.getAll(type);
    cachedAt = meta?.updatedAt ?? null;
  } catch {
    // Sin caché disponible: se decide más abajo (red o estado vacío honesto).
  }
  const stale = isStale(cachedAt, { now: now(), maxAgeMs });
  if (cached.length > 0) {
    onData?.({ records: cached, source: 'cache', updatedAt: cachedAt, stale });
  }

  const currentNetwork = network?.getState?.().state;
  if (currentNetwork === NETWORK_STATES.OFFLINE) {
    return {
      ok: cached.length > 0,
      fromCache: cached.length > 0,
      records: cached,
      updatedAt: cachedAt,
      stale,
      skippedNetwork: true,
      error: null,
    };
  }

  try {
    store.setRefreshing?.(type, true);
    const response = await fetcher({ signal });
    if (signal?.aborted) {
      return {
        ok: false,
        aborted: true,
        fromCache: cached.length > 0,
        records: cached,
        updatedAt: cachedAt,
        stale,
        skippedNetwork: false,
        error: null,
      };
    }
    const records = normalize(response);
    try {
      await store.putMany(type, records, { replace: true });
    } catch {
      // La caché no está disponible (p. ej. IndexedDB bloqueado); el dato de red sigue siendo válido.
    }
    const freshAt = now();
    onData?.({ records, source: 'network', updatedAt: freshAt, stale: false });
    return {
      ok: true,
      fromCache: false,
      records,
      updatedAt: freshAt,
      stale: false,
      skippedNetwork: false,
      error: null,
    };
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) {
      return {
        ok: false,
        aborted: true,
        fromCache: cached.length > 0,
        records: cached,
        updatedAt: cachedAt,
        stale,
        skippedNetwork: false,
        error: null,
      };
    }
    return {
      ok: cached.length > 0,
      fromCache: true,
      records: cached,
      updatedAt: cachedAt,
      stale: true,
      skippedNetwork: false,
      error,
    };
  } finally {
    store.setRefreshing?.(type, false);
  }
};

const useLocalFirst = ({
  type,
  fetcher,
  onData,
  enabled = true,
  maxAgeMs = 60_000,
  normalize,
} = {}) => {
  const user = useSelector((state) => state.session.user);
  const namespace = namespaceForUser(user);
  const [result, setResult] = useState({
    status: 'idle',
    updatedAt: null,
    stale: true,
    skippedNetwork: false,
    error: null,
  });
  const [refreshToken, setRefreshToken] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const normalizeRef = useRef(normalize);
  normalizeRef.current = normalize;

  useEffect(() => {
    localStore.syncSession(user);
  }, [user]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const controller = new AbortController();
    setResult((previous) => ({ ...previous, status: 'loading' }));
    runLocalFirst({
      type,
      signal: controller.signal,
      maxAgeMs,
      normalize: normalizeRef.current,
      fetcher: (options) => fetcherRef.current(options),
      store: localStore,
      network: networkState,
      onData: (payload) => {
        setResult({
          status: payload.source === 'cache' ? 'cache' : 'ready',
          updatedAt: payload.updatedAt,
          stale: Boolean(payload.stale),
          skippedNetwork: false,
          error: null,
        });
        onDataRef.current?.(payload);
      },
    })
      .then((outcome) => {
        if (!outcome || outcome.aborted) {
          return;
        }
        setResult({
          status: outcome.ok ? 'ready' : 'error',
          updatedAt: outcome.updatedAt,
          stale: Boolean(outcome.stale),
          skippedNetwork: Boolean(outcome.skippedNetwork),
          error: outcome.error ?? null,
        });
      })
      .catch((error) => {
        setResult((previous) => ({ ...previous, status: 'error', error }));
      });
    return () => controller.abort();
  }, [type, namespace, enabled, maxAgeMs, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  return { ...result, namespace, refresh };
};

export default useLocalFirst;
