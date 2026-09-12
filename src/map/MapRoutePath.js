import { useId, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
import { useAttributePreference } from '../common/util/preferences';
import { toMapCoordinates } from './core/mapUtil';
import { buildCanonicalRouteGeometry, lineSegmentsFor } from './util/canonicalRouteGeometry';

// Línea de ruta desde la GEOMETRÍA CANÓNICA: los mismos chunks y distancias
// que usan las flechas (MapRoutePoints). La línea y las flechas representan
// exactamente la misma ruta por construcción: antes la línea simplificaba por
// zoom (Douglas-Peucker + Chaikin) sobre una lista y las flechas muestreaban
// `índice % stride` sobre otra, y divergían en curvas y densidades.
// Sin dependencia del zoom: la geometría es estable y no re-renderiza al
// hacer zoom (las flechas sí ajustan su espaciado físico).
const MapRoutePath = ({ positions, onStats, hideInaccurate: hideInaccurateProp }) => {
  const id = useId();

  const reportColor = useSelector((state) => {
    const position = positions?.find(() => true);
    if (position) {
      const attributes = state.devices.items[position.deviceId]?.attributes;
      if (attributes) {
        const color = attributes['web.reportColor'];
        if (color) {
          return color;
        }
      }
    }
    return null;
  });

  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);
  const hideInaccuratePref = useAttributePreference('web.hideInaccurate', true);
  const accuracyThresholdPref = useAttributePreference('web.accuracyThreshold', 250);
  // Prop explícita (repetición de ruta con "ocultos siempre") gana a la
  // preferencia; los demás usos siguen la preferencia del usuario.
  const hideInaccurate = hideInaccurateProp !== undefined ? hideInaccurateProp : hideInaccuratePref;
  const accuracyThreshold = Number.isFinite(Number(accuracyThresholdPref))
    ? Number(accuracyThresholdPref)
    : 250;

  useEffect(() => {
    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [],
        },
      },
    });
    map.addLayer({
      source: id,
      id: `${id}-line`,
      type: 'line',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-opacity': ['get', 'opacity'],
      },
    });

    return () => {
      if (map.getLayer(`${id}-line`)) {
        map.removeLayer(`${id}-line`);
      }
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    };
  }, [id]);

  const { features, stats } = useMemo(() => {
    // Vista limpia solo para el TRAZO: positions (crudos) se deja intacto para
    // slider/contador. La geometría canónica ordena por tiempo, limpia
    // (fantasmas, duplicados, inexactos, paradas) y corta gaps/teleports.
    const geometry = buildCanonicalRouteGeometry(positions, {
      hideInaccurate,
      accuracyThreshold,
    });
    const { speedMin, speedMax } = geometry;
    const features = lineSegmentsFor(geometry).map(({ a, b, speed }) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          toMapCoordinates(a.longitude, a.latitude),
          toMapCoordinates(b.longitude, b.latitude),
        ],
      },
      properties: {
        color: reportColor || getSpeedColor(speed, speedMin, speedMax),
        width: mapLineWidth,
        opacity: mapLineOpacity,
      },
    }));
    // shown es estable (pre-decimación): total - ocultos - colapsados.
    return { features, stats: geometry.stats };
  }, [positions, reportColor, mapLineWidth, mapLineOpacity, hideInaccurate, accuracyThreshold]);

  useEffect(() => {
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
    // Si esta línea se (re)monta después que los símbolos, los devuelve
    // encima para que nada tape flechas ni GPS.
    (map.getStyle()?.layers || []).forEach((layer) => {
      if (layer.type === 'symbol' && layer.id !== id && layer.id !== `${id}-line`) {
        if (map.getLayer(layer.id)) {
          map.moveLayer(layer.id);
        }
      }
    });
  }, [features, id]);

  useEffect(() => {
    if (onStats) {
      onStats(stats);
    }
  }, [stats, onStats]);

  return null;
};

export default MapRoutePath;
