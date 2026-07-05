import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectInputFiles, readJson, writeJson } from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const srcTauriRoot = join(desktopRoot, 'src-tauri');
const pgsqlDir = join(srcTauriRoot, 'pgsql');
const pgsqlTmpDir = join(srcTauriRoot, 'pgsql.tmp');
const manifestPath = join(pgsqlDir, '.provision-manifest.json');

// The Homebrew `bin/` keg for postgresql@<major> ships many client tools we
// don't need at runtime (pg_upgrade, clusterdb, ...). Bundle exactly the subset
// the app shells out to — every `pgsql_bin.join(...)` caller in
// hotel-desktop/src-tauri/src/postgres.rs must have its binary listed here:
// pg_dump (backups) and pg_restore (guided upgrade restore) included.
const REQUIRED_BIN_NAMES = [
  'createdb',
  'initdb',
  'pg_ctl',
  'pg_dump',
  'pg_isready',
  'pg_restore',
  'postgres',
  'psql',
];

function readExpectedMajorVersion() {
  const postgresRsPath = join(srcTauriRoot, 'src', 'postgres.rs');
  if (!existsSync(postgresRsPath)) {
    throw new Error(`Cannot locate ${postgresRsPath} to determine the expected PostgreSQL major version.`);
  }

  const source = readFileSync(postgresRsPath, 'utf8');
  const match = source.match(/CONFIGURED_POSTGRES_MAJOR_VERSION\s*:\s*&str\s*=\s*"(\d+)"/);
  if (!match) {
    throw new Error(
      `Could not find CONFIGURED_POSTGRES_MAJOR_VERSION in ${postgresRsPath}. ` +
        'This script derives the required PostgreSQL major version from that constant ' +
        'and refuses to guess a fallback version.',
    );
  }

  return match[1];
}

function runVersionCommand(binaryPath, args) {
  try {
    return execFileSync(binaryPath, args, { encoding: 'utf8' }).trim();
  } catch (error) {
    return undefined;
  }
}

function extractMajorVersion(versionOutput) {
  if (!versionOutput) {
    return undefined;
  }
  const match = versionOutput.match(/\)\s*(\d+)(?:\.\d+)?/);
  return match ? match[1] : undefined;
}

function checkExistingInstall(expectedMajor) {
  const postgresBin = join(pgsqlDir, 'bin', 'postgres');
  const initdbBin = join(pgsqlDir, 'bin', 'initdb');
  const pgCtlBin = join(pgsqlDir, 'bin', 'pg_ctl');

  const missing = REQUIRED_BIN_NAMES.filter((name) => !existsSync(join(pgsqlDir, 'bin', name)));
  if (!existsSync(pgsqlDir) || missing.length > 0) {
    return {
      ok: false,
      reason: `pgsql/ tree or required binaries are missing${missing.length ? ` (${missing.join(', ')})` : ''}`,
    };
  }

  const postgresVersion = runVersionCommand(postgresBin, ['--version']);
  const initdbVersion = runVersionCommand(initdbBin, ['--version']);
  const pgCtlVersion = runVersionCommand(pgCtlBin, ['--version']);
  const foundMajor = extractMajorVersion(postgresVersion);

  if (!foundMajor) {
    return { ok: false, reason: 'could not determine bundled PostgreSQL version' };
  }

  if (foundMajor !== expectedMajor) {
    return {
      ok: false,
      reason: `bundled PostgreSQL major version ${foundMajor} does not match expected ${expectedMajor}`,
    };
  }

  if (!initdbVersion || !pgCtlVersion) {
    return { ok: false, reason: 'initdb/pg_ctl --version failed to run' };
  }

  const manifest = readJson(manifestPath);
  return { ok: true, foundMajor, hasManifest: Boolean(manifest), manifest };
}

function locateBrewPrefix(major) {
  const formula = `postgresql@${major}`;
  try {
    const prefixOutput = execFileSync('brew', ['--prefix', formula], { encoding: 'utf8' }).trim();
    if (!prefixOutput || !existsSync(prefixOutput)) {
      return undefined;
    }
    return prefixOutput;
  } catch (error) {
    return undefined;
  }
}

function computeTreeStats(rootDir) {
  const files = collectInputFiles([rootDir], { baseDir: rootDir });
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += statSync(file).size;
  }
  return { fileCount: files.length, totalBytes };
}

