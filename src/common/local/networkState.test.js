/**
 * Tests deterministas de la máquina de red: derivación pura, probe HTTP,
 * WebSocket, navegador offline y backoff de reconexión (función pura).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBackoffDelay,
  createNetworkState,
  deriveNetworkState,
  NETWORK_STATES,
} from './networkState.js';

const makeTimers = () => {
  const captured = new Map();
  let id = 0;
  return {
    setTimer: (fn, delay) => {
      id += 1;
      captured.set(id, { fn, delay });
      return id;
    },
    clearTimer: (timer) => captured.delete(timer),
    delays: () => [...captured.values()].map((entry) => entry.delay),
    runLast: () => {
      const entries = [...captured.entries()];
      const [timerId, entry] = entries[entries.length - 1];
      captured.delete(timerId);
      return entry.fn();
    },
  };
};

describe('networkState: derivación pura', () => {
  it('sin red del navegador siempre OFFLINE', () => {
    assert.equal(
      deriveNetworkState({ online: false, httpReachable: true, wsConnected: true }),
      NETWORK_STATES.OFFLINE,
    );
  });

  it('servidor sin responder -> RECONNECTING, nunca LIVE', () => {
    assert.equal(
      deriveNetworkState({ online: true, httpReachable: false, wsConnected: true }),
      NETWORK_STATES.RECONNECTING,
    );
  });

  it('contacto HTTP sin WebSocket -> DEGRADED', () => {
    assert.equal(
      deriveNetworkState({ online: true, httpReachable: true, wsConnected: null }),
      NETWORK_STATES.DEGRADED,
    );
    assert.equal(
      deriveNetworkState({ online: true, httpReachable: true, wsConnected: false }),
      NETWORK_STATES.DEGRADED,
    );
  });

  it('HTTP + WebSocket -> LIVE', () => {
    assert.equal(
      deriveNetworkState({ online: true, httpReachable: true, wsConnected: true }),
      NETWORK_STATES.LIVE,
    );
  });

  it('sin probe todavía -> RECONNECTING (conservador)', () => {
    assert.equal(
      deriveNetworkState({ online: true, httpReachable: null, wsConnected: false }),
      NETWORK_STATES.RECONNECTING,
    );
  });
});

describe('networkState: backoff de reconexión', () => {
  it('crece exponencialmente', () => {
    assert.equal(computeBackoffDelay(0), 1000);
    assert.equal(computeBackoffDelay(1), 2000);
    assert.equal(computeBackoffDelay(2), 4000);
    assert.equal(computeBackoffDelay(3), 8000);
  });

  it('queda acotado por maxMs', () => {
    assert.equal(computeBackoffDelay(12, { maxMs: 30_000 }), 30_000);
    assert.equal(computeBackoffDelay(-3), 1000);
  });

  it('jitter determinista con random inyectado', () => {
    assert.equal(computeBackoffDelay(0, { jitter: 0.2, random: () => 0 }), 1000);
    assert.equal(computeBackoffDelay(0, { jitter: 0.2, random: () => 1 }), 1200);
    assert.equal(computeBackoffDelay(12, { jitter: 0.2, random: () => 1 }), 30_000);
  });
});

describe('networkState: máquina de estados', () => {
  it('probe fallido programa reintentos con backoff (1s, 2s, 4s)', async () => {
    const timers = makeTimers();
    const calls = [];
    const network = createNetworkState({
      online: true,
      probeTimeoutMs: 100_000,
      fetchFn: async (url) => {
        calls.push(url);
        throw new Error('servidor caído');
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      jitter: 0,
    });
    network.start();
    await network.probeNow();
    assert.equal(network.getState().state, NETWORK_STATES.RECONNECTING);
    assert.equal(calls[0], '/api/session');
    assert.deepEqual(timers.delays(), [1000]);

    timers.runLast();
    await network.probeNow();
    assert.deepEqual(timers.delays(), [2000]);

    timers.runLast();
    await network.probeNow();
    assert.deepEqual(timers.delays(), [4000]);
    network.stop();
  });

  it('navegador offline -> OFFLINE y sin probes', async () => {
    const timers = makeTimers();
    let fetches = 0;
    const network = createNetworkState({
      online: false,
      fetchFn: async () => {
        fetches += 1;
        return { status: 200 };
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    network.start();
    assert.equal(network.getState().state, NETWORK_STATES.OFFLINE);
    assert.equal(fetches, 0);
    network.setOnline(true);
    assert.equal(network.getState().state, NETWORK_STATES.RECONNECTING);
    await network.probeNow();
    assert.equal(fetches, 1);
    network.stop();
  });

  it('probe OK sin WebSocket -> DEGRADED; WebSocket abre -> LIVE; cierra -> DEGRADED', async () => {
    const timers = makeTimers();
    const network = createNetworkState({
      online: true,
      fetchFn: async () => ({ status: 200 }),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      jitter: 0,
    });
    network.start();
    await network.probeNow();
    assert.equal(network.getState().state, NETWORK_STATES.DEGRADED);
    assert.deepEqual(timers.delays(), [30_000]);

    network.setSocket(true);
    assert.equal(network.getState().state, NETWORK_STATES.LIVE);

    network.setSocket(false);
    assert.equal(network.getState().state, NETWORK_STATES.DEGRADED);
    network.stop();
  });

  it('WebSocket abierto es evidencia de contacto (LIVE sin probe previo)', () => {
    const network = createNetworkState({ online: true, fetchFn: async () => ({ status: 200 }) });
    network.setSocket(true);
    assert.equal(network.getState().state, NETWORK_STATES.LIVE);
    assert.equal(network.getState().httpReachable, true);
  });

  it('HTTP 5xx se trata como servidor no disponible', async () => {
    const timers = makeTimers();
    const network = createNetworkState({
      online: true,
      fetchFn: async () => ({ status: 503 }),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      jitter: 0,
    });
    network.start();
    await network.probeNow();
    assert.equal(network.getState().state, NETWORK_STATES.RECONNECTING);
    network.stop();
  });

  it('un 401 del probe sigue siendo servidor alcanzable', async () => {
    const timers = makeTimers();
    const network = createNetworkState({
      online: true,
      fetchFn: async () => ({ status: 401 }),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    network.start();
    await network.probeNow();
    assert.equal(network.getState().httpReachable, true);
    network.stop();
  });

  it('al recuperar el éxito el intento vuelve a cero', async () => {
    const timers = makeTimers();
    let failing = true;
    const network = createNetworkState({
      online: true,
      fetchFn: async () => {
        if (failing) throw new Error('caído');
        return { status: 200 };
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      jitter: 0,
    });
    network.start();
    await network.probeNow();
    assert.equal(network.getState().attempt, 1);
    failing = false;
    timers.runLast();
    await network.probeNow();
    assert.equal(network.getState().attempt, 0);
    assert.equal(network.getState().httpReachable, true);
    network.stop();
  });
});
