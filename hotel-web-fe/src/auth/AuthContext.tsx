import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshAccessToken, trackPendingLogout, APIError, readErrorData } from '../api/client';
import { SKIP_API_NOTIFICATION_HEADER } from '../utils/apiNotifications';
import { HTTPError } from 'ky';
import { errorMessage } from '../utils';
import { AuthService } from '../api/auth.service';
import { UsersService } from '../api/users.service';
import { storage } from '../utils/storage';
import { replaceDocumentLocation } from '../utils/documentLocation';
import { disableGoogleAutoSelect } from '../features/auth/components/GoogleSignInButton';
import { setAccessToken, clearAccessToken } from './tokenStore';
import type { RouteAccessPolicy, UserProfile } from '../types';
import { normalizeAuthUser, type AuthUserShape } from './authUser';
import type { ConsentAcceptance } from '../features/legal/useConsent';
import { t } from '../i18n';

export interface User extends AuthUserShape {}

/**
 * Step-up re-authentication for registering a passkey.
 *
 * The API (`services::auth::ensure_step_up`) refuses to mint a passkey from a
 * bare session: a passkey satisfies 2FA on its own, so a hijacked session
 * would otherwise become a durable, 2FA-bypassing account takeover. Callers
 * must collect the account password, or a TOTP code when 2FA is enabled.
 */
export interface PasskeyStepUp {
  password?: string;
  totpCode?: string;
}

export interface AuthState {
  user: User | null;
  roles: string[];
  permissions: string[];
  routePolicies: RouteAccessPolicy[];
  // Mirrors the in-memory access token (src/auth/tokenStore.ts) for React
  // consumers. Never persisted; the refresh token lives in an HttpOnly cookie.
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  shouldPromptPasskey: boolean;
}

export interface LoginResult {
  isFirstLogin: boolean;
  // Set only when the submitted 2FA code was a recovery code, which the backend
  // consumes; the caller warns the user to regenerate their codes.
  recoveryCodesRemaining?: number;
  // Set while the account is inside its two-factor enrolment grace window: the
  // session works, but the caller must route the reader to enrolment. Past the
  // deadline the sign-in fails instead — see isTwoFactorEnrollmentRequired.
  twoFactorEnrollmentRequired?: boolean;
  twoFactorEnrollmentDeadline?: string;
}

export interface AuthContextType extends AuthState {
  login: (
    username: string,
    password: string,
    totpCode?: string,
    turnstileToken?: string,
  ) => Promise<LoginResult>;
  loginWithGoogle: (
    credential: string,
    options?: { consents: ConsentAcceptance[]; marketing_opt_in: boolean },
  ) => Promise<LoginResult>;
  // Merges a freshly-returned profile (e.g. from POST /profile/complete) into
  // the in-memory auth user and its storage cache, without a network round
  // trip or a full-page reload. See applyAuthSession for the same
  // state+storage write-through pattern this mirrors.
  applyProfileUpdate: (profile: UserProfile) => void;
  register: (data: { username: string; email?: string; password: string; first_name: string; last_name: string; phone: string; address_line1?: string; consents: ConsentAcceptance[]; marketing_opt_in: boolean }, turnstileToken?: string) => Promise<void>;
  /**
   * End the session. With `redirectTo` the page then leaves for that URL —
   * see LogoutOptions. Resolves once the sign-out has done what it will do.
   */
  logout: (options?: LogoutOptions) => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  getRoutePolicy: (routeId: string) => RouteAccessPolicy | undefined;
  registerPasskey: (username: string, stepUp?: PasskeyStepUp) => Promise<void>;
  loginWithPasskey: (username: string) => Promise<boolean>;
  /** Finish a password sign-in with a passkey as its second factor. */
  completeTwoFactorWithPasskey: (mfaToken: string) => Promise<LoginResult>;
  dismissPasskeyPrompt: () => void;
  checkPasskeys: () => Promise<boolean>;
}

export interface LogoutOptions {
  /**
   * Leave the page for this URL once the server has ended the session. Until
   * then the signed-in state stays as it is, so the route guards and the 401
   * handler cannot race this navigation with their own redirect to /login.
   */
  redirectTo?: string;
}

