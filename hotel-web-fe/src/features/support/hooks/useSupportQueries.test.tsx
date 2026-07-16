import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listConversations = vi.fn();
const getConversation = vi.fn();
const listAgents = vi.fn();
const performAction = vi.fn();
const sendMessage = vi.fn();

vi.mock('../api', () => ({
  SupportService: {
    listConversations: (...args: unknown[]) => listConversations(...args),
    getConversation: (...args: unknown[]) => getConversation(...args),
    listAgents: (...args: unknown[]) => listAgents(...args),
    performAction: (...args: unknown[]) => performAction(...args),
    sendMessage: (...args: unknown[]) => sendMessage(...args),
  },
}));

import {
  useSendSupportMessage,
  useSupportAction,
  useSupportAgents,
  useSupportConversation,
  useSupportConversations,
} from './useSupportQueries';

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

describe('support query hooks', () => {
  beforeEach(() => {
    listConversations.mockReset();
    getConversation.mockReset();
    listAgents.mockReset();
    performAction.mockReset();
    sendMessage.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads the requested queue and conversation detail through the staff service', async () => {
    const params = { queue: 'waiting_for_staff' as const, page: 2, page_size: 20 };
    const listResponse = { items: [], total: 0, page: 2, page_size: 20 };
    const detailResponse = { conversation: { id: 42 }, messages: [], events: [] };
    listConversations.mockResolvedValue(listResponse);
    getConversation.mockResolvedValue(detailResponse);
    const { wrapper } = createWrapper();

    const list = renderHook(() => useSupportConversations(params), { wrapper });
    const detail = renderHook(() => useSupportConversation(42), { wrapper });

    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));

    expect(listConversations).toHaveBeenCalledWith(params);
    expect(getConversation).toHaveBeenCalledWith(42);
    expect(list.result.current.data).toEqual(listResponse);
    expect(detail.result.current.data).toEqual(detailResponse);
  });

  it('does not request a detail or staff list until each query is enabled', async () => {
    const { wrapper } = createWrapper();

    const detail = renderHook(() => useSupportConversation(undefined), { wrapper });
    const agents = renderHook(() => useSupportAgents(false), { wrapper });

    await waitFor(() => {
      expect(detail.result.current.fetchStatus).toBe('idle');
      expect(agents.result.current.fetchStatus).toBe('idle');
    });
    expect(getConversation).not.toHaveBeenCalled();
    expect(listAgents).not.toHaveBeenCalled();
  });

  it('loads assignable staff only when assignment controls are available', async () => {
    const staff = [{ id: 7, name: 'Mina Lee', is_available: true }];
    listAgents.mockResolvedValue(staff);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSupportAgents(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listAgents).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual(staff);
  });

  it('invalidates every support query after a successful staff action', async () => {
    performAction.mockResolvedValue({ conversation: { id: 42 }, messages: [], events: [] });
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSupportAction(), { wrapper });
    const request = {
      conversationId: 42,
      payload: { action: 'claim' as const, expected_version: 3, client_action_id: 'claim-42' },
    };

    await act(async () => {
      await result.current.mutateAsync(request);
    });

    expect(performAction).toHaveBeenCalledWith(42, request.payload);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['support'] });
  });

  it('invalidates every support query after a successful guest-visible reply', async () => {
    sendMessage.mockResolvedValue({ conversation: { id: 42 }, messages: [], events: [] });
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSendSupportMessage(), { wrapper });
    const request = {
      conversationId: 42,
      payload: {
        message: 'A replacement key is ready at reception.',
        client_message_id: 'reply-42',
        expected_version: 3,
      },
    };

    await act(async () => {
      await result.current.mutateAsync(request);
    });

    expect(sendMessage).toHaveBeenCalledWith(42, request.payload);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['support'] });
  });
});
