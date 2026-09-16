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
 *     `{ t: tNav }` aliases are honoured). If one local name is bound to TWO
 *     different namespaces in a file, it is marked ambiguous and falls back to
 *     the any-namespace check rather than guessing.
 *   - `t`/`tOr`/`translate*`/`statusLabel` imported from an `i18n` module use
 *     their explicit trailing namespace argument when literal, else `common`.
 *     Import aliases are resolved to the exported name first, so
 *     `import { statusLabel as sl }` still takes the statusLabel path.
 *   - A bound `t` stashed in a ref is followed too: `useRef(t)` or
 *     `ref.current = t` mark `ref` as holding a bound translator, and
 *     `ref.current('key')` is checked like `t('key')` (the real pattern is
 *     `useGoogleOneTap`'s `translateRef`). Unrelated `xRef.current('/path')`
 *     calls are untouched — only refs whose RHS was a bound name qualify.
 *   - A `t` that is neither destructured, imported, nor ref-held (a function
 *     parameter, e.g. `turnstileErrorMessage(error, t)`) cannot be attributed
 *     to one namespace statically — its keys are accepted when they exist in
 *     ANY namespace. That still catches typos, which is the gate's job.
 *   - `ns:key` inside the literal always overrides the bound namespace.
 *   - Plural calls like `t('count.nights', { count })` resolve
 *     `count.nights_other`/`_one`/`_zero`; a base path that only exists as
 *     plural variants counts as present.
 *
 * Known blind spots — deliberately unchecked, none produce false failures:
 *
 *   - Dynamic keys: template literals containing `${` (`nav.${link.section}`,
 *     `errors:api.${code}`), non-literal arguments (`t(CONSTANT)`,
 *     `t(KEYS[route.id])`, `t(prefix + 'x')`), and `statusLabel` calls whose
 *     status value is not a literal (the helper humanizes unmapped values).
 *   - A clean single ternary `t(cond ? 'a' : 'b')` IS checked — both literal
 *     branches are validated. Nested ternaries or non-literal branches skip
 *     the whole call.
 *   - Member calls other than the ref pattern: `i18n.t('k')`, `tr.t('k')` on a
 *     non-destructured `useTranslation` handle, `obj.tOr('k')`.
 *   - Calls inside regex literals can confuse the crude comment stripper
 *     (`/a\/\/b/` reads as a comment start): worst case the rest of that line
 *     is dropped, losing a check — never a false failure.
 *   - Keys that live in constants (`const KEYS = { x: 'mobile.guests' }`) are
 *     validated only when a literal reaches a call site — the map itself is
 *     not scanned.
 */

import { describe, expect, it } from 'vitest';
import { NAMESPACES } from './resources';
// English only, and always statically present — the lazily-loaded locales
// are irrelevant here: this file checks that call sites reference keys the
// SOURCE locale defines.
import { enResources } from './resources/en';
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

/**
 * `cond ? 'a' : 'b'` → `['a', 'b']` when the argument is exactly one clean
 * ternary at top level (one `?`, one `:`, neither nested nor part of `?.`/`??`).
 * Anything else — nested ternaries, `cond?.x`, mixed branches — returns
 * `undefined` and the call is skipped.
 */
const ternaryBranches = (arg: string): [string, string] | undefined => {
  let depth = 0;
  let qPos = -1;
  let cPos = -1;
  let qCount = 0;
  let cCount = 0;
  let quote: "'" | '"' | '`' | undefined;
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
    } else if (c === '(' || c === '[' || c === '{') {
      depth += 1;
    } else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
    } else if (depth === 0 && c === '?' && arg[i + 1] !== '.' && arg[i + 1] !== '?' && arg[i - 1] !== '?') {
      qPos = i;
      qCount += 1;
    } else if (depth === 0 && c === ':') {
      cPos = i;
      cCount += 1;
    }
  }
  if (qCount !== 1 || cCount !== 1 || cPos < qPos) return undefined;
  return [arg.slice(qPos + 1, cPos), arg.slice(cPos + 1)];
};

/**
 * Every literal key an argument can carry: a single literal, or both branches
 * of a clean `cond ? 'a' : 'b'` ternary. `[]` means nothing statically
 * checkable — the call is skipped.
 */
const literalKeysOf = (text: string | undefined): string[] => {
  const single = literalOf(text);
  if (single !== undefined) return [single];
  if (text === undefined) return [];
  const branches = ternaryBranches(text.trim());
  if (!branches) return [];
  const keys: string[] = [];
  for (const branch of branches) {
    const lit = literalOf(branch);
    if (lit === undefined) return [];
    keys.push(lit);
  }
  return keys;
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
      const prev = bindings.get(local);
      if (!prev) {
        bindings.set(local, { namespace });
      } else if (prev.namespace !== namespace) {
        // Same local name rebound to a different namespace elsewhere in the
        // file — ambiguous; fall back to the any-namespace check.
        bindings.set(local, { namespace: null });
      }
    }
    match = re.exec(src);
  }
  return bindings;
};

