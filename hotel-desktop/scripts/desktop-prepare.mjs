import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDuration } from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const node = process.execPath;

const steps = [
  ['Sync desktop resources', ['scripts/sync-desktop-resources.mjs']],
  ['Build frontend bundle', ['scripts/build-frontend.mjs']],
  ['Build backend sidecar', ['scripts/build-backend-sidecar.mjs']],
  ['Copy backend sidecar', ['scripts/copy-backend-sidecar.mjs']],
];

const totalStartedAt = Date.now();

for (const [label, args] of steps) {
  const stepArgs = force ? [...args, '--force'] : args;
  const startedAt = Date.now();
  console.log(`\n==> ${label}`);

  const result = spawnSync(node, stepArgs, {
    cwd: desktopRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log(`<== ${label} completed in ${formatDuration(Date.now() - startedAt)}`);
}

console.log(`\nDesktop preparation completed in ${formatDuration(Date.now() - totalStartedAt)}.`);

