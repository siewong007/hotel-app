import { api } from '../../../api/client';
import { apiUrl } from '../../../desktop/runtimeApi';
import { getPortalToken } from '../api/portalTokenStore';
import type {
  CreateAnonymousBookingRequest,
  CreateGuestBookingRequest,
  GuestBookingConfirmation,
  GuestBookingOffer,
  GuestBookingQuote,
  GuestBookingQuoteRequest,
  GuestBookingSearch,
  GuestBookingVoucherOptions,
} from './types';

function authHeaders(token?: string): Record<string, string> {
  const portalToken = token ?? getPortalToken();
  if (!portalToken) {
    throw new Error('Sign in to the guest portal to continue');
  }
  return { Authorization: `Bearer ${portalToken}` };
}

export const GuestBookingApi = {
  search(input: GuestBookingSearch, token?: string): Promise<GuestBookingOffer[]> {
    return api
      .get('guest-portal/me/booking-options', {
        headers: authHeaders(token),
        searchParams: Object.fromEntries(
          Object.entries(input).map(([key, value]) => [key, String(value)]),
        ),
      })
      .json<GuestBookingOffer[]>();
  },

  quote(input: GuestBookingQuoteRequest, token?: string): Promise<GuestBookingQuote> {
    return api
      .post('guest-portal/me/booking-quote', {
        headers: authHeaders(token),
        json: input,
      })
      .json<GuestBookingQuote>();
  },

  voucherOptions(
    input: GuestBookingQuoteRequest,
    token?: string,
  ): Promise<GuestBookingVoucherOptions> {
    return api
      .post('guest-portal/me/booking-voucher-options', {
        headers: authHeaders(token),
        json: input,
      })
      .json<GuestBookingVoucherOptions>();
  },

  create(
    input: CreateGuestBookingRequest,
    token?: string,
  ): Promise<GuestBookingConfirmation> {
    return api
      .post('guest-portal/me/bookings', {
        headers: authHeaders(token),
        json: input,
      })
      .json<GuestBookingConfirmation>();
  },
};

/**
 * Booking without an account.
 *
 * These endpoints take no `Authorization` header at all, which is deliberate:
 * the backend's session middleware rejects a bearer token it cannot verify, so
 * sending a stale portal token here would fail the request rather than fall
 * back to anonymous. They are also quoted at list price — vouchers, free-night
 * credits and loyalty need an account, and the request types cannot express
 * them.
 */
export const PublicBookingApi = {
  search(input: GuestBookingSearch): Promise<GuestBookingOffer[]> {
    return api
      .get('booking/offers', {
        searchParams: Object.fromEntries(
          Object.entries(input).map(([key, value]) => [key, String(value)]),
        ),
      })
      .json<GuestBookingOffer[]>();
  },

  quote(input: GuestBookingQuoteRequest): Promise<GuestBookingQuote> {
    return api.post('booking/quote', { json: input }).json<GuestBookingQuote>();
  },

  create(input: CreateAnonymousBookingRequest): Promise<GuestBookingConfirmation> {
    return api
      .post('booking/reservations', { json: input })
      .json<GuestBookingConfirmation>();
  },
};

export function guestAvailabilityWebSocketUrl(): string {
  const httpUrl = new URL(apiUrl('guest-portal/me/availability'), window.location.origin);
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return httpUrl.toString();
}
