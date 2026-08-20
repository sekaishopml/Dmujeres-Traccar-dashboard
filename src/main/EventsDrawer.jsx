import { useState, useMemo, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Box,
  CircularProgress,
} from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import DeleteIcon from '@mui/icons-material/Delete';
import dayjs from 'dayjs';
import { formatNotificationTitle, formatTime } from '../common/util/formatter';
import { useTranslation } from '../common/components/LocalizationProvider';
import { eventsActions } from '../store';
import fetchOrThrow from '../common/util/fetchOrThrow';

const useStyles = makeStyles()((theme) => ({
  drawer: {
    width: theme.dimensions.eventsDrawerWidth,
  },
  toolbar: {
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
  },
  title: {
    flexGrow: 1,
  },
  warning: {
    backgroundColor: 'rgba(255, 235, 59, 0.12)',
  },
  delete: {
    color: theme.palette.text.secondary,
  },
  filters: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    padding: theme.spacing(0, 2, 1.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  filterRow: {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  },
}));

const PERIODS = [
  { value: 'today', label: 'reportToday' },
  { value: 'yesterday', label: 'reportYesterday' },
  { value: 'thisWeek', label: 'reportThisWeek' },
  { value: 'thisMonth', label: 'reportThisMonth' },
  { value: 'custom', label: 'reportCustom' },
];

const EventsDrawer = ({ open, onClose }) => {
  const { classes } = useStyles();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const t = useTranslation();

  const devices = useSelector((state) => state.devices.items);
  const liveEvents = useSelector((state) => state.events.items);

  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [period, setPeriod] = useState('today');
  const [customFrom, setCustomFrom] = useState(dayjs().subtract(1, 'hour').format('YYYY-MM-DDTHH:mm'));
  const [customTo, setCustomTo] = useState(dayjs().format('YYYY-MM-DDTHH:mm'));
  const [apiEvents, setApiEvents] = useState(null);
  const [loading, setLoading] = useState(false);

  const deviceList = useMemo(
    () => Object.values(devices).sort((a, b) => a.name.localeCompare(b.name)),
    [devices],
  );

  const computeRange = useCallback(() => {
    const now = dayjs();
    switch (period) {
      case 'today':
        return { from: now.startOf('day'), to: now.endOf('day') };
      case 'yesterday':
        return { from: now.subtract(1, 'day').startOf('day'), to: now.subtract(1, 'day').endOf('day') };
      case 'thisWeek':
        return { from: now.startOf('week'), to: now.endOf('week') };
      case 'thisMonth':
        return { from: now.startOf('month'), to: now.endOf('month') };
      case 'custom':
        return { from: dayjs(customFrom), to: dayjs(customTo) };
      default:
        return { from: now.startOf('day'), to: now.endOf('day') };
    }
  }, [period, customFrom, customTo]);

  const handleShow = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = computeRange();
      const query = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      if (selectedDeviceId) {
        query.append('deviceId', selectedDeviceId);
      }
      query.append('type', 'allEvents');
      const response = await fetchOrThrow(`/api/reports/events?${query.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const events = await response.json();
      events.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));
      setApiEvents(events);
    } catch {
      setApiEvents([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDeviceId, computeRange]);

  // Si no se hizo búsqueda, mostrar eventos en vivo del Redux
  const displayEvents = apiEvents !== null ? apiEvents : liveEvents;

  const formatType = (event) =>
    formatNotificationTitle(t, {
      type: event.type,
      attributes: { alarms: event.attributes?.alarm },
    });

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Toolbar className={classes.toolbar} disableGutters>
        <Typography variant="h6" className={classes.title}>
          {t('reportEvents')}
        </Typography>
        {apiEvents === null && (
          <IconButton
            size="small"
            color="inherit"
            onClick={() => dispatch(eventsActions.deleteAll())}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        )}
      </Toolbar>

      <Box className={classes.filters}>
        <FormControl size="small" fullWidth>
          <InputLabel>{t('sharedDevice')}</InputLabel>
          <Select
            value={selectedDeviceId}
            label={t('sharedDevice')}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
          >
            <MenuItem value="">{t('notificationAlways')}</MenuItem>
            {deviceList.map((d) => (
              <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth>
          <InputLabel>{t('reportPeriod')}</InputLabel>
          <Select
            value={period}
            label={t('reportPeriod')}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {PERIODS.map((p) => (
              <MenuItem key={p.value} value={p.value}>{t(p.label)}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {period === 'custom' && (
          <Box className={classes.filterRow}>
            <TextField
              size="small"
              type="datetime-local"
              label={t('reportFrom')}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="datetime-local"
              label={t('reportTo')}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        )}

        <Button
          variant="contained"
          size="small"
          onClick={handleShow}
          disabled={loading}
          fullWidth
        >
          {loading ? <CircularProgress size={20} /> : t('reportShow')}
        </Button>
      </Box>

      <List className={classes.drawer} dense>
        {displayEvents.map((event) => (
          <ListItemButton
            key={event.id || `live-${event.eventTime}`}
            onClick={() => event.id && navigate(`/event/${event.id}`)}
            disabled={!event.id}
            className={event.attributes?.mobileSeverity === 'warning' ? classes.warning : undefined}
          >
            <ListItemText
              primary={`${devices[event.deviceId]?.name || ''} • ${formatType(event)}`}
              secondary={formatTime(event.eventTime, 'seconds')}
            />
            {apiEvents === null && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(eventsActions.delete(event));
                }}
              >
                <DeleteIcon fontSize="small" className={classes.delete} />
              </IconButton>
            )}
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
};

export default EventsDrawer;
