import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Slider,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tabs,
  Toolbar,
  Typography,
} from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import TuneIcon from '@mui/icons-material/Tune';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import FastForwardIcon from '@mui/icons-material/FastForward';
import FastRewindIcon from '@mui/icons-material/FastRewind';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { useNavigate, useSearchParams, Link as RouterLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import MapView, { map } from '../map/core/MapView';
import { toMapCoordinates } from '../map/core/mapUtil';
import MapRoutePath from '../map/MapRoutePath';
import MapRoutePoints from '../map/MapRoutePoints';
import MapRouteMatch from '../map/MapRouteMatch';
import MapReplayMarker from '../map/MapReplayMarker';
import {
  bearingDegrees,
  decimateForMatch,
  detectStops,
  shouldCut,
} from '../map/util/pathDecimation';
import { formatSpeed, formatTime } from '../common/util/formatter';
import ReportFilter from '../reports/components/ReportFilter';
import { useTranslation } from '../common/components/LocalizationProvider';
import { useCatchCallback } from '../reactHelper';
import MapCamera from '../map/MapCamera';
import MapGeofence from '../map/MapGeofence';
import MapScale from '../map/MapScale';
import BackIcon from '../common/components/BackIcon';
import PositionValue from '../common/components/PositionValue';
import fetchOrThrow from '../common/util/fetchOrThrow';
import MapOverlay from '../map/overlay/MapOverlay';
import { useAttributePreference } from '../common/util/preferences';

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
    background: theme.palette.background.paper,
    color: theme.palette.text.primary,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.spacing(1),
    padding: theme.spacing(0.25, 1),
  },
  followFab: {
    position: 'fixed',
    left: theme.spacing(1.5),
    bottom: theme.spacing(8),
    zIndex: 2,
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
    [theme.breakpoints.down('md')]: {
      margin: theme.spacing(1),
    },
    [theme.breakpoints.up('md')]: {
      marginTop: theme.spacing(1),
    },
  },
}));

// Duración (ms) de un tramo entre fixes consecutivos: misma compresión que el
// antiguo play por setTimeout (delta real / velocidad, acotado 100-2000 ms),
// pero el marcador la recorre interpolada en vez de saltar al final.
const segmentDurationMs = (current, next, replaySpeed) => {
  if (current && next) {
    const currTime = Date.parse(current.fixTime || current.deviceTime || current.serverTime);
    const nextTime = Date.parse(next.fixTime || next.deviceTime || next.serverTime);
    if (Number.isFinite(currTime) && Number.isFinite(nextTime)) {
      const deltaMs = nextTime - currTime;
      if (deltaMs > 0) {
        return Math.min(2000, Math.max(100, deltaMs / (replaySpeed * 5)));
      }
    }
  }
  return 500 / replaySpeed;
};

