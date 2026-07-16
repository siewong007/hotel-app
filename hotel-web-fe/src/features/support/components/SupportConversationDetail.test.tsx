// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportAgent, SupportConversation, SupportConversationDetailResponse } from '../types';

const { newSupportClientId } = vi.hoisted(() => ({
  newSupportClientId: vi.fn(),
}));

vi.mock('../api', () => ({ newSupportClientId }));

import SupportConversationDetail from './SupportConversationDetail';

function buildConversation(overrides: Partial<SupportConversation> = {}): SupportConversation {
  return {
    id: 42,
    conversation_number: 'SUP-0042',
    guest_id: 8,
    guest_name: 'Aisha Rahman',
    category: 'stay',
    status: 'waiting_for_staff',
    priority: 'normal',
    queue: 'front_desk',
    assigned_to_user_id: 7,
    assigned_to_name: 'Mina Lee',
    escalation_level: 0,
    escalated_at: null,
    first_response_due_at: null,
    resolution_due_at: null,
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    last_message_preview: 'Could I have extra towels?',
    last_message_at: '2026-07-15T10:00:00Z',
    last_activity_at: '2026-07-15T10:00:00Z',
    unread_count: 1,
    is_sla_at_risk: false,
    is_sla_breached: false,
    version: 3,
    reopen_count: 0,
    created_at: '2026-07-15T09:00:00Z',
    updated_at: '2026-07-15T10:00:00Z',
    ...overrides,
  };
}

function buildDetail(overrides: Partial<SupportConversation> = {}): SupportConversationDetailResponse {
  return {
    conversation: buildConversation(overrides),
    messages: [
      {
        id: 1,
        conversation_id: 42,
        author_type: 'guest',
        author_user_id: null,
        author_guest_id: 8,
        author_name: 'Aisha Rahman',
        body: 'Could I have extra towels?',
        created_at: '2026-07-15T10:00:00Z',
      },
    ],
    events: [],
  };
}

function renderDetail({
  detail = buildDetail(),
  currentUserId = 7,
  canWrite = true,
  canAssign = false,
  canEscalate = false,
  canManage = false,
  agents = [],
  onAction = vi.fn().mockResolvedValue(undefined),
  onSendMessage = vi.fn().mockResolvedValue(undefined),
}: Partial<React.ComponentProps<typeof SupportConversationDetail>> = {}) {
  render(
    <SupportConversationDetail
      detail={detail}
      isLoading={false}
      agents={agents}
      currentUserId={currentUserId}
      canWrite={canWrite}
      canAssign={canAssign}
      canEscalate={canEscalate}
      canManage={canManage}
      isBusy={false}
      onAction={onAction}
      onSendMessage={onSendMessage}
    />,
  );

  return { onAction, onSendMessage };
}

