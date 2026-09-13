import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteAccessPolicy } from '../../../types';
import { navigationRouteDefinitions } from '../../../navigation/routeRegistry';

const mocks = vi.hoisted(() => ({
  policies: {} as Record<string, RouteAccessPolicy>,
  perms: new Set<string>(),
  pathname: '/',
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => mocks.perms.has(p),
    hasRole: () => false,
    getRoutePolicy: (id: string) => mocks.policies[id],
    user: { full_name: 'Test User', username: 't' },
    roles: ['admin'],
    logout: vi.fn(),
  }),
}));

// The compat layer needs router context; stub the pieces the sidebar uses.
// Translations are NOT mocked — useTranslation reads the shipped en bundles
// without a provider, so the assertions exercise the real label lookup.
vi.mock('../../../router', () => ({
  useLocation: () => ({
    pathname: mocks.pathname,
    search: '',
    hash: '',
    state: null,
    key: 'k',
  }),
  useNavigate: () => vi.fn(),
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// The palette context is mounted by RootLayout; SidebarContent only opens it.
vi.mock('../CommandPalette', () => ({
  useCommandPalette: () => ({ open: vi.fn() }),
}));

import { SidebarContent } from './SidebarContent';

const navPolicy = (routeId: string, path: string): RouteAccessPolicy => ({
  route_id: routeId,
  path,
  required_permissions: [],
  required_roles: [],
  excluded_roles: [],
  nav_permissions: ['nav:all'],
  nav_roles: [],
  nav_excluded_roles: [],
  is_navigation: true,
});

// Every access-controlled nav route becomes visible via one shared permission,
// matching an admin-shaped route_policies payload.
const grantAllPolicies = () => {
  mocks.perms = new Set(['nav:all']);
  mocks.policies = Object.fromEntries(
    navigationRouteDefinitions
      .filter((item) => item.accessControlled)
      .map((item) => [item.id, navPolicy(item.id, item.path)])
  );
};

const renderContent = () =>
  render(<SidebarContent collapsed={false} onToggleCollapse={vi.fn()} />);

describe('SidebarContent', () => {
  beforeEach(() => {
    mocks.policies = {};
    mocks.perms = new Set();
    mocks.pathname = '/';
  });

  afterEach(cleanup);

  it('hides access-controlled items when the session has no route policies', () => {
    renderContent();

    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.queryByText('Night Audit')).toBeNull();
    // Non-accessControlled utility items stay visible without any policy.
    expect(screen.getByText('Help')).toBeTruthy();
    // No visible item in a labeled group means no caption either.
    expect(screen.queryByText('Operations')).toBeNull();
  });

  it('shows every group label and gated item for an admin policy set', () => {
    grantAllPolicies();
    renderContent();

    for (const label of ['Operations', 'Finance', 'Engagement', 'Property', 'Administration']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Night Audit')).toBeTruthy();
    // The bookings item is visible, so the CTA renders too.
    expect(screen.getByRole('button', { name: 'New booking' })).toBeTruthy();
  });

  it('marks the active item with aria-current="page"', () => {
    grantAllPolicies();
    mocks.pathname = '/night-audit';
    renderContent();

    const current = screen.getByText('Night Audit').closest('[aria-current]');
    expect(current?.getAttribute('aria-current')).toBe('page');

    const inactive = screen.getByText('Bookings').closest('a');
    expect(inactive?.getAttribute('aria-current')).toBeNull();
  });

  it('collapses a labeled group via its caption and re-expands it', () => {
    grantAllPolicies();
    renderContent();

    const caption = screen.getByText('Operations').closest('button');
    expect(caption?.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(caption!);
    expect(caption?.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(caption!);
    expect(caption?.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps a folded group expanded while it holds the active page', () => {
    grantAllPolicies();
    mocks.pathname = '/bookings';
    renderContent();

    const caption = screen.getByText('Operations').closest('button');
    fireEvent.click(caption!);

    // The active child forces the section open even after a manual fold.
    expect(caption?.getAttribute('aria-expanded')).toBe('true');
  });
});
