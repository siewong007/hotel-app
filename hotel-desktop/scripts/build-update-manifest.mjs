// Assembles the Tauri updater manifest (latest.json) and stages the release
// assets from the desktop-build workflow's downloaded artifacts. Run by the
// desktop-release job on tag pushes:
//
//   bun hotel-desktop/scripts/build-update-manifest.mjs \
//     --tag v1.0.0 --artifacts ./artifacts --repo owner/name --out ./release \
//     [--notes "tag annotation" | NOTES env var]
//
// Produces <out>/latest.json plus a flat copy of every installer, updater
// bundle, .sig, and portable archive — each staged under a sanitized basename
// (see sanitizeAssetName). Hard-fails when ANY platform's updater bundle or
// signature is missing — publishing a manifest without one would leave that
// platform's installs permanently unable to update.
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

// Updater bundle per platform, matched against the file name, each with a
// sibling <name>.sig holding the minisign signature.
//
// Tauri 2's `createUpdaterArtifacts: true` signs each installer IN PLACE —
// macOS .app.tar.gz, Windows NSIS .exe, Linux .AppImage. It does NOT emit the
// repackaged .nsis.zip / .AppImage.tar.gz tarballs; those names belong to the
// `"v1Compatible"` mode, which exists only for apps migrating from a shipped
// Tauri 1 updater. This app has never shipped one, so v2 names are correct.
// Matching the v1 names made the first real tag build (v0.3.0, 2026-09-19)
// fail at the manifest step with all three platform builds green.
//
// Windows deliberately matches the NSIS installer rather than the .msi: both
// are built and both get signed, so the pattern has to choose.
const PLATFORM_ARTIFACTS = {
  'darwin-aarch64': { match: /\.app\.tar\.gz$/, artifact: 'hotel-desktop-macos-aarch64' },
  'windows-x86_64': { match: /-setup\.exe$/, artifact: 'hotel-desktop-windows-x86_64' },
  'linux-x86_64': { match: /\.AppImage$/, artifact: 'hotel-desktop-linux-x86_64' },
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

// Release assets are the packaged artifacts sitting directly in a bundle
// directory: `bundle/<file>` (portable archives) or `bundle/<format>/<file>`
// (.dmg, .app.tar.gz, -setup.exe, .msi, .deb, .rpm, .AppImage, and their
// .sig siblings). Files outside `bundle/` are raw build outputs uploaded for
// debugging — the `hotel-desktop` binary and the `hotel-app-be-*` sidecar.
//
// Anything DEEPER than that is an unpacked staging tree the bundlers leave
// beside the real artifact: the macOS `.app`, the AppImage `.AppDir`, and the
// dpkg root under `bundle/deb/<pkg>/data/usr/...`. Those must never be staged
// — flattening them to basenames collides (two `libpq.so.5` from the bundled
// PostgreSQL, which failed the v0.3.0 release on 2026-09-19) and would ship
// hundreds of megabytes of loose libraries as release assets.
//
// The dmg bundler also drops its own INPUTS beside the .dmg (bundle_dmg.sh,
// icon.icns). Those sit at artifact depth but are not downloads, so they would
// otherwise show up on the public release page. This is a deny-list rather
// than an extension allow-list on purpose: an unrecognised new package type
// should still ship, and the updater-critical artifacts are already guarded by
// the manifest's hard-fail.
const BUNDLER_SUPPORT_FILE = /\.(sh|icns|plist|desktop)$/;

const isReleaseAsset = (path) => {
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => part.endsWith('.app') || part.endsWith('.AppDir'))) {
    return false;
  }
  if (BUNDLER_SUPPORT_FILE.test(basename(path))) return false;
  const bundleIndex = parts.indexOf('bundle');
  if (bundleIndex === -1) return false;
  return parts.length - bundleIndex <= 3;
};

// GitHub's release-asset pipeline renames uploaded files server-side (spaces
// become dots), so a manifest URL built from the on-disk basename can 404 —
// exactly what would happen to "Hotel Management System_…". Instead of
// depending on GitHub's exact rule, every staged file is renamed to a basename
// drawn only from [A-Za-z0-9._-]: the uploaded asset name and the manifest URL
// are then equal by construction.
const sanitizeAssetName = (name) => name.replace(/[^A-Za-z0-9._-]+/g, '-');

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
// release assets flat into <outDir> under sanitized names. Returns
// { manifest, assets } — `assets` is the list of staged file names (excluding
// latest.json). Throws on any missing bundle/signature.
export const buildUpdateManifest = ({
  tag,
  artifactsDir,
  repo,
  outDir,
  configPath = DEFAULT_CONFIG_PATH,
  notes = '',
}) => {
  const version = assertTagMatchesVersion(tag, configPath);
  const platforms = {};
  const errors = [];

  for (const [platformKey, spec] of Object.entries(PLATFORM_ARTIFACTS)) {
    const dir = join(artifactsDir, spec.artifact);
    const files = existsSync(dir) ? walk(dir) : [];
    const candidates = files.filter((file) => spec.match.test(basename(file)));
    if (candidates.length === 0) {
      errors.push(
        `${platformKey}: no updater bundle matching ${spec.match} under ${dir}`,
      );
      continue;
    }
    // The updater artifact is the candidate carrying a sibling .sig. Linux is
    // why this is a filter rather than a plain first match: linuxdeploy ships
    // its own *.AppImage tools, and an unsigned one sitting in the bundle
    // directory would otherwise win and fail as a missing signature.
    const bundle = candidates.find((file) => existsSync(`${file}.sig`));
    if (!bundle) {
      errors.push(
        `${platformKey}: missing signature file ${basename(candidates[0])}.sig`,
      );
      continue;
    }
    const sigPath = `${bundle}.sig`;
    const signature = readFileSync(sigPath, 'utf8').trim();
    if (!signature) {
      errors.push(`${platformKey}: signature file ${basename(sigPath)} is empty`);
      continue;
    }
    // The URL must name the file as it will be uploaded — the sanitized
    // basename staged below, not the on-disk one (which GitHub would rewrite).
    const name = sanitizeAssetName(basename(bundle));
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
  const stagedNames = new Set();
  for (const spec of Object.values(PLATFORM_ARTIFACTS)) {
    const dir = join(artifactsDir, spec.artifact);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!isReleaseAsset(file)) continue;
      const name = sanitizeAssetName(basename(file));
      // Two distinct artifacts collapsing to one safe name would silently
      // clobber each other on upload — refuse rather than ship a wrong asset.
      if (stagedNames.has(name)) {
        throw new Error(
          `asset name collision after sanitize: ${name} (from ${file})`,
        );
      }
      stagedNames.add(name);
      copyFileSync(file, join(outDir, name));
      assets.push(name);
    }
  }

  const manifest = {
    version,
    notes: (notes || '').trim() || null,
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
      // Env fallback so an annotation that begins with "--" can't trip
      // parseArgs' "requires a value" check on the CLI path.
      notes: args.notes ?? process.env.NOTES ?? '',
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
