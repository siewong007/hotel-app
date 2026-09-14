import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  data: {
    roles: [] as unknown[],
    permissions: [] as unknown[],
    users: [] as unknown[],
    rolesWithStats: [] as unknown[],
    permissionCategories: [] as unknown[],
    rolePermissionMap: new Map(),
    loading: false,
    error: null as string | null,
    reload: vi.fn(),
    setRoles: vi.fn(),
    setUsers: vi.fn(),
    updateRolePermissions: vi.fn(),
    updateUserRoles: vi.fn(),
  },
}));

const emptyMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('./hooks/useRBACData', () => ({
  useRBACData: () => mocks.data,
}));

vi.mock('./hooks/useRBACQueries', () => ({
  useCreateRole: () => emptyMutation,
  useUpdateRole: () => emptyMutation,
  useDeleteRole: () => emptyMutation,
  useReplaceRolePermissions: () => emptyMutation,
}));

vi.mock('./UsersTab', () => ({
  UsersTab: () => <div data-testid="users-tab" />,
}));

import RBACManagementPage from './RBACManagementPage';
import { expectNoCriticalAxeViolations } from '../../../../test/axe';

describe('RBACManagementPage', () => {
  beforeEach(() => {
    mocks.data.loading = false;
    mocks.data.error = null;
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
});
