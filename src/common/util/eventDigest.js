/**
 * R9: digestor de eventos para la página "Eventos" del panel.
 *
 * La empresa solo quiere ver en la lista de eventos:
 *  - inicio y cierre de JORNADA,
 *  - PROBLEMAS DE CONEXIÓN (desde qué hora hasta qué hora),
 *  - actualización de la app (nueva versión instalada),
 *  - toque del botón "Actualizar" (OTA manual).
 *
 * Todo lo demás (stalled, diagnósticos, flips de presencia, deviceOnline…)
 * se descarta. Los pares suspect→recovered se fusionan en UNA fila
 * `mobileConnectionProblem` con el rango desde/hasta.
 *
 * Funciones puras (Node/JVM) para poder probar la regla sin la UI.
 */

export const EVENT_TYPES = new Set([
  'mobileJourneyStarted',
  'mobileJourneyEnded',
  'mobileConnectionProblem',
  'mobileAppUpdated',
  'mobileOtaManual',
]);

export const eventTimeOf = (event) => new Date(event.eventTime).getTime();

/** Empareja y filtra los eventos crudos del servidor. */
export const processEvents = (events) => {
  const sorted = [...(events || [])].sort(
    (a, b) => new Date(a.eventTime) - new Date(b.eventTime),
  );
  const result = [];
  const openSuspect = {};

  for (const event of sorted) {
    switch (event.type) {
      case 'mobileJourneyStarted':
      case 'mobileJourneyEnded':
      case 'mobileAppUpdated':
      case 'mobileOtaManual':
        result.push(event);
        break;
      case 'mobilePresenceSuspect':
        openSuspect[event.deviceId] = event;
        break;
      case 'mobilePresenceRecovered': {
        const suspect = openSuspect[event.deviceId];
        if (suspect) {
          result.push({
            ...suspect,
            id: `${suspect.id}-problem-${event.id}`,
            originalId: suspect.id,
            type: 'mobileConnectionProblem',
            attributes: {
              ...(suspect.attributes || {}),
              since: new Date(suspect.eventTime).getTime(),
              until: new Date(event.eventTime).getTime(),
            },
          });
          delete openSuspect[event.deviceId];
        }
        // Recovered sin suspect previo: se ignora (ruido).
        break;
      }
      default:
        // Todo lo demás (stalled, diagnostics, flips de device) se descarta.
        break;
    }
  }

  // Suspects sin recuperación: problema ABIERTO (aún sin conexión).
  for (const suspect of Object.values(openSuspect)) {
    result.push({
      ...suspect,
      id: `${suspect.id}-open`,
      originalId: suspect.id,
      type: 'mobileConnectionProblem',
      attributes: {
        ...(suspect.attributes || {}),
        since: new Date(suspect.eventTime).getTime(),
        until: null,
      },
    });
  }

  result.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));
  return result;
};
