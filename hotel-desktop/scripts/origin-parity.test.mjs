// Parity check for the hand-maintained copies of the same logical lists:
// hotel-web-fe runtimeApi.ts ROOT_API_PREFIXES, vite.config.ts PROXY_PREFIXES,
// src-tauri commands.rs ALLOWED_ORIGINS env, and capabilities/default.json
// remote.urls. They drift independently — this test turns the KEEP IN SYNC
// comments into a check. Run: bun run test:scripts (or `bun test scripts/`).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

// Extracts the items of a flat single-quoted array literal, e.g.
// `const NAME = ['a', 'b'];`. Throws when the literal is absent so a moved or
// renamed constant fails loudly instead of passing on an empty list.
const listLiteral = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]+)\\]`));
  if (!match) throw new Error(`${name} array literal not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

const allowedOrigins = () => {
  const commands = read('hotel-desktop/src-tauri/src/commands.rs');
  const match = commands.match(/"ALLOWED_ORIGINS",\s*\n?\s*"([^"]+)"/);
  if (!match) throw new Error('ALLOWED_ORIGINS env literal not found in commands.rs');
  return match[1].split(',').map((s) => s.trim());
};

const capabilityRemoteOrigins = () => {
  const caps = JSON.parse(read('hotel-desktop/src-tauri/capabilities/default.json'));
  if (!caps.remote?.urls) throw new Error('remote.urls not found in capabilities/default.json');
  return caps.remote.urls.map((u) => u.replace(/\/\*$/, ''));
};

// Dev-server origins are http(s) loopback URLs. The tauri webview origins are
// http-shaped on some platforms but are app-internal, not remote urls the
// capability grants access to — exclude them from the symmetric comparison.
const isDevHttpOrigin = (origin) => /^https?:\/\//.test(origin) && !origin.includes('tauri');

describe('origin/proxy parity', () => {
  test('runtimeApi ROOT_API_PREFIXES == vite PROXY_PREFIXES (sans leading /)', () => {
    const root = listLiteral(read('hotel-web-fe/src/desktop/runtimeApi.ts'), 'ROOT_API_PREFIXES');
    const proxy = listLiteral(read('hotel-web-fe/vite.config.ts'), 'PROXY_PREFIXES').map((p) =>
      p.replace(/^\//, ''),
    );
    expect([...root].sort()).toEqual([...proxy].sort());
  });

  test('commands.rs ALLOWED_ORIGINS includes both tauri webview origins', () => {
    const origins = allowedOrigins();
    // The bundled app is unreachable without these — the webview origin differs
    // per platform (tauri://localhost on macOS/Linux, http://tauri.localhost on
    // Windows), so both must be in the sidecar CORS allow-list.
    expect(origins).toContain('tauri://localhost');
    expect(origins).toContain('http://tauri.localhost');
  });

  test('dev http origins in ALLOWED_ORIGINS == capability remote.urls (sans /*)', () => {
    const origins = allowedOrigins().filter(isDevHttpOrigin).sort();
    const remote = capabilityRemoteOrigins().filter(isDevHttpOrigin).sort();
    // Symmetric: a dev origin allowed by CORS but absent from remote.urls (or
    // vice versa) means the webview either cannot reach the backend or is
    // granted a capability for an origin that never occurs.
    expect(origins).toEqual(remote);
  });
});
