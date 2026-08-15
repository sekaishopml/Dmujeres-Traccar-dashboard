import { useTheme } from '@mui/material/styles';
import { useId, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
import { useAttributePreference } from '../common/util/preferences';
import { toMapCoordinates } from './core/mapUtil';

const MapRoutePath = ({ positions }) => {
  const id = useId();

  const theme = useTheme();

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

  useEffect(() => {
    const minSpeed = positions.map((p) => p.speed).reduce((a, b) => Math.min(a, b), Infinity);
    const maxSpeed = positions.map((p) => p.speed).reduce((a, b) => Math.max(a, b), -Infinity);
    const features = [];
    const maxGapMs = 5 * 60 * 1000;
    for (let i = 0; i < positions.length - 1; i += 1) {
      const currentTime = Date.parse(
        positions[i].fixTime || positions[i].deviceTime || positions[i].serverTime,
      );
      const nextTime = Date.parse(
        positions[i + 1].fixTime || positions[i + 1].deviceTime || positions[i + 1].serverTime,
      );
      if (
        Number.isFinite(currentTime) &&
        Number.isFinite(nextTime) &&
        nextTime - currentTime > maxGapMs
      ) {
        continue;
      }
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            toMapCoordinates(positions[i].longitude, positions[i].latitude),
            toMapCoordinates(positions[i + 1].longitude, positions[i + 1].latitude),
          ],
        },
        properties: {
          color: reportColor || getSpeedColor(positions[i + 1].speed, minSpeed, maxSpeed),
          width: mapLineWidth,
          opacity: mapLineOpacity,
        },
      });
    }
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [theme, positions, reportColor, mapLineWidth, mapLineOpacity, id]);

  return null;
};

export default MapRoutePath;
