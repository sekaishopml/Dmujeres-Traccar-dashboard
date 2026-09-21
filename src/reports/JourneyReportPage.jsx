import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, MenuItem, Paper, Select, Typography } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import ReplayIcon from '@mui/icons-material/Replay';
import { useSelector } from 'react-redux';
import { useTranslation } from '../common/components/LocalizationProvider';
import fetchOrThrow from '../common/util/fetchOrThrow';

const useStyles = makeStyles()(() => ({
  page: {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  filters: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  card: {
    borderLeft: '4px solid #0288D1',
    borderRadius: 12,
  },
  cardActive: {
    borderLeft: '4px solid #2E7D32',
    borderRadius: 12,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  name: {
    fontWeight: 700,
    minWidth: 120,
  },
  meta: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
    color: 'rgba(24,24,24,0.65)',
    fontSize: '0.85rem',
  },
  spacer: { flex: 1 },
}));

const isoDay = (date) => {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
};

const formatTime = (epoch) => new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDay = (epoch) => new Date(epoch).toLocaleDateString();
const formatDuration = (ms) => {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${Math.floor(ms / 3_600_000)}h ${m} min`.replace(`${Math.floor(ms / 3_600_000)}h ${m}`, `${h} h ${m} min`);
};

/**
 * R9: Reporte de JORNADAS — auditoría por colaborador.
 * Una fila por jornada (activa o cerrada): inicio/fin, duración, distancia,
 * puntos, huecos >60 s y enlace directo a la Repetición Ruta.
 */
const JourneyReportPage = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const t = useTranslation();
  const devices = useSelector((state) => state.devices.items);

  const [searchParams] = useSearchParams();
  const [deviceId, setDeviceId] = useState(Number(searchParams.get('deviceId')) || 0);
  const [fromDate, setFromDate] = useState(isoDay(Date.now()));
  const [toDate, setToDate] = useState(new Date().toISOString());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        deviceId: String(deviceId),
        from: new Date(fromDate).toISOString(),
        to: toDate,
      });
      const response = await fetchOrThrow(`/api/reports/journeys?${query.toString()}`);
      const report = await response.json();
      setRows(report.journeys || []);
    } catch (error) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [deviceId, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  const deviceName = (id) => devices[id]?.name || `#${id}`;

  return (
    <Box sx={{ padding: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper elevation={0} sx={{ p: 1.5 }}>
        <Typography variant="h6" fontWeight={700}>
          {t('reportJourneys')}
        </Typography>
      </Paper>

      <Paper elevation={0} sx={{ p: 1.5, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          value={deviceId}
          onChange={(event) => setDeviceId(Number(event.target.value))}
          displayEmpty
          size="small"
          sx={{ minWidth: 180 }}
        >
          <MenuItem value={0}>{t('sharedAllDevices')}</MenuItem>
          {Object.values(devices)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((device) => (
              <MenuItem key={device.id} value={device.id}>{device.name}</MenuItem>
            ))}
        </Select>
        <Select
          value={fromDate}
          onChange={(event) => {
            setFromDate(isoDay(event.target.value));
            setToDate(new Date().toISOString());
          }}
          size="small"
          sx={{ minWidth: 150 }}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((daysBack) => {
            const date = new Date(Date.now() - daysBack * 86_400_000);
            return (
              <MenuItem key={daysBack} value={isoDay(date)}>
                {formatDay(date.getTime())}
              </MenuItem>
            );
          })}
        </Select>
        <Button variant="contained" onClick={load} disabled={loading}>
          {t('adminAlertsRefresh')}
        </Button>
        <span className={classes.spacer} />
        <Typography variant="caption" color="text.secondary">
          {rows.length} {t('journeysTotal')}
        </Typography>
      </Paper>

      {rows.length === 0 && !loading && (
        <Paper elevation={0} sx={{ p: 2 }}>
          <Typography color="text.secondary">{t('journeysNoData')}</Typography>
        </Paper>
      )}

      {rows.map((journey) => (
        <Paper key={journey.journeyId + '-' + journey.start} elevation={1} sx={{ borderRadius: 3 }}>
          <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <Box sx={{ minWidth: 140 }}>
              <Typography sx={{ fontWeight: 700 }}>{deviceName(journey.deviceId)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {formatDay(journey.start)} {formatTime(journey.start)} →{' '}
                {journey.end ? `${formatDay(journey.end)} ${formatTime(journey.end)}` : ''}
              </Typography>
            </Box>
            {journey.active ? (
              <Chip label={t('journeysActive')} size="small" sx={{ backgroundColor: '#2E7D32', color: '#fff' }} />
            ) : (
              <Chip label={t('journeysEnded')} size="small" variant="outlined" />
            )}
            <Typography variant="body2">
              {formatDuration(journey.durationMs)}
            </Typography>
            <Typography variant="body2">
              {Math.round(journey.distanceM / 100) / 10} km
            </Typography>
            <Typography variant="body2">
              {journey.points} {t('journeysPoints')}
            </Typography>
            {journey.gapsOver60 > 0 ? (
              <Chip
                label={`${t('journeysGaps')} ${journey.gapsOver60}`}
                size="small"
                sx={{ backgroundColor: '#ED6C02', color: '#fff' }}
              />
            ) : (
              <Chip label={t('journeysFull')} size="small" sx={{ backgroundColor: '#2E7D32', color: '#fff' }} />
            )}
            <span style={{ flex: 1 }} />
            <Button
              size="small"
              variant="outlined"
              startIcon={<ReplayIcon />}
              onClick={() => navigate(
                `/replay?deviceId=${journey.deviceId}&from=${new Date(journey.start).toISOString()}&to=${journey.end ? new Date(journey.end).toISOString() : toDate}`,
              )}
            >
              {t('journeysView')}
            </Button>
          </Box>
        </Paper>
      ))}
    </Box>
  );
};

export default JourneyReportPage;
