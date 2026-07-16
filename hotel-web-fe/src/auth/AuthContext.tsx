import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshAccessToken } from '../api/client';
import { AuthService } from '../api/auth.service';
import { storage } from '../utils/storage';
import { setAccessToken, clearAccessToken } from './tokenStore';
import type { RouteAccessPolicy } from '../types';

export interface User {
  id: string | number;
  username: string;
  email: string;
  full_name?: string;
  user_type: 'admin' | 'guest';
  guest_id?: number;
  is_active: boolean;
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

interface AuthContextType extends AuthState {
  login: (username: string, password: string, totpCode?: string) => Promise<boolean>;
  register: (data: { username: string; email?: string; password: string; first_name: string; last_name: string; phone: string; address_line1?: string }) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  getRoutePolicy: (routeId: string) => RouteAccessPolicy | undefined;
  registerPasskey: (username: string) => Promise<void>;
  loginWithPasskey: (username: string) => Promise<boolean>;
  dismissPasskeyPrompt: () => void;
  checkPasskeys: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

type AuthLoginResponse = {
  access_token: string;
  user: User;
  roles: string[];
  permissions: string[];
  route_policies: RouteAccessPolicy[];
  is_first_login: boolean;
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
        // at login; the profile call doubles as a token-validity probe.
        await AuthService.getUserProfile();
        const access = await AuthService.getAccessSnapshot();
        const user = storage.getItem<User>('user');

        storage.setItems({
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

  const register = useCallback(async (data: { username: string; email?: string; password: string; first_name: string; last_name: string; phone: string; address_line1?: string }) => {
    try {
      await AuthService.register(data);
    } catch (error: any) {
      console.error('Registration error:', error);

      // Safely extract error message
      let errorMessage = 'Registration failed';

      try {
        if (error.response) {
          const errorData = await error.response.json().catch(() => ({}));
          errorMessage = errorData.error || errorData.message || 'Registration failed';
        } else if (error.message) {
          errorMessage = error.message;
        }
      } catch (parseError) {
        console.error('Error parsing error response:', parseError);
        errorMessage = 'Registration failed - unable to connect to server';
      }

      throw new Error(errorMessage);
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

  const login = useCallback(async (username: string, password: string, totpCode?: string): Promise<boolean> => {
    try {
      const data = await api.post('auth/login', {
        json: { username, password, totp_code: totpCode },
      }).json<AuthLoginResponse>();

      const { access_token, user, roles, permissions, route_policies, is_first_login } = data;

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

      // Do not make navigation after a successful password login depend on a
      // follow-up passkey lookup. Safari can keep that request pending while
      // restoring its cookie/session state, which previously made a completed
      // login appear to hang. This is only a best-effort prompt decision.
      void checkPasskeys()
        .then(hasPasskeys => {
          if (!hasPasskeys) {
            setAuthState(prev => ({ ...prev, shouldPromptPasskey: true }));
          }
        })
        .catch(error => {
          console.warn('Failed to check passkeys, skipping passkey prompt:', error);
        });

      return is_first_login;
    } catch (error: any) {
      console.error('Login error:', error);

      // Safely extract error message from ky HTTPError
      let errorMessage = 'Login failed';

      try {
        if (error.response) {
          const errorData = await error.response.json().catch(() => ({}));
          errorMessage = errorData.error || errorData.message || 'Login failed';
        } else if (error.message) {
          errorMessage = error.message;
        }
      } catch (parseError) {
        console.error('Error parsing error response:', parseError);
        errorMessage = 'Login failed - unable to connect to server';
      }

      throw new Error(errorMessage);
    }
  }, [checkPasskeys, queryClient]);

  const logout = useCallback(() => {
    // Best-effort server-side revoke + cookie clear. The refresh token rides the
    // HttpOnly cookie (sent via `credentials: 'include'`), so no body is needed.
    // We don't await it: local state is cleared immediately regardless of result.
    void api.post('auth/logout').catch(() => {
      // Ignore network/401 errors; the local session is being torn down anyway.
    });
    resetAuthState();
    clearStoredAuth();
    queryClient.clear();
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

  const registerPasskey = useCallback(async (username: string) => {
    try {
      // Start passkey registration
      const startResponse = await api.post('auth/passkey/register/start', {
        json: { username },
      }).json<{ challenge: string; rp: any; user: any }>();

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
        throw new Error('Failed to create passkey');
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
      });

      // After successful registration, login the user
      // Note: In a real implementation, you'd need to handle this differently
    } catch (error: any) {
      console.error('Passkey registration error:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);

      // Handle different error types
      if (error.name === 'NotAllowedError') {
        throw new Error('Passkey registration was cancelled or timed out');
      } else if (error.name === 'InvalidStateError') {
        throw new Error('A passkey is already registered for this account on this device');
      } else if (error.name === 'NotSupportedError') {
        throw new Error('Passkeys are not supported in this browser');
      }

      // Safely extract error message
      let errorMessage = 'Passkey registration failed';

      try {
        if (error.response) {
          const errorData = await error.response.json().catch(() => ({}));
          errorMessage = errorData.error || errorData.message || 'Passkey registration failed';
        } else if (error.message) {
          errorMessage = error.message;
        }
      } catch (parseError) {
        console.error('Error parsing error response:', parseError);
        errorMessage = 'Passkey registration failed - unable to connect to server';
      }

      throw new Error(errorMessage);
    }
  }, []);

  const loginWithPasskey = useCallback(async (username: string): Promise<boolean> => {
    try {
      // Start passkey authentication
      const startResponse = await api.post('auth/passkey/login/start', {
        json: { username },
      }).json<{ challenge: string; allowCredentials: any[] }>();

      const { challenge, allowCredentials } = startResponse;

      // Helper to decode base64url (URL-safe base64)
      const base64urlDecode = (str: string): ArrayBuffer => {
        // Convert base64url to base64
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if needed
        while (base64.length % 4) {
          base64 += '=';
        }
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
      };

      const challengeBinary = atob(challenge);
      const challengeBytes = new Uint8Array(challengeBinary.length);
      for (let i = 0; i < challengeBinary.length; i++) {
        challengeBytes[i] = challengeBinary.charCodeAt(i);
      }

      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
        challenge: challengeBytes.buffer,
        allowCredentials: allowCredentials.map((cred: any) => ({
          id: base64urlDecode(cred.id),
          type: 'public-key' as const,
        })),
        timeout: 60000,
        // Require user verification (fingerprint, Face ID, PIN, etc.)
        userVerification: 'required',
      };

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      }) as PublicKeyCredential;

      if (!assertion) {
        throw new Error('Failed to authenticate with passkey');
      }

      const response = assertion.response as AuthenticatorAssertionResponse;
      const assertionJson = {
        id: assertion.id,
        rawId: Array.from(new Uint8Array(assertion.rawId)),
        response: {
          clientDataJSON: Array.from(new Uint8Array(response.clientDataJSON)),
          authenticatorData: Array.from(new Uint8Array(response.authenticatorData)),
          signature: Array.from(new Uint8Array(response.signature)),
          userHandle: response.userHandle ? Array.from(new Uint8Array(response.userHandle)) : null,
        },
        type: assertion.type,
      };

      // Finish passkey authentication
      const finishResponse = await api.post('auth/passkey/login/finish', {
        json: {
          username,
          credential_id: assertion.id,
          authenticator_data: btoa(String.fromCharCode(...assertionJson.response.authenticatorData)),
          client_data_json: btoa(String.fromCharCode(...assertionJson.response.clientDataJSON)),
          signature: btoa(String.fromCharCode(...assertionJson.response.signature)),
          challenge,
        },
      }).json<AuthLoginResponse>();

      const { access_token, user, roles, permissions, route_policies, is_first_login } = finishResponse;

      // Access token to memory only; refresh token arrives as an HttpOnly cookie.
      setAccessToken(access_token);

      // Cache non-sensitive profile data
      storage.setItems({
        user,
        roles,
        permissions,
        routePolicies: route_policies,
      });

      // Invalidate cache to ensure immediate availability
      storage.invalidateCache();
      queryClient.clear();

      // Set authenticated state
      setAuthState({
        user,
        roles,
        permissions,
        routePolicies: route_policies,
        accessToken: access_token,
        isAuthenticated: true,
        isLoading: false,
        shouldPromptPasskey: false,
      });

      return is_first_login;
    } catch (error: any) {
      // Handle different error types
      if (error.name === 'NotAllowedError') {
        throw new Error('Passkey authentication was cancelled or timed out');
      } else if (error.name === 'InvalidStateError') {
        throw new Error('This passkey is not registered on this device');
      } else if (error.name === 'NotSupportedError') {
        throw new Error('Passkeys are not supported in this browser');
      }

      // Safely extract error message from ky HTTPError
      let errorMessage = 'Passkey authentication failed';

      try {
        if (error.response) {
          const errorData = await error.response.json().catch(() => ({}));
          errorMessage = errorData.error || errorData.message || 'Passkey authentication failed';
        } else if (error.message) {
          errorMessage = error.message;
        }
      } catch (parseError) {
        console.error('Error parsing error response:', parseError);
        errorMessage = 'Passkey authentication failed - unable to connect to server';
      }

      // Only log as error if it's not a normal "no passkeys" scenario
      const isNormalFailure =
        errorMessage.toLowerCase().includes('no passkeys') ||
        errorMessage.toLowerCase().includes('not found') ||
        error.response?.status === 404;

      if (!isNormalFailure) {
        console.error('Passkey login error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
      }

      throw new Error(errorMessage);
    }
  }, [queryClient]);

  const authContextValue = useMemo<AuthContextType>(() => ({
    ...authState,
    login,
    register,
    logout,
    hasPermission,
    hasRole,
    getRoutePolicy,
    registerPasskey,
    loginWithPasskey,
    dismissPasskeyPrompt,
    checkPasskeys,
  }), [
    authState,
    login,
    register,
    logout,
    hasPermission,
    hasRole,
    getRoutePolicy,
    registerPasskey,
    loginWithPasskey,
    dismissPasskeyPrompt,
    checkPasskeys,
  ]);

  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
    </AuthContext.Provider>
  );
};
