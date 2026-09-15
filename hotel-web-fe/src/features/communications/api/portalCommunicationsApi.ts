import { api } from '../../../api/client';
import { t } from '../../../i18n';
import { SKIP_API_NOTIFICATION_HEADER } from '../../../utils/apiNotifications';
import { getPortalToken } from '../../guestPortal/api/portalTokenStore';
import type { PreferencesResponse, PreferenceUpdateInput } from '../types';

function authHeaders(token?: string): Record<string, string> {
  const portalToken = token ?? getPortalToken();
  if (!portalToken) {
    throw new Error(t('communications:errors.portalSignInRequired'));
  }
  // Guest surfaces render every failure inline — the shared client's
  // global toast would repeat the same message.
  return {
    Authorization: `Bearer ${portalToken}`,
    [SKIP_API_NOTIFICATION_HEADER]: 'true',
  };
}

export const PortalCommunicationsApi = {
  getPreferences(token?: string): Promise<PreferencesResponse> {
    return api
      .get('guest-portal/me/notification-preferences', { headers: authHeaders(token) })
      .json<PreferencesResponse>();
  },

  updatePreferences(
    input: PreferenceUpdateInput,
    token?: string
  ): Promise<PreferencesResponse> {
    return api
      .put('guest-portal/me/notification-preferences', {
        headers: authHeaders(token),
        json: input,
      })
      .json<PreferencesResponse>();
  },
};
