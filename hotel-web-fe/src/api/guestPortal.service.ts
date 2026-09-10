import { api } from './client';
import {
  Booking,
  Guest,
  GuestEkycStatusSummary,
  GuestPaymentConfig,
  GuestPortalAutoCheckinResponse,
  GuestPortalClaimAccountRequest,
  GuestPortalClaimAccountResponse,
  PaymentActionResponse,
  PaypalCreateOrderResponse,
  PreCheckInUpdateRequest,
} from '../types';

/** Booking-scoped access token. Sent as a header so it never appears in the
 *  request URL (access logs, browser history, Referer). Distinct from the
 *  guest-portal session `Authorization` bearer. */
export const BOOKING_ACCESS_TOKEN_HEADER = 'X-Booking-Access-Token';

function bookingTokenHeaders(token: string): Record<string, string> {
  return { [BOOKING_ACCESS_TOKEN_HEADER]: token };
}

export class GuestPortalService {
  static async verify(request: {
    booking_number: string;
    name: string;
  }): Promise<{ token: string; expires_at: string; booking_id: string }> {
    return await api.post('guest-portal/verify', { json: request }).json();
  }

  static async getBooking(token: string): Promise<{
    booking: Booking;
    guest: Guest;
    ekyc_summary?: GuestEkycStatusSummary | null;
    receipt_request_payment_id?: number | null;
    receipt_request_message?: string | null;
    receipt_uploaded?: boolean;
  }> {
    return await api.get('guest-portal/booking', { headers: bookingTokenHeaders(token) }).json();
  }

  static async submitPreCheckin(
    token: string,
    request: PreCheckInUpdateRequest
  ): Promise<{ booking: Booking; guest: Guest }> {
    return await api
      .post('guest-portal/pre-checkin', { json: request, headers: bookingTokenHeaders(token) })
      .json();
  }

  /**
   * Create a portal login for the guest this booking token authenticates.
   *
   * Not `/auth/register`: that always inserts a new guest profile and rejects
   * a name that already exists, which is every guest who has booked. The
   * account this mints is bound to the booking's own guest, which is what
   * makes identity verification (and later, self check-in) reachable.
   */
  static async claimAccount(
    token: string,
    request: GuestPortalClaimAccountRequest
  ): Promise<GuestPortalClaimAccountResponse> {
    return await api
      .post('guest-portal/claim-account', { json: request, headers: bookingTokenHeaders(token) })
      .json();
  }

  /**
   * Check the guest in without the front desk.
   *
   * The backend re-checks every gate itself (approved eKYC with self check-in
   * enabled, a confirmed booking, the arrival date reached, a room that is
   * ready), so a stale `can_auto_checkin` on the client cannot check anyone in
   * — a refusal comes back as a 400 naming the reason.
   */
  static async autoCheckin(token: string): Promise<GuestPortalAutoCheckinResponse> {
    return await api
      .post('guest-portal/auto-checkin', { headers: bookingTokenHeaders(token) })
      .json();
  }

  /**
   * Payment configuration (bank details + PayPal client id, when enabled).
   * Requires the booking-scoped access token — bank account numbers are not
   * a public scrape target.
   */
  static async paymentConfig(token: string): Promise<GuestPaymentConfig> {
    return await api
      .get('guest-portal/payment-config', { headers: bookingTokenHeaders(token) })
      .json();
  }

  /**
   * Unauthenticated pre-arrival token flow: the booking token travels in
   * `X-Booking-Access-Token`, never in the URL.
   */
  static async submitBankTransfer(token: string): Promise<PaymentActionResponse> {
    return await api
      .post('guest-portal/booking/payments/bank-transfer', {
        headers: bookingTokenHeaders(token),
      })
      .json();
  }

  static async uploadPaymentReceipt(token: string, paymentId: number, file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    await api.post(`guest-portal/booking/payments/${paymentId}/receipt`, {
      body: form,
      headers: bookingTokenHeaders(token),
    });
  }

  static async createPaypalOrder(token: string): Promise<PaypalCreateOrderResponse> {
    return await api
      .post('guest-portal/booking/payments/paypal/create-order', {
        headers: bookingTokenHeaders(token),
      })
      .json();
  }

  static async capturePaypalOrder(
    token: string,
    orderId: string,
    paymentId: number
  ): Promise<PaymentActionResponse> {
    return await api
      .post('guest-portal/booking/payments/paypal/capture', {
        json: { order_id: orderId, payment_id: paymentId },
        headers: bookingTokenHeaders(token),
      })
      .json();
  }
}
