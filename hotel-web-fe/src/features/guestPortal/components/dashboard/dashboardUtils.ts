import { parseLocalDate } from '../../../../utils/date';
import { formatCurrency, getCurrentCurrency } from '../../../../utils/currency';
import type { GuestPortalMembershipActivity } from '../../../../types';

export const PORTAL_SECTIONS = [
  'overview',
  'stays',
  'points-history',
  'offers',
  'vouchers',
  'support',
  'preferences',
] as const;

export type PortalSection = (typeof PORTAL_SECTIONS)[number];

export function parsePortalSection(search: string): PortalSection {
  const section = new URLSearchParams(search).get('section');
  // Preserve links shared before the rewards catalog moved to Offers.
  if (section === 'rewards') return 'points-history';
  return PORTAL_SECTIONS.includes(section as PortalSection)
    ? (section as PortalSection)
    : 'overview';
}

export function formatPortalDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return parseLocalDate(value).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

export function formatPortalCurrency(value: string | number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : formatCurrency(value, getCurrentCurrency());
}

export function firstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || 'there';
}

export function humanizePortalStatus(value: string | null | undefined): string {
  if (!value) return 'Status unavailable';
  if (value.trim().toLowerCase() === 'voided') return 'Cancelled';
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function pointsActivityContext(
  activity: GuestPortalMembershipActivity,
): string | null {
  const reason = activity.reason?.trim();
  const bookingNumber = activity.booking_number?.trim();

  if (bookingNumber) {
    const bookingContext = activity.transaction_type === 'earned'
      ? `From booking ${bookingNumber}`
      : `Booking ${bookingNumber}`;
    return reason && activity.transaction_type !== 'earned'
      ? `${bookingContext}: ${reason}`
      : bookingContext;
  }

  if (activity.transaction_type === 'adjusted') {
    const adjustedBy = activity.adjusted_by?.trim();
    const adjustmentContext = adjustedBy
      ? `Adjusted by ${adjustedBy}`
      : 'Adjusted by hotel staff';
    return reason ? `${adjustmentContext}: ${reason}` : adjustmentContext;
  }

  return reason || null;
}
