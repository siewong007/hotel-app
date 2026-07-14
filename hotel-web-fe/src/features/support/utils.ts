import type { SupportConversation } from './types';

export interface SupportConversationPermissions {
  currentUserId?: number;
  canWrite: boolean;
  canAssign: boolean;
  canEscalate: boolean;
  canManage: boolean;
}

export interface SupportConversationAccess {
  isActive: boolean;
  isAssignedToCurrentUser: boolean;
  canClaim: boolean;
  canAssign: boolean;
  canRelease: boolean;
  canReply: boolean;
  canAddInternalNote: boolean;
  canEscalate: boolean;
  canResolve: boolean;
  canClose: boolean;
  canReopen: boolean;
  blockedReplyMessage: string | null;
}

/**
 * Keep conversation action eligibility in one pure, testable place. The UI is
 * only a convenience layer; the backend still validates every transition.
 */
export function getSupportConversationAccess(
  conversation: SupportConversation,
  permissions: SupportConversationPermissions,
): SupportConversationAccess {
  const isActive = conversation.status === 'waiting_for_staff'
    || conversation.status === 'waiting_for_guest';
  const isAssignedToCurrentUser = permissions.currentUserId !== undefined
    && conversation.assigned_to_user_id === permissions.currentUserId;
  const isUnassigned = !conversation.assigned_to_user_id;
  const canWorkOnConversation = permissions.canManage
    || isAssignedToCurrentUser
    || (isUnassigned && permissions.canAssign);
  const canReply = permissions.canWrite && canWorkOnConversation && isActive;
  const canAddInternalNote = permissions.canWrite
    && isActive
    && (permissions.canManage || isAssignedToCurrentUser);
  const canResolve = permissions.canWrite
    && isActive
    && (permissions.canManage || isAssignedToCurrentUser);
  const canClaim = permissions.canAssign && isUnassigned && isActive;
  const canAssign = permissions.canAssign && isActive;
  const canRelease = permissions.canAssign
    && isActive
    && !isUnassigned
    && (permissions.canManage || isAssignedToCurrentUser);

  let blockedReplyMessage: string | null = null;
  if (!canReply) {
    if (!isActive) {
      blockedReplyMessage = conversation.status === 'closed'
        ? 'This conversation must be reopened before another reply or internal note can be added.'
        : 'This conversation is resolved. Reopen it before sending another reply or internal note.';
    } else if (isUnassigned && permissions.canWrite && !permissions.canAssign) {
      blockedReplyMessage = 'A support coordinator must claim this conversation before you can reply.';
    } else if (conversation.assigned_to_user_id && !isAssignedToCurrentUser && !permissions.canManage) {
      blockedReplyMessage = 'This conversation is assigned to another support staff member.';
    } else {
      blockedReplyMessage = 'You do not have permission to reply to this conversation.';
    }
  }

  return {
    isActive,
    isAssignedToCurrentUser,
    canClaim,
    canAssign,
    canRelease,
    canReply,
    canAddInternalNote,
    canEscalate: permissions.canEscalate && isActive,
    canResolve,
    canClose: permissions.canManage && conversation.status === 'resolved',
    canReopen: permissions.canManage && (conversation.status === 'resolved' || conversation.status === 'closed'),
    blockedReplyMessage,
  };
}

