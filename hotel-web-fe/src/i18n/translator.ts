/**
 * The pure translation engine: bundle lookup, plural selection, and
 * interpolation. No React, no module state — everything it needs arrives as
 * arguments, which is what makes it directly testable and safe to call from
 * the non-React formatting helpers in `src/utils/`.
 *
 * Placeholders use `{{name}}`, the same spelling the backend's
 * `communications::validation::render_template` uses for email templates, so a
 * string moving between the two sides keeps its variables. Unlike the backend
 * there is no HTML escaping here: React escapes interpolated text on render,
 * and escaping twice would show `&amp;` to the guest.
 */

import { getLocaleDefinition, type LocaleCode } from './locales';

export type TranslationVars = Record<string, string | number | null | undefined>;

/** A namespace bundle: nested objects of strings, as authored in the JSON files. */
export interface TranslationBundle {
  [key: string]: string | TranslationBundle;
}

/** All namespaces for one locale. */
export type LocaleResources = Record<string, TranslationBundle>;

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Plural-suffix order tried for a `count`, most specific first. */
const pluralSuffix = (locale: LocaleCode, count: number): string[] => {
  const suffixes: string[] = [];
  // `zero` is not an Intl.PluralRules category for en/ms, but authors reach
  // for it constantly ("No bookings"), so an explicit `_zero` wins when the
  // count is exactly 0 and the key exists.
  if (count === 0) suffixes.push('_zero');
  try {
    const category = new Intl.PluralRules(getLocaleDefinition(locale).intlTag).select(count);
    suffixes.push(`_${category}`);
  } catch {
    suffixes.push(count === 1 ? '_one' : '_other');
  }
  suffixes.push('_other');
  return suffixes;
};

/**
 * Walk a dotted path through a bundle. Returns `undefined` for a missing path
 * or for a path that lands on an object rather than a string, so a
 * half-written key can never render `[object Object]`.
 */
export const lookupKey = (
  bundle: TranslationBundle | undefined,
  path: string
): string | undefined => {
  if (!bundle) return undefined;
  const segments = path.split('.');
  let node: string | TranslationBundle | undefined = bundle;
  for (const segment of segments) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as TranslationBundle)[segment];
    if (node === undefined) return undefined;
  }
  return typeof node === 'string' ? node : undefined;
};

/**
 * Substitute `{{vars}}`. Numbers are rendered through `Intl.NumberFormat` so a
 * count reads `1,234` in English without every call site remembering to format
 * it. An unresolved placeholder is left verbatim rather than blanked — a
 * visible `{{name}}` is a bug report; a silent gap is not.
 */
export const interpolate = (
  template: string,
  vars: TranslationVars | undefined,
  locale: LocaleCode
): string => {
  if (!vars || template.indexOf('{{') === -1) return template;
  return template.replace(PLACEHOLDER_RE, (match, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null) return match;
    if (typeof value === 'number') {
      try {
        return new Intl.NumberFormat(getLocaleDefinition(locale).intlTag).format(value);
      } catch {
        return String(value);
      }
    }
    return value;
  });
};

export interface ResolveOptions {
  /** Locale being rendered. */
  locale: LocaleCode;
  /** Resources for `locale`. */
  resources: LocaleResources;
  /** Resources for the fallback locale, consulted when `locale` lacks the key. */
  fallbackResources?: LocaleResources;
  /** Namespace used when the key carries no `ns:` prefix. */
  defaultNamespace: string;
  /** Called once per key that resolved nowhere. */
  onMissing?: (namespace: string, key: string, locale: LocaleCode) => void;
}

/**
 * Resolve `key` to a raw (un-interpolated) string.
 *
 * Order: requested locale, then the fallback locale's bundle for the same key.
 * A key that exists in neither returns `undefined`, and `translate` renders the
 * key itself — an untranslated screen still reads as something a human can
 * trace back to a bundle entry.
 */
export const resolveRaw = (
  key: string,
  options: ResolveOptions,
  vars?: TranslationVars
): string | undefined => {
  const separator = key.indexOf(':');
  const namespace = separator === -1 ? options.defaultNamespace : key.slice(0, separator);
  const path = separator === -1 ? key : key.slice(separator + 1);

  const candidates: string[] = [];
  const count = vars?.count;
  if (typeof count === 'number' && Number.isFinite(count)) {
    for (const suffix of pluralSuffix(options.locale, count)) {
      candidates.push(`${path}${suffix}`);
    }
  }
  candidates.push(path);

  for (const candidate of candidates) {
    const hit = lookupKey(options.resources[namespace], candidate);
    if (hit !== undefined) return hit;
  }
  if (options.fallbackResources) {
    for (const candidate of candidates) {
      const hit = lookupKey(options.fallbackResources[namespace], candidate);
      if (hit !== undefined) return hit;
    }
  }
  options.onMissing?.(namespace, path, options.locale);
  return undefined;
};

/** Resolve and interpolate. Never throws, never returns a non-string. */
export const translate = (
  key: string,
  options: ResolveOptions,
  vars?: TranslationVars
): string => {
  const raw = resolveRaw(key, options, vars);
  if (raw === undefined) {
    // Render the last path segment rather than the whole `ns:a.b.c` chain:
    // it is what a reader can act on, and it keeps layouts from blowing out.
    const path = key.indexOf(':') === -1 ? key : key.slice(key.indexOf(':') + 1);
    const segments = path.split('.');
    return segments[segments.length - 1];
  }
  return interpolate(raw, vars, options.locale);
};
