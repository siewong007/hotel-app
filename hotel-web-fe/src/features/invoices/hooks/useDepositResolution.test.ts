// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingWithDetails } from '../../../types';
import type { CheckoutPaymentRecord } from '../types';

// Mock the api barrel + invoices service module the hook calls into,
// following the shared hook-test mocking convention.
const mocks = vi.hoisted(() => ({
  updateBooking: vi.fn(),
  refundDeposit: vi.fn(),
  forfeitDeposit: vi.fn(),
  deletePayment: vi.fn(),
  revertDepositRefund: vi.fn(),
  revertDepositVoid: vi.fn(),
}));

vi.mock('../../../api', () => ({
  BookingsService: {
    updateBooking: (...args: unknown[]) => mocks.updateBooking(...args),
  },
}));

vi.mock('../../../api/invoices.service', () => ({
  InvoicesService: {
    refundDeposit: (...args: unknown[]) => mocks.refundDeposit(...args),
    forfeitDeposit: (...args: unknown[]) => mocks.forfeitDeposit(...args),
    deletePayment: (...args: unknown[]) => mocks.deletePayment(...args),
    revertDepositRefund: (...args: unknown[]) => mocks.revertDepositRefund(...args),
    revertDepositVoid: (...args: unknown[]) => mocks.revertDepositVoid(...args),
  },
}));

import { useDepositResolution } from './useDepositResolution';

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '42',
    booking_number: 'BK-42',
    guest_id: '7',
    guest_name: 'Jane Doe',
    room_id: '101',
    room_number: '101',
    room_type: 'Deluxe',
    check_in_date: '2026-08-01T00:00:00.000Z',
    check_out_date: '2026-08-02T00:00:00.000Z',
    total_amount: 100,
    price_per_night: 100,
    status: 'checked_in',
    deposit_paid: false,
    deposit_amount: 0,
    ...overrides,
  } as BookingWithDetails;
}

