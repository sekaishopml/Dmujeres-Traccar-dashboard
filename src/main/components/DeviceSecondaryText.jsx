import { makeStyles } from 'tss-react/mui';
import { useTranslation } from '../../common/components/LocalizationProvider';
import { useDeviceStatus } from './useDeviceStatus';

const useStyles = makeStyles()((theme) => ({
  success: {
    color: theme.palette.success.main,
  },
  warning: {
    color: theme.palette.warning.main,
  },
  info: {
    color: theme.palette.info.main,
  },
  error: {
    color: theme.palette.error.main,
  },
  neutral: {
    color: theme.palette.neutral.main,
  },
}));

/**
 * Texto secundario de la fila: valor configurado + estado operativo + tiempo
 * relativo de la última actualización + pendientes. Nunca usa el estado de
 * Traccar ("En línea") si el estado operativo no es EN LÍNEA: muestra el
 * `stateLabel` derivado de la jornada/señal con su color
 * (`stateDisplayColor`). Sin batería en ningún estado. Extraído de DeviceRow
 * para que la fila quede como simple composición. Mantiene el mismo marcado
 * y aria. El motivo de SIN SEÑAL vive en Eventos (campanita), no aquí.
 */
const DeviceSecondaryText = ({ device, secondaryValue }) => {
  const { classes } = useStyles();
  const t = useTranslation();
  const { stateDisplayColor, stateLabel, lastUpdateLabel } = useDeviceStatus(device);

  const statusClass = classes[stateDisplayColor] || classes.neutral;
  const pending = device.attributes?.['mobile.pending'];
  const pendingColor = pending > 100 ? 'error' : pending > 50 ? 'warning' : null;

  return (
    <>
      {secondaryValue && (
        <>
          {secondaryValue}
          {' • '}
        </>
      )}
      <span className={statusClass} aria-live="polite">
        {stateLabel}
        {lastUpdateLabel ? ` · ${lastUpdateLabel}` : ''}
      </span>
      {pending > 0 && (
        <>
          {' • '}
          <span className={pendingColor ? classes[pendingColor] : undefined}>
            {pending} {t('sharedPending')}
          </span>
        </>
      )}
    </>
  );
};

export default DeviceSecondaryText;
