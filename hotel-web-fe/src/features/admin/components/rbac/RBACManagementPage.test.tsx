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
    name: `${resource}:${action}`,
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
    routePolicies: [] as unknown[],
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
    setPermissions: vi.fn((next: SetStateAction<Permission[]>) => {
      data.permissions = typeof next === 'function' ? next(data.permissions) : next;
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
    updateRoutePolicy: vi.fn(),
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
      deletePermission: {
        mutateAsync: vi.fn(async () => ({})),
        mutate: vi.fn(),
        isPending: false,
      },
    },
  };
});

const auth = vi.hoisted(() => ({ user: { is_super_admin: false } as { is_super_admin: boolean } | null }));

vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: auth.user }),
}));

vi.mock('./CustomPermissionDialog', () => ({
  default: (props: { permission?: { name: string } }) => (
    <div data-testid="custom-permission-dialog" data-editing={props.permission?.name ?? ''} />
  ),
}));

const phone = vi.hoisted(() => ({ isPhone: false }));

vi.mock('../../../../hooks/useIsPhone', () => ({
  useIsPhone: () => phone.isPhone,
}));

vi.mock('./hooks/useRBACData', () => ({
  useRBACData: () => mocks.data,
}));

vi.mock('./hooks/useRBACQueries', () => ({
  useCreateRole: () => mocks.mutations.createRole,
  useUpdateRole: () => mocks.mutations.updateRole,
  useDeleteRole: () => mocks.mutations.deleteRole,
  useDeletePermission: () => mocks.mutations.deletePermission,
  useReplaceRolePermissions: () => mocks.mutations.replaceRolePermissions,
}));

vi.mock('./PageAccessTab', () => ({
  PageAccessTab: (props: { onPolicySaved: unknown; routePolicies: unknown }) => (
    <div
      data-testid="page-access-tab"
      data-saves-to-snapshot={String(props.onPolicySaved === mocks.data.updateRoutePolicy)}
      data-policies={String(props.routePolicies === mocks.data.routePolicies)}
    />
  ),
}));

vi.mock('./UsersTab', () => ({
  UsersTab: () => <div data-testid="users-tab" />,
}));

import RBACManagementPage from './RBACManagementPage';

const BASE_PERMISSIONS = mocks.data.permissions;
const BASE_CATEGORIES = mocks.data.permissionCategories;
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
    mocks.data.permissions = BASE_PERMISSIONS;
    mocks.data.permissionCategories = BASE_CATEGORIES;
    mocks.data.routePolicies = [];
    auth.user = { is_super_admin: false };
    phone.isPhone = false;
  });

  afterEach(cleanup);

  it('starts every permission group closed on a phone, and opens the ones a search matches', async () => {
    phone.isPhone = true;
    render(<RBACManagementPage />);
    // Group headers only: no permission rows until one is opened.
    expect(screen.getByText('Bookings')).toBeTruthy();
    expect(screen.getByText('Ledgers')).toBeTruthy();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText(/search permissions by name/i), {
      target: { value: 'ledgers' },
    });
    expect(await screen.findByText('ledgers:view')).toBeTruthy();
    expect(screen.queryByText('bookings:view')).toBeNull();
  });

  it('starts every permission group open on a wider screen', () => {
    render(<RBACManagementPage />);
    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });

  it('opens the page access tab wired to the snapshot', () => {
    render(<RBACManagementPage />);
    expect(screen.queryByTestId('page-access-tab')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Page access/ }));
    const tab = screen.getByTestId('page-access-tab');
    expect(tab.getAttribute('data-policies')).toBe('true');
    expect(tab.getAttribute('data-saves-to-snapshot')).toBe('true');
  });

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

