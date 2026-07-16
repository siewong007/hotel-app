import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { useNavigate } from '../../../router';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { setPortalToken } from '../api/portalTokenStore';
import { usePortalSession } from '../api/usePortalSession';

const ACCOUNT_SESSION_WAIT_MS = 10_000;

export type PortalSessionBootstrapStatus =
  | 'checking-account'
  | 'opening-portal'
  | 'ready'
  | 'error';

export interface PortalSessionBootstrap {
  token: string | null;
  status: PortalSessionBootstrapStatus;
  error: string | null;
  canRetry: boolean;
  needsLogin: boolean;
  retry: () => void;
  restartSignIn: () => void;
  signOut: () => void;
}

/**
 * Bridges the regular account session to the guest portal's separate,
 * short-lived bearer token. Every portal entry page uses this hook so the
 * session exchange has one finite, recoverable state machine.
 */
export function usePortalSessionBootstrap(): PortalSessionBootstrap {
  const navigate = useNavigate();
  const { token: storedToken, logout: logoutPortal } = usePortalSession();
  const {
    user,
    isAuthenticated,
    isLoading,
    logout: logoutAccount,
  } = useAuth();
  const [bootstrapToken, setBootstrapToken] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [didAccountCheckTimeOut, setDidAccountCheckTimeOut] = useState(false);
  const token = storedToken ?? bootstrapToken;
  const isGuestAccount = isAuthenticated && user?.user_type === 'guest';
  const needsLogin = !token && !isLoading && !isGuestAccount;

  useEffect(() => {
    if (token || !isLoading) {
      setDidAccountCheckTimeOut(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setDidAccountCheckTimeOut(true);
    }, ACCOUNT_SESSION_WAIT_MS);
    return () => window.clearTimeout(timeout);
  }, [isLoading, token]);

  useEffect(() => {
    if (token || isLoading || !isGuestAccount) {
      return;
    }

    let cancelled = false;
    setBootstrapError(null);
    void GuestPortalDashboardService.createSession()
      .then((session) => {
        if (cancelled) return;
        setPortalToken(session.token, session.expires_at);
        setBootstrapToken(session.token);
      })
      .catch(() => {
        if (!cancelled) {
          setBootstrapError('We could not open your guest portal. Please try again.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt, isGuestAccount, isLoading, token]);

  const retry = useCallback(() => {
    setBootstrapError(null);
    setBootstrapAttempt((attempt) => attempt + 1);
  }, []);

  const signOut = useCallback(() => {
    logoutAccount();
    logoutPortal();
  }, [logoutAccount, logoutPortal]);

  const restartSignIn = useCallback(() => {
    signOut();
    navigate('/login?account=guest', { replace: true });
  }, [navigate, signOut]);

  return useMemo(() => {
    if (token) {
      return {
        token,
        status: 'ready',
        error: null,
        canRetry: false,
        needsLogin: false,
        retry,
        restartSignIn,
        signOut,
      };
    }

    if (didAccountCheckTimeOut) {
      return {
        token: null,
        status: 'error',
        error: 'We could not confirm your account session. Please sign in again.',
        canRetry: false,
        needsLogin: false,
        retry,
        restartSignIn,
        signOut,
      };
    }

    if (bootstrapError) {
      return {
        token: null,
        status: 'error',
        error: bootstrapError,
        canRetry: true,
        needsLogin: false,
        retry,
        restartSignIn,
        signOut,
      };
    }

    return {
      token: null,
      status: isLoading ? 'checking-account' : 'opening-portal',
      error: null,
      canRetry: false,
      needsLogin,
      retry,
      restartSignIn,
      signOut,
    };
  }, [
    bootstrapError,
    didAccountCheckTimeOut,
    isLoading,
    needsLogin,
    restartSignIn,
    retry,
    signOut,
    token,
  ]);
}
