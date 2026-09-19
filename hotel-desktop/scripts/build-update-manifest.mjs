// Assembles the Tauri updater manifest (latest.json) and stages the release
// assets from the desktop-build workflow's downloaded artifacts. Run by the
// desktop-release job on tag pushes:
//
//   bun hotel-desktop/scripts/build-update-manifest.mjs \
//     --tag v1.0.0 --artifacts ./artifacts --repo owner/name --out ./release
//
// Produces <out>/latest.json plus a flat copy of every installer, updater
// bundle, .sig, and portable archive. Hard-fails when ANY platform's updater
// bundle or signature is missing — publishing a manifest without one would
// leave that platform's installs permanently unable to update.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Updater bundle per platform, matched against the file name. These are the
// artifacts `bundle.createUpdaterArtifacts` emits next to the installers:
// macOS .app.tar.gz, Windows NSIS .nsis.zip, Linux .AppImage.tar.gz — each
// with a sibling <name>.sig holding the minisign signature.
const PLATFORM_ARTIFACTS = {
  'darwin-aarch64': { match: /\.app\.tar\.gz$/, artifact: 'hotel-desktop-macos-aarch64' },
  'windows-x86_64': { match: /\.nsis\.zip$/, artifact: 'hotel-desktop-windows-x86_64' },
  'linux-x86_64': { match: /\.AppImage\.tar\.gz$/, artifact: 'hotel-desktop-linux-x86_64' },
};

const walk = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else {
      files.push(path);
    }
  }
  return files;
};

// Release assets = every file under a `bundle/` directory, except the unpacked
// `.app/` tree (the .app.tar.gz updater bundle and the .dmg already cover it).
// Files outside `bundle/` are the raw build outputs uploaded for debugging —
// the `hotel-desktop` binary and the `hotel-app-be-*` sidecar — which are
// meaningless as standalone downloads.
const isReleaseAsset = (path) => {
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => part.endsWith('.app'))) return false;
  return parts.includes('bundle');
};

// Resolved relative to this script so the release job can invoke it from any
// cwd. Injectable via `configPath` for tests.
const DEFAULT_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-tauri',
  'tauri.conf.json',
);

// The tag is the release's version contract: latest.json tells every client
// "tag vX.Y.Z carries app version X.Y.Z". A tag that doesn't match the bundled
// version produces a manifest advertising a release no client can reach — an
// infinite update-offer loop. Hard-fail before any manifest is written.
const configVersionFor = (configPath) =>
  JSON.parse(readFileSync(configPath, 'utf8')).version;

const assertTagMatchesVersion = (tag, configPath) => {
  const configVersion = configVersionFor(configPath);
  const tagVersion = tag.replace(/^v/, '');
  if (tagVersion !== configVersion) {
    throw new Error(
      `tag ${tag} does not match tauri.conf.json version ${configVersion} — ` +
        'bump the version or retag before releasing',
    );
  }
  return tagVersion;
};

// Scans <artifactsDir>/<artifactDir> for each platform, pairs the updater
// bundle with its .sig, writes latest.json into <outDir>, and copies all
// release assets flat into <outDir>. Returns { manifest, assets } — `assets`
// is the list of staged file names (excluding latest.json). Throws on any
// missing bundle/signature.
export const buildUpdateManifest = ({
  tag,
  artifactsDir,
  repo,
  outDir,
  configPath = DEFAULT_CONFIG_PATH,
}) => {
  const version = assertTagMatchesVersion(tag, configPath);
  const platforms = {};
  const errors = [];

  for (const [platformKey, spec] of Object.entries(PLATFORM_ARTIFACTS)) {
    const dir = join(artifactsDir, spec.artifact);
    const files = existsSync(dir) ? walk(dir) : [];
    const bundle = files.find((file) => spec.match.test(basename(file)));
    if (!bundle) {
      errors.push(
        `${platformKey}: no updater bundle matching ${spec.match} under ${dir}`,
      );
      continue;
    }
    const sigPath = `${bundle}.sig`;
    if (!existsSync(sigPath)) {
      errors.push(`${platformKey}: missing signature file ${basename(sigPath)}`);
      continue;
    }
    const signature = readFileSync(sigPath, 'utf8').trim();
    if (!signature) {
      errors.push(`${platformKey}: signature file ${basename(sigPath)} is empty`);
      continue;
    }
    const name = basename(bundle);
    platforms[platformKey] = {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
    };
  }

  if (errors.length > 0) {
    throw new Error(
      `Refusing to publish an incomplete updater manifest:\n  - ${errors.join('\n  - ')}`,
    );
  }

  mkdirSync(outDir, { recursive: true });

  const assets = [];
  for (const spec of Object.values(PLATFORM_ARTIFACTS)) {
    const dir = join(artifactsDir, spec.artifact);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!isReleaseAsset(file)) continue;
      const name = basename(file);
      copyFileSync(file, join(outDir, name));
      assets.push(name);
    }
  }

  const manifest = {
    version,
    pub_date: new Date().toISOString(),
    platforms,
  };
  writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { manifest, assets };
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    args[arg.slice(2)] = value;
    i += 1;
  }
  return args;
};

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    for (const key of ['tag', 'artifacts', 'repo', 'out']) {
      if (!args[key]) throw new Error(`missing required --${key}`);
    }
    const { manifest, assets } = buildUpdateManifest({
      tag: args.tag,
      artifactsDir: args.artifacts,
      repo: args.repo,
      outDir: args.out,
    });
    console.log(`latest.json written for ${manifest.version}:`);
    for (const [platform, entry] of Object.entries(manifest.platforms)) {
      console.log(`  ${platform}: ${entry.url}`);
    }
    console.log(`staged ${assets.length} release asset(s) in ${args.out}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
