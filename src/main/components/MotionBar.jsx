import { makeStyles } from 'tss-react/mui';
import { useSelector } from 'react-redux';

const useStyles = makeStyles()((theme) => ({
  root: {
    display: 'inline-flex',
    width: theme.spacing(16),
    height: theme.spacing(1),
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.06)',
    backdropFilter: 'blur(6px)',
  },
  moving: {
    background: 'linear-gradient(90deg, #00E676, #3BB2D0, #7C3AED, #00E676)',
    backgroundSize: '200% 100%',
    animation: 'dm-shift 1.6s linear infinite',
  },
  stopped: {
    backgroundColor: 'rgba(255,59,92,0.85)',
  },
  idle: {
    backgroundColor: 'rgba(255,179,0,0.85)',
  },
  '@keyframes dm-shift': {
    '0%': { backgroundPosition: '0% 50%' },
    '100%': { backgroundPosition: '200% 50%' },
  },
}));

const MotionBar = ({ deviceId }) => {
  const { classes } = useStyles();
  const segments = useSelector((state) => state.motion?.items?.[deviceId] || []);

  return (
    <span className={classes.root}>
      {segments.map((segment, segmentIndex) => (
        <span
          key={segmentIndex}
          style={{ flexGrow: segment.value, minWidth: segments.length > 16 ? 0 : 4 }}
          className={classes[segment.type] || classes.stopped}
        />
      ))}
    </span>
  );
};

export default MotionBar;
