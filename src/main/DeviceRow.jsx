import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';
import {
  IconButton,
  Tooltip,
  Avatar,
  ListItemAvatar,
  ListItemText,
  ListItemButton,
  Typography,
} from '@mui/material';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import BatteryChargingFullIcon from '@mui/icons-material/BatteryChargingFull';
import Battery60Icon from '@mui/icons-material/Battery60';
import BatteryCharging60Icon from '@mui/icons-material/BatteryCharging60';
import Battery20Icon from '@mui/icons-material/Battery20';
import BatteryCharging20Icon from '@mui/icons-material/BatteryCharging20';
import ErrorIcon from '@mui/icons-material/Error';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { devicesActions } from '../store';
import {
  formatAlarm,
  formatBoolean,
  formatPercentage,
  formatStatus,
  getStatusColor,
} from '../common/util/formatter';
import { useTranslation } from '../common/components/LocalizationProvider';
import { mapIconKey, mapIcons } from '../map/core/preloadImages';
import { useAdministrator } from '../common/util/permissions';
import EngineIcon from '../resources/images/data/engine.svg?react';
import { useAttributePreference } from '../common/util/preferences';
import GeofencesValue from '../common/components/GeofencesValue';
import DriverValue from '../common/components/DriverValue';
import MotionBar from './components/MotionBar';

dayjs.extend(relativeTime);

