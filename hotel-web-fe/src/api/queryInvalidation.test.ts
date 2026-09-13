import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { domainForApiPath, invalidateDomain } from './queryInvalidation';
import { queryKeys } from './queryKeys';

// The backend's `publish_data_changes` middleware maps request paths to the
// same domain strings — these cases pin the client side of that contract.
describe('domainForApiPath', () => {
  it('maps booking-side mutations to the bookings domain', () => {
    expect(domainForApiPath('/api/bookings/5/check-in')).toBe('bookings');
    expect(domainForApiPath('/api/payments/refund-deposit/3')).toBe('bookings');
    expect(domainForApiPath('/api/invoices/9/send')).toBe('bookings');
  });

  it('maps guest, room, ledger, housekeeping, and night-audit paths', () => {
    expect(domainForApiPath('/api/guests/12')).toBe('guests');
    expect(domainForApiPath('/api/rooms/4/status')).toBe('rooms');
    expect(domainForApiPath('/api/room-types/2')).toBe('rooms');
    expect(domainForApiPath('/api/rates/1')).toBe('rooms');
    expect(domainForApiPath('/api/ledgers/7/payments')).toBe('ledgers');
    expect(domainForApiPath('/api/companies/3')).toBe('ledgers');
    expect(domainForApiPath('/api/housekeeping/tasks/1')).toBe('housekeeping');
    expect(domainForApiPath('/api/night-audit/run')).toBe('night-audit');
  });

  it('returns null for paths without a staff data domain', () => {
    expect(domainForApiPath('/api/auth/login')).toBeNull();
    expect(domainForApiPath('/api/guest-portal/bookings/1')).toBeNull();
    expect(domainForApiPath('/api/updates/socket')).toBeNull();
    expect(domainForApiPath('/api/settings/hotel')).toBeNull();
  });
});

describe('invalidateDomain', () => {
  it('fans a payments mutation out to bookings, ledgers, and invoices', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateDomain(queryClient, domainForApiPath('/api/payments/1/refund')!);
    const invalidated = spy.mock.calls.map((call) => call[0]?.queryKey?.[0]);
    expect(invalidated).toContain(queryKeys.bookings.all[0]);
    expect(invalidated).toContain(queryKeys.ledgers.all[0]);
    expect(invalidated).toContain(queryKeys.invoices.all[0]);
  });

  it('keeps the ledgers domain on ledger-adjacent keys', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateDomain(queryClient, 'ledgers');
    const invalidated = spy.mock.calls.map((call) => call[0]?.queryKey?.[0]);
    expect(invalidated).toContain(queryKeys.ledgers.all[0]);
    expect(invalidated).toContain(queryKeys.companies.all[0]);
    expect(invalidated).toContain(queryKeys.bookings.all[0]);
    expect(invalidated).not.toContain(queryKeys.guests.all[0]);
  });
});
