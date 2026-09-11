import { useId, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
import { useAttributePreference } from '../common/util/preferences';
import { toMapCoordinates } from './core/mapUtil';
import {
  cleanRoutePositions,
  DECIMATION_THRESHOLD,
  filterSpikes,
  MAX_GAP_MS,
  shouldCut,
  simplify,
  SMOOTH_FLOOR_M,
  smoothChaikinOnce,
  splitByGapAndTeleport,
  toleranceForZoom,
} from './util/pathDecimation';

const MapRoutePath = ({ positions, onStats, hideInaccurate: hideInaccurateProp }) => {
  const id = useId();

  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const updateZoom = () => setZoom(map.getZoom());
    map.on('zoomend', updateZoom);
    return () => map.off('zoomend', updateZoom);
  }, []);

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
    // slider/contador. La limpieza vive en cleanRoutePositions (pipeline único
    // compartido con las flechas). Siempre vista limpia: sin modo crudo; solo
    // se segmenta (gaps/teleports) para no unir con rectas lo que no debe
    // unirse. Ruido (picos + ping-pong + rachas random-walk) siempre fuera con
    // filtro activo; además se excluyen valid === false o accuracy > umbral, y
    // las paradas LARGAS y quietas se colapsan a su mediana. Tras simplify
    // (con piso mínimo SMOOTH_FLOOR_M) se aplica una pasada de Chaikin por
    // chunk para línea limpia estilo Traccar original.
    const {
      points: working,
      stats,
      cuts,
    } = cleanRoutePositions(positions, {
      hideInaccurate,
      accuracyThreshold,
    });

    const speeds = working.map((p) => Number(p.speed)).filter(Number.isFinite);
    const speedCapKnots = 65;
    const minSpeed = speeds.length ? Math.max(0, Math.min(...speeds)) : 0;
    const maxSpeed = speeds.length ? Math.min(Math.max(...speeds), speedCapKnots) : speedCapKnots;

    let decimated = working;
    if (working.length > DECIMATION_THRESHOLD) {
      const tolerance = Math.max(toleranceForZoom(zoom), SMOOTH_FLOOR_M / 111320);
      decimated = splitByGapAndTeleport(working, MAX_GAP_MS).flatMap((chunk) =>
        smoothChaikinOnce(simplify(filterSpikes(chunk), tolerance)),
      );
    }

    const features = [];
    for (let i = 0; i < decimated.length - 1; i += 1) {
      const current = decimated[i];
      const next = decimated[i + 1];
      // Corta gaps temporales y teleports (simplify puede crear un salto al
      // quitar intermedios): nunca una recta sobre un salto imposible.
      // También corta cuerdas que saltan sobre puntos ocultos (ver cuts de
      // cleanRoutePositions): la recta cruzando cuadras no se dibuja.
      if (shouldCut(current, next, MAX_GAP_MS) || (cuts && cuts.has(next))) {
        continue;
      }
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            toMapCoordinates(current.longitude, current.latitude),
            toMapCoordinates(next.longitude, next.latitude),
          ],
        },
        properties: {
          color: reportColor || getSpeedColor(next.speed, minSpeed, maxSpeed),
          width: mapLineWidth,
          opacity: mapLineOpacity,
        },
      });
    }
    // shown es estable ante el zoom (pre-decimación): total - ocultos - colapsados.
    return { features, stats };
  }, [
    positions,
    zoom,
    reportColor,
    mapLineWidth,
    mapLineOpacity,
    hideInaccurate,
    accuracyThreshold,
  ]);

  useEffect(() => {
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
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
