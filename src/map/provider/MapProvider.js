/**
 * MapProvider — abstracción sobre los proveedores de mapas.
 * El proveedor activo se elige por configuración (`activeMapStyles` y preferencia
 * `map`). Google Maps se ofrece siempre: con API key si existe, o con los tiles
 * clásicos mt0-3.google.com/vt/... si no. Si Google los bloquea, el fallback es
 * OpenFreeMap/OSM.
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
