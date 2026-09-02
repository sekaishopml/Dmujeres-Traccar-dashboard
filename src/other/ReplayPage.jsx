import { useState, useEffect, useRef, useCallback } from 'react';
import { IconButton, MenuItem, Paper, Select, Slider, Toolbar, Typography } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import TuneIcon from '@mui/icons-material/Tune';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import FastForwardIcon from '@mui/icons-material/FastForward';
import FastRewindIcon from '@mui/icons-material/FastRewind';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import MapView from '../map/core/MapView';
import MapRoutePath from '../map/MapRoutePath';
import MapRoutePoints from '../map/MapRoutePoints';
import MapPositions from '../map/MapPositions';
import { formatTime } from '../common/util/formatter';
import ReportFilter from '../reports/components/ReportFilter';
import { useTranslation } from '../common/components/LocalizationProvider';
import { useCatchCallback } from '../reactHelper';
import MapCamera from '../map/MapCamera';
import MapGeofence from '../map/MapGeofence';
import StatusCard from '../common/components/StatusCard';
import MapScale from '../map/MapScale';
import BackIcon from '../common/components/BackIcon';
import fetchOrThrow from '../common/util/fetchOrThrow';
import MapOverlay from '../map/overlay/MapOverlay';

const useStyles = makeStyles()((theme) => ({
  root: {
    height: '100%',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    zIndex: 3,
    left: 0,
    top: 0,
    margin: theme.spacing(1.5),
    width: theme.dimensions.drawerWidthDesktop,
    [theme.breakpoints.down('md')]: {
      width: '100%',
      margin: 0,
    },
  },
  title: {
    flexGrow: 1,
  },
  slider: {
    width: '100%',
  },
  controls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    background: 'rgba(17,17,17,0.75)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    color: '#ffffff',
    borderRadius: 16,
    padding: theme.spacing(0.5, 1.5),
  },
  formControlLabel: {
    height: '100%',
    width: '100%',
    paddingRight: theme.spacing(1),
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(2),
    background: 'rgba(22,22,31,0.72)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    [theme.breakpoints.down('md')]: {
      margin: theme.spacing(1),
      borderRadius: 12,
    },
    [theme.breakpoints.up('md')]: {
      marginTop: theme.spacing(1),
    },
  },
}));

