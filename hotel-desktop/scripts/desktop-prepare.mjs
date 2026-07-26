import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDuration } from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
// --dev prepares only what `tauri dev` consumes: synced SQL resources and a
// debug-profile sidecar. The frontend is served by Vite in dev, so its bundle
// build is skipped.
const dev = process.argv.includes('--dev');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const node = process.execPath;
const pgsqlDir = join(desktopRoot, 'src-tauri', 'pgsql');

const steps = [
  ['Sync desktop resources', ['scripts/sync-desktop-resources.mjs']],
  ...(dev ? [] : [['Build frontend bundle', ['scripts/build-frontend.mjs']]]),
  ['Build backend sidecar', ['scripts/build-backend-sidecar.mjs', ...(dev ? ['--profile', 'debug'] : [])]],
  ['Copy backend sidecar', ['scripts/copy-backend-sidecar.mjs', ...(dev ? ['--profile', 'debug'] : [])]],
];

const totalStartedAt = Date.now();

// Provision the embedded PostgreSQL tree first, but don't let it break an
// already-working setup: if pgsql/ exists and provisioning fails (e.g. no
// Homebrew, offline machine), only fail hard when pgsql/ is missing entirely —
// UNLESS provisioning exited 2, which means the existing tree is confirmed to
// be the wrong PostgreSQL build and must not be shipped or run.
{
  const label = 'Provision embedded PostgreSQL';
  const args = force
    ? ['scripts/provision-pgsql.mjs', '--force']
    : ['scripts/provision-pgsql.mjs'];
  const startedAt = Date.now();
  console.log(`\n==> ${label}`);

  const result = spawnSync(node, args, {
    cwd: desktopRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    if (result.status === 2) {
      console.error(
        `${label}: the existing src-tauri/pgsql/ tree does not match the PostgreSQL build required by src/postgres.rs and provisioning could not replace it. Refusing to continue — the app cannot start with this tree.`,
      );
      process.exit(2);
    }
    if (existsSync(pgsqlDir)) {
      console.warn(
        `${label} failed (exit code ${result.status ?? 1}), but src-tauri/pgsql/ already exists — continuing with the existing tree.`,
      );
    } else {
      console.error(`${label} failed with exit code ${result.status ?? 1} and no existing src-tauri/pgsql/ tree is present.`);
      process.exit(result.status ?? 1);
    }
  } else {
    console.log(`<== ${label} completed in ${formatDuration(Date.now() - startedAt)}`);
  }
}

for (const [label, args] of steps) {
  const stepArgs = force ? [...args, '--force'] : args;
  const startedAt = Date.now();
  console.log(`\n==> ${label}`);

  const result = spawnSync(node, stepArgs, {
    cwd: desktopRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    if (result.error) {
      console.error(`${label} failed to start: ${result.error.message}`);
    } else if (result.signal) {
      console.error(`${label} stopped by signal ${result.signal}.`);
    } else {
      console.error(`${label} failed with exit code ${result.status}.`);
    }

    process.exit(result.status ?? 1);
  }

  console.log(`<== ${label} completed in ${formatDuration(Date.now() - startedAt)}`);
}

console.log(`\nDesktop preparation completed in ${formatDuration(Date.now() - totalStartedAt)}.`);
