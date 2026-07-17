import { api } from '../../../api/client';
import { apiUrl } from '../../../desktop/runtimeApi';
import { getPortalToken } from './portalTokenStore';
import type {
  CreatePortalSupportConversationRequest,
  CreatePortalSupportMessageRequest,
  PortalSupportConversationDetail,
  PortalSupportConversationId,
  PortalSupportConversationListResponse,
} from '../support/types';

const SUPPORT_PATH = 'guest-portal/me/support/conversations';

export function guestSupportWebSocketUrl(): string {
  const httpUrl = new URL(apiUrl('guest-portal/me/support/socket'), window.location.origin);
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return httpUrl.toString();
}

function authHeaders(token?: string): Record<string, string> {
  const guestToken = token ?? getPortalToken();
  if (!guestToken) {
    throw new Error('Not signed in to the guest portal');
  }

  return { Authorization: `Bearer ${guestToken}` };
}

/**
 * Guest-scoped support endpoints. This service deliberately uses the portal
 * bearer token instead of the staff token that the shared API client normally
 * attaches to requests.
 */
export class GuestPortalSupportService {
  static async listConversations(
    token?: string,
    params: { page?: number; page_size?: number } = {},
  ): Promise<PortalSupportConversationListResponse> {
    return await api
      .get(SUPPORT_PATH, {
        headers: authHeaders(token),
        searchParams: params,
      })
      .json<PortalSupportConversationListResponse>();
  }

  static async createConversation(
    request: CreatePortalSupportConversationRequest,
    token?: string,
  ): Promise<PortalSupportConversationDetail> {
    return await api
      .post(SUPPORT_PATH, {
        headers: authHeaders(token),
        json: request,
      })
      .json<PortalSupportConversationDetail>();
  }

  static async getConversation(
    conversationId: PortalSupportConversationId,
    token?: string,
  ): Promise<PortalSupportConversationDetail> {
    return await api
      .get(`${SUPPORT_PATH}/${encodeURIComponent(String(conversationId))}`, {
        headers: authHeaders(token),
      })
      .json<PortalSupportConversationDetail>();
  }

  static async sendMessage(
    conversationId: PortalSupportConversationId,
    request: CreatePortalSupportMessageRequest,
    token?: string,
  ): Promise<PortalSupportConversationDetail> {
    return await api
      .post(`${SUPPORT_PATH}/${encodeURIComponent(String(conversationId))}/messages`, {
        headers: authHeaders(token),
        json: request,
      })
      .json<PortalSupportConversationDetail>();
  }

  static async reopenConversation(
    conversationId: PortalSupportConversationId,
    token?: string,
  ): Promise<PortalSupportConversationDetail> {
    return await api
      .post(`${SUPPORT_PATH}/${encodeURIComponent(String(conversationId))}/reopen`, {
        headers: authHeaders(token),
        json: {},
      })
      .json<PortalSupportConversationDetail>();
  }
}
