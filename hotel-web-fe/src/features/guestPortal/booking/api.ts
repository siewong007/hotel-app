import { api } from '../../../api/client';
import { apiUrl } from '../../../desktop/runtimeApi';
import { getPortalToken } from '../api/portalTokenStore';
import type {
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

export function guestAvailabilityWebSocketUrl(): string {
  const httpUrl = new URL(apiUrl('guest-portal/me/availability'), window.location.origin);
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return httpUrl.toString();
}
