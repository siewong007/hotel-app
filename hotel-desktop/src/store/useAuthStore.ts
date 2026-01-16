import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * @deprecated Use `useAuth` from `@auth/AuthContext` instead.
 * This store is kept for backward compatibility but AuthContext is the primary
 * auth implementation with full login/logout/passkey functionality.
 *
 * Migration:
 * - import { useAuth } from '@auth/AuthContext';
 * - const { user, isAuthenticated, login, logout, hasRole, hasPermission } = useAuth();
 */

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// User interface aligned with AuthContext
interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  user_type: 'admin' | 'guest';
  guest_id?: number;
  is_active: boolean;
}

interface AuthState {
  // State
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  roles: string[];
  permissions: string[];
  isLoading: boolean;
  shouldPromptPasskey: boolean;

  // Actions
  setAuth: (tokens: AuthTokens, user: User, roles: string[], permissions: string[]) => void;
  clearAuth: () => void;
  updateUser: (user: Partial<User>) => void;
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
  isAuthenticated: () => boolean;
  setLoading: (loading: boolean) => void;
  setShouldPromptPasskey: (prompt: boolean) => void;
}

/**
 * Global authentication store using Zustand
 *
 * @deprecated Use `useAuth` from `@auth/AuthContext` instead for full functionality.
 * This store is kept for cases where you need direct store access outside of React components.
 *
 * For React components, prefer:
 * import { useAuth } from '@auth/AuthContext';
 * const { user, isAuthenticated, login, logout } = useAuth();
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      accessToken: null as string | null,
      refreshToken: null as string | null,
      user: null as User | null,
      roles: [] as string[],
      permissions: [] as string[],
      isLoading: true,
      shouldPromptPasskey: false,

      // Set authentication data
      setAuth: (tokens, user, roles, permissions) => {
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          user,
          roles,
          permissions,
          isLoading: false,
        });
      },

      // Clear authentication (logout)
      clearAuth: () => {
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          roles: [],
          permissions: [],
          isLoading: false,
          shouldPromptPasskey: false,
        });
      },

      // Update user profile data
      updateUser: (updates) => {
        const currentUser = get().user;
        if (currentUser) {
          set({
            user: { ...currentUser, ...updates },
          });
        }
      },

      // Check if user has a specific role
      hasRole: (role) => {
        return get().roles.includes(role);
      },

      // Check if user has a specific permission
      hasPermission: (permission) => {
        return get().permissions.includes(permission);
      },

      // Check if user is authenticated
      isAuthenticated: () => {
        return get().accessToken !== null && get().user !== null;
      },

      // Set loading state
      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      // Set passkey prompt state
      setShouldPromptPasskey: (prompt) => {
        set({ shouldPromptPasskey: prompt });
      },
    }),
    {
      name: 'auth-storage', // Key in localStorage
      // Only persist specific fields (not loading state)
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        roles: state.roles,
        permissions: state.permissions,
      }),
    }
  )
);

// Helper function for backward compatibility with direct localStorage access
export const getStoredAccessToken = (): string | null => {
  return useAuthStore.getState().accessToken;
};

export const getStoredRefreshToken = (): string | null => {
  return useAuthStore.getState().refreshToken;
};
