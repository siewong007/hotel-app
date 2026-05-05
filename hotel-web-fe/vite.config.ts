import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const TAURI_MODES = new Set(['tauri', 'desktop']);
const BACKEND_TARGET = 'http://127.0.0.1:3030';
const PROXY_PREFIXES = [
  '/auth', '/profile', '/rbac', '/bookings', '/rooms', '/room-types',
  '/guests', '/payments', '/analytics', '/night-audit', '/rates',
  '/rate-codes', '/rate-management', '/market-codes', '/settings',
  '/loyalty', '/ledgers', '/companies', '/complimentary', '/roles',
  '/users', '/audit-logs', '/uploads', '/data-transfer', '/guest-portal',
  '/ekyc', '/reports', '/health', '/ws', '/system',
];

export default defineConfig(({ mode }) => {
  const isTauri = TAURI_MODES.has(mode);
  const proxy = Object.fromEntries(PROXY_PREFIXES.map((path) => [path, BACKEND_TARGET]));

  return {
    plugins: [react()],
    // Preserve console output from sibling tools (e.g. Tauri's Rust compiler) during dev
    clearScreen: false,
    // Allow Tauri-injected env vars in addition to the standard VITE_ prefix
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    server: {
      port: 3000,
      // host/strictPort are passed via CLI in start:tauri so they only apply there
      // In tauri mode, the runtime rewrites API URLs to the dynamic backend port,
      // so the proxy is unused. Web dev relies on the proxy to reach the backend.
      proxy: isTauri ? undefined : proxy,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    build: {
      // Targets supported by the Tauri webview on all platforms
      target: isTauri ? ['es2021', 'chrome105', 'safari13'] : 'es2020',
      // Source maps help debug Tauri debug builds; off for production web bundles
      sourcemap: isTauri ? 'inline' : false,
    },
  };
});
