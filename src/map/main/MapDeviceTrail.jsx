import { useId, useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useTheme } from '@mui/material/styles';
import { map } from '../core/MapView';
import { toMapCoordinates } from '../core/mapUtil';
import MapRoutePoints from '../MapRoutePoints';
import { useAttributePreference } from '../../common/util/preferences';
import fetchOrThrow from '../../common/util/fetchOrThrow';
import { buildCanonicalRouteGeometry, lineSegmentsFor } from '../util/canonicalRouteGeometry';

const TRAIL_HOURS = 2;
const MAX_POINTS = 50;

// Estela del seleccionado (2 h) con la MISMA geometría canónica del replay:
// la línea sale de los chunks canónicos y las flechas usan LA MISMA
// implementación (MapRoutePoints / generateRouteArrows). No hay un pipeline
// de trail distinto: antes el trail filtraba/truncaba por su cuenta y unía
// huecos con rectas que el replay cortaba.
const MapDeviceTrail = () => {
  const id = useId();
  const theme = useTheme();
  const selectedDeviceId = useSelector((state) =>
    state.devices.items[state.devices.selectedId] ? state.devices.selectedId : null,
  );
  const deviceName = useSelector((state) =>
    selectedDeviceId ? state.devices.items[selectedDeviceId]?.name : null,
  );
  const reportColor = useSelector((state) => {
    const attributes = selectedDeviceId ? state.devices.items[selectedDeviceId]?.attributes : null;
    return attributes?.['web.reportColor'] || theme.palette.geometry.main;
  });
  const mapLiveRoutes = useAttributePreference('mapLiveRoutes', 'none');
  const hideInaccurate = useAttributePreference('web.hideInaccurate', true);
  const accuracyThresholdPref = useAttributePreference('web.accuracyThreshold', 250);
  const accuracyThreshold = Number.isFinite(Number(accuracyThresholdPref))
    ? Number(accuracyThresholdPref)
    : 250;
  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  const [trail, setTrail] = useState([]);

  useEffect(() => {
    setTrail([]);
    if (!selectedDeviceId) return undefined;
    const controller = new AbortController();
    const to = new Date();
    const from = new Date(to.getTime() - TRAIL_HOURS * 60 * 60 * 1000);
    const query = new URLSearchParams({
      deviceId: selectedDeviceId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    fetchOrThrow(`/api/positions?${query.toString()}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((positions) => {
        positions.sort((a, b) => new Date(a.fixTime) - new Date(b.fixTime));
        // Ventana corta de vista previa; la limpieza (spikes, inexactos,
        // paradas) y los cortes los pone la geometría canónica, igual que
        // el replay. Se guardan los objetos completos (id/velocidad) para
        // que las flechas compartidas resuelvan click y color.
        setTrail(positions.slice(-MAX_POINTS));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selectedDeviceId]);

  const geometry = useMemo(
    () => buildCanonicalRouteGeometry(trail, { hideInaccurate, accuracyThreshold }),
    [trail, hideInaccurate, accuracyThreshold],
  );

  const lineFeatures = useMemo(
    () =>
      lineSegmentsFor(geometry).map(({ a, b }) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            toMapCoordinates(a.longitude, a.latitude),
            toMapCoordinates(b.longitude, b.latitude),
          ],
        },
        properties: {
          color: reportColor,
          width: mapLineWidth,
          opacity: mapLineOpacity,
        },
      })),
    [geometry, reportColor, mapLineWidth, mapLineOpacity],
  );

  useEffect(() => {
    if (!lineFeatures.length) {
      return undefined;
    }
    const sourceId = `${id}-trail`;
    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      source: sourceId,
      id: `${sourceId}-line`,
      type: 'line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-opacity': ['get', 'opacity'],
      },
    });
    map.getSource(sourceId)?.setData({ type: 'FeatureCollection', features: lineFeatures });
    return () => {
      if (map.getLayer(`${sourceId}-line`)) {
        map.removeLayer(`${sourceId}-line`);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    };
  }, [lineFeatures, id]);

  if (!selectedDeviceId || !deviceName || mapLiveRoutes !== 'none' || trail.length < 2) {
    return null;
  }

  // Flechas con la ÚNICA implementación (misma que el replay).
  return <MapRoutePoints positions={trail} hideInaccurate={hideInaccurate} />;
};

export default MapDeviceTrail;
