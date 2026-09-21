import { useMemo } from 'react';
import { Paper, Typography } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import { useTranslation } from '../common/components/LocalizationProvider';
import { isJourneyActive } from '../common/util/shift';

const useStyles = makeStyles()((theme) => ({
  summary: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    padding: theme.spacing(0.5, 1.5),
    pointerEvents: 'auto',
    boxShadow: 'none',
    backgroundColor: 'transparent',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.palette.text.secondary,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: theme.palette.text.secondary,
    flexShrink: 0,
  },
}));

/**
 * Contadores de la portada (decisión de la empresa, solo 3):
 * EN LINEA (jornada activa · señal OK · en movimiento), FUERA DE LINEA
 * (sin conexión) y DESHABILITADO (sin jornada activa).
 */
const DeviceSummary = ({ devices }) => {
  const { classes } = useStyles();
  const t = useTranslation();

  const counts = useMemo(() => {
    let online = 0;
    let offline = 0;
    let disabled = 0;
    Object.values(devices).forEach((device) => {
      if (!isJourneyActive(device)) {
        disabled += 1;
      } else if (device.status === 'online') {
        online += 1;
      } else {
        offline += 1;
      }
    });
    return { online, offline, disabled };
  }, [devices]);

  return (
    <Paper square elevation={0} className={classes.summary}>
      <Typography variant="caption" className={classes.item}>
        <span className={classes.dot} style={{ backgroundColor: '#2E7D32' }} />
        {t('deviceStatusOnline')} {counts.online}
      </Typography>
      <Typography variant="caption" className={classes.item}>
        <span className={classes.dot} style={{ backgroundColor: '#BDBDBD' }} />
        {t('deviceStatusOffline')} {counts.offline}
      </Typography>
      <Typography variant="caption" className={classes.item}>
        <span className={classes.dot} style={{ backgroundColor: '#0288D1' }} />
        {t('deviceDisabled')} {counts.disabled}
      </Typography>
    </Paper>
  );
};

export default DeviceSummary;