describe('SupportConversationDetail permissions and actions', () => {
  beforeEach(() => {
    newSupportClientId.mockReset();
    newSupportClientId.mockReturnValue('support-client-id');
  });

  afterEach(() => {
    cleanup();
  });

  it('does not expose claim or return-to-queue controls for a resolved conversation', () => {
    renderDetail({
      detail: buildDetail({ status: 'resolved' }),
      canAssign: true,
      canEscalate: true,
      canManage: true,
    });

    expect(screen.queryByRole('button', { name: 'Claim' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Return to queue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeDefined();
    expect(screen.getByText(/resolved\. reopen it/i)).toBeDefined();
  });

  it('blocks a staff member from replying to another assignee conversation', () => {
    renderDetail({
      detail: buildDetail({ assigned_to_user_id: 99, assigned_to_name: 'Another agent' }),
      currentUserId: 7,
      canWrite: true,
      canAssign: false,
    });

    expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Internal note' })).toBeNull();
    expect(screen.getByText(/assigned to another support staff member/i)).toBeDefined();
  });

  it('sends an assignee reply with the current optimistic version and a client message id', async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    renderDetail({ onSendMessage });

    fireEvent.change(screen.getByLabelText('Reply to guest'), {
      target: { value: 'Fresh towels will arrive shortly.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith({
        message: 'Fresh towels will arrive shortly.',
        client_message_id: 'support-client-id',
        expected_version: 3,
      });
    });
  });

  it('reuses a reply client id when the first response is lost and the staff member retries', async () => {
    newSupportClientId
      .mockReturnValueOnce('first-message-id')
      .mockReturnValueOnce('second-message-id');
    const onSendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('Network interrupted'))
      .mockResolvedValueOnce(undefined);
    renderDetail({ onSendMessage });

    fireEvent.change(screen.getByLabelText('Reply to guest'), {
      target: { value: 'Fresh towels will arrive shortly.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(screen.getByText('Network interrupted')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
    expect(onSendMessage.mock.calls.map(([payload]) => payload.client_message_id)).toEqual([
      'first-message-id',
      'first-message-id',
    ]);
    expect(newSupportClientId).toHaveBeenCalledTimes(1);
  });

  it('reuses an action client id when a claim is retried after a lost response', async () => {
    newSupportClientId
      .mockReturnValueOnce('first-action-id')
      .mockReturnValueOnce('second-action-id');
    const onAction = vi.fn()
      .mockRejectedValueOnce(new Error('Network interrupted'))
      .mockResolvedValueOnce(undefined);
    renderDetail({
      detail: buildDetail({ assigned_to_user_id: null, assigned_to_name: null }),
      canAssign: true,
      onAction,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    await waitFor(() => expect(screen.getByText('Network interrupted')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));

    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    expect(onAction.mock.calls.map(([payload]) => payload.client_action_id)).toEqual([
      'first-action-id',
      'first-action-id',
    ]);
    expect(newSupportClientId).toHaveBeenCalledTimes(1);
  });

  it('adds an internal note as a staff-only action with optimistic-concurrency metadata', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    renderDetail({ onAction, onSendMessage });

    fireEvent.click(screen.getByRole('tab', { name: 'Internal note' }));
    fireEvent.change(screen.getByLabelText('Internal note'), {
      target: { value: '  Guest requested a quiet room.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add internal note' }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({
      action: 'add_internal_note',
      reason: 'Guest requested a quiet room.',
      expected_version: 3,
      client_action_id: 'support-client-id',
    }));
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(screen.getByText(/only visible to hotel staff/i)).toBeDefined();
  });

  it('assigns a conversation with the selected staff member and an optional handoff note', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const agents: SupportAgent[] = [
      { id: 11, name: 'Mina Lee', is_available: true },
      { id: 12, name: 'Unavailable agent', is_available: false },
    ];
    renderDetail({ canAssign: true, agents, onAction });

    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Assignee' }));
    fireEvent.click(screen.getByRole('option', { name: 'Mina Lee' }));
    fireEvent.change(within(dialog).getByLabelText('Handoff note (optional)'), {
      target: { value: 'Please follow up before check-in.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({
      action: 'assign',
      assignee_id: 11,
      reason: 'Please follow up before check-in.',
      expected_version: 3,
      client_action_id: 'support-client-id',
    }));
  });

  it('requires a guest-visible code and summary before resolving a conversation', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    renderDetail({ onAction });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const dialog = screen.getByRole('dialog');
    const resolveButton = within(dialog).getByRole('button', { name: 'Resolve' }) as HTMLButtonElement;
    expect(resolveButton.disabled).toBe(true);

    fireEvent.change(within(dialog).getByPlaceholderText('For example: request_completed'), {
      target: { value: 'request_completed' },
    });
    fireEvent.change(within(dialog).getAllByRole('textbox')[1], {
      target: { value: 'Fresh towels will arrive within ten minutes.' },
    });
    expect(resolveButton.disabled).toBe(false);
    fireEvent.click(resolveButton);

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({
      action: 'resolve',
      resolution_code: 'request_completed',
      resolution_summary: 'Fresh towels will arrive within ten minutes.',
      expected_version: 3,
      client_action_id: 'support-client-id',
    }));
  });

  it.each(['resolved', 'closed'] as const)(
    'allows a manager to reopen a %s conversation with the current version',
    async (status) => {
      const onAction = vi.fn().mockResolvedValue(undefined);
      renderDetail({
        detail: buildDetail({ status }),
        canManage: true,
        onAction,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Reopen reason (optional)'), {
        target: { value: 'The guest has sent new information.' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reopen' }));

      await waitFor(() => expect(onAction).toHaveBeenCalledWith({
        action: 'reopen',
        reason: 'The guest has sent new information.',
        expected_version: 3,
        client_action_id: 'support-client-id',
      }));
      expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
    },
  );
});
