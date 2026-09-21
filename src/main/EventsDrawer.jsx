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
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import Grow from '@mui/material/Grow';
import dayjs from 'dayjs';
import { formatNotificationTitle, formatTime } from '../common/util/formatter';
import { formatEventCauseDetail } from '../common/util/shift';
import { useTranslation } from '../common/components/LocalizationProvider';
import { eventsActions } from '../store';
import fetchOrThrow from '../common/util/fetchOrThrow';
import { processEvents } from '../common/util/eventDigest';

const useStyles = makeStyles()((theme) => ({
  drawer: {
    width: theme.dimensions.eventsDrawerWidth,
  },
  toolbar: {
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  title: {
    flexGrow: 1,
    fontWeight: 700,
  },
  row: {
    padding: theme.spacing(1.25, 2),
    borderBottom: `1px solid ${theme.palette.divider}`,
    borderRadius: 0,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    marginRight: theme.spacing(1.5),
  },
  name: {
    fontWeight: 600,
  },
  detail: {
    color: theme.palette.text.secondary,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4, 2),
    color: theme.palette.text.secondary,
  },
  // Botón MOSTRAR: negro elegante; al pasar el mouse, rojo DMujeres.
  showButton: {
    backgroundColor: '#181818',
    color: '#FFFFFF',
    fontWeight: 600,
    letterSpacing: '0.4px',
    borderRadius: 8,
    boxShadow: 'none',
    transition: 'background-color 160ms ease',
    '&:hover': {
      backgroundColor: '#EB0045',
      boxShadow: 'none',
    },
    '&.Mui-disabled': {
      backgroundColor: 'rgba(24,24,24,0.35)',
      color: 'rgba(255,255,255,0.75)',
    },
  },
  // Dispositivo y Período: negro elegante en reposo; rojo DMujeres al enfocar.
  filterField: {
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: 'rgba(24,24,24,0.35)',
    },
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: '#181818',
    },
    '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: '#EB0045',
      borderWidth: 2,
    },
    '& .MuiInputLabel-root': {
      color: '#181818',
      fontWeight: 500,
    },
    '& .MuiInputLabel-root.Mui-focused': {
      color: '#EB0045',
    },
    '& .MuiSelect-icon': {
      color: '#181818',
    },
  },
  // Cubo de basura: rojo DMujeres (con fondo suave al pasar el mouse).
  delete: {
    color: '#EB0045',
    '&:hover': {
      backgroundColor: 'rgba(235, 0, 69, 0.08)',
    },
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
  const [customFrom, setCustomFrom] = useState(() =>
    dayjs().subtract(1, 'hour').format('YYYY-MM-DDTHH:mm'),
  );
  const [customTo, setCustomTo] = useState(() => dayjs().format('YYYY-MM-DDTHH:mm'));
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
        return {
          from: now.subtract(1, 'day').startOf('day'),
          to: now.subtract(1, 'day').endOf('day'),
        };
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

  // Si no se hizo búsqueda, mostrar eventos en vivo del Redux.
  const rawEvents = apiEvents !== null ? apiEvents : liveEvents;
  // R9: solo lo relevante para la empresa (jornadas, conexión desde/hasta,
  // actualización de app y botón OTA) — sin duplicar estados de presencia.
  const displayEvents = useMemo(() => processEvents(rawEvents), [rawEvents]);

  const hhmm = (epoch) =>
    new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const fullTime = (epoch) => new Date(epoch).toLocaleString();

  /** Presentación de cada tipo: color del punto + textos legibles. */
  const eventMeta = (event) => {
    switch (event.type) {
      case 'mobileJourneyStarted':
        return { color: '#2E7D32', label: t('eventMobileJourneyStarted'), detail: fullTime(event.eventTime) };
      case 'mobileJourneyEnded':
        return { color: '#EB0045', label: t('eventMobileJourneyEnded'), detail: fullTime(event.eventTime) };
      case 'mobileConnectionProblem': {
        const since = event.attributes?.since;
        const until = event.attributes?.until;
        const minutes = until ? Math.max(1, Math.round((until - since) / 60000)) : null;
        return {
          color: '#ED6C02',
          label: t('eventMobileConnectionProblem'),
          detail: until
            ? `${hhmm(since)} → ${hhmm(until)} · ${minutes} min`
            : `${hhmm(since)} → sin conexión`,
        };
      }
      case 'mobileAppUpdated':
        return {
          color: '#0288D1',
          label: t('eventMobileAppUpdated'),
          detail: event.attributes?.from && event.attributes?.to
            ? `${event.attributes.from} → ${event.attributes.to}`
            : fullTime(event.eventTime),
        };
      case 'mobileOtaManual':
        return { color: '#0288D1', label: t('eventMobileOtaManual'), detail: fullTime(event.eventTime) };
      default:
        return {
          color: '#9E9E9E',
          label: formatNotificationTitle(t, { type: event.type, attributes: {} }) || event.type,
          detail: fullTime(event.eventTime),
        };
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Toolbar className={classes.toolbar} disableGutters>
        <Typography variant="h6" className={classes.title}>
          {t('reportEvents')}
        </Typography>
        {apiEvents === null && (
          <IconButton
            size="small"
            className={classes.delete}
            onClick={() => dispatch(eventsActions.deleteAll())}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        )}
      </Toolbar>

      <Box className={classes.filters}>
        <FormControl size="small" fullWidth className={classes.filterField}>
          <InputLabel>{t('sharedDevice')}</InputLabel>
          <Select
            value={selectedDeviceId}
            label={t('sharedDevice')}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
          >
            <MenuItem value="">{t('notificationAlways')}</MenuItem>
            {deviceList.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth className={classes.filterField}>
          <InputLabel>{t('reportPeriod')}</InputLabel>
          <Select
            value={period}
            label={t('reportPeriod')}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {PERIODS.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {t(p.label)}
              </MenuItem>
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
          className={classes.showButton}
        >
          {loading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : t('reportShow')}
        </Button>
      </Box>

      <List className={classes.drawer} dense>
        {displayEvents.length === 0 && (
          <div className={classes.empty}>
            <NotificationsNoneIcon fontSize="large" />
            <Typography variant="body2">{t('eventsNoData')}</Typography>
          </div>
        )}
        {displayEvents.map((event, index) => {
          const meta = eventMeta(event);
          const navId = event.originalId || event.id;
          return (
            <Grow in key={event.id || `live-${event.eventTime}-${index}`} timeout={200}>
              <ListItemButton
                onClick={() => navId && navigate(`/event/${navId}`)}
                disabled={!navId}
                className={classes.row}
              >
                <span className={classes.dot} style={{ backgroundColor: meta.color }} />
                <ListItemText
                  primary={
                    <span>
                      <span className={classes.name}>{devices[event.deviceId]?.name || ''}</span>
                      <span className={classes.detail}>{` · ${meta.label}`}</span>
                    </span>
                  }
                  secondary={<span className={classes.detail}>{meta.detail}</span>}
                  slotProps={{ secondary: { noWrap: true } }}
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
            </Grow>
          );
        })}
      </List>
    </Drawer>
  );
};

export default EventsDrawer;
