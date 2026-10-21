import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateRoomDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import {
  applyBulkPrices,
  getLastBulkPriceChange,
  previewBulkPrices,
  revertBulkPrices,
} from './api';

const lastKey = [...queryKeys.roomTypes.all, 'last-bulk-price-change'] as const;

export const usePreviewBulkPrices = () =>
  useMutation({ mutationFn: previewBulkPrices });

export const useLastBulkPriceChange = (enabled = true) =>
  useQuery({ queryKey: lastKey, queryFn: getLastBulkPriceChange, enabled, staleTime: 0 });

export function useApplyBulkPrices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: applyBulkPrices,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: lastKey });
      invalidateRoomDependencies(queryClient);
    },
  });
}

export function useRevertBulkPrices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revertBulkPrices,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: lastKey });
      invalidateRoomDependencies(queryClient);
    },
  });
}
