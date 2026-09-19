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
    'bundle/nsis/Hotel Management System_1.2.3_x64-setup.exe.sig',
    // The .msi is built and signed too, so the NSIS pattern has to choose.
    'bundle/msi/Hotel Management System_1.2.3_x64_en-US.msi',
    'bundle/msi/Hotel Management System_1.2.3_x64_en-US.msi.sig',
    'bundle/hotel-desktop-windows-x86_64-portable.zip',
  ],
  'hotel-desktop-linux-x86_64': [
    'hotel-desktop',
    'bundle/deb/hotel-management-system_1.2.3_amd64.deb',
    'bundle/deb/hotel-management-system_1.2.3_amd64.deb.sig',
    'bundle/appimage/hotel-management-system_1.2.3_amd64.AppImage',
    'bundle/appimage/hotel-management-system_1.2.3_amd64.AppImage.sig',
    // linuxdeploy's own tooling is an .AppImage too and carries no .sig —
    // selection must skip it rather than pick it and fail.
    'bundle/appimage/linuxdeploy-x86_64.AppImage',
    'bundle/hotel-desktop-linux-x86_64-portable.tar.gz',
  ],
};

let workDir;

const makeFixtures = ({ configVersion = '1.2.3' } = {}) => {
  workDir = mkdtempSync(join(tmpdir(), 'update-manifest-'));
  const artifactsDir = join(workDir, 'artifacts');
  for (const [artifactDir, files] of Object.entries(FIXTURE_FILES)) {
    for (const rel of files) {
      const path = join(artifactsDir, artifactDir, rel);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, path.endsWith('.sig') ? `sig-for-${rel}\n` : `payload-${rel}`);
    }
  }
  // Stand-in for src-tauri/tauri.conf.json — the manifest version contract.
  const configPath = join(workDir, 'tauri.conf.json');
  writeFileSync(configPath, JSON.stringify({ version: configVersion }));
  return { artifactsDir, outDir: join(workDir, 'release'), configPath };
};

