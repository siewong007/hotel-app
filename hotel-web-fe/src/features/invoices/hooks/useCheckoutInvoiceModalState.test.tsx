// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { BookingWithDetails } from '../../../types';

// Mock the specific service import the hook calls into, mirroring the
// convention in src/api/invoices.service.test.ts.
const recordPayment = vi.fn();
const deletePayment = vi.fn();

vi.mock('../../../api/invoices.service', () => ({
  InvoicesService: {
    recordPayment: (...args: any[]) => recordPayment(...args),
    deletePayment: (...args: any[]) => deletePayment(...args),
  },
}));

import { useCheckoutInvoiceModalState } from './useCheckoutInvoiceModalState';

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '7',
    booking_number: 'B-0007',
    guest_id: 'g-1',
    guest_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    room_id: 'r-1',
    room_number: '101',
    room_type: 'Deluxe',
    check_in_date: '2026-07-10T00:00:00.000Z',
    check_out_date: '2026-07-12T00:00:00.000Z',
    total_amount: 250,
    price_per_night: 125,
    status: 'checked_in',
    payment_method: 'cash',
    ...overrides,
  } as BookingWithDetails;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateQueries };
}

/**
 * Builds the hook's props. `setPayments`/`setDepositRefunded` etc. are plain
 * spies (matching how the real parent, CheckoutInvoiceModal, hands its
 * useState setters down as props) — tests inspect the functional updater
 * passed to them rather than re-rendering with updated state.
 */
function buildProps(overrides: Record<string, any> = {}) {
  return {
    booking: buildBooking(),
    open: true,
    onConfirmCheckout: vi.fn().mockResolvedValue(undefined),
    payments: [] as any[],
    setPayments: vi.fn(),
    depositRefunded: false,
    setDepositRefunded: vi.fn(),
    editableDailyRates: {},
    setEditableDailyRates: vi.fn(),
    reloadPayments: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('useCheckoutInvoiceModalState', () => {
  beforeEach(() => {
    recordPayment.mockReset();
    deletePayment.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes initial balance/payment state and pre-fills the payment amount', () => {
    const { wrapper } = createWrapper();
    const props = buildProps();

    const { result } = renderHook(() => useCheckoutInvoiceModalState(props), { wrapper });

    expect(result.current.checkoutStep).toBe('preview');
    expect(result.current.totalPayments).toBe(0);
    expect(result.current.balanceDue).toBe(250);
    // The reset-on-open effect + the pre-fill-on-balance effect both run on
    // mount since open+booking are truthy from the start.
    expect(result.current.showPaymentForm).toBe(true);
    expect(result.current.paymentAmount).toBe(250);
    expect(result.current.paymentMethod).toBe('Cash');
  });

  it('handleRecordPayment records the payment, appends it, and invalidates dependent queries (high-value transition)', async () => {
    const { wrapper, invalidateQueries } = createWrapper();
    const newPayment = { id: 99, total_amount: 250, payment_status: 'completed' };
    recordPayment.mockResolvedValue(newPayment);

    const props = buildProps();
    const { result } = renderHook(() => useCheckoutInvoiceModalState(props), { wrapper });

    await act(async () => {
      await result.current.handleRecordPayment();
    });

    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 7,
        amount: 250,
        payment_method: 'Cash',
      }),
    );

    // setPayments was called with a functional updater that appends the new payment.
    expect(props.setPayments).toHaveBeenCalledTimes(1);
    const updater = props.setPayments.mock.calls[0][0];
    expect(updater([])).toEqual([newPayment]);

    // Form resets and the balance-affecting queries are invalidated.
    expect(result.current.showPaymentForm).toBe(false);
    expect(result.current.paymentAmount).toBe(0);
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: expect.arrayContaining(['invoices', 'preview', '7']) }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: expect.arrayContaining(['invoices', 'payments', '7']) }),
    );
  });

  it('does nothing when there is no booking (edge case: null booking)', async () => {
    const { wrapper } = createWrapper();
    const props = buildProps({ booking: null, open: false, payments: [] });

    const { result } = renderHook(() => useCheckoutInvoiceModalState(props), { wrapper });

    // balanceDue must not throw with a null booking, and defaults to 0.
    expect(result.current.balanceDue).toBe(0);
    expect(result.current.totalPayments).toBe(0);
    // Neither reset-on-open nor pre-fill effects run without a booking.
    expect(result.current.showPaymentForm).toBe(false);
    expect(result.current.paymentAmount).toBe(0);

    await act(async () => {
      await result.current.handleRecordPayment();
    });

    expect(recordPayment).not.toHaveBeenCalled();
    expect(props.setPayments).not.toHaveBeenCalled();
  });

  it('handleDeletePayment is a no-op when the user cancels the confirm dialog (edge case)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { wrapper } = createWrapper();
    const props = buildProps({ payments: [{ id: 1, payment_status: 'completed', total_amount: 100 }] });

    const { result } = renderHook(() => useCheckoutInvoiceModalState(props), { wrapper });

    await act(async () => {
      await result.current.handleDeletePayment(1);
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deletePayment).not.toHaveBeenCalled();
    expect(props.setPayments).not.toHaveBeenCalled();
  });
});
