/**
 * The active locale, held outside React.
 *
 * Two things need to read the current language, and only one of them is a
 * component: the `useTranslation` hook, and the plain functions in
 * `src/utils/` (`formatHotelDate`, the API client's `Accept-Language` header)
 * that are called from hundreds of non-hook call sites. A module-level store
 * with an `useSyncExternalStore`-compatible subscription serves both without
 * threading a context through every signature — the same shape `themeMode` and
 * `hotelCurrency` already use for cross-cutting preferences in this app.
 *
 * Precedence, highest first:
 *   1. an explicit choice the user made in the switcher (persisted)
 *   2. the hotel's configured default, once settings have loaded
 *   3. the browser's `navigator.languages`
 *   4. `DEFAULT_LOCALE`
 *
 * An explicit choice outranks the hotel default on purpose: a guest who picked
 * Bahasa Melayu should not be flipped back to English by a settings sync.
 */

import { storage } from '../utils/storage';
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  negotiateLocale,
  type LocaleCode,
} from './locales';

type Listener = () => void;

const listeners = new Set<Listener>();

/** True once the user has chosen a language themselves. */
let hasExplicitChoice = false;

const readStoredLocale = (): LocaleCode | undefined => {
  const stored = storage.getItem<string>('locale');
  return isLocaleCode(stored) ? stored : undefined;
};

const browserLocales = (): string[] => {
  if (typeof navigator === 'undefined') return [];
  const languages = navigator.languages;
  if (languages && languages.length > 0) return Array.from(languages);
  return navigator.language ? [navigator.language] : [];
};

const initialLocale = (): LocaleCode => {
  const stored = readStoredLocale();
  if (stored) {
    hasExplicitChoice = true;
    return stored;
  }
  return negotiateLocale(browserLocales(), DEFAULT_LOCALE);
};

let activeLocale: LocaleCode = initialLocale();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

/** Current locale. Safe to call from anywhere, including module scope. */
export const getActiveLocale = (): LocaleCode => activeLocale;

/** `useSyncExternalStore` subscribe. */
export const subscribeToLocale = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Set the language because the user asked for it. Persists the choice, so it
 * survives reloads and outranks later automatic sources.
 */
export const setActiveLocale = (locale: LocaleCode): void => {
  hasExplicitChoice = true;
  if (locale === activeLocale) {
    // Still persist: the value may have been inferred rather than chosen, and
    // the user has now confirmed it.
    storage.setItem('locale', locale);
    return;
  }
  activeLocale = locale;
  storage.setItem('locale', locale);
  emit();
};

/**
 * Apply a non-user-chosen default (the hotel's configured language, or the
 * `language_preference` stored on a guest profile). No-op once the user has
 * chosen for themselves.
 */
export const applyDefaultLocale = (locale: LocaleCode | undefined): void => {
  if (!locale || hasExplicitChoice || locale === activeLocale) return;
  activeLocale = locale;
  emit();
};

/** True when the active locale came from the user rather than from inference. */
export const hasExplicitLocaleChoice = (): boolean => hasExplicitChoice;

/** Test seam: restore the store to a pristine, unchosen state. */
export const resetLocaleStoreForTests = (locale: LocaleCode = DEFAULT_LOCALE): void => {
  hasExplicitChoice = false;
  activeLocale = locale;
  emit();
};
