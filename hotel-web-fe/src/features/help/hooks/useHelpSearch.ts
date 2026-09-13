import { useCallback, useMemo, useState } from 'react';
import {
  HELP_MAX_RECENT_SEARCHES,
  HELP_RECENT_SEARCHES_KEY,
  HELP_SEARCH_DEBOUNCE_MS,
  HELP_SEARCH_MIN_CHARS,
} from '../constants';
import { searchArticles } from '../utils';
import { storage } from '../../../utils/storage';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import type { HelpArticle, HelpSearchHit } from '../types';

export interface HelpSearchState {
  query: string;
  setQuery: (value: string) => void;
  /** True while the typed text is ahead of the debounced query. */
  isDebouncing: boolean;
  /** Debounced hits — empty until the minimum length is reached. */
  hits: HelpSearchHit[];
  showHits: boolean;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** Terms the user previously committed (Enter or picking a result). */
  recentSearches: string[];
  commitSearch: (term: string) => void;
  clear: () => void;
}

/**
 * Search state for the Help Centre: debounced weighted search over the locale
 * catalogue plus a small persisted list of recent queries.
 */
export function useHelpSearch(articles: HelpArticle[]): HelpSearchState {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(
    () => storage.getItem<string[]>(HELP_RECENT_SEARCHES_KEY) ?? [],
  );

  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, HELP_SEARCH_DEBOUNCE_MS);
  const active = debounced.length >= HELP_SEARCH_MIN_CHARS;

  const hits = useMemo(
    () => (active ? searchArticles(articles, debounced) : []),
    [articles, debounced, active],
  );

  const isDebouncing = trimmed.length >= HELP_SEARCH_MIN_CHARS && trimmed !== debounced;

  const commitSearch = useCallback((term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setRecentSearches((prev) => {
      const next = [clean, ...prev.filter((t) => t.toLowerCase() !== clean.toLowerCase())].slice(
        0,
        HELP_MAX_RECENT_SEARCHES,
      );
      storage.setItem(HELP_RECENT_SEARCHES_KEY, next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setActiveIndex(0);
  }, []);

  return {
    query,
    setQuery,
    isDebouncing,
    hits,
    showHits: active || isDebouncing,
    activeIndex,
    setActiveIndex,
    recentSearches,
    commitSearch,
    clear,
  };
}