/**
 * Refs holding a bound translator: `const xRef = useRef(t)` or
 * `xRef.current = t` where the RHS is a name already bound by
 * `useTranslation`. Such a ref makes `xRef.current('key')` a bound-t call —
 * the useGoogleOneTap `translateRef` pattern. Rebinding a ref to differently-
 * bound translators marks it ambiguous, same as a rebound local.
 */
const findRefBindings = (
  src: string,
  bindings: Map<string, Binding>
): Map<string, Binding> => {
  const refs = new Map<string, Binding>();
  const track = (refName: string | undefined, rhs: string | undefined): void => {
    if (!refName || !rhs) return;
    const bound = bindings.get(rhs);
    if (!bound) return;
    const prev = refs.get(refName);
    if (!prev) {
      refs.set(refName, bound);
    } else if (prev.namespace !== bound.namespace) {
      refs.set(refName, { namespace: null });
    }
  };
  const reInit = /\b(?:const|let|var)\s+(\w+)\s*=\s*useRef\s*(?:<[^>]*>)?\s*\(\s*(\w+)\s*[,)]/g;
  const reAssign = /\b(\w+)\.current\s*=\s*(\w+)\b/g;
  let match = reInit.exec(src);
  while (match !== null) {
    track(match[1], match[2]);
    match = reInit.exec(src);
  }
  match = reAssign.exec(src);
  while (match !== null) {
    track(match[1], match[2]);
    match = reAssign.exec(src);
  }
  return refs;
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

/**
 * Every `name(...)` call for the candidate names, with parsed arguments.
 * `fragments` are extra regex alternatives (e.g. `translateRef\.current`) for
 * multi-part callees; the lookbehind still guards the fragment's first word.
 */
const findCalls = (
  src: string,
  names: Set<string>,
  fragments: string[]
): ExtractedCall[] => {
  if (names.size === 0 && fragments.length === 0) return [];
  const re = new RegExp(
    `(?<![\\w$.])(${[...names, ...fragments].join('|')})\\s*\\(`,
    'g'
  );
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
  const bundle = enResources[namespace as keyof typeof enResources];
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
      const refBindings = findRefBindings(src, bindings);
      const imports = findI18nImports(src, globKey);

      const names = new Set<string>([
        ...Object.keys(KEY_ARG_INDEX),
        'statusLabel',
        ...bindings.keys(),
        ...imports.keys(),
      ]);
      // `<ref>.current(` callees for refs holding a bound translator — matched
      // as a unit so bare `current` and unrelated `xRef.current(` stay ignored.
      const refFragments = [...refBindings.keys()].map((n) => `${n}\\.current`);

      for (const call of findCalls(src, names, refFragments)) {
        // The exported name when imported under an alias (`t as tt`,
        // `statusLabel as sl`), the local name otherwise. Bound destructure
        // aliases (`t: tNav`) and `<ref>.current` callees are absent from the
        // index maps — their key is argument 0.
        const exported = imports.get(call.name) ?? call.name;
        const refMatch = /^(\w+)\.current$/.exec(call.name);
        const bound =
          bindings.get(call.name) ??
          (refMatch ? refBindings.get(refMatch[1]) : undefined);
        const imported = imports.get(call.name);

        let namespace: string | null;
        let keys: string[];

        if (exported === 'statusLabel') {
          // statusLabel(t, 'domain', 'value') → status:domain.value; a
          // non-literal value is a dynamic status the helper humanizes.
          const domain = literalOf(call.args[1]);
          const value = literalOf(call.args[2]);
          if (domain === undefined || value === undefined) continue;
          keys = [`${domain}.${value}`];
          namespace = 'status';
        } else {
          keys = literalKeysOf(call.args[KEY_ARG_INDEX[exported] ?? 0]);
          // Engine-style `translate('key', options)` — first arg is the key.
          if (keys.length === 0 && exported === 'translate') {
            keys = literalKeysOf(call.args[0]);
          }
          if (keys.length === 0) continue;

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

        for (let key of keys) {
          if (key.includes('${')) continue;
          let resolved = namespace;
          const colon = key.indexOf(':');
          if (colon !== -1) {
            resolved = key.slice(0, colon);
            key = key.slice(colon + 1);
          }

          validated += 1;
          const found =
            resolved === null
              ? NAMESPACES.some((ns) => existsIn(ns, key))
              : existsIn(resolved, key);
          if (!found) {
            missing.push({
              file: RELATIVE_PATH(globKey),
              line: lineOf(src, call.index),
              key: resolved === null ? key : `${resolved}:${key}`,
            });
          }
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
