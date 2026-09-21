import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';
import { Slide } from '@mui/material';
import { useTranslation } from '../../common/components/LocalizationProvider';
import {
  DEVICE_DISABLED,
  DEVICE_NO_SIGNAL,
  DEVICE_ONLINE,
  DEVICE_STOPPED,
  getDeviceStateLabelKey,
  selectDeviceState,
} from '../../common/util/shift';
import {
  NOTIFICATION_MS,
  enqueueNotification,
  markExiting,
  removeNotification,
  visibleNotifications,
} from '../../common/util/notificationQueue';

/** Color del punto por estado (misma semántica que la lista). */
const STATE_COLORS = {
  [DEVICE_ONLINE]: '#2E7D32',
  [DEVICE_STOPPED]: '#0288D1',
  [DEVICE_NO_SIGNAL]: '#ED6C02',
  [DEVICE_DISABLED]: '#9E9E9E',
};

const useStyles = makeStyles()((theme) => ({
  container: {
    position: 'fixed',
    zIndex: 9,
    right: theme.spacing(1.5),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: theme.spacing(0.75),
    pointerEvents: 'none',
    [theme.breakpoints.up('md')]: {
      bottom: theme.spacing(1.5),
    },
    [theme.breakpoints.down('md')]: {
      bottom: `calc(${theme.spacing(3)} + ${theme.dimensions.bottomBarHeight}px)`,
    },
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    minWidth: 272,
    maxWidth: 360,
    padding: theme.spacing(1.5, 2),
    borderRadius: 16,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    boxShadow: '0 10px 26px rgba(24,24,24,0.18)',
    // La animación de entrada/salida la maneja <Slide> (MUI): sube al entrar,
    // baja al salir; las keyframes de CSS no eran fiables aquí.
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    flexShrink: 0,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.15,
    minWidth: 0,
  },
  name: {
    fontWeight: 700,
    fontSize: '1.02rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  state: {
    fontSize: '0.85rem',
    color: theme.palette.text.secondary,
  },
}));

/**
 * Toasts de cambio de estado de los equipos (esquina inferior derecha).
 *
 * - Máx 3 visibles; el resto espera en cola (máx 5, descarta la más vieja).
 * - Cada una dura 5 s y sale con animación.
 * - No avisa en la primera carga (solo cambios reales de estado).
 */
const StateNotifications = () => {
  const { classes } = useStyles();
  const t = useTranslation();
  const devices = useSelector((state) => state.devices.items);
  const positions = useSelector((state) => state.session.positions);

  const prevStates = useRef(null);
  const timers = useRef(new Map());
  const [list, setList] = useState([]);

  // Detección de cambios de estado (nombre + evento).
  useEffect(() => {
    const current = {};
    Object.values(devices).forEach((device) => {
      current[device.id] = selectDeviceState(device, positions[device.id]);
    });
    if (prevStates.current === null) {
      prevStates.current = current;
      return;
    }
    const changes = [];
    Object.values(devices).forEach((device) => {
      const prev = prevStates.current[device.id];
      const next = current[device.id];
      if (prev && next && prev !== next) {
        changes.push({
          key: `${device.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: device.name,
          state: next,
        });
      }
    });
    prevStates.current = current;
    if (changes.length) {
      setList((old) => changes.reduce((acc, change) => enqueueNotification(acc, change), old));
    }
  }, [devices, positions]);

  // Temporizador por notificación VISIBLE (5 s desde que se muestra) + salida.
  useEffect(() => {
    const visibleNow = visibleNotifications(list);
    visibleNow.forEach((item) => {
      if (!timers.current.has(item.key)) {
        const timer = setTimeout(() => {
          timers.current.delete(item.key);
          setList((old) => markExiting(old, item.key));
          setTimeout(() => setList((old) => removeNotification(old, item.key)), 400);
        }, NOTIFICATION_MS);
        timers.current.set(item.key, timer);
      }
    });
    const alive = new Set(visibleNow.map((item) => item.key));
    timers.current.forEach((timer, key) => {
      if (!alive.has(key)) {
        clearTimeout(timer);
        timers.current.delete(key);
      }
    });
  }, [list]);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const visible = visibleNotifications(list);
  if (visible.length === 0) {
    return null;
  }

  return (
    <div className={classes.container} aria-live="polite">
      {visible.map((item) => (
        <Slide
          key={item.key}
          in={!item.exiting}
          direction="up"
          timeout={{ enter: 450, exit: 340 }}
          mountOnEnter
        >
          <div className={classes.card}>
            <span
              className={classes.dot}
              style={{ backgroundColor: STATE_COLORS[item.state] || STATE_COLORS[DEVICE_DISABLED] }}
            />
            <div className={classes.body}>
              <span className={classes.name}>{item.name}</span>
              <span className={classes.state}>{t(getDeviceStateLabelKey(item.state))}</span>
            </div>
          </div>
        </Slide>
      ))}
    </div>
  );
};

export default StateNotifications;
