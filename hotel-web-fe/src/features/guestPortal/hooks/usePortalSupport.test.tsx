import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listConversations = vi.fn();
const createConversation = vi.fn();
const getConversation = vi.fn();
const sendMessage = vi.fn();
const reopenConversation = vi.fn();

vi.mock('../api/guestPortalSupport.service', () => ({
  GuestPortalSupportService: {
    listConversations: (...args: unknown[]) => listConversations(...args),
    createConversation: (...args: unknown[]) => createConversation(...args),
    getConversation: (...args: unknown[]) => getConversation(...args),
    sendMessage: (...args: unknown[]) => sendMessage(...args),
    reopenConversation: (...args: unknown[]) => reopenConversation(...args),
  },
}));

import {
  newPortalSupportClientId,
  useCreatePortalSupportConversation,
  usePortalSupportConversations,
  useSendPortalSupportMessage,
} from './usePortalSupport';

const TOKEN = 'guest-session-token';

const detail = {
  conversation: {
    id: 17,
    category: 'booking',
    status: 'waiting_for_staff',
    assigned_team: 'front_desk',
    booking_id: 4,
    subject: null,
    created_at: '2026-07-15T09:00:00Z',
    updated_at: '2026-07-15T09:00:00Z',
    last_activity_at: '2026-07-15T09:00:00Z',
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    resolution_summary: null,
    can_reopen: false,
    version: 4,
  },
  messages: [
    {
      id: 10,
      body: 'Can you help with my arrival?',
      author_type: 'guest',
      created_at: '2026-07-15T09:00:00Z',
    },
  ],
} as const;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

describe('portal support hooks', () => {
  beforeEach(() => {
    listConversations.mockReset();
    createConversation.mockReset();
    getConversation.mockReset();
    sendMessage.mockReset();
    reopenConversation.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads the guest support list with a bounded first page', async () => {
    const response = {
      items: [detail.conversation],
      categories: ['booking'],
      enabled: true,
      total: 1,
      page: 1,
      page_size: 50,
    };
    listConversations.mockResolvedValue(response);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePortalSupportConversations(TOKEN), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listConversations).toHaveBeenCalledWith(TOKEN, { page: 1, page_size: 50 });
    expect(result.current.data).toEqual(response);
  });

  it('stores a newly created conversation as detail data and refreshes the guest list', async () => {
    createConversation.mockResolvedValue(detail);
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreatePortalSupportConversation(TOKEN), { wrapper });
    const request = {
      category: 'booking' as const,
      message: 'I need help arriving late.',
      client_request_id: 'create-17',
    };

    await act(async () => {
      await result.current.mutateAsync(request);
    });

    expect(createConversation).toHaveBeenCalledWith(request, TOKEN);
    expect(queryClient.getQueryData(['guest-portal', 'support', 'detail', TOKEN, '17'])).toEqual(detail);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['guest-portal', 'support'] });
  });

  it('preserves retry and optimistic-concurrency metadata when retrying a guest reply', async () => {
    sendMessage
      .mockRejectedValueOnce(new Error('The response was lost'))
      .mockResolvedValueOnce(detail);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSendPortalSupportMessage(TOKEN), { wrapper });
    const reply = {
      conversationId: 17,
      message: 'I will arrive after midnight.',
      expectedVersion: 4,
      clientMessageId: 'message-17',
    };

    await act(async () => {
      await expect(result.current.mutateAsync(reply)).rejects.toThrow('The response was lost');
    });

    await act(async () => {
      await result.current.mutateAsync(reply);
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 17, {
      message: 'I will arrive after midnight.',
      client_message_id: 'message-17',
      expected_version: 4,
    }, TOKEN);
    expect(sendMessage).toHaveBeenNthCalledWith(2, 17, {
      message: 'I will arrive after midnight.',
      client_message_id: 'message-17',
      expected_version: 4,
    }, TOKEN);
  });

  it('uses the platform UUID helper when it is available', () => {
    const randomUUID = vi.fn(() => 'portal-uuid');
    vi.stubGlobal('crypto', { randomUUID });

    expect(newPortalSupportClientId()).toBe('portal-uuid');
    expect(randomUUID).toHaveBeenCalledOnce();
  });
});
