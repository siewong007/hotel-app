import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { envWithBunOnPath } from './lib/bun-path.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const tauriCli = join(desktopRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

if (!existsSync(tauriCli)) {
  throw new Error(`Tauri CLI not found at ${tauriCli}. Run bun install in hotel-desktop first.`);
}

const result = spawnSync(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  cwd: desktopRoot,
  env: envWithBunOnPath(),
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
