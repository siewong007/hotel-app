import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: {
      get: (...args: unknown[]) => get(...args),
      post: (...args: unknown[]) => post(...args),
    },
  };
});

import { SupportService } from './api';
import type { SupportActionPayload, SupportMessagePayload } from './types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

describe('SupportService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('forwards populated queue filters and omits empty values', async () => {
    get.mockReturnValue(mockJsonResponse({ items: [], total: 0, page: 2, page_size: 20 }));

    await SupportService.listConversations({
      queue: 'mine',
      status: 'waiting_for_staff',
      priority: 'high',
      assigned_to_user_id: 7,
      search: 'Aisha',
      page: 2,
      page_size: 20,
    });

    expect(get).toHaveBeenCalledWith('support/conversations', {
      searchParams: {
        queue: 'mine',
        status: 'waiting_for_staff',
        priority: 'high',
        assigned_to_user_id: '7',
        search: 'Aisha',
        page: '2',
        page_size: '20',
      },
    });

    get.mockReturnValue(mockJsonResponse({ items: [], total: 0, page: 1, page_size: 20 }));
    await SupportService.listConversations({ search: '', page: 1, page_size: 20 });

    expect(get).toHaveBeenLastCalledWith('support/conversations', {
      searchParams: { page: '1', page_size: '20' },
    });
  });

  it('uses the support detail and assignee endpoints', async () => {
    get.mockReturnValue(mockJsonResponse({ conversation: {}, messages: [], events: [] }));

    await SupportService.getConversation(42);
    expect(get).toHaveBeenLastCalledWith('support/conversations/42');

    get.mockReturnValue(mockJsonResponse([]));
    await SupportService.listAgents();
    expect(get).toHaveBeenLastCalledWith('support/agents');
  });

  it('posts guest-visible replies with the idempotency and version fields intact', async () => {
    const payload: SupportMessagePayload = {
      message: 'We can help with that.',
      client_message_id: 'message-retry-id',
      expected_version: 4,
    };
    post.mockReturnValue(mockJsonResponse({ conversation: {}, messages: [], events: [] }));

    await SupportService.sendMessage(42, payload);

    expect(post).toHaveBeenCalledWith('support/conversations/42/messages', { json: payload });
  });

  it('posts staff actions with the backend action payload unchanged', async () => {
    const payload: SupportActionPayload = {
      action: 'resolve',
      expected_version: 4,
      resolution_code: 'request_completed',
      resolution_summary: 'A replacement key was prepared at reception.',
      client_action_id: 'action-retry-id',
    };
    post.mockReturnValue(mockJsonResponse({ conversation: {}, messages: [], events: [] }));

    await SupportService.performAction(42, payload);

    expect(post).toHaveBeenCalledWith('support/conversations/42/actions', { json: payload });
  });
});

