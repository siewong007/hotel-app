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
const requiredOutputs = [distIndex, join(frontendRoot, 'dist', 'assets')];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildCommand = [npmCommand, '--prefix', frontendRoot, 'run', 'build:tauri'];

const inputs = [
  join(frontendRoot, 'src'),
  join(frontendRoot, 'public'),
  join(frontendRoot, 'index.html'),
  join(frontendRoot, 'package.json'),
  join(frontendRoot, 'package-lock.json'),
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
  cwd: desktopRoot,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

writeJson(cachePath, {
  digest: cacheKey.digest,
  file_count: cacheKey.fileCount,
  updated_at: new Date().toISOString(),
});

console.log(`Frontend bundle built in ${formatDuration(Date.now() - startedAt)}.`);
