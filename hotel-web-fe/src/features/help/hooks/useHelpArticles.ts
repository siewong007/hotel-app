import { useMemo } from 'react';
import { useLocale } from '../../../i18n';
import { getArticles } from '../content';
import type { HelpArticle } from '../types';

/** The active locale's article catalogue, memoised per locale switch. */
export const useHelpArticles = (): HelpArticle[] => {
  const locale = useLocale();
  return useMemo(() => getArticles(locale), [locale]);
};
