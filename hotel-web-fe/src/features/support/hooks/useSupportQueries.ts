import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { SupportService } from '../api';
import type {
  SupportActionRequest,
  SupportConversationListParams,
  SupportMessageRequest,
} from '../types';

const supportQueryKeys = {
  all: ['support'] as const,
  conversations: (params: SupportConversationListParams) => ['support', 'conversations', params] as const,
  conversation: (id: number) => ['support', 'conversation', id] as const,
  agents: () => ['support', 'agents'] as const,
};

const SUPPORT_POLL_INTERVAL = 5_000;

function invalidateSupportQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: supportQueryKeys.all });
}

export function useSupportConversations(params: SupportConversationListParams) {
  return useQuery({
    queryKey: supportQueryKeys.conversations(params),
    queryFn: () => SupportService.listConversations(params),
    staleTime: queryStaleTime.realtime,
    refetchInterval: SUPPORT_POLL_INTERVAL,
    refetchIntervalInBackground: false,
  });
}

export function useSupportConversation(id?: number) {
  return useQuery({
    queryKey: supportQueryKeys.conversation(id ?? 0),
    queryFn: () => SupportService.getConversation(id as number),
    enabled: id !== undefined,
    staleTime: queryStaleTime.realtime,
    refetchInterval: SUPPORT_POLL_INTERVAL,
    refetchIntervalInBackground: false,
  });
}

export function useSupportAgents(enabled = true) {
  return useQuery({
    queryKey: supportQueryKeys.agents(),
    queryFn: () => SupportService.listAgents(),
    enabled,
    staleTime: queryStaleTime.standard,
  });
}

export function useSupportAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, payload }: SupportActionRequest) =>
      SupportService.performAction(conversationId, payload),
    onSuccess: () => invalidateSupportQueries(queryClient),
  });
}

export function useSendSupportMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, payload }: SupportMessageRequest) =>
      SupportService.sendMessage(conversationId, payload),
    onSuccess: () => invalidateSupportQueries(queryClient),
  });
}

export { supportQueryKeys };

