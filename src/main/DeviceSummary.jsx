import { useMemo } from 'react';
import { Paper, Chip, Box } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import { useTranslation } from '../common/components/LocalizationProvider';

const useStyles = makeStyles()((theme) => ({
  summary: {
    display: 'flex',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    padding: theme.spacing(1, 2),
    pointerEvents: 'auto',
    borderBottom: `1px solid ${theme.palette.divider}`,
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
    <Paper square elevation={0} className={classes.summary}>
      <Chip size="small" color="success" label={`${t('deviceStatusOnline')} ${counts.online}`} />
      <Chip size="small" color="error" label={`${t('deviceStatusOffline')} ${counts.offline}`} />
      <Chip size="small" color="warning" label={`${t('deviceSummaryLowBattery')} ${counts.lowBattery}`} />
      <Chip
        size="small"
        color={counts.pending > 0 ? 'warning' : 'default'}
        label={`${t('sharedPending')} ${counts.pending}`}
      />
    </Paper>
  );
};

export default DeviceSummary;
