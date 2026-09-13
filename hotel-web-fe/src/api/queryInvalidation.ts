import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

const invalidate = (queryClient: QueryClient, queryKey: QueryKey) => {
  void queryClient.invalidateQueries({ queryKey });
};

export function invalidateBookingDependencies(queryClient: QueryClient) {
  invalidate(queryClient, queryKeys.bookings.all);
  invalidate(queryClient, queryKeys.rooms.all);
  invalidate(queryClient, queryKeys.guests.all);
  invalidate(queryClient, queryKeys.nightAudit.all);
  invalidate(queryClient, queryKeys.audit.all);
  invalidate(queryClient, queryKeys.dashboard.all);
  invalidate(queryClient, queryKeys.analytics.all);
  invalidate(queryClient, queryKeys.invoices.all);
  invalidate(queryClient, queryKeys.complimentary.all);
  invalidate(queryClient, queryKeys.ledgers.all);
}

export function invalidateGuestDependencies(queryClient: QueryClient) {
  invalidate(queryClient, queryKeys.guests.all);
  invalidate(queryClient, queryKeys.bookings.all);
  invalidate(queryClient, queryKeys.audit.all);
  invalidate(queryClient, queryKeys.dashboard.all);
  invalidate(queryClient, queryKeys.analytics.all);
  invalidate(queryClient, queryKeys.complimentary.all);
  invalidate(queryClient, queryKeys.ledgers.all);
}

export function invalidateRoomDependencies(queryClient: QueryClient) {
  invalidate(queryClient, queryKeys.rooms.all);
  invalidate(queryClient, queryKeys.roomTypes.all);
  invalidate(queryClient, queryKeys.bookings.all);
  invalidate(queryClient, queryKeys.nightAudit.all);
  invalidate(queryClient, queryKeys.audit.all);
  invalidate(queryClient, queryKeys.dashboard.all);
  invalidate(queryClient, queryKeys.analytics.all);
  invalidate(queryClient, queryKeys.complimentary.all);
}

export function invalidateLedgerDependencies(queryClient: QueryClient) {
  invalidate(queryClient, queryKeys.ledgers.all);
  invalidate(queryClient, queryKeys.companies.all);
  invalidate(queryClient, queryKeys.bookings.all);
  invalidate(queryClient, queryKeys.invoices.all);
  invalidate(queryClient, queryKeys.audit.all);
  invalidate(queryClient, queryKeys.dashboard.all);
  invalidate(queryClient, queryKeys.analytics.all);
}

export function invalidateNightAuditDependencies(queryClient: QueryClient) {
  invalidate(queryClient, queryKeys.nightAudit.all);
  invalidate(queryClient, queryKeys.bookings.all);
  invalidate(queryClient, queryKeys.rooms.all);
  invalidate(queryClient, queryKeys.audit.all);
  invalidate(queryClient, queryKeys.dashboard.all);
  invalidate(queryClient, queryKeys.analytics.all);
  invalidate(queryClient, queryKeys.invoices.all);
  invalidate(queryClient, queryKeys.complimentary.all);
  invalidate(queryClient, queryKeys.ledgers.all);
}

export function invalidatePaymentApprovalDependencies(queryClient: QueryClient) {
  invalidate(queryClient, queryKeys.paymentApprovals.all);
  invalidate(queryClient, queryKeys.bookings.all);
  invalidate(queryClient, queryKeys.audit.all);
  invalidate(queryClient, queryKeys.dashboard.all);
  invalidate(queryClient, queryKeys.analytics.all);
  invalidate(queryClient, queryKeys.invoices.all);
  invalidate(queryClient, queryKeys.ledgers.all);
}

export function invalidateImportedData(queryClient: QueryClient) {
  invalidate(queryClient, queryKeys.bookings.all);
  invalidate(queryClient, queryKeys.guests.all);
  invalidate(queryClient, queryKeys.rooms.all);
  invalidate(queryClient, queryKeys.roomTypes.all);
  invalidate(queryClient, queryKeys.nightAudit.all);
  invalidate(queryClient, queryKeys.audit.all);
  invalidate(queryClient, queryKeys.dashboard.all);
  invalidate(queryClient, queryKeys.analytics.all);
  invalidate(queryClient, queryKeys.invoices.all);
  invalidate(queryClient, queryKeys.complimentary.all);
  invalidate(queryClient, queryKeys.ledgers.all);
}

/**
 * Coarse-grained data domains shared by the local auto-invalidation hook and
 * the realtime `data_changed` socket. The backend's `publish_data_changes`
 * middleware maps request paths to the same domain names — keep them in step.
 */
export type ApiDomain =
  | 'bookings'
  | 'guests'
  | 'rooms'
  | 'ledgers'
  | 'housekeeping'
  | 'night-audit';

/**
 * Map an API request path to the data domain a successful mutation affects.
 * Only domains whose data these pages display are mapped — auth, guest-portal,
 * settings, profile, and other unmapped paths return `null` (no refresh).
 * `/api/payments` and `/api/invoices` resolve to `bookings` because
 * `invalidateBookingDependencies` already fans out to invoices, ledgers, rooms,
 * and guests.
 */
export function domainForApiPath(path: string): ApiDomain | null {
  const normalized = path.replace(/^\/api/, '').split('?')[0];
  const first = normalized.split('/').filter(Boolean)[0] ?? '';
  switch (first) {
    case 'bookings':
    case 'payments':
    case 'invoices':
    case 'services':
    case 'complimentary':
      return 'bookings';
    case 'guests':
      return 'guests';
    case 'rooms':
    case 'room-types':
    case 'rates':
      return 'rooms';
    case 'ledgers':
    case 'companies':
      return 'ledgers';
    case 'housekeeping':
      return 'housekeeping';
    case 'night-audit':
      return 'night-audit';
    default:
      return null;
  }
}

export function invalidateDomain(queryClient: QueryClient, domain: ApiDomain) {
  switch (domain) {
    case 'bookings':
      return invalidateBookingDependencies(queryClient);
    case 'guests':
      return invalidateGuestDependencies(queryClient);
    case 'rooms':
      return invalidateRoomDependencies(queryClient);
    case 'ledgers':
      return invalidateLedgerDependencies(queryClient);
    case 'housekeeping':
      return invalidate(queryClient, queryKeys.housekeeping.all);
    case 'night-audit':
      return invalidateNightAuditDependencies(queryClient);
  }
}
