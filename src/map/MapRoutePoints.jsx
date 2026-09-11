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
  simplify,
  SMOOTH_FLOOR_M,
  smoothChaikinOnce,
  splitByGapAndTeleport,
  toleranceForZoom,
} from './util/pathDecimation';
import { useAttributePreference } from '../common/util/preferences';

/** Separación mínima (m) entre flechas: guardia final contra apilados en paradas. */
const MIN_ARROW_SEPARATION_M = 15;

/** Tope de flechas a dibujar (rutas muy largas): el resto solo se ve como línea. */
const MAX_ARROWS = 800;

/**
 * Paso MÍNIMO (m) entre flechas según zoom. La flecha cae siempre sobre un
 * fix REAL (nunca interpolada): en rectas de vértices escasos el paso real
 * lo marca la cadencia del GPS, no este número.
 */
const STEP_FOR_ZOOM = (zoom) => {
  if (zoom < 9) return 800;
  if (zoom <= 10) return 400;
  if (zoom <= 12) return 150;
  if (zoom === 13) return 80;
  if (zoom === 14) return 40;
  return 25;
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

// Flechas de rumbo sobre la ruta, como el Traccar original (en TODOS los
// zooms). REGLA DURA: cada flecha corresponde a un fix REAL recolectado por
// la app (nunca interpolada): se camina por distancia y al cruzar el paso se
// coloca en el siguiente vértice real. En rectas largas de vértices escasos
// la densidad la marca la cadencia del GPS (5 s en marcha); el rumbo sale de
// la línea visible y el color/click del fix real.
const MapRoutePoints = ({
  positions,
  onClick,
  showSpeedControl,
  hideInaccurate: hideInaccurateProp,
  matchSegments,
  matchTracks,
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
    // Índice original por id para el click (el slider usa el orden del array).
    const byId = new Map();
    positions.forEach((position, index) => {
      if (position?.id !== undefined && !byId.has(position.id)) {
        byId.set(position.id, index);
      }
    });
    // Fix real más cercano a una coordenada (modo match: el track de entrada
    // no trae ids; se resuelve contra positions).
    const nearestRawIndex = ({ latitude, longitude }) => {
      let best = -1;
      let bestDist = Infinity;
      const cosLat = Math.cos((latitude * Math.PI) / 180);
      for (let i = 0; i < positions.length; i += 1) {
        const p = positions[i];
        if (p == null) {
          continue;
        }
        const dLat = (p.latitude - latitude) * 111320;
        const dLon = (p.longitude - longitude) * 111320 * cosLat;
        const dist = dLat * dLat + dLon * dLon;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      return best;
    };
    // Carriles de candidatos REALES: cada candidato = { display:{latitude,
    // longitude}, bearing, rawIndex }. En honesto el display es el propio fix;
    // en match, el fix ajustado (snap) a la línea visible.
    let lanes = [];
    const useMatched =
      Array.isArray(matchSegments) &&
      matchSegments.some((s) => Array.isArray(s) && s.length >= 2) &&
      Array.isArray(matchTracks);
    if (useMatched) {
      matchTracks.forEach((track, trackIndex) => {
        const segment = matchSegments[trackIndex];
        if (!Array.isArray(track) || !track.length) {
          return;
        }
        if (!Array.isArray(segment) || segment.length < 2) {
          // Sin match: fixes crudos del track, rumbo por diferencia central.
          const lane = track.map(([longitude, latitude], i) => {
            const prev = track[Math.max(0, i - 1)];
            const next = track[Math.min(track.length - 1, i + 1)];
            return {
              display: { latitude, longitude },
              bearing: bearingDegrees(
                { latitude: prev[1], longitude: prev[0] },
                { latitude: next[1], longitude: next[0] },
              ),
              rawIndex: nearestRawIndex({ latitude, longitude }),
            };
          });
          lanes.push(lane);
          return;
        }
        // Con match: cada fix del track ajustado a su vértice casado más
        // cercano (posición visible); rumbo de la cuerda casada en ese punto.
        const chords = [];
        for (let i = 0; i < segment.length - 1; i += 1) {
          chords.push({
            bearing: bearingDegrees(
              { latitude: segment[i][1], longitude: segment[i][0] },
              { latitude: segment[i + 1][1], longitude: segment[i + 1][0] },
            ),
          });
        }
        const nearestMatched = ({ latitude, longitude }) => {
          let best = 0;
          let bestDist = Infinity;
          const cosLat = Math.cos((latitude * Math.PI) / 180);
          for (let i = 0; i < segment.length; i += 1) {
            const dLat = (segment[i][1] - latitude) * 111320;
            const dLon = (segment[i][0] - longitude) * 111320 * cosLat;
            const dist = dLat * dLat + dLon * dLon;
            if (dist < bestDist) {
              bestDist = dist;
              best = i;
            }
          }
          return best;
        };
        lanes.push(
          track.map(([longitude, latitude]) => {
            const at = nearestMatched({ latitude, longitude });
            const chord = chords[Math.min(at, chords.length - 1)];
            return {
              display: { latitude: segment[at][1], longitude: segment[at][0] },
              bearing: chord ? chord.bearing : 0,
              rawIndex: nearestRawIndex({ latitude, longitude }),
            };
          }),
        );
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
      lanes = chunks.map((chunk) =>
        chunk.map((position, i) => {
          const prev = chunk[Math.max(0, i - 1)];
          const next = chunk[Math.min(chunk.length - 1, i + 1)];
          return {
            display: { latitude: position.latitude, longitude: position.longitude },
            bearing: bearingDegrees(prev, next),
            rawIndex:
              position?.id !== undefined && byId.has(position.id)
                ? byId.get(position.id)
                : nearestRawIndex(position),
          };
        }),
      );
    }
    lanes = lanes.filter((lane) => lane.length > 0);
    if (!lanes.length) {
      return [];
    }
    // Longitud visible total para el tope anti-lag.
    let totalLen = 0;
    lanes.forEach((lane) => {
      for (let i = 0; i < lane.length - 1; i += 1) {
        totalLen += haversineMeters(lane[i].display, lane[i + 1].display);
      }
    });
    const step = Math.max(STEP_FOR_ZOOM(zoom), totalLen > 0 ? totalLen / MAX_ARROWS : 0);
    // Camina por distancia y coloca en el siguiente CANDIDATO REAL al cruzar
    // el paso (nunca entre vértices): cada flecha es un fix recolectado.
    // El primer candidato de cada tramo siempre lleva flecha (marca inicios).
    const placed = [];
    lanes.forEach((lane) => {
      placed.push(lane[0]);
      let acc = 0;
      for (let i = 0; i < lane.length - 1; i += 1) {
        const legLen = haversineMeters(lane[i].display, lane[i + 1].display);
        if (!(legLen > 0)) {
          continue;
        }
        acc += legLen;
        if (acc >= step) {
          placed.push(lane[i + 1]);
          acc = 0;
        }
      }
    });
    // Guardia anti-apilado (paradas, junctions densas): mínimo 15 m.
    const kept = [];
    placed.forEach((candidate, candidateIndex) => {
      const previous = kept[kept.length - 1];
      const isLast = candidateIndex === placed.length - 1;
      if (
        !previous ||
        haversineMeters(previous.display, candidate.display) >= MIN_ARROW_SEPARATION_M ||
        isLast
      ) {
        kept.push(candidate);
      }
    });
    const speeds = kept
      .map(({ rawIndex }) => (rawIndex >= 0 ? Number(positions[rawIndex]?.speed) : NaN))
      .filter(Number.isFinite);
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
    const minSpeed = speeds.length ? Math.min(...speeds) : 0;
    return kept.map(({ display, bearing, rawIndex }) => {
      const raw = rawIndex >= 0 ? positions[rawIndex] : null;
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: toMapCoordinates(display.longitude, display.latitude),
        },
        properties: {
          index: rawIndex >= 0 ? rawIndex : 0,
          id: raw?.id,
          rotation: bearing,
          color: getSpeedColor(Number(raw?.speed), minSpeed, maxSpeed),
        },
      };
    });
  }, [
    positions,
    zoom,
    hideInaccuratePref,
    hideInaccurateProp,
    accuracyThreshold,
    matchSegments,
    matchTracks,
  ]);

  useEffect(() => {
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
    // Las flechas siempre encima de las líneas.
    if (map.getLayer(id)) {
      map.moveLayer(id);
    }
  }, [features, id]);

  return showSpeedControl ? <MapSpeedLegend positions={positions} /> : null;
};

export default MapRoutePoints;
