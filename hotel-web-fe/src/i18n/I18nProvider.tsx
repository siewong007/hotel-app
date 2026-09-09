/**
 * Applies the active locale to the document.
 *
 * Reads are handled by `useTranslation` against the module-level store, so
 * this provider exists for the side effects a store cannot perform: keeping
 * `<html lang>` and `<html dir>` in step with the chosen language. Both matter
 * beyond cosmetics — screen readers pick pronunciation from `lang`, and the
 * browser's own hyphenation, quotation marks, and form controls follow it.
 *
 * Mounted once, near the root of `App`. It renders its children untouched.
 */

import { useEffect, type ReactNode } from 'react';
import { getLocaleDefinition } from './locales';
import { useLocale } from './useTranslation';

export interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const locale = useLocale();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const definition = getLocaleDefinition(locale);
    const root = document.documentElement;
    root.setAttribute('lang', definition.code);
    root.setAttribute('dir', definition.dir);
  }, [locale]);

  return <>{children}</>;
}

export default I18nProvider;
