/**
 * The app-wide translation entry point: `translator.ts` bound to the shipped
 * resource bundles and the active locale.
 *
 * `t` here is the non-React door — usable from utils, API interceptors, and
 * anything else that runs outside a component. Components should prefer
 * `useTranslation`, which re-renders when the language changes; a plain `t`
 * call captures the locale at call time and will not update on its own.
 */

import { getActiveLocale } from './localeStore';
import { DEFAULT_LOCALE, type LocaleCode } from './locales';
import { DEFAULT_NAMESPACE, resources, type Namespace } from './resources';
import { interpolate, resolveRaw, translate, type TranslationVars } from './translator';

/** Keys already reported, so a missing string warns once rather than per render. */
const reportedMissing = new Set<string>();

const isDev = (): boolean => {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
};

const reportMissing = (namespace: string, key: string, locale: LocaleCode): void => {
  const signature = `${locale}:${namespace}:${key}`;
  if (reportedMissing.has(signature)) return;
  reportedMissing.add(signature);
  if (isDev()) {
    console.warn(
      `[i18n] Missing translation "${namespace}:${key}" for locale "${locale}" ` +
        `(and for the "${DEFAULT_LOCALE}" fallback).`
    );
  }
};

/** Translate against an explicit locale. */
export const translateFor = (
  locale: LocaleCode,
  key: string,
  vars?: TranslationVars,
  namespace: Namespace | string = DEFAULT_NAMESPACE
): string =>
  translate(
    key,
    {
      locale,
      resources: resources[locale] ?? resources[DEFAULT_LOCALE],
      fallbackResources: locale === DEFAULT_LOCALE ? undefined : resources[DEFAULT_LOCALE],
      defaultNamespace: namespace,
      onMissing: reportMissing,
    },
    vars
  );

/**
 * Translate against whatever locale is active right now.
 *
 * For use outside React. Inside a component use `useTranslation` so the text
 * updates when the user switches language.
 */
export const t = (
  key: string,
  vars?: TranslationVars,
  namespace: Namespace | string = DEFAULT_NAMESPACE
): string => translateFor(getActiveLocale(), key, vars, namespace);

/**
 * Translate `key`, or render `fallback` when no bundle defines it.
 *
 * This is what makes a platform-wide rollout incremental. A screen still
 * holding hardcoded English passes that English as the fallback: it keeps
 * reading correctly today, switches to Bahasa Melayu the moment someone adds
 * the key, and never shows a raw key to a user in the meantime. Unlike `t`, a
 * miss here is not reported — an as-yet-unmigrated string is expected, not a
 * defect.
 */
export const translateOr = (
  locale: LocaleCode,
  key: string,
  fallback: string,
  vars?: TranslationVars,
  namespace: Namespace | string = DEFAULT_NAMESPACE
): string => {
  const raw = resolveRaw(
    key,
    {
      locale,
      resources: resources[locale] ?? resources[DEFAULT_LOCALE],
      fallbackResources: locale === DEFAULT_LOCALE ? undefined : resources[DEFAULT_LOCALE],
      defaultNamespace: namespace,
    },
    vars
  );
  return interpolate(raw ?? fallback, vars, locale);
};

/** Test seam: forget which missing keys have already been warned about. */
export const resetMissingKeyReportsForTests = (): void => {
  reportedMissing.clear();
};