const ReplayPage = () => {
  const t = useTranslation();
  const { classes } = useStyles();
  const navigate = useNavigate();
  const timerRef = useRef();

  const [searchParams] = useSearchParams();

  const defaultDeviceId = useSelector((state) => state.devices.selectedId);

  const [positions, setPositions] = useState([]);
  const [index, setIndex] = useState(0);
  const [selectedDeviceId, setSelectedDeviceId] = useState(defaultDeviceId);
  const [showCard, setShowCard] = useState(false);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [speed, setSpeed] = useState(1);

  const loaded = Boolean(from && to && !loading && positions.length);

  const deviceName = useSelector((state) => {
    if (selectedDeviceId) {
      const device = state.devices.items[selectedDeviceId];
      if (device) {
        return device.name;
      }
    }
    return null;
  });

  useEffect(() => {
    if (!from && !to) {
      setPositions([]);
    }
  }, [from, to, setPositions]);

  useEffect(() => {
    if (!playing || positions.length === 0) {
      clearTimeout(timerRef.current);
      return undefined;
    }
    if (index >= positions.length - 1) {
      clearTimeout(timerRef.current);
      setPlaying(false);
      return undefined;
    }
    const current = positions[index];
    const next = positions[index + 1];
    let deltaMs = NaN;
    if (current && next) {
      const currTime = Date.parse(current.fixTime || current.deviceTime || current.serverTime);
      const nextTime = Date.parse(next.fixTime || next.deviceTime || next.serverTime);
      if (Number.isFinite(currTime) && Number.isFinite(nextTime)) {
        deltaMs = nextTime - currTime;
      }
    }
    let delay;
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      delay = Math.min(2000, Math.max(100, deltaMs / (speed * 5)));
    } else {
      delay = 500 / speed;
    }
    timerRef.current = setTimeout(() => {
      setIndex((prev) => Math.min(prev + 1, positions.length - 1));
    }, delay);
    return () => clearTimeout(timerRef.current);
  }, [playing, positions, speed, index]);

  useEffect(() => {
    if (index >= positions.length - 1) {
      clearTimeout(timerRef.current);
      setPlaying(false);
    }
  }, [index, positions]);

  const onPointClick = useCallback(
    (_, index) => {
      setIndex(index);
    },
    [setIndex],
  );

  const onMarkerClick = useCallback(
    (positionId) => {
      setShowCard(!!positionId);
    },
    [setShowCard],
  );

  const onShow = useCatchCallback(
    async ({ deviceIds, from, to }) => {
      const deviceId = deviceIds.find(() => true);
      setLoading(true);
      setSelectedDeviceId(deviceId);
      const query = new URLSearchParams({ deviceId, from, to });
      try {
        const response = await fetchOrThrow(`/api/positions?${query.toString()}`);
        setIndex(0);
        const positions = await response.json();
        positions.sort((a, b) => new Date(a.fixTime) - new Date(b.fixTime));
        setPositions(positions);
        if (!positions.length) {
          throw Error(t('sharedNoData'));
        }
        setFilterOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const handleDownload = () => {
    const query = new URLSearchParams({ deviceId: selectedDeviceId, from, to });
    window.location.assign(`/api/positions/kml?${query.toString()}`);
  };

  return (
    <div className={classes.root}>
      <MapView>
        <MapOverlay />
        <MapGeofence />
        <MapRoutePath positions={positions} />
        <MapRoutePoints positions={positions} onClick={onPointClick} showSpeedControl />
        {index < positions.length && (
          <MapPositions
            positions={[positions[index]]}
            onMarkerClick={onMarkerClick}
            titleField="fixTime"
          />
        )}
      </MapView>
      <MapScale />
      <MapCamera positions={positions} />
      <div className={classes.sidebar}>
        <Paper elevation={0} sx={{ borderRadius: 3, overflow: 'hidden', background: 'rgba(22,22,31,0.72)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Toolbar>
            <IconButton edge="start" sx={{ mr: 2 }} onClick={() => navigate(-1)}>
              <BackIcon />
            </IconButton>
            <Typography variant="h6" className={classes.title} sx={{ background: 'linear-gradient(135deg,#EB0045 0%,#7C3AED 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800, letterSpacing: '0.02em' }}>
              {t('reportReplay')}
            </Typography>
            {loaded && (
              <>
                <IconButton onClick={handleDownload}>
                  <DownloadIcon />
                </IconButton>
                <IconButton edge="end" onClick={() => setFilterOpen((open) => !open)}>
                  <TuneIcon />
                </IconButton>
              </>
            )}
          </Toolbar>
        </Paper>
        <Paper className={classes.content} elevation={0}>
          {loaded && !filterOpen && (
            <>
              <Typography variant="subtitle1" align="center" sx={{ fontWeight: 700, background: 'linear-gradient(135deg,#F5F5F7 0%,#9BA1B6 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {deviceName}
              </Typography>
              <Slider
                className={classes.slider}
                max={positions.length - 1}
                value={index}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) =>
                  positions[value] ? formatTime(positions[value].fixTime, 'seconds') : ''
                }
                onChange={(_, index) => setIndex(index)}
                sx={{
                  color: '#FF2D8A',
                  height: 6,
                  '& .MuiSlider-rail': { backgroundColor: 'rgba(255,255,255,0.15)', opacity: 1, height: 6, borderRadius: 999 },
                  '& .MuiSlider-track': { background: 'linear-gradient(135deg,#EB0045 0%,#7C3AED 100%)', height: 6, borderRadius: 999, border: 'none' },
                  '& .MuiSlider-thumb': {
                    width: 18,
                    height: 18,
                    background: 'linear-gradient(135deg,#FF2D8A 0%,#7C3AED 100%)',
                    border: '2px solid #FFFFFF',
                    boxShadow: '0 0 12px rgba(255,45,138,0.6)',
                    '&:hover, &.Mui-active': { boxShadow: '0 0 16px rgba(255,45,138,0.8)', width: 20, height: 20 },
                  },
                  '& .MuiSlider-valueLabel': { backgroundColor: 'rgba(20,20,28,0.9)', color: '#F5F5F7', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)' },
                }}
              />
              <div className={classes.controls}>
                <Typography variant="caption" sx={{ color: '#ffffff', fontWeight: 600, minWidth: 56 }}>
                  {`${index + 1}/${positions.length}`}
                </Typography>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <IconButton
                    size="small"
                    onClick={() => setIndex((index) => index - 1)}
                    disabled={playing || index <= 0}
                    sx={{ color: '#ffffff', '&:hover': { background: 'rgba(255,255,255,0.08)' } }}
                  >
                    <FastRewindIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setPlaying(!playing)}
                    disabled={index >= positions.length - 1}
                    sx={{
                      color: '#ffffff',
                      background: playing ? 'rgba(255,45,138,0.16)' : 'linear-gradient(135deg,#EB0045 0%,#7C3AED 100%)',
                      borderRadius: '50%',
                      width: 36,
                      height: 36,
                      boxShadow: playing ? 'none' : '0 4px 16px rgba(255,45,138,0.4)',
                      '&:hover': { background: playing ? 'rgba(255,45,138,0.22)' : 'linear-gradient(135deg,#FF2D8A 0%,#8B5CF6 100%)' },
                    }}
                  >
                    {playing ? <PauseIcon /> : <PlayArrowIcon />}
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setIndex((index) => index + 1)}
                    disabled={playing || index >= positions.length - 1}
                    sx={{ color: '#ffffff', '&:hover': { background: 'rgba(255,255,255,0.08)' } }}
                  >
                    <FastForwardIcon />
                  </IconButton>
                  <Select
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    size="small"
                    variant="outlined"
                    sx={{
                      minWidth: 64,
                      height: 28,
                      fontSize: '0.8125rem',
                      fontWeight: 700,
                      color: '#ffffff',
                      ml: 0.5,
                      background: 'rgba(255,255,255,0.10)',
                      backdropFilter: 'blur(12px)',
                      borderRadius: '999px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                      '& .MuiSelect-select': { padding: '4px 8px', display: 'flex', alignItems: 'center' },
                      '& .MuiSelect-icon': { fontSize: '1rem', right: 6, color: '#ffffff' },
                    }}
                  >
                    {[1, 2, 4, 8, 10, 16].map((value) => (
                      <MenuItem key={value} value={value}>{`x${value}`}</MenuItem>
                    ))}
                  </Select>
                </div>
                <Typography variant="caption" sx={{ color: '#ffffff', fontWeight: 600, minWidth: 72, textAlign: 'right', fontSize: '0.68rem' }}>
                  {formatTime(positions[index].fixTime, 'seconds')}
                </Typography>
              </div>
            </>
          )}
          <div style={{ display: loaded && !filterOpen ? 'none' : 'block' }}>
            <ReportFilter onShow={onShow} deviceType="single" loading={loading} />
          </div>
        </Paper>
      </div>
      {showCard && index < positions.length && (
        <StatusCard
          deviceId={selectedDeviceId}
          position={positions[index]}
          onClose={() => setShowCard(false)}
          disableActions
        />
      )}
    </div>
  );
};

export default ReplayPage;
