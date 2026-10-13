import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { queryKeys } from '../../../api/queryKeys';
import { portalSessionScope } from '../../promotions/utils';
import { clearPortalToken, getValidPortalToken } from './portalTokenStore';
import { GuestPortalDashboardService } from './guestPortalDashboard.service';

/**
 * Minimal guest-portal session state. Deliberately not a React Context: the
 * portal is a small, self-contained public flow (login page + one dashboard
 * page), so a single hook used at the top of `PortalDashboardPage` is enough —
 * no need for the ceremony of a provider mirroring `AuthContext`.
 */
export function usePortalSession() {
  const queryClient = useQueryClient();
  const [token] = useState<string | null>(() => getValidPortalToken());

  // Ends the portal token only. Where the page goes next belongs to the account
  // sign-out that always follows (see useGuestSignOut): navigating here first
  // would leave before that sign-out reached the server.
  const logout = useCallback(() => {
    if (token) {
      void GuestPortalDashboardService.logout(token).catch(() => {
        // Local cleanup still protects the current device if the network is unavailable.
      });
      queryClient.removeQueries({
        queryKey: queryKeys.promotions.portal(portalSessionScope(token)),
      });
    }
    clearPortalToken();
  }, [queryClient, token]);

  return { token, isAuthenticated: Boolean(token), logout };
}
