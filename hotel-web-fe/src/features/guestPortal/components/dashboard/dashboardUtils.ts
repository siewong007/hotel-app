import { parseLocalDate } from '../../../../utils/date';
import { formatCurrency, getCurrentCurrency } from '../../../../utils/currency';
import { t as translate, type TranslationVars } from '../../../../i18n';
import type { GuestPortalMembershipActivity } from '../../../../types';
import { dateFormatter } from '../../../../i18n/format';

/** guestPortal-namespaced translate for the non-React helpers below. */
const pt = (key: string, vars?: TranslationVars): string =>
  translate(key, vars, 'guestPortal');

export const PORTAL_SECTIONS = [
  'overview',
  'stays',
  'points-history',
  'offers',
  'vouchers',
  'credits',
  'identity',
  'profile',
  'security',
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
    return dateFormatter({
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(parseLocalDate(value));
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
  return fullName?.trim().split(/\s+/)[0] || pt('dashboard.nameFallback');
}

export function humanizePortalStatus(value: string | null | undefined): string {
  if (!value) return pt('dashboard.statusUnavailable');
  if (value.trim().toLowerCase() === 'voided') return pt('dashboard.statusCancelled');
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
      ? pt('dashboard.points.contextFromBooking', { number: bookingNumber })
      : pt('dashboard.points.contextBooking', { number: bookingNumber });
    return reason && activity.transaction_type !== 'earned'
      ? pt('dashboard.points.contextWithReason', { context: bookingContext, reason })
      : bookingContext;
  }

  if (activity.transaction_type === 'adjusted') {
    const adjustedBy = activity.adjusted_by?.trim();
    const adjustmentContext = adjustedBy
      ? pt('dashboard.points.contextAdjustedBy', { name: adjustedBy })
      : pt('dashboard.points.contextAdjustedByStaff');
    return reason
      ? pt('dashboard.points.contextWithReason', { context: adjustmentContext, reason })
      : adjustmentContext;
  }

  return reason || null;
}
