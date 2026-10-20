import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Permission, Role, RouteAccessPolicy } from '../../../../../types';

const auth = vi.hoisted(() => ({
  permissions: new Set<string>(['permissions:manage', 'roles:read']),
  roles: new Set<string>(['admin']),
}));

const mutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

const notify = vi.hoisted(() => vi.fn());

vi.mock('../../../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => auth.permissions.has(permission),
    hasRole: (role: string) => auth.roles.has(role),
  }),
}));

vi.mock('../hooks/useRBACQueries', () => ({
  useUpdateRouteAccessPolicy: () => mutation,
}));

vi.mock('../../../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

vi.mock('../../../../../utils/apiNotifications', () => ({
  emitApiNotification: notify,
}));

import PageAccessTab from './PageAccessTab';

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

const permission = (id: number, name: string): Permission => {
  const [resource, action] = name.split(':');
  return { id, name, resource, action, description: `${name} description`, created_at: '2026-01-01T00:00:00Z' };
};
const role = (id: number, name: string): Role => ({ id, name, created_at: '2026-01-01T00:00:00Z' });

const permissions = [
  permission(1, 'bookings:read'),
  permission(2, 'bookings:manage'),
  permission(3, 'roles:read'),
  permission(4, 'roles:manage'),
  permission(5, 'users:manage'),
];
const roles = [role(1, 'admin'), role(2, 'receptionist'), role(3, 'guest')];
// admin holds everything, receptionist reads bookings, guest holds nothing.
const rolePermissionMap = { 1: new Set([1, 2, 3, 4, 5]), 2: new Set([1]), 3: new Set<number>() };

const policies = [
  policy('bookings', {
    required_permissions: ['bookings:read', 'bookings:manage'],
    nav_permissions: ['bookings:read', 'bookings:manage'],
    nav_excluded_roles: ['guest'],
  }),
  policy('rbac', {
    required_permissions: ['roles:read', 'roles:manage', 'users:manage'],
    nav_permissions: ['roles:read', 'roles:manage', 'users:manage'],
  }),
  // The /reports page redirects to /insights: nothing checks this rule.
  policy('reports', { required_permissions: ['bookings:read'] }),
  policy('guest-relations-detail', { required_permissions: ['bookings:read'], nav_label: null as unknown as string }),
];

const renderTab = (onPolicySaved = vi.fn()) => {
  render(
    <PageAccessTab
      routePolicies={policies}
      roles={roles}
      permissions={permissions}
      rolePermissionMap={rolePermissionMap}
      onPolicySaved={onPolicySaved}
    />
  );
  return onPolicySaved;
};

/** The Autocomplete root holding the `index`-th field labelled `label`. */
const field = (label: string, index = 0): HTMLElement => {
  const input = screen.getAllByLabelText(label)[index];
  const root = input.closest('.MuiAutocomplete-root');
  if (!root) throw new Error(`no autocomplete for ${label}`);
  return root as HTMLElement;
};

const removeChip = (container: HTMLElement, name: string) => {
  const chip = within(container).getByText(name).closest('.MuiChip-root');
  if (!chip) throw new Error(`no chip for ${name}`);
  fireEvent.click(within(chip as HTMLElement).getByTestId('CancelIcon'));
};

describe('PageAccessTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.permissions = new Set(['permissions:manage', 'roles:read']);
    auth.roles = new Set(['admin']);
    mutation.isPending = false;
    mutation.mutateAsync.mockImplementation(async ({ routeId, input }) => ({
      ...policies.find((candidate) => candidate.route_id === routeId)!,
      ...input,
    }));
  });

  afterEach(cleanup);

  it('lists the pages a rule protects, with the roles each rule lets in', () => {
    renderTab();

    const bookings = screen.getByTestId('page-access-row-bookings');
    expect(within(bookings).getByText('Bookings')).toBeTruthy();
    expect(within(bookings).getAllByText('admin')).toHaveLength(2);
    expect(within(bookings).getAllByText('receptionist')).toHaveLength(2);
    expect(within(bookings).queryByText('guest')).toBeNull();

    // A rule whose page now redirects is left out; a detail page's rule is in.
    expect(screen.queryByTestId('page-access-row-reports')).toBeNull();
    const detail = screen.getByTestId('page-access-row-guest-relations-detail');
    expect(within(detail).getByText('Guest profile')).toBeTruthy();
    expect(within(detail).getByText('Not in the menu')).toBeTruthy();
  });

  it('is read-only without permissions:manage', () => {
    auth.permissions = new Set(['roles:read']);
    renderTab();
    expect(screen.getByText(/Changing it needs the permissions:manage permission/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit access to/ })).toBeNull();
  });

  it('previews a change and saves the full rule with its menu metadata', async () => {
    const onPolicySaved = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Edit access to Bookings' }));

    expect(screen.getByTestId('page-access-can-open').textContent).toBe('Can open: admin and receptionist');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    // Opening now needs bookings:manage, which the receptionist lacks — but
    // the menu still shows them the page, which the dialog calls out.
    removeChip(field('Any of these permissions', 0), 'bookings:read');
    expect(screen.getByTestId('page-access-can-open').textContent).toBe('Can open: admin');
    expect(screen.getByText("receptionist will see this page in the menu but can't open it.")).toBeTruthy();

    fireEvent.click(save);
    await waitFor(() => expect(mutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      routeId: 'bookings',
      input: {
        nav_label: 'bookings',
        nav_group: 'admin',
        is_navigation: true,
        required_permissions: ['bookings:manage'],
        required_roles: [],
        excluded_roles: [],
        nav_permissions: ['bookings:read', 'bookings:manage'],
        nav_roles: [],
        nav_excluded_roles: ['guest'],
      },
    });
    await waitFor(() => expect(onPolicySaved).toHaveBeenCalledTimes(1));
    expect(onPolicySaved.mock.calls[0][0].required_permissions).toEqual(['bookings:manage']);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('refuses a change that would lock the editor out of Access Control', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Edit access to Access Control' }));

    // The editor holds roles:read; dropping it leaves only rules they fail.
    removeChip(field('Any of these permissions', 0), 'roles:read');

    expect(screen.getByText(/This would lock you out of Access Control/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('warns, without blocking, when the editor loses another page', () => {
    auth.permissions = new Set(['permissions:manage', 'bookings:read']);
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Edit access to Bookings' }));

    removeChip(field('Any of these permissions', 0), 'bookings:read');

    expect(screen.getByText("You won't be able to open this page after you save.")).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the server refusal inside the dialog', async () => {
    mutation.mutateAsync.mockRejectedValueOnce(new Error('Unknown role in route policy: ghost'));
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Edit access to Bookings' }));
    removeChip(field('Hide it from these roles'), 'guest');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Unknown role in route policy: ghost')).toBeTruthy();
  });
});
