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
  'initdb',
  'pg_ctl',
  'pg_dump',
  'pg_isready',
  'pg_restore',
  'postgres',
  'psql',
];

function readExpectedVersion() {
  const postgresRsPath = join(srcTauriRoot, 'src', 'postgres.rs');
  if (!existsSync(postgresRsPath)) {
    throw new Error(`Cannot locate ${postgresRsPath} to determine the expected PostgreSQL build.`);
  }

  const source = readFileSync(postgresRsPath, 'utf8');
  const majorMatch = source.match(/CONFIGURED_POSTGRES_MAJOR_VERSION\s*:\s*&str\s*=\s*"(\d+)"/);
  const buildMatch = source.match(/CONFIGURED_POSTGRES_BUILD_IDENTITY\s*:\s*&str\s*=\s*"([^"]+)"/);
  if (!majorMatch || !buildMatch) {
    throw new Error(
      `Could not find the configured PostgreSQL major/build identity in ${postgresRsPath}. ` +
        'This script derives the required PostgreSQL build from those constants and refuses to guess.',
    );
  }

  return { major: majorMatch[1], buildIdentity: buildMatch[1].toLowerCase() };
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

function extractBuildIdentity(versionOutput) {
  if (!versionOutput) {
    return undefined;
  }

  const match = versionOutput.match(/\)\s*(\d+(?:\.\d+)*(?:(?:beta|rc)\d+|devel)?)/i);
  if (!match) {
    return undefined;
  }

  const versionToken = match[1].toLowerCase();
  if (versionToken.includes('beta') || versionToken.includes('rc') || versionToken.includes('devel')) {
    return versionToken;
  }
  return extractMajorVersion(versionOutput);
}

function checkExistingInstall(expected) {
  const postgresBin = join(pgsqlDir, 'bin', 'postgres');
  const initdbBin = join(pgsqlDir, 'bin', 'initdb');
  const pgCtlBin = join(pgsqlDir, 'bin', 'pg_ctl');

  // `hard: true` marks a tree that is CONFIRMED unusable (wrong build, broken
  // or incomplete binaries) — if provisioning then fails, the build must not
  // fall back to it. `hard: false` covers states where the tree may still be
  // fine (e.g. manifest predates its introduction).
  const missing = REQUIRED_BIN_NAMES.filter((name) => !existsSync(join(pgsqlDir, 'bin', name)));
  if (!existsSync(pgsqlDir) || missing.length > 0) {
    return {
      ok: false,
      hard: existsSync(pgsqlDir),
      reason: `pgsql/ tree or required binaries are missing${missing.length ? ` (${missing.join(', ')})` : ''}`,
    };
  }

  const postgresVersion = runVersionCommand(postgresBin, ['--version']);
  const initdbVersion = runVersionCommand(initdbBin, ['--version']);
  const pgCtlVersion = runVersionCommand(pgCtlBin, ['--version']);
  const foundMajor = extractMajorVersion(postgresVersion);
  const foundBuildIdentity = extractBuildIdentity(postgresVersion);
  const initdbBuildIdentity = extractBuildIdentity(initdbVersion);
  const pgCtlBuildIdentity = extractBuildIdentity(pgCtlVersion);

  if (!foundMajor || !foundBuildIdentity) {
    return { ok: false, hard: true, reason: 'could not determine bundled PostgreSQL version' };
  }

  if (foundMajor !== expected.major || foundBuildIdentity !== expected.buildIdentity) {
    return {
      ok: false,
      hard: true,
      reason: `bundled PostgreSQL build ${foundBuildIdentity} (major ${foundMajor}) does not match expected ${expected.buildIdentity} (major ${expected.major})`,
    };
  }

  if (!initdbBuildIdentity || !pgCtlBuildIdentity) {
    return { ok: false, hard: true, reason: 'initdb/pg_ctl --version failed to run' };
  }
  if (initdbBuildIdentity !== foundBuildIdentity || pgCtlBuildIdentity !== foundBuildIdentity) {
    return {
      ok: false,
      hard: true,
      reason: `bundled binaries report inconsistent builds (postgres ${foundBuildIdentity}, initdb ${initdbBuildIdentity}, pg_ctl ${pgCtlBuildIdentity})`,
    };
  }

  const manifest = readJson(manifestPath);
  if (!manifest) {
    return { ok: false, hard: false, reason: 'full-build provision manifest is missing' };
  }
  if (manifest.majorVersion !== expected.major || manifest.buildIdentity !== expected.buildIdentity) {
    return {
      ok: false,
      hard: true,
      reason: `provision manifest build ${manifest.buildIdentity ?? '<missing>'} (major ${manifest.majorVersion ?? '<missing>'}) does not match expected ${expected.buildIdentity} (major ${expected.major})`,
    };
  }

  return { ok: true, foundMajor, foundBuildIdentity, manifest };
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

function locatePostgresPrefix(major) {
  const configuredPrefix = process.env.POSTGRES_PREFIX?.trim();
  if (configuredPrefix) {
    const resolvedPrefix = resolve(configuredPrefix);
    if (!existsSync(resolvedPrefix)) {
      throw new Error(`POSTGRES_PREFIX does not exist: ${resolvedPrefix}`);
    }
    return resolvedPrefix;
  }

  return locateBrewPrefix(major);
}

function computeTreeStats(rootDir) {
  const files = collectInputFiles([rootDir], { baseDir: rootDir });
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += statSync(file).size;
  }
  return { fileCount: files.length, totalBytes };
}

