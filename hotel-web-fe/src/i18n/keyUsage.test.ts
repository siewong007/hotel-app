/**
 * Static gate: every literal key passed to the translation entry points must
 * exist in the English bundles.
 *
 * The engine's contract for a missing key is to render the key's last segment
 * — so a typo like `t('book.errros.email')` does not crash, it just ships
 * "email" to a guest in every locale. The dev console warning only fires on a
 * render someone actually performs, which makes a static check the only thing
 * that sees every call site. This test walks `src/`, extracts the literal
 * first argument of `t`/`tOr`/`translate`/`translateFor`/`translateOr` calls
 * (plus literal `statusLabel(t, 'domain', 'value')` calls, which build
 * `status:domain.value`), and asserts each resolves against `en` — the same
 * bundle the engine falls back to, so it must be complete.
 *
 * Static parsing is deliberately approximate rather than a real AST walk:
 *
 *   - Per file, `const { t } = useTranslation('<ns>')` destructures give the
 *     namespace each local name is bound to (`useTranslation()` → `common`,
 *     `{ t: tNav }` aliases are honoured, first binding wins on conflict).
 *   - `t`/`translate*` imported from an `i18n` module use their explicit
 *     trailing namespace argument when literal, else `common`.
 *   - A `t` that is neither destructured nor imported (a function parameter,
 *     e.g. `turnstileErrorMessage(error, t)`) cannot be attributed to one
 *     namespace statically — its keys are accepted when they exist in ANY
 *     namespace. That still catches typos, which is the gate's job.
 *   - `ns:key` inside the literal always overrides the bound namespace.
 *   - Template literals containing `${` and any non-literal argument are
 *     skipped — dynamic keys (statusLabel values, `errors:api.${code}`) are
 *     checked by their callers' fallbacks, not here.
 *   - Plural calls like `t('count.nights', { count })` resolve
 *     `count.nights_other`/`_one`/`_zero`; a base path that only exists as
 *     plural variants counts as present.
 */

import { describe, expect, it } from 'vitest';
import { NAMESPACES, resources } from './resources';
import { lookupKey } from './translator';

/**
 * Every source file under `src/` (this test lives in `src/i18n`, so `../` is
 * `src/`), raw text, minus tests, declaration files, and the i18n resource
 * bundles / locale definitions themselves — none of which contain call sites.
 */
const SOURCES = import.meta.glob(
  [
    '../**/*.{ts,tsx}',
    '!../**/*.test.{ts,tsx}',
    '!../**/*.spec.{ts,tsx}',
    '!../**/*.d.ts',
    '!./resources/**',
    '!./locales.ts',
    '!./locales/**',
  ],
  { eager: true, query: '?raw', import: 'default' }
) as Record<string, string>;

const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

/** Call names whose key argument position is fixed. */
const KEY_ARG_INDEX: Record<string, number> = {
  t: 0,
  tOr: 0,
  // `translate(locale, 'ns:key')` / `translateOr(locale, key, fallback)` /
  // `translateFor(locale, key)` — the non-React signatures take the key second.
  translate: 1,
  translateFor: 1,
  translateOr: 1,
};

/** Position of the optional namespace argument for module-level imports. */
const NS_ARG_INDEX: Record<string, number> = {
  t: 2,
  translate: 3,
  translateFor: 3,
  translateOr: 4,
};

/** Glob key `../features/x.tsx` → display path `features/x.tsx`. */
const RELATIVE_PATH = (globKey: string): string => globKey.replace(/^\.\.\//, '');

/**
 * Resolve a relative import specifier against a glob key, staying in
 * glob-key space: `../features/auth/x.ts` + `../../../i18n` → `../i18n`.
 */
const resolveSpecifier = (globKey: string, specifier: string): string => {
  const dir = globKey.slice(0, globKey.lastIndexOf('/'));
  const segments = dir.split('/');
  for (const seg of specifier.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop();
      } else {
        segments.push('..');
      }
    } else {
      segments.push(seg);
    }
  }
  return segments.join('/');
};

/** The specifier resolves to a module inside `src/i18n` (glob key `../i18n`). */
const isI18nModule = (resolved: string): boolean =>
  resolved === '../i18n' || resolved.startsWith('../i18n/');

/**
 * Remove `//` and block comments while keeping string contents and newlines
 * (so reported line numbers stay accurate). String and template state is
 * tracked so `//` inside a literal does not truncate the line; `${` inside a
 * template drops back into code state so nested strings still parse.
 */
