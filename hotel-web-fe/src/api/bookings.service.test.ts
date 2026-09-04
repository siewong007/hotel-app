import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
    },
  };
});

import { BookingsService } from './bookings.service';

function mockEmptyPage() {
  get.mockReturnValue({
    json: () => Promise.resolve({ data: [], total: 0, page: 1, page_size: 50 }),
  });
}

/** Read the searchParams object passed to the most recent api.get call. */
function lastSearchParams(): Record<string, any> {
  const call = get.mock.calls[get.mock.calls.length - 1];
  return call?.[1]?.searchParams ?? {};
}

describe('BookingsService.getBookingsPage payment_method filter', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('forwards payment_method as a search param when provided', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({ payment_method: 'Cash' });

    expect(get).toHaveBeenCalledWith('bookings', expect.anything());
    expect(lastSearchParams()).toMatchObject({ payment_method: 'Cash' });
  });

  it('omits payment_method when not provided', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({});

    expect(lastSearchParams()).not.toHaveProperty('payment_method');
  });

  it('omits payment_method when an empty string is passed', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({ payment_method: '' });

    expect(lastSearchParams()).not.toHaveProperty('payment_method');
  });
});

describe('BookingsService.getBookingsPage online_channel filter', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('forwards online_channel as a search param when provided', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({ online_channel: 'Booking.com' });

    expect(get).toHaveBeenCalledWith('bookings', expect.anything());
    expect(lastSearchParams()).toMatchObject({ online_channel: 'Booking.com' });
  });

  it('omits online_channel when not provided', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({});

    expect(lastSearchParams()).not.toHaveProperty('online_channel');
  });

  it('omits online_channel when an empty string is passed', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({ online_channel: '' });

    expect(lastSearchParams()).not.toHaveProperty('online_channel');
  });
});

describe('BookingsService.getBookingsPage month_search filter', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('forwards month_search as a search param when provided', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({ month_search: '2026-02-01' });

    expect(get).toHaveBeenCalledWith('bookings', expect.anything());
    expect(lastSearchParams()).toMatchObject({ month_search: '2026-02-01' });
  });

  it('omits month_search when not provided', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({});

    expect(lastSearchParams()).not.toHaveProperty('month_search');
  });

  it('omits month_search when an empty string is passed', async () => {
    mockEmptyPage();

    await BookingsService.getBookingsPage({ month_search: '' });

    expect(lastSearchParams()).not.toHaveProperty('month_search');
  });
});

describe('BookingsService.releaseBooking', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('posts the reason to the booking-scoped release endpoint', async () => {
    post.mockReturnValue({
      json: () => Promise.resolve({ message: 'Room released.', booking_id: 42 }),
    });

    const result = await BookingsService.releaseBooking(42, 'No payment after 7 days');

    expect(post).toHaveBeenCalledWith('bookings/42/release', {
      json: { reason: 'No payment after 7 days' },
    });
    expect(result).toMatchObject({ booking_id: 42 });
  });

  it('surfaces the server message from a rejected release', async () => {
    const { HTTPError } = await import('ky');
    const response = new Response('{}', { status: 409 });
    const error = new HTTPError(response, new Request('http://x/'), {} as any);
    // ky 2 has already consumed the body into `data`; reading `response.json()`
    // again here would throw and lose the message (see lessons, theme 13).
    (error as unknown as { data: unknown }).data = {
      error: 'Payments have been recorded against this booking.',
    };
    post.mockReturnValue({ json: () => Promise.reject(error) });

    await expect(BookingsService.releaseBooking(42, 'stale hold')).rejects.toThrow(
      'Payments have been recorded against this booking.',
    );
  });
});
