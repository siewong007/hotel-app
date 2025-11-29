import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';
import { HotelAPIService } from '../api';

export interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
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
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  registerPasskey: (username: string) => Promise<void>;
  loginWithPasskey: (username: string) => Promise<void>;
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
  });

  useEffect(() => {
    // Check for stored auth on mount
    const storedToken = localStorage.getItem('accessToken');
    const storedUser = localStorage.getItem('user');
    const storedRoles = localStorage.getItem('roles');
    const storedPermissions = localStorage.getItem('permissions');

    if (storedToken && storedUser) {
      setAuthState({
        user: JSON.parse(storedUser),
        roles: storedRoles ? JSON.parse(storedRoles) : [],
        permissions: storedPermissions ? JSON.parse(storedPermissions) : [],
        accessToken: storedToken,
        refreshToken: localStorage.getItem('refreshToken'),
        isAuthenticated: true,
        isLoading: false,
      });

      // Set axios default header
      axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
    } else {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const response = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/login`, {
        username,
        password,
      });

      const { access_token, refresh_token, user, roles, permissions } = response.data;

      setAuthState({
        user,
        roles,
        permissions,
        accessToken: access_token,
        refreshToken: refresh_token,
        isAuthenticated: true,
        isLoading: false,
      });

      // Store in localStorage
      localStorage.setItem('accessToken', access_token);
      localStorage.setItem('refreshToken', refresh_token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('roles', JSON.stringify(roles));
      localStorage.setItem('permissions', JSON.stringify(permissions));

      // Set axios default header
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Login failed');
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
    });

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    localStorage.removeItem('roles');
    localStorage.removeItem('permissions');

    delete axios.defaults.headers.common['Authorization'];
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
      const startResponse = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/passkey/register/start`, {
        username,
      });

      const { challenge, rp, user } = startResponse.data;

      // Use WebAuthn API
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
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'cross-platform',
          userVerification: 'preferred',
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
      await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/passkey/register/finish`, {
        username,
        credential: JSON.stringify(credentialJson),
        challenge,
      });

      // After successful registration, login the user
      // Note: In a real implementation, you'd need to handle this differently
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Passkey registration failed');
    }
  };

  const loginWithPasskey = async (username: string) => {
    try {
      // Start passkey authentication
      const startResponse = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/passkey/login/start`, {
        username,
      });

      const { challenge, allowCredentials } = startResponse.data;

      const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
        challenge: Uint8Array.from(atob(challenge), (c: string) => c.charCodeAt(0)),
        allowCredentials: allowCredentials.map((cred: any) => ({
          id: Uint8Array.from(atob(cred.id), (c: string) => c.charCodeAt(0)),
          type: 'public-key',
        })),
        timeout: 60000,
        userVerification: 'preferred',
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
      const finishResponse = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:3030'}/auth/passkey/login/finish`, {
        username,
        credential_id: assertion.id,
        authenticator_data: btoa(String.fromCharCode(...assertionJson.response.authenticatorData)),
        client_data_json: btoa(String.fromCharCode(...assertionJson.response.clientDataJSON)),
        signature: btoa(String.fromCharCode(...assertionJson.response.signature)),
        challenge,
      });

      const { access_token, refresh_token, user, roles, permissions } = finishResponse.data;

      setAuthState({
        user,
        roles,
        permissions,
        accessToken: access_token,
        refreshToken: refresh_token,
        isAuthenticated: true,
        isLoading: false,
      });

      localStorage.setItem('accessToken', access_token);
      localStorage.setItem('refreshToken', refresh_token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('roles', JSON.stringify(roles));
      localStorage.setItem('permissions', JSON.stringify(permissions));

      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Passkey authentication failed');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        logout,
        hasPermission,
        hasRole,
        registerPasskey,
        loginWithPasskey,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

