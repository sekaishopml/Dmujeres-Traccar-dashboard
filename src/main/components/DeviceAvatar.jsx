import { Avatar } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import { mapIconKey, mapIcons } from '../../map/core/preloadImages';

const useStyles = makeStyles()((theme) => ({
  icon: {
    width: '25px',
    height: '25px',
    filter: 'brightness(0) invert(1)',
  },
  avatarOnline: {
    backgroundColor: theme.palette.success.main,
  },
  avatarOffline: {
    backgroundColor: theme.palette.error.main,
  },
  avatarNoSignal: {
    backgroundColor: theme.palette.warning.main,
  },
  avatarStopped: {
    backgroundColor: theme.palette.info.main,
  },
  avatarNeutral: {
    backgroundColor: theme.palette.neutral.main,
  },
}));

/**
 * Avatar del dispositivo coloreado por el estado visible
 * (displayColor: warning / success / info / neutral).
 */
const DeviceAvatar = ({ device, displayColor }) => {
  const { classes } = useStyles();
  const avatarClass = (() => {
    switch (displayColor) {
      case 'success':
        return classes.avatarOnline;
      case 'warning':
        return classes.avatarNoSignal;
      case 'error':
        return classes.avatarOffline;
      case 'info':
        return classes.avatarStopped;
      default:
        return classes.avatarNeutral;
    }
  })();

  return (
    <Avatar className={avatarClass}>
      <img
        className={classes.icon}
        src={mapIcons[mapIconKey(device.category)]}
        alt={device.category || 'default'}
      />
    </Avatar>
  );
};

export default DeviceAvatar;
