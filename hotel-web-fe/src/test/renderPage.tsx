/**
 * Shared page-render harness for smoke and axe tests.
 *
 * Wraps a page in the same provider stack App.tsx uses (query client, i18n,
 * theme, auth, confirm dialog) plus a real TanStack memory-history router so
 * `useNavigate`/`useLocation`/`useSearchParams`/`Link` — whether imported from
 * `@tanstack/react-router` or the `../router` compat shims — work without
 * per-file router mocks.
 *
 * Auth is injected through the real `AuthContext.Provider` (AuthContext is
 * exported for this purpose): pages run their genuine `useAuth()` logic
 * against a fixture instead of a `vi.mock`d module.
 *
 * Pages that read route params (`useParams` on `/bookings/$bookingId`-style
 * routes) or that redirect on mount still need a per-file `vi.mock` — the
 * memory router has no route table to resolve params or Navigate targets
 * against.
 */
import React, { Suspense, type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { AuthContext, type AuthContextType, type AuthState, type User } from '../auth/AuthContext';

// Re-exported so a test that needs a custom auth state can mount
// `<AuthContext.Provider value={buildAuthContextValue(...)}>` directly (e.g.
// when renderPage's router would interfere, or for non-page components).
export { AuthContext };
import { I18nProvider } from '../i18n';
import { ConfirmProvider } from '../components/common/ConfirmProvider';
import { createAppTheme, type ThemeMode } from '../theme';
import type { RouteAccessPolicy } from '../types';

export const STAFF_USER: User = {
  id: 1,
  username: 'staff.test',
  email: 'staff@example.com',
  full_name: 'Staff Test',
  user_type: 'admin',
  is_active: true,
  profile_complete: true,
  missing_profile_fields: [],
  is_super_admin: false,
};

export const GUEST_USER: User = {
  id: 2,
  username: 'guest.test',
  email: 'guest@example.com',
  full_name: 'Guest Test',
  user_type: 'guest',
  guest_id: 7,
  is_active: true,
  profile_complete: true,
  missing_profile_fields: [],
  is_super_admin: false,
};

export function buildRoutePolicy(routeId: string, path: string, permissions: string[]): RouteAccessPolicy {
  return {
    route_id: routeId,
    path,
    required_permissions: permissions,
    required_roles: [],
    excluded_roles: [],
    nav_permissions: permissions,
    nav_roles: [],
    nav_excluded_roles: [],
    is_navigation: true,
  };
}

export interface AuthFixture extends Partial<AuthState> {
  /** When undefined and the fixture is authenticated, hasPermission() returns true for everything. */
  permissions?: string[];
}

const normalizeAccessValue = (value: string) => value.trim().toLowerCase();

/**
 * Builds a complete AuthContextType. By default: an authenticated staff user
 * with every permission granted (the state page-level smoke tests almost
 * always want). Pass `{ permissions: [...] }` to get the real
 * `resource:manage`-implies-action logic, or `user: null, isAuthenticated:
 * false` for the signed-out state.
 */
export function buildAuthContextValue(fixture: AuthFixture = {}): AuthContextType {
  const {
    user = STAFF_USER,
    roles = ['admin'],
    permissions,
    routePolicies = [],
    accessToken = 'test-access-token',
    isAuthenticated = true,
    isLoading = false,
    shouldPromptPasskey = false,
  } = fixture;

  const permissionSet = new Set((permissions ?? []).map(normalizeAccessValue));
  const roleSet = new Set(roles.map(normalizeAccessValue));
  const routePolicyMap = new Map(routePolicies.map((policy) => [policy.route_id, policy]));

  const hasPermission = (permission: string): boolean => {
    if (permissions === undefined) return true;
    const normalized = normalizeAccessValue(permission);
    if (permissionSet.has(normalized)) return true;
    const [resource, action] = normalized.split(':');
    return Boolean(resource && action && action !== 'manage' && permissionSet.has(`${resource}:manage`));
  };

  const noop = () => undefined;
  const reject = (name: string) => () =>
    Promise.reject(new Error(`${name} is not implemented by the test auth fixture`));

  return {
    user,
    roles,
    permissions: permissions ?? [],
    routePolicies,
    accessToken,
    isAuthenticated,
    isLoading,
    shouldPromptPasskey,
    login: reject('login'),
    loginWithGoogle: reject('loginWithGoogle'),
    applyProfileUpdate: noop,
    register: reject('register'),
    logout: noop,
    hasPermission,
    hasRole: (role: string) => roleSet.has(normalizeAccessValue(role)),
    getRoutePolicy: (routeId: string) => routePolicyMap.get(routeId),
    registerPasskey: reject('registerPasskey'),
    loginWithPasskey: reject('loginWithPasskey'),
    dismissPasskeyPrompt: noop,
    checkPasskeys: () => Promise.resolve(false),
  };
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderPageOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Signed-in fixture; pass `{ isAuthenticated: false, user: null }` for signed-out. */
  auth?: AuthFixture | false;
  /** Light or dark theme; default light. */
  themeMode?: ThemeMode;
  /**
   * URL the memory router starts at (path + optional `?search`). Pages that
   * read `useSearchParams` see these params. Set to `false` to render without
   * a router (only for components that never touch routing).
   */
  route?: string | false;
  /** Extra wrapper(s) applied inside the provider stack (e.g. feature providers). */
  inner?: (children: ReactNode) => ReactElement;
}

export function renderPage(ui: ReactElement, options: RenderPageOptions = {}) {
  const { auth, themeMode = 'light', route = '/', inner, ...renderOptions } = options;
  const queryClient = createTestQueryClient();

  const tree = (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider theme={createAppTheme(themeMode)}>
          <CssBaseline />
          {auth === false ? (
            <ConfirmProvider>
              <Suspense fallback={null}>{inner ? inner(ui) : ui}</Suspense>
            </ConfirmProvider>
          ) : (
            <AuthContext.Provider value={buildAuthContextValue(auth)}>
              <ConfirmProvider>
                <Suspense fallback={null}>{inner ? inner(ui) : ui}</Suspense>
              </ConfirmProvider>
            </AuthContext.Provider>
          )}
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );

  if (route === false) {
    return render(tree, renderOptions);
  }

  // A lone root route matches every path, so hooks see the requested location
  // and children render for any URL — including ones with no real route.
  const rootRoute = createRootRoute({ component: () => <>{tree}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [route] }),
  });
  return render(<RouterProvider router={router} />, renderOptions);
}
