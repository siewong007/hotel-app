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
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectInputFiles, readJson, writeJson } from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const srcTauriRoot = join(desktopRoot, 'src-tauri');
const pgsqlDir = join(srcTauriRoot, 'pgsql');
const pgsqlTmpDir = join(srcTauriRoot, 'pgsql.tmp');
const manifestPath = join(pgsqlDir, '.provision-manifest.json');

const PLATFORM = process.platform;
const EXE_SUFFIX = PLATFORM === 'win32' ? '.exe' : '';

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
  const postgresBin = join(pgsqlDir, 'bin', `postgres${EXE_SUFFIX}`);
  const initdbBin = join(pgsqlDir, 'bin', `initdb${EXE_SUFFIX}`);
  const pgCtlBin = join(pgsqlDir, 'bin', `pg_ctl${EXE_SUFFIX}`);

  // `hard: true` marks a tree that is CONFIRMED unusable (wrong build, broken
  // or incomplete binaries) — if provisioning then fails, the build must not
  // fall back to it. `hard: false` covers states where the tree may still be
  // fine (e.g. manifest predates its introduction).
  const missing = REQUIRED_BIN_NAMES.filter((name) => !existsSync(join(pgsqlDir, 'bin', `${name}${EXE_SUFFIX}`)));
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

  // A tree whose binaries reference libraries outside the bundle (Homebrew, the
  // source-build prefix, system package dirs) or that carries absolute symlinks
  // runs on the dev machine but is dead on arrival on end-user machines. Each
  // platform gets its own self-containment check; Windows needs none beyond the
  // --version probes above (DLLs resolve next to the exe).
  try {
    const issues = [];
    if (PLATFORM === 'darwin') {
      issues.push(...macosTreeIssues(pgsqlDir));
    } else if (PLATFORM === 'linux') {
      issues.push(...linuxTreeIssues(pgsqlDir));
    }
    issues.push(...absoluteSymlinkIssues(pgsqlDir));
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

// Absolute symlink targets (e.g. libpq.so -> /build/prefix/lib/libpq.so.5)
// die on the end-user machine; only relative links survive relocation.
function absoluteSymlinkIssues(treeRoot) {
  return walkTree(treeRoot)
    .symlinks.filter((linkPath) => {
      const target = readlinkSync(linkPath);
      return target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target);
    })
    .map((linkPath) => `absolute symlink ${linkPath} -> ${readlinkSync(linkPath)}`);
}

// macOS self-containment: bundled Mach-O files must not reference dylibs
// outside the tree (Homebrew kegs, the source-build prefix).
function macosTreeIssues(treeRoot) {
  return REQUIRED_BIN_NAMES.flatMap((name) => {
    const binPath = join(treeRoot, 'bin', name);
    const id = machOId(binPath);
    return machODeps(binPath)
      .filter((dep) => dep !== id && !isSystemDep(dep) && !dep.startsWith('@'))
      .map((dep) => `${name} -> ${dep}`);
  });
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

  // Homebrew lookup is a macOS convenience only; Linux/Windows require an
  // explicit POSTGRES_PREFIX (there is no equivalent canonical install root).
  if (PLATFORM === 'darwin') {
    return locateBrewPrefix(major);
  }
  return undefined;
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

// ---------------------------------------------------------------------------
// Linux self-containment: bundled ELF binaries/libs must resolve every needed
// library inside the tree (or against libc core). Provisioning writes $ORIGIN
// rpaths via patchelf and copies external libs flat into pgsql/lib/.

const ELF_MAGIC = 0x464c457f; // "\x7fELF" little-endian
const ELF_FILE_BYTES = Buffer.alloc(4);

function isElfFile(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    if (readSync(fd, ELF_FILE_BYTES, 0, 4, 0) < 4) {
      return false;
    }
    return ELF_FILE_BYTES.readUInt32LE(0) === ELF_MAGIC;
  } finally {
    closeSync(fd);
  }
}

