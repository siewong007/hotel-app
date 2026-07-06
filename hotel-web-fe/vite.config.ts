import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

const TAURI_MODES = new Set(['tauri', 'desktop']);
const BACKEND_TARGET = 'http://127.0.0.1:3030';
// All domain API endpoints are served under `/api` on the backend; only these
// prefixes are forwarded so every other path falls through to the SPA (e.g.
// deep-links like `/bookings/123`). `/uploads`, `/health`, and `/ws` stay at the
// backend root for static assets + healthchecks.
//
// KEEP IN SYNC: the desktop sidecar CORS allow-list lives in
// hotel-desktop/src-tauri/src/commands.rs (ALLOWED_ORIGINS env assembly). New
// top-level API prefixes must also be merged in
// hotel-app-be/src/routes/mod.rs::create_router. See .claude/rules/00-diagnosis.md Leak #3.
const PROXY_PREFIXES = ['/api', '/uploads', '/health', '/ws'];

export default defineConfig(({ mode, command }) => {
  const isTauri = TAURI_MODES.has(mode);
  const isProductionBuild = command === 'build' && mode !== 'development';
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
      // Mark @tauri-apps/api/* as external in all builds. The desktop runtime code
      // accesses window.__TAURI_INTERNALS__ directly instead of importing the npm
      // package, so these externals are only a safety net against accidental imports.
      rolldownOptions: {
        external: (id: string) => id === '@tauri-apps/api' || id.startsWith('@tauri-apps/api/'),
        // Strip console/debugger statements from production output only; dev
        // server and dev builds keep them for debugging. This project's default
        // minifier is Rolldown's built-in oxc-based minifier (not esbuild), so
        // the drop config lives under output.minify.compress, not build.esbuild.
        output: isProductionBuild
          ? {
              minify: {
                compress: {
                  dropConsole: true,
                  dropDebugger: true,
                },
              },
            }
          : undefined,
      },
    },
  };
});
