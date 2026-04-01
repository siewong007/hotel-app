import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { logWebVitals } from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <App />
);

// Monitor and log web vitals for performance tracking
if (import.meta.env.PROD) {
  logWebVitals();
}
