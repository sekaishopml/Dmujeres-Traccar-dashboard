import { IconButton, Tooltip } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import ErrorIcon from '@mui/icons-material/Error';
import { useTranslation } from '../../common/components/LocalizationProvider';
import { formatAlarm, formatBoolean } from '../../common/util/formatter';
import EngineIcon from '../../resources/images/data/engine.svg?react';

const useStyles = makeStyles()((theme) => ({
  success: {
    color: theme.palette.success.main,
  },
  warning: {
    color: theme.palette.warning.main,
  },
  error: {
    color: theme.palette.error.main,
  },
  neutral: {
    color: theme.palette.neutral.main,
  },
}));

/**
 * Iconos de estado de la posición (alarma / ignición).
 * Sin icono de batería (se oculta en todos los estados).
 * Extraído de DeviceRow sin cambios de comportamiento.
 */
const DevicePositionIcons = ({ position }) => {
  const { classes } = useStyles();
  const t = useTranslation();

  if (!position) return null;
  return (
    <>
      {position.attributes.hasOwnProperty('alarm') && (
        <Tooltip title={`${t('eventAlarm')}: ${formatAlarm(position.attributes.alarm, t)}`}>
          <IconButton size="small">
            <ErrorIcon fontSize="small" className={classes.error} />
          </IconButton>
        </Tooltip>
      )}
      {position.attributes.hasOwnProperty('ignition') && (
        <Tooltip
          title={`${t('positionIgnition')}: ${formatBoolean(position.attributes.ignition, t)}`}
        >
          <IconButton size="small">
            {position.attributes.ignition ? (
              <EngineIcon width={20} height={20} className={classes.success} />
            ) : (
              <EngineIcon width={20} height={20} className={classes.neutral} />
            )}
          </IconButton>
        </Tooltip>
      )}
    </>
  );
};

export default DevicePositionIcons;
