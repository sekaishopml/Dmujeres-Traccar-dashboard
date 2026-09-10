import { useId, useCallback, useEffect, useMemo, useState } from 'react';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
import { findFonts, toMapCoordinates } from './core/mapUtil';
import MapSpeedLegend from './control/MapSpeedLegend';
import {
  bearingDegrees,
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
import { useAttributePreference } from '../common/util/preferences';

/** Separación mínima (m) entre flechas: evita amontonarlas en paradas y tramos lentos. */
const MIN_ARROW_SEPARATION_M = 15;

/** Tope de flechas a dibujar (rutas muy largas): el resto solo se ve como línea. */
const MAX_ARROWS = 300;

/** Piso de stride de flechas según zoom: z12: 20, z13: 12, z14: 8, z15+: 5. */
const arrowStrideForZoom = (zoom) => {
  if (zoom < 13) return 20;
  if (zoom < 14) return 12;
  if (zoom < 15) return 8;
  return 5;
};

/** Distancia en metros entre dos posiciones (haversine local: pathDecimation no la exporta). */
const haversineMeters = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const la = toRad(a.latitude);
  const lb = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
};

const MapRoutePoints = ({ positions, onClick, showSpeedControl }) => {
  const id = useId();

  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const updateZoom = () => setZoom(map.getZoom());
    map.on('zoomend', updateZoom);
    return () => map.off('zoomend', updateZoom);
  }, []);

  const onMouseEnter = () => (map.getCanvas().style.cursor = 'pointer');
  const onMouseLeave = () => (map.getCanvas().style.cursor = '');

  const onMarkerClick = useCallback(
    (event) => {
      event.preventDefault();
      const feature = event.features[0];
      if (onClick) {
        onClick(feature.properties.id, feature.properties.index);
      }
    },
    [onClick],
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
      paint: {
        'text-color': ['get', 'color'],
      },
      layout: {
        'text-font': findFonts(map),
        'text-size': 10,
        'text-field': '▲',
        'text-allow-overlap': true,
        'text-rotate': ['get', 'rotation'],
      },
    });

    map.on('mouseenter', id, onMouseEnter);
    map.on('mouseleave', id, onMouseLeave);
    map.on('click', id, onMarkerClick);

    return () => {
      map.off('mouseenter', id, onMouseEnter);
      map.off('mouseleave', id, onMouseLeave);
      map.off('click', id, onMarkerClick);

      if (map.getLayer(id)) {
        map.removeLayer(id);
      }
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    };
  }, [onMarkerClick, id]);

  const hideInaccuratePref = useAttributePreference('web.hideInaccurate', true);
  const accuracyThresholdPref = useAttributePreference('web.accuracyThreshold', 80);
  const accuracyThreshold = Number.isFinite(Number(accuracyThresholdPref))
    ? Number(accuracyThresholdPref)
    : 80;

  const features = useMemo(() => {
    // Zoom < 12: a lo lejos la línea sola basta, sin flechas que saturen la vista.
    if (zoom < 12) {
      return [];
    }
    // Flechas sobre el trazo limpio: MISMA limpieza que la línea
    // (cleanRoutePositions) para que cada flecha pise la línea visible.
    // El rumbo NO sale de position.course (viene rancio o en 0): se calcula
    // con los vecinos anterior/siguiente de la lista ya limpia, decimada y
    // suavizada que dibuja la línea (diferencia central; en bordes de tramo,
    // unilateral). Siempre vista limpia, misma suavización que MapRoutePath.
    // Se conserva el índice original del click vía position.id.
    const hideInaccurate = hideInaccuratePref;
    const { points: working } = cleanRoutePositions(positions, {
      hideInaccurate,
      accuracyThreshold,
    });
    let chunks = splitByGapAndTeleport(working, MAX_GAP_MS);
    if (working.length > DECIMATION_THRESHOLD) {
      const tolerance = Math.max(toleranceForZoom(zoom), SMOOTH_FLOOR_M / 111320);
      chunks = chunks.map((chunk) => smoothChaikinOnce(simplify(filterSpikes(chunk), tolerance)));
    }
    const flat = [];
    chunks.forEach((chunk, chunkId) => {
      chunk.forEach((position) => flat.push({ position, chunkId }));
    });
    const byId = new Map();
    positions.forEach((position, index) => {
      if (position?.id !== undefined && !byId.has(position.id)) {
        byId.set(position.id, index);
      }
    });
    const rotationOf = (flatIndex) => {
      const { position, chunkId } = flat[flatIndex];
      const prevEntry =
        flatIndex > 0 && flat[flatIndex - 1].chunkId === chunkId
          ? flat[flatIndex - 1].position
          : null;
      const nextEntry =
        flatIndex < flat.length - 1 && flat[flatIndex + 1].chunkId === chunkId
          ? flat[flatIndex + 1].position
          : null;
      // simplify puede crear un salto al quitar intermedios: no orientar con
      // un tramo que la línea no dibuja (gap/teleport).
      const prev = prevEntry && !shouldCut(prevEntry, position, MAX_GAP_MS) ? prevEntry : null;
      const next = nextEntry && !shouldCut(position, nextEntry, MAX_GAP_MS) ? nextEntry : null;
      if (prev && next) {
        return bearingDegrees(prev, next);
      }
      if (next) {
        return bearingDegrees(position, next);
      }
      if (prev) {
        return bearingDegrees(prev, position);
      }
      return 0;
    };
    const maxSpeed = flat.reduce((a, { position: p }) => Math.max(a, p.speed), -Infinity);
    const minSpeed = flat.reduce((a, { position: p }) => Math.min(a, p.speed), Infinity);
    // Pisos de stride por zoom: flechas mucho más espaciadas para no manchar la pantalla.
    const zoomStride = arrowStrideForZoom(zoom);
    // Tope MAX_ARROWS para rutas largas (evita lag y saturación al máximo zoom).
    const stride = Math.max(zoomStride, Math.ceil(flat.length / MAX_ARROWS));
    const sampledIndexes = flat
      .map((_, flatIndex) => flatIndex)
      .filter((flatIndex) => flatIndex % stride === 0 || flatIndex === flat.length - 1);
    // Sin flechas apiladas: descarta las que queden a menos de MIN_ARROW_SEPARATION_M
    // de la última dibujada; la primera muestreada y la del último punto siempre van.
    const separatedIndexes = [];
    sampledIndexes.forEach((flatIndex, sampleIndex) => {
      const previous = separatedIndexes[separatedIndexes.length - 1];
      const isLast = sampleIndex === sampledIndexes.length - 1;
      const farEnough =
        previous === undefined ||
        haversineMeters(flat[previous].position, flat[flatIndex].position) >=
          MIN_ARROW_SEPARATION_M;
      if (farEnough || isLast) {
        separatedIndexes.push(flatIndex);
      }
    });
    return separatedIndexes.map((flatIndex) => {
      const { position } = flat[flatIndex];
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: toMapCoordinates(position.longitude, position.latitude),
        },
        properties: {
          index: position?.id !== undefined && byId.has(position.id) ? byId.get(position.id) : 0,
          id: position.id,
          rotation: rotationOf(flatIndex),
          color: getSpeedColor(position.speed, minSpeed, maxSpeed),
        },
      };
    });
  }, [positions, zoom, hideInaccuratePref, accuracyThreshold]);

  useEffect(() => {
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [features, id]);

  return showSpeedControl ? <MapSpeedLegend positions={positions} /> : null;
};

export default MapRoutePoints;
