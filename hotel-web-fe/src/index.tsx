import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { logWebVitals } from './reportWebVitals';

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
