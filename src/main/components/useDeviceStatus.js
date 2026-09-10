import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { formatStatus } from '../../common/util/formatter';
import {
  formatDeviceStateCause,
  getDeviceStateCause,
  getDeviceStateDisplayColor,
  getDeviceStateLabelKey,
  getDeviceStateMuiColor,
  selectDeviceState,
} from '../../common/util/shift';
import { useTranslation } from '../../common/components/LocalizationProvider';

dayjs.extend(relativeTime);

/**
 * Estado visible del dispositivo (chip + avatar), ya sin calendario:
 * DESHABILITADO (jornada inactiva) / SIN SEÑAL (degradación) /
 * DETENIDO / EN LINEA, según `mobile.journeyId`, la degradación de
 * señal y la velocidad de la posición.
 */
export const useDeviceStatus = (device) => {
  const t = useTranslation();
  const position = useSelector((state) => state.session.positions[device?.id]);

  return useMemo(() => {
    const statusLabel =
      device.status === 'online' || !device.lastUpdate
        ? formatStatus(device.status, t)
        : dayjs(device.lastUpdate).fromNow();
    const deviceState = selectDeviceState(device, position);
    const deviceCause = getDeviceStateCause(device, position);
    return {
      deviceState,
      deviceCause,
      causeLabel: formatDeviceStateCause(t, deviceCause),
      statusLabel,
      stateLabel: t(getDeviceStateLabelKey(deviceState)),
      stateMuiColor: getDeviceStateMuiColor(deviceState),
      stateDisplayColor: getDeviceStateDisplayColor(deviceState),
    };
  }, [device, position, t]);
};

export default useDeviceStatus;
