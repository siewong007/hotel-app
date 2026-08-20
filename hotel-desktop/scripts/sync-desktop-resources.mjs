import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
const CONTROL_FILENAMES = new Set(['manifest.tsv', '_begin.sql', '_end.sql']);
const PATCH_FILENAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

function patchFilesFromManifest(manifestPath) {
  const destinations = new Set();

  return readFileSync(manifestPath, 'utf8').split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return [];

    const fields = line.split('\t');
    if (fields.length !== 5 || fields.some((field) => !field)) {
      throw new Error(`${manifestPath}:${index + 1}: expected exactly 5 non-empty tab-separated fields`);
    }

    const filename = fields[4];
    if (CONTROL_FILENAMES.has(filename)) {
      throw new Error(`${manifestPath}:${index + 1}: patch filename collides with a control resource`);
    }
    if (isAbsolute(filename) || filename === '.' || filename === '..' || /[\\/]/.test(filename) || basename(filename) !== filename) {
      throw new Error(`${manifestPath}:${index + 1}: patch filename must be a single normal basename`);
    }
    if (!PATCH_FILENAME.test(filename)) {
      throw new Error(`${manifestPath}:${index + 1}: patch filename must match ${PATCH_FILENAME}`);
    }

    const source = resolve(backendPatches, filename);
    const target = resolve(desktopPatches, filename);
    for (const path of [source, target]) {
      const pathFromPatches = relative(path === source ? backendPatches : desktopPatches, path);
      if (pathFromPatches === '..' || pathFromPatches.startsWith(`..${sep}`) || isAbsolute(pathFromPatches)) {
        throw new Error(`${manifestPath}:${index + 1}: patch filename escapes the patch directory`);
      }
    }
    if (destinations.has(target)) {
      throw new Error(`${manifestPath}:${index + 1}: duplicate normalized patch destination ${filename}`);
    }
    destinations.add(target);

    return [{ filename, source, target }];
  });
}

function removeStalePatchResources(expectedFilenames) {
  if (!existsSync(desktopPatches)) return;

  for (const entry of readdirSync(desktopPatches, { withFileTypes: true })) {
    if (expectedFilenames.has(entry.name) && entry.isFile()) continue;

    rmSync(join(desktopPatches, entry.name), { recursive: true, force: true });
    console.log(`Removed stale PostgreSQL patch ${entry.name}.`);
  }
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
  ...patchFiles.map(({ filename, source, target }) => ({
    label: `PostgreSQL patch ${filename}`,
    source,
    target,
  })),
];

for (const { source } of syncFiles) {
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`Source file not found: ${source}`);
  }
}

removeStalePatchResources(new Set([...CONTROL_FILENAMES, ...patchFiles.map(({ filename }) => filename)]));

for (const { label, source, target } of syncFiles) {
  mkdirSync(dirname(target), { recursive: true });
  if (!force && sameFileContent(source, target)) {
    console.log(`Skipped ${label}; already up to date.`);
    continue;
  }

  copyFileSync(source, target);
  console.log(`Synced ${label}.`);
}
