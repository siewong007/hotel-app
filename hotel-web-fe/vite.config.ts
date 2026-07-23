import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

const TAURI_MODES = new Set(['tauri', 'desktop']);
const DEFAULT_BACKEND_TARGET = 'http://127.0.0.1:3030';
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
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const isTauri = TAURI_MODES.has(mode);
  const isProductionBuild = command === 'build' && mode !== 'development';
  // A local Docker backend normally listens on 3030. Allow developers whose
  // port is already occupied (for example by an older container) to direct
  // Vite at the backend they actually started without changing source.
  const backendTarget = env.VITE_BACKEND_TARGET || env.VITE_API_URL || DEFAULT_BACKEND_TARGET;
  const proxy = Object.fromEntries(PROXY_PREFIXES.map((path) => [
    path,
    { target: backendTarget, ws: path === '/api' || path === '/ws' },
  ]));

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
        // The React Compiler only needs application source. Keeping standalone
        // JavaScript experiences out of this pass avoids Babel's 500 KB code
        // generator fallback without changing how Vite serves or bundles them.
        include: /[/\\]src[/\\].*\.[jt]sx?$/,
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
      // Safari reports unsupported syntax in an ES module as a generic module
      // import failure. Keep the web and desktop bundles compatible with the
      // oldest supported WebKit runtime instead of leaving web builds at the
      // broader ES2020 target.
      target: isTauri ? ['es2021', 'chrome105', 'safari13'] : ['es2020', 'safari13'],
      // Source maps help debug Tauri debug builds; off for production web bundles
      sourcemap: isTauri ? 'inline' : false,
      // Mark @tauri-apps/api/* as external in all builds. The desktop runtime code
      // accesses window.__TAURI_INTERNALS__ directly instead of importing the npm
      // package, so these externals are only a safety net against accidental imports.
      rolldownOptions: {
        input: {
          app: resolve(__dirname, 'index.html'),
          salimInn: resolve(__dirname, 'salim-inn/index.html'),
        },
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
