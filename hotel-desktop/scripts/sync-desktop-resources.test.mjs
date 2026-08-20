import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const repoRoot = resolve(desktopRoot, '..');
const backendPatches = join(repoRoot, 'hotel-app-be', 'database', 'postgres', 'patches');
const desktopPatches = join(desktopRoot, 'src-tauri', 'database', 'postgres', 'patches');

function bytes(path) {
  return new Uint8Array(readFileSync(path));
}

test('synchronizes exactly the patch catalog resources packaged by Tauri', () => {
  const sync = spawnSync('bun', ['scripts/sync-desktop-resources.mjs', '--force'], {
    cwd: desktopRoot,
    encoding: 'utf8',
  });

  expect(sync.status).toBe(0);

  for (const filename of ['manifest.tsv', '_begin.sql', '_end.sql']) {
    expect(bytes(join(desktopPatches, filename))).toEqual(bytes(join(backendPatches, filename)));
  }

  const patches = readFileSync(join(backendPatches, 'manifest.tsv'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'))
    .map((line) => line.split('\t'));

  expect(patches).toHaveLength(3);
  for (const fields of patches) {
    expect(fields).toHaveLength(5);
    expect(bytes(join(desktopPatches, fields[4]))).toEqual(bytes(join(backendPatches, fields[4])));
  }

  const tauriConfig = JSON.parse(readFileSync(join(desktopRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  expect(tauriConfig.bundle.resources).toContain('database/postgres/patches/**/*');
});

test('reports the manifest path and line for malformed patch entries', () => {
  const testRepo = mkdtempSync(join(tmpdir(), 'hotel-desktop-sync-'));
  const testDesktop = join(testRepo, 'hotel-desktop');
  const manifestPath = join(testRepo, 'hotel-app-be', 'database', 'postgres', 'patches', 'manifest.tsv');

  try {
    mkdirSync(join(testDesktop, 'scripts', 'lib'), { recursive: true });
    mkdirSync(dirname(manifestPath), { recursive: true });
    copyFileSync(join(scriptDir, 'sync-desktop-resources.mjs'), join(testDesktop, 'scripts', 'sync-desktop-resources.mjs'));
    copyFileSync(join(scriptDir, 'lib', 'build-cache.mjs'), join(testDesktop, 'scripts', 'lib', 'build-cache.mjs'));
    writeFileSync(manifestPath, '# header\n1\t2\tmissing-fields\n');

    const sync = spawnSync('bun', ['scripts/sync-desktop-resources.mjs'], {
      cwd: testDesktop,
      encoding: 'utf8',
    });

    expect(sync.status).not.toBe(0);
    expect(`${sync.stdout}${sync.stderr}`).toContain(`${manifestPath}:2: expected exactly 5 non-empty tab-separated fields`);
  } finally {
    rmSync(testRepo, { recursive: true, force: true });
  }
});
