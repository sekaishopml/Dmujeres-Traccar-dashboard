import { useId, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { map } from './core/MapView';
import { useAttributePreference } from '../common/util/preferences';
import { toMapCoordinates } from './core/mapUtil';

// Trazo pegado a carretera (map-matching): polilínea ya casada con la red
// vial que devuelve /api/positions/match. Donde no hubo vía (patios, caminos
// nuevos), el servidor devuelve el fix crudo en la MISMA lista, así que la
// línea es continua y nunca se desvía más que el dato honesto. Los tramos
// cuyo segmento vino null (sin match) se dibujan con los puntos crudos del
// input (tracks, mismo orden): ningún tramo queda nunca sin línea.
const MapRouteMatch = ({ segments, tracks, deviceId }) => {
  const id = useId();

  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  const reportColor = useSelector((state) => {
    const attributes = deviceId ? state.devices.items[deviceId]?.attributes : null;
    return attributes?.['web.reportColor'] || null;
  });

  // Color honesto para los tramos sin match (mismo sistema de la línea cruda:
  // gris neutro que no compite con el azul carretera).
  const HONEST_COLOR = '#64748b';

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

  const features = useMemo(() => {
    const list = [];
    const roadColor = reportColor || '#1a73e8';
    const pushLine = (a, b, color) => {
      list.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [toMapCoordinates(a[0], a[1]), toMapCoordinates(b[0], b[1])],
        },
        properties: {
          color,
          width: mapLineWidth,
          opacity: mapLineOpacity,
        },
      });
    };
    (segments || []).forEach((segment, index) => {
      if (Array.isArray(segment) && segment.length >= 2) {
        for (let i = 0; i < segment.length - 1; i += 1) {
          pushLine(segment[i], segment[i + 1], roadColor);
        }
        return;
      }
      // Sin match en este tramo: línea honesta con los puntos crudos del input.
      const raw = (tracks || [])[index];
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length - 1; i += 1) {
          pushLine(raw[i], raw[i + 1], HONEST_COLOR);
        }
      }
    });
    return list;
  }, [segments, tracks, reportColor, mapLineWidth, mapLineOpacity]);

  useEffect(() => {
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [features, id]);

  return null;
};

export default MapRouteMatch;
