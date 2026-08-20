import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import MapRouteCoordinates from '../MapRouteCoordinates';
import { useAttributePreference } from '../../common/util/preferences';
import fetchOrThrow from '../../common/util/fetchOrThrow';

const TRAIL_HOURS = 2;
const MAX_POINTS = 50;

const MapDeviceTrail = () => {
  const selectedDeviceId = useSelector((state) => state.devices.selectedId);
  const deviceName = useSelector((state) =>
    selectedDeviceId ? state.devices.items[selectedDeviceId]?.name : null,
  );
  const mapLiveRoutes = useAttributePreference('mapLiveRoutes', 'none');

  const [trail, setTrail] = useState([]);

  useEffect(() => {
    setTrail([]);
    if (!selectedDeviceId) return;
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
        setTrail(positions.slice(-MAX_POINTS).map((p) => [p.longitude, p.latitude]));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selectedDeviceId]);

  if (!selectedDeviceId || !deviceName || mapLiveRoutes !== 'none' || trail.length < 2) {
    return null;
  }

  return (
    <MapRouteCoordinates name={deviceName} coordinates={trail} deviceId={selectedDeviceId} showTitle={false} />
  );
};

export default MapDeviceTrail;