/**
 * How long a sign-out that leaves the page waits for the server before it
 * navigates anyway. The request is `keepalive`, so it still completes after.
 */
const LOGOUT_SETTLE_TIMEOUT_MS = 3000;

// Exported for tests: src/test/renderPage.tsx provides a fixture value through
// AuthContext.Provider so page tests exercise the real useAuth() hook instead
// of mocking this module.
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Extract a user-facing message from a failed `api` call. ky's HTTPError
 * carries the failed Response; the backend wraps details as
 * `{ error }` or `{ message }`. Mirrors the historical inline blocks exactly,
 * including the connect-failure suffix when the response body cannot be read.
 */
async function extractHttpErrorMessage(error: unknown, fallback: string): Promise<string> {
  let message = fallback;
  try {
    if (error instanceof HTTPError) {
      const data = readErrorData(error);
      message = data.error || data.message || fallback;
    } else if (error instanceof Error && error.message) {
      message = error.message;
    }
  } catch (parseError) {
    console.error('Error parsing error response:', parseError);
    message = t('errors.unableToConnect', { message: fallback }, 'auth');
  }
  return message;
}

/** DOMException-style name (NotAllowedError, InvalidStateError, ...) for WebAuthn failures. */
function webAuthnErrorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

/** One allowed credential, as the passkey start endpoints list it. */
type PasskeyAllowCredential = { id: string; type?: string };

/** Base64url (URL-safe, unpadded) → bytes. */
function base64urlToBuffer(value: string): ArrayBuffer {
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Run `navigator.credentials.get` for a challenge minted by a passkey start
 * endpoint (standard base64) and return the assertion fields the finish
 * endpoints take. Shared by passkey sign-in and the passkey second factor so
 * both ceremonies are encoded identically.
 */
async function requestPasskeyAssertion(
  challenge: string,
  allowCredentials: PasskeyAllowCredential[],
): Promise<{
  credential_id: string;
  authenticator_data: string;
  client_data_json: string;
  signature: string;
}> {
  const challengeBinary = atob(challenge);
  const challengeBytes = new Uint8Array(challengeBinary.length);
  for (let i = 0; i < challengeBinary.length; i++) {
    challengeBytes[i] = challengeBinary.charCodeAt(i);
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes.buffer,
      allowCredentials: allowCredentials.map((cred) => ({
        id: base64urlToBuffer(cred.id),
        type: 'public-key' as const,
      })),
      timeout: 60000,
      // Require user verification (fingerprint, Face ID, PIN, etc.)
      userVerification: 'required',
    },
  }) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error(t('errors.passkeyAuthFailed', undefined, 'auth'));
  }

  const response = assertion.response as AuthenticatorAssertionResponse;
  return {
    credential_id: assertion.id,
    authenticator_data: bufferToBase64(response.authenticatorData),
    client_data_json: bufferToBase64(response.clientDataJSON),
    signature: bufferToBase64(response.signature),
  };
}

/** The WebAuthn browser failures a sign-in surfaces with their own message. */
function passkeyBrowserErrorMessage(error: unknown): string | null {
  const name = webAuthnErrorName(error);
  if (name === 'NotAllowedError') {
    return t('errors.passkeyAuthCancelled', undefined, 'auth');
  }
  if (name === 'InvalidStateError') {
    return t('errors.passkeyNotRegistered', undefined, 'auth');
  }
  if (name === 'NotSupportedError') {
    return t('errors.passkeyNotSupported', undefined, 'auth');
  }
  return null;
}

type AuthLoginResponse = {
  access_token: string;
  // Loosely typed: this is cast straight from the backend JSON (same as the
  // rest of this file's `.json<T>()` calls), and it must also accept the
  // `../types` AuthResponse.user shape returned by AuthService.loginWithGoogle,
  // which does not declare `user_type`.
  user: any;
  roles: string[];
  permissions: string[];
  route_policies: RouteAccessPolicy[];
  is_first_login: boolean;
  recovery_codes_remaining?: number;
  // Present on Google guest sign-in (and mirrored by password login): see
  // src/auth/authUser.ts::normalizeAuthUser for the client-side defaulting.
  profile_complete?: boolean;
  missing_profile_fields?: string[];
  // Set when this account's role requires a second factor, none is enrolled,
  // and the grace window is still open. The session is valid; the caller must
  // route the reader to enrolment. See features/auth/twoFactorEnrollment.ts.
  two_factor_enrollment_required?: boolean;
  two_factor_enrollment_deadline?: string;
};

