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
    padding: theme.spacing(0.75, 1.5),
    pointerEvents: 'auto',
    boxShadow: 'none',
    backgroundColor: 'transparent',
    gap: theme.spacing(1),
    border: 'none',
    backdropFilter: 'none',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    color: theme.palette.text.secondary,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderRadius: 999,
    padding: '4px 10px',
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: theme.palette.text.secondary,
    flexShrink: 0,
    boxShadow: '0 0 8px currentColor',
    animation: 'dm-dot-pulse 1.8s infinite',
  },
  dotOnline: {
    backgroundColor: '#00E676',
    color: '#00E676',
  },
  dotOffline: {
    backgroundColor: '#FF3B5C',
    color: '#FF3B5C',
  },
  dotLow: {
    backgroundColor: '#FFB300',
    color: '#FFB300',
  },
  dotPending: {
    backgroundColor: '#7C3AED',
    color: '#7C3AED',
  },
  '@keyframes dm-dot-pulse': {
    '0%': { transform: 'scale(1)', opacity: 1 },
    '50%': { transform: 'scale(1.35)', opacity: 0.7 },
    '100%': { transform: 'scale(1)', opacity: 1 },
  },
}));

const DeviceSummary = ({ devices }) => {
  const { classes, cx } = useStyles();
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
      <Typography variant="caption" className={classes.item}>
        <span className={cx(classes.dot, classes.dotOnline)} />
        {t('deviceStatusOnline')} {counts.online}
      </Typography>
      <Typography variant="caption" className={classes.item}>
        <span className={cx(classes.dot, classes.dotOffline)} />
        {t('deviceStatusOffline')} {counts.offline}
      </Typography>
      <Typography variant="caption" className={classes.item}>
        <span className={cx(classes.dot, classes.dotLow)} />
        {t('deviceSummaryLowBattery')} {counts.lowBattery}
      </Typography>
      <Typography variant="caption" className={classes.item}>
        <span className={cx(classes.dot, classes.dotPending)} />
        {t('sharedPending')} {counts.pending}
      </Typography>
    </Paper>
  );
};

export default DeviceSummary;
