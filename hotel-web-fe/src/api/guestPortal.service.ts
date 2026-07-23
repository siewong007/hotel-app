import { api } from './client';
import {
  Booking,
  Guest,
  GuestPaymentConfig,
  PaymentActionResponse,
  PaypalCreateOrderResponse,
  PreCheckInUpdateRequest,
} from '../types';

export class GuestPortalService {
  static async verify(request: {
    booking_number: string;
    email: string;
  }): Promise<{ token: string; expires_at: string; booking_id: string }> {
    return await api.post('guest-portal/verify', { json: request }).json();
  }

  static async getBooking(token: string): Promise<{
    booking: Booking;
    guest: Guest;
  }> {
    return await api.get(`guest-portal/booking/${token}`).json();
  }

  static async submitPreCheckin(
    token: string,
    request: PreCheckInUpdateRequest
  ): Promise<{ booking: Booking; guest: Guest }> {
    return await api.post(`guest-portal/pre-checkin/${token}`, { json: request }).json();
  }

  /**
   * Public payment configuration (bank details + PayPal client id, when
   * enabled). No auth of any kind — safe to call before a guest session or a
   * pre-arrival token is available.
   */
  static async paymentConfig(): Promise<GuestPaymentConfig> {
    return await api.get('guest-portal/payment-config').json();
  }

  /**
   * Unauthenticated pre-arrival token flow: the booking token travels as a
   * URL path segment on every request (see `getBooking` above), never in a
   * body — these three methods follow the same shape.
   */
  static async submitBankTransfer(token: string): Promise<PaymentActionResponse> {
    return await api.post(`guest-portal/booking/${token}/payments/bank-transfer`).json();
  }

  static async uploadPaymentReceipt(token: string, paymentId: number, file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    await api.post(`guest-portal/booking/${token}/payments/${paymentId}/receipt`, { body: form });
  }

  static async createPaypalOrder(token: string): Promise<PaypalCreateOrderResponse> {
    return await api
      .post(`guest-portal/booking/${token}/payments/paypal/create-order`)
      .json();
  }

  static async capturePaypalOrder(
    token: string,
    orderId: string,
    paymentId: number
  ): Promise<PaymentActionResponse> {
    return await api
      .post(`guest-portal/booking/${token}/payments/paypal/capture`, {
        json: { order_id: orderId, payment_id: paymentId },
      })
      .json();
  }
}
