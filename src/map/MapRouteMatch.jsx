import { useId, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { map } from './core/MapView';
import { useAttributePreference } from '../common/util/preferences';
import { toMapCoordinates } from './core/mapUtil';

// Trazo pegado a carretera (map-matching): polilínea ya casada con la red
// vial que devuelve /api/positions/match. Donde no hubo vía (patios, caminos
// nuevos), el servidor devuelve el fix crudo en la MISMA lista, así que la
// línea es continua y nunca se desvía más que el dato honesto. Si no hay
// segmentos, ReplayPage dibuja la línea honesta en su lugar.
const MapRouteMatch = ({ segments, deviceId }) => {
  const id = useId();

  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  const reportColor = useSelector((state) => {
    const attributes = deviceId ? state.devices.items[deviceId]?.attributes : null;
    return attributes?.['web.reportColor'] || null;
  });

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
    (segments || []).forEach((segment) => {
      if (!Array.isArray(segment) || segment.length < 2) {
        return;
      }
      for (let i = 0; i < segment.length - 1; i += 1) {
        list.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              toMapCoordinates(segment[i][0], segment[i][1]),
              toMapCoordinates(segment[i + 1][0], segment[i + 1][1]),
            ],
          },
          properties: {
            color: reportColor || '#1a73e8',
            width: mapLineWidth,
            opacity: mapLineOpacity,
          },
        });
      }
    });
    return list;
  }, [segments, reportColor, mapLineWidth, mapLineOpacity]);

  useEffect(() => {
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [features, id]);

  return null;
};

export default MapRouteMatch;
