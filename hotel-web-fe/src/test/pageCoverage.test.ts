/**
 * Meta-test enforcing the page coverage contract in pageManifest.ts:
 * every route has an entry, every page entry names real files, and every
 * page has both a smoke test and an axe test on disk — verified by file
 * CONTENT (a render call / an axe call), not just existence. This makes
 * "every page is covered" a CI-checked invariant instead of a one-time audit.
 */
import { describe, expect, it } from 'vitest';
import {
  authRouteDefinitions,
  publicRouteDefinitions,
  unauthRouteDefinitions,
} from '../navigation/routeRegistry';
import { NON_PAGE_ROUTE_FILES, PAGE_MANIFEST, REDIRECT_ROUTES } from './pageManifest';

// Raw source of every file under src/, keyed by path relative to this file
// (same convention as src/i18n/keyUsage.test.ts — import.meta.glob sees the
// directory, so a manifest pointing at a deleted or never-created file fails).
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const exists = (rel: string) => `../${rel}` in SOURCES;
const sourceOf = (rel: string) => SOURCES[`../${rel}`] ?? '';

const routeFiles = Object.keys(SOURCES)
  .map((key) => key.slice(3)) // '../x' → 'x'
  .filter((rel) => rel.startsWith('routes/') && rel.endsWith('.tsx'))
  .map((rel) => rel.slice('routes/'.length));

describe('page coverage manifest', () => {
  it('covers every routeRegistry route id', () => {
    const manifestIds = new Set(PAGE_MANIFEST.map((entry) => entry.id));
    const registryIds = [
      ...authRouteDefinitions,
      ...unauthRouteDefinitions,
      ...publicRouteDefinitions,
    ].map((route) => route.id);
    expect(registryIds.filter((id) => !manifestIds.has(id))).toEqual([]);
  });

  it('accounts for every file under src/routes/', () => {
    const covered = new Set([
      ...PAGE_MANIFEST.flatMap((entry) => entry.routeFiles),
      ...REDIRECT_ROUTES.map((route) => route.routeFile),
      ...NON_PAGE_ROUTE_FILES,
    ]);
    expect(routeFiles.filter((file) => !covered.has(file))).toEqual([]);
  });

  it('points at files that exist', () => {
    const missing: string[] = [];
    for (const entry of PAGE_MANIFEST) {
      for (const file of [entry.component, ...entry.smokeTests, ...entry.axeTests, ...(entry.workflowTests ?? [])]) {
        if (file && !exists(file)) missing.push(`${entry.id}: ${file}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives every page a smoke test and an axe test', () => {
    const uncovered = PAGE_MANIFEST.filter(
      (entry) => entry.kind === 'page' && (entry.smokeTests.length === 0 || entry.axeTests.length === 0),
    ).map((entry) => entry.id);
    expect(uncovered).toEqual([]);
  });

  it('lists axe files that actually run an axe scan', () => {
    // Existence alone proves nothing — the file must call an axe helper.
    const stale = PAGE_MANIFEST.flatMap((entry) =>
      entry.axeTests
        .filter(exists)
        .filter((file) => !/expectNoAxeViolations|expectNoCriticalAxeViolations|axe\.run|from 'axe-core'/.test(sourceOf(file)))
        .map((file) => `${entry.id}: ${file}`),
    );
    expect(stale).toEqual([]);
  });

  it('lists smoke files that actually render a component', () => {
    const stale = PAGE_MANIFEST.flatMap((entry) =>
      entry.smokeTests
        .filter(exists)
        .filter((file) => !/\brender(Page)?\s*\(/.test(sourceOf(file)))
        .map((file) => `${entry.id}: ${file}`),
    );
    expect(stale).toEqual([]);
  });

  it('lists workflow files that actually simulate user interaction', () => {
    const shallow = PAGE_MANIFEST.flatMap((entry) =>
      (entry.workflowTests ?? [])
        .filter(exists)
        .filter((file) => !/userEvent|fireEvent|\bclick\(|keyboard\(/.test(sourceOf(file)))
        .map((file) => `${entry.id}: ${file}`),
    );
    expect(shallow).toEqual([]);
  });

  it('has no manifest entries pointing at missing route files', () => {
    const missing = PAGE_MANIFEST.flatMap((entry) =>
      entry.routeFiles.filter((file) => !exists(`routes/${file}`)).map((file) => `${entry.id}: ${file}`),
    );
    expect(missing).toEqual([]);
  });
});