// The glibc core is guaranteed on any Linux desktop that can run Tauri
// (WebKitGTK already needs it); bundling it would create version conflicts.
const LINUX_SYSTEM_LIB = /^(?:linux-vdso|ld-linux|ld-musl|ld64|libc\.so|libm\.so|libdl\.so|libpthread\.so|librt\.so|libresolv\.so|libutil\.so|libnss_)/;

function lddDeps(filePath) {
  const resolved = new Map(); // soname -> absolute path
  const missing = [];
  let out;
  try {
    out = execFileSync('ldd', [filePath], { encoding: 'utf8' });
  } catch {
    return { resolved, missing };
  }
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    const arrow = trimmed.match(/^(\S+)\s*=>\s*(\S+)/);
    if (arrow) {
      if (arrow[2] === 'not' || trimmed.endsWith('not found')) {
        missing.push(arrow[1]);
      } else if (!LINUX_SYSTEM_LIB.test(arrow[1])) {
        resolved.set(arrow[1], arrow[2].split(' ')[0]);
      }
      continue;
    }
    // Unnamed lines like "/lib64/ld-linux-x86-64.so.2 (0x...)": the loader —
    // always system-provided.
  }
  return { resolved, missing };
}

function linuxTreeIssues(treeRoot) {
  const issues = [];
  for (const filePath of walkTree(treeRoot).files) {
    if (!isElfFile(filePath)) {
      continue;
    }
    for (const soname of lddDeps(filePath).missing) {
      issues.push(`${relative(treeRoot, filePath)} -> ${soname} not found`);
    }
  }
  return issues;
}

// The rpath that lets an ELF inside the bundle find its libraries without any
// environment overrides: its own dir plus every directory under lib/ that
// holds shared objects — bin/* needs the nested pkglib dir (libpq.so lives in
// lib/postgresql@19/, not flat lib/) and external deps are copied flat into
// lib/, so every ELF gets the full set relative to itself.
function bundleRpath(filePath, libDirs) {
  const parts = ['$ORIGIN'];
  const seen = new Set(parts);
  for (const libDir of libDirs) {
    const relToLib = relative(dirname(filePath), libDir);
    const entry = relToLib && relToLib !== '.' ? `$ORIGIN/${relToLib}` : '$ORIGIN';
    if (!seen.has(entry)) {
      seen.add(entry);
      parts.push(entry);
    }
  }
  return parts.join(':');
}

