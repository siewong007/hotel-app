import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALE_CODES, LOCALES, type LocaleCode } from './locales';
import { NAMESPACES, resources } from './resources';
import type { TranslationBundle } from './translator';

/**
 * Guards on the resource bundles themselves. A missing translation is not a
 * crash — the engine falls back to English — which is exactly why it needs a
 * test: without one, a half-translated locale ships silently and looks fine to
 * an English-speaking reviewer.
 */

const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];
const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

type FlatBundle = Record<string, string>;

/** Every leaf path in a bundle, as `a.b.c`. */
const flatten = (bundle: TranslationBundle, prefix = ''): FlatBundle => {
  const out: FlatBundle = {};
  for (const [key, value] of Object.entries(bundle)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[path] = value;
    } else {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
};

/** `count.items_one` -> `count.items`; a non-plural key is returned unchanged. */
const pluralBase = (key: string): string => {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
};

const flatBundles = (locale: LocaleCode): Record<string, FlatBundle> => {
  const perNamespace: Record<string, FlatBundle> = {};
  for (const namespace of NAMESPACES) {
    perNamespace[namespace] = flatten(resources[locale][namespace]);
  }
  return perNamespace;
};

const placeholdersIn = (value: string): string[] => {
  const found: string[] = [];
  let match = PLACEHOLDER_RE.exec(value);
  while (match !== null) {
    found.push(match[1]);
    match = PLACEHOLDER_RE.exec(value);
  }
  PLACEHOLDER_RE.lastIndex = 0;
  return found;
};

const nonDefaultLocales = LOCALE_CODES.filter((code) => code !== DEFAULT_LOCALE);

describe('translation resources', () => {
  it('ships a bundle set for every registered locale', () => {
    for (const locale of LOCALE_CODES) {
      expect(resources[locale], `no resources registered for "${locale}"`).toBeDefined();
      for (const namespace of NAMESPACES) {
        expect(
          resources[locale][namespace],
          `locale "${locale}" is missing the "${namespace}" namespace`
        ).toBeDefined();
      }
    }
  });

  it('registers every JSON bundle that exists on disk', () => {
    // This crate's recurring failure mode is a file nothing reads: a bundle
    // added but never imported in resources/index.ts would silently never
    // load, and the locale would quietly serve English. `import.meta.glob`
    // sees the directory, so a forgotten import fails here instead.
    const onDisk = import.meta.glob('./resources/*/*.json');
    const found: Record<string, string[]> = {};
    for (const path of Object.keys(onDisk)) {
      const match = /^\.\/resources\/([^/]+)\/([^/]+)\.json$/.exec(path);
      if (!match) continue;
      found[match[1]] = found[match[1]] || [];
      found[match[1]].push(match[2]);
    }

    expect(Object.keys(found).sort()).toEqual([...LOCALE_CODES].sort());
    for (const locale of LOCALE_CODES) {
      expect(found[locale].sort(), `resources/${locale} has unregistered bundles`).toEqual(
        [...NAMESPACES].sort()
      );
    }
  });

  it.each(nonDefaultLocales)(
    'locale "%s" covers every key the default locale defines',
    (locale) => {
      const reference = flatBundles(DEFAULT_LOCALE);
      const candidate = flatBundles(locale);

      for (const namespace of NAMESPACES) {
        // Compared on plural *base* keys: Malay has no singular category, so
        // it legitimately never authors an `_one` variant of an English key.
        const expectedBases = Object.keys(reference[namespace]).map(pluralBase);
        const actualBases = Object.keys(candidate[namespace]).map(pluralBase);

        const missing = expectedBases.filter((key) => actualBases.indexOf(key) === -1);
        const extra = actualBases.filter((key) => expectedBases.indexOf(key) === -1);

        expect(missing, `${locale}/${namespace} is missing keys`).toEqual([]);
        expect(extra, `${locale}/${namespace} has keys English does not define`).toEqual([]);
      }
    }
  );

  it.each(LOCALE_CODES)(
    'locale "%s" provides every plural category its language can select',
    (locale) => {
      const rules = new Intl.PluralRules(LOCALES[locale].intlTag);
      // Counts chosen to exercise every category these languages can produce.
      const probes = [0, 1, 2, 3, 5, 11, 21, 100, 1000];
      const bundles = flatBundles(locale);

      for (const namespace of NAMESPACES) {
        const flat = bundles[namespace];
        const keys = Object.keys(flat);
        const pluralBases = keys.filter((key) => key !== pluralBase(key)).map(pluralBase);

        for (const base of pluralBases) {
          for (const probe of probes) {
            const category = rules.select(probe);
            const canRender =
              flat[`${base}_${category}`] !== undefined || flat[`${base}_other`] !== undefined;
            expect(
              canRender,
              `${locale}/${namespace}: "${base}" cannot render count ${probe} ` +
                `(needs "${base}_${category}" or "${base}_other")`
            ).toBe(true);
          }
          expect(
            flat[`${base}_other`] !== undefined,
            `${locale}/${namespace}: plural key "${base}" must define "_other" as its catch-all`
          ).toBe(true);
        }
      }
    }
  );

  it.each(nonDefaultLocales)(
    'locale "%s" only interpolates variables the English source provides',
    (locale) => {
      // A translator typo like `{{nama}}` for `{{name}}` renders literal braces
      // to a guest. Nothing else in the toolchain would catch it.
      const reference = flatBundles(DEFAULT_LOCALE);
      const candidate = flatBundles(locale);

      for (const namespace of NAMESPACES) {
        const referenceFlat = reference[namespace];
        const candidateFlat = candidate[namespace];
        for (const key of Object.keys(candidateFlat)) {
          const source = referenceFlat[key] ?? referenceFlat[`${pluralBase(key)}_other`];
          if (source === undefined) continue;
          const allowed = placeholdersIn(source);
          for (const used of placeholdersIn(candidateFlat[key])) {
            expect(
              allowed.indexOf(used) !== -1,
              `${locale}/${namespace}:${key} interpolates "{{${used}}}", ` +
                `which the English source does not provide`
            ).toBe(true);
          }
        }
      }
    }
  );

  it('never leaves a translated string empty', () => {
    for (const locale of LOCALE_CODES) {
      const bundles = flatBundles(locale);
      for (const namespace of NAMESPACES) {
        const flat = bundles[namespace];
        for (const key of Object.keys(flat)) {
          expect(flat[key].trim(), `${locale}/${namespace}:${key} is blank`).not.toBe('');
        }
      }
    }
  });
});
