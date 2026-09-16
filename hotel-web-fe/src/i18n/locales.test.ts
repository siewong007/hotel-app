import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_CODES,
  getLocaleDefinition,
  isLocaleCode,
  matchLocale,
  negotiateLocale,
} from './locales';

describe('locale registry', () => {
  it('includes the default locale', () => {
    expect(LOCALE_CODES).toContain(DEFAULT_LOCALE);
  });

  it('keeps every code short enough for the schema column', () => {
    // `guests.language_preference` is character varying(10); a code that does
    // not fit would fail on write, not on read.
    for (const code of LOCALE_CODES) {
      expect(code.length).toBeLessThanOrEqual(10);
    }
  });

  it('gives every locale a usable Intl tag', () => {
    for (const code of LOCALE_CODES) {
      const { intlTag } = LOCALES[code];
      expect(() => new Intl.DateTimeFormat(intlTag)).not.toThrow();
      expect(() => new Intl.NumberFormat(intlTag)).not.toThrow();
      expect(() => new Intl.PluralRules(intlTag)).not.toThrow();
    }
  });

  it('names every locale in its own language', () => {
    for (const code of LOCALE_CODES) {
      expect(LOCALES[code].nativeName.trim()).not.toBe('');
      expect(LOCALES[code].englishName.trim()).not.toBe('');
    }
  });

  it('states a writing direction for every locale', () => {
    for (const code of LOCALE_CODES) {
      expect(['ltr', 'rtl']).toContain(LOCALES[code].dir);
    }
  });
});

describe('isLocaleCode', () => {
  it('accepts supported codes and rejects everything else', () => {
    expect(isLocaleCode('en')).toBe(true);
    expect(isLocaleCode('ms')).toBe(true);
    expect(isLocaleCode('zh')).toBe(true);
    expect(isLocaleCode('zh-TW')).toBe(true);
    expect(isLocaleCode('fr')).toBe(false);
    expect(isLocaleCode('')).toBe(false);
    expect(isLocaleCode(null)).toBe(false);
    expect(isLocaleCode(undefined)).toBe(false);
    expect(isLocaleCode(7)).toBe(false);
  });

  it('does not treat inherited Object properties as locales', () => {
    expect(isLocaleCode('toString')).toBe(false);
    expect(isLocaleCode('constructor')).toBe(false);
  });
});

describe('matchLocale', () => {
  it('matches on the primary subtag', () => {
    expect(matchLocale('ms')).toBe('ms');
    expect(matchLocale('ms-MY')).toBe('ms');
    expect(matchLocale('en-GB')).toBe('en');
  });

  it('splits Chinese tags by script: Simplified to zh, Traditional to zh-TW', () => {
    // Bare `zh` defaults to Simplified (CLDR likely-subtags), as do the
    // Hans-script and mainland/Singapore regional tags.
    expect(matchLocale('zh')).toBe('zh');
    expect(matchLocale('zh-CN')).toBe('zh');
    expect(matchLocale('zh-SG')).toBe('zh');
    expect(matchLocale('zh-Hans')).toBe('zh');
    // Traditional script and the TW/HK/MO regions map to zh-TW.
    expect(matchLocale('zh-TW')).toBe('zh-TW');
    expect(matchLocale('zh-HK')).toBe('zh-TW');
    expect(matchLocale('zh-MO')).toBe('zh-TW');
    expect(matchLocale('zh-Hant')).toBe('zh-TW');
    expect(matchLocale('zh-Hant-HK')).toBe('zh-TW');
  });

  it('lets an explicit script tag outrank region inside a zh tag', () => {
    // `zh-Hans-TW` names Simplified used in Taiwan; the script wins over the
    // region because it describes the writing the reader actually uses.
    expect(matchLocale('zh-Hans-TW')).toBe('zh');
    expect(matchLocale('zh-Hant-CN')).toBe('zh-TW');
  });

  it('normalises case and underscore separators', () => {
    expect(matchLocale('EN')).toBe('en');
    expect(matchLocale('ms_MY')).toBe('ms');
    expect(matchLocale('  En-us  ')).toBe('en');
    expect(matchLocale('zh_TW')).toBe('zh-TW');
    expect(matchLocale('ZH-hant')).toBe('zh-TW');
  });

  it('returns undefined rather than a default for an unsupported tag', () => {
    // Callers walk a preference chain; a premature default would stop it.
    expect(matchLocale('de-DE')).toBeUndefined();
    expect(matchLocale('')).toBeUndefined();
    expect(matchLocale(null)).toBeUndefined();
    expect(matchLocale(undefined)).toBeUndefined();
  });
});

describe('negotiateLocale', () => {
  it('takes the first supported candidate', () => {
    expect(negotiateLocale(['de', 'fr', 'ms-MY', 'en'])).toBe('ms');
  });

  it('falls back when nothing matches', () => {
    expect(negotiateLocale(['de', 'fr'])).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale([])).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(['de'], 'ms')).toBe('ms');
  });

  it('skips empty entries', () => {
    expect(negotiateLocale([null, undefined, '', 'ms'])).toBe('ms');
  });
});

describe('getLocaleDefinition', () => {
  it('falls back to the default for an unknown code', () => {
    expect(getLocaleDefinition('zz' as never).code).toBe(DEFAULT_LOCALE);
  });
});