// Copy every non-system library the bundled ELFs resolve into pgsql/lib/,
// iterating because newly copied libs can bring their own external deps.
function bundleExternalLibs(treeRoot, libDir) {
  const bundled = new Set();
  const seen = new Set();
  let pending = walkTree(treeRoot).files.filter(isElfFile);

  while (pending.length > 0) {
    const next = [];
    for (const filePath of pending) {
      if (seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      for (const [soname, depPath] of lddDeps(filePath).resolved) {
        if (!depPath.startsWith('/')) {
          continue; // already a relative/bundled reference
        }
        const insideTree = resolve(depPath).startsWith(treeRoot + sep);
        const target = join(libDir, soname);
        if (insideTree || bundled.has(soname) || existsSync(target)) {
          continue;
        }
        cpSync(realpathSync(depPath), target);
        chmodSync(target, 0o755);
        bundled.add(soname);
        if (isElfFile(target)) {
          next.push(target);
        }
      }
    }
    pending = next;
  }

  return [...bundled];
}

// Absolute symlinks cannot ship in the bundle: they bake in a path from the
// provisioning machine. They still show up here — a from-source install can
// carry absolute links of its own, and tree copies that resolved relative
// link text to absolute source-prefix paths (the bun cpSync preserveTimestamps
// behavior verbatimSymlinks now guards against) produced them too. Re-point
// each one at its in-tree counterpart: the resolved target when it lands
// inside the tree, otherwise the same-named sibling entry (soname links sit
// next to their targets). A link with no in-tree counterpart stays absolute
// and is rejected by the caller below.
function relativizeTreeSymlinks(treeRoot) {
  const dirEntries = new Map();
  // Presence check by directory listing, not existsSync — a sibling that is
  // itself a not-yet-rewritten symlink must still count as an in-tree entry.
  const hasDirEntry = (dir, name) => {
    if (!dirEntries.has(dir)) {
      dirEntries.set(dir, new Set(readdirSync(dir)));
    }
    return dirEntries.get(dir).has(name);
  };

  let rewritten = 0;
  for (const linkPath of walkTree(treeRoot).symlinks) {
    const target = readlinkSync(linkPath);
    if (!target.startsWith('/')) {
      continue;
    }
    const resolvedTarget = resolve(target);
    let newTarget;
    if (resolvedTarget === treeRoot || resolvedTarget.startsWith(treeRoot + sep)) {
      newTarget = relative(dirname(linkPath), resolvedTarget) || '.';
    } else if (
      basename(target) !== basename(linkPath) &&
      hasDirEntry(dirname(linkPath), basename(target))
    ) {
      newTarget = basename(target);
    } else {
      continue;
    }
    unlinkSync(linkPath);
    symlinkSync(newTarget, linkPath);
    rewritten += 1;
  }
  return rewritten;
}

function relinkLinuxTree(treeRoot) {
  const libDir = join(treeRoot, 'lib');
  try {
    execFileSync('patchelf', ['--version'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'patchelf is required to make the bundled PostgreSQL tree relocatable on Linux ' +
        '(apt install patchelf / dnf install patchelf).',
    );
  }

  const bundledLibs = bundleExternalLibs(treeRoot, libDir);

  const rewrittenLinks = relativizeTreeSymlinks(treeRoot);
  const strayLinks = walkTree(treeRoot)
    .symlinks.filter((linkPath) => readlinkSync(linkPath).startsWith('/'))
    .map((linkPath) => `${linkPath} -> ${readlinkSync(linkPath)}`);
  if (strayLinks.length > 0) {
    throw new Error(
      `tree is not self-contained: absolute symlinks with no in-tree counterpart ` +
        `(${strayLinks.slice(0, 5).join('; ')}${strayLinks.length > 5 ? '; …' : ''})`,
    );
  }

  const allFiles = walkTree(treeRoot).files;
  const libDirs = new Set([libDir]);
  for (const filePath of allFiles) {
    if (isElfFile(filePath) && dirname(filePath).startsWith(libDir + sep)) {
      libDirs.add(dirname(filePath));
    }
  }

  let rewritten = 0;
  for (const filePath of allFiles) {
    if (!isElfFile(filePath)) {
      continue;
    }
    execFileSync('patchelf', ['--set-rpath', bundleRpath(filePath, [...libDirs]), filePath], {
      stdio: 'pipe',
    });
    rewritten += 1;
  }
  return { rewrittenFiles: rewritten, bundledLibs, rewrittenLinks };
}

// ---------------------------------------------------------------------------
// Portable provisioning (Linux + Windows): copy bin/, lib/, share/postgresql*
// from a POSTGRES_PREFIX install root verbatim. PostgreSQL binaries self-locate
// their share/pkglib dirs from the exe path via the tail baked in at configure
// time, so preserving the prefix's directory names keeps relocation working on
// every platform without rewriting paths inside files.

const PORTABLE_SKIP_LIB_ENTRIES = new Set(['pkgconfig']);

function copyPortablePrefixTree(postgresPrefix) {
  const sourceBinDir = join(postgresPrefix, 'bin');
  const sourceLibDir = join(postgresPrefix, 'lib');
  const sourceShareDir = join(postgresPrefix, 'share');
  if (!existsSync(sourceBinDir) || !existsSync(sourceShareDir)) {
    throw new Error(
      `${postgresPrefix} does not look like a PostgreSQL install prefix (needs bin/ and share/).`,
    );
  }

  for (const binName of REQUIRED_BIN_NAMES) {
    const sourceBin = join(sourceBinDir, `${binName}${EXE_SUFFIX}`);
    if (!existsSync(sourceBin)) {
      throw new Error(`Expected PostgreSQL binary not found: ${sourceBin}`);
    }
    cpSync(sourceBin, join(pgsqlTmpDir, 'bin', `${binName}${EXE_SUFFIX}`), {
      preserveTimestamps: true,
    });
  }

  // Windows resolves DLLs from the exe directory: every DLL the PostgreSQL
  // build links (OpenSSL/ICU/lz4/zlib, vcpkg or EDB-provided) must ride along
  // in bin/. CI copies dependency DLLs into the prefix before provisioning.
  if (PLATFORM === 'win32') {
    let dllCount = 0;
    for (const entry of readdirSync(sourceBinDir)) {
      if (!entry.toLowerCase().endsWith('.dll')) {
        continue;
      }
      cpSync(join(sourceBinDir, entry), join(pgsqlTmpDir, 'bin', entry), {
        preserveTimestamps: true,
      });
      dllCount += 1;
    }
    if (dllCount === 0) {
      throw new Error(
        `${sourceBinDir} contains no DLLs — copy the PostgreSQL runtime dependencies ` +
          '(libcrypto/libssl, icu*, lz4, zlib) into the prefix bin/ before provisioning.',
      );
    }
  }

  if (existsSync(sourceLibDir)) {
    for (const entry of readdirSync(sourceLibDir)) {
      if (PORTABLE_SKIP_LIB_ENTRIES.has(entry)) {
        continue;
      }
      // verbatimSymlinks: cpSync's default resolves each link target against
      // the SOURCE dir and bakes that absolute path into the copy — a libpq.so
      // -> libpq.so.5 link would silently become libpq.so -> <prefix>/... and
      // the tree would fail self-containment on the next provisioning check.
      cpSync(join(sourceLibDir, entry), join(pgsqlTmpDir, 'lib', entry), {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
    }
  }

  // share/postgresql, share/postgresql@19, …: keep whatever name(s) the build
  // configured so the compiled-in share tail resolves under the bundle.
  const shareEntries = readdirSync(sourceShareDir).filter((entry) =>
    entry.startsWith('postgresql'),
  );
  if (shareEntries.length === 0) {
    throw new Error(
      `${sourceShareDir} has no postgresql* directory — unsupported prefix layout.`,
    );
  }
  for (const entry of shareEntries) {
    cpSync(join(sourceShareDir, entry), join(pgsqlTmpDir, 'share', entry), {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }
}

function verifyPortableTree(expected, failExitCode) {
  const rawVersions = {};
  const versions = {};
  // psql links libpq — running it proves the client library (and, on Windows,
  // the DLLs beside the exes) actually resolves inside the copied tree.
  for (const binName of ['postgres', 'initdb', 'pg_ctl', 'psql']) {
    rawVersions[binName] = runVersionCommand(
      join(pgsqlTmpDir, 'bin', `${binName}${EXE_SUFFIX}`),
      ['--version'],
    );
    versions[binName] = extractBuildIdentity(rawVersions[binName]);
    if (!versions[binName]) {
      rmSync(pgsqlTmpDir, { recursive: true, force: true });
      console.error(`Verification failed: ${binName} --version did not run in the copied tree.`);
      process.exit(failExitCode);
    }
  }

  if (
    extractMajorVersion(rawVersions.postgres) !== expected.major ||
    versions.postgres !== expected.buildIdentity ||
    versions.initdb !== versions.postgres ||
    versions.pg_ctl !== versions.postgres ||
    versions.psql !== versions.postgres
  ) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
    console.error(
      `Verification failed: copied tree reports postgres ${versions.postgres}, initdb ${versions.initdb}, pg_ctl ${versions.pg_ctl}, psql ${versions.psql}; expected ${expected.buildIdentity}.`,
    );
    process.exit(failExitCode);
  }

  return versions.postgres;
}

function provisionPortableFromPrefix(expected, failExitCode = 1) {
  const postgresPrefix = locatePostgresPrefix(expected.major);
  if (!postgresPrefix) {
    console.error(
      `POSTGRES_PREFIX is not set. Point it at a PostgreSQL ${expected.buildIdentity} install prefix\n` +
        `(a from-source build; see docs/guides/desktop-packaging.md for the per-OS recipe), then re-run this script.`,
    );
    process.exit(failExitCode);
  }

  console.log(`Provisioning embedded PostgreSQL ${expected.buildIdentity} from ${postgresPrefix}`);

  if (existsSync(pgsqlTmpDir)) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
  }

  try {
    copyPortablePrefixTree(postgresPrefix);
  } catch (error) {
    rmSync(pgsqlTmpDir, { recursive: true, force: true });
    console.error(`Failed to copy PostgreSQL tree: ${error.message}`);
    process.exit(failExitCode);
  }

  let relink = { rewrittenFiles: 0, bundledLibs: [] };
  if (PLATFORM === 'linux') {
    try {
      relink = relinkLinuxTree(pgsqlTmpDir);
      const issues = [...linuxTreeIssues(pgsqlTmpDir), ...absoluteSymlinkIssues(pgsqlTmpDir)];
      if (issues.length > 0) {
        throw new Error(`tree is not self-contained:\n${issues.slice(0, 10).join('\n')}`);
      }
    } catch (error) {
      rmSync(pgsqlTmpDir, { recursive: true, force: true });
      console.error(`Failed to make the copied PostgreSQL tree self-contained: ${error.message}`);
      process.exit(failExitCode);
    }
    console.log(
      `Rewrote rpaths on ${relink.rewrittenFiles} ELF files, bundled ${relink.bundledLibs.length} external libs` +
        `${relink.bundledLibs.length ? ` (${relink.bundledLibs.join(', ')})` : ''}, ` +
        `re-pointed ${relink.rewrittenLinks} absolute symlinks.`,
    );
  }

  const foundBuildIdentity = verifyPortableTree(expected, failExitCode);

  if (existsSync(pgsqlDir)) {
    rmSync(pgsqlDir, { recursive: true, force: true });
  }
  renameSync(pgsqlTmpDir, pgsqlDir);

  const stats = computeTreeStats(pgsqlDir);
  writeJson(manifestPath, {
    sourcePath: postgresPrefix,
    version: foundBuildIdentity,
    majorVersion: expected.major,
    buildIdentity: foundBuildIdentity,
    platform: PLATFORM,
    date: new Date().toISOString(),
    fileCount: stats.fileCount,
    totalBytes: stats.totalBytes,
    relocatable: true,
    bundledLibs: relink.bundledLibs,
  });

  console.log(
    `Provisioned pgsql/ from ${postgresPrefix} (PostgreSQL ${foundBuildIdentity}, ${stats.fileCount} files, ${stats.totalBytes} bytes).`,
  );
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

// Exported for scripts/provision-pgsql.test.mjs — pure helpers only; the
// provisioning main body below stays guarded so importing this module does
// not execute it.
export {
  absoluteSymlinkIssues,
  bundleRpath,
  extractBuildIdentity,
  extractMajorVersion,
  isElfFile,
  isMachOFile,
  isSystemDep,
  LINUX_SYSTEM_LIB,
  readExpectedVersion,
  REQUIRED_BIN_NAMES,
  walkTree,
};

const invokedAsScript =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
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

  if (PLATFORM === 'darwin') {
    provisionFromPrefix(expected, failExitCode);
  } else if (PLATFORM === 'linux' || PLATFORM === 'win32') {
    provisionPortableFromPrefix(expected, failExitCode);
  } else {
    console.error(`Unsupported platform for embedded PostgreSQL provisioning: ${PLATFORM}`);
    process.exit(failExitCode);
  }
}
