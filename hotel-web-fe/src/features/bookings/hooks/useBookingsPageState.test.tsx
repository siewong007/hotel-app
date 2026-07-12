// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { BookingWithDetails } from '../../../types';
import { API_NOTIFICATION_EVENT, type ApiNotificationDetail } from '../../../utils/apiNotifications';

// Mock the HotelAPIService barrel that the hook calls into, so no real HTTP
// happens. Everything else the hook imports (queryKeys, money utils,
// apiNotifications) is left real — those are pure/DOM-event based and are
// part of what we want to exercise.
const updateBooking = vi.fn();
const recordPayment = vi.fn();

vi.mock('../../../api', () => ({
  HotelAPIService: {
    updateBooking: (...args: any[]) => updateBooking(...args),
    voidBooking: () => Promise.resolve(),
    reactivateBooking: () => Promise.resolve(),
    markComplimentary: () => Promise.resolve(),
    recordPayment: (...args: any[]) => recordPayment(...args),
  },
}));

import { useBookingsPageState } from './useBookingsPageState';

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '42',
    booking_number: 'B-0042',
    guest_id: 'g-1',
    guest_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    room_id: 'r-1',
    room_number: '101',
    room_type: 'Deluxe',
    check_in_date: '2026-07-10T00:00:00.000Z',
    check_out_date: '2026-07-12T00:00:00.000Z',
    total_amount: 300,
    price_per_night: 150,
    status: 'confirmed',
    ...overrides,
  } as BookingWithDetails;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

describe('useBookingsPageState', () => {
  beforeEach(() => {
    updateBooking.mockReset();
    recordPayment.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with the expected initial state shape', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBookingsPageState(), { wrapper });

    expect(result.current.bookingView).toBe('all');
    expect(result.current.showCheckoutModal).toBe(false);
    expect(result.current.showCheckinModal).toBe(false);
    expect(result.current.editingBooking).toBeNull();
    expect(result.current.editFormData).toEqual({});
    expect(result.current.availableRooms).toEqual([]);
    expect(result.current.ciPaymentChoice).toBe('pay_later');
    expect(result.current.ciDepositChoice).toBe('receive');
    expect(result.current.paymentMethod).toBe('Cash');
    expect(result.current.updatingPayment).toBe(false);
  });

  it('handleEditBooking derives money-correct edit form state (high-value transition)', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBookingsPageState(), { wrapper });

    const booking = buildBooking({
      price_per_night: '150.505', // exercises money rounding, not a plain number
      extra_bed_count: 2,
      extra_bed_charge: '20.00',
      payment_method: 'credit_card',
      deposit_paid: undefined,
      check_in_date: '2026-07-10T14:00:00.000Z',
      check_out_date: '2026-07-12T11:00:00.000Z',
    });

    act(() => {
      result.current.handleEditBooking(booking);
    });

    expect(result.current.editDialogOpen).toBe(true);
    expect(result.current.editingBooking).toBe(booking);
    // toMoneyNumber rounds 150.505 -> 150.51 (round-half-up at the 3rd decimal)
    expect(result.current.editFormData.price_per_night).toBeCloseTo(150.51, 2);
    expect(result.current.editFormData.has_override).toBe(true);
    expect(result.current.editFormData.extra_bed_count).toBe(2);
    expect(result.current.editFormData.extra_bed_charge).toBe(20);
    expect(result.current.editFormData.payment_method).toBe('Credit Card');
    expect(result.current.editFormData.deposit_paid).toBe(false);
    expect(result.current.editFormData.check_in_date).toBe('2026-07-10');
    expect(result.current.editFormData.check_out_date).toBe('2026-07-12');
  });

  it('rejects a non-positive payment amount without calling the API (edge case)', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBookingsPageState(), { wrapper });

    const booking = buildBooking();
    act(() => {
      result.current.handleUpdatePaymentStatus(booking);
    });
    expect(result.current.paymentDialogOpen).toBe(true);
    // Default seeded amount from handleUpdatePaymentStatus is 0 (unset).
    expect(result.current.paymentAmount).toBe(0);

    const notifications: ApiNotificationDetail[] = [];
    const onNotification = (event: Event) => {
      notifications.push((event as CustomEvent<ApiNotificationDetail>).detail);
    };
    window.addEventListener(API_NOTIFICATION_EVENT, onNotification);

    await act(async () => {
      await result.current.handleConfirmPaymentUpdate();
    });

    window.removeEventListener(API_NOTIFICATION_EVENT, onNotification);

    expect(recordPayment).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      severity: 'error',
      message: 'Please enter a valid payment amount',
    });
    // Dialog stays open / unresolved on validation failure.
    expect(result.current.paymentDialogOpen).toBe(true);
  });
});
