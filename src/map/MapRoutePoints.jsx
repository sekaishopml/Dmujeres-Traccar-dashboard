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
  strideForZoom,
  toleranceForZoom,
} from './util/pathDecimation';
import { useAttributePreference } from '../common/util/preferences';

/** Separación mínima (m) entre flechas: evita apilarlas en paradas y tramos lentos. */
const MIN_ARROW_SEPARATION_M = 15;

/** Tope de flechas a dibujar (rutas muy largas): el resto solo se ve como línea. */
const MAX_ARROWS = 800;

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

// Flechas de rumbo sobre la ruta, como el Traccar original (densidad clásica
// por zoom, en TODOS los zooms), con tres optimizaciones:
//  1) nunca se apilan: mínimo 15 m entre flechas (las paradas no manchan);
//  2) el rumbo NO sale de position.course (viene rancio o en 0): se calcula
//     con los vecinos de la lista que dibuja la línea visible;
//  3) si hay trazo pegado a carretera (matchSegments), las flechas se posan
//     SOBRE la línea visible y se orientan con ella; el color y el click
//     siguen siendo del fix real más cercano (datos honestos).
const MapRoutePoints = ({
  positions,
  onClick,
  showSpeedControl,
  hideInaccurate: hideInaccurateProp,
  matchSegments,
}) => {
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
        'text-size': 12,
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
  const accuracyThresholdPref = useAttributePreference('web.accuracyThreshold', 250);
  const accuracyThreshold = Number.isFinite(Number(accuracyThresholdPref))
    ? Number(accuracyThresholdPref)
    : 250;

  const features = useMemo(() => {
    const hideInaccurate =
      hideInaccurateProp !== undefined ? hideInaccurateProp : hideInaccuratePref;
    // Con match activo, la línea visible es la pegada a carretera: las flechas
    // pisan sus vértices (un chunkId por segmento, ya vienen cortados).
    const useMatched =
      Array.isArray(matchSegments) && matchSegments.some((s) => Array.isArray(s) && s.length >= 2);
    let flat;
    if (useMatched) {
      flat = [];
      matchSegments.forEach((segment, chunkId) => {
        if (!Array.isArray(segment)) {
          return;
        }
        segment.forEach(([longitude, latitude]) => {
          flat.push({ position: { latitude, longitude }, chunkId });
        });
      });
    } else {
      const { points: working } = cleanRoutePositions(positions, {
        hideInaccurate,
        accuracyThreshold,
      });
      let chunks = splitByGapAndTeleport(working, MAX_GAP_MS);
      if (working.length > DECIMATION_THRESHOLD) {
        const tolerance = Math.max(toleranceForZoom(zoom), SMOOTH_FLOOR_M / 111320);
        chunks = chunks.map((chunk) => smoothChaikinOnce(simplify(filterSpikes(chunk), tolerance)));
      }
      flat = [];
      chunks.forEach((chunk, chunkId) => {
        chunk.forEach((position) => flat.push({ position, chunkId }));
      });
    }
    if (!flat.length) {
      return [];
    }
    const byId = new Map();
    positions.forEach((position, index) => {
      if (position?.id !== undefined && !byId.has(position.id)) {
        byId.set(position.id, index);
      }
    });
    // Fix real más cercano a una coordenada (para color por velocidad y click):
    // solo se usa en modo match (en honesto la flecha YA es el fix).
    const nearestRawIndex = (latitude, longitude) => {
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < positions.length; i += 1) {
        const p = positions[i];
        if (p == null) {
          continue;
        }
        const dLat = (p.latitude - latitude) * 111320;
        const dLon = (p.longitude - longitude) * 111320 * Math.cos((latitude * Math.PI) / 180);
        const dist = dLat * dLat + dLon * dLon;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      return best;
    };
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
    // Densidad clásica del Traccar original por zoom (en todos los zooms),
    // con tope anti-lag para rutas larguísimas.
    const zoomStride = strideForZoom(zoom);
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
    // Resuelve color/click: en honesto es el propio fix; en match, el fix real
    // más cercano a la flecha (la flecha pisa la línea visible).
    const resolved = separatedIndexes.map((flatIndex) => {
      if (!useMatched) {
        return { flatIndex, rawIndex: -1, position: flat[flatIndex].position };
      }
      const { position } = flat[flatIndex];
      const rawIndex = nearestRawIndex(position.latitude, position.longitude);
      const raw = rawIndex >= 0 ? positions[rawIndex] : null;
      return { flatIndex, rawIndex, position: raw || position };
    });
    const speeds = resolved.map(({ position }) => Number(position?.speed)).filter(Number.isFinite);
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
    const minSpeed = speeds.length ? Math.min(...speeds) : 0;
    return resolved.map(({ flatIndex, rawIndex, position }) => {
      const { position: arrowPosition } = flat[flatIndex];
      const hasId = position?.id !== undefined;
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: toMapCoordinates(arrowPosition.longitude, arrowPosition.latitude),
        },
        properties: {
          index:
            rawIndex >= 0 ? rawIndex : hasId && byId.has(position.id) ? byId.get(position.id) : 0,
          id: position?.id,
          rotation: rotationOf(flatIndex),
          color: getSpeedColor(Number(position?.speed), minSpeed, maxSpeed),
        },
      };
    });
  }, [positions, zoom, hideInaccuratePref, hideInaccurateProp, accuracyThreshold, matchSegments]);

  useEffect(() => {
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [features, id]);

  return showSpeedControl ? <MapSpeedLegend positions={positions} /> : null;
};

export default MapRoutePoints;
