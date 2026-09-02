import { useEffect } from 'react';
import { useTheme } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import { map } from '../core/MapView';
import { interpolateTurbo } from '../../common/util/colors';
import { speedFromKnots, speedUnitString } from '../../common/util/converter';
import { useTranslation } from '../../common/components/LocalizationProvider';
import { useAttributePreference } from '../../common/util/preferences';

const gradientStops = Array.from({ length: 10 }, (_, i) => {
  const [r, g, b] = interpolateTurbo(i / 9);
  return `rgb(${r}, ${g}, ${b})`;
}).join(', ');

const useStyles = makeStyles()(() => ({
  colorBar: {
    background: `linear-gradient(to right, ${gradientStops})`,
    height: 10,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.08)',
  },
  legendContainer: {
    background: 'rgba(22,22,31,0.72)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '8px 10px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 140,
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#F5F5F7',
    letterSpacing: '0.02em',
  },
}));

const MapSpeedLegend = ({ positions }) => {
  const theme = useTheme();
  const t = useTranslation();
  const speedUnit = useAttributePreference('speedUnit');
  const { classes } = useStyles();

  useEffect(() => {
    if (!positions.length) return undefined;
    const maxSpeed = positions.reduce((a, p) => Math.max(a, p.speed), -Infinity);
    const minSpeed = positions.reduce((a, p) => Math.min(a, p.speed), Infinity);
    if (!maxSpeed) return undefined;

    let container;
    const control = {
      onAdd: () => {
        container = document.createElement('div');
        container.className = 'maplibregl-ctrl';
        container.style.background = 'rgba(22,22,31,0.72)';
        container.style.backdropFilter = 'blur(16px)';
        container.style.WebkitBackdropFilter = 'blur(16px)';
        container.style.border = '1px solid rgba(255,255,255,0.08)';
        container.style.borderRadius = '8px';
        container.style.padding = '8px 10px';
        container.style.boxShadow = '0 8px 32px rgba(0,0,0,0.4)';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '4px';
        container.style.minWidth = '140px';
        const colorBar = document.createElement('div');
        colorBar.className = classes.colorBar;
        const label = document.createElement('span');
        label.style.fontSize = '11px';
        label.style.fontWeight = '600';
        label.style.color = '#F5F5F7';
        label.style.letterSpacing = '0.02em';
        const min = Math.round(speedFromKnots(minSpeed, speedUnit));
        const max = Math.round(speedFromKnots(maxSpeed, speedUnit));
        label.textContent = `${min} - ${max} ${speedUnitString(speedUnit, t)}`;
        container.appendChild(colorBar);
        container.appendChild(label);
        return container;
      },
      onRemove: () => container?.remove(),
    };
    map.addControl(control, theme.direction === 'rtl' ? 'bottom-right' : 'bottom-left');
    return () => map.removeControl(control);
  }, [positions, speedUnit, t, theme.direction, classes.colorBar]);

  return null;
};

export default MapSpeedLegend;
