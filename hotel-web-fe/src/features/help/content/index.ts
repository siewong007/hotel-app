/**
 * The help article catalogue, one locale at a time.
 *
 * English is statically imported; every other locale is a dynamic chunk. That
 * split matters more than the help route suggests: `CommandPalette` calls
 * `useHelpArticles` and is mounted by `RootLayout`, so this module is pulled
 * into the app shell for EVERY signed-in user, whether or not they ever open
 * Help. Bundling all locales here put ~160 KB of article prose in front of the
 * first render; only the reader's own language needs to be there.
 *
 * Reads stay synchronous. A locale whose chunk has not arrived resolves to
 * English, exactly as an unknown code always has, and `useHelpArticles`
 * subscribes to this registry so the page re-renders when the real set lands.
 *
 * zh-TW has no articles of its own and reads the Simplified Chinese set: same
 * language, different script, which a Traditional reader can follow where
 * English is no use at all. That is the ordinary BCP-47 walk (zh-TW -> zh ->
 * en) and matches how the translation bundles behave. Give it its own entry in
 * LOADERS when a Traditional set is authored.
 */

import { DEFAULT_LOCALE, type LocaleCode } from '../../../i18n/locales';
import type { HelpArticle } from '../types';
import { ARTICLES_EN } from './articles.en';

/** Locales that carry their own article set, behind one dynamic import each. */
const LOADERS: Record<string, () => Promise<HelpArticle[]>> = {
  ms: () => import('./articles.ms').then((m) => m.ARTICLES_MS),
  zh: () => import('./articles.zh').then((m) => m.ARTICLES_ZH),
};

/** Locales that read another locale's set rather than shipping their own. */
const READS_FROM: Partial<Record<LocaleCode, LocaleCode>> = {
  'zh-TW': 'zh',
};

/** Which locale's articles a reader actually gets. */
const sourceLocale = (locale: LocaleCode): LocaleCode => READS_FROM[locale] ?? locale;

const loaded: Partial<Record<string, HelpArticle[]>> = { [DEFAULT_LOCALE]: ARTICLES_EN };
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/**
 * Articles for a locale, falling back to English for an unknown code or a
 * locale whose chunk has not arrived yet.
 */
export const getArticles = (locale: LocaleCode): HelpArticle[] =>
  loaded[sourceLocale(locale)] ?? ARTICLES_EN;

/** True once `locale`'s articles are installed and reads are exact. */
export const areArticlesLoaded = (locale: LocaleCode): boolean =>
  loaded[sourceLocale(locale)] !== undefined;

/** `useSyncExternalStore` subscribe, so a late chunk triggers a re-render. */
export const subscribeToArticles = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Install `locale`'s articles, if it has any. Resolves immediately for English
 * and for an already-loaded locale. A failed chunk fetch is swallowed on
 * purpose: Help stays readable in English rather than breaking the page (and
 * the command palette) over a content download.
 */
export const ensureArticlesLoaded = async (locale: LocaleCode): Promise<void> => {
  const source = sourceLocale(locale);
  if (loaded[source] !== undefined) return;

  const load = LOADERS[source];
  if (!load) return;

  const existing = inFlight.get(source);
  if (existing) return existing;

  const pending = load()
    .then((articles) => {
      loaded[source] = articles;
      listeners.forEach((listener) => listener());
    })
    .catch((error) => {
      console.warn(`[help] Could not load the "${source}" articles; staying on English.`, error);
    })
    .finally(() => {
      inFlight.delete(source);
    });

  inFlight.set(source, pending);
  return pending;
};

/** Load every locale's articles. For the parity tests, which compare them. */
export const loadAllArticles = async (): Promise<void> => {
  await Promise.all(Object.keys(LOADERS).map((code) => ensureArticlesLoaded(code as LocaleCode)));
};
