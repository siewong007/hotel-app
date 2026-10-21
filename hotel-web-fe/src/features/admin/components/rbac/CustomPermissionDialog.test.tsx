import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Permission } from '../../../../types';

const mutations = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('./hooks/useRBACQueries', () => ({
  useCreatePermission: () => mutations.create,
  useUpdatePermission: () => mutations.update,
}));

vi.mock('../../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

import CustomPermissionDialog, { permissionActions } from './CustomPermissionDialog';

const permission = (id: number, name: string, action: string, extra: Partial<Permission> = {}): Permission => ({
  id,
  name,
  resource: name.split(':')[0],
  action,
  description: `${name} description`,
  created_at: '2026-01-01T00:00:00Z',
  is_system_permission: true,
  ...extra,
});

const catalogue = [
  permission(1, 'bookings:read', 'read'),
  permission(2, 'bookings:manage', 'manage'),
  permission(3, 'communications:compose', 'write'),
  permission(4, 'audit:export', 'export'),
  permission(5, 'reports_hub:view', 'view', { is_system_permission: false, description: 'Opens the hub' }),
];

describe('permissionActions', () => {
  it('offers the actions existing permissions use, common ones first', () => {
    expect(permissionActions(catalogue)).toEqual(['read', 'view', 'manage', 'export', 'write']);
  });
});

describe('CustomPermissionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutations.create.mutateAsync.mockImplementation(async (input) => ({
      ...input,
      id: 99,
      created_at: '2026-10-20T00:00:00Z',
      is_system_permission: false,
    }));
    mutations.update.mutateAsync.mockImplementation(async ({ input }) => ({
      ...catalogue[4],
      ...input,
    }));
  });

  afterEach(cleanup);

  it('creates a permission named after its area and action', async () => {
    const onSaved = vi.fn();
    render(<CustomPermissionDialog permissions={catalogue} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByRole('textbox', { name: /Resource/ }), { target: { value: 'Night_Desk ' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Action/ }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'view' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Shows the night desk page' },
    });

    expect(screen.getByTestId('custom-permission-name').textContent).toBe('Permission name: night_desk:view');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mutations.create.mutateAsync).toHaveBeenCalledWith({
      name: 'night_desk:view',
      resource: 'night_desk',
      action: 'view',
      description: 'Shows the night desk page',
    });
    expect(onSaved.mock.calls[0][1]).toBe(true);
  });

  it('refuses an area the database would reject, and a name that exists', () => {
    render(<CustomPermissionDialog permissions={catalogue} onClose={vi.fn()} onSaved={vi.fn()} />);
    const create = () => screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    const resource = screen.getByRole('textbox', { name: /Resource/ });

    fireEvent.change(resource, { target: { value: 'night desk' } });
    expect(screen.getByText(/Use lowercase letters, digits and underscores/)).toBeTruthy();
    expect(create().disabled).toBe(true);

    // The first action offered is "read", so this names bookings:read.
    fireEvent.change(resource, { target: { value: 'bookings' } });
    expect(screen.getByTestId('custom-permission-name').textContent).toBe('bookings:read already exists.');
    expect(create().disabled).toBe(true);
  });

  it('edits only the description, keeping the name rules depend on', async () => {
    const onSaved = vi.fn();
    render(
      <CustomPermissionDialog permission={catalogue[4]} permissions={catalogue} onClose={vi.fn()} onSaved={onSaved} />
    );

    expect(screen.queryByRole('textbox', { name: /Resource/ })).toBeNull();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Opens the reports hub' },
    });
    fireEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
      permissionId: '5',
      input: {
        name: 'reports_hub:view',
        resource: 'reports_hub',
        action: 'view',
        description: 'Opens the reports hub',
      },
    });
    expect(onSaved.mock.calls[0][1]).toBe(false);
  });

  it('shows the server refusal inside the dialog', async () => {
    mutations.create.mutateAsync.mockRejectedValueOnce(new Error('permissions_name_key violation'));
    render(<CustomPermissionDialog permissions={catalogue} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Resource/ }), { target: { value: 'night_desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('permissions_name_key violation')).toBeTruthy();
  });
});
