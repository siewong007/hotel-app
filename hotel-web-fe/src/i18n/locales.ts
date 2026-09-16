/**
 * Supported interface languages.
 *
 * This registry is the single source of truth for "what languages does the
 * platform speak" — the switcher, the `<html lang>`/`dir` attributes, every
 * `Intl.*` formatter, the `Accept-Language` header sent to the API, and the
 * resource-bundle parity test all read it. Adding a language is a three-step
 * change: add an entry here, add the matching `resources/<code>/*.json`
 * bundles, and register them in `resources/index.ts`. Nothing else needs to
 * know.
 *
 * `code` is the storage/wire value (what lands in `guests.language_preference`
 * and in `Accept-Language`), kept short enough for the schema's
 * `character varying(10)` and matched by the backend's supported set. `zh-TW`
 * carries a region because `zh` alone already means Simplified here — the
 * script distinction cannot ride on the primary subtag.
 * `intlTag` is the fuller BCP-47 tag handed to `Intl` for regionally correct
 * dates and number grouping.
 */

export type LocaleCode = 'en' | 'ms' | 'zh' | 'zh-TW';

export interface LocaleDefinition {
  /** Wire/storage value. Must match the backend's `SUPPORTED_LOCALES`. */
  code: LocaleCode;
  /** BCP-47 tag passed to `Intl.*` constructors. */
  intlTag: string;
  /** Language name written in that language — never translated. */
  nativeName: string;
  /** English name, for staff-facing admin surfaces. */
  englishName: string;
  /** Writing direction, mirrored onto `<html dir>`. */
  dir: 'ltr' | 'rtl';
}

export const DEFAULT_LOCALE: LocaleCode = 'en';

export const LOCALES: Record<LocaleCode, LocaleDefinition> = {
  en: {
    code: 'en',
    // `en-US`, not `en-MY`: the app's established English date rendering is
    // "Jul 26, 2026" (see utils/date.test.ts). Switching the region here
    // silently reformats every date in the product, so it is a deliberate
    // product decision rather than a side effect of adding languages.
    intlTag: 'en-US',
    nativeName: 'English',
    englishName: 'English',
    dir: 'ltr',
  },
  ms: {
    code: 'ms',
    intlTag: 'ms-MY',
    nativeName: 'Bahasa Melayu',
    englishName: 'Malay',
    dir: 'ltr',
  },
  zh: {
    code: 'zh',
    intlTag: 'zh-CN',
    nativeName: '简体中文',
    englishName: 'Chinese (Simplified)',
    dir: 'ltr',
  },
  'zh-TW': {
    code: 'zh-TW',
    intlTag: 'zh-TW',
    nativeName: '繁體中文',
    englishName: 'Chinese (Traditional)',
    dir: 'ltr',
  },
};

export const LOCALE_CODES = Object.keys(LOCALES) as LocaleCode[];

export const isLocaleCode = (value: unknown): value is LocaleCode =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOCALES, value);

export const getLocaleDefinition = (code: LocaleCode): LocaleDefinition =>
  LOCALES[code] ?? LOCALES[DEFAULT_LOCALE];

/**
 * Resolve an arbitrary language tag to a supported locale.
 *
 * Accepts anything a browser or an `Accept-Language` header may carry —
 * `ms`, `ms-MY`, `en_US`, `EN` — and returns `undefined` (not the default)
 * when nothing matches, so callers can keep walking their own preference
 * chain.
 *
 * Matching order: the full tag against the supported codes first (so the
 * stored `zh-TW` round-trips), then — for `zh` only — the script and region
 * subtags decide between Simplified and Traditional, and finally the primary
 * subtag, so a region we do not model still lands on the right language.
 * Inside a `zh` tag an explicit script wins over region: `zh-Hans-TW` is
 * Simplified used in Taiwan, `zh-Hant-CN` is Traditional used on the
 * mainland.
 */
export const matchLocale = (tag: string | null | undefined): LocaleCode | undefined => {
  if (!tag) return undefined;
  const normalized = tag.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return undefined;

  const exact = LOCALE_CODES.find((code) => code.toLowerCase() === normalized);
  if (exact) return exact;

  const parts = normalized.split('-');
  const primary = parts[0];
  if (primary === 'zh') {
    const subtags = parts.slice(1);
    if (subtags.includes('hant')) return 'zh-TW';
    if (subtags.includes('hans')) return 'zh';
    return subtags.some((sub) => sub === 'tw' || sub === 'hk' || sub === 'mo')
      ? 'zh-TW'
      : 'zh';
  }
  return isLocaleCode(primary) ? primary : undefined;
};

/**
 * Pick the best supported locale from an ordered list of candidate tags —
 * `navigator.languages`, or a parsed `Accept-Language`. First match wins.
 */
export const negotiateLocale = (
  candidates: readonly (string | null | undefined)[],
  fallback: LocaleCode = DEFAULT_LOCALE
): LocaleCode => {
  for (const candidate of candidates) {
    const matched = matchLocale(candidate);
    if (matched) return matched;
  }
  return fallback;
};
