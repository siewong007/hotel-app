import { api, toApiError } from '../../api/client';
import type {
  SupportActionPayload,
  SupportAgent,
  SupportConversationDetailResponse,
  SupportConversationListParams,
  SupportConversationListResponse,
  SupportMessagePayload,
} from './types';

function searchParamsFrom(params: SupportConversationListParams): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
}

export class SupportService {
  static async listConversations(
    params: SupportConversationListParams,
  ): Promise<SupportConversationListResponse> {
    try {
      return await api
        .get('support/conversations', { searchParams: searchParamsFrom(params) })
        .json<SupportConversationListResponse>();
    } catch (error) {
      throw toApiError(error, 'Unable to load the support queue');
    }
  }

  static async getConversation(id: number): Promise<SupportConversationDetailResponse> {
    try {
      return await api.get(`support/conversations/${id}`).json<SupportConversationDetailResponse>();
    } catch (error) {
      throw toApiError(error, 'Unable to load this conversation');
    }
  }

  static async listAgents(): Promise<SupportAgent[]> {
    try {
      return await api.get('support/agents').json<SupportAgent[]>();
    } catch (error) {
      throw toApiError(error, 'Unable to load support staff');
    }
  }

  static async sendMessage(
    conversationId: number,
    payload: SupportMessagePayload,
  ): Promise<SupportConversationDetailResponse> {
    try {
      return await api
        .post(`support/conversations/${conversationId}/messages`, { json: payload })
        .json<SupportConversationDetailResponse>();
    } catch (error) {
      throw toApiError(error, 'Unable to send the reply');
    }
  }

  static async performAction(
    conversationId: number,
    payload: SupportActionPayload,
  ): Promise<SupportConversationDetailResponse> {
    try {
      return await api
        .post(`support/conversations/${conversationId}/actions`, { json: payload })
        .json<SupportConversationDetailResponse>();
    } catch (error) {
      throw toApiError(error, 'Unable to update this conversation');
    }
  }
}

export function newSupportClientId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `support-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
