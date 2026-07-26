import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  formatDuration,
  hashInputs,
  readJson,
  selectedEnvironment,
  writeJson,
} from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const repoRoot = resolve(desktopRoot, '..');
const frontendRoot = join(repoRoot, 'hotel-web-fe');
const cachePath = join(desktopRoot, 'src-tauri', 'target', 'desktop-build-cache', 'frontend-tauri.json');
const distIndex = join(frontendRoot, 'dist', 'index.html');
const requiredOutputs = [
  distIndex,
  join(frontendRoot, 'dist', 'assets'),
  // Second Vite entry point (vite.config.ts rolldown inputs) — the desktop
  // landing page redirects to it, so a build missing it ships a dead home page.
  join(frontendRoot, 'dist', 'salim-inn', 'index.html'),
];
const bunExecPath = process.env.npm_execpath && /bun(?:\.exe)?$/i.test(process.env.npm_execpath)
  ? process.env.npm_execpath
  : 'bun';
const buildCommand = [bunExecPath, 'run', 'build:tauri'];

const inputs = [
  join(frontendRoot, 'src'),
  join(frontendRoot, 'public'),
  join(frontendRoot, 'salim-inn'),
  join(frontendRoot, 'index.html'),
  join(frontendRoot, 'package.json'),
  join(frontendRoot, 'bun.lock'),
  join(frontendRoot, 'tsconfig.json'),
  join(frontendRoot, 'vite.config.ts'),
  join(frontendRoot, '.env'),
  join(frontendRoot, '.env.local'),
  join(frontendRoot, '.env.tauri'),
  join(frontendRoot, '.env.tauri.local'),
];

const cacheKey = hashInputs(inputs, {
  baseDir: repoRoot,
  extra: [
    process.version,
    buildCommand.join(' '),
    ...selectedEnvironment(['VITE_', 'TAURI_ENV_']),
  ],
});
const previous = readJson(cachePath);

if (!force && previous?.digest === cacheKey.digest && requiredOutputs.every((path) => existsSync(path))) {
  console.log(`Frontend bundle unchanged; skipped Vite build (${cacheKey.fileCount} inputs).`);
  process.exit(0);
}

const startedAt = Date.now();
const result = spawnSync(buildCommand[0], buildCommand.slice(1), {
  cwd: frontendRoot,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.status !== 0) {
  if (result.error) {
    console.error(`Failed to start frontend build command: ${result.error.message}`);
  } else if (result.signal) {
    console.error(`Frontend build command stopped by signal ${result.signal}.`);
  } else {
    console.error(`Frontend build command failed with exit code ${result.status}.`);
  }

  process.exit(result.status ?? 1);
}

writeJson(cachePath, {
  digest: cacheKey.digest,
  file_count: cacheKey.fileCount,
  updated_at: new Date().toISOString(),
});

console.log(`Frontend bundle built in ${formatDuration(Date.now() - startedAt)}.`);
