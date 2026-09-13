import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, requestFromKyHook } from './client';

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
