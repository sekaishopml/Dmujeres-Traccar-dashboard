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
 * Paso (m) entre flechas según zoom: la flecha cae SOBRE el tramo por
 * arco-longitud aunque sus vértices estén a cientos de metros (rectas
 * largas), así ningún punto del trazo se queda sin flecha.
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
// zooms), con tres optimizaciones:
//  1) se colocan por DISTANCIA caminando cada tramo (nunca faltan en rectas
//     largas de vértices escasos, nunca sobran en junctions densas);
//  2) el rumbo es el de la cuerda donde cae la flecha (exacto en la línea
//     visible), nunca el course rancio del equipo;
//  3) si hay trazo pegado a carretera (matchSegments), las flechas pisan sus
//     vértices; el color y el click siguen siendo del fix real más cercano.
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
    // Trozos como listas de {latitude, longitude}: con match, los vértices de
    // la línea visible; si no, el trazo limpio+decimado (misma limpieza que la
    // línea). Ya vienen cortados por huecos: nunca se camina sobre un corte.
    let chunks;
    if (
      Array.isArray(matchSegments) &&
      matchSegments.some((s) => Array.isArray(s) && s.length >= 2)
    ) {
      chunks = [];
      matchSegments.forEach((segment) => {
        if (Array.isArray(segment) && segment.length >= 2) {
          chunks.push(segment.map(([longitude, latitude]) => ({ latitude, longitude })));
        }
      });
    } else {
      const { points: working } = cleanRoutePositions(positions, {
        hideInaccurate,
        accuracyThreshold,
      });
      let rawChunks = splitByGapAndTeleport(working, MAX_GAP_MS);
      if (working.length > DECIMATION_THRESHOLD) {
        const tolerance = Math.max(toleranceForZoom(zoom), SMOOTH_FLOOR_M / 111320);
        rawChunks = rawChunks.map((chunk) =>
          smoothChaikinOnce(simplify(filterSpikes(chunk), tolerance)),
        );
      }
      chunks = rawChunks.map((chunk) =>
        chunk.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      );
    }
    if (!chunks.length) {
      return [];
    }
    // Longitud total para el tope anti-lag.
    let totalLen = 0;
    chunks.forEach((chunk) => {
      for (let i = 0; i < chunk.length - 1; i += 1) {
        totalLen += haversineMeters(chunk[i], chunk[i + 1]);
      }
    });
    const step = Math.max(STEP_FOR_ZOOM(zoom), totalLen > 0 ? totalLen / MAX_ARROWS : 0);
    // Camina cada trozo: flecha al inicio + una cada `step` metros con el
    // rumbo de su cuerda. Así las rectas largas tienen flechas y las zonas
    // densas no se apelotonan (el acumulado reparte el sobrante).
    const placed = [];
    chunks.forEach((chunk) => {
      if (!chunk.length) {
        return;
      }
      placed.push({
        ...chunk[0],
        rotation: chunk.length > 1 ? bearingDegrees(chunk[0], chunk[1]) : 0,
      });
      let acc = 0;
      for (let i = 0; i < chunk.length - 1; i += 1) {
        const a = chunk[i];
        const b = chunk[i + 1];
        const legLen = haversineMeters(a, b);
        if (!(legLen > 0)) {
          continue;
        }
        const legBearing = bearingDegrees(a, b);
        let d = step - acc;
        while (d <= legLen) {
          const f = d / legLen;
          placed.push({
            latitude: a.latitude + (b.latitude - a.latitude) * f,
            longitude: a.longitude + (b.longitude - a.longitude) * f,
            rotation: legBearing,
          });
          d += step;
        }
        acc = (acc + legLen) % step;
      }
    });
    // Guardia anti-apilado (paradas, junctions densas): mínimo 15 m.
    const kept = [];
    placed.forEach((arrow, arrowIndex) => {
      const previous = kept[kept.length - 1];
      const isLast = arrowIndex === placed.length - 1;
      if (!previous || haversineMeters(previous, arrow) >= MIN_ARROW_SEPARATION_M || isLast) {
        kept.push(arrow);
      }
    });
    // Fix real más cercano a cada flecha (color por velocidad y click):
    // la flecha pisa la línea, el dato sigue siendo honesto.
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
    const resolved = kept.map((arrow) => ({ arrow, rawIndex: nearestRawIndex(arrow) }));
    const speeds = resolved
      .map(({ rawIndex }) => (rawIndex >= 0 ? Number(positions[rawIndex]?.speed) : NaN))
      .filter(Number.isFinite);
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
    const minSpeed = speeds.length ? Math.min(...speeds) : 0;
    return resolved.map(({ arrow, rawIndex }) => {
      const raw = rawIndex >= 0 ? positions[rawIndex] : null;
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: toMapCoordinates(arrow.longitude, arrow.latitude),
        },
        properties: {
          index: rawIndex >= 0 ? rawIndex : 0,
          id: raw?.id,
          rotation: arrow.rotation,
          color: getSpeedColor(Number(raw?.speed), minSpeed, maxSpeed),
        },
      };
    });
  }, [positions, zoom, hideInaccuratePref, hideInaccurateProp, accuracyThreshold, matchSegments]);

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
