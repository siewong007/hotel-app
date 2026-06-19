import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDuration, hashInputs, readJson, writeJson } from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
const profileArgIndex = process.argv.indexOf('--profile');
const profile = profileArgIndex === -1
  ? process.env.DESKTOP_BACKEND_PROFILE ?? 'release'
  : process.argv[profileArgIndex + 1];

if (!profile || profile.startsWith('--')) {
  throw new Error('Missing backend profile value after --profile.');
}
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const repoRoot = resolve(desktopRoot, '..');
const backendRoot = join(repoRoot, 'hotel-app-be');
const cachePath = join(
  desktopRoot,
  'src-tauri',
  'target',
  'desktop-build-cache',
  `backend-sidecar-${profile}.json`,
);
const isWindows = process.platform === 'win32';
const targetProfileDir = profile === 'release' ? 'release' : profile === 'debug' ? 'debug' : profile;
const binaryPath = join(backendRoot, 'target', targetProfileDir, `hotel-app-be${isWindows ? '.exe' : ''}`);
const cargoCommand = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const buildArgs = ['build', '--manifest-path', join(backendRoot, 'Cargo.toml')];

if (profile === 'release') {
  buildArgs.push('--release');
} else if (profile !== 'debug') {
  buildArgs.push('--profile', profile);
}

const commandMetadata = [
  execFileSync(cargoCommand, ['-vV'], { encoding: 'utf8' }),
  execFileSync(process.platform === 'win32' ? 'rustc.exe' : 'rustc', ['-vV'], { encoding: 'utf8' }),
  [cargoCommand, ...buildArgs].join(' '),
];

const inputs = [
  join(backendRoot, 'src'),
  join(backendRoot, 'Cargo.toml'),
  join(backendRoot, 'Cargo.lock'),
  join(backendRoot, 'build.rs'),
  join(repoRoot, 'rust-toolchain.toml'),
  join(repoRoot, '.cargo'),
];

const cacheKey = hashInputs(inputs, {
  baseDir: repoRoot,
  extra: commandMetadata,
});
const previous = readJson(cachePath);

if (!force && previous?.digest === cacheKey.digest && existsSync(binaryPath)) {
  console.log(`Backend ${profile} sidecar unchanged; skipped Cargo build (${cacheKey.fileCount} inputs).`);
  process.exit(0);
}

const startedAt = Date.now();
const result = spawnSync(cargoCommand, buildArgs, {
  cwd: desktopRoot,
  stdio: 'inherit',
});

if (result.status !== 0) {
  if (result.error) {
    console.error(`Failed to start backend ${profile} build: ${result.error.message}`);
  } else if (result.signal) {
    console.error(`Backend ${profile} build stopped by signal ${result.signal}.`);
  } else {
    console.error(`Backend ${profile} build failed with exit code ${result.status}.`);
  }

  process.exit(result.status ?? 1);
}

writeJson(cachePath, {
  digest: cacheKey.digest,
  file_count: cacheKey.fileCount,
  updated_at: new Date().toISOString(),
});

console.log(`Backend ${profile} sidecar built in ${formatDuration(Date.now() - startedAt)}.`);