const ReplayPage = () => {
  const t = useTranslation();
  const { classes } = useStyles();
  const navigate = useNavigate();
  const markerRef = useRef(null);
  const segRef = useRef(null);
  const loadRef = useRef(null);

  const [searchParams] = useSearchParams();

  const defaultDeviceId = useSelector((state) => state.devices.selectedId);

  const [positions, setPositions] = useState([]);
  const [index, setIndex] = useState(0);
  const [selectedDeviceId, setSelectedDeviceId] = useState(defaultDeviceId);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const mapFollowPref = useAttributePreference('mapFollow', true);
  const [follow, setFollow] = useState(mapFollowPref);
  // Pestaña del panel lateral: 0 = Paradas, 1 = Detalles del punto actual.
  const [panelTab, setPanelTab] = useState(0);
  const stops = useMemo(() => detectStops(positions), [positions]);
  const accuracyThresholdPref = useAttributePreference('web.accuracyThreshold', 250);
  const accuracyThreshold = Number.isFinite(Number(accuracyThresholdPref))
    ? Number(accuracyThresholdPref)
    : 250;
  // Trazo pegado a carretera: segmentos matcheados por el servidor.
  // Si no hay match (matcher caído o sin vías), la línea honesta queda visible.
  const [matchSegments, setMatchSegments] = useState(null);
  // Input crudo enviado al match (mismo orden que segments): para los tramos
  // sin match se dibuja su línea honesta y ningún tramo queda vacío.
  const [matchTracks, setMatchTracks] = useState(null);

  // Vértices de la línea visible pegada a carretera (plano [lon,lat]): el
  // círculo GPS se centra SOBRE la línea y no al lado del fix crudo.
  const matchFlat = useMemo(() => {
    if (!Array.isArray(matchSegments)) {
      return [];
    }
    const flat = [];
    matchSegments.forEach((segment) => {
      if (Array.isArray(segment)) {
        segment.forEach(([longitude, latitude]) => flat.push({ longitude, latitude }));
      }
    });
    return flat;
  }, [matchSegments]);
  const snapToMatch = useCallback(
    (longitude, latitude) => {
      if (!matchFlat.length) {
        return { longitude, latitude };
      }
      let best = 0;
      let bestDist = Infinity;
      const cosLat = Math.cos((latitude * Math.PI) / 180);
      for (let i = 0; i < matchFlat.length; i += 1) {
        const p = matchFlat[i];
        const dLat = (p.latitude - latitude) * 111320;
        const dLon = (p.longitude - longitude) * 111320 * cosLat;
        const dist = dLat * dLat + dLon * dLon;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      return matchFlat[best];
    },
    [matchFlat],
  );
  // Espejo para el loop rAF (no reinicia la animación al llegar el match).
  const snapRef = useRef(snapToMatch);
  snapRef.current = snapToMatch;
  const loaded = Boolean(from && to && !loading && positions.length);

  useEffect(() => {
    if (!loaded || positions.length < 2) {
      setMatchSegments(null);
      setMatchTracks(null);
      return;
    }
    let cancelled = false;
    const tracks = decimateForMatch(positions, { hideInaccurate: false, accuracyThreshold }).map(
      (chunk) => chunk.map((p) => [p.longitude, p.latitude]),
    );
    fetchOrThrow('/api/positions/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: selectedDeviceId, tracks, accuracy: 25 }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          if (Array.isArray(data.segments) && data.segments.some(Array.isArray)) {
            setMatchSegments(data.segments);
            setMatchTracks(tracks);
          } else {
            setMatchSegments(null);
            setMatchTracks(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMatchSegments(null);
          setMatchTracks(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loaded, positions, selectedDeviceId, accuracyThreshold]);

  // Espejos para el loop rAF: el efecto solo depende de [playing, positions]
  // y lee el resto por refs, así ni el slider ni la velocidad ni el follow
  // reinician la animación a mitad de tramo.
  const indexRef = useRef(index);
  indexRef.current = index;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const followRef = useRef(follow);
  followRef.current = follow;

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

  // Play fluido: requestAnimationFrame interpola lat/lon entre fixes
  // consecutivos según su delta temporal real / velocidad (x1..x16). El
  // marcador se empuja directo a la fuente maplibre (sin setState por
  // frame); solo hay setIndex al cambiar de fix, para slider y contador.
  // Los cortes de línea (gap/teleport) se saltan sin volar sobre el hueco.
  useEffect(() => {
    if (!playing || positions.length === 0) {
      segRef.current = null;
      return undefined;
    }
    let cancelled = false;
    let raf = 0;
    const centerOn = (longitude, latitude) => {
      map.jumpTo({ center: toMapCoordinates(longitude, latitude) });
    };
    const step = (now) => {
      if (cancelled) {
        return;
      }
      const list = positions;
      const replaySpeed = speedRef.current;
      const currentIndex = indexRef.current;
      if (currentIndex >= list.length - 1) {
        setPlaying(false);
        return;
      }
      let seg = segRef.current;
      if (!seg || seg.from !== currentIndex || seg.to !== currentIndex + 1) {
        const from = list[currentIndex];
        const to = list[currentIndex + 1];
        if (shouldCut(from, to)) {
          setIndex(currentIndex + 1);
          const snapped = snapRef.current(to.longitude, to.latitude);
          markerRef.current?.setPosition(
            { longitude: snapped.longitude, latitude: snapped.latitude },
            to,
          );
          if (followRef.current) {
            centerOn(snapped.longitude, snapped.latitude);
          }
          raf = requestAnimationFrame(step);
          return;
        }
        // Extremos ajustados a la línea visible (match): el círculo pisa el
        // trazo aunque el fix crudo esté a metros. Tiempos y cortes con raw.
        const sFrom = snapRef.current(from.longitude, from.latitude);
        const sTo = snapRef.current(to.longitude, to.latitude);
        seg = {
          from: currentIndex,
          to: currentIndex + 1,
          start: now,
          duration: segmentDurationMs(from, to, replaySpeed),
          speed: replaySpeed,
          bearing: bearingDegrees(sFrom, sTo),
          sFrom,
          sTo,
        };
        segRef.current = seg;
      }
      if (seg.speed !== replaySpeed) {
        // Cambio de velocidad a mitad de tramo: conserva el progreso.
        const progress = seg.duration > 0 ? (now - seg.start) / seg.duration : 1;
        seg.duration = segmentDurationMs(list[seg.from], list[seg.to], replaySpeed);
        seg.start = now - progress * seg.duration;
        seg.speed = replaySpeed;
      }
      const from = list[seg.from];
      const to = list[seg.to];
      // Si el match llegó a mitad de tramo, los extremos crudos siguen
      // sirviendo (snap es identidad sin match): no se reinicia nada.
      const sFrom = seg.sFrom || { longitude: from.longitude, latitude: from.latitude };
      const sTo = seg.sTo || { longitude: to.longitude, latitude: to.latitude };
      const progress = seg.duration > 0 ? (now - seg.start) / seg.duration : 1;
      if (progress >= 1) {
        setIndex(seg.to);
        segRef.current = null;
        markerRef.current?.setPosition(
          { longitude: sTo.longitude, latitude: sTo.latitude, rotation: seg.bearing },
          to,
        );
        if (followRef.current) {
          centerOn(sTo.longitude, sTo.latitude);
        }
        if (seg.to >= list.length - 1) {
          setPlaying(false);
          return;
        }
      } else {
        const longitude = sFrom.longitude + (sTo.longitude - sFrom.longitude) * progress;
        const latitude = sFrom.latitude + (sTo.latitude - sFrom.latitude) * progress;
        markerRef.current?.setPosition({ longitude, latitude, rotation: seg.bearing }, to);
        if (followRef.current) {
          centerOn(longitude, latitude);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      segRef.current = null;
    };
  }, [playing, positions]);

  // Si el usuario arrastra el mapa, se pausa el follow hasta pulsar
  // "seguir" (o reanudar con play).
  useEffect(() => {
    const handleDrag = () => setFollow(false);
    map.on('dragstart', handleDrag);
    return () => map.off('dragstart', handleDrag);
  }, []);

  // Con follow activo y en pausa, el slider recentra la cámara en el fix.
  // La carga inicial se salta para no pelear con el fitBounds de MapCamera.
  useEffect(() => {
    if (loadRef.current !== positions) {
      loadRef.current = positions;
      return;
    }
    if (playing || !follow || index >= positions.length) {
      return;
    }
    const fix = positions[index];
    if (fix) {
      const snapped = snapToMatch(fix.longitude, fix.latitude);
      map.jumpTo({ center: toMapCoordinates(snapped.longitude, snapped.latitude) });
    }
  }, [positions, index, playing, follow, snapToMatch]);

  // Posición visible del marcador: ajustada a la línea (match) para que el
  // círculo pise el trazo; la tarjeta/label siguen con el fix crudo.
  const displayPosition = useMemo(() => {
    const fix = positions[index];
    if (!fix) {
      return fix;
    }
    const snapped = snapToMatch(fix.longitude, fix.latitude);
    return { ...fix, longitude: snapped.longitude, latitude: snapped.latitude };
  }, [positions, index, snapToMatch]);

  const handleTogglePlay = () => {
    if (!playing) {
      setFollow(true);
    }
    setPlaying(!playing);
  };

  const onPointClick = useCallback(
    (_, index) => {
      setPlaying(false);
      setIndex(index);
      setPanelTab(1);
    },
    [setIndex],
  );

  const onMarkerClick = useCallback((positionId) => {
    if (positionId) {
      setPanelTab(1);
    }
  }, []);

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

  const formatStopDuration = (durationMs) => {
    const totalMinutes = Math.max(1, Math.round(durationMs / 60000));
    if (totalMinutes < 60) {
      return `${totalMinutes} min`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  };

  return (
    <div className={classes.root}>
      <MapView>
        <MapOverlay />
        <MapGeofence />
        {matchSegments ? (
          <MapRouteMatch
            segments={matchSegments}
            tracks={matchTracks}
            deviceId={selectedDeviceId}
          />
        ) : (
          <MapRoutePath positions={positions} hideInaccurate={false} />
        )}
        <MapRoutePoints
          positions={positions}
          onClick={onPointClick}
          hideInaccurate={false}
          matchSegments={matchSegments}
          matchTracks={matchTracks}
        />
        {index < positions.length && (
          <MapReplayMarker
            position={displayPosition}
            markerRef={markerRef}
            onMarkerClick={onMarkerClick}
          />
        )}
      </MapView>
      <MapScale />
      <MapCamera positions={positions} />
      <div className={classes.sidebar}>
        <Paper elevation={3} square>
          <Toolbar>
            <IconButton edge="start" sx={{ mr: 2 }} onClick={() => navigate(-1)}>
              <BackIcon />
            </IconButton>
            <Typography variant="h6" className={classes.title}>
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
        <Paper className={classes.content} square>
          {loaded && !filterOpen && (
            <>
              <Typography variant="subtitle1" align="center">
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
                  color: '#111111',
                  '& .MuiSlider-rail': { backgroundColor: '#dddddd' },
                  '& .MuiSlider-thumb': {
                    backgroundColor: '#ffffff',
                    border: '2px solid #111111',
                  },
                  '& .MuiSlider-valueLabel': { backgroundColor: '#111111', color: '#ffffff' },
                }}
              />
              <div className={classes.controls}>
                <Typography variant="caption" sx={{ color: 'text.primary' }}>
                  {`${index + 1}/${positions.length}`}
                </Typography>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <IconButton
                    size="small"
                    onClick={() => setIndex((index) => index - 1)}
                    disabled={playing || index <= 0}
                  >
                    <FastRewindIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={handleTogglePlay}
                    disabled={index >= positions.length - 1}
                  >
                    {playing ? <PauseIcon /> : <PlayArrowIcon />}
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setIndex((index) => index + 1)}
                    disabled={playing || index >= positions.length - 1}
                  >
                    <FastForwardIcon />
                  </IconButton>
                  <Select
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    size="small"
                    variant="standard"
                    sx={{
                      minWidth: 30,
                      fontSize: '0.8125rem',
                      color: 'text.primary',
                      ml: 0.25,
                      '& .MuiSelect-select': { padding: '2px 4px 2px 0' },
                      '& .MuiSelect-icon': { fontSize: '1rem', right: 0 },
                      '&:before, &:after': { display: 'none' },
                    }}
                  >
                    {[1, 2, 4, 8, 10, 16].map((value) => (
                      <MenuItem key={value} value={value}>{`x${value}`}</MenuItem>
                    ))}
                  </Select>
                </div>
                <Typography variant="caption" sx={{ color: 'text.primary' }}>
                  {formatTime(positions[index].fixTime, 'seconds')}
                </Typography>
              </div>
              <div style={{ marginTop: 4 }}>
                <Tabs
                  value={panelTab}
                  onChange={(_, value) => setPanelTab(value)}
                  variant="fullWidth"
                  sx={{ minHeight: 36 }}
                >
                  <Tab
                    label={`${t('reportReplayStops')} (${stops.length})`}
                    sx={{ minHeight: 36, fontSize: '0.8rem' }}
                  />
                  <Tab label={t('sharedShowDetails')} sx={{ minHeight: 36, fontSize: '0.8rem' }} />
                </Tabs>
                {panelTab === 0 ? (
                  stops.length ? (
                    <List dense disablePadding sx={{ maxHeight: 180, overflow: 'auto' }}>
                      {stops.map((stop) => (
                        <ListItemButton
                          key={stop.index}
                          dense
                          selected={index >= stop.index && index < stop.index + stop.pointCount}
                          onClick={() => {
                            setPlaying(false);
                            setIndex(stop.index);
                            setPanelTab(1);
                          }}
                        >
                          <ListItemText
                            primary={`${formatTime(stop.arrivalTime, 'time')} – ${formatTime(stop.departureTime, 'time')}`}
                            secondary={`${formatStopDuration(stop.durationMs)} · ${stop.pointCount} ${t('reportReplayPoints')}`}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="caption" color="textSecondary">
                      {t('reportReplayNoStops')}
                    </Typography>
                  )
                ) : index < positions.length ? (
                  <>
                    <Typography variant="subtitle2" align="center" sx={{ mt: 1 }}>
                      {deviceName}
                    </Typography>
                    <Table size="small">
                      <TableBody>
                        <TableRow>
                          <TableCell>{t('positionFixTime')}</TableCell>
                          <TableCell align="right">
                            <PositionValue position={positions[index]} property="fixTime" />
                          </TableCell>
                        </TableRow>
                        {positions[index].hasOwnProperty('address') && (
                          <TableRow>
                            <TableCell>{t('positionAddress')}</TableCell>
                            <TableCell align="right">
                              <PositionValue position={positions[index]} property="address" />
                            </TableCell>
                          </TableRow>
                        )}
                        {positions[index].hasOwnProperty('speed') && (
                          <TableRow>
                            <TableCell>{t('positionSpeed')}</TableCell>
                            <TableCell align="right">
                              {`${formatSpeed(positions[index].speed, 'kmh', t)}`}
                            </TableCell>
                          </TableRow>
                        )}
                        {positions[index].attributes?.hasOwnProperty('batteryLevel') && (
                          <TableRow>
                            <TableCell>{t('positionBatteryLevel')}</TableCell>
                            <TableCell align="right">
                              <PositionValue position={positions[index]} attribute="batteryLevel" />
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      <RouterLink to={`/position/${positions[index].id}`}>
                        {t('sharedShowDetails')}
                      </RouterLink>
                    </Typography>
                  </>
                ) : (
                  <Typography variant="caption" color="textSecondary">
                    {t('sharedNoData')}
                  </Typography>
                )}
              </div>
            </>
          )}
          <div style={{ display: loaded && !filterOpen ? 'none' : 'block' }}>
            <ReportFilter onShow={onShow} deviceType="single" loading={loading} />
          </div>
        </Paper>
      </div>
      {loaded && (
        <Paper elevation={3} className={classes.followFab}>
          <IconButton
            title={t('deviceFollow')}
            onClick={() => setFollow((value) => !value)}
            sx={{ opacity: follow ? 1 : 0.4 }}
          >
            <MyLocationIcon />
          </IconButton>
        </Paper>
      )}
    </div>
  );
};

export default ReplayPage;
