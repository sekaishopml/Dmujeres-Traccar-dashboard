import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Sentry from '@sentry/react';
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
import { bearingDegrees, decimateForMatch, shouldCut } from '../map/util/pathDecimation';
import {
  analyzeStops,
  buildReplayLine,
  clockAudit,
  FLAG,
  flagAnomalies,
  integritySummary,
  isInStopSpans,
  linkTracksFor,
  offlinePeriods,
  splitMovingAndStops,
  syncDelayMs,
} from '../map/util/replayAudit';
import {
  MOTION_V2_COLORS,
  buildMotionV2Segments,
  formatMotionV2Duration,
  motionV2StateOf,
} from '../map/util/motionV2';
import { formatSpeed, formatTime } from '../common/util/formatter';
import { qualityColor, speedSourceLabel } from './qualityLabel';
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

// Haversine local (mismo patrón que MapRoutePoints: pathDecimation no la exporta).
const haversineMeters = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const la = toRad(a.latitude);
  const lb = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Velocidad en nudos o null (para tracks honestos [lon,lat,kn]).
const toSpeedOrNull = (p) => (Number.isFinite(Number(p.speed)) ? Number(p.speed) : null);

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
  // Pestaña del panel lateral: 0 = Paradas, 1 = Detalles del punto actual, 2 = Estados V2.
  const [panelTab, setPanelTab] = useState(0);
  // Velocidad en Detalles: reportada (Doppler del equipo) y derivada
  // (geometría ±2 fixes) por separado. El Doppler miente en 0 en marcha
  // (medido: 83/185 fixes en 0 moviéndose); la derivada lo respalda.
  // Banda muerta <2 km/h → 0 (jitter parado). Solo visual: los datos no se tocan.
  const detailSpeed = useMemo(() => {
    const pos = index < positions.length ? positions[index] : null;
    if (!pos) {
      return { reportedKmh: NaN, derivedKmh: NaN };
    }
    const reportedKn = Number(pos.speed);
    let impliedKn = NaN;
    const lo = positions[Math.max(0, index - 2)];
    const hi = positions[Math.min(positions.length - 1, index + 2)];
    if (lo && hi && lo !== hi) {
      const dt =
        (Date.parse(hi.fixTime || hi.deviceTime || hi.serverTime) -
          Date.parse(lo.fixTime || lo.deviceTime || lo.serverTime)) /
        1000;
      if (dt > 0) {
        impliedKn = haversineMeters(lo, hi) / dt / 0.514444;
      }
    }
    const reportedKmh = Number.isFinite(reportedKn) ? reportedKn * 1.852 : NaN;
    const derivedRaw = Number.isFinite(impliedKn) ? impliedKn * 1.852 : NaN;
    return {
      reportedKmh,
      derivedKmh: Number.isFinite(derivedRaw) && derivedRaw < 2 ? 0 : derivedRaw,
    };
  }, [positions, index]);
  const accuracyThresholdPref = useAttributePreference('web.accuracyThreshold', 250);
  const accuracyThreshold = Number.isFinite(Number(accuracyThresholdPref))
    ? Number(accuracyThresholdPref)
    : 250;
  // Auditoría del replay (solo lectura, nunca toca `positions`): paradas
  // enriquecidas (mismos índices que detectStops + precisión mediana),
  // banderas por fix, periodos sin cobertura, reloj e integridad.
  // Va DESPUÉS de `accuracyThreshold` a propósito (TDZ: usar un const antes
  // de declararlo en el cuerpo del componente rompe el render).
  const audit = useMemo(() => {
    const enriched = analyzeStops(positions);
    const flags = flagAnomalies(positions, { accuracyThreshold });
    const offline = offlinePeriods(positions);
    const clock = clockAudit(positions);
    return {
      stops: enriched,
      flags,
      offline,
      clock,
      integrity: integritySummary({
        positions,
        stops: enriched,
        offlinePeriods: offline,
        flags,
        clock,
      }),
    };
  }, [positions, accuracyThreshold]);
  const { stops } = audit;
  // Estados V2 (MotionStateV2 calculado por el servidor): tramos continuos
  // MOVING/PAUSED/STOPPED/UNKNOWN. [] con datos históricos (sin atributo).
  const motionV2Segments = useMemo(() => buildMotionV2Segments(positions), [positions]);
  const motionV2Active = motionV2StateOf(positions[index]);
  // Trazo pegado a carretera: segmentos matcheados por el servidor.
  // Si no hay match (matcher caído o sin vías), la línea honesta queda visible.
  const [matchSegments, setMatchSegments] = useState(null);
  // Calidad del match (0-1, puntos casados / evaluados) o null si no hay match:
  // sin dato real NO se muestra badge (nunca inventar).
  const [matchQuality, setMatchQuality] = useState(null);
  // Color de la línea casada (mismo que MapRouteMatch): la leyenda debe
  // mostrar la muestra "medido" con el color real del dispositivo.
  const matchReportColor = useSelector((state) => {
    const attributes = selectedDeviceId ? state.devices.items[selectedDeviceId]?.attributes : null;
    return attributes?.['web.reportColor'] || '#1a73e8';
  });
  // Spans de parada sobre `positions` crudas: esos fixes NO van al matcher
  // (el matcher los pegaría a la calle vecina y la parada se vería "fuera
  // del lugar"); se dibujan honestos y las flechas/marcador no hacen snap ahí.
  const stopSpans = useMemo(
    () => audit.stops.map((stop) => ({ from: stop.index, to: stop.index + stop.pointCount })),
    [audit],
  );
  // Partición marcha/parada + tracks de match SOLO de marcha + raws honestos
  // de paradas y conectores entre piezas (la ruta sigue continua).
  const pieces = useMemo(() => splitMovingAndStops(positions, audit.stops), [positions, audit]);
  const moveTracks = useMemo(
    () =>
      pieces
        .filter((piece) => piece.kind === 'move')
        .flatMap((piece) =>
          decimateForMatch(positions.slice(piece.from, piece.to), {
            hideInaccurate: false,
            accuracyThreshold,
          }).map((chunk) =>
            // [lon, lat, speed, accuracy?]: el 4º elemento (solo si el fix trae
            // accuracy real > 0) alimenta el sigma por punto del matcher.
            chunk.map((p) => {
              const point = [p.longitude, p.latitude, toSpeedOrNull(p)];
              if (Number.isFinite(p.accuracy) && p.accuracy > 0) {
                point.push(p.accuracy);
              }
              return point;
            }),
          ),
        ),
    [pieces, positions, accuracyThreshold],
  );
  const stopRaws = useMemo(
    () =>
      pieces
        .filter((piece) => piece.kind === 'stop')
        .map((piece) =>
          positions
            .slice(piece.from, piece.to)
            .map((p) => [p.longitude, p.latitude, toSpeedOrNull(p)]),
        )
        .filter((raw) => raw.length >= 1),
    [pieces, positions],
  );
  const linkRaws = useMemo(() => linkTracksFor(pieces, positions), [pieces, positions]);
  // Línea unificada: marchas casadas (o fallback honesto) + paradas y
  // conectores siempre honestos. `serverSegments` va alineado con moveTracks.
  const replayLine = useMemo(
    () =>
      buildReplayLine({
        moveTracks,
        serverSegments: matchSegments,
        stopRaws,
        links: linkRaws,
      }),
    [moveTracks, matchSegments, stopRaws, linkRaws],
  );

  // Vértices de la línea visible pegada a carretera (plano [lon,lat]): el
  // círculo GPS se centra SOBRE la línea y no al lado del fix crudo.
  // Fuente: la línea unificada (solo tramos casados; paradas nulas se saltan).
  const matchFlat = useMemo(() => {
    if (!Array.isArray(replayLine.segments)) {
      return [];
    }
    const flat = [];
    replayLine.segments.forEach((segment) => {
      if (Array.isArray(segment)) {
        segment.forEach(([longitude, latitude]) => flat.push({ longitude, latitude }));
      }
    });
    return flat;
  }, [replayLine]);
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
  // Snap con respeto a paradas: un fix dentro de una parada NO se pega a la
  // calle (se quedaría "fuera del lugar"); queda en su sitio honesto.
  const snapForIndex = useCallback(
    (longitude, latitude, rawIndex) => {
      if (isInStopSpans(rawIndex, stopSpans)) {
        return { longitude, latitude };
      }
      return snapToMatch(longitude, latitude);
    },
    [snapToMatch, stopSpans],
  );
  const snapForIndexRef = useRef(snapForIndex);
  snapForIndexRef.current = snapForIndex;
  const loaded = Boolean(from && to && !loading && positions.length);

  useEffect(() => {
    if (!loaded || positions.length < 2 || !moveTracks.length) {
      setMatchSegments(null);
      setMatchQuality(null);
      return;
    }
    let cancelled = false;
    const tracks = moveTracks;
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
            const ratio = Number(data.snappedRatio);
            setMatchQuality(Number.isFinite(ratio) ? ratio : null);
          } else {
            setMatchSegments(null);
            setMatchQuality(null);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMatchSegments(null);
          setMatchQuality(null);
          // El fallback honesto ya cubre al usuario; el error va a Sentry.
          try {
            Sentry.captureException(error, {
              tags: { area: 'replay-match' },
              extra: { deviceId: selectedDeviceId, tracks: tracks.length },
            });
          } catch {
            // telemetría nunca rompe el replay
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loaded, positions, selectedDeviceId, accuracyThreshold, moveTracks]);

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
          const snapped = snapForIndexRef.current(to.longitude, to.latitude, currentIndex + 1);
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
        // Extremos ajustados a la línea visible (match), salvo en parada: el
        // círculo pisa el trazo aunque el fix crudo esté a metros. Tiempos y
        // cortes con raw.
        const sFrom = snapForIndexRef.current(from.longitude, from.latitude, currentIndex);
        const sTo = snapForIndexRef.current(to.longitude, to.latitude, currentIndex + 1);
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
      const snapped = snapForIndex(fix.longitude, fix.latitude, index);
      map.jumpTo({ center: toMapCoordinates(snapped.longitude, snapped.latitude) });
    }
  }, [positions, index, playing, follow, snapForIndex]);

  // Posición visible del marcador: ajustada a la línea (match) para que el
  // círculo pise el trazo, salvo en parada (se queda en el edificio); la
  // tarjeta/label siguen con el fix crudo.
  const displayPosition = useMemo(() => {
    const fix = positions[index];
    if (!fix) {
      return fix;
    }
    const snapped = snapForIndex(fix.longitude, fix.latitude, index);
    return { ...fix, longitude: snapped.longitude, latitude: snapped.latitude };
  }, [positions, index, snapForIndex]);

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

  // Banderas de auditoría del fix actual (nombres localizados, en orden).
  // Después de `audit` y `formatStopDuration` a propósito (TDZ).
  const flagLabels = useMemo(() => {
    const list = (index < audit.flags.length ? audit.flags[index] : []) || [];
    const names = {
      [FLAG.TELEPORT]: t('replayFlagTeleport'),
      [FLAG.GAP]: t('replayFlagGap'),
      [FLAG.SPEED]: t('replayFlagSpeed'),
      [FLAG.TIME]: t('replayFlagTime'),
      [FLAG.DUPLICATE]: t('replayFlagDuplicate'),
      [FLAG.LOW_ACCURACY]: t('replayFlagLowAccuracy'),
      [FLAG.SYNCED]: t('replayFlagSynced'),
      [FLAG.CLOCK]: t('replayFlagClock'),
    };
    return list.map((code) => names[code] || code);
  }, [audit, index, t]);
  // Periodo sin cobertura que termina en el fix actual (si lo hay).
  const coverageGap = useMemo(
    () => audit.offline.find((period) => period.toIndex === index) || null,
    [audit, index],
  );
  // Retraso de sincronización del fix actual, ya formateado (vacío si fresco).
  const syncDelayCaption = useMemo(() => {
    if (index >= positions.length) {
      return '';
    }
    const delay = syncDelayMs(positions[index]);
    if (Number.isFinite(delay) && delay > 60000) {
      return ` · ${t('replayAuditSyncDelay')}: ${formatStopDuration(delay)}`;
    }
    return '';
  }, [positions, index, t]);

  // Resumen compacto de calidad del fix actual: clase con color, confianza
  // (0-100), fuente de velocidad, satélites y edad del fix (null si el fix
  // no expone ninguno de esos atributos).
  const qualitySummary = useMemo(() => {
    if (index >= positions.length) {
      return null;
    }
    const attrs = positions[index].attributes || {};
    const parts = [];
    if (attrs.qualityClass) {
      parts.push(attrs.qualityClass);
    }
    const confidence = Number(attrs.fixConfidence);
    if (Number.isFinite(confidence)) {
      parts.push(`${Math.round(confidence)}%`);
    }
    const sourceLabel = speedSourceLabel(attrs.speedSource, t);
    if (sourceLabel) {
      parts.push(sourceLabel);
    }
    const gnssUsed = Number(attrs.gnssUsed);
    const gnssTotal = Number(attrs.gnssTotal);
    if (Number.isFinite(gnssUsed) && Number.isFinite(gnssTotal)) {
      parts.push(`${gnssUsed}/${gnssTotal} ${t('replayAuditSatellites')}`);
    } else if (Number.isFinite(gnssUsed)) {
      parts.push(`${gnssUsed} ${t('replayAuditSatellites')}`);
    }
    const fixAgeSec = Number(attrs.fixAgeSec);
    if (Number.isFinite(fixAgeSec)) {
      parts.push(`${Math.round(fixAgeSec)} s`);
    }
    return parts.length
      ? { text: parts.join(' · '), color: qualityColor(attrs.qualityClass) }
      : null;
  }, [positions, index, t]);

  return (
    <div className={classes.root}>
      <MapView>
        <MapOverlay />
        <MapGeofence />
        {matchSegments ? (
          <MapRouteMatch
            segments={replayLine.segments}
            tracks={replayLine.tracks}
            deviceId={selectedDeviceId}
          />
        ) : (
          <MapRoutePath positions={positions} hideInaccurate={false} />
        )}
        <MapRoutePoints
          positions={positions}
          onClick={onPointClick}
          hideInaccurate={false}
          matchSegments={matchSegments ? replayLine.segments : null}
          rawSpans={stopSpans}
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
              <Typography variant="caption" align="center" display="block" color="textSecondary">
                {`${audit.integrity.rawCount} ${t('replayAuditPositions')} · ${audit.integrity.stopCount} ${t('reportReplayStops').toLowerCase()} · ${audit.integrity.offlineCount} ${t('replayAuditOffline')}`}
              </Typography>
              {/* Leyenda honesta: solo con match activo. Sólido = medido pegado
                  a vía; punteado = sin match (trazo crudo del fix). */}
              {matchSegments && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 2 }}>
                  <Typography
                    variant="caption"
                    color="textSecondary"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 0,
                        borderTop: `3px solid ${matchReportColor}`,
                        display: 'inline-block',
                      }}
                    />
                    {t('replayMatchLegendMeasured')}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="textSecondary"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 0,
                        borderTop: '3px dashed #777777',
                        display: 'inline-block',
                      }}
                    />
                    {t('replayMatchLegendEstimated')}
                  </Typography>
                </div>
              )}
              {/* Badge de calidad del match: % de puntos enviados que quedaron
                  pegados a vía. Sin match no hay dato y no se muestra. */}
              {matchSegments && matchQuality != null && (
                <Typography variant="caption" align="center" display="block" color="textSecondary">
                  {`${t('replayMatchQuality')}: ${Math.round(matchQuality * 100)}% · ${t('replayMatchSnappedPoints')}`}
                </Typography>
              )}
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
                  <Tab
                    label={`${t('motionV2States')} (${motionV2Segments.length})`}
                    sx={{ minHeight: 36, fontSize: '0.8rem' }}
                  />
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
                            secondary={`${formatStopDuration(stop.durationMs)} · ${stop.pointCount} ${t('reportReplayPoints')}${stop.accuracyMed != null ? ` · ±${Math.round(stop.accuracyMed)} m` : ''}`}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="caption" color="textSecondary">
                      {t('reportReplayNoStops')}
                    </Typography>
                  )
                ) : panelTab === 2 ? (
                  motionV2Segments.length ? (
                    <List dense disablePadding sx={{ maxHeight: 180, overflow: 'auto' }}>
                      {motionV2Segments.map((segment, segmentIndex) => (
                        <ListItemButton
                          key={segmentIndex}
                          dense
                          selected={
                            motionV2Active === segment.state &&
                            positions[index] &&
                            Date.parse(positions[index].fixTime) >= segment.start &&
                            Date.parse(positions[index].fixTime) <= segment.end
                          }
                          onClick={() => {
                            setPlaying(false);
                            const target = positions.findIndex(
                              (p) => Date.parse(p.fixTime) >= segment.start,
                            );
                            if (target >= 0) {
                              setIndex(target);
                            }
                            setPanelTab(1);
                          }}
                        >
                          <ListItemText
                            primary={
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: 2,
                                    background: MOTION_V2_COLORS[segment.state],
                                    display: 'inline-block',
                                  }}
                                />
                                {segment.state}
                              </span>
                            }
                            secondary={`${formatTime(segment.start, 'time')} → ${formatTime(segment.end, 'time')} · ${formatMotionV2Duration(segment.durationMs)}`}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="caption" color="textSecondary">
                      {t('motionV2NoData')}
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
                        {Number.isFinite(detailSpeed.reportedKmh) && (
                          <TableRow>
                            <TableCell>{t('replayAuditReportedSpeed')}</TableCell>
                            <TableCell align="right">
                              {`${formatSpeed(detailSpeed.reportedKmh / 1.852, 'kmh', t)}`}
                            </TableCell>
                          </TableRow>
                        )}
                        {Number.isFinite(detailSpeed.derivedKmh) && (
                          <TableRow>
                            <TableCell>{t('replayAuditDerivedSpeed')}</TableCell>
                            <TableCell align="right">
                              {`${formatSpeed(detailSpeed.derivedKmh / 1.852, 'kmh', t)}`}
                            </TableCell>
                          </TableRow>
                        )}
                        {Number.isFinite(Number(positions[index].accuracy)) && (
                          <TableRow>
                            <TableCell>{t('replayAuditAccuracy')}</TableCell>
                            <TableCell align="right">
                              {`±${Math.round(Number(positions[index].accuracy))} m`}
                            </TableCell>
                          </TableRow>
                        )}
                        {positions[index].attributes?.provider && (
                          <TableRow>
                            <TableCell>{t('replayAuditProvider')}</TableCell>
                            <TableCell align="right">
                              {positions[index].attributes.provider}
                            </TableCell>
                          </TableRow>
                        )}
                        {qualitySummary && (
                          <TableRow>
                            <TableCell>{t('replayAuditQuality')}</TableCell>
                            <TableCell
                              align="right"
                              sx={{ color: qualitySummary.color || 'text.primary' }}
                            >
                              {qualitySummary.text}
                            </TableCell>
                          </TableRow>
                        )}
                        {positions[index].deviceTime && (
                          <TableRow>
                            <TableCell>{t('positionDeviceTime')}</TableCell>
                            <TableCell align="right">
                              <PositionValue position={positions[index]} property="deviceTime" />
                            </TableCell>
                          </TableRow>
                        )}
                        {positions[index].attributes?.serverReceivedAt && (
                          <TableRow>
                            <TableCell>{t('replayAuditServerReceived')}</TableCell>
                            <TableCell align="right">
                              <PositionValue
                                position={positions[index]}
                                attribute="serverReceivedAt"
                              />
                              {syncDelayCaption}
                            </TableCell>
                          </TableRow>
                        )}
                        {coverageGap && (
                          <TableRow>
                            <TableCell>{t('replayAuditNoCoverage')}</TableCell>
                            <TableCell align="right">
                              {formatStopDuration(coverageGap.gapMs)}
                            </TableCell>
                          </TableRow>
                        )}
                        {flagLabels.length > 0 && (
                          <TableRow>
                            <TableCell>{t('replayAuditAnomalies')}</TableCell>
                            <TableCell align="right">{flagLabels.join(' · ')}</TableCell>
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
