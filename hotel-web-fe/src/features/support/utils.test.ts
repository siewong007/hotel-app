import { describe, expect, it } from 'vitest';
import type { SupportConversation } from './types';
import { getSupportConversationAccess } from './utils';

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

describe('getSupportConversationAccess', () => {
  it('allows the current assignee to reply, add a note, resolve, and return an active conversation to the queue', () => {
    const access = getSupportConversationAccess(buildConversation(), {
      currentUserId: 7,
      canWrite: true,
      canAssign: true,
      canEscalate: false,
      canManage: false,
    });

    expect(access).toMatchObject({
      isActive: true,
      isAssignedToCurrentUser: true,
      canReply: true,
      canAddInternalNote: true,
      canResolve: true,
      canRelease: true,
      canClaim: false,
      canEscalate: false,
    });
  });

  it('does not expose claim, assignment, or release for resolved conversations', () => {
    const access = getSupportConversationAccess(buildConversation({ status: 'resolved' }), {
      currentUserId: 7,
      canWrite: true,
      canAssign: true,
      canEscalate: true,
      canManage: true,
    });

    expect(access).toMatchObject({
      isActive: false,
      canClaim: false,
      canAssign: false,
      canRelease: false,
      canReply: false,
      canAddInternalNote: false,
      canResolve: false,
      canEscalate: false,
      canClose: true,
      canReopen: true,
    });
    expect(access.blockedReplyMessage).toMatch(/resolved/i);
  });

  it('explains why a write-only user cannot reply to an unassigned conversation', () => {
    const access = getSupportConversationAccess(buildConversation({
      assigned_to_user_id: null,
      assigned_to_name: null,
    }), {
      currentUserId: 7,
      canWrite: true,
      canAssign: false,
      canEscalate: false,
      canManage: false,
    });

    expect(access.canReply).toBe(false);
    expect(access.canClaim).toBe(false);
    expect(access.blockedReplyMessage).toMatch(/coordinator must claim/i);
  });
});

