import { api } from '../../../api/client';
import type { NotificationTopic, PreferencesResponse } from '../types';

/** Token-authenticated unsubscribe endpoints; no session required. */
export const PublicCommunicationsApi = {
  view(token: string): Promise<PreferencesResponse> {
    return api
      .get(`communications/unsubscribe/${encodeURIComponent(token)}`)
      .json<PreferencesResponse>();
  },

  unsubscribeTopic(token: string, topic: NotificationTopic): Promise<PreferencesResponse> {
    return api
      .post(`communications/unsubscribe/${encodeURIComponent(token)}`, { json: { topic } })
      .json<PreferencesResponse>();
  },

  unsubscribeAll(token: string): Promise<PreferencesResponse> {
    return api
      .post(`communications/unsubscribe/${encodeURIComponent(token)}`, {
        json: { global: true },
      })
      .json<PreferencesResponse>();
  },
};
