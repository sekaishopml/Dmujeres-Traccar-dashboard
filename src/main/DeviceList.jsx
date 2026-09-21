import { memo, useCallback, useEffect, useMemo, useReducer } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';
import { List } from 'react-window';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { devicesActions } from '../store';
import { useAsyncTask } from '../reactHelper';
import DeviceRow from './DeviceRow';
import fetchOrThrow from '../common/util/fetchOrThrow';
import usePersistedState from '../common/util/usePersistedState';
import { DEVICE_TYPE, HEADER_TYPE, buildGroupedRows } from '../common/util/deviceGrouping';

const useStyles = makeStyles()((theme) => ({
  list: {
    height: '100%',
    direction: theme.direction,
    // Fluidez de desplazamiento (misma base de diseño, solo scroll).
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain',
    '& > div': {
      willChange: 'transform',
    },
    // FIX: react-window pinta un contenedor aria-hidden que cubre la lista y
    // se come TODOS los clics (no se podía desplegar/contraer ni seleccionar).
    // Es un elemento de maquetación: nunca debe capturar punteros.
    '& [aria-hidden="true"]': {
      pointerEvents: 'none',
    },
  },
  listInner: {
    position: 'relative',
    margin: theme.spacing(1.5, 0),
  },
  groupRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0, 2),
    cursor: 'pointer',
    userSelect: 'none',
    borderBottom: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.default,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  groupChevron: {
    color: '#EB0045',
    fontSize: 20,
  },
  groupName: {
    fontWeight: 700,
    fontSize: '0.8rem',
    letterSpacing: '0.4px',
    color: '#181818',
  },
  groupCount: {
    fontSize: '0.75rem',
    color: theme.palette.text.secondary,
  },
}));

const HEADER_HEIGHT = 38;
const DEVICE_HEIGHT = 72;

const GroupHeaderRow = ({ style, classes, group, count, collapsed, onToggle }) => (
  <div style={style}>
    <div className={classes.groupRow} style={{ height: HEADER_HEIGHT }} onClick={onToggle}>
      {collapsed ? (
        <ChevronRightIcon className={classes.groupChevron} />
      ) : (
        <ExpandMoreIcon className={classes.groupChevron} />
      )}
      <span className={classes.groupName}>{group}</span>
      <span className={classes.groupCount}>({count})</span>
    </div>
  </div>
);

const GroupedRow = memo(({ index, style, rows, classes, collapsedGroups, onToggleGroup }) => {
  const row = rows[index];
  if (row.type === HEADER_TYPE) {
    return (
      <GroupHeaderRow
        style={style}
        classes={classes}
        group={row.group}
        count={row.count}
        collapsed={!!collapsedGroups[row.groupId]}
        onToggle={() => onToggleGroup(row.groupId)}
      />
    );
  }
  return <DeviceRow devices={[row.device]} index={0} style={style} />;
});

/**
 * Lista de dispositivos agrupada por DEPARTAMENTO (grupos Traccar) con
 * desplegar/contraer. Dentro de cada grupo se conserva el orden por estado
 * (En línea → Detenidos → Sin señal → Deshabilitado) y alfabético.
 * Los equipos sin grupo van en "Sin grupo" al final.
 */
const DeviceList = ({ devices }) => {
  const { classes } = useStyles();
  const dispatch = useDispatch();
  const groups = useSelector((state) => state.groups.items);
  const [collapsedGroups, setCollapsedGroups] = usePersistedState('collapsedDepartments', {});

  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const interval = setInterval(forceUpdate, 60000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  useAsyncTask(
    async ({ signal }) => {
      const response = await fetchOrThrow('/api/devices', { signal });
      dispatch(devicesActions.refresh(await response.json()));
    },
    [dispatch],
  );

  const rows = useMemo(
    () => buildGroupedRows(devices, groups, collapsedGroups),
    [devices, groups, collapsedGroups],
  );

  const onToggleGroup = useCallback(
    (groupId) => {
      setCollapsedGroups((previous) => ({ ...previous, [groupId]: !previous[groupId] }));
    },
    [setCollapsedGroups],
  );

  const rowProps = useMemo(
    () => ({ rows, classes, collapsedGroups, onToggleGroup }),
    [rows, classes, collapsedGroups, onToggleGroup],
  );

  return (
    <List
      className={classes.list}
      rowComponent={GroupedRow}
      rowCount={rows.length}
      rowHeight={(index) => (rows[index].type === HEADER_TYPE ? HEADER_HEIGHT : DEVICE_HEIGHT)}
      rowProps={rowProps}
      overscanCount={8}
    />
  );
};

export default DeviceList;
