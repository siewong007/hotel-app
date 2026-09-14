import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const getPortalToken = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

vi.mock('../api/portalTokenStore', () => ({
  getPortalToken: () => getPortalToken(),
}));

import { GuestBookingApi, PublicBookingApi } from './api';
import type { GuestBookingSearch } from './types';

function jsonResponse<T>(value: T) {
  return { json: vi.fn().mockResolvedValue(value) };
}

const SEARCH: GuestBookingSearch = {
  check_in_date: '2026-10-01',
  check_out_date: '2026-10-03',
  adults: 2,
  children: 0,
};

describe('GuestBookingApi', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    getPortalToken.mockReset();
  });

  it('searches offers with the portal bearer and the skip-notification header', async () => {
    get.mockReturnValue(jsonResponse([]));

    await GuestBookingApi.search(SEARCH, 'guest-token-a');

    expect(get).toHaveBeenCalledWith('guest-portal/me/booking-options', {
      headers: {
        Authorization: 'Bearer guest-token-a',
        'x-skip-api-notification': 'true',
      },
      searchParams: {
        check_in_date: '2026-10-01',
        check_out_date: '2026-10-03',
        adults: '2',
        children: '0',
      },
    });
    expect(getPortalToken).not.toHaveBeenCalled();
  });

  it('posts a booking create with a json body and both headers', async () => {
    const input = {
      ...SEARCH,
      room_type_id: 7,
      client_request_id: 'req-1',
      expected_total: '250.00',
      consents: [],
    };
    post.mockReturnValue(jsonResponse({ booking_id: 9 }));

    await GuestBookingApi.create(input, 'guest-token-a');

    expect(post).toHaveBeenCalledWith('guest-portal/me/bookings', {
      headers: {
        Authorization: 'Bearer guest-token-a',
        'x-skip-api-notification': 'true',
      },
      json: input,
    });
  });

  it('falls back to the stored portal token for a quote', async () => {
    getPortalToken.mockReturnValue('stored-guest-token');
    post.mockReturnValue(jsonResponse({}));
    const input = { ...SEARCH, room_type_id: 7 };

    await GuestBookingApi.quote(input);

    expect(post).toHaveBeenCalledWith('guest-portal/me/booking-quote', {
      headers: {
        Authorization: 'Bearer stored-guest-token',
        'x-skip-api-notification': 'true',
      },
      json: input,
    });
  });

  it('throws before requesting when there is no portal session', () => {
    getPortalToken.mockReturnValue(null);

    expect(() => GuestBookingApi.search(SEARCH)).toThrow(
      'Sign in to the guest portal to continue',
    );
    expect(get).not.toHaveBeenCalled();
  });
});

describe('PublicBookingApi', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('sends no auth header but skips the global toast on anonymous search', async () => {
    get.mockReturnValue(jsonResponse([]));

    await PublicBookingApi.search(SEARCH);

    expect(get).toHaveBeenCalledWith('booking/offers', {
      headers: { 'x-skip-api-notification': 'true' },
      searchParams: {
        check_in_date: '2026-10-01',
        check_out_date: '2026-10-03',
        adults: '2',
        children: '0',
      },
    });
  });

  it('sends no auth header but skips the global toast on anonymous quote and create', async () => {
    const quoteInput = { ...SEARCH, room_type_id: 7 };
    const createInput = {
      ...SEARCH,
      room_type_id: 7,
      client_request_id: 'req-anon-1',
      expected_total: '250.00',
      guest: { first_name: 'anon-guest', email: 'anon@example.com', tourism_type: 'local' as const },
      consents: [],
      marketing_opt_in: false,
    };
    post.mockReturnValue(jsonResponse({}));

    await PublicBookingApi.quote(quoteInput);
    await PublicBookingApi.create(createInput);

    expect(post).toHaveBeenNthCalledWith(1, 'booking/quote', {
      headers: { 'x-skip-api-notification': 'true' },
      json: quoteInput,
    });
    expect(post).toHaveBeenNthCalledWith(2, 'booking/reservations', {
      headers: { 'x-skip-api-notification': 'true' },
      json: createInput,
    });
  });
});
