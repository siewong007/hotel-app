import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: { get: (...args: any[]) => get(...args) },
  };
});

import { SearchService } from './search.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

describe('SearchService.search', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('builds the query string with only q when no options are given', async () => {
    get.mockReturnValue(mockJsonResponse({ query: 'abc', groups: [] }));

    await SearchService.search('abc');

    expect(get).toHaveBeenCalledWith('search?q=abc', { signal: undefined });
  });

  it('appends types as a comma-joined list when provided', async () => {
    get.mockReturnValue(mockJsonResponse({ query: 'abc', groups: [] }));

    await SearchService.search('abc', { types: ['bookings', 'guests'] });

    const [url] = get.mock.calls[0];
    expect(url).toBe('search?q=abc&types=bookings%2Cguests');
  });

  it('omits types when the array is empty', async () => {
    get.mockReturnValue(mockJsonResponse({ query: 'abc', groups: [] }));

    await SearchService.search('abc', { types: [] });

    const [url] = get.mock.calls[0];
    expect(url).toBe('search?q=abc');
  });

  it('appends limit when provided', async () => {
    get.mockReturnValue(mockJsonResponse({ query: 'abc', groups: [] }));

    await SearchService.search('abc', { limit: 10 });

    const [url] = get.mock.calls[0];
    expect(url).toBe('search?q=abc&limit=10');
  });

  it('omits limit when it is zero (falsy)', async () => {
    get.mockReturnValue(mockJsonResponse({ query: 'abc', groups: [] }));

    await SearchService.search('abc', { limit: 0 });

    const [url] = get.mock.calls[0];
    expect(url).toBe('search?q=abc');
  });

  it('forwards the abort signal', async () => {
    get.mockReturnValue(mockJsonResponse({ query: 'abc', groups: [] }));
    const controller = new AbortController();

    await SearchService.search('abc', { signal: controller.signal });

    expect(get).toHaveBeenCalledWith('search?q=abc', { signal: controller.signal });
  });

  it('returns the unwrapped JSON response', async () => {
    const payload = {
      query: 'abc',
      groups: [{ type: 'bookings', label: 'Bookings', results: [] }],
    };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await SearchService.search('abc');

    expect(result).toEqual(payload);
  });
});
