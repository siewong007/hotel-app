import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildKyHttpError } from './testSupport/httpError';

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

    const result = await InvoicesService.revertDepositRefund(42, 'keyed wrong guest');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('payments/revert-deposit-refund/42', {
      json: { reason: 'keyed wrong guest' },
    });
    expect(result).toEqual(responsePayload);
  });

  it('accepts a string booking id and builds the right URL', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ deposit_refunded: false }) });

    await InvoicesService.revertDepositRefund('99', 'keyed wrong guest');

    expect(post).toHaveBeenCalledWith('payments/revert-deposit-refund/99', {
      json: { reason: 'keyed wrong guest' },
    });
  });

  it('surfaces backend error messages as an APIError', async () => {
    const httpError = buildKyHttpError(400, { error: 'No deposit refund to revert' });
    post.mockReturnValue({ json: () => Promise.reject(httpError) });

    await expect(InvoicesService.revertDepositRefund(42, 'keyed wrong guest')).rejects.toMatchObject({
      message: 'No deposit refund to revert',
      statusCode: 400,
    });
    await expect(InvoicesService.revertDepositRefund(42, 'keyed wrong guest')).rejects.toBeInstanceOf(APIError);
  });

  it('throws a generic APIError on non-HTTP failures', async () => {
    post.mockReturnValue({ json: () => Promise.reject(new Error('network down')) });

    await expect(InvoicesService.revertDepositRefund(42, 'keyed wrong guest')).rejects.toMatchObject({
      message: 'Something went wrong. Please try again.',
    });
  });
});

describe('InvoicesService.revertDepositVoid', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('POSTs to the revert-deposit-void endpoint for the booking', async () => {
    const responsePayload = {
      booking_id: 42,
      reverted_payment_id: 7,
      deposit_restored: true,
    };
    post.mockReturnValue({ json: () => Promise.resolve(responsePayload) });

    const result = await InvoicesService.revertDepositVoid(42, 'deposit was collected');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('payments/revert-deposit-void/42', {
      json: { reason: 'deposit was collected' },
    });
    expect(result).toEqual(responsePayload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    const httpError = buildKyHttpError(400, { error: 'No voided deposit to revert' });
    post.mockReturnValue({ json: () => Promise.reject(httpError) });

    await expect(InvoicesService.revertDepositVoid(42, 'deposit was collected')).rejects.toMatchObject({
      message: 'No voided deposit to revert',
      statusCode: 400,
    });
    await expect(InvoicesService.revertDepositVoid(42, 'deposit was collected')).rejects.toBeInstanceOf(APIError);
  });
});

describe('InvoicesService.voidPayment', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('POSTs the reason to the void endpoint — never a DELETE', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ success: true, voided_id: 5 }) });

    await InvoicesService.voidPayment(5, 'duplicate entry');

    expect(post).toHaveBeenCalledWith('payments/5/void', { json: { reason: 'duplicate entry' } });
  });

  it('surfaces the backend permission error', async () => {
    const httpError = buildKyHttpError(403, {
      error: 'Voiding a posted payment requires the payments:manage permission',
    });
    post.mockReturnValue({ json: () => Promise.reject(httpError) });

    await expect(InvoicesService.voidPayment(5, 'duplicate entry')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('InvoicesService.refundDeposit', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('always sends the mandatory note (trimmed)', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ id: 1 }) });

    await InvoicesService.refundDeposit(42, 'Cash', 50, { note: '  key returned  ' });

    expect(post).toHaveBeenCalledWith('payments/refund-deposit/42', {
      json: { payment_method: 'Cash', amount: 50, note: 'key returned' },
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
