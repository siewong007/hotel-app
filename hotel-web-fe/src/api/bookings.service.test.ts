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

import { BookingsService, currentStayWindow } from './bookings.service';
import { addLocalDays, formatLocalDate, parseLocalDate, toHotelDateString } from '../utils/date';

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

describe('BookingsService current-and-upcoming stay window', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('starts the window the day BEFORE today, so same-day departures survive', () => {
    // Load-bearing off-by-one. The backend's two-sided date filter matches on
    // `check_out > from`, so a guest checking out today (check_out = today)
    // only comes back when `from` is yesterday. Passing today would silently
    // drop every same-day departure from the dashboard and the room grid — a
    // wrong answer that still renders, which is why it is pinned here.
    const { check_in_from, check_in_to } = currentStayWindow();
    const today = toHotelDateString(new Date());

    expect(check_in_from).toBe(formatLocalDate(addLocalDays(today, -1)));
    expect(check_in_from < today).toBe(true);
    expect(check_in_to > today).toBe(true);
  });

  it('reaches far enough ahead to cover any real reservation', () => {
    const { check_in_from, check_in_to } = currentStayWindow();
    const days =
      (parseLocalDate(check_in_to).getTime() - parseLocalDate(check_in_from).getTime()) / 86_400_000;

    // 731 = yesterday .. today+730. Production's furthest check-in was 145 days
    // out, so this leaves a wide margin; shrinking it would start hiding a
    // room's "next reservation".
    expect(Math.round(days)).toBe(731);
  });

  it('sends both bounds, because one bound alone is not an overlap test', async () => {
    mockEmptyPage();

    await BookingsService.getCurrentAndUpcomingBookings();

    const params = lastSearchParams();
    // check_in_from on its own means `check_in >= from` server-side; only the
    // pair triggers the stay-overlap predicate this screen depends on.
    expect(params.check_in_from).toBeTruthy();
    expect(params.check_in_to).toBeTruthy();
  });

  it('windows every status fetched for the live room grid', async () => {
    mockEmptyPage();

    await BookingsService.getActiveBookings();

    const statuses = get.mock.calls.map((c) => c[1]?.searchParams?.status);
    expect(statuses).toEqual(
      expect.arrayContaining(['checked_in', 'auto_checked_in', 'confirmed', 'pending']),
    );
    for (const call of get.mock.calls) {
      expect(call[1]?.searchParams?.check_in_from).toBeTruthy();
      expect(call[1]?.searchParams?.check_in_to).toBeTruthy();
    }
  });

  it('fetches unpaid and awaiting-confirmation holds for the live room grid', async () => {
    // Room 210 regression: a website booking in `pending_confirmation` held the
    // room (backend marked it reserved) but the grid never fetched it, so the
    // card read as available with no guest.
    mockEmptyPage();

    await BookingsService.getActiveBookings();

    const statuses = get.mock.calls.map((c) => c[1]?.searchParams?.status);
    expect(statuses).toEqual(expect.arrayContaining(['pending_payment', 'pending_confirmation']));
    expect(statuses.includes('voided')).toBe(false);
    expect(statuses.includes('checked_out')).toBe(false);
  });
});

describe('BookingsService page fan-out is bounded', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('never holds more than two page requests in flight at once', async () => {
    // The backend pool is five connections. The previous Promise.all fired
    // every remaining page simultaneously, so one screen refresh could occupy
    // the whole pool.
    let inFlight = 0;
    let peak = 0;
    get.mockImplementation((_path: string, opts: any) => ({
      json: () => {
        const page = Number(opts?.searchParams?.page ?? 1);
        if (page === 1) {
          return Promise.resolve({ data: [], total: 2500, page: 1, page_size: 500 });
        }
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        return new Promise((resolve) =>
          setTimeout(() => {
            inFlight -= 1;
            resolve({ data: [], total: 2500, page, page_size: 500 });
          }, 5),
        );
      },
    }));

    await BookingsService.getAllBookings();

    expect(get.mock.calls.length).toBe(5); // 1 + 4 remaining pages
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });
});
