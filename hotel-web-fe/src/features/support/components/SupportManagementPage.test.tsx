import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actionMutation: { isPending: false, mutateAsync: vi.fn() },
  agentsQuery: { data: [], error: null as unknown, isLoading: false, isFetching: false },
  detailQuery: { data: undefined as unknown, error: null as unknown, isLoading: false, isFetching: false, refetch: vi.fn() },
  hasPermission: vi.fn(),
  lastDetailProps: null as Record<string, unknown> | null,
  lastListProps: null as Record<string, unknown> | null,
  lastQueueParams: null as Record<string, unknown> | null,
  messageMutation: { isPending: false, mutateAsync: vi.fn() },
  queueQuery: { data: undefined as unknown, error: null as unknown, isLoading: false, isFetching: false, refetch: vi.fn() },
  useSupportAction: vi.fn(),
  useSendSupportMessage: vi.fn(),
  useSupportAgents: vi.fn(),
  useSupportConversation: vi.fn(),
  useSupportConversations: vi.fn(),
  user: { id: 7 },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, user: mocks.user }),
}));

vi.mock('../hooks/useSupportQueries', () => ({
  useSendSupportMessage: () => mocks.useSendSupportMessage(),
  useSupportAction: () => mocks.useSupportAction(),
  useSupportAgents: (...args: unknown[]) => mocks.useSupportAgents(...args),
  useSupportConversation: (...args: unknown[]) => mocks.useSupportConversation(...args),
  useSupportConversations: (...args: unknown[]) => mocks.useSupportConversations(...args),
}));

vi.mock('./SupportConversationList', () => ({
  default: (props: {
    conversations: Array<{ id: number; guest_name: string }>;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    onSelect: (id: number) => void;
  }) => {
    mocks.lastListProps = props;
    return (
      <section aria-label="Mocked conversation list">
        <span>{props.conversations.map(conversation => conversation.guest_name).join(', ') || 'No items'}</span>
        <button onClick={() => props.onSelect(43)}>Select conversation 43</button>
        <button onClick={() => props.onPageChange(3)}>Go to page 3</button>
        <button onClick={() => props.onPageSizeChange(50)}>Use 50 rows</button>
      </section>
    );
  },
}));

vi.mock('./SupportConversationDetail', () => ({
  default: (props: {
    onAction: (payload: { action: string; expected_version: number }) => Promise<void>;
    onSendMessage: (payload: { message: string; client_message_id: string; expected_version: number }) => Promise<void>;
  }) => {
    mocks.lastDetailProps = props;
    return (
      <section aria-label="Mocked conversation detail">
        <button onClick={() => void props.onAction({ action: 'claim', expected_version: 3 })}>Claim selected conversation</button>
        <button onClick={() => void props.onSendMessage({
          message: 'A staff reply',
          client_message_id: 'message-43',
          expected_version: 3,
        })}>Reply to selected conversation</button>
      </section>
    );
  },
}));

import SupportManagementPage from './SupportManagementPage';

const conversations = [
  { id: 42, guest_name: 'Aisha Rahman' },
  { id: 43, guest_name: 'Daniel Tan' },
];

function setQueueData() {
  mocks.queueQuery.data = {
    items: conversations,
    total: conversations.length,
    page: 1,
    page_size: 20,
    metrics: { waiting_for_staff: 2, mine: 1, unassigned: 1 },
  };
}

