/**
 * Máquina de estados de red para el modo local-first.
 *
 * LIVE         contacto HTTP confirmado + WebSocket abierto (tiempo real real).
 * DEGRADED     contacto HTTP confirmado pero sin WebSocket (solo REST; sirve caché).
 * RECONNECTING navegador online pero el servidor no responde; reintento con backoff.
 * OFFLINE      navegador sin red (navigator.onLine === false).
 *
 * Reglas:
 * - `navigator.onLine` por sí solo no basta: se exige probe HTTP y/o WS abierto.
 * - Nunca se reporta LIVE en falso: sin confirmación de tiempo real -> DEGRADED.
 * - Reconexión con backoff exponencial acotado (no un timeout fijo de 60 s).
 * - Todo inyectable (fetch, timers, random) para tests deterministas.
 */
export const NETWORK_STATES = Object.freeze({
  LIVE: 'LIVE',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
  RECONNECTING: 'RECONNECTING',
});

/** Derivación pura del estado a partir de las señales disponibles. */
export const deriveNetworkState = ({
  online = true,
  httpReachable = null,
  wsConnected = null,
} = {}) => {
  if (!online) {
    return NETWORK_STATES.OFFLINE;
  }
  if (httpReachable === false) {
    return NETWORK_STATES.RECONNECTING;
  }
  if (httpReachable === true) {
    return wsConnected === true ? NETWORK_STATES.LIVE : NETWORK_STATES.DEGRADED;
  }
  return NETWORK_STATES.RECONNECTING;
};

/** Backoff exponencial acotado; jitter opcional y determinista vía `random`. */
export const computeBackoffDelay = (
  attempt,
  { baseMs = 1000, factor = 2, maxMs = 30_000, jitter = 0, random = Math.random } = {},
) => {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const exponential = Math.min(maxMs, baseMs * factor ** safeAttempt);
  const jitterMs = jitter > 0 ? Math.round(exponential * jitter * random()) : 0;
  return Math.min(maxMs, exponential + jitterMs);
};

const browserOnline = () => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);

export const createNetworkState = ({
  fetchFn = typeof fetch !== 'undefined' ? fetch : undefined,
  probeUrl = '/api/session',
  probeTimeoutMs = 5000,
  probeIntervalMs = 30_000,
  baseDelayMs = 1000,
  maxDelayMs = 30_000,
  jitter = 0.2,
  random = Math.random,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  online,
  onStateChange,
} = {}) => {
  let current = {
    state: deriveNetworkState({ online: online === undefined ? browserOnline() : Boolean(online) }),
    since: now(),
    online: online === undefined ? browserOnline() : Boolean(online),
    httpReachable: null,
    wsConnected: null,
    attempt: 0,
    lastProbeAt: null,
    lastSuccessAt: null,
    error: null,
    started: false,
  };
  let timer = null;
  let probePromise = null;
  const listeners = new Set();
  const readBrowserOnline = () => (online === undefined ? browserOnline() : Boolean(online));

  const snapshot = () => ({ ...current });

  const emit = () => {
    const state = snapshot();
    listeners.forEach((listener) => listener(state));
    onStateChange?.(state);
  };

  const update = (patch) => {
    const previous = current.state;
    current = { ...current, ...patch };
    const next = deriveNetworkState(current);
    current.state = next;
    if (next !== previous) {
      current.since = now();
    }
    emit();
  };

  const cancelScheduled = () => {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const schedule = (delay, task) => {
    cancelScheduled();
    timer = setTimer(() => {
      timer = null;
      task();
    }, delay);
  };

  const backoffOptions = () => ({
    baseMs: baseDelayMs,
    maxMs: maxDelayMs,
    jitter,
    random,
  });

  const runProbe = async ({ force = false } = {}) => {
    if (!current.started && !force) {
      return null;
    }
    if (probePromise) {
      return probePromise;
    }
    probePromise = (async () => {
      const startedAt = now();
      let reachable;
      let error = null;
      let status = null;
      try {
        if (!fetchFn) {
          throw new Error('fetch no disponible');
        }
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = setTimer(() => controller?.abort(), probeTimeoutMs);
        try {
          const response = await fetchFn(probeUrl, {
            method: 'GET',
            cache: 'no-store',
            signal: controller?.signal,
          });
          status = response?.status ?? null;
          reachable = response ? response.status < 500 : false;
        } finally {
          clearTimer(timeout);
        }
      } catch (probeError) {
        error = probeError;
        reachable = false;
      }
      if (!current.started && !force) {
        return null;
      }
      const attempt = reachable ? 0 : current.attempt + 1;
      update({
        httpReachable: reachable,
        attempt,
        lastProbeAt: startedAt,
        lastSuccessAt: reachable ? now() : current.lastSuccessAt,
        error: reachable ? null : error || new Error(`HTTP ${status}`),
      });
      if (current.started) {
        const delay = reachable
          ? probeIntervalMs
          : computeBackoffDelay(attempt - 1, backoffOptions());
        schedule(delay, () => runProbe());
      }
      return snapshot();
    })().finally(() => {
      probePromise = null;
    });
    return probePromise;
  };

  const handleBrowserOnline = () => {
    update({ online: true, httpReachable: null, error: null });
    runProbe();
  };

  const handleBrowserOffline = () => {
    cancelScheduled();
    update({ online: false, httpReachable: null });
  };

  const start = () => {
    if (current.started) {
      return;
    }
    current.started = true;
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', handleBrowserOnline);
      window.addEventListener('offline', handleBrowserOffline);
    }
    const onlineNow = readBrowserOnline();
    update({ online: onlineNow, httpReachable: null });
    if (onlineNow) {
      runProbe();
    }
  };

  const stop = () => {
    if (!current.started) {
      return;
    }
    current.started = false;
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
    }
    cancelScheduled();
  };

  const setOnline = (value) => {
    const next = Boolean(value);
    if (next === current.online) {
      return snapshot();
    }
    if (next) {
      update({ online: true, httpReachable: null, error: null });
      runProbe({ force: !current.started });
    } else {
      cancelScheduled();
      update({ online: false });
    }
    return snapshot();
  };

  /**
   * Estado del WebSocket (normalmente `state.session.socket` de Redux).
   * Un WS abierto es evidencia real de contacto con el servidor: habilita LIVE.
   */
  const setSocket = (value) => {
    const next = value === null || value === undefined ? null : Boolean(value);
    if (next === current.wsConnected) {
      return snapshot();
    }
    const patch = { wsConnected: next };
    if (next === true) {
      patch.httpReachable = true;
      patch.error = null;
      patch.attempt = 0;
      patch.lastSuccessAt = now();
    }
    update(patch);
    if (next === true && current.started && timer == null && !probePromise) {
      schedule(probeIntervalMs, () => runProbe());
    }
    return snapshot();
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    getState: snapshot,
    subscribe,
    start,
    stop,
    probeNow: () => runProbe({ force: true }),
    setOnline,
    setSocket,
  };
};

const networkState = createNetworkState();

export default networkState;
