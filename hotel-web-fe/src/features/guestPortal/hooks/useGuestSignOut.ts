import { useCallback } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { usePortalSession } from '../api/usePortalSession';

/**
 * One sign-out for the whole guest chrome: clears the short-lived portal
 * bearer token, then the account session. Order matters — the portal logout
 * navigates to '/' and the account logout must not interleave a guarded-route
 * redirect before it runs (see usePortalSessionBootstrap.signOut).
 */
export function useGuestSignOut(): () => void {
  const { logout: logoutPortal } = usePortalSession();
  const { logout: logoutAccount } = useAuth();

  return useCallback(() => {
    logoutPortal();
    logoutAccount();
  }, [logoutAccount, logoutPortal]);
}
