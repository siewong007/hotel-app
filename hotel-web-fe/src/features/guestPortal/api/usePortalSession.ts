import { useCallback, useState } from 'react';
import { useNavigate } from '../../../router';
import { clearPortalToken, getPortalToken } from './portalTokenStore';

/**
 * Minimal guest-portal session state. Deliberately not a React Context: the
 * portal is a small, self-contained public flow (login page + one dashboard
 * page), so a single hook used at the top of `PortalDashboardPage` is enough —
 * no need for the ceremony of a provider mirroring `AuthContext`.
 */
export function usePortalSession() {
  const navigate = useNavigate();
  const [token] = useState<string | null>(() => getPortalToken());

  const logout = useCallback(() => {
    clearPortalToken();
    navigate('/portal/login', { replace: true });
  }, [navigate]);

  return { token, isAuthenticated: Boolean(token), logout };
}
