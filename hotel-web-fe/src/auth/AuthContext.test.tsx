import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  apiPost: vi.fn(),
  getUserProfile: vi.fn(),
  getAccessSnapshot: vi.fn(),
  listPasskeys: vi.fn(),
  loginWithGoogle: vi.fn(),
}));

// AuthContext talks to the network only through these two modules — mock both
// wholesale so no real HTTP is ever attempted (per repo test convention).
// APIError is re-implemented here (not imported from the real module) so that
// `error instanceof APIError` inside AuthContext.tsx checks against the SAME
// class the test constructs instances of below.
vi.mock('../api/client', () => {
  class APIError extends Error {
    statusCode?: number;
    details?: unknown;
    constructor(message: string, statusCode?: number, details?: unknown) {
      super(message);
      this.name = 'APIError';
      this.statusCode = statusCode;
      this.details = details;
    }
  }
  return {
    api: { post: (...args: unknown[]) => mocks.apiPost(...args) },
    refreshAccessToken: (...args: unknown[]) => mocks.refreshAccessToken(...args),
    APIError,
  };
});

vi.mock('../api/auth.service', () => ({
  AuthService: {
    getAccessSnapshot: (...args: unknown[]) => mocks.getAccessSnapshot(...args),
    listPasskeys: (...args: unknown[]) => mocks.listPasskeys(...args),
    loginWithGoogle: (...args: unknown[]) => mocks.loginWithGoogle(...args),
  },
}));

vi.mock('../api/users.service', () => ({
  UsersService: {
    getUserProfile: (...args: unknown[]) => mocks.getUserProfile(...args),
  },
}));

