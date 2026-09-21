import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Alert,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem as SelectItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
} from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import { useTranslation } from '../common/components/LocalizationProvider';
import fetchOrThrow from '../common/util/fetchOrThrow';
import {
  NOT_REPORTED,
  continuitySummary,
  fleetRow,
  formatDuration,
  sortFleet,
} from '../common/util/dmujeresFleet';

const useStyles = makeStyles()((theme) => ({
  page: {
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
  health: { fontWeight: 600 },
}));

const healthColor = (health) => {
  switch (health) {
    case 'LIVE':
      return 'success';
    case 'DEGRADED':
      return 'warning';
    case 'SILENT':
    case 'OFFLINE':
      return 'error';
    default:
      return 'default';
  }
};

const DmujeresHealthPage = () => {
  const { classes } = useStyles();
  const t = useTranslation();
  const devices = useSelector((state) => state.devices.items);
  const [selectedId, setSelectedId] = useState('');
  const [continuity, setContinuity] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const rows = sortFleet(Object.values(devices).map(fleetRow));

  useEffect(() => {
    if (!selectedId) {
      setContinuity(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOrThrow(`/api/devices/${selectedId}/continuity?limit=5`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setContinuity(data);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar la continuidad');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className={classes.page}>
      <Typography variant="h5">{t('dmujeresHealthTitle')}</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('dmujeresDevice')}</TableCell>
              <TableCell>{t('dmujeresHealthState')}</TableCell>
              <TableCell>{t('dmujeresJourney')}</TableCell>
              <TableCell>{t('dmujeresGps')}</TableCell>
              <TableCell>{t('dmujeresNetwork')}</TableCell>
              <TableCell>{t('dmujeresOutbox')}</TableCell>
              <TableCell>{t('dmujeresRecovery')}</TableCell>
              <TableCell>{t('dmujeresOem')}</TableCell>
              <TableCell>{t('dmujeresReadiness')}</TableCell>
              <TableCell>{t('dmujeresApp')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                hover
                selected={String(row.id) === String(selectedId)}
                onClick={() => setSelectedId(String(row.id))}
              >
                <TableCell>
                  {row.name}
                  {row.silent && (
                    <Chip
                      size="small"
                      color="error"
                      variant="outlined"
                      label={t('dmujeresSilent')}
                      sx={{ ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    className={classes.health}
                    color={healthColor(row.health)}
                    label={row.health}
                  />
                </TableCell>
                <TableCell>{row.journeyActive ? '●' : '—'}</TableCell>
                <TableCell>{row.gps}</TableCell>
                <TableCell>{row.network}</TableCell>
                <TableCell>{row.outbox ?? '—'}</TableCell>
                <TableCell>
                  {row.recovery}
                  {row.recoveryResult !== NOT_REPORTED ? ` (${row.recoveryResult})` : ''}
                </TableCell>
                <TableCell>
                  {row.oemKey || '—'}
                  {row.manufacturer ? ` · ${row.manufacturer} ${row.model}` : ''}
                </TableCell>
                <TableCell>{row.readiness}</TableCell>
                <TableCell>
                  {row.appVersion}
                  {row.androidVersion ? ` / A${row.androidVersion}` : ''}
                  {row.fcmRegistered ? ' · FCM' : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('dmujeresContinuity')}
          </Typography>
          <FormControl size="small" sx={{ minWidth: 260, mb: 2 }}>
            <InputLabel id="dmj-device-label">{t('dmujeresDevice')}</InputLabel>
            <Select
              labelId="dmj-device-label"
              label={t('dmujeresDevice')}
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {rows.map((row) => (
                <SelectItem key={row.id} value={String(row.id)}>
                  {row.name}
                </SelectItem>
              ))}
            </Select>
          </FormControl>
          {loading && <CircularProgress size={24} />}
          {error && <Alert severity="error">{error}</Alert>}
          {!loading && !error && selectedId && (continuity?.length || 0) === 0 && (
            <Typography color="text.secondary">{t('dmujeresNoContinuity')}</Typography>
          )}
          {!loading && (continuity?.length || 0) > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>journeyId</TableCell>
                  <TableCell>{t('dmujeresJourneyTime')}</TableCell>
                  <TableCell>{t('dmujeresTrackingTime')}</TableCell>
                  <TableCell>{t('dmujeresGapTime')}</TableCell>
                  <TableCell>{t('dmujeresContinuityPct')}</TableCell>
                  <TableCell>{t('dmujeresFixes')}</TableCell>
                  <TableCell>{t('dmujeresBiggestGap')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {continuity.map((entry) => {
                  const summary = continuitySummary(entry);
                  return (
                    <TableRow key={`${entry.journeyId || entry.sessionId}`}>
                      <TableCell>{entry.journeyId || entry.sessionId || '—'}</TableCell>
                      <TableCell>{summary?.journey || '—'}</TableCell>
                      <TableCell>{summary?.tracking || '—'}</TableCell>
                      <TableCell>{summary?.gap || '—'}</TableCell>
                      <TableCell>{summary ? `${summary.continuityPercent}%` : '—'}</TableCell>
                      <TableCell>{summary?.fixes ?? '—'}</TableCell>
                      <TableCell>{formatDuration(summary?.biggestGapMs)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DmujeresHealthPage;
