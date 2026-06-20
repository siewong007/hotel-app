import { useQuery } from '@tanstack/react-query';
import { queryStaleTime } from '../api/queryConfig';
import { SearchService, type SearchGroup } from '../api/search.service';
import { useDebouncedValue } from './useDebouncedValue';

interface Options {
  /** Restrict server search to these domains (e.g. ['bookings'] or ['ledgers']). */
  types?: string[];
  /** Skip the network call entirely (e.g. while typing a /command). */
  enabled?: boolean;
}

export const globalSearchQueryKeys = {
  all: ['global-search'] as const,
  results: (query: string, typesKey: string) =>
    [...globalSearchQueryKeys.all, query, typesKey] as const,
};

export function useGlobalSearch(query: string, opts: Options = {}) {
  const { types, enabled = true } = opts;
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, 220);
  const typesKey = types?.join(',') || '';
  const canSearch = enabled && debouncedQuery.length >= 2;

  const searchQuery = useQuery({
    queryKey: globalSearchQueryKeys.results(debouncedQuery, typesKey),
    queryFn: ({ signal }) =>
      SearchService.search(debouncedQuery, {
        types,
        limit: 6,
        signal,
    }),
    enabled: canSearch,
    staleTime: queryStaleTime.short,
  });

  const isDebouncing = enabled && trimmedQuery.length >= 2 && trimmedQuery !== debouncedQuery;
  const groups: SearchGroup[] = canSearch ? searchQuery.data?.groups || [] : [];

  return {
    groups,
    loading: canSearch && (searchQuery.isLoading || searchQuery.isFetching || isDebouncing),
  };
}
