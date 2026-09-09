/**
 * The component-facing translation hook.
 *
 * Subscribes to the module-level locale store through `useSyncExternalStore`,
 * so every mounted component re-renders exactly once when the language
 * changes — no context provider is required for reads, and no component needs
 * to thread a locale prop.
 *
 * The signature is deliberately i18next-shaped (`useTranslation(ns)` returning
 * `{ t }`, with `ns:key` overriding the bound namespace). If this ever grows
 * past what a hand-rolled engine should carry, swapping in `react-i18next`
 * becomes an import change rather than a call-site migration.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getActiveLocale, setActiveLocale, subscribeToLocale } from './localeStore';
import { getLocaleDefinition, type LocaleCode } from './locales';
import { DEFAULT_NAMESPACE, type Namespace } from './resources';
import { translateFor, translateOr } from './translate';
import type { TranslationVars } from './translator';

export interface UseTranslationResult {
  /** Translate `key` (or `ns:key`) with optional `{{vars}}`. */
  t: (key: string, vars?: TranslationVars) => string;
  /**
   * Translate `key`, falling back to `fallback` when no bundle defines it —
   * for screens still carrying hardcoded English while the rollout catches up.
   */
  tOr: (key: string, fallback: string, vars?: TranslationVars) => string;
  /** Active locale code. */
  locale: LocaleCode;
  /** Writing direction for the active locale. */
  dir: 'ltr' | 'rtl';
  /** Switch language, persisting the choice. */
  setLocale: (locale: LocaleCode) => void;
}

/** Read the active locale reactively, without the translation helpers. */
export const useLocale = (): LocaleCode =>
  useSyncExternalStore(subscribeToLocale, getActiveLocale, getActiveLocale);

export const useTranslation = (
  namespace: Namespace | string = DEFAULT_NAMESPACE
): UseTranslationResult => {
  const locale = useLocale();

  const t = useCallback(
    (key: string, vars?: TranslationVars) => translateFor(locale, key, vars, namespace),
    [locale, namespace]
  );

  const tOr = useCallback(
    (key: string, fallback: string, vars?: TranslationVars) =>
      translateOr(locale, key, fallback, vars, namespace),
    [locale, namespace]
  );

  const dir = useMemo(() => getLocaleDefinition(locale).dir, [locale]);

  return { t, tOr, locale, dir, setLocale: setActiveLocale };
};
