import { useId, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
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
    // Escala de velocidad del fallback honesto (los tracks traen [lon,lat,kn]).
    const speeds = (tracks || [])
      .flatMap((track) => (Array.isArray(track) ? track : []))
      .map((point) => Number(point[2]))
      .filter(Number.isFinite);
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
    const minSpeed = speeds.length ? Math.min(...speeds) : 0;
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
      // Sin match en este tramo: línea honesta con los puntos crudos del input,
      // coloreada por velocidad igual que el trazo principal (nada gris).
      const raw = (tracks || [])[index];
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length - 1; i += 1) {
          pushLine(raw[i], raw[i + 1], getSpeedColor(Number(raw[i + 1][2]), minSpeed, maxSpeed));
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
    // La línea casada se monta al último: sube los símbolos existentes
    // (flechas, círculo GPS) para que nunca queden tapados, conservando su
    // orden relativo entre ellos.
    (map.getStyle()?.layers || []).forEach((layer) => {
      if (layer.type === 'symbol' && layer.id !== id && layer.id !== `${id}-line`) {
        if (map.getLayer(layer.id)) {
          map.moveLayer(layer.id);
        }
      }
    });
  }, [features, id]);

  return null;
};

export default MapRouteMatch;