function provisionFromBrew(major) {
  const brewPrefix = locateBrewPrefix(major);
  if (!brewPrefix) {
    console.error(
      `Could not locate a Homebrew postgresql@${major} installation via 'brew --prefix postgresql@${major}'.\n` +
        `Fix: install it with 'brew install postgresql@${major}' and re-run this script.`,
    );
    process.exit(1);
  }

  console.log(`Provisioning embedded PostgreSQL ${major} from ${brewPrefix}`);

  if (existsSync(pgsqlTmpDir)) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
  }

  try {
    // bin/: copy only the executables the app actually shells out to.
    for (const binName of REQUIRED_BIN_NAMES) {
      const sourceBin = join(brewPrefix, 'bin', binName);
      if (!existsSync(sourceBin)) {
        throw new Error(`Expected Homebrew binary not found: ${sourceBin}`);
      }
      cpSync(sourceBin, join(pgsqlTmpDir, 'bin', binName), { preserveTimestamps: true });
    }

    // lib/ and share/: the Homebrew keg names these lib/postgresql and
    // share/postgresql (no version suffix), but the existing hand-placed tree
    // renames them to lib/postgresql@<major> and share/postgresql@<major> to
    // match Postgres's own versioned pkglibdir/share naming convention, and
    // omits share/locale (not needed at runtime). Replicate that exactly.
    const sourceLibPostgresql = join(brewPrefix, 'lib', 'postgresql');
    if (!existsSync(sourceLibPostgresql)) {
      throw new Error(`Expected Homebrew directory not found: ${sourceLibPostgresql}`);
    }
    cpSync(sourceLibPostgresql, join(pgsqlTmpDir, 'lib', `postgresql@${major}`), {
      recursive: true,
      preserveTimestamps: true,
    });

    const sourceSharePostgresql = join(brewPrefix, 'share', 'postgresql');
    if (!existsSync(sourceSharePostgresql)) {
      throw new Error(`Expected Homebrew directory not found: ${sourceSharePostgresql}`);
    }
    cpSync(sourceSharePostgresql, join(pgsqlTmpDir, 'share', `postgresql@${major}`), {
      recursive: true,
      preserveTimestamps: true,
    });

    for (const shareSubdir of ['doc', 'man']) {
      const sourceShareSubdir = join(brewPrefix, 'share', shareSubdir);
      if (existsSync(sourceShareSubdir)) {
        cpSync(sourceShareSubdir, join(pgsqlTmpDir, 'share', shareSubdir), {
          recursive: true,
          preserveTimestamps: true,
        });
      }
    }
  } catch (error) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
    console.error(`Failed to copy PostgreSQL tree: ${error.message}`);
    process.exit(1);
  }

  // Verify before swapping the tmp tree into place.
  const verifyPostgresBin = join(pgsqlTmpDir, 'bin', 'postgres');
  const verifyInitdbBin = join(pgsqlTmpDir, 'bin', 'initdb');
  const verifyPgCtlBin = join(pgsqlTmpDir, 'bin', 'pg_ctl');

  const initdbVersion = runVersionCommand(verifyInitdbBin, ['--version']);
  const pgCtlVersion = runVersionCommand(verifyPgCtlBin, ['--version']);
  const postgresVersion = runVersionCommand(verifyPostgresBin, ['--version']);
  const foundMajor = extractMajorVersion(postgresVersion);

  if (!initdbVersion || !pgCtlVersion || !foundMajor) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
    console.error('Verification failed: initdb/pg_ctl/postgres --version did not run correctly in the copied tree.');
    process.exit(1);
  }

  if (foundMajor !== major) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
    console.error(
      `Verification failed: copied tree reports PostgreSQL major version ${foundMajor}, expected ${major}.`,
    );
    process.exit(1);
  }

  // Atomic swap: remove old tree, rename tmp into place.
  if (existsSync(pgsqlDir)) {
    rmSync(pgsqlDir, { recursive: true, force: true });
  }
  renameSync(pgsqlTmpDir, pgsqlDir);

  const stats = computeTreeStats(pgsqlDir);
  writeJson(manifestPath, {
    sourcePath: brewPrefix,
    version: foundMajor,
    date: new Date().toISOString(),
    fileCount: stats.fileCount,
    totalBytes: stats.totalBytes,
  });

  console.log(
    `Provisioned pgsql/ from ${brewPrefix} (PostgreSQL ${foundMajor}, ${stats.fileCount} files, ${stats.totalBytes} bytes).`,
  );
}

const expectedMajor = readExpectedMajorVersion();

if (!force) {
  const existing = checkExistingInstall(expectedMajor);
  if (existing.ok) {
    console.log(
      `pgsql/ up to date (PostgreSQL ${existing.foundMajor}${existing.hasManifest ? ', manifest verified' : ', no manifest'}).`,
    );
    process.exit(0);
  }
  console.log(`pgsql/ needs provisioning: ${existing.reason}.`);
} else {
  console.log('Force re-provisioning requested.');
}

if (process.platform === 'darwin') {
  provisionFromBrew(expectedMajor);
} else {
  console.error(
    'Windows/Linux pgsql provisioning source not configured — to be filled in by user.',
  );
  process.exit(1);
}
