import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingWithDetails } from '../../../../types';
import { addLocalDays, formatLocalDate } from '../../../../utils/date';

// Phone branch: useIsPhone is the viewport predicate for both components under
// test (jsdom has no matchMedia) — pinned explicitly so a future global
// polyfill can't flip the branch.
const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('../../../../hooks/useIsPhone', () => ({
  useIsPhone: () => mocks.isPhone,
}));

vi.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (value: number) => `RM${Number(value).toFixed(2)}`, symbol: 'RM' }),
}));

import BookingListPanel from './BookingListPanel';
import BookingSummarySection, { type BookingSummaryStats } from './BookingSummarySection';

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '1',
    booking_number: 'BK-1001',
    folio_number: 'F-1001',
    guest_id: 'g-1',
    guest_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    room_id: 'r-101',
    room_number: '101',
    room_type: 'Deluxe',
    check_in_date: `${formatLocalDate(addLocalDays(new Date(), -1))}T00:00:00.000Z`,
    check_out_date: `${formatLocalDate(addLocalDays(new Date(), 2))}T00:00:00.000Z`,
    total_amount: 300,
    price_per_night: 150,
    status: 'confirmed',
    payment_status: 'unpaid',
    balance_due: 300,
    // source/guest_type/is_posted force the channel, billing and night-audit
    // chips on the desktop row so their absence on phone rows is meaningful.
    source: 'website',
    guest_type: 'member',
    is_posted: true,
    is_complimentary: false,
    deposit_paid: false,
    ...overrides,
  } as BookingWithDetails;
}

const booking = buildBooking();

const renderPanel = (bookings: BookingWithDetails[] = [booking]) => {
  const props = {
    bookings,
    loading: false,
    totalBookings: bookings.length,
    bookingView: 'all' as const,
    onOpenBooking: vi.fn(),
    sortField: 'check_in_date' as const,
    onToggleSort: vi.fn(),
    pagination: {
      hasMultiplePages: false,
      startItem: 1,
      endItem: bookings.length,
      totalItems: bookings.length,
      totalPages: 1,
      currentPage: 1,
    },
    onPageChange: vi.fn(),
  };
  render(<BookingListPanel {...props} />);
  return props;
};

const buildStats = (overrides: Partial<BookingSummaryStats> = {}): BookingSummaryStats => ({
  arrivingCount: 2,
  readyToCheckInCount: 1,
  todayCheckIns: 0,
  totalGuestsInHouse: 5,
  inHouseCount: 3,
  roomCount: 20,
  departingCount: 1,
  upcomingCount: 3,
  normalOutstandingDue: 120,
  normalDueCount: 1,
  normalBalanceScope: 'bookings past checkout',
  companyOutstandingDue: 450,
  companyDueCount: 2,
  companyBalanceScope: 'companies past terms',
  ...overrides,
});

const renderSummary = (stats: BookingSummaryStats = buildStats()) => {
  const props = {
    stats,
    activeView: 'all' as const,
    onSelectView: vi.fn(),
    onTakePayment: vi.fn(),
  };
  render(<BookingSummarySection {...props} />);
  return props;
};

beforeEach(() => {
  mocks.isPhone = false;
});

afterEach(cleanup);

describe('BookingListPanel phone rows', () => {
  it('renders guest name, room line and status, and drops channel/billing/night-audit chips and the folio', () => {
    mocks.isPhone = true;
    renderPanel();

    expect(screen.getByText('Jane Doe')).toBeDefined();
    expect(screen.getByText(/Room 101 · Deluxe · .+ · 3N/)).toBeDefined();
    expect(screen.getByText('• Confirmed')).toBeDefined();
    expect(screen.getByText('RM300.00')).toBeDefined();
    expect(screen.getByText('Due RM300.00')).toBeDefined();

    // Phone rows intentionally omit the desktop-only affordances; they remain
    // reachable on the booking detail page.
    expect(screen.queryByText('DW')).toBeNull(); // "Direct Website" channel chip
    expect(screen.queryByText('Member')).toBeNull(); // billing chip
    expect(screen.queryByText('Night audit')).toBeNull();
    expect(screen.queryByText('F-1001')).toBeNull(); // folio reference
  });

  it('calls onOpenBooking with the booking when the row is tapped', () => {
    mocks.isPhone = true;
    const props = renderPanel();

    fireEvent.click(screen.getByText('Jane Doe'));

    expect(props.onOpenBooking).toHaveBeenCalledTimes(1);
    expect(props.onOpenBooking).toHaveBeenCalledWith(booking);
  });

  it('keeps the desktop row unchanged off phones: chips and folio still render', () => {
    renderPanel();

    expect(screen.getByText('DW')).toBeDefined();
    expect(screen.getByText('Member')).toBeDefined();
    expect(screen.getByText('Night audit')).toBeDefined();
    expect(screen.getByText('F-1001')).toBeDefined();
  });

  it('sort button still toggles the sort field via onToggleSort', () => {
    mocks.isPhone = true;
    const props = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Sort: Priority/ }));

    expect(props.onToggleSort).toHaveBeenCalledTimes(1);
  });
});

describe('BookingSummarySection phone chips', () => {
  it('renders a compact chip per stat card, including the alert balances', () => {
    mocks.isPhone = true;
    renderSummary();

    expect(screen.getByText('Arriving 2')).toBeDefined();
    expect(screen.getByText('In-house 5')).toBeDefined();
    expect(screen.getByText('Departing 1')).toBeDefined();
    expect(screen.getByText('Upcoming 3')).toBeDefined();
    expect(screen.getByText('Due RM120.00')).toBeDefined();
    expect(screen.getByText('Company RM450.00')).toBeDefined();
    // Long card titles are desktop-only.
    expect(screen.queryByText('Arrivals / Check-in')).toBeNull();
    // The take-payment card still renders below the chip strip.
    expect(screen.getByText('Take payment')).toBeDefined();
  });

  it('selecting a chip routes to its booking view', () => {
    mocks.isPhone = true;
    const props = renderSummary();

    fireEvent.click(screen.getByText('Arriving 2'));
    expect(props.onSelectView).toHaveBeenCalledWith('arriving');

    fireEvent.click(screen.getByText('Due RM120.00'));
    expect(props.onSelectView).toHaveBeenCalledWith('normal_balance');
  });

  it('keeps the full stat cards off phones', () => {
    renderSummary();

    expect(screen.getByText('Arrivals / Check-in')).toBeDefined();
    expect(screen.getByText('Company outstanding')).toBeDefined();
    expect(screen.queryByText('Arriving 2')).toBeNull();
  });
});
