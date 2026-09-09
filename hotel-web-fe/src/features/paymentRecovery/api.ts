import { api } from '../../api/client';
import type { PaymentActionResponse, PaypalCreateOrderResponse } from '../../types';
import type { PaymentRecoveryView } from './types';

/**
 * Public payment-recovery endpoints, authenticated solely by the capability in
 * the URL. No session and no booking-access token are involved.
 *
 * Paths are root-absolute (leading slash): this page lives at the nested route
 * /booking/recover-payment/$token, so page-relative URLs would resolve under
 * that directory before the client's /api prefixing.
 */
export const PaymentRecoveryApi = {
  /**
   * Read-only. The server deliberately does not consume the capability here,
   * so opening the page (or a mail scanner pre-fetching it) cannot spend the
   * guest's one attempt.
   */
  view(token: string): Promise<PaymentRecoveryView> {
    return api
      .get(`/booking/recover-payment/${encodeURIComponent(token)}`)
      .json<PaymentRecoveryView>();
  },

  bankTransfer(token: string): Promise<PaymentActionResponse> {
    return api
      .post(`/booking/recover-payment/${encodeURIComponent(token)}/bank-transfer`)
      .json<PaymentActionResponse>();
  },

  /**
   * Authorise a PayPal order. Spends the capability, so calling it twice
   * resolves to the order already created rather than authorising a second one.
   */
  paypalCreateOrder(token: string): Promise<PaypalCreateOrderResponse> {
    return api
      .post(`/booking/recover-payment/${encodeURIComponent(token)}/paypal/create-order`)
      .json<PaypalCreateOrderResponse>();
  },

  /**
   * Capture an approved order. Deliberately still works once the capability is
   * spent: the guest has to approve in PayPal's window and come back, and the
   * link is already consumed by then.
   */
  paypalCapture(
    token: string,
    orderId: string,
    paymentId: number,
  ): Promise<PaymentActionResponse> {
    return api
      .post(`/booking/recover-payment/${encodeURIComponent(token)}/paypal/capture`, {
        json: { order_id: orderId, payment_id: paymentId },
      })
      .json<PaymentActionResponse>();
  },

  /**
   * Attach proof of a bank transfer to the claim this link raised. The server
   * accepts it only for the payment this capability produced, and only while
   * that payment is a pending bank-transfer claim.
   */
  uploadReceipt(token: string, paymentId: number, file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    return api
      .post(
        `/booking/recover-payment/${encodeURIComponent(token)}/payments/${paymentId}/receipt`,
        { body: form },
      )
      .json<void>();
  },
};
