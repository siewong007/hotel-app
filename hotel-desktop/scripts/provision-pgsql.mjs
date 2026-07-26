import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
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

  // A tree whose binaries reference dylibs outside the bundle (Homebrew, the
  // source-build prefix) or that carries absolute symlinks runs on the dev
  // machine but is dead on arrival on end-user machines.
  try {
    const externalRefs = REQUIRED_BIN_NAMES.flatMap((name) => {
      const binPath = join(pgsqlDir, 'bin', name);
      const id = machOId(binPath);
      return machODeps(binPath)
        .filter((dep) => dep !== id && !isSystemDep(dep) && !dep.startsWith('@'))
        .map((dep) => `${name} -> ${dep}`);
    });
    const absoluteSymlinks = walkTree(pgsqlDir)
      .symlinks.filter((linkPath) => readlinkSync(linkPath).startsWith('/'))
      .map((linkPath) => `absolute symlink ${linkPath}`);
    const issues = [...externalRefs, ...absoluteSymlinks];
    if (issues.length > 0) {
      return {
        ok: false,
        hard: true,
        reason: `bundled tree is not self-contained (${issues.slice(0, 3).join('; ')}${issues.length > 3 ? '; …' : ''})`,
      };
    }
  } catch (error) {
    return { ok: false, hard: false, reason: `could not verify bundled tree self-containment (${error.message})` };
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

// ---------------------------------------------------------------------------
// Self-containment (relocatability): the source build links libpq/libecpg by
// absolute prefix path and postgres links Homebrew openssl@3/icu4c dylibs, so a
// straight copy of the tree only runs on machines that have those exact paths.
// After copying, we bundle every external dylib into lib/, rewrite all install
// names to @loader_path-relative references, replace absolute symlinks, and
// ad-hoc re-sign (arm64 requires it after install_name_tool).

const MACHO_MAGICS = new Set([
  'feedface', 'cefaedfe', // 32-bit
  'feedfacf', 'cffaedfe', // 64-bit
  'cafebabe', 'bebafeca', // fat
]);

function isMachOFile(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const magic = Buffer.alloc(4);
    if (readSync(fd, magic, 0, 4, 0) < 4) {
      return false;
    }
    return MACHO_MAGICS.has(magic.toString('hex'));
  } finally {
    closeSync(fd);
  }
}

function walkTree(rootDir) {
  const files = [];
  const symlinks = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        symlinks.push(entryPath);
      } else if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return { files, symlinks };
}

function machOId(filePath) {
  // otool -D prints "<file>:\n<id>" for dylibs, just "<file>:" otherwise.
  const lines = execFileSync('otool', ['-D', filePath], { encoding: 'utf8' }).trim().split('\n');
  return lines.length >= 2 ? lines[1].trim() : undefined;
}

function machODeps(filePath) {
  // For dylibs the LC_ID_DYLIB row is included — callers filter it via machOId.
  const out = execFileSync('otool', ['-L', filePath], { encoding: 'utf8' });
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.match(/^\s+(.+?)\s+\(compatibility/))
    .filter(Boolean)
    .map((match) => match[1]);
}

function isSystemDep(dep) {
  return dep.startsWith('/usr/lib/') || dep.startsWith('/System/');
}

