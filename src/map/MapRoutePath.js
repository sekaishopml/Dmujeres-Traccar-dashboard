import { useId, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
import { useAttributePreference } from '../common/util/preferences';
import { toMapCoordinates } from './core/mapUtil';
import {
  DECIMATION_THRESHOLD,
  filterSpikes,
  MAX_GAP_MS,
  simplify,
  splitByGap,
  toleranceForZoom,
} from './util/pathDecimation';

const MapRoutePath = ({ positions }) => {
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
    const speeds = positions.map((p) => Number(p.speed)).filter(Number.isFinite);
    const speedCapKnots = 65;
    const minSpeed = speeds.length ? Math.max(0, Math.min(...speeds)) : 0;
    const maxSpeed = speeds.length ? Math.min(Math.max(...speeds), speedCapKnots) : speedCapKnots;

    let decimated = positions;
    if (positions.length > DECIMATION_THRESHOLD) {
      const tolerance = toleranceForZoom(zoom);
      decimated = splitByGap(positions, MAX_GAP_MS).flatMap((chunk) => simplify(filterSpikes(chunk), tolerance));
    }

    const features = [];
    for (let i = 0; i < decimated.length - 1; i += 1) {
      const current = decimated[i];
      const next = decimated[i + 1];
      const currentTime = Date.parse(current.fixTime || current.deviceTime || current.serverTime);
      const nextTime = Date.parse(next.fixTime || next.deviceTime || next.serverTime);
      if (
        Number.isFinite(currentTime) &&
        Number.isFinite(nextTime) &&
        nextTime - currentTime > MAX_GAP_MS
      ) {
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
    return features;
  }, [positions, zoom, reportColor, mapLineWidth, mapLineOpacity]);

  useEffect(() => {
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [features, id]);

  return null;
};

export default MapRoutePath;
