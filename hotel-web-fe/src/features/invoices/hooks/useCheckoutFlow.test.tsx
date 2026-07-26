// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingWithDetails, CustomerLedger } from '../../../types';

// Mock the HotelAPIService barrel the hook calls into, following the shared
// hook-test mocking convention.
const updateBooking = vi.fn();
const updateRoomStatus = vi.fn();

vi.mock('../../../api', () => ({
  HotelAPIService: {
    updateBooking: (...args: any[]) => updateBooking(...args),
    updateRoomStatus: (...args: any[]) => updateRoomStatus(...args),
  },
}));

import { useCheckoutFlow } from './useCheckoutFlow';

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

describe('useCheckoutFlow', () => {
  beforeEach(() => {
    updateBooking.mockReset().mockResolvedValue(undefined);
    updateRoomStatus.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens and closes the checkout modal, tracking the booking under edit', () => {
    const { result } = renderHook(() => useCheckoutFlow());
    const booking = buildBooking();

    expect(result.current.checkoutOpen).toBe(false);
    expect(result.current.checkoutBooking).toBeNull();

    act(() => result.current.openCheckout(booking));
    expect(result.current.checkoutOpen).toBe(true);
    expect(result.current.checkoutBooking).toBe(booking);

    act(() => result.current.closeCheckout());
    expect(result.current.checkoutOpen).toBe(false);
    expect(result.current.checkoutBooking).toBeNull();
  });

  it('opens the read-only receipt modal with an optional city-ledger, and clears it on close', () => {
    const { result } = renderHook(() => useCheckoutFlow());
    const booking = buildBooking();
    const ledger = { id: 55, company_name: 'Acme Corp' } as CustomerLedger;

    act(() => result.current.openReceipt(booking, ledger));
    expect(result.current.receiptOpen).toBe(true);
    expect(result.current.receiptBooking).toBe(booking);
    expect(result.current.receiptLedger).toBe(ledger);

    act(() => result.current.closeReceipt());
    expect(result.current.receiptOpen).toBe(false);
    expect(result.current.receiptBooking).toBeNull();
    expect(result.current.receiptLedger).toBeNull();
  });

  it('defaults receiptLedger to null when no ledger is passed (booking-billed checkout)', () => {
    const { result } = renderHook(() => useCheckoutFlow());
    act(() => result.current.openReceipt(buildBooking()));
    expect(result.current.receiptLedger).toBeNull();
  });

  it('is a no-op when confirming checkout without a booking under edit', async () => {
    const onAfterCheckout = vi.fn();
    const { result } = renderHook(() => useCheckoutFlow({ onAfterCheckout }));

    await act(async () => {
      await result.current.confirmCheckout();
    });

    expect(updateBooking).not.toHaveBeenCalled();
    expect(updateRoomStatus).not.toHaveBeenCalled();
    expect(onAfterCheckout).not.toHaveBeenCalled();
  });

  it('confirms checkout (high-value transition): marks the booking checked_out, dirties the room, notifies, and refreshes', async () => {
    const notify = vi.fn();
    const onAfterCheckout = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCheckoutFlow({ notify, onAfterCheckout }));
    const booking = buildBooking();

    act(() => result.current.openCheckout(booking));

    await act(async () => {
      await result.current.confirmCheckout({ penalty: 25, notes: 'Left at 2pm' }, 'Cash');
    });

    // Default updateBooking wiring stringifies the booking id.
    expect(updateBooking).toHaveBeenCalledWith('7', {
      status: 'checked_out',
      payment_method: 'Cash',
      late_checkout_penalty: 25,
      late_checkout_notes: 'Left at 2pm',
    });

    // setRoomDirty defaults to true and includes the late-checkout context in the notes.
    expect(updateRoomStatus).toHaveBeenCalledWith('r-1', {
      status: 'dirty',
      notes: expect.stringContaining('Late checkout penalty: 25'),
    });

    expect(notify).toHaveBeenCalledWith('Jane Doe checked out from Room 101', 'success');
    expect(onAfterCheckout).toHaveBeenCalledTimes(1);

    // The modal resets itself on success.
    expect(result.current.checkoutOpen).toBe(false);
    expect(result.current.checkoutBooking).toBeNull();
  });

  it('skips dirtying the room when setRoomDirty is false (e.g. the Bookings page, which lets the backend do it)', async () => {
    const { result } = renderHook(() => useCheckoutFlow({ setRoomDirty: false }));
    act(() => result.current.openCheckout(buildBooking()));

    await act(async () => {
      await result.current.confirmCheckout();
    });

    expect(updateBooking).toHaveBeenCalledWith('7', { status: 'checked_out' });
    expect(updateRoomStatus).not.toHaveBeenCalled();
  });

  it('omits late-checkout fields entirely when applyLateCheckout is false, even if data is supplied', async () => {
    const { result } = renderHook(() => useCheckoutFlow({ applyLateCheckout: false }));
    act(() => result.current.openCheckout(buildBooking()));

    await act(async () => {
      await result.current.confirmCheckout({ penalty: 25, notes: 'Left at 2pm' });
    });

    expect(updateBooking).toHaveBeenCalledWith('7', { status: 'checked_out' });
  });

  it('builds the plain "requires cleaning" note when there is no late-checkout data', async () => {
    const { result } = renderHook(() => useCheckoutFlow());
    act(() => result.current.openCheckout(buildBooking()));

    await act(async () => {
      await result.current.confirmCheckout();
    });

    expect(updateRoomStatus).toHaveBeenCalledWith('r-1', {
      status: 'dirty',
      notes: 'Room requires cleaning after checkout',
    });
  });

  it('uses a custom successMessage builder over the default notification text', async () => {
    const notify = vi.fn();
    const successMessage = vi.fn().mockReturnValue('Custom message');
    const { result } = renderHook(() => useCheckoutFlow({ notify, successMessage }));
    const booking = buildBooking();
    act(() => result.current.openCheckout(booking));

    await act(async () => {
      await result.current.confirmCheckout();
    });

    expect(successMessage).toHaveBeenCalledWith(booking, undefined);
    expect(notify).toHaveBeenCalledWith('Custom message', 'success');
  });

  it('routes the persistence call through an injected updateBooking (e.g. a react-query mutation) instead of the default API call', async () => {
    const injectedUpdate = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCheckoutFlow({ updateBooking: injectedUpdate, setRoomDirty: false }));
    act(() => result.current.openCheckout(buildBooking()));

    await act(async () => {
      await result.current.confirmCheckout();
    });

    expect(injectedUpdate).toHaveBeenCalledWith('7', { status: 'checked_out' });
    expect(updateBooking).not.toHaveBeenCalled();
  });

  it('re-throws a normalized error on failure (edge case) and leaves the modal open for the user to retry', async () => {
    updateBooking.mockRejectedValue(new Error('network down'));
    const onAfterCheckout = vi.fn();
    const { result } = renderHook(() => useCheckoutFlow({ onAfterCheckout }));
    act(() => result.current.openCheckout(buildBooking()));

    await act(async () => {
      await expect(result.current.confirmCheckout()).rejects.toThrow('network down');
    });

    expect(onAfterCheckout).not.toHaveBeenCalled();
    // The modal is NOT reset on failure so the user can see/retry it.
    expect(result.current.checkoutOpen).toBe(true);
    expect(result.current.checkoutBooking).not.toBeNull();
  });

  it('falls back to a generic error message when the underlying failure has none', async () => {
    updateBooking.mockRejectedValue({});
    const { result } = renderHook(() => useCheckoutFlow());
    act(() => result.current.openCheckout(buildBooking()));

    await act(async () => {
      await expect(result.current.confirmCheckout()).rejects.toThrow('Failed to process checkout');
    });
  });
});
