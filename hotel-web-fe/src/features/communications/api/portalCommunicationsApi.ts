import { api } from '../../../api/client';
import { getPortalToken } from '../../guestPortal/api/portalTokenStore';
import type { PreferencesResponse, PreferenceUpdateInput } from '../types';

function authHeaders(token?: string): Record<string, string> {
  const portalToken = token ?? getPortalToken();
  if (!portalToken) {
    throw new Error('Sign in to the guest portal to continue');
  }
  return { Authorization: `Bearer ${portalToken}` };
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