import { APIError } from '../api/client';
import { AuthProvider, useAuth } from './AuthContext';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const userProfile = {
  id: 42,
  username: 'jdoe',
  email: 'jdoe@example.com',
  email_configured: true,
  is_verified: true,
  user_type: 'staff' as const,
  full_name: 'Jane Doe',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const accessSnapshot = {
  roles: ['front_desk'],
  permissions: ['bookings:read', 'rooms:manage'],
  route_policies: [],
};

/** Drives the session-bootstrap effect to a fully authenticated result. */
async function renderAuthenticated() {
  mocks.refreshAccessToken.mockResolvedValue({ access_token: 'access-123' });
  mocks.getUserProfile.mockResolvedValue(userProfile);
  mocks.getAccessSnapshot.mockResolvedValue(accessSnapshot);

  const { wrapper, queryClient } = createWrapper();
  const { result } = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return { result, queryClient };
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.refreshAccessToken.mockReset();
    mocks.apiPost.mockReset();
    mocks.getUserProfile.mockReset();
    mocks.getAccessSnapshot.mockReset();
    mocks.listPasskeys.mockReset();
    mocks.listPasskeys.mockResolvedValue([]);
    mocks.loginWithGoogle.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('session bootstrap on mount', () => {
    it('authenticates with the returned user when the refresh cookie resolves', async () => {
      const { result } = await renderAuthenticated();

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.username).toBe('jdoe');
      expect(result.current.user?.user_type).toBe('admin'); // 'staff' normalizes to 'admin'
      expect(result.current.roles).toEqual(['front_desk']);
      expect(result.current.permissions).toEqual(['bookings:read', 'rooms:manage']);
      expect(result.current.accessToken).toBe('access-123');
    });

    it('caches the restored user/roles/permissions in storage', async () => {
      await renderAuthenticated();

      expect(JSON.parse(localStorage.getItem('roles') ?? 'null')).toEqual(['front_desk']);
      expect(JSON.parse(localStorage.getItem('permissions') ?? 'null')).toEqual([
        'bookings:read',
        'rooms:manage',
      ]);
    });

    it('remains unauthenticated without crashing when there is no valid refresh cookie', async () => {
      mocks.refreshAccessToken.mockResolvedValue(null);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(mocks.getUserProfile).not.toHaveBeenCalled();
    });

    it('remains unauthenticated without crashing when the post-refresh profile probe fails', async () => {
      mocks.refreshAccessToken.mockResolvedValue({ access_token: 'access-123' });
      mocks.getUserProfile.mockRejectedValue(new Error('401 Unauthorized'));
      mocks.getAccessSnapshot.mockResolvedValue(accessSnapshot);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  describe('permission helper semantics', () => {
    it('matches an exact <resource>:<action> permission', async () => {
      const { result } = await renderAuthenticated();
      expect(result.current.hasPermission('bookings:read')).toBe(true);
    });

    it('normalizes case and surrounding whitespace before matching', async () => {
      const { result } = await renderAuthenticated();
      expect(result.current.hasPermission(' Bookings:READ ')).toBe(true);
    });

    it('implies every action of a resource from "<resource>:manage"', async () => {
      const { result } = await renderAuthenticated();
      expect(result.current.hasPermission('rooms:delete')).toBe(true);
      expect(result.current.hasPermission('rooms:update')).toBe(true);
      expect(result.current.hasPermission('rooms:manage')).toBe(true);
    });

    it('denies by default when neither the exact permission nor "manage" is granted', async () => {
      const { result } = await renderAuthenticated();
      expect(result.current.hasPermission('ledger:read')).toBe(false);
      expect(result.current.hasPermission('bookings:delete')).toBe(false);
    });

    it('denies a permission string with no resource:action shape', async () => {
      const { result } = await renderAuthenticated();
      expect(result.current.hasPermission('rooms')).toBe(false);
    });

    it('matches roles case-insensitively and denies roles that were not granted', async () => {
      const { result } = await renderAuthenticated();
      expect(result.current.hasRole('front_desk')).toBe(true);
      expect(result.current.hasRole('FRONT_DESK')).toBe(true);
      expect(result.current.hasRole('admin')).toBe(false);
    });

    it('denies every permission and role before any session is established', async () => {
      mocks.refreshAccessToken.mockResolvedValue(null);
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.hasPermission('bookings:read')).toBe(false);
      expect(result.current.hasRole('front_desk')).toBe(false);
    });
  });

  describe('loginWithGoogle', () => {
    it('authenticates and populates the user with the profile completion status', async () => {
      mocks.refreshAccessToken.mockResolvedValue(null);
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mocks.loginWithGoogle.mockResolvedValue({
        access_token: 'google-access-1',
        user: { id: '99', username: 'guest@example.com', email: 'guest@example.com', is_active: true },
        roles: ['guest'],
        permissions: [],
        route_policies: [],
        is_first_login: true,
        profile_complete: false,
        missing_profile_fields: ['first_name', 'last_name', 'phone'],
      });

      await act(async () => {
        await result.current.loginWithGoogle('google-id-token');
      });

      expect(mocks.loginWithGoogle).toHaveBeenCalledWith('google-id-token');
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.username).toBe('guest@example.com');
      expect(result.current.user?.profile_complete).toBe(false);
      expect(result.current.user?.missing_profile_fields).toEqual([
        'first_name',
        'last_name',
        'phone',
      ]);
    });

    it('defaults profile_complete to true when the backend omits it', async () => {
      mocks.refreshAccessToken.mockResolvedValue(null);
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mocks.loginWithGoogle.mockResolvedValue({
        access_token: 'google-access-2',
        user: { id: '100', username: 'admin@example.com', email: 'admin@example.com', is_active: true },
        roles: ['front_desk'],
        permissions: [],
        route_policies: [],
        is_first_login: false,
      });

      await act(async () => {
        await result.current.loginWithGoogle('google-id-token-2');
      });

      expect(result.current.user?.profile_complete).toBe(true);
      expect(result.current.user?.missing_profile_fields).toEqual([]);
    });

    it('surfaces a 503 as a status the caller can check without reading the message text', async () => {
      mocks.refreshAccessToken.mockResolvedValue(null);
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // The backend words this however it likes (see
      // hotel-app-be/src/services/google_identity.rs) — the message text here
      // is deliberately generic to prove the caller never has to parse it.
      mocks.loginWithGoogle.mockRejectedValue(
        new APIError('Google sign-in is currently unavailable', 503)
      );

      let caught: any;
      await act(async () => {
        try {
          await result.current.loginWithGoogle('google-id-token-3');
        } catch (err) {
          caught = err;
        }
      });

      expect(caught).toBeInstanceOf(APIError);
      expect(caught.statusCode).toBe(503);
    });
  });

  describe('applyProfileUpdate', () => {
    it('flips profile_complete on the context user and writes through to storage', async () => {
      mocks.refreshAccessToken.mockResolvedValue(null);
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mocks.loginWithGoogle.mockResolvedValue({
        access_token: 'google-access-4',
        user: { id: '101', username: 'guest2@example.com', email: 'guest2@example.com', is_active: true },
        roles: ['guest'],
        permissions: [],
        route_policies: [],
        is_first_login: true,
        profile_complete: false,
        missing_profile_fields: ['first_name', 'last_name', 'phone'],
      });

      await act(async () => {
        await result.current.loginWithGoogle('google-id-token-4');
      });

      expect(result.current.user?.profile_complete).toBe(false);

      act(() => {
        result.current.applyProfileUpdate({
          id: 101,
          username: 'guest2@example.com',
          email: 'guest2@example.com',
          email_configured: true,
          is_verified: true,
          full_name: 'Guest Two',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          profile_complete: true,
          missing_profile_fields: [],
        });
      });

      expect(result.current.user?.profile_complete).toBe(true);
      expect(result.current.user?.missing_profile_fields).toEqual([]);
      expect(result.current.user?.full_name).toBe('Guest Two');
      expect(JSON.parse(localStorage.getItem('user') ?? 'null')?.profile_complete).toBe(true);
    });
  });

  describe('auth:unauthorized window event', () => {
    it('clears the session state, storage, and query cache when dispatched', async () => {
      const { result, queryClient } = await renderAuthenticated();
      expect(result.current.isAuthenticated).toBe(true);
      const clearQueries = vi.spyOn(queryClient, 'clear');

      act(() => {
        window.dispatchEvent(new Event('auth:unauthorized'));
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.roles).toEqual([]);
      expect(result.current.permissions).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('roles')).toBeNull();
      expect(localStorage.getItem('permissions')).toBeNull();
      expect(clearQueries).toHaveBeenCalled();
    });

    it('does not affect a session that was never authenticated', async () => {
      mocks.refreshAccessToken.mockResolvedValue(null);
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        window.dispatchEvent(new Event('auth:unauthorized'));
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });
});
