/**
 * Guest portal dashboard API calls (login + `/me/*`).
 *
 * These sit beside `src/api/guestPortal.service.ts` (the pre-check-in verify
 * flow) rather than inside it, because every call here needs the guest's own
 * bearer token attached explicitly — never the staff access token that
 * `src/api/client.ts`'s `beforeRequest` hook injects by default.
 *
 * RISK (documented per spec instead of restructuring client.ts): the shared
 * `api` instance's `afterResponse` hook treats any 401 on a non-`/auth/*` path
 * as a staff-session expiry and fires `auth:unauthorized` (see
 * `src/api/client.ts` lines ~161-183). A 401 from a guest-portal call (e.g. an
 * expired guest token) will also fire that event today. In practice this is
 * harmless for a guest with no staff session (the staff `AuthContext` listener
 * just clears already-empty staff state), but if a staff member is browsing
 * the portal in the same tab as an active staff session, an expired guest
 * token could spuriously log the staff user out. Not fixed here; flagged as a
 * known risk.
 */
import { api } from '../../../api/client';
import { getPortalToken } from './portalTokenStore';
import type {
  GuestPortalBenefitsResponse,
  GuestPortalBookingSummary,
  GuestPortalLoginResponse,
  GuestPortalMeResponse,
  GuestPortalMembershipResponse,
  GuestPortalPagedResponse,
  GuestPortalTransaction,
} from '../../../types';

export interface PortalPageParams {
  page?: number;
  per_page?: number;
}

function authHeaders(token?: string): Record<string, string> {
  const guestToken = token ?? getPortalToken();
  if (!guestToken) {
    throw new Error('Not signed in to the guest portal');
  }
  return { Authorization: `Bearer ${guestToken}` };
}

function withPageParams(params?: PortalPageParams): URLSearchParams | undefined {
  if (!params) return undefined;
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.per_page !== undefined) search.set('per_page', String(params.per_page));
  return search;
}

export class GuestPortalDashboardService {
  static async createSession(): Promise<GuestPortalLoginResponse> {
    // A portal session is needed before any guest page can render. Fail quickly
    // enough to offer recovery controls instead of leaving the experience on an
    // indefinite loading screen when the local backend is unavailable.
    return await api.post('guest-portal/session', { timeout: 10_000 }).json();
  }

  static async logout(token?: string): Promise<void> {
    await api.post('guest-portal/logout', { headers: authHeaders(token) });
  }

  static async me(token?: string): Promise<GuestPortalMeResponse> {
    return await api
      .get('guest-portal/me', { headers: authHeaders(token) })
      .json();
  }

  static async bookings(
    params?: PortalPageParams,
    token?: string
  ): Promise<GuestPortalPagedResponse<GuestPortalBookingSummary>> {
    return await api
      .get('guest-portal/me/bookings', {
        headers: authHeaders(token),
        searchParams: withPageParams(params),
      })
      .json();
  }

  static async transactions(
    params?: PortalPageParams,
    token?: string
  ): Promise<GuestPortalPagedResponse<GuestPortalTransaction>> {
    return await api
      .get('guest-portal/me/transactions', {
        headers: authHeaders(token),
        searchParams: withPageParams(params),
      })
      .json();
  }

  static async cancelBooking(bookingId: number, reason: string, token?: string): Promise<void> {
    await api.post(`guest-portal/me/bookings/${bookingId}/cancel`, {
      headers: authHeaders(token),
      json: { reason: reason.trim() || null },
    });
  }

  static async membership(token?: string): Promise<GuestPortalMembershipResponse> {
    return await api
      .get('guest-portal/me/membership', { headers: authHeaders(token) })
      .json();
  }

  static async benefits(token?: string): Promise<GuestPortalBenefitsResponse> {
    return await api
      .get('guest-portal/me/benefits', { headers: authHeaders(token) })
      .json();
  }
}
