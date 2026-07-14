import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { GuestPortalSupportService } from './guestPortalSupport.service';

function jsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

describe('GuestPortalSupportService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    window.sessionStorage.clear();
  });

  it('lists only the signed-in guest’s conversations with the portal bearer token', async () => {
    const response = {
      items: [],
      categories: ['booking'],
      enabled: true,
      total: 0,
      page: 2,
      page_size: 20,
    };
    get.mockReturnValue(jsonResponse(response));

    await expect(
      GuestPortalSupportService.listConversations('guest-session-token', { page: 2, page_size: 20 }),
    ).resolves.toEqual(response);

    expect(get).toHaveBeenCalledWith('guest-portal/me/support/conversations', {
      headers: { Authorization: 'Bearer guest-session-token' },
      searchParams: { page: 2, page_size: 20 },
    });
  });

  it('uses an encoded conversation path and does not fall back to a staff endpoint', async () => {
    get.mockReturnValue(jsonResponse({ conversation: {}, messages: [] }));

    await GuestPortalSupportService.getConversation('guest / conversation', 'guest-session-token');

    expect(get).toHaveBeenCalledWith('guest-portal/me/support/conversations/guest%20%2F%20conversation', {
      headers: { Authorization: 'Bearer guest-session-token' },
    });
  });

  it('posts a new guest conversation with its idempotency key intact', async () => {
    const request = {
      category: 'billing' as const,
      message: 'Please help with my invoice.',
      client_request_id: 'new-conversation-1',
    };
    post.mockReturnValue(jsonResponse({ conversation: {}, messages: [] }));

    await GuestPortalSupportService.createConversation(request, 'guest-session-token');

    expect(post).toHaveBeenCalledWith('guest-portal/me/support/conversations', {
      headers: { Authorization: 'Bearer guest-session-token' },
      json: request,
    });
  });

  it('posts a reply with concurrency and retry metadata to the guest route', async () => {
    const request = {
      message: 'Thank you, I can provide more details.',
      client_message_id: 'message-1',
      expected_version: 4,
    };
    post.mockReturnValue(jsonResponse({ conversation: {}, messages: [] }));

    await GuestPortalSupportService.sendMessage(17, request, 'guest-session-token');

    expect(post).toHaveBeenCalledWith('guest-portal/me/support/conversations/17/messages', {
      headers: { Authorization: 'Bearer guest-session-token' },
      json: request,
    });
  });

  it('reopens a conversation through the guest-specific action route', async () => {
    post.mockReturnValue(jsonResponse({ conversation: {}, messages: [] }));

    await GuestPortalSupportService.reopenConversation(17, 'guest-session-token');

    expect(post).toHaveBeenCalledWith('guest-portal/me/support/conversations/17/reopen', {
      headers: { Authorization: 'Bearer guest-session-token' },
      json: {},
    });
  });

  it('rejects a request with no guest session before making an API call', async () => {
    await expect(GuestPortalSupportService.listConversations()).rejects.toThrow(
      'Not signed in to the guest portal',
    );
    expect(get).not.toHaveBeenCalled();
  });
});
