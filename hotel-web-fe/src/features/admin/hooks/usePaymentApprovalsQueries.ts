import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PaymentApprovalsService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidatePaymentApprovalDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import { AuditLogEntry } from '../../../types/audit.types';

export interface PaymentApprovalsFilters {
  page: number;
  pageSize: number;
}

// audit actions written by services/payments.rs whenever money moved at
// PayPal but could not be matched to a local payment record — staff must not
// charge the guest again for these. The backend's narrow
// /admin/payments/paypal-conflicts endpoint pins the same action list.

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
 * Recent PayPal payment/webhook conflicts (last 30 days) — served by the
 * narrow payments:read-gated endpoint so approvers don't need `audit:read`.
 */
export function usePaypalConflictEvents(enabled = true) {
  return useQuery({
    queryKey: queryKeys.paymentApprovals.paypalConflicts,
    queryFn: (): Promise<PaypalConflictEvents> => PaymentApprovalsService.paypalConflicts(),
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
