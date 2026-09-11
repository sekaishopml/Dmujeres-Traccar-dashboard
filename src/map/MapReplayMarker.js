import { useEffect, useId, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { map } from './core/MapView';
import { formatTime } from '../common/util/formatter';
import {
  DEVICE_NO_SIGNAL,
  DEVICE_STOPPED,
  getDeviceStateDisplayColor,
  selectDeviceState,
} from '../common/util/shift';
import { mapIconKey } from './core/preloadImages';
import { useAttributePreference } from '../common/util/preferences';
import { findFonts, toMapCoordinates } from './core/mapUtil';

// Marcador animado de Repetición Ruta: una sola feature GeoJSON que el loop
// rAF de ReplayPage actualiza por frame con setData directo (sin setState),
// interpolando lat/lon entre fixes. Visualmente idéntico a MapPositions
// (mismo sprite por estado + etiqueta fixTime + flecha de rumbo).
const MapReplayMarker = ({ position, markerRef, onMarkerClick }) => {
  const id = useId();

  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const iconScale = useAttributePreference('iconScale', desktop ? 0.75 : 1);

  const devices = useSelector((state) => state.devices.items);

  const latestRef = useRef({ devices, onMarkerClick, position });
  latestRef.current = { devices, onMarkerClick, position };

  // Escritura directa a la fuente maplibre: estable entre renders, lee lo
  // último vía latestRef para no recrear el loop rAF del padre por frame.
  const setPosition = useCallback(
    (coords, fix, rotation) => {
      const source = map.getSource(id);
      if (!source || !fix || !coords) {
        return;
      }
      const known = latestRef.current.devices;
      const device = known[fix.deviceId];
      const deviceState = selectDeviceState(device, fix);
      const statusColor =
        deviceState === DEVICE_NO_SIGNAL
          ? 'noSignal'
          : deviceState === DEVICE_STOPPED
            ? 'stopped'
            : getDeviceStateDisplayColor(deviceState);
      const heading =
        Number.isFinite(Number(rotation)) && Number(rotation) > 0
          ? Number(rotation)
          : Number(fix.course) || 0;
      source.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: toMapCoordinates(coords.longitude, coords.latitude),
            },
            properties: {
              id: fix.id,
              deviceId: fix.deviceId,
              name: device?.name ?? '',
              fixTime: formatTime(fix.fixTime, 'seconds'),
              category: mapIconKey(device?.category),
              color: statusColor,
              rotation: heading,
              direction: heading > 0,
            },
          },
        ],
      });
      // El círculo GPS siempre encima de las líneas en Z: la línea casada se
      // monta después que el marcador y si no, lo tapa. Orden fijo en cada update.
      if (map.getLayer(id)) {
        map.moveLayer(id);
      }
      if (map.getLayer(`direction-${id}`)) {
        map.moveLayer(`direction-${id}`);
      }
    },
    [id],
  );

  useEffect(() => {
    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
    map.addLayer({
      id,
      type: 'symbol',
      source: id,
      filter: ['!has', 'point_count'],
      layout: {
        'icon-image': '{category}-{color}',
        'icon-size': iconScale,
        'icon-allow-overlap': true,
        'text-field': '{fixTime}',
        'text-allow-overlap': true,
        'text-anchor': 'bottom',
        'text-offset': [0, -2 * iconScale],
        'text-font': findFonts(map),
        'text-size': 12,
      },
      paint: {
        'text-halo-color': 'white',
        'text-halo-width': 1,
      },
    });
    map.addLayer({
      id: `direction-${id}`,
      type: 'symbol',
      source: id,
      filter: ['all', ['!has', 'point_count'], ['==', 'direction', true]],
      layout: {
        'icon-image': 'direction',
        'icon-size': iconScale,
        'icon-allow-overlap': true,
        'icon-rotate': ['get', 'rotation'],
        'icon-rotation-alignment': 'map',
      },
    });

    const onMouseEnter = () => (map.getCanvas().style.cursor = 'pointer');
    const onMouseLeave = () => (map.getCanvas().style.cursor = '');
    const onClick = (event) => {
      event.preventDefault();
      const feature = event.features[0];
      if (feature) {
        latestRef.current.onMarkerClick?.(feature.properties.id, feature.properties.deviceId);
      }
    };
    map.on('mouseenter', id, onMouseEnter);
    map.on('mouseleave', id, onMouseLeave);
    map.on('click', id, onClick);

    return () => {
      map.off('mouseenter', id, onMouseEnter);
      map.off('mouseleave', id, onMouseLeave);
      map.off('click', id, onClick);
      if (map.getLayer(`direction-${id}`)) {
        map.removeLayer(`direction-${id}`);
      }
      if (map.getLayer(id)) {
        map.removeLayer(id);
      }
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    };
  }, [id, iconScale]);

  useEffect(() => {
    if (markerRef) {
      markerRef.current = { setPosition };
      return () => {
        markerRef.current = null;
      };
    }
    return undefined;
  }, [markerRef, setPosition]);

  // Posición estática (pausa, slider, carga): el padre solo empuja por frame
  // mientras reproduce, así que el fix visible siempre pisa el slider.
  useEffect(() => {
    if (position) {
      setPosition({ longitude: position.longitude, latitude: position.latitude }, position);
    } else {
      map.getSource(id)?.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [id, position, setPosition]);

  return null;
};

export default MapReplayMarker;
