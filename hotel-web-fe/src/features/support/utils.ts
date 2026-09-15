import { t as translate } from '../../i18n';
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
 *
 * `t` is optional so tests can exercise the pure permission matrix without a
 * translator; when omitted the module-level `t` (bound to the active locale)
 * supplies the `support:` message. Callers that render `blockedReplyMessage`
 * should still pass their `useTranslation('support')` `t` so the text
 * re-renders on language switch.
 */
export function getSupportConversationAccess(
  conversation: SupportConversation,
  permissions: SupportConversationPermissions,
  t?: (key: string) => string,
): SupportConversationAccess {
  const tt = t ?? ((key: string) => translate(`support:${key}`));
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
        ? tt('access.blockedClosed')
        : tt('access.blockedResolved');
    } else if (isUnassigned && permissions.canWrite && !permissions.canAssign) {
      blockedReplyMessage = tt('access.blockedNeedsClaim');
    } else if (conversation.assigned_to_user_id && !isAssignedToCurrentUser && !permissions.canManage) {
      blockedReplyMessage = tt('access.blockedOtherAssignee');
    } else {
      blockedReplyMessage = tt('access.blockedNoPermission');
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

