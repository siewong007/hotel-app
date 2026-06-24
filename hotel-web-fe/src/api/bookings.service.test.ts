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
