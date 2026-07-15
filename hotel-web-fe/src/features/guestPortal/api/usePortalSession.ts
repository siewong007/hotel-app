import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { queryKeys } from '../../../api/queryKeys';
import { useNavigate } from '../../../router';
import { portalSessionScope } from '../../promotions/utils';
import { clearPortalToken, getValidPortalToken } from './portalTokenStore';

/**
 * Minimal guest-portal session state. Deliberately not a React Context: the
 * portal is a small, self-contained public flow (login page + one dashboard
 * page), so a single hook used at the top of `PortalDashboardPage` is enough —
 * no need for the ceremony of a provider mirroring `AuthContext`.
 */
export function usePortalSession() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = useState<string | null>(() => getValidPortalToken());

  const logout = useCallback(() => {
    if (token) {
      queryClient.removeQueries({
        queryKey: queryKeys.promotions.portal(portalSessionScope(token)),
      });
    }
    clearPortalToken();
    navigate('/portal/login', { replace: true });
  }, [navigate, queryClient, token]);

  return { token, isAuthenticated: Boolean(token), logout };
}
