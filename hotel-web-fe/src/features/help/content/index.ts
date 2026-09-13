import { DEFAULT_LOCALE, type LocaleCode } from '../../../i18n/locales';
import type { HelpArticle } from '../types';
import { ARTICLES_EN } from './articles.en';
import { ARTICLES_MS } from './articles.ms';

const ARTICLES_BY_LOCALE: Record<LocaleCode, HelpArticle[]> = {
  en: ARTICLES_EN,
  ms: ARTICLES_MS,
};

/** Articles for a locale, falling back to English for an unknown code or a
 * locale whose bundle is still catching up. */
export const getArticles = (locale: LocaleCode): HelpArticle[] =>
  ARTICLES_BY_LOCALE[locale] ?? ARTICLES_BY_LOCALE[DEFAULT_LOCALE];
