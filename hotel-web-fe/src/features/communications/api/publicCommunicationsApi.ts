import { api } from '../../../api/client';
import { SKIP_API_NOTIFICATION_HEADER } from '../../../utils/apiNotifications';
import type { NotificationTopic, PreferencesResponse } from '../types';

/**
 * Token-authenticated unsubscribe endpoints; no session required.
 *
 * Paths are root-absolute (leading slash): this page lives at the nested
 * route /unsubscribe/$token, so page-relative URLs would resolve under
 * /unsubscribe/ before the client's /api prefixing.
 *
 * Every call carries the skip-notification header: UnsubscribePage renders
 * failures at page level, so the shared client's global toast would repeat
 * the same message.
 */
export const PublicCommunicationsApi = {
  view(token: string): Promise<PreferencesResponse> {
    return api
      .get(`/communications/unsubscribe/${encodeURIComponent(token)}`, {
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
      })
      .json<PreferencesResponse>();
  },

  unsubscribeTopic(token: string, topic: NotificationTopic): Promise<PreferencesResponse> {
    return api
      .post(`/communications/unsubscribe/${encodeURIComponent(token)}`, {
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
        json: { topic },
      })
      .json<PreferencesResponse>();
  },

  unsubscribeAll(token: string): Promise<PreferencesResponse> {
    return api
      .post(`/communications/unsubscribe/${encodeURIComponent(token)}`, {
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
        json: { global: true },
      })
      .json<PreferencesResponse>();
  },
};
