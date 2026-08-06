import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPError } from 'ky';

// Mock the configured ky instance so no real HTTP happens.
const post = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: { post: (...args: any[]) => post(...args) },
  };
});

import { InvoicesService } from './invoices.service';
import { APIError } from './client';

describe('InvoicesService.revertDepositRefund', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('POSTs to the revert-deposit-refund endpoint for the booking', async () => {
    const responsePayload = {
      booking_id: 42,
      reverted_payment_id: 7,
      deposit_refunded: false,
    };
    post.mockReturnValue({ json: () => Promise.resolve(responsePayload) });

    const result = await InvoicesService.revertDepositRefund(42);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('payments/revert-deposit-refund/42');
    expect(result).toEqual(responsePayload);
  });

  it('accepts a string booking id and builds the right URL', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ deposit_refunded: false }) });

    await InvoicesService.revertDepositRefund('99');

    expect(post).toHaveBeenCalledWith('payments/revert-deposit-refund/99');
  });

  it('surfaces backend error messages as an APIError', async () => {
    const httpError = Object.create(HTTPError.prototype);
    httpError.response = {
      status: 400,
      json: () => Promise.resolve({ error: 'No deposit refund to revert' }),
    };
    post.mockReturnValue({ json: () => Promise.reject(httpError) });

    await expect(InvoicesService.revertDepositRefund(42)).rejects.toMatchObject({
      message: 'No deposit refund to revert',
      statusCode: 400,
    });
    await expect(InvoicesService.revertDepositRefund(42)).rejects.toBeInstanceOf(APIError);
  });

  it('throws a generic APIError on non-HTTP failures', async () => {
    post.mockReturnValue({ json: () => Promise.reject(new Error('network down')) });

    await expect(InvoicesService.revertDepositRefund(42)).rejects.toMatchObject({
      message: 'Failed to revert deposit refund',
    });
  });
});

describe('InvoicesService.recordPayment', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('forwards the caller-owned idempotency key unchanged', async () => {
    const input = {
      booking_id: 42,
      amount: 125,
      payment_method: 'cash',
      payment_type: 'booking',
      transaction_reference: 'terminal-42',
      notes: 'Paid at desk',
      payment_date: '2026-08-06',
      idempotency_key: 'booking-payment-attempt-1',
    };
    post.mockReturnValue({ json: () => Promise.resolve({ id: 7, ...input }) });

    await InvoicesService.recordPayment(input);

    expect(post).toHaveBeenCalledWith('payments/record-payment', {
      json: input,
    });
  });
});
