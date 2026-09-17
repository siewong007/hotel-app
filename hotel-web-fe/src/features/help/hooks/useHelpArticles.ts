import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocale } from '../../../i18n';
import {
  ensureArticlesLoaded,
  getArticles,
  subscribeToArticles,
} from '../content';
import type { HelpArticle } from '../types';

/**
 * The active locale's article catalogue.
 *
 * Only English ships in the app shell; the other locales are dynamic chunks
 * (see `../content`). Reads stay synchronous — a locale still loading resolves
 * to English — and the subscription is what swaps the real set in once its
 * chunk lands. Subscribing to the ARRAY rather than the locale code is
 * deliberate: switching language changes the code immediately, so a snapshot
 * built from the code alone is unchanged when the articles arrive a moment
 * later, and `useSyncExternalStore` would bail out of the re-render.
 */
export const useHelpArticles = (): HelpArticle[] => {
  const locale = useLocale();

  const snapshot = useCallback(() => getArticles(locale), [locale]);
  const articles = useSyncExternalStore(subscribeToArticles, snapshot, snapshot);

  useEffect(() => {
    void ensureArticlesLoaded(locale);
  }, [locale]);

  return articles;
};
