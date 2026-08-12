/**
 * MapProvider — abstracción sobre los proveedores de mapas.
 *
 * El dashboard consume siempre esta API y nunca depende de un proveedor concreto.
 * El proveedor activo se elige por configuración (atributo `activeMapStyles` y
 * preferencia `map`), nunca por hardcoding. El default es OpenFreeMap (gratuito, sin key).
 *
 * Proveedores con API key (Google, MapTiler, Bing, Mapbox, HERE, TomTom...) solo se
 * ofrecen cuando la key legítima está configurada; sin key no se usan tiles no oficiales.
 */

export const DEFAULT_PROVIDER_ID = 'openFreeMap';

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
