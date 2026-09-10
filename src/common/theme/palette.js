import { grey, green, indigo } from '@mui/material/colors';

export const SHIFT_RED = '#EB0045';
export const SHIFT_WHITE = '#FFFFFF';
export const SHIFT_GREEN = green[800];

const validatedColor = (color) => (/^#([0-9A-Fa-f]{3}){1,2}$/.test(color) ? color : null);

export default (server, darkMode) => ({
  mode: darkMode ? 'dark' : 'light',
  background: {
    default: darkMode ? grey[900] : grey[50],
  },
  primary: {
    main:
      validatedColor(server?.attributes?.colorPrimary) || (darkMode ? indigo[200] : indigo[900]),
  },
  secondary: {
    main:
      validatedColor(server?.attributes?.colorSecondary) || (darkMode ? green[200] : green[800]),
  },
  error: {
    main: SHIFT_RED,
  },
  neutral: {
    main: grey[500],
  },
  geometry: {
    main: '#3bb2d0',
  },
  alwaysDark: {
    main: grey[900],
  },
  shift: {
    onDutyOnline: SHIFT_GREEN,
    onDutyOffline: SHIFT_RED,
    offShift: SHIFT_RED,
  },
});
