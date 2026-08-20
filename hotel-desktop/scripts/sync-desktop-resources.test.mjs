import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

function createTempRepository(manifest) {
  const testRepo = mkdtempSync(join(tmpdir(), 'hotel-desktop-sync-'));
  const testDesktop = join(testRepo, 'hotel-desktop');
  const testBackend = join(testRepo, 'hotel-app-be', 'database', 'postgres');
  const testPatches = join(testBackend, 'patches');

  mkdirSync(join(testDesktop, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(testBackend, 'migrations'), { recursive: true });
  mkdirSync(testPatches, { recursive: true });
  copyFileSync(join(scriptDir, 'sync-desktop-resources.mjs'), join(testDesktop, 'scripts', 'sync-desktop-resources.mjs'));
  copyFileSync(join(scriptDir, 'lib', 'build-cache.mjs'), join(testDesktop, 'scripts', 'lib', 'build-cache.mjs'));
  writeFileSync(join(testBackend, 'migrations', '0001_v1_baseline.sql'), 'baseline');
  writeFileSync(join(testBackend, 'seed.sql'), 'seed');
  writeFileSync(join(testPatches, 'manifest.tsv'), manifest);
  writeFileSync(join(testPatches, '_begin.sql'), 'begin');
  writeFileSync(join(testPatches, '_end.sql'), 'end');
  writeFileSync(join(testPatches, '0002_safe.sql'), 'safe patch');

  return {
    testRepo,
    testDesktop,
    testPatches,
    desktopPatches: join(testDesktop, 'src-tauri', 'database', 'postgres', 'patches'),
  };
}

function runTempSync(testDesktop, ...args) {
  return spawnSync('bun', ['scripts/sync-desktop-resources.mjs', ...args], {
    cwd: testDesktop,
    encoding: 'utf8',
  });
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

test('rejects unsafe, duplicate, and control-colliding patch filenames before changing outputs', () => {
  const catalogs = [
    { filename: '.', line: 2 },
    { filename: '..', line: 2 },
    { filename: '../escape.sql', line: 2 },
    { filename: 'nested/0002_safe.sql', line: 2 },
    { filename: resolve(tmpdir(), '0002_safe.sql'), line: 2 },
    { filename: '0002_safe.sql\n1\t3\tduplicate\tsha256:two\t0002_safe.sql', line: 3 },
    { filename: 'manifest.tsv', line: 2 },
  ];

  for (const { filename, line } of catalogs) {
    const { testRepo, testDesktop, testPatches, desktopPatches } = createTempRepository(
      `# header\n1\t2\tpatch\tsha256:one\t${filename}\n`,
    );

    try {
      mkdirSync(desktopPatches, { recursive: true });
      writeFileSync(join(desktopPatches, 'unrelated.txt'), 'preserve me');

      const sync = runTempSync(testDesktop);

      expect(sync.status).not.toBe(0);
      expect(`${sync.stdout}${sync.stderr}`).toContain(`${join(testPatches, 'manifest.tsv')}:${line}:`);
      expect(readFileSync(join(desktopPatches, 'unrelated.txt'), 'utf8')).toBe('preserve me');
      expect(existsSync(join(testDesktop, 'src-tauri', 'database', 'postgres', 'migrations', '0001_v1_baseline.sql'))).toBe(false);
    } finally {
      rmSync(testRepo, { recursive: true, force: true });
    }
  }
});

test('removes stale generated patch resources in force and non-force syncs', () => {
  const { testRepo, testDesktop, testPatches, desktopPatches } = createTempRepository(
    '1\t2\tsafe\tsha256:one\t0002_safe.sql\n',
  );

  try {
    expect(runTempSync(testDesktop, '--force').status).toBe(0);

    for (const mode of [[], ['--force']]) {
      writeFileSync(join(desktopPatches, 'stale.sql'), 'stale');
      mkdirSync(join(desktopPatches, 'obsolete', 'nested'), { recursive: true });
      writeFileSync(join(desktopPatches, 'obsolete', 'nested', 'stale.sql'), 'stale');

      expect(runTempSync(testDesktop, ...mode).status).toBe(0);
      expect(existsSync(join(desktopPatches, 'stale.sql'))).toBe(false);
      expect(existsSync(join(desktopPatches, 'obsolete'))).toBe(false);
      expect(readdirSync(desktopPatches).sort()).toEqual(['0002_safe.sql', '_begin.sql', '_end.sql', 'manifest.tsv']);
      for (const filename of ['manifest.tsv', '_begin.sql', '_end.sql', '0002_safe.sql']) {
        expect(bytes(join(desktopPatches, filename))).toEqual(bytes(join(testPatches, filename)));
      }
    }
  } finally {
    rmSync(testRepo, { recursive: true, force: true });
  }
});
