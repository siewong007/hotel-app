import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import { logWebVitals } from '../reportWebVitals';
import GuestApp from './GuestApp';

const MODULE_RETRY_PARAM = 'module-retry';

function retryStaleModule(error: unknown): boolean {
  if (typeof window === 'undefined') return false;
  const message = error instanceof Error ? error.message : String(error);
  if (!/importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module/i.test(message)) {
    return false;
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has(MODULE_RETRY_PARAM)) return false;
  url.searchParams.set(MODULE_RETRY_PARAM, Date.now().toString());
  window.location.replace(url);
  return true;
}

async function bootstrap() {
  await import('../features/user/hooks/useSettingsQueries').then(module =>
    module.applyPublicHotelSettings(),
  );

  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
  root.render(<GuestApp />);

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.has(MODULE_RETRY_PARAM)) {
    currentUrl.searchParams.delete(MODULE_RETRY_PARAM);
    window.history.replaceState(window.history.state, '', currentUrl);
  }
}

bootstrap().catch(error => {
  console.error('Failed to bootstrap guest application:', error);
  if (retryStaleModule(error)) return;
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
  root.render(
    <div style={{ padding: 24, fontFamily: 'Inter, Roboto, Helvetica, Arial, sans-serif' }}>
      Unable to start the application.
    </div>,
  );
});

if (import.meta.env.PROD) {
  logWebVitals();
}
