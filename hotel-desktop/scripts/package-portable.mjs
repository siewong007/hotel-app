// Packages the `tauri build --no-bundle` output as a portable zip: the app
// binary, the backend sidecar, and the embedded PostgreSQL/database resources,
// all resolved next to the executable at runtime. No installer required —
// meant for validation and for machines where running an installer is not an
// option. Requires a prior `bun run build:no-bundle` (or `bun run build`).
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { arch, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const releaseDir = join(desktopRoot, 'src-tauri', 'target', 'release');
const outDir = join(releaseDir, 'bundle');

const isWindows = platform() === 'win32';
const exeSuffix = isWindows ? '.exe' : '';
const platformName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[platform()] ?? platform();
const archName = { arm64: 'aarch64' }[arch()] ?? arch();
// Windows/macOS ship bsdtar, so `tar -a` writes a real .zip chosen by the file
// extension. GNU tar (Linux) has no zip writer — emit .tar.gz there instead.
const archiveExt = isWindows || platform() === 'darwin' ? 'zip' : 'tar.gz';
const outName = `hotel-desktop-${platformName}-${archName}-portable.${archiveExt}`;
const outPath = join(outDir, outName);

if (!existsSync(releaseDir)) {
  console.error(
    `No release output at ${releaseDir}. Run 'bun run build:no-bundle' (or 'bun run build') first.`,
  );
  process.exit(1);
}

// Payload = everything the app resolves relative to its own executable:
// the Tauri binary, the backend sidecar, and the bundled resource trees.
const sidecars = readdirSync(releaseDir).filter((entry) =>
  /^hotel-app-be-.+?\.exe$/.test(entry) || /^hotel-app-be-[^.]+$/.test(entry),
);
const payload = [
  `hotel-desktop${exeSuffix}`,
  ...sidecars,
  'pgsql',
  'database',
].filter((entry) => existsSync(join(releaseDir, entry)));

if (!existsSync(join(releaseDir, `hotel-desktop${exeSuffix}`))) {
  console.error(
    `hotel-desktop${exeSuffix} not found in ${releaseDir} — run 'bun run build:no-bundle' first.`,
  );
  process.exit(1);
}
if (sidecars.length === 0) {
  console.error(`No hotel-app-be-<triple> sidecar found in ${releaseDir} — was the sidecar copied?`);
  process.exit(1);
}
if (!payload.includes('pgsql') || !payload.includes('database')) {
  console.error(
    `pgsql/ and/or database/ resources are missing under ${releaseDir} — ` +
      `run 'bun run desktop:prepare' then build again.`,
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const tarArgs = archiveExt === 'zip'
  ? ['-a', '-c', '-f', outPath, '-C', releaseDir, ...payload]
  : ['-c', '-z', '-f', outPath, '-C', releaseDir, ...payload];
const result = spawnSync('tar', tarArgs, { stdio: 'inherit' });

if (result.status !== 0) {
  console.error(`tar failed with exit code ${result.status ?? 1}`);
  process.exit(result.status ?? 1);
}

console.log(`Portable package written to ${outPath}`);
console.log(`Contents: ${payload.join(', ')}`);