function relinkBundledTree(treeRoot) {
  const libDir = join(treeRoot, 'lib');
  const { files, symlinks } = walkTree(treeRoot);

  // Keg-style unversioned names (libpq.dylib -> libpq.5.dylib) are copied as
  // absolute symlinks into the source prefix; re-point them at the in-tree
  // sibling of the same basename.
  let rewrittenSymlinks = 0;
  for (const linkPath of symlinks) {
    const target = readlinkSync(linkPath);
    if (!target.startsWith('/')) {
      continue;
    }
    const sibling = join(dirname(linkPath), basename(target));
    if (sibling === linkPath || !existsSync(sibling)) {
      throw new Error(`absolute symlink ${linkPath} -> ${target} has no in-tree replacement`);
    }
    unlinkSync(linkPath);
    symlinkSync(basename(target), linkPath);
    rewrittenSymlinks += 1;
  }

  const machOFiles = files.filter(isMachOFile);
  const byBasename = new Map(machOFiles.map((filePath) => [basename(filePath), filePath]));
  const copiedFrom = new Map(); // in-tree path of a copied dylib -> its source dir
  const copiedLibs = [];
  const rewrittenFiles = [];

  const copyDepIntoTree = (sourceReal, name) => {
    const target = join(libDir, name);
    cpSync(sourceReal, target);
    chmodSync(target, 0o755); // Cellar dylibs can be read-only; install_name_tool needs write
    byBasename.set(name, target);
    copiedFrom.set(target, dirname(sourceReal));
    copiedLibs.push(name);
    return target;
  };

  const queue = [...machOFiles];
  while (queue.length > 0) {
    const filePath = queue.shift();
    const id = machOId(filePath);
    const args = [];

    for (const dep of machODeps(filePath)) {
      if (dep === id || isSystemDep(dep)) {
        continue;
      }
      if (dep.startsWith('@')) {
        // Already relative (Homebrew ICU uses @loader_path internally). If this
        // file was copied in, its companion must be copied alongside it.
        if (dep.startsWith('@loader_path/')) {
          const rest = dep.slice('@loader_path/'.length);
          if (!existsSync(resolve(dirname(filePath), rest))) {
            const sourceDir = copiedFrom.get(filePath);
            const sourceCompanion = sourceDir ? join(sourceDir, rest) : undefined;
            if (!sourceCompanion || !existsSync(sourceCompanion)) {
              throw new Error(`${filePath}: unresolvable reference ${dep}`);
            }
            queue.push(copyDepIntoTree(realpathSync(sourceCompanion), basename(rest)));
          }
        }
        continue;
      }
      const name = basename(dep);
      let target = byBasename.get(name);
      if (!target) {
        target = copyDepIntoTree(realpathSync(dep), name); // throws if missing on this machine
        queue.push(target);
      }
      args.push('-change', dep, `@loader_path/${relative(dirname(filePath), target)}`);
    }

    // Dylib IDs from the source build are absolute install paths; nothing links
    // against the bundle, but shipped binaries should not carry machine paths.
    if (id && id.startsWith('/') && !isSystemDep(id)) {
      args.unshift('-id', `@rpath/${basename(filePath)}`);
    }

    if (args.length > 0) {
      execFileSync('install_name_tool', [...args, filePath], { stdio: 'pipe' });
      execFileSync('codesign', ['--force', '--sign', '-', filePath], { stdio: 'pipe' });
      rewrittenFiles.push(filePath);
    }
  }

  return { rewrittenFiles, copiedLibs, rewrittenSymlinks };
}

function assertRelocatable(treeRoot) {
  const problems = [];
  const { files, symlinks } = walkTree(treeRoot);
  for (const linkPath of symlinks) {
    const target = readlinkSync(linkPath);
    if (target.startsWith('/')) {
      problems.push(`absolute symlink: ${linkPath} -> ${target}`);
    } else if (!existsSync(linkPath)) {
      problems.push(`dangling symlink: ${linkPath} -> ${target}`);
    }
  }
  for (const filePath of files) {
    if (!isMachOFile(filePath)) {
      continue;
    }
    const id = machOId(filePath);
    for (const dep of machODeps(filePath)) {
      if (dep === id || isSystemDep(dep)) {
        continue;
      }
      if (dep.startsWith('@loader_path/')) {
        if (!existsSync(resolve(dirname(filePath), dep.slice('@loader_path/'.length)))) {
          problems.push(`${filePath}: missing @loader_path target ${dep}`);
        }
      } else if (dep.startsWith('@executable_path/')) {
        if (!existsSync(resolve(join(treeRoot, 'bin'), dep.slice('@executable_path/'.length)))) {
          problems.push(`${filePath}: missing @executable_path target ${dep}`);
        }
      } else {
        problems.push(`${filePath}: external reference ${dep}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`tree is not self-contained:\n${problems.join('\n')}`);
  }
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

  let relink;
  try {
    relink = relinkBundledTree(pgsqlTmpDir);
    assertRelocatable(pgsqlTmpDir);
  } catch (error) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
    console.error(`Failed to make the copied PostgreSQL tree self-contained: ${error.message}`);
    process.exit(failExitCode);
  }
  console.log(
    `Relinked ${relink.rewrittenFiles.length} Mach-O files, bundled ${relink.copiedLibs.length} external dylibs` +
      `${relink.copiedLibs.length ? ` (${relink.copiedLibs.join(', ')})` : ''}, ` +
      `re-pointed ${relink.rewrittenSymlinks} absolute symlinks.`,
  );

  // Verify before swapping the tmp tree into place. This runs the RELINKED
  // binaries, so it also smoke-tests @loader_path resolution inside the tree.
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
    relocatable: true,
    bundledDylibs: relink.copiedLibs,
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
