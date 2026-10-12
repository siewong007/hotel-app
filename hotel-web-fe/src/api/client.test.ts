import ky from 'ky';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAccessToken } from '../auth/tokenStore';
import { api, refreshAccessToken, requestFromKyHook, trackPendingLogout } from './client';

describe('api client URL resolution', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('resolves a guest portal request from a nested page without inheriting the page path', async () => {
    window.history.replaceState({}, '', '/portal/book');
    let requestedUrl = '';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await api.get('guest-portal/me/booking-options', {
      fetch: fetchMock,
      headers: { Authorization: 'Bearer guest-token' },
      searchParams: {
        check_in_date: '2026-07-17',
        check_out_date: '2026-07-18',
        adults: '1',
        children: '0',
      },
    });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe('/api/guest-portal/me/booking-options');
    expect(url.searchParams.get('check_in_date')).toBe('2026-07-17');
    expect(url.searchParams.get('check_out_date')).toBe('2026-07-18');
  });

  it('reads the request from a ky 2 hook state object', () => {
    const request = new Request('https://hotel.test/api/auth/login');
    expect(requestFromKyHook({ request }).url).toContain('/api/auth/login');
  });

  it('reads the request when ky 1 passes the Request as the first argument', () => {
    const request = new Request('https://hotel.test/api/auth/login');
    // Destructing `{ request }` from a Request is the production crash:
    // Request has no `.request`, so `inner` is undefined and `inner.url` throws.
    expect(() => {
      const { request: inner } = request as unknown as { request: Request };
      return inner.url;
    }).toThrow(/url/);
    expect(requestFromKyHook(request).url).toContain('/api/auth/login');
  });
});

describe('refreshAccessToken during a sign-out', () => {
  // The refresh posts to a relative URL, which Node's Request cannot resolve,
  // so observe the ky call itself rather than fetch.
  function stubRefreshPost() {
    return vi.spyOn(ky, 'post').mockImplementation(() => ({
      json: () => Promise.resolve({ access_token: 'access-after' }),
    }) as unknown as ReturnType<typeof ky.post>);
  }

  const aFewTicks = () => new Promise(resolve => setTimeout(resolve, 20));

  afterEach(() => {
    clearAccessToken();
    vi.restoreAllMocks();
  });

  it('presents the refresh cookie straight away when no sign-out is pending', async () => {
    // Control for the test below: the same wait is long enough to see the post.
    const postSpy = stubRefreshPost();

    const refreshing = refreshAccessToken();
    await aFewTicks();

    expect(postSpy).toHaveBeenCalledTimes(1);
    await refreshing;
  });

  it('holds the refresh until a pending sign-out has settled', async () => {
    // A refresh that reached the server first rotated the session out from
    // under the revoke, so the sign-out ended nothing.
    const postSpy = stubRefreshPost();
    let finishLogout!: () => void;
    trackPendingLogout(new Promise<void>(resolve => {
      finishLogout = resolve;
    }));

    const refreshing = refreshAccessToken();
    await aFewTicks();
    expect(postSpy).not.toHaveBeenCalled();

    finishLogout();
    await expect(refreshing).resolves.toEqual({ access_token: 'access-after' });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(String(postSpy.mock.calls[0][0])).toContain('auth/refresh');
  });
});
