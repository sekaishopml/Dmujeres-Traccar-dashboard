import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { CssBaseline, StyledEngineProvider } from '@mui/material';
import store from './store';
import { LocalizationProvider } from './common/components/LocalizationProvider';
import ErrorHandler from './common/components/ErrorHandler';
import Navigation from './Navigation';
import preloadImages from './map/core/preloadImages';
import NativeInterface from './common/components/NativeInterface';
import ServerProvider from './ServerProvider';
import ErrorBoundary from './ErrorBoundary';
import AppThemeProvider from './AppThemeProvider';

preloadImages();

// Telemetría del panel (mismo proyecto Sentry que la app): caza errores de
// replay/match que antes eran silenciosos. DSN público, sin PII (sin IP).
Sentry.init({
  dsn: 'https://1f47e345c56f117bf87d9221a403e53a@o4511839263064064.ingest.us.sentry.io/4512058795491328',
  environment: 'production',
  tracesSampleRate: 0.1,
  beforeSend: (event) => {
    if (event.user) {
      event.user.ipAddress = null;
    }
    return event;
  },
});

const root = createRoot(document.getElementById('root'));
root.render(
  <ErrorBoundary>
    <Provider store={store}>
      <LocalizationProvider>
        <StyledEngineProvider injectFirst>
          <AppThemeProvider>
            <CssBaseline />
            <ServerProvider>
              <BrowserRouter>
                <Navigation />
              </BrowserRouter>
              <ErrorHandler />
              <NativeInterface />
            </ServerProvider>
          </AppThemeProvider>
        </StyledEngineProvider>
      </LocalizationProvider>
    </Provider>
  </ErrorBoundary>,
);
