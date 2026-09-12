import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
    },
  };
});

import { GuestPortalService } from './guestPortal.service';
import type { PreCheckInUpdateRequest } from '../types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

describe('GuestPortalService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  describe('verify', () => {
    it('posts booking_number and name as json to guest-portal/verify', async () => {
      const response = { token: 'tok', expires_at: '2026-07-27T00:00:00Z', booking_id: '5' };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.verify({ booking_number: 'BK-1', name: 'John Wong' });

      expect(post).toHaveBeenCalledWith('guest-portal/verify', {
        json: { booking_number: 'BK-1', name: 'John Wong' },
      });
      expect(result).toEqual(response);
    });
  });

  describe('getBooking', () => {
    it('calls GET guest-portal/booking with the token in a header, not the path', async () => {
      const response = { booking: { id: 1 }, guest: { id: 2 } };
      get.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.getBooking('tok_abc');

      expect(get).toHaveBeenCalledWith('guest-portal/booking', {
        headers: { 'X-Booking-Access-Token': 'tok_abc' },
      });
      expect(result).toEqual(response);
    });
  });

  describe('submitPreCheckin', () => {
    it('posts pre-checkin json with the token in a header, not the path', async () => {
      const request: PreCheckInUpdateRequest = {
        guest_update: { first_name: 'Jane' },
        special_requests: 'Late checkout',
      };
      const response = { booking: { id: 1 }, guest: { id: 2 } };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.submitPreCheckin('tok_abc', request);

      expect(post).toHaveBeenCalledWith('guest-portal/pre-checkin', {
        json: request,
        headers: { 'X-Booking-Access-Token': 'tok_abc' },
      });
      expect(result).toEqual(response);
    });
  });

  describe('paymentConfig', () => {
    it('calls GET guest-portal/payment-config with the booking token header', async () => {
      const config = { paypal_enabled: true, paypal_client_id: 'abc', bank_details: { bank_name: null, account_name: null, account_number: null } };
      get.mockReturnValue(mockJsonResponse(config));

      const result = await GuestPortalService.paymentConfig('tok_abc');

      expect(get).toHaveBeenCalledWith('guest-portal/payment-config', {
        headers: { 'X-Booking-Access-Token': 'tok_abc' },
      });
      expect(result).toEqual(config);
    });
  });

  describe('submitBankTransfer', () => {
    it('posts bank-transfer with the consents body and token in a header, not the path', async () => {
      const response = { payment_id: 9, status: 'pending', booking_status: 'confirmed' };
      const consents = [
        { document: 'payment_terms' as const, version: '2026-09-09', granted: true, locale: 'en' as const },
      ];
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.submitBankTransfer('tok_abc', consents);

      expect(post).toHaveBeenCalledWith('guest-portal/booking/payments/bank-transfer', {
        headers: { 'X-Booking-Access-Token': 'tok_abc' },
        json: { consents },
      });
      expect(result).toEqual(response);
    });
  });

  describe('uploadPaymentReceipt', () => {
    it('posts a FormData receipt with the token in a header, not the path', async () => {
      post.mockReturnValue(Promise.resolve(undefined));
      const file = new File(['bytes'], 'receipt.png', { type: 'image/png' });

      await GuestPortalService.uploadPaymentReceipt('tok_abc', 42, file);

      expect(post).toHaveBeenCalledTimes(1);
      const [url, options] = post.mock.calls[0];
      expect(url).toBe('guest-portal/booking/payments/42/receipt');
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('file')).toBe(file);
      expect(options.headers).toEqual({ 'X-Booking-Access-Token': 'tok_abc' });
    });
  });

  describe('createPaypalOrder', () => {
    it('posts paypal create-order with the consents body and token in a header, not the path', async () => {
      const response = { order_id: 'ord_1', payment_id: 9 };
      const consents = [
        { document: 'payment_terms' as const, version: '2026-09-09', granted: true, locale: 'en' as const },
      ];
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.createPaypalOrder('tok_abc', consents);

      expect(post).toHaveBeenCalledWith('guest-portal/booking/payments/paypal/create-order', {
        headers: { 'X-Booking-Access-Token': 'tok_abc' },
        json: { consents },
      });
      expect(result).toEqual(response);
    });
  });

  describe('capturePaypalOrder', () => {
    it('posts paypal capture with the token in a header, not the path', async () => {
      const response = { payment_id: 9, status: 'completed', booking_status: 'confirmed' };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.capturePaypalOrder('tok_abc', 'ord_1', 9);

      expect(post).toHaveBeenCalledWith('guest-portal/booking/payments/paypal/capture', {
        json: { order_id: 'ord_1', payment_id: 9 },
        headers: { 'X-Booking-Access-Token': 'tok_abc' },
      });
      expect(result).toEqual(response);
    });
  });
});
