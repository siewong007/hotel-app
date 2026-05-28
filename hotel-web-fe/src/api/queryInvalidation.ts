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
