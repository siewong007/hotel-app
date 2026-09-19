// Fixture test for build-update-manifest.mjs: builds a fake downloaded-
// artifacts tree shaped like what actions/download-artifact produces
// (artifact dir → target/release contents: raw binaries + bundle/**), runs the
// manifest builder, and asserts the emitted JSON shape, URLs, staged assets,
// and the hard-fail on a missing platform signature.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildUpdateManifest } from './build-update-manifest.mjs';

const TAG = 'v1.2.3';
const REPO = 'owner/name';

// Mirrors the upload-artifact globs in desktop-build.yml: the raw binary (and
// sidecar on Windows) sit at the artifact root; everything else is bundle/**.
const FIXTURE_FILES = {
  'hotel-desktop-macos-aarch64': [
    'hotel-desktop',
    'bundle/macos/Hotel Management System_1.2.3_aarch64.app.tar.gz',
    'bundle/macos/Hotel Management System_1.2.3_aarch64.app.tar.gz.sig',
    'bundle/macos/Hotel Management System.app/Contents/Info.plist',
    'bundle/dmg/Hotel Management System_1.2.3_aarch64.dmg',
  ],
  'hotel-desktop-windows-x86_64': [
    'hotel-desktop.exe',
    'hotel-app-be-x86_64-pc-windows-msvc.exe',
    'bundle/nsis/Hotel Management System_1.2.3_x64-setup.exe',
    'bundle/nsis/Hotel Management System_1.2.3_x64.nsis.zip',
    'bundle/nsis/Hotel Management System_1.2.3_x64.nsis.zip.sig',
    'bundle/msi/Hotel Management System_1.2.3_x64_en-US.msi',
    'bundle/hotel-desktop-windows-x86_64-portable.zip',
  ],
  'hotel-desktop-linux-x86_64': [
    'hotel-desktop',
    'bundle/deb/hotel-management-system_1.2.3_amd64.deb',
    'bundle/appimage/hotel-management-system_1.2.3_amd64.AppImage',
    'bundle/appimage/hotel-management-system_1.2.3_amd64.AppImage.tar.gz',
    'bundle/appimage/hotel-management-system_1.2.3_amd64.AppImage.tar.gz.sig',
    'bundle/hotel-desktop-linux-x86_64-portable.tar.gz',
  ],
};

let workDir;

const makeFixtures = () => {
  workDir = mkdtempSync(join(tmpdir(), 'update-manifest-'));
  const artifactsDir = join(workDir, 'artifacts');
  for (const [artifactDir, files] of Object.entries(FIXTURE_FILES)) {
    for (const rel of files) {
      const path = join(artifactsDir, artifactDir, rel);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, path.endsWith('.sig') ? `sig-for-${rel}\n` : `payload-${rel}`);
    }
  }
  return { artifactsDir, outDir: join(workDir, 'release') };
};

const run = (artifactsDir, outDir) =>
  buildUpdateManifest({ tag: TAG, artifactsDir, repo: REPO, outDir });

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('build-update-manifest', () => {
  test('emits latest.json with all three platforms, signatures, and URLs', () => {
    const { artifactsDir, outDir } = makeFixtures();
    const { manifest } = run(artifactsDir, outDir);

    expect(manifest.version).toBe('1.2.3');
    expect(Number.isNaN(Date.parse(manifest.pub_date))).toBe(false);
    expect(Object.keys(manifest.platforms).sort()).toEqual([
      'darwin-aarch64',
      'linux-x86_64',
      'windows-x86_64',
    ]);

    for (const entry of Object.values(manifest.platforms)) {
      expect(entry.signature.length).toBeGreaterThan(0);
      expect(entry.url.startsWith(`https://github.com/${REPO}/releases/download/${TAG}/`)).toBe(
        true,
      );
      // Fixture names contain spaces — the URL must be encoded or the updater
      // fetch 404s.
      expect(entry.url).not.toContain(' ');
    }
    expect(manifest.platforms['darwin-aarch64'].url).toBe(
      `https://github.com/${REPO}/releases/download/${TAG}/` +
        encodeURIComponent('Hotel Management System_1.2.3_aarch64.app.tar.gz'),
    );
    expect(manifest.platforms['windows-x86_64'].url).toContain('.nsis.zip');
    expect(manifest.platforms['linux-x86_64'].url).toContain('.AppImage.tar.gz');

    // The file on disk is the same JSON and ends with a newline.
    const onDisk = JSON.parse(readFileSync(join(outDir, 'latest.json'), 'utf8'));
    expect(onDisk).toEqual(manifest);
  });

  test('stages installers, updater bundles, sigs, portable archives — not raw bins or .app contents', () => {
    const { artifactsDir, outDir } = makeFixtures();
    const { assets } = run(artifactsDir, outDir);

    const staged = new Set(assets);
    // Wanted: every file under bundle/ except the unpacked .app tree.
    expect(staged).toContain('Hotel Management System_1.2.3_aarch64.app.tar.gz');
    expect(staged).toContain('Hotel Management System_1.2.3_aarch64.app.tar.gz.sig');
    expect(staged).toContain('Hotel Management System_1.2.3_aarch64.dmg');
    expect(staged).toContain('Hotel Management System_1.2.3_x64-setup.exe');
    expect(staged).toContain('Hotel Management System_1.2.3_x64.nsis.zip');
    expect(staged).toContain('Hotel Management System_1.2.3_x64.nsis.zip.sig');
    expect(staged).toContain('Hotel Management System_1.2.3_x64_en-US.msi');
    expect(staged).toContain('hotel-desktop-windows-x86_64-portable.zip');
    expect(staged).toContain('hotel-management-system_1.2.3_amd64.deb');
    expect(staged).toContain('hotel-management-system_1.2.3_amd64.AppImage');
    expect(staged).toContain('hotel-management-system_1.2.3_amd64.AppImage.tar.gz');
    expect(staged).toContain('hotel-management-system_1.2.3_amd64.AppImage.tar.gz.sig');
    expect(staged).toContain('hotel-desktop-linux-x86_64-portable.tar.gz');

    // Not wanted: raw binaries / sidecars (outside bundle/) and the unpacked
    // .app contents.
    expect(staged).not.toContain('hotel-desktop');
    expect(staged).not.toContain('hotel-desktop.exe');
    expect(staged).not.toContain('hotel-app-be-x86_64-pc-windows-msvc.exe');
    expect(staged).not.toContain('Info.plist');
    for (const name of assets) {
      expect(existsSync(join(outDir, name))).toBe(true);
    }
  });

  test('hard-fails when a platform signature is missing', () => {
    const { artifactsDir, outDir } = makeFixtures();
    rmSync(
      join(
        artifactsDir,
        'hotel-desktop-windows-x86_64',
        'bundle/nsis/Hotel Management System_1.2.3_x64.nsis.zip.sig',
      ),
    );
    expect(() => run(artifactsDir, outDir)).toThrow(/windows-x86_64.*signature/);
    expect(existsSync(join(outDir, 'latest.json'))).toBe(false);
  });

  test('hard-fails when a platform updater bundle is missing', () => {
    const { artifactsDir, outDir } = makeFixtures();
    rmSync(
      join(
        artifactsDir,
        'hotel-desktop-linux-x86_64',
        'bundle/appimage/hotel-management-system_1.2.3_amd64.AppImage.tar.gz',
      ),
    );
    expect(() => run(artifactsDir, outDir)).toThrow(/linux-x86_64/);
    expect(existsSync(join(outDir, 'latest.json'))).toBe(false);
  });
});
