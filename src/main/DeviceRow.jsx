import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';
import { Chip, ListItemAvatar, ListItemText, ListItemButton, Typography } from '@mui/material';
import { devicesActions } from '../store';
import { useAttributePreference } from '../common/util/preferences';
import { useAdministrator } from '../common/util/permissions';
import GeofencesValue from '../common/components/GeofencesValue';
import DriverValue from '../common/components/DriverValue';
import MotionBar from './components/MotionBar';
import DeviceAvatar from './components/DeviceAvatar';
import DevicePositionIcons from './components/DevicePositionIcons';
import DeviceSecondaryText from './components/DeviceSecondaryText';
import { useDeviceStatus } from './components/useDeviceStatus';

const useStyles = makeStyles()((theme) => ({
  selected: {
    backgroundColor: theme.palette.action.selected,
  },
}));

const resolveFieldValue = (item, position, field) => {
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

const DeviceRow = ({ devices, index, style }) => {
  const { classes } = useStyles();
  const dispatch = useDispatch();

  const admin = useAdministrator();
  const selectedDeviceId = useSelector((state) => state.devices.selectedId);

  const item = devices[index];
  const position = useSelector((state) => state.session.positions[item.id]);
  const { stateLabel, stateMuiColor, stateDisplayColor } = useDeviceStatus(item);
  const chipColor = stateMuiColor === 'neutral' ? 'default' : stateMuiColor;

  const devicePrimary = useAttributePreference('devicePrimary', 'name');
  const deviceSecondary = useAttributePreference('deviceSecondary', '');

  const primaryValue = resolveFieldValue(item, position, devicePrimary);
  const secondaryValue = resolveFieldValue(item, position, deviceSecondary);

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
          <DeviceAvatar device={item} displayColor={stateDisplayColor} />
        </ListItemAvatar>
        <ListItemText
          primary={primaryValue}
          secondary={<DeviceSecondaryText device={item} secondaryValue={secondaryValue} />}
          slots={{
            primary: Typography,
            secondary: Typography,
          }}
          slotProps={{
            primary: { noWrap: true },
            secondary: { noWrap: true, 'aria-live': 'polite' },
          }}
        />
        <Chip
          label={stateLabel}
          color={chipColor}
          size="small"
          aria-live="polite"
          sx={{ fontWeight: 500 }}
        />
        <DevicePositionIcons position={position} />
      </ListItemButton>
    </div>
  );
};

export default DeviceRow;
