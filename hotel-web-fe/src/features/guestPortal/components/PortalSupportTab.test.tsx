import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMutation: { isPending: false, mutateAsync: vi.fn() },
  detailQuery: { data: undefined as unknown, error: null as unknown, isLoading: false, refetch: vi.fn() },
  listQuery: { data: undefined as unknown, error: null as unknown, isLoading: false, refetch: vi.fn() },
  reopenMutation: { isPending: false, mutateAsync: vi.fn() },
  sendMutation: { isPending: false, mutateAsync: vi.fn() },
  newClientId: vi.fn(),
}));

vi.mock('../hooks/usePortalSupport', () => ({
  newPortalSupportClientId: () => mocks.newClientId(),
  useCreatePortalSupportConversation: () => mocks.createMutation,
  usePortalSupportConversation: () => mocks.detailQuery,
  usePortalSupportConversations: () => mocks.listQuery,
  useReopenPortalSupportConversation: () => mocks.reopenMutation,
  useSendPortalSupportMessage: () => mocks.sendMutation,
}));

import { PortalSupportTab } from './PortalSupportTab';

const conversation = {
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
} as const;

const detail = {
  conversation,
  messages: [
    {
      id: 1,
      body: 'I need help with my arrival.',
      author_type: 'guest',
      created_at: '2026-07-15T09:00:00Z',
    },
  ],
} as const;

function setList(items: readonly typeof conversation[] = [], enabled = true) {
  mocks.listQuery.data = {
    items,
    categories: ['booking', 'stay', 'billing', 'loyalty', 'technical', 'other'],
    enabled,
    total: items.length,
    page: 1,
    page_size: 50,
  };
}

describe('PortalSupportTab', () => {
  beforeEach(() => {
    cleanup();
    mocks.createMutation.mutateAsync.mockReset();
    mocks.reopenMutation.mutateAsync.mockReset();
    mocks.sendMutation.mutateAsync.mockReset();
    mocks.newClientId.mockReset();
    mocks.newClientId.mockImplementation(() => `client-${mocks.newClientId.mock.calls.length}`);
    mocks.listQuery.error = null;
    mocks.listQuery.isLoading = false;
    mocks.listQuery.refetch.mockReset();
    mocks.detailQuery.data = undefined;
    mocks.detailQuery.error = null;
    mocks.detailQuery.isLoading = false;
    mocks.detailQuery.refetch.mockReset();
    setList();
  });

  afterEach(() => {
    cleanup();
  });

  it('guides a guest through safe, validated support intake', async () => {
    mocks.createMutation.mutateAsync.mockResolvedValue(detail);

    render(<PortalSupportTab token="guest-session-token" />);

    expect(screen.getByText(/support chat is not monitored for emergencies/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /contact support/i }));

    fireEvent.click(screen.getByRole('button', { name: /^send message$/i }));
    expect(screen.getByText('Please describe how we can help.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('How can we help?'), {
      target: { value: 'I need to tell the hotel I will arrive after midnight.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send message$/i }));

    await waitFor(() => expect(mocks.createMutation.mutateAsync).toHaveBeenCalledOnce());
    expect(mocks.createMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      category: 'booking',
      message: 'I need to tell the hotel I will arrive after midnight.',
      client_request_id: expect.any(String),
    }));
  });

  it('keeps the same idempotency id when a guest retries a reply after an error', async () => {
    setList([conversation]);
    mocks.detailQuery.data = detail;
    mocks.sendMutation.mutateAsync
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValueOnce(detail);

    render(<PortalSupportTab token="guest-session-token" />);

    fireEvent.change(screen.getByLabelText('Reply to hotel support'), {
      target: { value: 'I will arrive after midnight.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reply/i }));

    await waitFor(() => expect(screen.getByText('Connection interrupted')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /send reply/i }));

    await waitFor(() => expect(mocks.sendMutation.mutateAsync).toHaveBeenCalledTimes(2));
    const firstPayload = mocks.sendMutation.mutateAsync.mock.calls[0][0];
    const retriedPayload = mocks.sendMutation.mutateAsync.mock.calls[1][0];
    expect(firstPayload).toMatchObject({
      conversationId: 17,
      message: 'I will arrive after midnight.',
      expectedVersion: 4,
    });
    expect(retriedPayload.clientMessageId).toBe(firstPayload.clientMessageId);
  });

  it('does not invite a guest to start a conversation while support is disabled', () => {
    setList([], false);

    render(<PortalSupportTab token="guest-session-token" />);

    expect(screen.getByText(/not accepting new support conversations/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /new conversation/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /contact support/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
