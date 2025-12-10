import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { logWebVitals } from './reportWebVitals';
import './i18n/config'; // Initialize i18n

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Monitor and log web vitals for performance tracking
if (process.env.NODE_ENV === 'production') {
  logWebVitals();
}