describe('RBACManagementPage custom permissions', () => {
  // Built-in, but its action column ("write") differs from its name.
  const compose = { ...permFixture(16, 'communications', 'write'), name: 'communications:compose' };
  const reportsView = { ...permFixture(14, 'reports', 'view'), is_system_permission: false }; // a page rule names it
  const reportsExport = { ...permFixture(17, 'reports', 'export'), is_system_permission: false }; // free to delete
  const ledgersExport = { ...permFixture(15, 'ledgers', 'export'), is_system_permission: false }; // Bookkeeper holds it

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data.loading = false;
    mocks.data.error = null;
    mocks.data.roles = [roleFixture(1, 'Bookkeeper'), roleFixture(2, 'Admin')];
    mocks.data.rolePermissionMap = { 1: new Set([11, 15]), 2: new Set([11, 12, 13]) };
    mocks.data.permissions = [...BASE_PERMISSIONS, reportsView, ledgersExport, compose, reportsExport];
    mocks.data.permissionCategories = [
      BASE_CATEGORIES[0],
      { ...BASE_CATEGORIES[1], permissions: [...BASE_CATEGORIES[1].permissions, ledgersExport] },
      { name: 'reports', displayName: 'Reports', icon: 'Assessment', color: '#8855cc', permissions: [reportsExport, reportsView] },
      { name: 'communications', displayName: 'Communications', icon: 'Mail', color: '#cc8855', permissions: [compose] },
    ];
    mocks.data.routePolicies = [
      {
        route_id: 'reports-hub',
        path: '/reports-hub',
        required_permissions: [],
        required_roles: [],
        excluded_roles: [],
        nav_permissions: ['reports:view'],
        nav_roles: [],
        nav_excluded_roles: [],
        is_navigation: true,
      },
    ];
    auth.user = { is_super_admin: true };
    phone.isPhone = false;
  });

  afterEach(cleanup);

  const search = (text: string) =>
    fireEvent.change(screen.getByPlaceholderText(/search permissions by name/i), { target: { value: text } });

  it('shows each permission by the name the app checks', () => {
    render(<RBACManagementPage />);
    search('compose');
    expect(screen.getByText('communications:compose')).toBeTruthy();
    expect(screen.queryByText('communications:write')).toBeNull();
  });

  it('offers permission editing to super admins only', () => {
    auth.user = { is_super_admin: false };
    const { unmount } = render(<RBACManagementPage />);
    search('reports');
    expect(screen.getAllByText('Custom').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'New permission' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit reports:view' })).toBeNull();
    unmount();

    auth.user = { is_super_admin: true };
    render(<RBACManagementPage />);
    search('reports');
    expect(screen.getByRole('button', { name: 'New permission' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit reports:view' })).toBeTruthy();
    // Built-in permissions never get the controls.
    search('compose');
    expect(screen.queryByRole('button', { name: /communications:compose/ })).toBeNull();
  });

  it('opens the permission dialog to create and to edit', () => {
    render(<RBACManagementPage />);
    fireEvent.click(screen.getByRole('button', { name: 'New permission' }));
    expect(screen.getByTestId('custom-permission-dialog').getAttribute('data-editing')).toBe('');
    cleanup();

    render(<RBACManagementPage />);
    search('reports');
    fireEvent.click(screen.getByRole('button', { name: 'Edit reports:view' }));
    expect(screen.getByTestId('custom-permission-dialog').getAttribute('data-editing')).toBe('reports:view');
  });

  it('blocks deleting a permission a role holds or a page rule names, and says why', async () => {
    render(<RBACManagementPage />);
    search('export');
    const held = screen.getByRole('button', { name: 'Delete ledgers:export' }) as HTMLButtonElement;
    expect(held.disabled).toBe(true);
    fireEvent.mouseOver(held.parentElement as HTMLElement);
    expect(await screen.findByText('Turn it off for Bookkeeper before deleting it.')).toBeTruthy();

    search('reports:view');
    expect((screen.getByRole('button', { name: 'Delete reports:view' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('deletes a free custom permission after confirming', async () => {
    render(<RBACManagementPage />);
    search('reports:export');
    fireEvent.click(screen.getByRole('button', { name: 'Delete reports:export' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete reports:export? This can\'t be undone.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mocks.mutations.deletePermission.mutateAsync).toHaveBeenCalledWith('17'));
    await waitFor(() =>
      expect(mocks.data.permissions.some((permission) => permission.id === 17)).toBe(false)
    );
  });

  it('keeps the controls off while permission changes are unsaved', () => {
    render(<RBACManagementPage />);
    // The default selection is Admin; toggle one of its switches to dirty the draft.
    fireEvent.click(switchForPerm('bookings:view'));
    expect((screen.getByRole('button', { name: 'New permission' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
