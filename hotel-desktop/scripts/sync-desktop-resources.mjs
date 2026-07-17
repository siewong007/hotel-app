import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameFileContent } from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const repoRoot = resolve(desktopRoot, '..');

const syncFiles = [
  {
    label: 'PostgreSQL V1 baseline',
    source: join(repoRoot, 'hotel-app-be', 'database', 'postgres', 'migrations', '0001_v1_baseline.sql'),
    target: join(desktopRoot, 'src-tauri', 'database', 'postgres', 'migrations', '0001_v1_baseline.sql'),
  },
  {
    label: 'PostgreSQL V1 required data',
    source: join(repoRoot, 'hotel-app-be', 'database', 'postgres', 'data.sql'),
    target: join(desktopRoot, 'src-tauri', 'database', 'postgres', 'data.sql'),
  },
  {
    label: 'PostgreSQL V1 bootstrap seed',
    source: join(repoRoot, 'hotel-app-be', 'database', 'postgres', 'seed.sql'),
    target: join(desktopRoot, 'src-tauri', 'database', 'postgres', 'seed.sql'),
  },
];

for (const { label, source, target } of syncFiles) {
  if (!existsSync(source)) {
    throw new Error(`Source file not found: ${source}`);
  }

  mkdirSync(dirname(target), { recursive: true });
  if (!force && sameFileContent(source, target)) {
    console.log(`Skipped ${label}; already up to date.`);
    continue;
  }

  copyFileSync(source, target);
  console.log(`Synced ${label}.`);
}
