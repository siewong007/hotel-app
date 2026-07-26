import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuditService, PaymentApprovalsService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidatePaymentApprovalDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import { AuditLogEntry } from '../../../types/audit.types';

export interface PaymentApprovalsFilters {
  page: number;
  pageSize: number;
}

// audit actions written by services/payments.rs whenever money moved at
// PayPal but could not be matched to a local payment record — staff must not
// charge the guest again for these.
const PAYPAL_CONFLICT_ACTIONS = ['paypal_webhook_conflict', 'paypal_capture_conflict'] as const;
const PAYPAL_CONFLICT_LOOKBACK_DAYS = 30;

export interface PaypalConflictEvents {
  events: AuditLogEntry[];
  total: number;
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

export function usePaymentApprovalHistory(
  filters: PaymentApprovalsFilters = { page: 1, pageSize: 25 },
  enabled = true,
) {
  const { page, pageSize } = filters;
  return useQuery({
    queryKey: [...queryKeys.paymentApprovals.all, 'history', page, pageSize],
    queryFn: () => PaymentApprovalsService.listHistory({ page, perPage: pageSize }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: queryStaleTime.short,
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

/**
 * Recent PayPal payment/webhook conflicts (last 30 days) — surfaced from the
 * generic audit log so staff don't have to hand-search it. The audit-logs
 * endpoint only exact-matches one `action` per call, so this fires one
 * request per conflict action and merges the results client-side.
 */
export function usePaypalConflictEvents(enabled = true) {
  return useQuery({
    queryKey: queryKeys.paymentApprovals.paypalConflicts,
    queryFn: async (): Promise<PaypalConflictEvents> => {
      const startDate = formatLocalDate(addLocalDays(new Date(), -PAYPAL_CONFLICT_LOOKBACK_DAYS));
      const responses = await Promise.all(
        PAYPAL_CONFLICT_ACTIONS.map((action) =>
          AuditService.getAuditLogs({
            action,
            start_date: startDate,
            page: 1,
            page_size: 50,
            sort_by: 'created_at',
            sort_order: 'desc',
          })
        )
      );
      const events = responses
        .flatMap((response) => response.data)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const total = responses.reduce((sum, response) => sum + response.total, 0);
      return { events, total };
    },
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useRequestPaymentReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, message }: { paymentId: number; message?: string }) =>
      PaymentApprovalsService.requestReceipt(paymentId, message),
    onSuccess: () => invalidatePaymentApprovalDependencies(queryClient),
  });
}
