import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildKyHttpError } from './testSupport/httpError';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      patch: (...args: any[]) => patch(...args),
      put: (...args: any[]) => put(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { GuestRelationsService } from './guestRelations.service';
import type { GuestInteraction } from '../types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Methods that chain `.json()` onto the api call must reject from that
 * `.json()` call — a bare rejected mock return value is never awaited. */
function mockJsonRejection(error: unknown) {
  return { json: () => Promise.reject(error) };
}

function buildHttpError(status: number, body: unknown, url = 'http://localhost/api/guests/7/interactions') {
  return buildKyHttpError(status, body, url);
}

function buildInteraction(overrides: Partial<GuestInteraction> = {}): GuestInteraction {
  return {
    id: 11,
    guest_id: 7,
    interaction_type: 'note',
    note_type: 'general',
    subject: null,
    content: 'Called to confirm arrival time',
    booking_id: null,
    is_alert: false,
    is_private: false,
    follow_up_at: null,
    follow_up_completed_at: null,
    assigned_to: null,
    assigned_to_name: null,
    created_by: 3,
    created_by_name: 'Front Desk',
    created_at: '2026-09-13T04:00:00Z',
    updated_at: '2026-09-13T04:00:00Z',
    ...overrides,
  };
}

describe('GuestRelationsService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    put.mockReset();
    del.mockReset();
  });

  describe('getInteractions', () => {
    it('calls GET guests/<id>/interactions with no params by default', async () => {
      const response = { data: [buildInteraction()], total: 1, page: 1, page_size: 20 };
      get.mockReturnValue(mockJsonResponse(response));

      const result = await GuestRelationsService.getInteractions(7);

      expect(get).toHaveBeenCalledWith('guests/7/interactions', { searchParams: {} });
      expect(result).toEqual(response);
    });

    it('forwards page params and coerces include_completed_followups to a string', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0, page: 2, page_size: 20 }));

      await GuestRelationsService.getInteractions('7', {
        page: 2,
        page_size: 10,
        include_completed_followups: true,
      });

      expect(get).toHaveBeenCalledWith('guests/7/interactions', {
        searchParams: { page: 2, page_size: 10, include_completed_followups: 'true' },
      });
    });

    it('omits include_completed_followups entirely when not provided', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0, page: 1, page_size: 20 }));

      await GuestRelationsService.getInteractions(7, { page: 1 });

      const searchParams = get.mock.calls[0][1].searchParams;
      expect('include_completed_followups' in searchParams).toBe(false);
    });
  });

  describe('createInteraction', () => {
    it('posts the input as json to guests/<id>/interactions', async () => {
      const created = buildInteraction();
      post.mockReturnValue(mockJsonResponse(created));
      const input = { content: 'Called to confirm arrival time', interaction_type: 'call' as const };

      const result = await GuestRelationsService.createInteraction(7, input);

      expect(post).toHaveBeenCalledWith('guests/7/interactions', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('updateInteraction', () => {
    it('patches guests/<id>/interactions/<nid>', async () => {
      const updated = buildInteraction({ subject: 'Updated' });
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await GuestRelationsService.updateInteraction(7, 11, { subject: 'Updated' });

      expect(patch).toHaveBeenCalledWith('guests/7/interactions/11', { json: { subject: 'Updated' } });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteInteraction', () => {
    it('calls DELETE guests/<id>/interactions/<nid>', async () => {
      del.mockReturnValue(mockJsonResponse({ success: true, message: 'deleted' }));

      const result = await GuestRelationsService.deleteInteraction(7, 11);

      expect(del).toHaveBeenCalledWith('guests/7/interactions/11');
      expect(result).toEqual({ success: true, message: 'deleted' });
    });
  });

  describe('getPreferences', () => {
    it('calls GET guests/<id>/preferences', async () => {
      const prefs = [{ id: 1, category: 'room', preference_key: 'floor', preference_value: 'high' }];
      get.mockReturnValue(mockJsonResponse(prefs));

      const result = await GuestRelationsService.getPreferences(7);

      expect(get).toHaveBeenCalledWith('guests/7/preferences');
      expect(result).toEqual(prefs);
    });
  });

  describe('putPreferences', () => {
    it('puts the entries payload to guests/<id>/preferences', async () => {
      const payload = {
        entries: [{ category: 'room' as const, preference_key: 'floor', preference_value: 'high' }],
        replace_categories: ['room' as const],
      };
      put.mockReturnValue(mockJsonResponse(payload.entries));

      const result = await GuestRelationsService.putPreferences(7, payload);

      expect(put).toHaveBeenCalledWith('guests/7/preferences', { json: payload });
      expect(result).toEqual(payload.entries);
    });
  });

  describe('getReviews', () => {
    it('calls GET guests/<id>/reviews', async () => {
      get.mockReturnValue(mockJsonResponse([{ id: 5, overall_rating: 4 }]));

      const result = await GuestRelationsService.getReviews(7);

      expect(get).toHaveBeenCalledWith('guests/7/reviews');
      expect(result).toEqual([{ id: 5, overall_rating: 4 }]);
    });
  });

  describe('respondToReview', () => {
    it('posts the response to guests/<id>/reviews/<rid>/response', async () => {
      post.mockReturnValue(mockJsonResponse({ id: 5, response: 'Thank you' }));

      const result = await GuestRelationsService.respondToReview(7, 5, { response: 'Thank you' });

      expect(post).toHaveBeenCalledWith('guests/7/reviews/5/response', { json: { response: 'Thank you' } });
      expect(result).toEqual({ id: 5, response: 'Thank you' });
    });
  });

  describe('getLoyalty', () => {
    it('calls GET guests/<id>/loyalty and may resolve to null', async () => {
      get.mockReturnValue(mockJsonResponse(null));

      const result = await GuestRelationsService.getLoyalty(7);

      expect(get).toHaveBeenCalledWith('guests/7/loyalty');
      expect(result).toBeNull();
    });
  });

  describe('getVouchers', () => {
    it('calls GET guests/<id>/vouchers', async () => {
      get.mockReturnValue(mockJsonResponse([{ id: 9, code: 'ABC' }]));

      const result = await GuestRelationsService.getVouchers(7);

      expect(get).toHaveBeenCalledWith('guests/7/vouchers');
      expect(result).toEqual([{ id: 9, code: 'ABC' }]);
    });
  });

  describe('getCommunications', () => {
    it('calls GET guests/<id>/communications', async () => {
      const summary = { marketing_opt_in: true, subscriptions: [], recent_deliveries: [] };
      get.mockReturnValue(mockJsonResponse(summary));

      const result = await GuestRelationsService.getCommunications(7);

      expect(get).toHaveBeenCalledWith('guests/7/communications');
      expect(result).toEqual(summary);
    });
  });

  describe('getSupportConversations', () => {
    it('calls GET guests/<id>/support', async () => {
      get.mockReturnValue(mockJsonResponse([{ id: 21, status: 'open' }]));

      const result = await GuestRelationsService.getSupportConversations(7);

      expect(get).toHaveBeenCalledWith('guests/7/support');
      expect(result).toEqual([{ id: 21, status: 'open' }]);
    });
  });

  describe('createSupportConversation', () => {
    it('posts to support/conversations (staff-side route, not guest-scoped)', async () => {
      const payload = { guest_id: 7, category: 'service_request' as const, message: 'Extra towels' };
      post.mockReturnValue(mockJsonResponse({ id: 31 }));

      const result = await GuestRelationsService.createSupportConversation(payload);

      expect(post).toHaveBeenCalledWith('support/conversations', { json: payload });
      expect(result).toEqual({ id: 31 });
    });
  });

  describe('error mapping', () => {
    it('throws the session-expired APIError and dispatches auth:unauthorized on 401', async () => {
      get.mockReturnValue(mockJsonRejection(buildHttpError(401, { error: 'Unauthorized' })));
      const unauthorizedHandler = vi.fn();
      window.addEventListener('auth:unauthorized', unauthorizedHandler);

      await expect(GuestRelationsService.getInteractions(7)).rejects.toMatchObject({
        name: 'APIError',
        message: 'Your session has expired. Please sign in again.',
        statusCode: 401,
      });
      expect(unauthorizedHandler).toHaveBeenCalledTimes(1);

      window.removeEventListener('auth:unauthorized', unauthorizedHandler);
    });

    it('maps a non-401 HTTPError through toApiError with the server message', async () => {
      put.mockReturnValue(mockJsonRejection(buildHttpError(422, { error: 'Unknown category' })));

      await expect(
        GuestRelationsService.putPreferences(7, { entries: [] }),
      ).rejects.toMatchObject({ name: 'APIError', message: 'Unknown category', statusCode: 422 });
    });

    it('uses the per-method fallback message when the error carries none', async () => {
      post.mockReturnValue(mockJsonRejection(new Error('socket hangup')));

      await expect(
        GuestRelationsService.createSupportConversation({ guest_id: 7, category: 'other', message: 'x' }),
      ).rejects.toMatchObject({
        name: 'APIError',
        message: 'Failed to create support conversation',
      });
    });
  });
});