describe('SupportManagementPage', () => {
  beforeEach(() => {
    mocks.actionMutation.isPending = false;
    mocks.actionMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.agentsQuery.data = [];
    mocks.agentsQuery.error = null;
    mocks.detailQuery.data = undefined;
    mocks.detailQuery.error = null;
    mocks.detailQuery.isLoading = false;
    mocks.detailQuery.isFetching = false;
    mocks.detailQuery.refetch.mockReset();
    mocks.hasPermission.mockReset().mockReturnValue(false);
    mocks.lastDetailProps = null;
    mocks.lastListProps = null;
    mocks.lastQueueParams = null;
    mocks.messageMutation.isPending = false;
    mocks.messageMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.queueQuery.error = null;
    mocks.queueQuery.isLoading = false;
    mocks.queueQuery.isFetching = false;
    mocks.queueQuery.refetch.mockReset();
    setQueueData();
    mocks.useSupportAction.mockReset().mockReturnValue(mocks.actionMutation);
    mocks.useSendSupportMessage.mockReset().mockReturnValue(mocks.messageMutation);
    mocks.useSupportAgents.mockReset().mockReturnValue(mocks.agentsQuery);
    mocks.useSupportConversation.mockReset().mockReturnValue(mocks.detailQuery);
    mocks.useSupportConversations.mockReset().mockImplementation((params: Record<string, unknown>) => {
      mocks.lastQueueParams = params;
      return mocks.queueQuery;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('uses the needs-reply queue by default, selects the first conversation, and keeps read-only staff informed', async () => {
    render(<SupportManagementPage />);

    expect(screen.getByText(/read-only access to the guest support queue/i)).toBeDefined();
    expect(mocks.lastQueueParams).toMatchObject({ queue: 'waiting_for_staff', page: 1, page_size: 20 });
    await waitFor(() => expect(mocks.useSupportConversation).toHaveBeenLastCalledWith(42));
    expect(screen.getByText('Aisha Rahman, Daniel Tan')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh the queue' }));
    expect(mocks.queueQuery.refetch).toHaveBeenCalledOnce();
    expect(mocks.detailQuery.refetch).toHaveBeenCalledOnce();
  });

  it('updates queue, search, and pagination filters before loading the staff queue', async () => {
    render(<SupportManagementPage />);

    fireEvent.click(screen.getByRole('tab', { name: /^mine/i }));
    await waitFor(() => expect(mocks.lastQueueParams).toMatchObject({ queue: 'mine', page: 1 }));

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Daniel' } });
    await waitFor(() => expect(mocks.lastQueueParams).toMatchObject({ queue: 'mine', search: 'Daniel', page: 1 }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }));
    fireEvent.click(screen.getByRole('option', { name: /waiting for guest/i }));
    await waitFor(() => expect(mocks.lastQueueParams).toMatchObject({
      queue: 'mine',
      search: 'Daniel',
      status: 'waiting_for_guest',
      page: 1,
    }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Priority' }));
    fireEvent.click(screen.getByRole('option', { name: 'High' }));
    await waitFor(() => expect(mocks.lastQueueParams).toMatchObject({
      queue: 'mine',
      search: 'Daniel',
      status: 'waiting_for_guest',
      priority: 'high',
      page: 1,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }));
    await waitFor(() => expect(mocks.lastQueueParams).toMatchObject({
      queue: 'mine',
      search: 'Daniel',
      status: 'waiting_for_guest',
      priority: 'high',
      page: 3,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Use 50 rows' }));
    await waitFor(() => expect(mocks.lastQueueParams).toMatchObject({
      queue: 'mine',
      search: 'Daniel',
      status: 'waiting_for_guest',
      priority: 'high',
      page: 1,
      page_size: 50,
    }));
  });

  it('updates the selected conversation and routes core actions and replies to that id', async () => {
    mocks.hasPermission.mockImplementation((permission: string) => permission === 'support:manage');
    render(<SupportManagementPage />);

    await waitFor(() => expect(mocks.useSupportConversation).toHaveBeenLastCalledWith(42));
    fireEvent.click(screen.getByRole('button', { name: 'Select conversation 43' }));
    await waitFor(() => expect(mocks.useSupportConversation).toHaveBeenLastCalledWith(43));

    fireEvent.click(screen.getByRole('button', { name: 'Claim selected conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply to selected conversation' }));

    await waitFor(() => expect(mocks.actionMutation.mutateAsync).toHaveBeenCalledWith({
      conversationId: 43,
      payload: { action: 'claim', expected_version: 3 },
    }));
    await waitFor(() => expect(mocks.messageMutation.mutateAsync).toHaveBeenCalledWith({
      conversationId: 43,
      payload: { message: 'A staff reply', client_message_id: 'message-43', expected_version: 3 },
    }));
  });

  it('surfaces queue, detail, or staff-loading errors to the support operator', () => {
    mocks.queueQuery.error = new Error('The support queue is unavailable');

    render(<SupportManagementPage />);

    expect(screen.getByText('The support queue is unavailable')).toBeDefined();
  });
});