function buildPayment(overrides: Partial<CheckoutPaymentRecord> = {}): CheckoutPaymentRecord {
  return {
    id: 1,
    payment_status: 'completed',
    payment_type: 'deposit',
    total_amount: 50,
    payment_method: 'cash',
    payment_date: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

interface RenderOptions {
  booking?: BookingWithDetails | null;
  payments?: CheckoutPaymentRecord[];
  depositWaived?: boolean;
}

function renderResolution({ booking = buildBooking(), payments = [], depositWaived = false }: RenderOptions = {}) {
  const reloadPayments = vi.fn().mockResolvedValue(undefined);
  const setError = vi.fn();
  const invalidateInvoiceState = vi.fn();
  const view = renderHook(() =>
    useDepositResolution({
      booking,
      payments,
      reloadPayments,
      setError,
      invalidateInvoiceState,
      depositWaived,
    }),
  );
  return { ...view, reloadPayments, setError, invalidateInvoiceState };
}

describe('useDepositResolution', () => {
  beforeEach(() => {
    mocks.updateBooking.mockReset().mockResolvedValue({});
    mocks.refundDeposit.mockReset().mockResolvedValue({ id: 9, payment_status: 'refunded', payment_type: 'refund' });
    mocks.forfeitDeposit.mockReset().mockResolvedValue({ id: 10, payment_status: 'completed', payment_type: 'deposit_forfeited' });
    mocks.deletePayment.mockReset().mockResolvedValue({});
    mocks.revertDepositRefund.mockReset().mockResolvedValue({});
    mocks.revertDepositVoid.mockReset().mockResolvedValue({});
  });

  describe('derivation', () => {
    it('reports status none when nothing is recorded', () => {
      const { result } = renderResolution();
      expect(result.current.deposit).toEqual({
        collected: 0,
        refunded: 0,
        forfeited: 0,
        remaining: 0,
        method: null,
        collectedAt: null,
        status: 'none',
        voidedDepositCount: 0,
        mirrorDue: 0,
      });
    });

    it('is pending while a completed deposit row still has money held', () => {
      const { result } = renderResolution({
        payments: [buildPayment({ id: 5, payment_method: 'bank_transfer' })],
      });
      expect(result.current.deposit.status).toBe('pending');
      expect(result.current.deposit.collected).toBe(50);
      expect(result.current.deposit.remaining).toBe(50);
      expect(result.current.deposit.method).toBe('bank_transfer');
      expect(result.current.deposit.collectedAt).toBe('2026-08-01T10:00:00.000Z');
    });

    it('is pending via the booking mirror for a flag-only legacy deposit', () => {
      const { result } = renderResolution({
        booking: buildBooking({ deposit_paid: true, deposit_amount: 50 }),
      });
      expect(result.current.deposit.status).toBe('pending');
      expect(result.current.deposit.collected).toBe(0);
      expect(result.current.deposit.mirrorDue).toBe(50);
    });

    it('is refunded when the collected deposit was fully refunded', () => {
      const { result } = renderResolution({
        payments: [
          buildPayment({ id: 1 }),
          buildPayment({ id: 2, payment_type: 'refund', payment_status: 'refunded' }),
        ],
      });
      expect(result.current.deposit.status).toBe('refunded');
      expect(result.current.deposit.refunded).toBe(50);
      expect(result.current.deposit.remaining).toBe(0);
    });

    it('is forfeited when the whole deposit was kept', () => {
      const { result } = renderResolution({
        payments: [
          buildPayment({ id: 1 }),
          buildPayment({ id: 2, payment_type: 'deposit_forfeited' }),
        ],
      });
      expect(result.current.deposit.status).toBe('forfeited');
      expect(result.current.deposit.forfeited).toBe(50);
      expect(result.current.deposit.remaining).toBe(0);
    });

    it('is partially_forfeited when refund and forfeit rows split the deposit', () => {
      const { result } = renderResolution({
        payments: [
          buildPayment({ id: 1, total_amount: 100 }),
          buildPayment({ id: 2, payment_type: 'refund', payment_status: 'refunded', total_amount: 30 }),
          buildPayment({ id: 3, payment_type: 'deposit_forfeited', total_amount: 70 }),
        ],
      });
      expect(result.current.deposit.status).toBe('partially_forfeited');
      expect(result.current.deposit.refunded).toBe(30);
      expect(result.current.deposit.forfeited).toBe(70);
      expect(result.current.deposit.remaining).toBe(0);
    });

    it('stays pending while a partial forfeit leaves money held', () => {
      const { result } = renderResolution({
        payments: [
          buildPayment({ id: 1 }),
          buildPayment({ id: 2, payment_type: 'deposit_forfeited', total_amount: 20 }),
        ],
      });
      expect(result.current.deposit.status).toBe('pending');
      expect(result.current.deposit.forfeited).toBe(20);
      expect(result.current.deposit.remaining).toBe(30);
    });

    it('is cancelled when only voided deposit rows remain', () => {
      const { result } = renderResolution({
        payments: [
          buildPayment({ id: 1, payment_status: 'void' }),
          buildPayment({ id: 2, payment_status: 'void' }),
        ],
      });
      expect(result.current.deposit.status).toBe('cancelled');
      expect(result.current.deposit.voidedDepositCount).toBe(2);
      expect(result.current.deposit.collected).toBe(0);
    });

    it('is waived when the caller reports the booking mirror was waived — even while the stale mirror still reads due', () => {
      const { result } = renderResolution({
        booking: buildBooking({ deposit_paid: true, deposit_amount: 50 }),
        depositWaived: true,
      });
      expect(result.current.deposit.status).toBe('waived');
    });

    it('a voided refund row no longer counts as refunded (revert-refund state)', () => {
      const { result } = renderResolution({
        payments: [
          buildPayment({ id: 1 }),
          buildPayment({ id: 2, payment_type: 'refund', payment_status: 'void' }),
        ],
      });
      expect(result.current.deposit.status).toBe('pending');
      expect(result.current.deposit.refunded).toBe(0);
      expect(result.current.deposit.remaining).toBe(50);
    });

    it('prefers pending over cancelled when the mirror still asserts a due deposit', () => {
      // Voided rows exist but the booking mirror still claims money held —
      // the backend checkout gate also reads max(collected, mirror), so the
      // deposit still needs resolution.
      const { result } = renderResolution({
        booking: buildBooking({ deposit_paid: true, deposit_amount: 50 }),
        payments: [buildPayment({ id: 1, payment_status: 'void' })],
      });
      expect(result.current.deposit.status).toBe('pending');
      expect(result.current.deposit.voidedDepositCount).toBe(1);
    });
  });

  describe('refund', () => {
    it('sends method/reference/note to the service, then reloads payments and invalidates', async () => {
      const { result, reloadPayments, setError, invalidateInvoiceState } = renderResolution({
        payments: [buildPayment({ id: 1 })],
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.refund({ method: 'card', reference: 'RF-9001', note: 'handed to guest at desk' });
      });

      expect(ok).toBe(true);
      expect(mocks.refundDeposit).toHaveBeenCalledWith('42', 'card', 50, {
        transaction_reference: 'RF-9001',
        note: 'handed to guest at desk',
      });
      // Rows already cover the held deposit — no mirror assertion needed.
      expect(mocks.updateBooking).not.toHaveBeenCalled();
      expect(reloadPayments).toHaveBeenCalledTimes(1);
      expect(invalidateInvoiceState).toHaveBeenCalledTimes(1);
      expect(setError).toHaveBeenCalledWith('');
    });

    it('mints the missing deposit row before refunding a flag-only legacy deposit', async () => {
      const { result } = renderResolution({
        booking: buildBooking({ deposit_paid: true, deposit_amount: 50 }),
      });

      await act(async () => {
        await result.current.refund({ method: 'cash' });
      });

      expect(mocks.updateBooking).toHaveBeenCalledWith('42', {
        deposit_paid: true,
        deposit_amount: 50,
      });
      // The refund draws on the just-minted row — the collection assertion
      // must land first so the refundable ceiling sees the deposit.
      expect(mocks.updateBooking.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.refundDeposit.mock.invocationCallOrder[0]);
      expect(mocks.refundDeposit).toHaveBeenCalledWith('42', 'cash', 50, {
        transaction_reference: undefined,
        note: undefined,
      });
    });

    it('surfaces the service error and returns false when the refund fails', async () => {
      mocks.refundDeposit.mockRejectedValue(new Error('Deposit already refunded'));
      const { result, setError, reloadPayments } = renderResolution({
        payments: [buildPayment({ id: 1 })],
      });

      let ok = true;
      await act(async () => {
        ok = await result.current.refund({ method: 'cash' });
      });

      expect(ok).toBe(false);
      expect(setError).toHaveBeenLastCalledWith('Deposit already refunded');
      expect(reloadPayments).not.toHaveBeenCalled();
    });

    it('is a no-op when nothing is refundable', async () => {
      const { result } = renderResolution();
      await act(async () => {
        expect(await result.current.refund({ method: 'cash' })).toBe(false);
      });
      expect(mocks.refundDeposit).not.toHaveBeenCalled();
    });
  });

  describe('forfeit', () => {
    it('forfeits the deposit with reason and optional notes', async () => {
      const { result, reloadPayments, invalidateInvoiceState } = renderResolution({
        payments: [buildPayment({ id: 1 })],
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.forfeit({ amount: 20, reason: 'Room damage', notes: 'broken lamp, photo on file' });
      });

      expect(ok).toBe(true);
      expect(mocks.forfeitDeposit).toHaveBeenCalledWith('42', 20, 'Room damage', 'broken lamp, photo on file');
      expect(reloadPayments).toHaveBeenCalledTimes(1);
      expect(invalidateInvoiceState).toHaveBeenCalledTimes(1);
    });

    it('refuses an over-ceiling forfeit locally instead of relying on the backend 400', async () => {
      const { result, setError } = renderResolution({
        payments: [buildPayment({ id: 1 })],
      });

      let ok = true;
      await act(async () => {
        ok = await result.current.forfeit({ amount: 60, reason: 'Room damage' });
      });

      expect(ok).toBe(false);
      expect(mocks.forfeitDeposit).not.toHaveBeenCalled();
      expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('refundable deposit'));
    });

    it('requires a reason before forfeiting', async () => {
      const { result } = renderResolution({
        payments: [buildPayment({ id: 1 })],
      });

      await act(async () => {
        expect(await result.current.forfeit({ amount: 50, reason: '   ' })).toBe(false);
      });
      expect(mocks.forfeitDeposit).not.toHaveBeenCalled();
    });
  });

  describe('cancelUncollected', () => {
    it('waives a mirror-only deposit through updateBooking, appending the waived note vocabulary', async () => {
      const { result, invalidateInvoiceState } = renderResolution({
        booking: buildBooking({ deposit_paid: true, deposit_amount: 50, payment_note: 'Guest VIP' }),
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.cancelUncollected('recorded in error');
      });

      expect(ok).toBe(true);
      expect(mocks.updateBooking).toHaveBeenCalledWith('42', {
        deposit_paid: false,
        deposit_amount: 0,
        payment_note: 'Guest VIP | Deposit waived: recorded in error',
      });
      expect(mocks.deletePayment).not.toHaveBeenCalled();
      expect(invalidateInvoiceState).toHaveBeenCalledTimes(1);
    });

    it('waives with a bare note when no payment_note exists yet', async () => {
      const { result } = renderResolution({
        booking: buildBooking({ deposit_paid: true, deposit_amount: 50 }),
      });

      await act(async () => {
        await result.current.cancelUncollected('lost keycard');
      });

      expect(mocks.updateBooking).toHaveBeenCalledWith('42', {
        deposit_paid: false,
        deposit_amount: 0,
        payment_note: 'Deposit waived: lost keycard',
      });
    });

    it('voids each completed deposit row when payment rows back the deposit', async () => {
      const { result, reloadPayments } = renderResolution({
        payments: [
          buildPayment({ id: 1 }),
          buildPayment({ id: 2, total_amount: 20 }),
          // Already-voided rows are not re-voided.
          buildPayment({ id: 3, payment_status: 'void' }),
        ],
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.cancelUncollected('never collected');
      });

      expect(ok).toBe(true);
      expect(mocks.deletePayment).toHaveBeenCalledTimes(2);
      expect(mocks.deletePayment).toHaveBeenNthCalledWith(1, 1);
      expect(mocks.deletePayment).toHaveBeenNthCalledWith(2, 2);
      expect(mocks.updateBooking).not.toHaveBeenCalled();
      expect(reloadPayments).toHaveBeenCalledTimes(1);
    });
  });

  describe('revertRefund / restoreDeposit', () => {
    it('reverts the deposit refund through the service', async () => {
      const { result, reloadPayments } = renderResolution({
        payments: [
          buildPayment({ id: 1 }),
          buildPayment({ id: 2, payment_type: 'refund', payment_status: 'refunded' }),
        ],
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.revertRefund();
      });

      expect(ok).toBe(true);
      expect(mocks.revertDepositRefund).toHaveBeenCalledWith('42');
      expect(reloadPayments).toHaveBeenCalledTimes(1);
    });

    it('restores voided deposit rows through the service', async () => {
      const { result, reloadPayments } = renderResolution({
        payments: [buildPayment({ id: 1, payment_status: 'void' })],
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.restoreDeposit();
      });

      expect(ok).toBe(true);
      expect(mocks.revertDepositVoid).toHaveBeenCalledWith('42');
      expect(reloadPayments).toHaveBeenCalledTimes(1);
    });
  });

  describe('guards', () => {
    it('is a no-op without a booking', async () => {
      const { result } = renderResolution({ booking: null });

      await act(async () => {
        expect(await result.current.refund({ method: 'cash' })).toBe(false);
        expect(await result.current.forfeit({ amount: 10, reason: 'x' })).toBe(false);
        expect(await result.current.cancelUncollected('x')).toBe(false);
        expect(await result.current.revertRefund()).toBe(false);
        expect(await result.current.restoreDeposit()).toBe(false);
      });

      expect(mocks.refundDeposit).not.toHaveBeenCalled();
      expect(mocks.forfeitDeposit).not.toHaveBeenCalled();
      expect(mocks.deletePayment).not.toHaveBeenCalled();
      expect(mocks.updateBooking).not.toHaveBeenCalled();
      expect(mocks.revertDepositRefund).not.toHaveBeenCalled();
      expect(mocks.revertDepositVoid).not.toHaveBeenCalled();
    });

    it('tracks the busy flag for the duration of the action', async () => {
      let resolveRefund: (value: unknown) => void = () => {};
      mocks.refundDeposit.mockReturnValue(new Promise((resolve) => { resolveRefund = resolve; }));
      const { result } = renderResolution({
        payments: [buildPayment({ id: 1 })],
      });

      let pending: Promise<boolean> | undefined;
      act(() => {
        pending = result.current.refund({ method: 'cash' });
      });
      expect(result.current.refunding).toBe(true);

      await act(async () => {
        resolveRefund({ id: 9 });
        await pending;
      });
      expect(result.current.refunding).toBe(false);
    });
  });
});
