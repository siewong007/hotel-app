/**
 * Platform internationalisation.
 *
 * Import from here rather than reaching into the individual modules — the
 * split between store, engine, and formatters is an implementation detail.
 *
 *   const { t, locale, setLocale } = useTranslation('nav');
 *   t('routes.bookings.label');
 *   t('common:count.nights', { count: 3 });
 *
 * Outside React (utils, interceptors, non-component helpers) use the bare `t`,
 * which reads the active locale at call time.
 */

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_CODES,
  getLocaleDefinition,
  isLocaleCode,
  matchLocale,
  negotiateLocale,
  type LocaleCode,
  type LocaleDefinition,
} from './locales';

export {
  applyDefaultLocale,
  getActiveLocale,
  hasExplicitLocaleChoice,
  setActiveLocale,
  subscribeToLocale,
} from './localeStore';

export { t, translateFor, translateOr } from './translate';
export { useLocale, useTranslation, type UseTranslationResult } from './useTranslation';
export { I18nProvider } from './I18nProvider';
export {
  formatNumber,
  formatPercent,
  formatRelativeTime,
  intlTag,
  dateFormatter,
  numberFormatter,
} from './format';
export { DEFAULT_NAMESPACE, NAMESPACES, type Namespace } from './resources';
export type { TranslationVars } from './translator';
