// Locale resolution for the landing page — self-contained on purpose. The
// React app's `src/i18n` is not imported: salim-inn stays outside the app's
// Babel/Vite pipeline (see vite.config.ts), and the choice made here is
// carried forward only through the shared `locale` localStorage key.
export type LangCode = 'en' | 'ms' | 'zh' | 'zh-TW';

export const LANG_CODES: LangCode[] = ['en', 'ms', 'zh', 'zh-TW'];

/** Option labels are native names — a picker reads correctly in any language. */
export const LANG_LABELS: Record<LangCode, string> = {
  en: 'English',
  ms: 'Bahasa Melayu',
  zh: '简体中文',
  'zh-TW': '繁體中文',
};

/** `<html lang>` values — the BCP 47 tag, not the short code. */
export const HTML_LANG: Record<LangCode, string> = {
  en: 'en',
  ms: 'ms',
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
};

/** The localStorage key shared with the hotel app (`src/i18n/localeStore.ts`). */
export const STORAGE_KEY = 'locale';

/**
 * Maps a language tag to a page locale. Chinese matches by script and region,
 * the same rule the app applies to `navigator.languages`: zh-TW/zh-HK/zh-MO
 * and any zh-Hant… tag are Traditional; zh-CN/zh-SG/zh-MY, zh-Hans… and bare
 * zh are Simplified.
 */
export const matchLang = (tag: string | null | undefined): LangCode | null => {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (t.startsWith('zh')) return /hant|tw|hk|mo/.test(t) ? 'zh-TW' : 'zh';
  if (t.startsWith('ms')) return 'ms';
  if (t.startsWith('en')) return 'en';
  return null;
};

/**
 * Highest priority first, mirroring the app: an explicit `?lang=` choice, then
 * the stored choice the app and this page share, then the browser's language
 * list, then English.
 */
export const resolveLang = (opts: {
  query?: string | null;
  stored?: string | null;
  languages?: readonly string[];
}): LangCode => {
  for (const candidate of [opts.query, opts.stored]) {
    const lang = matchLang(candidate);
    if (lang) return lang;
  }
  for (const tag of opts.languages ?? []) {
    const lang = matchLang(tag);
    if (lang) return lang;
  }
  return 'en';
};

const storedLang = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing may deny storage; resolution falls through to the
    // browser's language list.
    return null;
  }
};

/** Resolves the active locale from the live environment. */
export const activeLang = (): LangCode =>
  resolveLang({
    query: new URLSearchParams(location.search).get('lang'),
    stored: storedLang(),
    languages: navigator.languages ?? [navigator.language],
  });

/**
 * Persists the choice under the shared key and reloads with `?lang=` so the
 * new copy is deterministic and crawlable. The `?lang=` param survives the
 * reload even if storage later fails.
 */
export const selectLang = (lang: LangCode): void => {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // See storedLang — storage may be denied; the URL param still carries it.
  }
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  location.assign(url);
};
