import { useMemo } from 'react';
import { Paper, Typography } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import { useTranslation } from '../common/components/LocalizationProvider';

const useStyles = makeStyles()((theme) => ({
  summary: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    padding: theme.spacing(0.5, 1.5),
    pointerEvents: 'auto',
    borderBottom: `1px solid ${theme.palette.divider}`,
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

const DeviceSummary = ({ devices }) => {
  const { classes } = useStyles();
  const t = useTranslation();

  const counts = useMemo(() => {
    let online = 0;
    let offline = 0;
    let lowBattery = 0;
    let pending = 0;
    Object.values(devices).forEach((device) => {
      if (device.status === 'online') online += 1;
      else if (device.status === 'offline') offline += 1;
      const battery = device.attributes?.['mobile.battery'];
      if (battery != null && battery >= 0 && battery <= 30) lowBattery += 1;
      if ((device.attributes?.['mobile.pending'] ?? 0) > 0) pending += 1;
    });
    return { online, offline, lowBattery, pending };
  }, [devices]);

  return (
    <Paper square elevation={3} className={classes.summary}>
      <Typography variant="caption" className={classes.item}>
        <span className={classes.dot} />
        {t('deviceStatusOnline')} {counts.online}
      </Typography>
      <Typography variant="caption" className={classes.item}>
        {t('deviceStatusOffline')} {counts.offline}
      </Typography>
      <Typography variant="caption" className={classes.item}>
        {t('deviceSummaryLowBattery')} {counts.lowBattery}
      </Typography>
      <Typography variant="caption" className={classes.item}>
        {t('sharedPending')} {counts.pending}
      </Typography>
    </Paper>
  );
};

export default DeviceSummary;
