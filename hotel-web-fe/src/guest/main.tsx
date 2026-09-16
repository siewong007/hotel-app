import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import { logWebVitals } from '../reportWebVitals';
import GuestApp from './GuestApp';
import { dismissBootSplash } from '../utils/bootSplash';
import { ensureLocaleLoaded, getActiveLocale, t } from '../i18n';

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
  // See src/index.tsx: the active locale's bundles are a lazy chunk, fetched
  // alongside the settings call so the guest's first render is already in
  // their language.
  await Promise.all([
    import('../features/user/hooks/useSettingsQueries').then(module =>
      module.applyPublicHotelSettings(),
    ),
    ensureLocaleLoaded(getActiveLocale()),
  ]);

  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
  root.render(<GuestApp />);
  dismissBootSplash();

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.has(MODULE_RETRY_PARAM)) {
    currentUrl.searchParams.delete(MODULE_RETRY_PARAM);
    window.history.replaceState(window.history.state, '', currentUrl);
  }
}

bootstrap().catch(error => {
  console.error('Failed to bootstrap guest application:', error);
  if (retryStaleModule(error)) return;
  dismissBootSplash();
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
  root.render(
    <div style={{ padding: 24, fontFamily: 'Inter, Roboto, Helvetica, Arial, sans-serif' }}>
      {t('errors:appStart')}
    </div>,
  );
});

if (import.meta.env.PROD) {
  logWebVitals();
}