const stripComments = (src: string): string => {
  const out: string[] = [];
  const stack: { state: 'tpl'; braces: number }[] = [];
  let braces = 0;
  let state: 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'code';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    switch (state) {
      case 'code':
        if (c === '/' && next === '/') {
          state = 'line';
          i += 2;
        } else if (c === '/' && next === '*') {
          state = 'block';
          i += 2;
        } else if (c === "'") {
          state = 'sq';
          out.push(c);
          i += 1;
        } else if (c === '"') {
          state = 'dq';
          out.push(c);
          i += 1;
        } else if (c === '`') {
          state = 'tpl';
          out.push(c);
          i += 1;
        } else {
          if (c === '{') braces += 1;
          if (c === '}') {
            if (braces === 0 && stack.length > 0) {
              const prev = stack.pop()!;
              state = prev.state;
              braces = prev.braces;
            } else if (braces > 0) {
              braces -= 1;
            }
          }
          out.push(c);
          i += 1;
        }
        break;
      case 'sq':
      case 'dq': {
        const quote = state === 'sq' ? "'" : '"';
        out.push(c);
        if (c === '\\' && i + 1 < src.length) {
          out.push(src[i + 1]);
          i += 2;
        } else {
          if (c === quote) state = 'code';
          i += 1;
        }
        break;
      }
      case 'tpl':
        out.push(c);
        if (c === '\\' && i + 1 < src.length) {
          out.push(src[i + 1]);
          i += 2;
        } else if (c === '`') {
          state = 'code';
          i += 1;
        } else if (c === '$' && next === '{') {
          out.push('{');
          stack.push({ state: 'tpl', braces });
          braces = 0;
          state = 'code';
          i += 2;
        } else {
          i += 1;
        }
        break;
      case 'line':
        if (c === '\n') {
          out.push(c);
          state = 'code';
        }
        i += 1;
        break;
      case 'block':
        if (c === '*' && next === '/') {
          state = 'code';
          i += 2;
        } else {
          if (c === '\n') out.push(c);
          i += 1;
        }
        break;
    }
  }
  return out.join('');
};

/**
 * Read the argument list starting at `openParen` (index of `(`), split on
 * top-level commas. Returns `undefined` when the parens never balance — a
 * call we cannot parse is skipped rather than misread.
 */
const readArgs = (src: string, openParen: number): string[] | undefined => {
  const args: string[] = [];
  let cur = '';
  let depth = 0;
  let quote: "'" | '"' | '`' | undefined;
  let i = openParen + 1;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      cur += c;
      if (c === '\\' && i + 1 < src.length) {
        cur += src[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) quote = undefined;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      cur += c;
    } else if (c === '(' || c === '[' || c === '{') {
      depth += 1;
      cur += c;
    } else if (c === ')') {
      if (depth === 0) {
        args.push(cur);
        return args;
      }
      depth -= 1;
      cur += c;
    } else if (c === ']' || c === '}') {
      if (depth === 0) {
        args.push(cur);
        return args;
      }
      depth -= 1;
      cur += c;
    } else if (c === ',' && depth === 0) {
      args.push(cur);
      cur = '';
    } else {
      cur += c;
    }
    i += 1;
  }
  return undefined;
};

