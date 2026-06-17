import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

const TAURI_MODES = new Set(['tauri', 'desktop']);
const BACKEND_TARGET = 'http://127.0.0.1:3030';
const PROXY_PREFIXES = [
  '/auth', '/profile', '/rbac', '/bookings', '/rooms', '/room-types',
  '/guests', '/payments', '/analytics', '/night-audit', '/rates',
  '/rate-codes', '/rate-management', '/market-codes', '/settings',
  '/loyalty', '/ledgers', '/companies', '/complimentary', '/roles',
  '/users', '/audit-logs', '/uploads', '/data-transfer', '/guest-portal',
  '^/ekyc(?:/|$)', '/reports', '/health', '/ws', '/system', '/search',
];

export default defineConfig(({ mode }) => {
  const isTauri = TAURI_MODES.has(mode);
  const proxy = Object.fromEntries(PROXY_PREFIXES.map((path) => [path, BACKEND_TARGET]));

  return {
    plugins: [
      // Must come before React plugin to inject the generated route tree before TSX transform
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
      }),
      react(),
      babel({
        presets: [reactCompilerPreset()],
      }),
    ],
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
      // Mark @tauri-apps/api as external in web builds to prevent unresolved import errors.
      // The Tauri API is only available at runtime inside a Tauri webview, not in the browser.
      rolldownOptions: isTauri ? undefined : {
        external: ['@tauri-apps/api'],
      },
    },
  };
});
