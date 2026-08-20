import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameFileContent } from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const repoRoot = resolve(desktopRoot, '..');
const backendPostgres = join(repoRoot, 'hotel-app-be', 'database', 'postgres');
const desktopPostgres = join(desktopRoot, 'src-tauri', 'database', 'postgres');
const backendPatches = join(backendPostgres, 'patches');
const desktopPatches = join(desktopPostgres, 'patches');

function patchFilesFromManifest(manifestPath) {
  return readFileSync(manifestPath, 'utf8').split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return [];

    const fields = line.split('\t');
    if (fields.length !== 5 || fields.some((field) => !field)) {
      throw new Error(`${manifestPath}:${index + 1}: expected exactly 5 non-empty tab-separated fields`);
    }

    return [fields[4]];
  });
}

const manifestPath = join(backendPatches, 'manifest.tsv');
const patchFiles = patchFilesFromManifest(manifestPath);

const syncFiles = [
  {
    label: 'PostgreSQL V1 baseline',
    source: join(backendPostgres, 'migrations', '0001_v1_baseline.sql'),
    target: join(desktopPostgres, 'migrations', '0001_v1_baseline.sql'),
  },
  {
    label: 'PostgreSQL V1 seed',
    source: join(backendPostgres, 'seed.sql'),
    target: join(desktopPostgres, 'seed.sql'),
  },
  ...['manifest.tsv', '_begin.sql', '_end.sql'].map((filename) => ({
    label: `PostgreSQL patch ${filename}`,
    source: join(backendPatches, filename),
    target: join(desktopPatches, filename),
  })),
  ...patchFiles.map((filename) => ({
    label: `PostgreSQL patch ${filename}`,
    source: join(backendPatches, filename),
    target: join(desktopPatches, filename),
  })),
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
