import { grey, green, indigo } from '@mui/material/colors';

const validatedColor = (color) => (/^#([0-9A-Fa-f]{3}){1,2}$/.test(color) ? color : null);

export default (server, darkMode) => ({
  mode: darkMode ? 'dark' : 'light',
  background: {
    default: '#0A0B14',
    paper: 'rgba(22,22,31,0.62)',
  },
  primary: {
    main: validatedColor(server?.attributes?.colorPrimary) || '#FF2D8A',
    light: '#FF5AA8',
    dark: '#C2185B',
    contrastText: '#FFFFFF',
  },
  secondary: {
    main: validatedColor(server?.attributes?.colorSecondary) || '#7C3AED',
    light: '#9D6BFF',
    dark: '#5B2EC0',
    contrastText: '#FFFFFF',
  },
  neutral: {
    main: grey[500],
  },
  geometry: {
    main: '#3BB2D0',
  },
  success: {
    main: '#00E676',
    light: '#69F0AE',
    dark: '#00C853',
    contrastText: '#0A0B14',
  },
  warning: {
    main: '#FFB300',
    light: '#FFD54F',
    dark: '#FF8F00',
    contrastText: '#0A0B14',
  },
  error: {
    main: '#FF3B5C',
    light: '#FF6B8A',
    dark: '#E00034',
    contrastText: '#FFFFFF',
  },
  text: {
    primary: '#F5F5F7',
    secondary: '#9BA1B6',
    disabled: 'rgba(245,245,247,0.38)',
  },
  divider: 'rgba(255,255,255,0.08)',
  border: {
    main: 'rgba(255,255,255,0.08)',
  },
  action: {
    active: 'rgba(245,245,247,0.9)',
    hover: 'rgba(255,255,255,0.06)',
    selected: 'rgba(255,45,138,0.12)',
    disabled: 'rgba(245,245,247,0.3)',
    disabledBackground: 'rgba(255,255,255,0.08)',
  },
  alwaysDark: {
    main: grey[900],
  },
  gradients: {
    primary: 'linear-gradient(135deg,#EB0045 0%,#7C3AED 100%)',
    primaryNeon: 'linear-gradient(135deg,#FF2D8A 0%,#7C3AED 100%)',
    secondary: 'linear-gradient(135deg,#7C3AED 0%,#3BB2D0 100%)',
    darkGlass: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
  },
});
