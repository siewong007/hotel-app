// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportConversation, SupportConversationDetailResponse } from '../types';

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
  onAction = vi.fn().mockResolvedValue(undefined),
  onSendMessage = vi.fn().mockResolvedValue(undefined),
}: Partial<React.ComponentProps<typeof SupportConversationDetail>> = {}) {
  render(
    <SupportConversationDetail
      detail={detail}
      isLoading={false}
      agents={[]}
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
});

