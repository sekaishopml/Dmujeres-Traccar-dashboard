import { useId, useCallback, useEffect, useMemo, useState } from 'react';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
import { findFonts, toMapCoordinates } from './core/mapUtil';
import MapSpeedLegend from './control/MapSpeedLegend';
import { bearingDegrees } from './util/pathDecimation';
import {
  buildCanonicalRouteGeometry,
  generateRouteArrows,
  spacingForZoom,
} from './util/canonicalRouteGeometry';
import { useAttributePreference } from '../common/util/preferences';

/** Confianza del snap: más lejos = zona sin vía, la flecha queda en su sitio. */
const SNAP_TRUST_M = 60;

// Flechas de rumbo como el Traccar original, pero sobre la GEOMETRÍA CANÓNICA
// (la misma que dibuja la línea): una flecha cada X METROS de distancia real
// acumulada por chunk, interpolando la posición exacta sobre el segmento y con
// rumbo de la geometría visible (nunca position.course, que suele venir rancio
// o en 0). El número de fixes NO decide el espaciado: 10 fixes pueden ser 50 m
// o 3 km y las flechas quedan igual de uniformes. Optimizaciones:
//  1) una sola geometría para línea y flechas (no divergen en curvas);
//  2) las flechas nunca cruzan gaps/teleports (cada chunk es independiente);
//  3) con trazo pegado a carretera, la flecha pisa su punto casado (mismo
//     fix, misma velocidad, mismo click); sin vía cerca queda en su sitio.
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
    // MISMA geometría que la línea: orden temporal, limpieza, gaps y
    // teleports cortados, distancias acumuladas por chunk.
    const geometry = buildCanonicalRouteGeometry(positions, {
      hideInaccurate,
      accuracyThreshold,
    });
    if (!geometry.pointCount) {
      return [];
    }
    // Espaciado FÍSICO por zoom (m): camina los segmentos y emite cada X m.
    const { arrows } = generateRouteArrows(geometry, {
      spacingMeters: spacingForZoom(zoom),
    });
    if (!arrows.length) {
      return [];
    }
    // Vértices casados aplanados (con su tramo) para el snap.
    const useMatched =
      Array.isArray(matchSegments) && matchSegments.some((s) => Array.isArray(s) && s.length >= 2);
    const matched = [];
    if (useMatched) {
      matchSegments.forEach((segment, segId) => {
        if (!Array.isArray(segment)) {
          return;
        }
        segment.forEach(([longitude, latitude], i) => {
          const prev = segment[Math.max(0, i - 1)];
          const next = segment[Math.min(segment.length - 1, i + 1)];
          matched.push({
            latitude,
            longitude,
            segId,
            bearing: bearingDegrees(
              { latitude: prev[1], longitude: prev[0] },
              { latitude: next[1], longitude: next[0] },
            ),
          });
        });
      });
    }
    // Snap de una flecha a su vértice casado más cercano (búsqueda lineal:
    // las flechas ya son pocas y uniformes, no todos los puntos).
    const snapMatched = (arrow) => {
      let best = -1;
      let bestDist = Infinity;
      const cosLat = Math.cos((arrow.latitude * Math.PI) / 180);
      for (let i = 0; i < matched.length; i += 1) {
        const p = matched[i];
        const dLat = (p.latitude - arrow.latitude) * 111320;
        const dLon = (p.longitude - arrow.longitude) * 111320 * cosLat;
        const dist = dLat * dLat + dLon * dLon;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      if (best < 0) {
        return null;
      }
      return { vertex: matched[best], distM: Math.sqrt(bestDist) };
    };
    const { speedMin, speedMax } = geometry;
    const byId = new Map();
    positions.forEach((position, index) => {
      if (position?.id !== undefined && !byId.has(position.id)) {
        byId.set(position.id, index);
      }
    });
    return arrows.map((arrow) => {
      // Cada flecha referencia su fix real más cercano (click/color/velocidad).
      // En vivo (pares sin metadatos) no hay id: la flecha no es clicable.
      const position = arrow.live ? null : arrow.refPosition;
      let display = { latitude: arrow.latitude, longitude: arrow.longitude };
      let rotation = arrow.rotation;
      if (useMatched && matched.length) {
        const snapped = snapMatched(arrow);
        if (snapped && snapped.distM <= SNAP_TRUST_M) {
          display = { latitude: snapped.vertex.latitude, longitude: snapped.vertex.longitude };
          rotation = snapped.vertex.bearing;
        }
      }
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: toMapCoordinates(display.longitude, display.latitude),
        },
        properties: {
          index: position?.id !== undefined && byId.has(position.id) ? byId.get(position.id) : 0,
          id: position?.id,
          rotation,
          // Misma escala de color que la línea (mín/máx canónicos): igual
          // velocidad = igual color en línea y flecha.
          color: getSpeedColor(Number(position?.speed), speedMin, speedMax),
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
