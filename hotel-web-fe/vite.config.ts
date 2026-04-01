import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/auth': 'http://127.0.0.1:3030',
      '/bookings': 'http://127.0.0.1:3030',
      '/rooms': 'http://127.0.0.1:3030',
      '/guests': 'http://127.0.0.1:3030',
      '/payments': 'http://127.0.0.1:3030',
      '/analytics': 'http://127.0.0.1:3030',
      '/night-audit': 'http://127.0.0.1:3030',
      '/rates': 'http://127.0.0.1:3030',
      '/settings': 'http://127.0.0.1:3030',
      '/loyalty': 'http://127.0.0.1:3030',
      '/ledgers': 'http://127.0.0.1:3030',
      '/companies': 'http://127.0.0.1:3030',
      '/roles': 'http://127.0.0.1:3030',
      '/users': 'http://127.0.0.1:3030',
      '/audit-logs': 'http://127.0.0.1:3030',
      '/uploads': 'http://127.0.0.1:3030',
      '/data-transfer': 'http://127.0.0.1:3030',
      '/guest-portal': 'http://127.0.0.1:3030',
      '/system': 'http://127.0.0.1:3030',
    },
  },
});
