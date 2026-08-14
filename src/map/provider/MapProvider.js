/**
 * MapProvider — abstracción sobre los proveedores de mapas.
 *
 * El dashboard consume siempre esta API y nunca depende de un proveedor concreto.
 * El proveedor activo se elige por configuración (atributo `activeMapStyles` y
 * preferencia `map`), nunca por hardcoding.
 *
 * Decisión del cliente (D-015): Google Maps se ofrece siempre — con API key legítima
 * cuando existe, y sin key mediante los tiles clásicos `mt0-3.google.com/vt/...`
 * (uso heredado del Traccar original durante años). Si Google los bloquea en el futuro,
 * el fallback seguro es OpenFreeMap/OSM.
 */

export const DEFAULT_PROVIDER_ID = 'googleRoad';

export const FALLBACK_PROVIDER_ID = 'osm';

export const providerGroups = {
  free: ['openFreeMap', 'osm', 'openTopoMap', 'carto', 'yandexMap', 'autoNavi'],
  keyed: ['locationIqStreets', 'locationIqDark', 'googleRoad', 'googleSatellite', 'googleHybrid'],
};

/**
 * Devuelve el id de proveedor inicial recomendado, priorizando la preferencia del usuario
 * y cayendo al default gratuito cuando no hay preferencia o el proveedor no está disponible.
 */
export const getDefaultProvider = (preference, availableIds) => {
  if (availableIds?.includes(preference)) {
    return preference;
  }
  if (availableIds?.includes(DEFAULT_PROVIDER_ID)) {
    return DEFAULT_PROVIDER_ID;
  }
  if (availableIds?.length) {
    return availableIds[0];
  }
  return FALLBACK_PROVIDER_ID;
};

/** Indica si un proveedor requiere API key (se ofrece solo si está configurada). */
export const requiresKey = (provider) => Boolean(provider?.attribute);
