import type { ReactNode } from 'react';
import type { BookingWithDetails, Company, Room } from '../../../types';
import { formatLocalDate, parseLocalDate } from '../../../utils/date';
import { isPositiveMoney, toMoneyNumber } from '../../../utils/money';

export type BookingView =
  | 'all'
  | 'arriving'
  | 'in_house'
  | 'departing'
  | 'upcoming'
  | 'balance'
  | 'normal_balance'
  | 'company_balance';

export type BookingCompanyOption = Partial<Company> & { company_name: string; id?: number };

export type SummaryStatCard = {
  title: string;
  value: string | number;
  detail: string;
  subValue?: number;
  color: string;
  icon: ReactNode;
  view: BookingView;
  alert?: boolean;
};

export const COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT = 1;

export function getErrorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export const addMonthsToDateOnly = (dateOnly: string, months: number) => {
  const base = parseLocalDate(dateOnly);
  const targetMonthIndex = base.getMonth() + months;
  const targetMonthStart = new Date(base.getFullYear(), targetMonthIndex, 1);
  const targetMonthDays = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();

  return formatLocalDate(new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(base.getDate(), targetMonthDays),
  ));
};

export const getDateOnly = (value?: string) => (value || '').split('T')[0];

export const getNights = (booking: BookingWithDetails | null) => {
  if (!booking?.check_in_date || !booking?.check_out_date) return 0;
  const checkIn = new Date(booking.check_in_date);
  const checkOut = new Date(booking.check_out_date);
  return Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
};

export const formatShortDate = (value?: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export const formatShortMonth = (value?: string) => {
  if (!value) return '-';
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return '-';
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

export const buildMonthOptions = (range = 12) => {
  const now = new Date();
  const options: { value: string; label: string }[] = [];
  for (let offset = -range; offset <= range; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    options.push({ value, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) });
  }
  return options;
};

export const formatOperationalDate = () =>
  new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).toUpperCase();