function provisionFromPrefix(expected, failExitCode = 1) {
  const postgresPrefix = locatePostgresPrefix(expected.major);
  if (!postgresPrefix) {
    console.error(
      `Could not locate a Homebrew postgresql@${expected.major} installation via 'brew --prefix postgresql@${expected.major}'.\n` +
        `Fix: install it with 'brew install postgresql@${expected.major}', or set POSTGRES_PREFIX to a PostgreSQL ${expected.buildIdentity} installation, and re-run this script.`,
    );
    process.exit(failExitCode);
  }

  console.log(`Provisioning embedded PostgreSQL ${expected.buildIdentity} from ${postgresPrefix}`);

  if (existsSync(pgsqlTmpDir)) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
  }

  try {
    // bin/: copy only the executables the app actually shells out to.
    for (const binName of REQUIRED_BIN_NAMES) {
      const sourceBin = join(postgresPrefix, 'bin', binName);
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
    const sourceLibPostgresql = join(postgresPrefix, 'lib', 'postgresql');
    if (!existsSync(sourceLibPostgresql)) {
      throw new Error(`Expected Homebrew directory not found: ${sourceLibPostgresql}`);
    }
    cpSync(sourceLibPostgresql, join(pgsqlTmpDir, 'lib', `postgresql@${expected.major}`), {
      recursive: true,
      preserveTimestamps: true,
    });

    const sourceSharePostgresql = join(postgresPrefix, 'share', 'postgresql');
    if (!existsSync(sourceSharePostgresql)) {
      throw new Error(`Expected Homebrew directory not found: ${sourceSharePostgresql}`);
    }
    cpSync(sourceSharePostgresql, join(pgsqlTmpDir, 'share', `postgresql@${expected.major}`), {
      recursive: true,
      preserveTimestamps: true,
    });

    for (const shareSubdir of ['doc', 'man']) {
      const sourceShareSubdir = join(postgresPrefix, 'share', shareSubdir);
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
    process.exit(failExitCode);
  }

  // Verify before swapping the tmp tree into place.
  const verifyPostgresBin = join(pgsqlTmpDir, 'bin', 'postgres');
  const verifyInitdbBin = join(pgsqlTmpDir, 'bin', 'initdb');
  const verifyPgCtlBin = join(pgsqlTmpDir, 'bin', 'pg_ctl');

  const initdbVersion = runVersionCommand(verifyInitdbBin, ['--version']);
  const pgCtlVersion = runVersionCommand(verifyPgCtlBin, ['--version']);
  const postgresVersion = runVersionCommand(verifyPostgresBin, ['--version']);
  const foundMajor = extractMajorVersion(postgresVersion);
  const foundBuildIdentity = extractBuildIdentity(postgresVersion);
  const initdbBuildIdentity = extractBuildIdentity(initdbVersion);
  const pgCtlBuildIdentity = extractBuildIdentity(pgCtlVersion);

  if (!initdbBuildIdentity || !pgCtlBuildIdentity || !foundMajor || !foundBuildIdentity) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
    console.error('Verification failed: initdb/pg_ctl/postgres --version did not run correctly in the copied tree.');
    process.exit(failExitCode);
  }

  if (
    foundMajor !== expected.major ||
    foundBuildIdentity !== expected.buildIdentity ||
    initdbBuildIdentity !== foundBuildIdentity ||
    pgCtlBuildIdentity !== foundBuildIdentity
  ) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
    console.error(
      `Verification failed: copied tree reports postgres ${foundBuildIdentity}, initdb ${initdbBuildIdentity}, pg_ctl ${pgCtlBuildIdentity}; expected ${expected.buildIdentity}.`,
    );
    process.exit(failExitCode);
  }

  // Atomic swap: remove old tree, rename tmp into place.
  if (existsSync(pgsqlDir)) {
    rmSync(pgsqlDir, { recursive: true, force: true });
  }
  renameSync(pgsqlTmpDir, pgsqlDir);

  const stats = computeTreeStats(pgsqlDir);
  writeJson(manifestPath, {
    sourcePath: postgresPrefix,
    version: foundBuildIdentity,
    majorVersion: foundMajor,
    buildIdentity: foundBuildIdentity,
    date: new Date().toISOString(),
    fileCount: stats.fileCount,
    totalBytes: stats.totalBytes,
  });

  console.log(
    `Provisioned pgsql/ from ${postgresPrefix} (PostgreSQL ${foundBuildIdentity}, ${stats.fileCount} files, ${stats.totalBytes} bytes).`,
  );
}

const expected = readExpectedVersion();
const existing = checkExistingInstall(expected);

if (!force) {
  if (existing.ok) {
    console.log(
      `pgsql/ up to date (PostgreSQL ${existing.foundBuildIdentity}, full-build manifest verified).`,
    );
    process.exit(0);
  }
  console.log(`pgsql/ needs provisioning: ${existing.reason}.`);
} else {
  console.log('Force re-provisioning requested.');
}

// Exit 2 tells callers (desktop-prepare.mjs) the on-disk tree is confirmed
// unusable and MUST NOT be shipped; exit 1 means provisioning failed but the
// existing tree was not proven wrong (safe to warn and continue).
const failExitCode = existing.hard ? 2 : 1;

if (process.platform === 'darwin') {
  provisionFromPrefix(expected, failExitCode);
} else {
  console.error(
    'Windows/Linux pgsql provisioning source not configured — to be filled in by user.',
  );
  process.exit(failExitCode);
}