const EMPTY_AUTH_STATE: AuthState = {
  user: null,
  roles: [],
  permissions: [],
  routePolicies: [],
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,
  shouldPromptPasskey: false,
};

const normalizeAccessValue = (value: string) => value.trim().toLowerCase();

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const queryClient = useQueryClient();
  const pendingLogoutRef = React.useRef<Promise<void>>(Promise.resolve());
  // Set once a sign-out is leaving the page; never cleared, the page is going.
  const leavingSignOutRef = React.useRef<Promise<void> | null>(null);
  const [authState, setAuthState] = useState<AuthState>({
    ...EMPTY_AUTH_STATE,
  });

  const clearStoredAuth = useCallback(() => {
    clearAccessToken();
    storage.removeItem('user');
    storage.removeItem('roles');
    storage.removeItem('permissions');
    storage.removeItem('routePolicies');
    storage.removeItem('cmdRecents');
  }, []);

  const resetAuthState = useCallback(() => {
    setAuthState({
      ...EMPTY_AUTH_STATE,
      isLoading: false,
    });
  }, []);

  useEffect(() => {
    const initializeAuth = async () => {
      // No token survives a reload (it lives in memory only). Try to silently
      // re-mint an access token from the HttpOnly refresh cookie; the browser
      // sends it automatically. If there's no valid cookie, we're logged out.
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        setAuthState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        // With the fresh access token in memory, confirm the session and load
        // the current access snapshot before flipping isAuthenticated. The
        // `user` object is restored from the (non-sensitive) storage cache set
        // at login; the profile call doubles as a token-validity probe. Both
        // calls only need the token, so they run in parallel — on a cold
        // refresh this is the difference between two round trips and three
        // while RootLayout holds the boot splash.
        const [profile, access] = await Promise.all([
          UsersService.getUserProfile(),
          AuthService.getAccessSnapshot(),
        ]);
        const cachedUser = storage.getItem<User>('user');
        const user = normalizeAuthUser({ ...cachedUser, ...profile }, access.roles);

        storage.setItems({
          user,
          roles: access.roles,
          permissions: access.permissions,
          routePolicies: access.route_policies,
        });

        setAuthState({
          user,
          roles: access.roles,
          permissions: access.permissions,
          routePolicies: access.route_policies,
          accessToken: refreshed.access_token,
          isAuthenticated: true,
          isLoading: false,
          shouldPromptPasskey: false,
        });
      } catch (error) {
        // If it fails with 401, the api client's interceptor will also dispatch
        // 'auth:unauthorized', which clears storage and redirects to /login.
        clearAccessToken();
        setAuthState(prev => ({ ...prev, isAuthenticated: false, isLoading: false }));
      }
    };

    initializeAuth();
  }, []);

  // Listen for unauthorized events from API interceptor
  useEffect(() => {
    const handleUnauthorized = () => {
      // Fallout of our own sign-out: that is already taking the page elsewhere.
      if (leavingSignOutRef.current) {
        return;
      }
      clearStoredAuth();
      queryClient.clear();
      resetAuthState();

      // Use window.location since we're outside Router context
      // This will cause a full page reload, which is acceptable for auth errors
      window.location.href = '/login';
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [clearStoredAuth, queryClient, resetAuthState]);

  useEffect(() => {
    const handleTokensRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<{ accessToken?: string }>).detail;
      if (!detail?.accessToken) {
        return;
      }

      setAuthState(prev => ({
        ...prev,
        accessToken: detail.accessToken || prev.accessToken,
      }));
    };

    window.addEventListener('auth:tokens-refreshed', handleTokensRefreshed);
    return () => window.removeEventListener('auth:tokens-refreshed', handleTokensRefreshed);
  }, []);

  const register = useCallback(async (data: { username: string; email?: string; password: string; first_name: string; last_name: string; phone: string; address_line1?: string; consents: ConsentAcceptance[]; marketing_opt_in: boolean }, turnstileToken?: string) => {
    try {
      await AuthService.register(data, turnstileToken);
    } catch (error) {
      console.error('Registration error:', error);
      // AuthService.register already wraps failures in APIError — the server's
      // message when the body carried one, the service fallback otherwise.
      // Rethrow it untouched so the page keeps statusCode/details alongside
      // the message instead of a flattened string.
      if (error instanceof APIError) {
        throw error;
      }
      throw new Error(await extractHttpErrorMessage(error, t('errors.registrationFailed', undefined, 'auth')));
    }
  }, []);

  const checkPasskeys = useCallback(async (): Promise<boolean> => {
    try {
      const passkeys = await AuthService.listPasskeys();
      return passkeys.length > 0;
    } catch (error) {
      console.error('Failed to check passkeys:', error);
      return false;
    }
  }, []);

  // Shared by every flow that mints a session (password login, Google login,
  // and — potentially in future — anything else returning the same
  // AuthLoginResponse shape). Do not duplicate this token/user/role/session
  // update sequence at a new call site; extend this helper instead.
  const applyAuthSession = useCallback((data: AuthLoginResponse): LoginResult => {
    const {
      access_token,
      user: responseUser,
      roles,
      permissions,
      route_policies,
      is_first_login,
      recovery_codes_remaining,
      profile_complete,
      missing_profile_fields,
      two_factor_enrollment_required,
      two_factor_enrollment_deadline,
    } = data;
    const user = normalizeAuthUser({ ...responseUser, profile_complete, missing_profile_fields }, roles);

    // Access token goes to the in-memory store (never persisted). The refresh
    // token was set by the backend as an HttpOnly cookie and is invisible here.
    setAccessToken(access_token);

    // IMPORTANT: Set the token above BEFORE calling checkPasskeys so the API
    // client can authenticate. Non-sensitive profile data is cached in storage.
    // Command-palette results can contain internal record details and must
    // never carry over from the previously signed-in account.
    storage.removeItem('cmdRecents');
    storage.setItems({
      user,
      roles,
      permissions,
      routePolicies: route_policies,
    });

    // Invalidate cache to ensure immediate availability
    storage.invalidateCache();
    queryClient.clear();

    // Set authenticated state immediately after successful login
    setAuthState({
      user,
      roles,
      permissions,
      routePolicies: route_policies,
      accessToken: access_token,
      isAuthenticated: true,
      isLoading: false,
      shouldPromptPasskey: false, // Will update below if needed
    });

    // Do not make navigation after a successful login depend on a follow-up
    // passkey lookup. Safari can keep that request pending while restoring
    // its cookie/session state, which previously made a completed login
    // appear to hang. This is only a best-effort prompt decision.
    void checkPasskeys()
      .then(hasPasskeys => {
        if (!hasPasskeys) {
          setAuthState(prev => ({ ...prev, shouldPromptPasskey: true }));
        }
      })
      .catch(error => {
        console.warn('Failed to check passkeys, skipping passkey prompt:', error);
      });

    return {
      isFirstLogin: is_first_login,
      recoveryCodesRemaining: recovery_codes_remaining,
      twoFactorEnrollmentRequired: two_factor_enrollment_required,
      twoFactorEnrollmentDeadline: two_factor_enrollment_deadline,
    };
  }, [checkPasskeys, queryClient]);

  const login = useCallback(async (
    username: string,
    password: string,
    totpCode?: string,
    turnstileToken?: string,
  ): Promise<LoginResult> => {
    try {
      // A user can sign back in before Safari finishes the previous logout
      // request. Always let that request settle first so it cannot revoke the
      // refresh cookie created by this new account session afterward.
      await pendingLogoutRef.current;

      const data = await api.post('auth/login', {
        json: { username, password, totp_code: totpCode },
        headers: {
          // Cloudflare Turnstile token, when this build challenges. Single-use:
          // the 2FA leg calls login() a second time and must carry a fresh one.
          ...(turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {}),
          // The sign-in page renders the failure inline; the client's global
          // toast would be a second notification for one error.
          [SKIP_API_NOTIFICATION_HEADER]: 'true',
        },
      }).json<AuthLoginResponse>();

      return applyAuthSession(data);
    } catch (error) {
      console.error('Login error:', error);
      // Every HTTP failure rethrows as APIError carrying status + parsed body.
      // An overdue two-factor enrolment is refused with a stable body code on
      // `details`, so the sign-in page routes to enrolment instead of matching
      // translated message text — the same reasoning as loginWithGoogle
      // preserving `statusCode` below. Other failures keep the server's own
      // message readable via guestErrorMessage/errorMessage either way.
      const message = await extractHttpErrorMessage(error, t('errors.loginFailed', undefined, 'auth'));
      if (error instanceof HTTPError) {
        throw new APIError(message, error.response?.status, readErrorData(error));
      }
      throw new Error(message);
    }
  }, [applyAuthSession]);

  const loginWithGoogle = useCallback(async (
    credential: string,
    options?: { consents: ConsentAcceptance[]; marketing_opt_in: boolean },
  ): Promise<LoginResult> => {
    try {
      // Same reasoning as login(): let any in-flight logout settle first so it
      // cannot revoke the refresh cookie this new session is about to create.
      await pendingLogoutRef.current;

      const data = options
        ? await AuthService.loginWithGoogle(credential, options)
        : await AuthService.loginWithGoogle(credential);

      return applyAuthSession(data);
    } catch (error) {
      console.error('Google login error:', error);

      // Rethrow APIError as-is so callers can branch on `error.statusCode`
      // (e.g. 503 when GOOGLE_CLIENT_ID is unset/Google is unreachable — see
      // hotel-app-be/src/services/google_identity.rs) instead of matching
      // message text, which silently breaks if the backend copy changes.
      if (error instanceof APIError) {
        throw error;
      }

      throw new Error(errorMessage(error, t('errors.googleSignInFailed', undefined, 'auth')));
    }
  }, [applyAuthSession]);

  // Merges a freshly-returned UserProfile (POST /profile/complete's response)
  // into the current auth user, without a network round trip. Mirrors
  // applyAuthSession's state+storage write-through, scoped to just `user`.
  const applyProfileUpdate = useCallback((profile: UserProfile) => {
    setAuthState(prev => {
      if (!prev.user) {
        return prev;
      }

      const user = normalizeAuthUser({ ...prev.user, ...profile }, prev.roles);
      storage.setItems({ user });

      return { ...prev, user };
    });
  }, []);

  const logout = useCallback((options?: LogoutOptions): Promise<void> => {
    // A second tap while the first sign-out is still on its way out.
    if (leavingSignOutRef.current) {
      return leavingSignOutRef.current;
    }

    // Best-effort server-side revoke + cookie clear. The refresh token rides the
    // HttpOnly cookie (sent via `credentials: 'include'`), so no body is needed.
    // `keepalive` lets the request outlive this page: Safari cancels a page's
    // in-flight requests as soon as a navigation starts, so a sign-out followed
    // by a redirect often never reached the server — the cookie stayed valid and
    // the next page's silent refresh signed the user straight back in.
    const request = api.post('auth/logout', { keepalive: true })
      .then(() => undefined)
      .catch(() => {
        // Ignore network/401 errors; the local session is being torn down anyway.
      });
    pendingLogoutRef.current = request;
    trackPendingLogout(request);
    // Google keeps its own account association independently of our session.
    // Without this the next person to open the sign-in or registration page is
    // greeted by the previous guest's name and email in the Google button.
    disableGoogleAutoSelect();

    const redirectTo = options?.redirectTo;
    if (redirectTo) {
      // Wait (bounded) for the revoke so the next page cannot restore the
      // session, then clear everything and go.
      const timedOut = new Promise<void>(resolve => {
        window.setTimeout(resolve, LOGOUT_SETTLE_TIMEOUT_MS);
      });
      leavingSignOutRef.current = Promise.race([request, timedOut]).then(() => {
        clearStoredAuth();
        queryClient.clear();
        replaceDocumentLocation(redirectTo);
      });
      return leavingSignOutRef.current;
    }

    resetAuthState();
    clearStoredAuth();
    queryClient.clear();
    return request;
  }, [clearStoredAuth, queryClient, resetAuthState]);

  const dismissPasskeyPrompt = useCallback(() => {
    setAuthState(prev => ({
      ...prev,
      shouldPromptPasskey: false,
    }));
  }, []);

  const permissionSet = useMemo(
    () => new Set(authState.permissions.map(normalizeAccessValue)),
    [authState.permissions]
  );
  const roleSet = useMemo(
    () => new Set(authState.roles.map(normalizeAccessValue)),
    [authState.roles]
  );
  const routePolicyMap = useMemo(
    () => new Map(authState.routePolicies.map((policy) => [policy.route_id, policy])),
    [authState.routePolicies]
  );

  const hasPermission = useCallback(
    (permission: string): boolean => {
      const normalizedPermission = normalizeAccessValue(permission);
      if (permissionSet.has(normalizedPermission)) {
        return true;
      }

      const [resource, action] = normalizedPermission.split(':');
      return Boolean(
        resource &&
          action &&
          action !== 'manage' &&
          permissionSet.has(`${resource}:manage`)
      );
    },
    [permissionSet]
  );

  const hasRole = useCallback(
    (role: string): boolean => roleSet.has(normalizeAccessValue(role)),
    [roleSet]
  );

  const getRoutePolicy = useCallback(
    (routeId: string): RouteAccessPolicy | undefined => routePolicyMap.get(routeId),
    [routePolicyMap]
  );

  const registerPasskey = useCallback(async (username: string, stepUp?: PasskeyStepUp) => {
    try {
      // Start passkey registration. The step-up credential is required by the
      // API; each key is omitted rather than sent empty, because the backend
      // reads them as `Option` and an empty string is a failed check, not an
      // absent one.
      const startResponse = await api.post('auth/passkey/register/start', {
        json: {
          username,
          ...(stepUp?.password ? { password: stepUp.password } : {}),
          ...(stepUp?.totpCode ? { totp_code: stepUp.totpCode } : {}),
        },
        // Every caller (UserProfilePage, SecuritySection, FirstLoginPasskeyPrompt)
        // surfaces the failure itself; suppress the duplicate global toast.
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
      }).json<{
        challenge: string;
        rp: { name: string; id: string };
        user: { id: string; name: string; displayName: string };
      }>();

      const { challenge, rp, user } = startResponse;

      // Use WebAuthn API with fingerprint/biometric support
      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge: Uint8Array.from(atob(challenge), (c: string) => c.charCodeAt(0)),
        rp: {
          name: rp.name,
          id: rp.id,
        },
        user: {
          id: Uint8Array.from(typeof user.id === 'string' ? atob(user.id) : user.id, (c: string) => c.charCodeAt(0)),
          name: user.name,
          displayName: user.displayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },  // ES256
          { alg: -257, type: 'public-key' } // RS256
        ],
        authenticatorSelection: {
          // Support both platform (built-in fingerprint/Face ID) and cross-platform (security keys)
          authenticatorAttachment: 'platform',
          // Require user verification (fingerprint, Face ID, PIN, etc.)
          userVerification: 'required',
          // Prefer creating a resident key for passwordless login
          residentKey: 'preferred',
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: 'direct',
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error(t('errors.passkeyCreateFailed', undefined, 'auth'));
      }

      const response = credential.response as AuthenticatorAttestationResponse;
      const credentialJson = {
        id: credential.id,
        rawId: Array.from(new Uint8Array(credential.rawId)),
        response: {
          clientDataJSON: Array.from(new Uint8Array(response.clientDataJSON)),
          attestationObject: Array.from(new Uint8Array(response.attestationObject)),
        },
        type: credential.type,
      };

      // Finish passkey registration
      await api.post('auth/passkey/register/finish', {
        json: {
          username,
          credential: JSON.stringify(credentialJson),
          challenge,
        },
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
      });

      // After successful registration, login the user
      // Note: In a real implementation, you'd need to handle this differently
    } catch (error) {
      console.error('Passkey registration error:', error);
      const name = webAuthnErrorName(error);
      console.error('Error name:', name);
      console.error('Error message:', error instanceof Error ? error.message : undefined);

      // Handle different error types
      if (name === 'NotAllowedError') {
        throw new Error(t('errors.passkeyRegisterCancelled', undefined, 'auth'));
      } else if (name === 'InvalidStateError') {
        throw new Error(t('errors.passkeyAlreadyRegistered', undefined, 'auth'));
      } else if (name === 'NotSupportedError') {
        throw new Error(t('errors.passkeyNotSupported', undefined, 'auth'));
      }

      throw new Error(await extractHttpErrorMessage(error, t('errors.passkeyRegisterFailed', undefined, 'auth')));
    }
  }, []);

  const loginWithPasskey = useCallback(async (username: string): Promise<boolean> => {
    try {
      await pendingLogoutRef.current;

      // Start passkey authentication
      const startResponse = await api.post('auth/passkey/login/start', {
        json: { username },
        // Callers own the failure feedback; suppress the duplicate global toast.
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
      }).json<{ challenge: string; allowCredentials: { id: string; type?: string }[] }>();

      const { challenge, allowCredentials } = startResponse;
      const assertion = await requestPasskeyAssertion(challenge, allowCredentials);

      // Finish passkey authentication
      const finishResponse = await api.post('auth/passkey/login/finish', {
        json: {
          username,
          ...assertion,
          challenge,
        },
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
      }).json<AuthLoginResponse>();

      // Shares the session write-through with the password and Google doors.
      // Hand-rolling it here let the two copies drift: this path was missing
      // the `cmdRecents` clear, so the previous account's command-palette
      // history survived a passkey sign-in on a shared machine.
      return applyAuthSession(finishResponse).isFirstLogin;
    } catch (error) {
      const browserMessage = passkeyBrowserErrorMessage(error);
      if (browserMessage) {
        throw new Error(browserMessage);
      }

      const message = await extractHttpErrorMessage(error, t('errors.passkeyAuthFailed', undefined, 'auth'));

      // Only log as error if it's not a normal "no passkeys" scenario
      const isNormalFailure =
        message.toLowerCase().includes('no passkeys') ||
        message.toLowerCase().includes('not found') ||
        (error instanceof HTTPError && error.response.status === 404);

      if (!isNormalFailure) {
        console.error('Passkey login error:', error);
        console.error('Error name:', webAuthnErrorName(error));
        console.error('Error message:', error instanceof Error ? error.message : undefined);
      }

      throw new Error(message);
    }
  }, [applyAuthSession]);

  const completeTwoFactorWithPasskey = useCallback(async (mfaToken: string): Promise<LoginResult> => {
    try {
      await pendingLogoutRef.current;

      // The token from the `two_factor_required` answer binds this ceremony
      // to the account whose password was just verified.
      const { challenge, allowCredentials } = await api.post('auth/passkey/2fa/start', {
        json: { mfa_token: mfaToken },
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
      }).json<{ challenge: string; allowCredentials: PasskeyAllowCredential[] }>();

      const assertion = await requestPasskeyAssertion(challenge, allowCredentials);

      const data = await api.post('auth/passkey/2fa/finish', {
        json: { mfa_token: mfaToken, ...assertion, challenge },
        headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
      }).json<AuthLoginResponse>();

      return applyAuthSession(data);
    } catch (error) {
      const browserMessage = passkeyBrowserErrorMessage(error);
      if (browserMessage) {
        throw new Error(browserMessage);
      }
      // Keep the status and body: the sign-in page routes on the stable
      // `two_factor_expired` code.
      const message = await extractHttpErrorMessage(error, t('errors.passkeyAuthFailed', undefined, 'auth'));
      if (error instanceof HTTPError) {
        throw new APIError(message, error.response?.status, readErrorData(error));
      }
      throw new Error(message);
    }
  }, [applyAuthSession]);

  const authContextValue = useMemo<AuthContextType>(() => ({
    ...authState,
    login,
    loginWithGoogle,
    applyProfileUpdate,
    register,
    logout,
    hasPermission,
    hasRole,
    getRoutePolicy,
    registerPasskey,
    loginWithPasskey,
    completeTwoFactorWithPasskey,
    dismissPasskeyPrompt,
    checkPasskeys,
  }), [
    authState,
    login,
    loginWithGoogle,
    applyProfileUpdate,
    register,
    logout,
    hasPermission,
    hasRole,
    getRoutePolicy,
    registerPasskey,
    loginWithPasskey,
    completeTwoFactorWithPasskey,
    dismissPasskeyPrompt,
    checkPasskeys,
  ]);

  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
    </AuthContext.Provider>
  );
};