export const getGuestInitials = (name?: string) => {
  if (!name) return 'G';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

export const sortRoomsByNumber = (roomList: Room[]) =>
  [...roomList].sort((a, b) => {
    const numA = parseInt(a.room_number, 10);
    const numB = parseInt(b.room_number, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.room_number.localeCompare(b.room_number);
  });

export const getBookingBalance = (booking: BookingWithDetails | null) => toMoneyNumber(booking?.balance_due);
export const getBookingTotal = (booking: BookingWithDetails | null) => toMoneyNumber(booking?.total_amount);

export const isCompanyBooking = (booking: BookingWithDetails) =>
  Boolean(booking.company_id || booking.company_name?.trim());

export const getBillingChipLabel = (booking: BookingWithDetails) => {
  if (isCompanyBooking(booking)) return 'Company Billing';
  if (!booking.guest_type) return null;
  return booking.guest_type === 'non_member' ? 'Non-member' : 'Member';
};

export const hasOutstandingBalance = (booking: BookingWithDetails) =>
  booking.status !== 'voided' && isPositiveMoney(getBookingBalance(booking));

export const getKnownNightAuditDates = (booking: BookingWithDetails | null) => {
  if (!booking) return [];
  const dates = new Set<string>();
  if (booking.posted_date) dates.add(getDateOnly(booking.posted_date));
  return Array.from(dates).filter(Boolean).sort();
};

export const isNightAuditInvolved = (booking: BookingWithDetails | null) =>
  Boolean(booking?.is_posted || getKnownNightAuditDates(booking).length > 0);

export const isPastCheckoutWithBalance = (booking: BookingWithDetails, todayIso: string) => {
  const checkOutDate = getDateOnly(booking.check_out_date);
  return Boolean(checkOutDate) && checkOutDate < todayIso && hasOutstandingBalance(booking);
};

export const isCompanyPastTermsWithBalance = (booking: BookingWithDetails, todayIso: string) => {
  const checkOutDate = getDateOnly(booking.check_out_date);
  if (!checkOutDate || !hasOutstandingBalance(booking)) return false;

  return addMonthsToDateOnly(checkOutDate, COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT) <= todayIso;
};

export interface BookingViewSlices {
  arriving: BookingWithDetails[];
  departing: BookingWithDetails[];
  inHouse: BookingWithDetails[];
  upcoming: BookingWithDetails[];
  due: BookingWithDetails[];
  normalDue: BookingWithDetails[];
  companyDue: BookingWithDetails[];
}

export const getBookingViewSlices = (bookings: BookingWithDetails[], todayIso: string): BookingViewSlices => ({
  arriving: bookings.filter(
    (booking) => getDateOnly(booking.check_in_date) === todayIso
      && !['checked_in', 'checked_out', 'completed', 'voided'].includes(booking.status),
  ),
  departing: bookings.filter(
    (booking) => getDateOnly(booking.check_out_date) === todayIso && booking.status === 'checked_in',
  ),
  inHouse: bookings.filter((booking) => booking.status === 'checked_in'),
  upcoming: bookings.filter(
    (booking) => ['pending', 'confirmed'].includes(booking.status)
      && getDateOnly(booking.check_in_date) > todayIso,
  ),
  normalDue: bookings.filter(
    (booking) => !isCompanyBooking(booking) && isPastCheckoutWithBalance(booking, todayIso),
  ),
  companyDue: bookings.filter(
    (booking) => isCompanyBooking(booking) && isCompanyPastTermsWithBalance(booking, todayIso),
  ),
  due: bookings.filter(
    (booking) => (isCompanyBooking(booking)
      ? isCompanyPastTermsWithBalance(booking, todayIso)
      : isPastCheckoutWithBalance(booking, todayIso)),
  ),
});

// Helper function to determine if a booking can be checked in/out
export const canCheckIn = (booking: BookingWithDetails) => {
  const status = booking.status;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkInDate = new Date(booking.check_in_date);
  checkInDate.setHours(0, 0, 0, 0);

  // Allow check-in for confirmed/pending bookings on or after check-in date
  return (status === 'confirmed' || status === 'pending') && today >= checkInDate;
};

// True when checking in before the hotel's configured check-in time, i.e. the
// guest's scheduled check-in moment (arrival date at the configured time) has
// not yet passed. Used to surface an "early check-in" affordance.
export const isEarlyCheckIn = (booking: BookingWithDetails, checkInTime?: string) => {
  const configuredTime = checkInTime || '15:00';
  const [hours, minutes] = configuredTime.split(':').map(Number);
  const scheduledCheckIn = parseLocalDate(getDateOnly(booking.check_in_date));
  if (Number.isNaN(scheduledCheckIn.getTime())) return false;
  scheduledCheckIn.setHours(hours || 0, minutes || 0, 0, 0);
  return new Date() < scheduledCheckIn;
};

export const canCheckOut = (booking: BookingWithDetails) => booking.status === 'checked_in';

export const canVoid = (booking: BookingWithDetails) => booking.status !== 'voided';

// Releasing is for a hold that was never paid for. The backend enforces both
// halves of this (status and zero collected payments) and is authoritative;
// matching it here keeps the button off bookings it would only reject.
export const canRelease = (booking: BookingWithDetails) =>
  booking.status === 'pending_payment'
  && booking.payment_status !== 'partial'
  && booking.payment_status !== 'paid';

// Can reactivate only voided bookings
export const canReactivate = (booking: BookingWithDetails) => booking.status === 'voided';

export const statusDotColor = (status?: string) => {
  if (status === 'checked_in') return '#2f64b3';
  if (status === 'pending') return '#c47b1e';
  if (status === 'voided') return '#c43d32';
  if (status === 'checked_out' || status === 'completed') return '#6b7280';
  return '#3d8f6b';
};
