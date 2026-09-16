/**
 * Registry of every translation bundle shipped with the app.
 *
 * English is statically imported and therefore lives in the main bundle: it is
 * the synchronous fallback every other locale falls back to, and `t()` is
 * callable from module scope before any `await` has run. Each additional
 * locale is a dynamic `import('./<code>')` producing exactly one chunk, so a
 * user reading the app in English never downloads Bahasa Melayu or 简体中文.
 *
 * Boot awaits `ensureLocaleLoaded(getActiveLocale())` (in parallel with the
 * app shell) before the first render, so a non-English user never sees a flash
 * of English. A later switch installs the bundle and re-notifies the locale
 * store; until it lands, lookups fall back to English rather than showing keys.
 *
 * `resources.test.ts` asserts that every JSON file on disk is registered in a
 * locale module here, so adding a namespace and forgetting to register it
 * fails a test instead of silently shipping English.
 */

import { DEFAULT_LOCALE, LOCALE_CODES, type LocaleCode } from '../locales';
import type { LocaleResources } from '../translator';
import { enResources, type Namespace } from './en';

export type { Namespace };

/** Lazily-loaded locales. English is absent on purpose — it is always present. */
const LOADERS: Record<string, () => Promise<{ default: LocaleResources }>> = {
  ms: () => import('./ms'),
  zh: () => import('./zh'),
};

/**
 * Bundles available right now. English from module load; others appear as
 * `ensureLocaleLoaded` resolves. Exported for the parity tests, which call
 * `loadAllLocales()` first — application code should read `localeResources`.
 */
export const resources: Partial<Record<LocaleCode, LocaleResources>> = {
  [DEFAULT_LOCALE]: enResources,
};

/** Concurrent callers for the same locale share one in-flight import. */
const inFlight = new Map<LocaleCode, Promise<void>>();

/**
 * The bundles to translate against, never undefined: a locale that has not
 * finished loading resolves to English, which is exactly the fallback
 * `translate.ts` would have applied to each missing key anyway.
 */
export const localeResources = (locale: LocaleCode): LocaleResources =>
  resources[locale] ?? enResources;

/** True once `locale`'s bundles are installed and lookups are exact. */
export const isLocaleLoaded = (locale: LocaleCode): boolean =>
  resources[locale] !== undefined;

/**
 * Install `locale`'s bundles, if any. Resolves immediately for English and for
 * an already-loaded locale. A failed chunk fetch is swallowed deliberately:
 * the app stays usable in English rather than failing to boot over a
 * translation download.
 */
export const ensureLocaleLoaded = async (locale: LocaleCode): Promise<void> => {
  if (isLocaleLoaded(locale)) return;
  const load = LOADERS[locale];
  if (!load) return;

  const existing = inFlight.get(locale);
  if (existing) return existing;

  const pending = load()
    .then((module) => {
      resources[locale] = module.default;
    })
    .catch((error) => {
      console.warn(`[i18n] Could not load the "${locale}" bundles; staying on English.`, error);
    })
    .finally(() => {
      inFlight.delete(locale);
    });

  inFlight.set(locale, pending);
  return pending;
};

/** Load every locale. For the parity tests, which compare all of them. */
export const loadAllLocales = async (): Promise<void> => {
  await Promise.all(LOCALE_CODES.map(ensureLocaleLoaded));
};

export const DEFAULT_NAMESPACE: Namespace = 'common';

export const NAMESPACES = Object.keys(enResources) as Namespace[];
