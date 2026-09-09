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
 * and in `Accept-Language`), deliberately kept to a bare ISO-639-1 tag so it
 * fits the schema's `character varying(10)` and the backend's supported set.
 * `intlTag` is the fuller BCP-47 tag handed to `Intl` for regionally correct
 * dates and number grouping.
 */

export type LocaleCode = 'en' | 'ms';

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
 * `ms`, `ms-MY`, `en_US`, `EN` — and matches on the primary subtag, so a
 * region we do not model still lands on the right language. Returns
 * `undefined` (not the default) when nothing matches, so callers can keep
 * walking their own preference chain.
 */
export const matchLocale = (tag: string | null | undefined): LocaleCode | undefined => {
  if (!tag) return undefined;
  const primary = tag.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
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
