import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const getPortalToken = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));

vi.mock('./portalTokenStore', () => ({
  getPortalToken: () => getPortalToken(),
}));

import { GuestPortalDashboardService } from './guestPortalDashboard.service';

function jsonResponse<T>(value: T) {
  return { json: vi.fn().mockResolvedValue(value) };
}

describe('GuestPortalDashboardService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    getPortalToken.mockReset();
  });

  it('creates a session without a token and still opts out of the global error toast', async () => {
    post.mockReturnValue(jsonResponse({ token: 'tok', expires_at: '2026-10-01T00:00:00Z' }));

    await GuestPortalDashboardService.createSession();

    expect(post).toHaveBeenCalledWith('guest-portal/session', {
      timeout: 10_000,
      headers: { 'x-skip-api-notification': 'true' },
    });
  });

  it('reads /me with the portal bearer and the skip-notification header', async () => {
    get.mockReturnValue(jsonResponse({ guest: { id: 1 } }));

    await GuestPortalDashboardService.me('guest-token-a');

    expect(get).toHaveBeenCalledWith('guest-portal/me', {
      headers: {
        Authorization: 'Bearer guest-token-a',
        'x-skip-api-notification': 'true',
      },
    });
    expect(getPortalToken).not.toHaveBeenCalled();
  });

  it('cancels a booking with a json body and both headers', async () => {
    post.mockReturnValue(jsonResponse({ cancellation_requested: true }));

    await GuestPortalDashboardService.cancelBooking(3, 'plans changed', 'tok');

    expect(post).toHaveBeenCalledWith('guest-portal/me/bookings/3/cancel', {
      headers: {
        Authorization: 'Bearer tok',
        'x-skip-api-notification': 'true',
      },
      json: { reason: 'plans changed' },
    });
  });

  it('uploads a payment receipt FormData body with both headers', async () => {
    post.mockReturnValue(Promise.resolve(undefined));
    const file = new File(['bytes'], 'receipt.png', { type: 'image/png' });

    await GuestPortalDashboardService.uploadPaymentReceipt(42, file, 'tok');

    expect(post).toHaveBeenCalledTimes(1);
    const [url, options] = post.mock.calls[0];
    expect(url).toBe('guest-portal/me/payments/42/receipt');
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('file')).toBe(file);
    expect(options.headers).toEqual({
      Authorization: 'Bearer tok',
      'x-skip-api-notification': 'true',
    });
  });

  it('falls back to the stored portal token', async () => {
    getPortalToken.mockReturnValue('stored-guest-token');
    get.mockReturnValue(jsonResponse({ items: [] }));

    await GuestPortalDashboardService.credits();

    expect(get).toHaveBeenCalledWith('guest-portal/me/credits', {
      headers: {
        Authorization: 'Bearer stored-guest-token',
        'x-skip-api-notification': 'true',
      },
    });
  });

  it('rejects an unauthenticated call before making any request', async () => {
    getPortalToken.mockReturnValue(null);

    await expect(GuestPortalDashboardService.me()).rejects.toThrow(
      'Please sign in to continue.',
    );
    expect(get).not.toHaveBeenCalled();
  });
});
