import { useEffect, useRef, useState } from 'react';
import { SearchService, SearchGroup } from '../api/search.service';

interface Options {
  /** Restrict server search to these domains (e.g. ['bookings']). */
  types?: string[];
  /** Skip the network call entirely (e.g. while typing a /command). */
  enabled?: boolean;
}

/**
 * Debounced, abortable federated search with a request-id guard so a
 * slow response can never overwrite a newer one. Mirrors the pattern
 * used by useBookings/useLedgers.
 */
export function useGlobalSearch(query: string, opts: Options = {}) {
  const { types, enabled = true } = opts;
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);
  const typesKey = types?.join(',') || '';

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const id = ++reqId.current;
    const controller = new AbortController();
    setLoading(true);

    const t = window.setTimeout(async () => {
      try {
        const res = await SearchService.search(q, {
          types,
          limit: 6,
          signal: controller.signal,
        });
        if (id === reqId.current) {
          setGroups(res.groups || []);
          setLoading(false);
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        if (id === reqId.current) {
          setGroups([]);
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [query, typesKey, enabled]);

  return { groups, loading };
}
