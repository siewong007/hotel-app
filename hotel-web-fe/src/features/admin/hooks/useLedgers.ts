import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { HotelAPIService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';

export const ledgerQueryKeys = queryKeys.ledgers;

type LedgersPageParams = Parameters<typeof HotelAPIService.getLedgersPage>[0];

export function useLedgers() {
  const queryClient = useQueryClient();
  const [localError, setError] = useState<string | null>(null);
  const ledgersQuery = useQuery({
    queryKey: ledgerQueryKeys.list(),
    queryFn: () => HotelAPIService.getCustomerLedgers(),
    staleTime: queryStaleTime.standard,
  });
  const { refetch } = ledgersQuery;

  const reload = useCallback(async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ledgerQueryKeys.all });
    await refetch();
  }, [queryClient, refetch]);

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

export function useLedgersPage(params?: LedgersPageParams, enabled = true) {
  return useQuery({
    queryKey: ledgerQueryKeys.list(params as Record<string, unknown> | undefined),
    queryFn: () => HotelAPIService.getLedgersPage(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: queryStaleTime.short,
  });
}
