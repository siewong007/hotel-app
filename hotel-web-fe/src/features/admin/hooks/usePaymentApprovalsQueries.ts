import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PaymentApprovalsService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidatePaymentApprovalDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';

export interface PaymentApprovalsFilters {
  page: number;
  pageSize: number;
}

export function usePendingPayments(
  filters: PaymentApprovalsFilters = { page: 1, pageSize: 25 },
  enabled = true
) {
  const { page, pageSize } = filters;

  return useQuery({
    queryKey: queryKeys.paymentApprovals.pending(page, pageSize),
    queryFn: () => PaymentApprovalsService.listPending({ page, perPage: pageSize }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: queryStaleTime.short,
  });
}

export function useApprovePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: number) => PaymentApprovalsService.approve(paymentId),
    onSuccess: () => invalidatePaymentApprovalDependencies(queryClient),
  });
}

export function useRejectPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: number; reason: string }) =>
      PaymentApprovalsService.reject(paymentId, reason),
    onSuccess: () => invalidatePaymentApprovalDependencies(queryClient),
  });
}
