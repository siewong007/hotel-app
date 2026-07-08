import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { envWithBunOnPath } from './lib/bun-path.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const tauriCli = join(desktopRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

const tauriArgs = [];
let backendProfile = process.env.DESKTOP_BACKEND_PROFILE;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];

  if (arg === '--backend-profile') {
    backendProfile = process.argv[index + 1];
    index += 1;
    continue;
  }

  if (arg.startsWith('--backend-profile=')) {
    backendProfile = arg.slice('--backend-profile='.length);
    continue;
  }

  tauriArgs.push(arg);
}

if (!existsSync(tauriCli)) {
  throw new Error(`Tauri CLI not found at ${tauriCli}. Run bun install in hotel-desktop first.`);
}

const result = spawnSync(process.execPath, [tauriCli, 'build', ...tauriArgs], {
  cwd: desktopRoot,
  env: envWithBunOnPath({
    ...process.env,
    ...(backendProfile ? { DESKTOP_BACKEND_PROFILE: backendProfile } : {}),
  }),
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
