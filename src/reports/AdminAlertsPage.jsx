import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import BackupIcon from '@mui/icons-material/Backup';
import StorageIcon from '@mui/icons-material/Storage';
import DnsIcon from '@mui/icons-material/Dns';
import ScheduleIcon from '@mui/icons-material/Schedule';
import PageLayout from '../common/components/PageLayout';
import { useTranslation } from '../common/components/LocalizationProvider';
import fetchOrThrow from '../common/util/fetchOrThrow';
import { formatTime } from '../common/util/formatter';
import { formatAgeHours, formatBytes, formatUptime, groupAlerts } from '../common/util/adminAlerts';
import ReportsMenu from './components/ReportsMenu';

const useStyles = makeStyles()((theme) => ({
  page: {
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: theme.spacing(2),
  },
  systemCard: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
  },
  systemValue: {
    wordBreak: 'break-word',
  },
  alertRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    paddingTop: theme.spacing(1.5),
    paddingBottom: theme.spacing(1.5),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  alertBody: {
    flexGrow: 1,
  },
  clear: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    textAlign: 'center',
  },
}));

const SEVERITIES = [
  { key: 'critical', title: 'adminAlertsCritical', color: 'error', Icon: ErrorOutlineIcon },
  { key: 'warning', title: 'adminAlertsWarning', color: 'warning', Icon: WarningAmberIcon },
  { key: 'info', title: 'adminAlertsInfo', color: 'info', Icon: InfoOutlinedIcon },
];

const AdminAlertsPage = () => {
  const { classes } = useStyles();
  const t = useTranslation();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchOrThrow('/api/admin/alerts');
      setReport(await response.json());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const groups = groupAlerts(report?.alerts || []);
  const system = report?.system;

  const systemCards = system
    ? [
        {
          key: 'backup',
          Icon: BackupIcon,
          label: t('adminAlertsBackup'),
          value: system.backup?.available
            ? `${formatBytes(system.backup.sizeBytes)} · ${formatAgeHours(system.backup.ageHours)}`
            : t('adminAlertsNoBackup'),
        },
        {
          key: 'disk',
          Icon: StorageIcon,
          label: t('adminAlertsDisk'),
          value: system.disk?.available
            ? `${system.disk.usedPercent}% ${t('adminAlertsUsed')} · ${formatBytes(
                system.disk.usableBytes,
              )} ${t('adminAlertsFree')}`
            : t('adminAlertsNoData'),
        },
        {
          key: 'server',
          Icon: DnsIcon,
          label: t('adminAlertsServer'),
          value: formatUptime(system.uptimeSeconds) || t('adminAlertsNoData'),
        },
        {
          key: 'watchdog',
          Icon: ScheduleIcon,
          label: t('adminAlertsWatchdog'),
          value:
            system.watchdog?.available && system.watchdog.lines?.length
              ? system.watchdog.lines[system.watchdog.lines.length - 1]
              : t('adminAlertsNoData'),
        },
        {
          key: 'ingest',
          Icon: ErrorOutlineIcon,
          label: t('adminAlertsIngestRejections'),
          value:
            system.ingestRejections?.total > 0
              ? `${system.ingestRejections.total}`
              : '0',
        },
      ]
    : [];

  return (
    <PageLayout menu={<ReportsMenu />} breadcrumbs={['reportTitle', 'adminAlerts']}>
      <div className={classes.page}>
        <div className={classes.header}>
          <Typography variant="h5">{t('adminAlertsTitle')}</Typography>
          <Tooltip title={t('adminAlertsRefresh')}>
            <IconButton onClick={load} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </div>

        {error && <Alert severity="error">{t('adminAlertsLoadError')}</Alert>}

        {loading && !report && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {report && (
          <>
            <div className={classes.cardGrid}>
              {systemCards.map(({ key, Icon, label, value }) => (
                <Card key={key}>
                  <div className={classes.systemCard}>
                    <Icon color="action" />
                    <div>
                      <Typography variant="caption" color="text.secondary">
                        {label}
                      </Typography>
                      <Typography variant="body2" className={classes.systemValue} title={value}>
                        {value}
                      </Typography>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {report.alerts.length === 0 ? (
              <Card>
                <CardContent className={classes.clear}>
                  <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48 }} />
                  <Typography variant="h6">{t('adminAlertsAllClear')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('adminAlertsAllClearDetail')}
                  </Typography>
                </CardContent>
              </Card>
            ) : (
              SEVERITIES.filter(({ key }) => groups[key].length > 0).map(
                ({ key, title, color, Icon }) => (
                  <Card key={key}>
                    <CardContent>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Icon color={color} />
                        <Typography variant="h6">{t(title)}</Typography>
                        <Chip size="small" color={color} label={groups[key].length} />
                      </Stack>
                      {groups[key].map((alert, index) => (
                        <div key={`${key}-${index}`} className={classes.alertRow}>
                          <div className={classes.alertBody}>
                            <Typography variant="body2">{alert.message}</Typography>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                              <Chip
                                size="small"
                                variant="outlined"
                                label={alert.deviceName || t('adminAlertsSystemDevice')}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {formatTime(alert.ts, 'minutes')}
                              </Typography>
                            </Stack>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ),
              )
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
};

export default AdminAlertsPage;
