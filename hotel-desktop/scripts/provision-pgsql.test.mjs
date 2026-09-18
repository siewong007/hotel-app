// Tests for the pure helpers in provision-pgsql.mjs. Run: bun run test:scripts
// (or `bun test scripts/`). These do NOT provision anything — the script's main
// body is guarded behind argv[1] so importing it here is side-effect free.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  absoluteSymlinkIssues,
  bundleRpath,
  extractBuildIdentity,
  extractMajorVersion,
  isSystemDep,
  LINUX_SYSTEM_LIB,
  readExpectedVersion,
  REQUIRED_BIN_NAMES,
} from './provision-pgsql.mjs';

describe('extractMajorVersion', () => {
  test('parses beta, stable, and devel --version output', () => {
    expect(extractMajorVersion('postgres (PostgreSQL) 19beta2')).toBe('19');
    expect(extractMajorVersion('initdb (PostgreSQL) 19beta2')).toBe('19');
    expect(extractMajorVersion('postgres (PostgreSQL) 19.1')).toBe('19');
    expect(extractMajorVersion('postgres (PostgreSQL) 19.1 (Ubuntu 19.1-1)')).toBe('19');
    expect(extractMajorVersion('postgres (PostgreSQL) 19devel')).toBe('19');
  });

  test('returns undefined for unusable output', () => {
    expect(extractMajorVersion(undefined)).toBeUndefined();
    expect(extractMajorVersion('')).toBeUndefined();
    expect(extractMajorVersion('19beta2')).toBeUndefined(); // identity token, not raw output
    expect(extractMajorVersion('command not found')).toBeUndefined();
  });
});

describe('extractBuildIdentity', () => {
  test('keeps pre-release identity tokens verbatim (lowercased)', () => {
    expect(extractBuildIdentity('postgres (PostgreSQL) 19beta2')).toBe('19beta2');
    expect(extractBuildIdentity('postgres (PostgreSQL) 19Beta2')).toBe('19beta2');
    expect(extractBuildIdentity('postgres (PostgreSQL) 19rc1')).toBe('19rc1');
    expect(extractBuildIdentity('postgres (PostgreSQL) 19devel')).toBe('19devel');
  });

  test('stable releases collapse to the major version', () => {
    expect(extractBuildIdentity('postgres (PostgreSQL) 19.1')).toBe('19');
    expect(extractBuildIdentity('postgres (PostgreSQL) 17.5 (Homebrew)')).toBe('17');
  });

  test('returns undefined for unusable output', () => {
    expect(extractBuildIdentity(undefined)).toBeUndefined();
    expect(extractBuildIdentity('not a version string')).toBeUndefined();
  });
});

describe('readExpectedVersion', () => {
  test('tracks the pinned PostgreSQL identity in postgres.rs', () => {
    // Guard rail: bumping CONFIGURED_POSTGRES_BUILD_IDENTITY without updating
    // the provision sources (or this expectation) is caught here.
    const expected = readExpectedVersion();
    expect(expected.major).toBe('19');
    expect(expected.buildIdentity).toBe('19beta2');
  });
});

describe('REQUIRED_BIN_NAMES', () => {
  test('covers every binary postgres.rs shells out to', () => {
    // Keep this in sync with pgsql_bin.join(...) callers in
    // src-tauri/src/postgres.rs — the bundled tree must carry all of them.
    expect(REQUIRED_BIN_NAMES).toEqual([
      'initdb',
      'pg_ctl',
      'pg_dump',
      'pg_isready',
      'pg_restore',
      'postgres',
      'psql',
    ]);
  });
});

describe('bundleRpath (Linux $ORIGIN layout)', () => {
  const tree = join(sep, 'bundle');
  const libDirs = [join(tree, 'lib'), join(tree, 'lib', 'postgresql@19')];

  test('binaries get own dir + flat lib + nested pkglib', () => {
    const rpath = bundleRpath(join(tree, 'bin', 'postgres'), libDirs);
    expect(rpath.split(':')).toEqual([
      '$ORIGIN',
      `$ORIGIN${sep}..${sep}lib`,
      `$ORIGIN${sep}..${sep}lib${sep}postgresql@19`,
    ]);
  });

  test('pkglib modules reach flat lib via $ORIGIN/..', () => {
    const rpath = bundleRpath(join(tree, 'lib', 'postgresql@19', 'plpgsql.so'), libDirs);
    expect(rpath.split(':')).toEqual(['$ORIGIN', `$ORIGIN${sep}..`]);
  });

  test('no duplicate or empty entries', () => {
    const rpath = bundleRpath(join(tree, 'lib', 'libpq.so.5'), libDirs);
    const parts = rpath.split(':');
    expect(new Set(parts).size).toBe(parts.length);
    expect(parts.every(Boolean)).toBe(true);
  });
});

describe('Linux system-library allow-list', () => {
  test('glibc core and the loader are treated as system-provided', () => {
    for (const soname of [
      'linux-vdso.so.1',
      'ld-linux-x86-64.so.2',
      'ld-musl-x86_64.so.1',
      'libc.so.6',
      'libm.so.6',
      'libdl.so.2',
      'libpthread.so.0',
      'librt.so.1',
      'libresolv.so.2',
      'libutil.so.1',
      'libnss_files.so.2',
    ]) {
      expect(LINUX_SYSTEM_LIB.test(soname), soname).toBe(true);
    }
  });

  test('third-party libraries are NOT treated as system', () => {
    for (const soname of [
      'libpq.so.5',
      'libssl.so.3',
      'libcrypto.so.3',
      'libicui18n.so.76',
      'liblz4.so.1',
      'libz.so.1',
      'libxml2.so.2',
      'libedit.so.0',
    ]) {
      expect(LINUX_SYSTEM_LIB.test(soname), soname).toBe(false);
    }
  });
});

describe('absoluteSymlinkIssues', () => {
  // Regression: cpSync's default resolves each symlink target against the
  // source dir, baking absolute build-machine paths into the bundled tree —
  // the portable copy now sets verbatimSymlinks and provisioning itself runs
  // this check, so a bad tree can no longer pass provision and fail the next
  // invocation instead.
  test('flags absolute targets, ignores relative ones', () => {
    const tree = mkdtempSync(join(tmpdir(), 'pgsql-links-'));
    try {
      writeFileSync(join(tree, 'libpq.so.5'), 'x');
      symlinkSync('libpq.so.5', join(tree, 'libpq.so'));
      symlinkSync(join(tree, 'libpq.so.5'), join(tree, 'libecpg_compat.so.3'));
      const issues = absoluteSymlinkIssues(tree);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('libecpg_compat.so.3');
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});

describe('macOS system-dependency allow-list', () => {
  test('only /usr/lib and /System are system-provided', () => {
    expect(isSystemDep('/usr/lib/libSystem.B.dylib')).toBe(true);
    expect(isSystemDep('/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation')).toBe(true);
    expect(isSystemDep('/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib')).toBe(false);
    expect(isSystemDep('@rpath/libpq.dylib')).toBe(false);
  });
});
