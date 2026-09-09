import { api } from '../../api/client';
import type { PaymentActionResponse } from '../../types';
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
};
