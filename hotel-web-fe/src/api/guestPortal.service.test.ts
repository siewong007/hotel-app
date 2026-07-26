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
    it('posts booking_number and email as json to guest-portal/verify', async () => {
      const response = { token: 'tok', expires_at: '2026-07-27T00:00:00Z', booking_id: '5' };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.verify({ booking_number: 'BK-1', email: 'guest@example.com' });

      expect(post).toHaveBeenCalledWith('guest-portal/verify', {
        json: { booking_number: 'BK-1', email: 'guest@example.com' },
      });
      expect(result).toEqual(response);
    });
  });

  describe('getBooking', () => {
    it('calls GET guest-portal/booking/<token>', async () => {
      const response = { booking: { id: 1 }, guest: { id: 2 } };
      get.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.getBooking('tok_abc');

      expect(get).toHaveBeenCalledWith('guest-portal/booking/tok_abc');
      expect(result).toEqual(response);
    });
  });

  describe('submitPreCheckin', () => {
    it('posts the pre-checkin request as json to guest-portal/pre-checkin/<token>', async () => {
      const request: PreCheckInUpdateRequest = {
        guest_update: { first_name: 'Jane' },
        special_requests: 'Late checkout',
      };
      const response = { booking: { id: 1 }, guest: { id: 2 } };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.submitPreCheckin('tok_abc', request);

      expect(post).toHaveBeenCalledWith('guest-portal/pre-checkin/tok_abc', { json: request });
      expect(result).toEqual(response);
    });
  });

  describe('paymentConfig', () => {
    it('calls GET guest-portal/payment-config', async () => {
      const config = { paypal_enabled: true, paypal_client_id: 'abc', bank_details: { bank_name: null, account_name: null, account_number: null } };
      get.mockReturnValue(mockJsonResponse(config));

      const result = await GuestPortalService.paymentConfig();

      expect(get).toHaveBeenCalledWith('guest-portal/payment-config');
      expect(result).toEqual(config);
    });
  });

  describe('submitBankTransfer', () => {
    it('posts to guest-portal/booking/<token>/payments/bank-transfer', async () => {
      const response = { payment_id: 9, status: 'pending', booking_status: 'confirmed' };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.submitBankTransfer('tok_abc');

      expect(post).toHaveBeenCalledWith('guest-portal/booking/tok_abc/payments/bank-transfer');
      expect(result).toEqual(response);
    });
  });

  describe('uploadPaymentReceipt', () => {
    it('posts a FormData body containing the file to guest-portal/booking/<token>/payments/<id>/receipt', async () => {
      post.mockReturnValue(Promise.resolve(undefined));
      const file = new File(['bytes'], 'receipt.png', { type: 'image/png' });

      await GuestPortalService.uploadPaymentReceipt('tok_abc', 42, file);

      expect(post).toHaveBeenCalledTimes(1);
      const [url, options] = post.mock.calls[0];
      expect(url).toBe('guest-portal/booking/tok_abc/payments/42/receipt');
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('file')).toBe(file);
    });
  });

  describe('createPaypalOrder', () => {
    it('posts to guest-portal/booking/<token>/payments/paypal/create-order', async () => {
      const response = { order_id: 'ord_1', payment_id: 9 };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.createPaypalOrder('tok_abc');

      expect(post).toHaveBeenCalledWith('guest-portal/booking/tok_abc/payments/paypal/create-order');
      expect(result).toEqual(response);
    });
  });

  describe('capturePaypalOrder', () => {
    it('posts order_id and payment_id as json to guest-portal/booking/<token>/payments/paypal/capture', async () => {
      const response = { payment_id: 9, status: 'completed', booking_status: 'confirmed' };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestPortalService.capturePaypalOrder('tok_abc', 'ord_1', 9);

      expect(post).toHaveBeenCalledWith('guest-portal/booking/tok_abc/payments/paypal/capture', {
        json: { order_id: 'ord_1', payment_id: 9 },
      });
      expect(result).toEqual(response);
    });
  });
});
