import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HotelAPIService } from '../../../api';

const LEDGERS_STALE_TIME_MS = 60_000;

export const ledgerQueryKeys = {
  all: ['ledgers'] as const,
  list: () => [...ledgerQueryKeys.all, 'list'] as const,
};

export function useLedgers() {
  const [localError, setError] = useState<string | null>(null);
  const ledgersQuery = useQuery({
    queryKey: ledgerQueryKeys.list(),
    queryFn: () => HotelAPIService.getCustomerLedgers(),
    staleTime: LEDGERS_STALE_TIME_MS,
  });
  const { refetch } = ledgersQuery;

  const reload = useCallback(async () => {
    setError(null);
    await refetch();
  }, [refetch]);

  const queryError = ledgersQuery.error instanceof Error
    ? ledgersQuery.error.message
    : null;

  return {
    ledgers: ledgersQuery.data || [],
    loading: ledgersQuery.isLoading || ledgersQuery.isFetching,
    error: localError || queryError,
    setError,
    reload,
    loadLedgers: reload,
  };
}
