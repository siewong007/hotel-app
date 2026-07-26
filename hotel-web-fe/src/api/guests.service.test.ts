import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPError } from 'ky';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      patch: (...args: any[]) => patch(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { GuestsService } from './guests.service';
import { APIError } from './client';
import type { Guest, GuestCreateRequest } from '../types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Methods that chain `.json()` onto the api call must reject from that
 * `.json()` call — a bare rejected mock return value is never awaited. */
function mockJsonRejection(error: unknown) {
  return { json: () => Promise.reject(error) };
}

function buildHttpError(status: number, body: unknown, url = 'http://localhost/api/guests') {
  const response = new Response(JSON.stringify(body), { status, statusText: 'Error' });
  const request = new Request(url, { method: 'GET' });
  return new HTTPError(response, request, {} as any);
}

function buildGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 1,
    full_name: 'Jane Doe',
    is_active: true,
    guest_type: 'non_member',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('GuestsService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    del.mockReset();
  });

  describe('getAllGuests', () => {
    it('returns the first page directly when total <= page size', async () => {
      const guests = [buildGuest({ id: 1 }), buildGuest({ id: 2 })];
      get.mockReturnValue(mockJsonResponse({ data: guests, total: 2 }));

      const result = await GuestsService.getAllGuests();

      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith('guests', { searchParams: { page: 1, page_size: 500 } });
      expect(result).toEqual(guests);
    });

    it('forwards search as a search param when provided', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0 }));

      await GuestsService.getAllGuests({ search: 'jane' });

      expect(get).toHaveBeenCalledWith('guests', { searchParams: { page: 1, page_size: 500, search: 'jane' } });
    });

    it('fetches remaining pages in parallel and concatenates results when total exceeds the page size', async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => buildGuest({ id: i + 1 }));
      const page2 = [buildGuest({ id: 501 })];
      get.mockImplementation((_url: string, opts: any) => {
        const page = opts?.searchParams?.page ?? 1;
        if (page === 1) return mockJsonResponse({ data: page1, total: 501 });
        return mockJsonResponse({ data: page2, total: 501 });
      });

      const result = await GuestsService.getAllGuests();

      expect(get).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(501);
      expect(result[500]).toEqual(buildGuest({ id: 501 }));
    });

    it('returns a partial list (skipping failed pages) rather than throwing on a non-auth page failure', async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => buildGuest({ id: i + 1 }));
      get.mockImplementation((_url: string, opts: any) => {
        const page = opts?.searchParams?.page ?? 1;
        if (page === 1) return mockJsonResponse({ data: page1, total: 1000 });
        return { json: () => Promise.reject(new Error('page 2 failed')) };
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await GuestsService.getAllGuests();

      expect(result).toHaveLength(500);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws the 401/session-expired APIError and dispatches auth:unauthorized when a page fails with 401', async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => buildGuest({ id: i + 1 }));
      get.mockImplementation((_url: string, opts: any) => {
        const page = opts?.searchParams?.page ?? 1;
        if (page === 1) return mockJsonResponse({ data: page1, total: 1000 });
        return { json: () => Promise.reject(buildHttpError(401, { error: 'Unauthorized' })) };
      });
      const unauthorizedHandler = vi.fn();
      window.addEventListener('auth:unauthorized', unauthorizedHandler);

      // The 401 APIError thrown inside getAllGuests' try block must survive the
      // surrounding catch (toGuestApiError passes APIError instances through)
      // rather than being re-wrapped into the generic no-statusCode fallback.
      await expect(GuestsService.getAllGuests()).rejects.toMatchObject({
        name: 'APIError',
        message: 'Your session has expired. Please sign in again.',
        statusCode: 401,
      });
      expect(unauthorizedHandler).toHaveBeenCalledTimes(1);

      window.removeEventListener('auth:unauthorized', unauthorizedHandler);
    });

    it('wraps a first-page failure via toGuestApiError', async () => {
      get.mockReturnValue({ json: () => Promise.reject(buildHttpError(500, { error: 'Server exploded' })) });

      await expect(GuestsService.getAllGuests()).rejects.toMatchObject({
        name: 'APIError',
        message: 'Server exploded',
        statusCode: 500,
      });
    });
  });

  describe('getGuestsPage', () => {
    it('uses page 1 / page_size 50 defaults when no params are given', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0 }));

      await GuestsService.getGuestsPage();

      expect(get).toHaveBeenCalledWith('guests', { searchParams: { page: 1, page_size: 50 } });
    });

    it('forwards every filter, coercing missing_tourism/missing_info to strings', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0 }));

      await GuestsService.getGuestsPage({
        page: 3,
        page_size: 10,
        search: 'john',
        guest_type: 'member',
        tourism_type: 'foreign',
        missing_tourism: true,
        missing_info: false,
      });

      expect(get).toHaveBeenCalledWith('guests', {
        searchParams: {
          page: 3,
          page_size: 10,
          search: 'john',
          guest_type: 'member',
          tourism_type: 'foreign',
          missing_tourism: 'true',
          missing_info: 'false',
        },
      });
    });

    it('defaults total/page/page_size from the returned data when the response omits them', async () => {
      const guests = [buildGuest()];
      get.mockReturnValue(mockJsonResponse(guests));

      const result = await GuestsService.getGuestsPage();

      expect(result).toEqual({ data: guests, total: 1, page: 1, page_size: 50 });
    });

    it('wraps a failure via toGuestApiError', async () => {
      get.mockReturnValue({ json: () => Promise.reject(buildHttpError(404, { error: 'Not found' })) });

      await expect(GuestsService.getGuestsPage()).rejects.toMatchObject({
        name: 'APIError',
        message: 'Not found',
        statusCode: 404,
      });
    });
  });

  describe('getGuest', () => {
    it('calls GET guests/<id>', async () => {
      const guest = buildGuest({ id: 7 });
      get.mockReturnValue(mockJsonResponse(guest));

      const result = await GuestsService.getGuest(7);

      expect(get).toHaveBeenCalledWith('guests/7');
      expect(result).toEqual(guest);
    });
  });

  describe('getGuestProfile', () => {
    it('calls GET guests/<id>/profile', async () => {
      const profile = { guest: buildGuest(), summary: {}, reservations: [], duplicate_candidates: [] };
      get.mockReturnValue(mockJsonResponse(profile));

      const result = await GuestsService.getGuestProfile(7);

      expect(get).toHaveBeenCalledWith('guests/7/profile');
      expect(result).toEqual(profile);
    });

    it('wraps a failure via toGuestApiError', async () => {
      get.mockReturnValue({ json: () => Promise.reject(buildHttpError(404, { error: 'Guest not found' })) });

      await expect(GuestsService.getGuestProfile(999)).rejects.toBeInstanceOf(APIError);
    });
  });

  describe('createGuest', () => {
    it('posts the guest data defaulting tourism_type to local when omitted', async () => {
      const input: GuestCreateRequest = { first_name: 'Jane', last_name: 'Doe' };
      const created = buildGuest();
      post.mockReturnValue(mockJsonResponse(created));

      const result = await GuestsService.createGuest(input);

      expect(post).toHaveBeenCalledWith('guests', { json: { first_name: 'Jane', last_name: 'Doe', tourism_type: 'local' } });
      expect(result).toEqual(created);
    });

    it('preserves an explicit tourism_type', async () => {
      post.mockReturnValue(mockJsonResponse(buildGuest()));

      await GuestsService.createGuest({ first_name: 'Jane', last_name: 'Doe', tourism_type: 'foreign' });

      expect(post).toHaveBeenCalledWith('guests', {
        json: { first_name: 'Jane', last_name: 'Doe', tourism_type: 'foreign' },
      });
    });

    it('wraps a failure via toGuestApiError', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(400, { error: 'Duplicate guest' })));

      await expect(
        GuestsService.createGuest({ first_name: 'Jane', last_name: 'Doe' }),
      ).rejects.toMatchObject({ message: 'Duplicate guest', statusCode: 400 });
    });
  });

  describe('updateGuest', () => {
    it('patches guests/<id> with the partial input as json', async () => {
      const updated = buildGuest({ id: 3, full_name: 'Updated Name' });
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await GuestsService.updateGuest(3, { first_name: 'Updated' });

      expect(patch).toHaveBeenCalledWith('guests/3', { json: { first_name: 'Updated' } });
      expect(result).toEqual(updated);
    });

    it('wraps a failure via toGuestApiError', async () => {
      patch.mockReturnValue(mockJsonRejection(buildHttpError(409, { error: 'Version conflict' })));

      await expect(GuestsService.updateGuest(3, {})).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('applyTourismTypeFromLastCheckIn', () => {
    it('posts to guests/<id>/tourism-from-last-check-in', async () => {
      const response = { guest: buildGuest(), source: {} };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await GuestsService.applyTourismTypeFromLastCheckIn(7);

      expect(post).toHaveBeenCalledWith('guests/7/tourism-from-last-check-in');
      expect(result).toEqual(response);
    });
  });

  describe('transferPortalAccount', () => {
    it('posts the username as json to guests/<id>/portal-account', async () => {
      post.mockReturnValue(Promise.resolve(undefined));

      await GuestsService.transferPortalAccount(7, 'jane.doe');

      expect(post).toHaveBeenCalledWith('guests/7/portal-account', { json: { username: 'jane.doe' } });
    });

    it('wraps a failure via toGuestApiError', async () => {
      post.mockReturnValue(Promise.reject(buildHttpError(400, { error: 'Username taken' })));

      await expect(GuestsService.transferPortalAccount(7, 'taken')).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('deleteGuest', () => {
    it('calls DELETE guests/<id>', async () => {
      del.mockReturnValue(mockJsonResponse({ success: true, message: 'deleted' }));

      const result = await GuestsService.deleteGuest(7);

      expect(del).toHaveBeenCalledWith('guests/7');
      expect(result).toEqual({ success: true, message: 'deleted' });
    });
  });

  describe('getGuestBookings', () => {
    it('calls GET guests/<id>/bookings', async () => {
      get.mockReturnValue(mockJsonResponse([{ id: 1 }]));

      const result = await GuestsService.getGuestBookings(7);

      expect(get).toHaveBeenCalledWith('guests/7/bookings');
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('getMyGuests', () => {
    it('calls GET guests/my-guests', async () => {
      const guests = [buildGuest()];
      get.mockReturnValue(mockJsonResponse(guests));

      const result = await GuestsService.getMyGuests();

      expect(get).toHaveBeenCalledWith('guests/my-guests');
      expect(result).toEqual(guests);
    });

    it('wraps a failure via toGuestApiError', async () => {
      get.mockReturnValue({ json: () => Promise.reject(buildHttpError(500, { error: 'boom' })) });

      await expect(GuestsService.getMyGuests()).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('getMyGuestsWithCredits', () => {
    it('calls GET guests/my-guests-with-credits', async () => {
      const guests = [{ id: 1, full_name: 'Jane', email: 'a@b.com', total_complimentary_credits: 2, credits_by_room_type: [] }];
      get.mockReturnValue(mockJsonResponse(guests));

      const result = await GuestsService.getMyGuestsWithCredits();

      expect(get).toHaveBeenCalledWith('guests/my-guests-with-credits');
      expect(result).toEqual(guests);
    });
  });

  describe('getGuestCredits', () => {
    it('calls GET guests/<id>/credits', async () => {
      const credits = { guest_id: 7, guest_name: 'Jane', total_nights: 2, credits_by_room_type: [] };
      get.mockReturnValue(mockJsonResponse(credits));

      const result = await GuestsService.getGuestCredits(7);

      expect(get).toHaveBeenCalledWith('guests/7/credits');
      expect(result).toEqual(credits);
    });

    it('wraps a failure via toGuestApiError', async () => {
      get.mockReturnValue({ json: () => Promise.reject(buildHttpError(404, { error: 'No credits' })) });

      await expect(GuestsService.getGuestCredits(7)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
