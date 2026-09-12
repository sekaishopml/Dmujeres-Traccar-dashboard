import { useId, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useTheme } from '@mui/material/styles';
import { map } from '../core/MapView';
import { useAttributePreference } from '../../common/util/preferences';
import { toMapCoordinates } from '../core/mapUtil';
import { buildCanonicalRouteGeometry, lineSegmentsFor } from '../util/canonicalRouteGeometry';

// Líneas en vivo del WebSocket. El historial (pares [lon, lat] sin tiempo)
// pasa por la MISMA geometría canónica del replay (limpieza de spikes y
// cortes por teleport solo por distancia): el vivo y el replay nunca dibujan
// rectas distintas sobre los mismos puntos. Sin flechas aquí (historiales
// cortos; las flechas viven en el trail con la única implementación).
const MapLiveRoutes = ({ deviceIds }) => {
  const id = useId();

  const theme = useTheme();

  const type = useAttributePreference('mapLiveRoutes', 'none');

  const devices = useSelector((state) => state.devices.items);
  const selectedDeviceId = useSelector((state) => state.devices.selectedId);

  const history = useSelector((state) => state.session.history);

  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  useEffect(() => {
    if (type !== 'none') {
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
        id,
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
        if (map.getLayer(id)) {
          map.removeLayer(id);
        }
        if (map.getSource(id)) {
          map.removeSource(id);
        }
      };
    }
    return () => {};
  }, [type, id]);

  const features = useMemo(() => {
    if (type === 'none') {
      return [];
    }
    const visibleIds = deviceIds
      .filter((deviceId) => (type === 'selected' ? deviceId === selectedDeviceId : true))
      .filter((deviceId) => history.hasOwnProperty(deviceId))
      .filter((deviceId) => devices[deviceId]);
    const out = [];
    visibleIds.forEach((deviceId) => {
      const geometry = buildCanonicalRouteGeometry(history[deviceId] || [], {
        hideInaccurate: false,
      });
      lineSegmentsFor(geometry).forEach(({ a, b }) => {
        out.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              toMapCoordinates(a.longitude, a.latitude),
              toMapCoordinates(b.longitude, b.latitude),
            ],
          },
          properties: {
            color:
              devices[deviceId]?.attributes?.['web.reportColor'] || theme.palette.geometry.main,
            width: mapLineWidth,
            opacity: mapLineOpacity,
          },
        });
      });
    });
    return out;
  }, [theme, type, devices, selectedDeviceId, history, deviceIds, mapLineOpacity, mapLineWidth]);

  useEffect(() => {
    if (type !== 'none') {
      map.getSource(id)?.setData({
        type: 'FeatureCollection',
        features,
      });
    }
  }, [type, features, id]);

  return null;
};

export default MapLiveRoutes;
