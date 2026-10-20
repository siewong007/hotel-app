import { describe, expect, it } from 'vitest';
import type { Permission, Role, RouteAccessPolicy } from '../../../../../types';
import type { AppRouteDefinition } from '../../../../../navigation/routeRegistry';
import {
  buildPageAccessRows,
  draftChanged,
  draftFrom,
  inputFrom,
  roleChecksFor,
  ruleOutcome,
} from './pageAccessModel';

function policy(routeId: string, extra: Partial<RouteAccessPolicy> = {}): RouteAccessPolicy {
  return {
    route_id: routeId,
    path: `/${routeId}`,
    nav_label: routeId,
    nav_group: 'admin',
    required_permissions: [],
    required_roles: [],
    excluded_roles: [],
    nav_permissions: [],
    nav_roles: [],
    nav_excluded_roles: [],
    is_navigation: true,
    ...extra,
  };
}

function route(id: string, extra: Partial<AppRouteDefinition> = {}): AppRouteDefinition {
  return {
    id,
    path: `/${id}`,
    component: {} as AppRouteDefinition['component'],
    animationType: 'fade',
    visibility: 'auth',
    ...extra,
  };
}

const role = (id: number, name: string): Role => ({ id, name, created_at: '2026-01-01T00:00:00Z' });
const permission = (id: number, name: string): Permission => {
  const [resource, action] = name.split(':');
  return { id, name, resource, action, created_at: '2026-01-01T00:00:00Z' };
};

describe('buildPageAccessRows', () => {
  const routes = [
    route('dashboard', { navGroup: 'overview' }),
    route('rbac', { navGroup: 'administration', accessControlled: true }),
    route('bookings', { navGroup: 'front_office', accessControlled: true }),
    route('guest-relations', { navGroup: 'guests', accessControlled: true }),
    route('guest-directory', { navGroup: 'guests', accessControlled: true, policyId: 'guest-relations' }),
    route('profile'),
  ];

  it('keeps only policies a page checks, in sidebar order', () => {
    const rows = buildPageAccessRows(
      [
        policy('reports'), // its page now redirects: nothing checks this rule
        policy('profile'),
        policy('rbac'),
        policy('guest-relations-detail'),
        policy('bookings'),
        policy('guest-relations'),
        policy('dashboard'),
      ],
      routes,
      ['guest-relations-detail']
    );

    expect(rows.map((row) => row.policy.route_id)).toEqual([
      'dashboard',
      'bookings',
      'guest-relations',
      'rbac',
      'guest-relations-detail',
      'profile',
    ]);
    expect(rows.map((row) => row.group)).toEqual([
      'overview',
      'front_office',
      'guests',
      'administration',
      'other',
      'other',
    ]);
  });

  it('ties a shared policy to every menu entry it decides', () => {
    const [row] = buildPageAccessRows([policy('guest-relations')], routes, []);
    expect(row.route?.id).toBe('guest-relations');
    expect(row.menuRoutes.map((entry) => entry.id)).toEqual(['guest-relations', 'guest-directory']);
  });

  it('leaves the stored rules no page checks out of the real registry', () => {
    const rows = buildPageAccessRows([
      policy('reports'),
      policy('guest-config'),
      policy('teams'),
      policy('rbac'),
      policy('guest-relations-follow-ups'),
    ]);
    expect(rows.map((row) => row.policy.route_id).sort()).toEqual([
      'guest-relations-follow-ups',
      'rbac',
    ]);
  });
});

describe('ruleOutcome', () => {
  const permissions = [
    permission(1, 'bookings:read'),
    permission(2, 'bookings:manage'),
    permission(3, 'audit:read'),
  ];
  const roles = [role(1, 'admin'), role(2, 'receptionist'), role(3, 'guest')];
  const roleChecks = roleChecksFor(roles, permissions, {
    1: new Set([2, 3]), // bookings:manage implies bookings:read
    2: new Set([1]),
    3: new Set(),
  });
  const [row] = buildPageAccessRows(
    [
      policy('bookings', {
        required_permissions: ['bookings:read'],
        nav_permissions: ['bookings:read'],
        nav_excluded_roles: ['guest'],
      }),
    ],
    [route('bookings', { navGroup: 'front_office', accessControlled: true })],
    []
  );
  const names = (list: Role[]) => list.map((entry) => entry.name);

  it('lists the roles a rule admits and shows the page to', () => {
    const outcome = ruleOutcome(row, draftFrom(row.policy), roleChecks);
    expect(names(outcome.canOpen)).toEqual(['admin', 'receptionist']);
    expect(names(outcome.inMenu)).toEqual(['admin', 'receptionist']);
  });

  it('follows a draft, including excluded roles and role grants', () => {
    const outcome = ruleOutcome(
      row,
      {
        ...draftFrom(row.policy),
        required_permissions: ['audit:read'],
        required_roles: ['guest'],
        nav_excluded_roles: ['guest', 'receptionist'],
      },
      roleChecks
    );
    expect(names(outcome.canOpen)).toEqual(['admin', 'guest']);
    expect(names(outcome.inMenu)).toEqual(['admin']);
  });

  it('shows an access-controlled page in nobody\'s menu when the menu rule is empty', () => {
    const outcome = ruleOutcome(row, { ...draftFrom(row.policy), nav_permissions: [] }, roleChecks);
    expect(outcome.inMenu).toEqual([]);
  });
});

describe('drafts', () => {
  const stored = policy('rbac', { required_permissions: ['roles:read'], nav_label: 'Access Control' });

  it('notices any change to a list, including order', () => {
    expect(draftChanged(stored, draftFrom(stored))).toBe(false);
    expect(draftChanged(stored, { ...draftFrom(stored), excluded_roles: ['guest'] })).toBe(true);
    const reordered = policy('rbac', { required_permissions: ['a:read', 'b:read'] });
    expect(draftChanged(reordered, { ...draftFrom(reordered), required_permissions: ['b:read', 'a:read'] })).toBe(true);
  });

  it('sends the edited lists with the stored menu metadata', () => {
    const draft = { ...draftFrom(stored), required_roles: ['admin'] };
    expect(inputFrom(stored, draft)).toEqual({
      nav_label: 'Access Control',
      nav_group: 'admin',
      is_navigation: true,
      required_permissions: ['roles:read'],
      required_roles: ['admin'],
      excluded_roles: [],
      nav_permissions: [],
      nav_roles: [],
      nav_excluded_roles: [],
    });
  });
});
