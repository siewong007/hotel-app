import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Permission, Role } from '../../../../types';
import type { PermissionCategory, RoleWithStats } from './types';

// Fixture factories are plain `function` declarations — hoisted by the JS
// runtime, so `vi.hoisted` (which executes before module-scope consts) can call
// them safely.
function roleFixture(id: number, name: string, extra: Partial<Role> = {}): Role {
  return {
    id,
    name,
    description: `${name} description`,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function permFixture(id: number, resource: string, action: string): Permission {
  return {
    id,
    name: `${resource} ${action}`,
    resource,
    action,
    description: `${resource}:${action} description`,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const mocks = vi.hoisted(() => {
  const bookkeeper = roleFixture(1, 'Bookkeeper'); // custom role — mutable
  const admin = roleFixture(2, 'Admin'); // matches the page's BUILTIN regex → lockable
  const bookingsView = permFixture(11, 'bookings', 'view');
  const bookingsCreate = permFixture(12, 'bookings', 'create');
  const ledgersView = permFixture(13, 'ledgers', 'view');

  const stats = (role: Role, permissions: Permission[]): RoleWithStats => ({
    ...role,
    permissionCount: permissions.length,
    navigationCount: 0,
    permissions,
    navigationItems: [],
  });

  const data = {
    roles: [bookkeeper, admin] as Role[],
    permissions: [bookingsView, bookingsCreate, ledgersView] as Permission[],
    users: [] as unknown[],
    rolesWithStats: [
      stats(bookkeeper, [bookingsView]),
      stats(admin, [bookingsView, bookingsCreate, ledgersView]),
    ] as RoleWithStats[],
    permissionCategories: [
      {
        name: 'bookings',
        displayName: 'Bookings',
        icon: 'Event',
        color: '#3366ff',
        permissions: [bookingsView, bookingsCreate],
      },
      {
        name: 'ledgers',
        displayName: 'Ledgers',
        icon: 'Book',
        color: '#22aa66',
        permissions: [ledgersView],
      },
    ] as PermissionCategory[],
    // Bookkeeper holds bookings:view only; Admin holds everything (locked).
    rolePermissionMap: { 1: new Set([11]), 2: new Set([11, 12, 13]) } as Record<
      number,
      Set<number>
    >,
    loading: false,
    error: null as string | null,
    reload: vi.fn(),
    // The page calls setRoles with an updater — apply it so the created role
    // actually lands in the rendered list on the next render.
    setRoles: vi.fn((next: SetStateAction<Role[]>) => {
      data.roles = typeof next === 'function' ? next(data.roles) : next;
    }),
    setUsers: vi.fn(),
    // Mirrors the real hook: rewrites the role's canonical permission set, which
    // re-syncs the page draft and clears the dirty bar after a save.
    updateRolePermissions: vi.fn((roleId: number, permissions: Permission[]) => {
      data.rolePermissionMap = {
        ...data.rolePermissionMap,
        [roleId]: new Set(permissions.map((permission) => permission.id)),
      };
    }),
    updateUserRoles: vi.fn(),
  };

  return {
    data,
    mutations: {
      replaceRolePermissions: {
        mutateAsync: vi.fn(async () => ({})),
        mutate: vi.fn(),
        isPending: false,
      },
      createRole: {
        mutateAsync: vi.fn(async (input: { name: string }) => roleFixture(3, input.name)),
        mutate: vi.fn(),
        isPending: false,
      },
      updateRole: {
        mutateAsync: vi.fn(async () => ({})),
        mutate: vi.fn(),
        isPending: false,
      },
      deleteRole: {
        mutateAsync: vi.fn(async () => ({})),
        mutate: vi.fn(),
        isPending: false,
      },
    },
  };
});

vi.mock('./hooks/useRBACData', () => ({
  useRBACData: () => mocks.data,
}));

vi.mock('./hooks/useRBACQueries', () => ({
  useCreateRole: () => mocks.mutations.createRole,
  useUpdateRole: () => mocks.mutations.updateRole,
  useDeleteRole: () => mocks.mutations.deleteRole,
  useReplaceRolePermissions: () => mocks.mutations.replaceRolePermissions,
}));

vi.mock('./UsersTab', () => ({
  UsersTab: () => <div data-testid="users-tab" />,
}));

import RBACManagementPage from './RBACManagementPage';
import { expectNoCriticalAxeViolations } from '../../../../test/axe';

/** Returns the `role="switch"` toggle inside the grid row for `resource:action`. */
const switchForPerm = (code: string): HTMLElement => {
  const codeEl = screen.getByText(code);
  const row = codeEl.parentElement?.parentElement;
  if (!row) throw new Error(`permission row not found for ${code}`);
  return within(row).getByRole('switch');
};

/** Returns a category header row (title + count + Enable/Disable-all button). */
const categoryHeader = (displayName: string): HTMLElement => {
  const titleEl = screen.getByText(displayName);
  const header = titleEl.parentElement?.parentElement;
  if (!header) throw new Error(`category header not found for ${displayName}`);
  return header;
};

describe('RBACManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data.loading = false;
    mocks.data.error = null;
    // Rebuild the mutable slices — tests append roles and rewrite the map.
    mocks.data.roles = [roleFixture(1, 'Bookkeeper'), roleFixture(2, 'Admin')];
    mocks.data.rolePermissionMap = { 1: new Set([11]), 2: new Set([11, 12, 13]) };
  });

  afterEach(cleanup);

  it('renders the roles workspace', () => {
    render(<RBACManagementPage />);
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });

  it('shows an error state when the snapshot fails', () => {
    mocks.data.error = 'boom';
    render(<RBACManagementPage />);
    expect(document.body.textContent).toContain('boom');
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<RBACManagementPage />);
    await expectNoCriticalAxeViolations(container);
  });

  it('toggles a permission, shows the dirty bar, and saves the full id set', async () => {
    render(<RBACManagementPage />);
    // 'Admin' wins the default-selection effect (/admin/i) — pick Bookkeeper.
    fireEvent.click(screen.getByRole('button', { name: /Bookkeeper/i }));

    expect(switchForPerm('bookings:create').getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/Unsaved changes/i)).toBeNull();

    fireEvent.click(switchForPerm('bookings:create'));
    expect(await screen.findByText(/Unsaved changes/i)).toBeTruthy();
    expect(switchForPerm('bookings:create').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() =>
      expect(mocks.mutations.replaceRolePermissions.mutateAsync).toHaveBeenCalledWith({
        roleId: '1',
        input: { permission_ids: [11, 12] },
      }),
    );
    expect(mocks.data.updateRolePermissions).toHaveBeenCalledWith(1, expect.any(Array));
    // The canonical map caught up → draft re-syncs clean → the save bar clears.
    await waitFor(() => expect(screen.queryByText(/Unsaved changes/i)).toBeNull());
  });

  it('enable-all on a category adds every permission in it; discard restores', async () => {
    render(<RBACManagementPage />);
    fireEvent.click(screen.getByRole('button', { name: /Bookkeeper/i }));

    // Ledgers holds 0 enabled permissions for Bookkeeper, so the module stays
    // hidden until the "modules hidden" notice's Grant access reveals it.
    fireEvent.click(screen.getByRole('button', { name: /Grant access/i }));
    expect(switchForPerm('ledgers:view').getAttribute('aria-checked')).toBe('false');

    fireEvent.click(
      within(categoryHeader('Ledgers')).getByRole('button', { name: 'Enable all' }),
    );
    expect(await screen.findByText(/Unsaved changes/i)).toBeTruthy();
    expect(switchForPerm('ledgers:view').getAttribute('aria-checked')).toBe('true');
    expect(
      within(categoryHeader('Ledgers')).getByRole('button', { name: 'Disable all' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByText(/Unsaved changes/i)).toBeNull());
    expect(switchForPerm('ledgers:view').getAttribute('aria-checked')).toBe('false');
    expect(mocks.mutations.replaceRolePermissions.mutateAsync).not.toHaveBeenCalled();
  });

  it('creates a role through the dialog and selects it', async () => {
    render(<RBACManagementPage />);
    fireEvent.click(screen.getByRole('button', { name: 'New role' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Role name/i), {
      target: { value: 'Night Porter' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mocks.mutations.createRole.mutateAsync).toHaveBeenCalledWith({
        name: 'Night Porter',
        description: undefined,
      }),
    );
    await waitFor(() =>
      expect(mocks.data.updateRolePermissions).toHaveBeenCalledWith(3, []),
    );
    // setRoles appended the created role and the page selected it.
    expect(await screen.findByRole('heading', { name: /Night Porter/i })).toBeTruthy();
  });

  it('locks a builtin role that holds every permission', () => {
    render(<RBACManagementPage />);
    // 'Admin' matches BUILTIN and holds all 3 permissions → auto-selected, locked.
    expect(screen.getByText('Full access')).toBeTruthy();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    expect(switches.every((el) => el.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(screen.queryByText(/Save changes/i)).toBeNull();

    // Locked switches refuse draft changes — no dirty bar ever appears.
    fireEvent.click(switches[0]);
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(/Unsaved changes/i)).toBeNull();
  });
});
