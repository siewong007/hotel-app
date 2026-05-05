import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { logWebVitals } from './reportWebVitals';
import { initializeDesktopBackendUrl } from './desktop/runtimeApi';

async function bootstrap() {
  initializeDesktopBackendUrl().catch((error) => {
    console.warn('Desktop backend URL initialization failed:', error);
  });

  const { default: App } = await import('./App');

  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );

  root.render(
    <App />
  );
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap application:', error);

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
