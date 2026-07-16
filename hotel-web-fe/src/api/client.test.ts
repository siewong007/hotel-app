import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './client';

describe('api client URL resolution', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('resolves a guest portal request from a nested page without inheriting the page path', async () => {
    window.history.replaceState({}, '', '/portal/book');
    let requestedUrl = '';

    const fetchMock = vi.fn(async (request: Request) => {
      requestedUrl = request.url;
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
});
