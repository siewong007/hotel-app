import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { GuestPortalSupportService } from '../api/guestPortalSupport.service';
import type {
  CreatePortalSupportConversationRequest,
  PortalSupportConversationDetail,
  PortalSupportConversationId,
} from '../support/types';

const supportKeyPrefix = ['guest-portal', 'support'] as const;

const supportQueryKeys = {
  list: (token: string) => [...supportKeyPrefix, 'list', token] as const,
  detail: (token: string, conversationId: PortalSupportConversationId) =>
    [...supportKeyPrefix, 'detail', token, String(conversationId)] as const,
};

export function newPortalSupportClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function usePortalSupportConversations(token: string, enabled = true) {
  return useQuery({
    queryKey: supportQueryKeys.list(token),
    queryFn: () => GuestPortalSupportService.listConversations(token, { page: 1, page_size: 50 }),
    enabled: enabled && Boolean(token),
    staleTime: queryStaleTime.realtime,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function usePortalSupportConversation(
  token: string,
  conversationId: PortalSupportConversationId | null,
) {
  return useQuery({
    queryKey: supportQueryKeys.detail(token, conversationId ?? 'none'),
    queryFn: () => GuestPortalSupportService.getConversation(conversationId as PortalSupportConversationId, token),
    enabled: Boolean(token) && conversationId !== null,
    staleTime: queryStaleTime.realtime,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

function updateDetailCache(
  queryClient: ReturnType<typeof useQueryClient>,
  token: string,
  detail: PortalSupportConversationDetail,
) {
  queryClient.setQueryData(supportQueryKeys.detail(token, detail.conversation.id), detail);
  void queryClient.invalidateQueries({ queryKey: supportKeyPrefix });
}

export function useCreatePortalSupportConversation(token: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreatePortalSupportConversationRequest) =>
      GuestPortalSupportService.createConversation(request, token),
    onSuccess: detail => updateDetailCache(queryClient, token, detail),
  });
}

export function useSendPortalSupportMessage(token: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      message,
      expectedVersion,
      clientMessageId,
    }: {
      conversationId: PortalSupportConversationId;
      message: string;
      expectedVersion: number;
      clientMessageId: string;
    }) =>
      GuestPortalSupportService.sendMessage(
        conversationId,
        {
          message,
          // The caller owns this id for the lifetime of its unsent draft. If a
          // response is lost, retrying the same draft must preserve the id so
          // the backend can return the original result instead of duplicating
          // a guest message.
          client_message_id: clientMessageId,
          expected_version: expectedVersion,
        },
        token,
      ),
    onSuccess: detail => updateDetailCache(queryClient, token, detail),
  });
}

export function useReopenPortalSupportConversation(token: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId: PortalSupportConversationId) =>
      GuestPortalSupportService.reopenConversation(conversationId, token),
    onSuccess: detail => updateDetailCache(queryClient, token, detail),
  });
}
