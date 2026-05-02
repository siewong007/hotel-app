import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const repoRoot = resolve(desktopRoot, '..');

const syncSets = [
  {
    label: 'PostgreSQL migrations',
    source: join(repoRoot, 'hotel-app-be', 'database', 'migrations'),
    target: join(desktopRoot, 'src-tauri', 'database', 'migrations'),
  },
  {
    label: 'seed data',
    source: join(repoRoot, 'hotel-app-be', 'database', 'seed-data'),
    target: join(desktopRoot, 'src-tauri', 'database', 'seed-data'),
  },
];

function listSqlFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}

for (const { label, source, target } of syncSets) {
  if (!existsSync(source)) {
    throw new Error(`Source directory not found: ${source}`);
  }

  mkdirSync(target, { recursive: true });

  const sourceFiles = listSqlFiles(source);
  const targetFiles = listSqlFiles(target);
  const sourceFileSet = new Set(sourceFiles);

  for (const fileName of sourceFiles) {
    copyFileSync(join(source, fileName), join(target, fileName));
  }

  const desktopOnlyFiles = targetFiles.filter((fileName) => !sourceFileSet.has(fileName));

  console.log(`Synced ${sourceFiles.length} ${label} file(s).`);

  if (desktopOnlyFiles.length > 0) {
    console.warn(
      `Desktop-only ${label} left in place: ${desktopOnlyFiles.map((fileName) => basename(fileName)).join(', ')}`
    );
  }
}
