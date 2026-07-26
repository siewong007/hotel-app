import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { logWebVitals } from './reportWebVitals';
import { initializeDesktopBackendUrl } from './desktop/runtimeApi';

const MODULE_RETRY_PARAM = 'module-retry';

function retryStaleDevelopmentModule(error: unknown): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;

  const message = error instanceof Error ? error.message : String(error);
  if (!/importing a module script failed|failed to fetch dynamically imported module/i.test(message)) {
    return false;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.has(MODULE_RETRY_PARAM)) return false;

  // Vite returns 504 "Outdated Optimize Dep" when Safari reuses an optimized
  // dependency URL from before the dev server rebuilt its dependency cache.
  // A one-time navigation with a fresh URL makes WebKit rebuild the module graph.
  url.searchParams.set(MODULE_RETRY_PARAM, Date.now().toString());
  window.location.replace(url);
  return true;
}

async function bootstrap() {
  await initializeDesktopBackendUrl().catch((error) => {
    console.warn('Desktop backend URL initialization failed:', error);
  });

  // Pull the publicly readable hotel settings before the first render so the
  // login screen shows the configured hotel rather than the built-in defaults.
  // Loaded in parallel with the app shell; it fails soft and has its own short
  // timeout, so an unreachable backend cannot hold up the boot.
  const [{ default: App }] = await Promise.all([
    import('./App'),
    import('./features/user/hooks/useSettingsQueries').then(module =>
      module.applyPublicHotelSettings()
    ),
  ]);

  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );

  root.render(
    <App />
  );

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.has(MODULE_RETRY_PARAM)) {
    currentUrl.searchParams.delete(MODULE_RETRY_PARAM);
    window.history.replaceState(window.history.state, '', currentUrl);
  }
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap application:', error);

  if (retryStaleDevelopmentModule(error)) {
    return;
  }

  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );

  root.render(
    <div style={{ padding: 24, fontFamily: 'Inter, Roboto, Helvetica, Arial, sans-serif' }}>
      Unable to start the application.
    </div>
  );
});

// Monitor and log web vitals for performance tracking
if (import.meta.env.PROD) {
  logWebVitals();
}