/** The value of an argument that is exactly one string literal, else undefined. */
const literalOf = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined;
  const t = text.trim();
  const quoted =
    /^'((?:[^'\\]|\\.)*)'$/s.exec(t) ?? /^"((?:[^"\\]|\\.)*)"$/s.exec(t);
  if (quoted) {
    return quoted[1].replace(/\\([\\'"])/g, '$1');
  }
  const tpl = /^`((?:[^`\\]|\\.)*)`$/s.exec(t);
  if (tpl) {
    // A template with `${` is a dynamic key — not statically checkable.
    if (tpl[1].includes('${')) return undefined;
    return tpl[1];
  }
  return undefined;
};

interface Binding {
  /** Bound namespace; `null` when the argument was not a literal. */
  namespace: string | null;
}

/** `const { t: tNav, tOr } = useTranslation('nav')` → local name → namespace. */
const findBindings = (src: string): Map<string, Binding> => {
  const bindings = new Map<string, Binding>();
  // `[^{}]` not `[^}]`: an earlier brace (`=> {\n  const { t } = …`) must not
  // swallow the destructure — the member list itself never contains braces.
  const re = /\{([^{}]*)\}\s*=\s*useTranslation\s*\(([^)]*)\)/g;
  let match = re.exec(src);
  while (match !== null) {
    const arg = match[2].trim();
    const namespace: string | null =
      arg === '' ? 'common' : (literalOf(arg) ?? null);
    for (const part of match[1].split(',')) {
      const m = /^\s*(\w+)\s*(?::\s*(\w+))?/.exec(part);
      if (!m) continue;
      if (m[1] !== 't' && m[1] !== 'tOr') continue;
      const local = m[2] ?? m[1];
      if (!bindings.has(local)) bindings.set(local, { namespace });
    }
    match = re.exec(src);
  }
  return bindings;
};

/**
 * Names imported from a module inside `src/i18n/` — `from '../i18n'` resolves
 * to the barrel, `from './translate'` inside the i18n directory itself resolves
 * to `src/i18n/translate.ts`. Returns local name → exported name.
 */
const findI18nImports = (src: string, globKey: string): Map<string, string> => {
  const wanted = new Set(Object.keys(KEY_ARG_INDEX).concat('statusLabel'));
  const imports = new Map<string, string>();
  const re = /import\s+(?:type\s+)?\{([^{}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match = re.exec(src);
  while (match !== null) {
    const [, members, specifier] = match;
    if (specifier.startsWith('.') && isI18nModule(resolveSpecifier(globKey, specifier))) {
      for (const part of members.split(',')) {
        const m = /^\s*(?:type\s+)?(\w+)\s*(?:as\s+(\w+))?/.exec(part);
        if (m && wanted.has(m[1])) imports.set(m[2] ?? m[1], m[1]);
      }
    }
    match = re.exec(src);
  }
  return imports;
};

interface ExtractedCall {
  name: string;
  args: string[];
  index: number;
}

/** Every `name(...)` call for the candidate names, with parsed arguments. */
const findCalls = (src: string, names: Set<string>): ExtractedCall[] => {
  if (names.size === 0) return [];
  const re = new RegExp(`(?<![\\w$.])(${[...names].join('|')})\\s*\\(`, 'g');
  const calls: ExtractedCall[] = [];
  let match = re.exec(src);
  while (match !== null) {
    const openParen = match.index + match[0].length - 1;
    const args = readArgs(src, openParen);
    if (args !== undefined) {
      calls.push({ name: match[1], args, index: match.index });
    }
    match = re.exec(src);
  }
  return calls;
};

const existsIn = (namespace: string, path: string): boolean => {
  const bundle = resources.en[namespace];
  if (!bundle) return false;
  if (lookupKey(bundle, path) !== undefined) return true;
  // `t('count.nights', { count })` resolves `count.nights_other` etc. — the
  // bare path need not exist when plural variants do.
  return PLURAL_SUFFIXES.some(
    (suffix) => lookupKey(bundle, `${path}${suffix}`) !== undefined
  );
};

interface Missing {
  file: string;
  line: number;
  key: string;
}

const lineOf = (src: string, index: number): number =>
  src.slice(0, index).split('\n').length;

describe('translation key usage', () => {
  it('every literal key passed to a translation call exists in en resources', () => {
    const missing: Missing[] = [];
    let validated = 0;

    for (const [globKey, raw] of Object.entries(SOURCES)) {
      const src = stripComments(raw);
      const bindings = findBindings(src);
      const imports = findI18nImports(src, globKey);

      const names = new Set<string>([
        ...Object.keys(KEY_ARG_INDEX),
        'statusLabel',
        ...bindings.keys(),
        ...imports.keys(),
      ]);

      for (const call of findCalls(src, names)) {
        let namespace: string | null;
        let key: string | undefined;

        if (call.name === 'statusLabel') {
          // statusLabel(t, 'domain', 'value') → status:domain.value; a
          // non-literal value is a dynamic status the helper humanizes.
          const domain = literalOf(call.args[1]);
          const value = literalOf(call.args[2]);
          if (domain === undefined || value === undefined) continue;
          key = `${domain}.${value}`;
          namespace = 'status';
        } else {
          // The exported name when imported under an alias (`t as tt`), the
          // local name otherwise. Bound destructure aliases (`t: tNav`) map to
          // `t`/`tOr` — absent from the index maps, their key is argument 0.
          const exported = imports.get(call.name) ?? call.name;
          key = literalOf(call.args[KEY_ARG_INDEX[exported] ?? 0]);
          // Engine-style `translate('key', options)` — first arg is the key.
          if (key === undefined && exported === 'translate') {
            key = literalOf(call.args[0]);
          }
          if (key === undefined || key.includes('${')) continue;

          const bound = bindings.get(call.name);
          const imported = imports.get(call.name);
          if (bound) {
            namespace = bound.namespace;
          } else if (imported) {
            const nsArg = call.args[NS_ARG_INDEX[imported] ?? 99];
            if (nsArg === undefined || nsArg.trim() === '') {
              namespace = 'common';
            } else {
              namespace = literalOf(nsArg) ?? null;
            }
          } else {
            // Unbound local (usually a function parameter): not attributable
            // to one namespace — checked against all of them below.
            namespace = null;
          }
        }

        if (key.includes('${')) continue;
        const colon = key.indexOf(':');
        if (colon !== -1) {
          namespace = key.slice(0, colon);
          key = key.slice(colon + 1);
        }

        validated += 1;
        const found =
          namespace === null
            ? NAMESPACES.some((ns) => existsIn(ns, key))
            : existsIn(namespace, key);
        if (!found) {
          missing.push({
            file: RELATIVE_PATH(globKey),
            line: lineOf(src, call.index),
            key: namespace === null ? key : `${namespace}:${key}`,
          });
        }
      }
    }

    expect(
      missing,
      `literal translation keys missing from en resources:\n${missing
        .map((m) => `  ${m.file}:${m.line} → ${m.key}`)
        .join('\n')}`
    ).toEqual([]);
    expect(
      validated,
      'no translation call sites found — gate is dead'
    ).toBeGreaterThan(0);
  });
});
