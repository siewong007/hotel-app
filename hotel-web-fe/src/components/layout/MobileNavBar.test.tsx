import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteAccessPolicy } from '../../types';
import { navigationRouteDefinitions } from '../../navigation/routeRegistry';

const mocks = vi.hoisted(() => ({
  policies: {} as Record<string, RouteAccessPolicy>,
  perms: new Set<string>(),
  pathname: '/',
  navigate: vi.fn(),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => mocks.perms.has(p),
    hasRole: () => false,
    getRoutePolicy: (id: string) => mocks.policies[id],
    user: { full_name: 'Test User', username: 't' },
    roles: ['admin'],
    logout: vi.fn(),
  }),
}));

vi.mock('../../router', () => ({
  useLocation: () => ({
    pathname: mocks.pathname,
    search: '',
    hash: '',
    state: null,
    key: 'k',
  }),
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { MobileNavBar } from './MobileNavBar';

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

const grantAllPolicies = () => {
  mocks.perms = new Set(['nav:all']);
  mocks.policies = Object.fromEntries(
    navigationRouteDefinitions
      .filter((item) => item.accessControlled)
      .map((item) => [item.id, navPolicy(item.id, item.path)])
  );
};

describe('MobileNavBar', () => {
  beforeEach(() => {
    mocks.policies = {};
    mocks.perms = new Set();
    mocks.pathname = '/';
    mocks.navigate.mockReset();
  });

  afterEach(cleanup);

  it('renders the four preferred destinations plus More for full access', () => {
    grantAllPolicies();
    render(<MobileNavBar />);
    for (const label of ['Overview', 'Bookings', 'Guests', 'Rooms', 'More']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('hides modules the role cannot access', () => {
    // Grant only housekeeping + dashboard — no bookings or guests.
    mocks.perms = new Set(['nav:all']);
    mocks.policies = {
      housekeeping: navPolicy('housekeeping', '/housekeeping'),
      notifications: navPolicy('notifications', '/notifications'),
      help: navPolicy('help', '/help'),
    };
    render(<MobileNavBar />);
    expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Housekeeping' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bookings' })).toBeNull();
  });

  it('navigates when a destination tab is tapped', () => {
    grantAllPolicies();
    render(<MobileNavBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/bookings');
  });

  it('opens the More sheet listing remaining accessible routes', () => {
    grantAllPolicies();
    render(<MobileNavBar />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('Audit Log')).toBeTruthy();
    expect(screen.getByText('Hotel Settings')).toBeTruthy();
    // A tab destination is not duplicated inside the sheet.
    expect(screen.queryByText('Timeline')).toBeTruthy(); // timeline isn't a tab
  });
});
