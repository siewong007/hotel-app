import { useCallback } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { LANDING_PAGE_PATH } from '../../../guest/guestDocumentPaths';
import { usePortalSession } from '../api/usePortalSession';

/**
 * One sign-out for the whole guest chrome: clears the short-lived portal
 * bearer token, then ends the account session and leaves for the public
 * landing page once the server has revoked it (see AuthContext.logout).
 */
export function useGuestSignOut(): () => void {
  const { logout: logoutPortal } = usePortalSession();
  const { logout: logoutAccount } = useAuth();

  return useCallback(() => {
    logoutPortal();
    void logoutAccount({ redirectTo: LANDING_PAGE_PATH });
  }, [logoutAccount, logoutPortal]);
}
