import { api } from './client';
import { withRetry } from '../utils/retry';
import type { PaymentActionResponse, PendingPaymentPage } from '../types';

export class PaymentApprovalsService {
  /**
   * Get a page of pending guest payment claims (bank-transfer or PayPal) for
   * the staff review queue.
   */
  static async listPending(params: {
    page?: number;
    perPage?: number;
  } = {}): Promise<PendingPaymentPage> {
    const searchParams: Record<string, string> = {};
    if (params.page !== undefined) searchParams.page = String(params.page);
    if (params.perPage !== undefined) searchParams.per_page = String(params.perPage);

    return await withRetry(
      () => api.get('admin/payments/pending', { searchParams }).json<PendingPaymentPage>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Approve a pending payment claim. Completes the payment and confirms the
   * booking in one action.
   */
  static async approve(paymentId: number): Promise<PaymentActionResponse> {
    return await withRetry(
      () => api.put(`admin/payments/${paymentId}/approve`).json<PaymentActionResponse>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async listHistory(params: { page?: number; perPage?: number } = {}): Promise<PendingPaymentPage> {
    const searchParams: Record<string, string> = {};
    if (params.page !== undefined) searchParams.page = String(params.page);
    if (params.perPage !== undefined) searchParams.per_page = String(params.perPage);
    return await withRetry(
      () => api.get('admin/payments/history', { searchParams }).json<PendingPaymentPage>(),
      { maxAttempts: 3, initialDelay: 1000 },
    );
  }

  static async downloadReceipt(paymentId: number): Promise<Blob> {
    return await api.get(`admin/payments/${paymentId}/receipt`).blob();
  }

  /**
   * Reject a pending payment claim. The booking stays in its current state.
   */
  static async reject(paymentId: number, reason: string): Promise<PaymentActionResponse> {
    return await withRetry(
      () =>
        api
          .put(`admin/payments/${paymentId}/reject`, { json: { reason } })
          .json<PaymentActionResponse>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async requestReceipt(paymentId: number, message?: string): Promise<void> {
    await api.post(`admin/payments/${paymentId}/request-receipt`, {
      json: { message: message?.trim() || null },
    });
  }
}
