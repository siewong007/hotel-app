import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sameFileContent } from './lib/build-cache.mjs';

const force = process.argv.includes('--force');
const profileArgIndex = process.argv.indexOf('--profile');
const profile = profileArgIndex === -1
  ? process.env.DESKTOP_BACKEND_PROFILE ?? 'release'
  : process.argv[profileArgIndex + 1];

if (!profile || profile.startsWith('--')) {
  throw new Error('Missing backend profile value after --profile.');
}
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const repoRoot = resolve(desktopRoot, '..');
const isWindows = process.platform === 'win32';

const rustVersion = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
const hostLine = rustVersion.split('\n').find((line) => line.startsWith('host: '));
const hostTriple = hostLine?.replace('host: ', '').trim();

if (!hostTriple) {
  throw new Error('Unable to determine Rust host target triple from rustc -vV');
}

const targetProfileDir = profile === 'release' ? 'release' : profile === 'debug' ? 'debug' : profile;
const source = join(repoRoot, 'hotel-app-be', 'target', targetProfileDir, `hotel-app-be${isWindows ? '.exe' : ''}`);
const targetDir = join(desktopRoot, 'src-tauri', 'binaries');
const target = join(targetDir, `hotel-app-be-${hostTriple}${isWindows ? '.exe' : ''}`);

if (!existsSync(source)) {
  throw new Error(`Backend ${profile} binary not found: ${source}`);
}

mkdirSync(targetDir, { recursive: true });
if (!force && sameFileContent(source, target)) {
  console.log(`Backend ${profile} sidecar already up to date at ${target}`);
  process.exit(0);
}

copyFileSync(source, target);

console.log(`Copied backend ${profile} sidecar to ${target}`);
