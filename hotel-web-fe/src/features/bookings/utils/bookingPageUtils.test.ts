import { describe, expect, it } from 'vitest';
import type { BookingWithDetails } from '../../../types';
import {
  addMonthsToDateOnly,
  canCheckIn,
  canCheckOut,
  canReactivate,
  canRelease,
  canVoid,
  getBillingChipLabel,
  getBookingViewSlices,
  getDateOnly,
  getGuestInitials,
  getKnownNightAuditDates,
  getNights,
  hasOutstandingBalance,
  isCompanyBooking,
  isNightAuditInvolved,
  isPastCheckoutWithBalance,
} from './bookingPageUtils';

const booking = (overrides: Partial<BookingWithDetails>): BookingWithDetails =>
  ({ id: '0', status: 'confirmed', ...overrides }) as BookingWithDetails;

describe('date helpers', () => {
  it('strips the time portion from ISO values', () => {
    expect(getDateOnly('2026-03-04T15:00:00Z')).toBe('2026-03-04');
    expect(getDateOnly('2026-03-04')).toBe('2026-03-04');
    expect(getDateOnly(undefined)).toBe('');
  });

  it('counts nights between check-in and check-out, minimum 1', () => {
    expect(getNights(booking({ check_in_date: '2026-03-01', check_out_date: '2026-03-05' }))).toBe(4);
    expect(getNights(booking({ check_in_date: '2026-03-01', check_out_date: '2026-03-01' }))).toBe(1);
    expect(getNights(booking({}))).toBe(0);
    expect(getNights(null)).toBe(0);
  });

  it('adds months to a date-only string, clamping to month end', () => {
    expect(addMonthsToDateOnly('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDateOnly('2026-03-15', 1)).toBe('2026-04-15');
    expect(addMonthsToDateOnly('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('getGuestInitials', () => {
  it('derives initials from first and last name parts', () => {
    expect(getGuestInitials('Alice Tan')).toBe('AT');
    expect(getGuestInitials('madonna')).toBe('MA');
    expect(getGuestInitials('Ahmad Bin Said')).toBe('AS');
    expect(getGuestInitials('')).toBe('G');
    expect(getGuestInitials(undefined)).toBe('G');
  });
});

describe('billing and balance predicates', () => {
  it('detects company billing from id or name', () => {
    expect(isCompanyBooking(booking({ company_id: 5 }))).toBe(true);
    expect(isCompanyBooking(booking({ company_name: ' Acme ' }))).toBe(true);
    expect(isCompanyBooking(booking({ company_name: '  ' }))).toBe(false);
    expect(isCompanyBooking(booking({}))).toBe(false);
  });

  it('labels billing chips', () => {
    expect(getBillingChipLabel(booking({ company_id: 1 }))).toBe('Company Billing');
    expect(getBillingChipLabel(booking({ guest_type: 'non_member' }))).toBe('Non-member');
    expect(getBillingChipLabel(booking({ guest_type: 'member' }))).toBe('Member');
    expect(getBillingChipLabel(booking({}))).toBeNull();
  });

  it('treats voided bookings as having no outstanding balance', () => {
    expect(hasOutstandingBalance(booking({ status: 'confirmed', balance_due: 100 }))).toBe(true);
    expect(hasOutstandingBalance(booking({ status: 'voided', balance_due: 100 }))).toBe(false);
    expect(hasOutstandingBalance(booking({ status: 'confirmed', balance_due: 0 }))).toBe(false);
  });
});

describe('action guards', () => {
  const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const nextYear = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('allows check-in only for confirmed/pending on or after the check-in date', () => {
    expect(canCheckIn(booking({ status: 'confirmed', check_in_date: yesterday() }))).toBe(true);
    expect(canCheckIn(booking({ status: 'pending', check_in_date: yesterday() }))).toBe(true);
    expect(canCheckIn(booking({ status: 'confirmed', check_in_date: nextYear() }))).toBe(false);
    expect(canCheckIn(booking({ status: 'checked_in', check_in_date: yesterday() }))).toBe(false);
    expect(canCheckIn(booking({ status: 'voided', check_in_date: yesterday() }))).toBe(false);
  });

  it('guards checkout, void, release, and reactivate by status', () => {
    expect(canCheckOut(booking({ status: 'checked_in' }))).toBe(true);
    expect(canCheckOut(booking({ status: 'confirmed' }))).toBe(false);

    expect(canVoid(booking({ status: 'confirmed' }))).toBe(true);
    expect(canVoid(booking({ status: 'voided' }))).toBe(false);

    expect(canRelease(booking({ status: 'pending_payment', payment_status: 'unpaid' }))).toBe(true);
    expect(canRelease(booking({ status: 'pending_payment', payment_status: 'partial' }))).toBe(false);
    expect(canRelease(booking({ status: 'confirmed', payment_status: 'unpaid' }))).toBe(false);

    expect(canReactivate(booking({ status: 'voided' }))).toBe(true);
    expect(canReactivate(booking({ status: 'confirmed' }))).toBe(false);
  });
});

describe('night audit involvement', () => {
  it('flags posted bookings or bookings with known audit dates', () => {
    expect(isNightAuditInvolved(booking({ is_posted: true }))).toBe(true);
    expect(isNightAuditInvolved(booking({ posted_date: '2026-03-01T00:00:00Z' }))).toBe(true);
    expect(isNightAuditInvolved(booking({}))).toBe(false);
    expect(isNightAuditInvolved(null)).toBe(false);
    expect(getKnownNightAuditDates(booking({ posted_date: '2026-03-01T10:00:00Z' }))).toEqual(['2026-03-01']);
  });
});

describe('overdue balance slices', () => {
  const today = '2026-03-10';
  const past = '2026-03-01';
  const oldEnough = '2026-01-01';
  const future = '2026-04-01';

  it('flags normal bookings past checkout with balance', () => {
    const b = booking({ status: 'checked_out', check_out_date: past, balance_due: 50 });
    expect(isPastCheckoutWithBalance(b, today)).toBe(true);
    expect(isPastCheckoutWithBalance(booking({ status: 'checked_out', check_out_date: future, balance_due: 50 }), today)).toBe(false);
    expect(isPastCheckoutWithBalance(booking({ status: 'checked_out', check_out_date: past, balance_due: 0 }), today)).toBe(false);
    expect(isPastCheckoutWithBalance(booking({ status: 'voided', check_out_date: past, balance_due: 50 }), today)).toBe(false);
  });

  it('slices bookings into operational views', () => {
    const list = [
      booking({ id: 'arr', status: 'confirmed', check_in_date: today, check_out_date: future }),
      booking({ id: 'inhouse', status: 'checked_in', check_in_date: past, check_out_date: today }),
      booking({ id: 'depart', status: 'checked_in', check_in_date: past, check_out_date: today }),
      booking({ id: 'up', status: 'confirmed', check_in_date: future, check_out_date: '2026-04-05' }),
      booking({ id: 'ndue', status: 'checked_out', check_out_date: past, balance_due: 10 }),
      booking({ id: 'cdue', status: 'checked_out', check_out_date: oldEnough, balance_due: 20, company_id: 3 }),
      booking({ id: 'voided', status: 'voided', check_in_date: today }),
    ];
    const slices = getBookingViewSlices(list, today);
    expect(slices.arriving.map((b) => b.id)).toEqual(['arr']);
    expect(slices.inHouse.map((b) => b.id)).toEqual(['inhouse', 'depart']);
    expect(slices.departing.map((b) => b.id)).toEqual(['inhouse', 'depart']);
    expect(slices.upcoming.map((b) => b.id)).toEqual(['up']);
    expect(slices.normalDue.map((b) => b.id)).toEqual(['ndue']);
    // Company booking only 2 months past checkout qualifies for company_due
    expect(slices.companyDue.map((b) => b.id)).toEqual(['cdue']);
    expect(slices.due.map((b) => b.id)).toEqual(['ndue', 'cdue']);
  });
});
