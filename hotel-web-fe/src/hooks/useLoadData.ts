import { useState, useEffect, useCallback } from 'react';

interface UseLoadDataOptions<T> {
  fetchFn: () => Promise<T>;
  dependencies?: any[];
  initialData?: T;
  enabled?: boolean; // Allow conditional fetching
}

interface UseLoadDataReturn<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setData: (data: T | undefined) => void;
}

/**
 * Generic hook for loading data with error handling and loading states
 *
 * Eliminates boilerplate code for data fetching across components.
 *
 * @example
 * const { data: rooms, loading, error, reload } = useLoadData({
 *   fetchFn: HotelAPIService.getAllRooms,
 * });
 */
export function useLoadData<T>({
  fetchFn,
  dependencies = [],
  initialData,
  enabled = true,
}: UseLoadDataOptions<T>): UseLoadDataReturn<T> {
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      setError(null);
      const result = await fetchFn();
      setData(result);
    } catch (err: any) {
      console.error('Data loading error:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [fetchFn, enabled]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData, ...dependencies]);

  return { data, loading, error, reload: loadData, setData };
}