const run = (artifactsDir, outDir, configPath, notes) =>
  buildUpdateManifest({ tag: TAG, artifactsDir, repo: REPO, outDir, configPath, notes });

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('build-update-manifest', () => {
  test('emits latest.json with all three platforms, signatures, and URLs', () => {
    const { artifactsDir, outDir, configPath } = makeFixtures();
    const { manifest, assets } = run(artifactsDir, outDir, configPath);

    expect(manifest.version).toBe('1.2.3');
    expect(Number.isNaN(Date.parse(manifest.pub_date))).toBe(false);
    expect(Object.keys(manifest.platforms).sort()).toEqual([
      'darwin-aarch64',
      'linux-x86_64',
      'windows-x86_64',
    ]);

    const staged = new Set(assets);
    for (const entry of Object.values(manifest.platforms)) {
      expect(entry.signature.length).toBeGreaterThan(0);
      expect(entry.url.startsWith(`https://github.com/${REPO}/releases/download/${TAG}/`)).toBe(
        true,
      );
      // GitHub renames uploaded assets server-side (spaces become dots), so
      // the URL must name the SANITIZED staged file — not the on-disk name —
      // or the updater fetch 404s. Assert url basename == staged basename.
      const urlName = decodeURIComponent(entry.url.split('/').pop());
      expect(urlName).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(staged.has(urlName)).toBe(true);
    }
    expect(manifest.platforms['darwin-aarch64'].url).toBe(
      `https://github.com/${REPO}/releases/download/${TAG}/` +
        'Hotel-Management-System_1.2.3_aarch64.app.tar.gz',
    );
    expect(manifest.platforms['windows-x86_64'].url).toContain('-setup.exe');
    expect(manifest.platforms['linux-x86_64'].url).toMatch(/\.AppImage$/);

    // The file on disk is the same JSON and ends with a newline.
    const onDisk = JSON.parse(readFileSync(join(outDir, 'latest.json'), 'utf8'));
    expect(onDisk).toEqual(manifest);
  });

  test('stages installers, updater bundles, sigs, portable archives under GitHub-safe names', () => {
    const { artifactsDir, outDir, configPath } = makeFixtures();
    const { assets } = run(artifactsDir, outDir, configPath);

    const staged = new Set(assets);
    // Wanted: every file under bundle/ except the unpacked .app tree, renamed
    // to a basename GitHub will not rewrite on upload.
    expect(staged).toContain('Hotel-Management-System_1.2.3_aarch64.app.tar.gz');
    expect(staged).toContain('Hotel-Management-System_1.2.3_aarch64.app.tar.gz.sig');
    expect(staged).toContain('Hotel-Management-System_1.2.3_aarch64.dmg');
    expect(staged).toContain('Hotel-Management-System_1.2.3_x64-setup.exe');
    expect(staged).toContain('Hotel-Management-System_1.2.3_x64-setup.exe.sig');
    expect(staged).toContain('Hotel-Management-System_1.2.3_x64_en-US.msi');
    expect(staged).toContain('hotel-desktop-windows-x86_64-portable.zip');
    expect(staged).toContain('hotel-management-system_1.2.3_amd64.deb');
    expect(staged).toContain('hotel-management-system_1.2.3_amd64.AppImage');
    expect(staged).toContain('hotel-management-system_1.2.3_amd64.AppImage.sig');
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
    const { artifactsDir, outDir, configPath } = makeFixtures();
    rmSync(
      join(
        artifactsDir,
        'hotel-desktop-windows-x86_64',
        'bundle/nsis/Hotel Management System_1.2.3_x64-setup.exe.sig',
      ),
    );
    expect(() => run(artifactsDir, outDir, configPath)).toThrow(
      /windows-x86_64.*signature/,
    );
    expect(existsSync(join(outDir, 'latest.json'))).toBe(false);
  });

  test('hard-fails when a platform updater bundle is missing', () => {
    const { artifactsDir, outDir, configPath } = makeFixtures();
    rmSync(
      join(artifactsDir, 'hotel-desktop-linux-x86_64', 'bundle/appimage'),
      { recursive: true },
    );
    expect(() => run(artifactsDir, outDir, configPath)).toThrow(/linux-x86_64/);
    expect(existsSync(join(outDir, 'latest.json'))).toBe(false);
  });

  test('skips an unsigned tooling .AppImage and picks the signed bundle', () => {
    // Regression: linuxdeploy-x86_64.AppImage sits in the same bundle dir and
    // matches /\.AppImage$/, but has no sibling .sig. Selecting it would fail
    // the whole release as a missing signature.
    const { artifactsDir, outDir, configPath } = makeFixtures();
    const { manifest } = run(artifactsDir, outDir, configPath);
    const url = manifest.platforms['linux-x86_64'].url;
    expect(decodeURIComponent(url)).toContain(
      'hotel-management-system_1.2.3_amd64.AppImage',
    );
    expect(url).not.toContain('linuxdeploy');
  });

  test('hard-fails when the tag does not match tauri.conf.json version', () => {
    // A v1.2.3 tag over a 9.9.9 config would publish a manifest advertising a
    // version no installed build can reach — infinite update-offer loop.
    const { artifactsDir, outDir, configPath } = makeFixtures({
      configVersion: '9.9.9',
    });
    expect(() => run(artifactsDir, outDir, configPath)).toThrow(
      /tag v1\.2\.3 does not match tauri\.conf\.json version 9\.9\.9/,
    );
    expect(existsSync(join(outDir, 'latest.json'))).toBe(false);
  });

  test('carries the tag annotation into latest.json notes', () => {
    const { artifactsDir, outDir, configPath } = makeFixtures();
    const { manifest } = run(
      artifactsDir,
      outDir,
      configPath,
      'correções do fechamento\nsegundo parágrafo\n',
    );
    expect(manifest.notes).toBe('correções do fechamento\nsegundo parágrafo');
  });

  test('notes is null when the tag carries no annotation', () => {
    const { artifactsDir, outDir, configPath } = makeFixtures();
    const { manifest } = run(artifactsDir, outDir, configPath);
    expect(manifest.notes).toBeNull();
  });

  test('hard-fails when two artifacts sanitize to the same staged name', () => {
    // `Hotel-Management-System_…dmg` and the spaced variant both sanitize to
    // `Hotel-Management-System_…dmg` — silently shipping whichever staged
    // last would publish the wrong asset, so refuse instead.
    const { artifactsDir, outDir, configPath } = makeFixtures();
    const colliding = join(
      artifactsDir,
      'hotel-desktop-macos-aarch64',
      'bundle/dmg/Hotel-Management-System_1.2.3_aarch64.dmg',
    );
    writeFileSync(colliding, 'payload-collision');
    expect(() => run(artifactsDir, outDir, configPath)).toThrow(
      /asset name collision after sanitize/,
    );
    expect(existsSync(join(outDir, 'latest.json'))).toBe(false);
  });
});