const useStyles = makeStyles()((theme) => ({
  icon: {
    width: '20px',
    height: '20px',
    filter: 'brightness(0) invert(1)',
  },
  avatar: {
    width: 32,
    height: 32,
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  avatarOnline: {
    boxShadow: '0 0 0 2px rgba(0,230,118,0.55), 0 0 12px rgba(0,230,118,0.45)',
    animation: 'dm-pulse 1.5s infinite',
  },
  avatarOffline: {
    boxShadow: '0 0 0 2px rgba(255,59,92,0.45), 0 0 10px rgba(255,59,92,0.35)',
  },
  avatarUnknown: {
    boxShadow: '0 0 0 2px rgba(155,161,182,0.35), 0 0 10px rgba(155,161,182,0.25)',
  },
  batteryText: {
    fontSize: '0.75rem',
    fontWeight: 'normal',
    lineHeight: '0.875rem',
  },
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
  selected: {
    backgroundColor: 'rgba(255,45,138,0.12) !important',
    border: '1px solid rgba(255,45,138,0.22) !important',
    backdropFilter: 'blur(12px)',
  },
  '@keyframes dm-pulse': {
    '0%': { transform: 'scale(1)', opacity: 1 },
    '50%': { transform: 'scale(1.03)', opacity: 0.92 },
    '100%': { transform: 'scale(1)', opacity: 1 },
  },
}));

const BatterySparkline = ({ history }) => {
  const points = useMemo(() => {
    try {
      const parsed = JSON.parse(history);
      if (!Array.isArray(parsed)) return [];
      const samples = parsed.filter(
        (sample) => Array.isArray(sample) && sample.length >= 2 && Number.isFinite(sample[1]),
      );
      if (samples.length < 2) return [];
      const values = samples.map((sample) => sample[1]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      return samples.map((sample, index) => ({
        x: (index / (samples.length - 1)) * 90,
        y: 22 - ((sample[1] - min) / span) * 20 - 1,
      }));
    } catch {
      return [];
    }
  }, [history]);
  if (!points.length) return null;
  return (
    <svg width="90" height="24" viewBox="0 0 90 24" aria-label="batteryHistory">
      <defs>
        <linearGradient id="dm-spark-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#EB0045" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <polyline
        points={points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="url(#dm-spark-gradient)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 0 4px rgba(255,45,138,0.45))' }}
      />
    </svg>
  );
};

const DeviceRow = ({ devices, index, style }) => {
  const { classes, cx } = useStyles();
  const dispatch = useDispatch();
  const t = useTranslation();

  const admin = useAdministrator();
  const selectedDeviceId = useSelector((state) => state.devices.selectedId);

  const item = devices[index];
  const position = useSelector((state) => state.session.positions[item.id]);

  const devicePrimary = useAttributePreference('devicePrimary', 'name');
  const deviceSecondary = useAttributePreference('deviceSecondary', '');

  const resolveFieldValue = (field) => {
    if (field === 'geofenceIds') {
      const geofenceIds = position?.geofenceIds;
      return geofenceIds?.length ? <GeofencesValue geofenceIds={geofenceIds} /> : null;
    }
    if (field === 'driverUniqueId') {
      const driverUniqueId = position?.attributes?.driverUniqueId;
      return driverUniqueId ? <DriverValue driverUniqueId={driverUniqueId} /> : null;
    }
    if (field === 'motion') {
      return <MotionBar deviceId={item.id} />;
    }
    return item[field];
  };

  const primaryValue = resolveFieldValue(devicePrimary);
  const secondaryValue = resolveFieldValue(deviceSecondary);

  const statusColor = getStatusColor(item.status);

  const secondaryText = () => {
    let status;
    if (item.status === 'online' || !item.lastUpdate) {
      status = formatStatus(item.status, t);
    } else {
      status = dayjs(item.lastUpdate).fromNow();
    }
    const pending = item.attributes?.['mobile.pending'];
    const battery = item.attributes?.['mobile.battery'];
    const batteryHistory = item.attributes?.['mobile.batteryHistory'];
    const pendingColor = pending > 100 ? 'error' : pending > 50 ? 'warning' : null;
    return (
      <>
        {secondaryValue && (
          <>
            {secondaryValue}
            {' • '}
          </>
        )}
        <span className={classes[statusColor]}>{status}</span>
        {pending > 0 && (
          <>
            {' • '}
            <span className={pendingColor ? classes[pendingColor] : undefined}>
              {pending} {t('sharedPending')}
            </span>
          </>
        )}
        {battery != null && (
          <>
            {' • '}
            <span>🔋 {battery}%</span>
          </>
        )}
        {batteryHistory && selectedDeviceId === item.id && (
          <BatterySparkline history={batteryHistory} />
        )}
      </>
    );
  };

  return (
    <div style={style}>
      <ListItemButton
        key={item.id}
        onClick={() => dispatch(devicesActions.selectId(item.id))}
        disabled={!admin && item.disabled}
        selected={selectedDeviceId === item.id}
        className={selectedDeviceId === item.id ? classes.selected : null}
      >
        <ListItemAvatar>
          <Avatar
            className={cx(
              classes.avatar,
              statusColor === 'success' && classes.avatarOnline,
              statusColor === 'error' && classes.avatarOffline,
              statusColor === 'neutral' && classes.avatarUnknown,
            )}
          >
            <img className={classes.icon} src={mapIcons[mapIconKey(item.category)]} alt="" />
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={primaryValue}
          secondary={secondaryText()}
          slots={{
            primary: Typography,
            secondary: Typography,
          }}
          slotProps={{
            primary: { noWrap: true },
            secondary: { noWrap: true },
          }}
        />
        {position && (
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
            {position.attributes.hasOwnProperty('batteryLevel') && (
              <Tooltip
                title={`${t('positionBatteryLevel')}: ${formatPercentage(position.attributes.batteryLevel)}`}
              >
                <IconButton size="small">
                  {(position.attributes.batteryLevel > 70 &&
                    (position.attributes.charge ? (
                      <BatteryChargingFullIcon fontSize="small" className={classes.success} />
                    ) : (
                      <BatteryFullIcon fontSize="small" className={classes.success} />
                    ))) ||
                    (position.attributes.batteryLevel > 30 &&
                      (position.attributes.charge ? (
                        <BatteryCharging60Icon fontSize="small" className={classes.warning} />
                      ) : (
                        <Battery60Icon fontSize="small" className={classes.warning} />
                      ))) ||
                    (position.attributes.charge ? (
                      <BatteryCharging20Icon fontSize="small" className={classes.error} />
                    ) : (
                      <Battery20Icon fontSize="small" className={classes.error} />
                    ))}
                </IconButton>
              </Tooltip>
            )}
          </>
        )}
      </ListItemButton>
    </div>
  );
};

export default DeviceRow;
