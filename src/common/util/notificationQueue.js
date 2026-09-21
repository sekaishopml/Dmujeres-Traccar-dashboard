/**
 * Sistema de notificaciones del panel (toasts de cambio de estado).
 *
 * Reglas de la empresa (CCTV):
 * - Máximo 3 notificaciones visibles a la vez.
 * - El resto espera en cola (máx 5); si la cola se desborda, se descarta la
 *   MÁS VIEJA de la cola (las visibles nunca se pisan).
 * - Cada notificación dura 5 s desde que se muestra (no desde que se encola).
 *
 * Funciones puras (test JVM/Node) para poder razonar la regla sin la UI.
 */
export const MAX_VISIBLE = 3;
export const QUEUE_LIMIT = 5;
export const NOTIFICATION_MS = 5000;

/** Agrega al final; si visible+cola desborda, descarta la más vieja de la cola. */
export const enqueueNotification = (list, item) => {
  const next = [...list, item];
  if (next.length > MAX_VISIBLE + QUEUE_LIMIT) {
    next.splice(MAX_VISIBLE, 1);
  }
  return next;
};

/** Quita una notificación por key (idempotente). */
export const removeNotification = (list, key) => list.filter((item) => item.key !== key);

/** Marca una notificación como saliendo (para la animación de salida). */
export const markExiting = (list, key) =>
  list.map((item) => (item.key === key ? { ...item, exiting: true } : item));

/** Las que se pintan (siempre las primeras, sin exceder el tope). */
export const visibleNotifications = (list) => list.slice(0, MAX_VISIBLE);

/** ¿Está en cola (aún no visible)? */
export const queuedCount = (list) => Math.max(0, list.length - MAX_VISIBLE);
