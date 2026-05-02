import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const source = join(repoRoot, 'hotel-app-be', 'target', 'release', `hotel-app-be${isWindows ? '.exe' : ''}`);
const targetDir = join(desktopRoot, 'src-tauri', 'binaries');
const target = join(targetDir, `hotel-app-be-${hostTriple}${isWindows ? '.exe' : ''}`);

if (!existsSync(source)) {
  throw new Error(`Backend release binary not found: ${source}`);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

console.log(`Copied backend sidecar to ${target}`);
