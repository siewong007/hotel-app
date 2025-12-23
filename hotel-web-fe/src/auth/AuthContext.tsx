import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import ky from 'ky';
import { HotelAPIService } from '../api';
import { storage } from '../utils/storage';

export interface User {
  id: string;
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
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  shouldPromptPasskey: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string, totpCode?: string) => Promise<boolean>;
  register: (data: { username: string; email: string; password: string; first_name: string; last_name: string; phone?: string }) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
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

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    roles: [],
    permissions: [],
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: true,
    shouldPromptPasskey: false,
  });

  useEffect(() => {
    // Batch read all stored auth data
    const { accessToken, user, roles, permissions, refreshToken } = storage.getItems([
      'accessToken',
      'user',
      'roles',
      'permissions',
      'refreshToken',
    ]);

    if (accessToken && user) {
      setAuthState({
        user,
        roles: roles || [],
        permissions: permissions || [],
        accessToken,
        refreshToken,
        isAuthenticated: true,
        isLoading: false,
        shouldPromptPasskey: false,
      });
    } else {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Listen for unauthorized events from API interceptor
  useEffect(() => {
    const handleUnauthorized = () => {
      // Clear auth state
      setAuthState({
        user: null,
        roles: [],
        permissions: [],
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
        shouldPromptPasskey: false,
      });

      // Use window.location since we're outside Router context
      // This will cause a full page reload, which is acceptable for auth errors
      window.location.href = '/login';
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const register = async (data: { username: string; email: string; password: string; first_name: string; last_name: string; phone?: string }) => {
    try {
      await HotelAPIService.register(data);
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
  };

  const checkPasskeys = async (): Promise<boolean> => {
    try {
      const passkeys = await HotelAPIService.listPasskeys();
      return passkeys.length > 0;
    } catch (error) {
      console.error('Failed to check passkeys:', error);
      return false;
    }
  };

  const login = async (username: string, password: string, totpCode?: string): Promise<boolean> => {
    try {
      const data = await ky.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/login`, {
        json: { username, password, totp_code: totpCode },
      }).json<{ access_token: string; refresh_token: string; user: User; roles: string[]; permissions: string[]; is_first_login: boolean }>();

      const { access_token, refresh_token, user, roles, permissions, is_first_login } = data;

      // IMPORTANT: Store auth data BEFORE calling checkPasskeys so the API client can use the token
      storage.setItems({
        accessToken: access_token,
        refreshToken: refresh_token,
        user,
        roles,
        permissions,
      });

      // Invalidate cache to ensure immediate availability
      storage.invalidateCache();

      // Set authenticated state immediately after successful login
      setAuthState({
        user,
        roles,
        permissions,
        accessToken: access_token,
        refreshToken: refresh_token,
        isAuthenticated: true,
        isLoading: false,
        shouldPromptPasskey: false, // Will update below if needed
      });

      // Check if user has any passkeys (non-blocking, won't affect login success)
      // This is a best-effort check - if it fails, we just won't show the passkey prompt
      try {
        const hasPasskeys = await checkPasskeys();
        if (!hasPasskeys) {
          setAuthState(prev => ({ ...prev, shouldPromptPasskey: true }));
        }
      } catch (error) {
        console.warn('Failed to check passkeys, skipping passkey prompt:', error);
        // Don't fail login if passkey check fails
      }

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
  };

  const logout = () => {
    setAuthState({
      user: null,
      roles: [],
      permissions: [],
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      shouldPromptPasskey: false,
    });

    // Clear only auth-related data, preserve language preferences
    storage.removeItem('accessToken');
    storage.removeItem('refreshToken');
    storage.removeItem('user');
    storage.removeItem('roles');
    storage.removeItem('permissions');
  };

  const dismissPasskeyPrompt = () => {
    setAuthState(prev => ({
      ...prev,
      shouldPromptPasskey: false,
    }));
  };

  const hasPermission = (permission: string): boolean => {
    return authState.permissions.includes(permission);
  };

  const hasRole = (role: string): boolean => {
    return authState.roles.includes(role);
  };

  const registerPasskey = async (username: string) => {
    try {
      // Start passkey registration
      const startResponse = await ky.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/passkey/register/start`, {
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
      await ky.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/passkey/register/finish`, {
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
  };

  const loginWithPasskey = async (username: string): Promise<boolean> => {
    try {
      // Start passkey authentication
      const startResponse = await ky.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/passkey/login/start`, {
        json: { username },
      }).json<{ challenge: string; allowCredentials: any[] }>();

      const { challenge, allowCredentials } = startResponse;

      console.log('Passkey start response:', { challenge, allowCredentials });

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

      const challengeBytes = new Uint8Array(atob(challenge).length);
      for (let i = 0; i < atob(challenge).length; i++) {
        challengeBytes[i] = atob(challenge).charCodeAt(i);
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

      console.log('Requesting credentials with options:', publicKeyCredentialRequestOptions);

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      }) as PublicKeyCredential;

      console.log('Got assertion:', assertion);

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
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:3030';
      const finishResponse = await ky.post(`${apiUrl}/auth/passkey/login/finish`, {
        json: {
          username,
          credential_id: assertion.id,
          authenticator_data: btoa(String.fromCharCode(...assertionJson.response.authenticatorData)),
          client_data_json: btoa(String.fromCharCode(...assertionJson.response.clientDataJSON)),
          signature: btoa(String.fromCharCode(...assertionJson.response.signature)),
          challenge,
        },
      }).json<{ access_token: string; refresh_token: string; user: User; roles: string[]; permissions: string[]; is_first_login: boolean }>();

      const { access_token, refresh_token, user, roles, permissions, is_first_login } = finishResponse;

      // Store auth data first
      storage.setItems({
        accessToken: access_token,
        refreshToken: refresh_token,
        user,
        roles,
        permissions,
      });

      // Invalidate cache to ensure immediate availability
      storage.invalidateCache();

      // Set authenticated state
      setAuthState({
        user,
        roles,
        permissions,
        accessToken: access_token,
        refreshToken: refresh_token,
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

      if (isNormalFailure) {
        console.log('Passkey not available, falling back to password login');
      } else {
        console.error('Passkey login error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
      }

      throw new Error(errorMessage);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        register,
        logout,
        hasPermission,
        hasRole,
        registerPasskey,
        loginWithPasskey,
        dismissPasskeyPrompt,
        checkPasskeys,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
