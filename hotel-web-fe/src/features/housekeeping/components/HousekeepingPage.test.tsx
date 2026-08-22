import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HousekeepingBoardResponse } from '../../../types';

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(['housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'rooms:update', 'maintenance:read', 'maintenance:write']),
  board: {
    data: undefined as HousekeepingBoardResponse | undefined,
    error: null as unknown,
    isPending: false,
  },
  updateTaskMutate: vi.fn(),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '5' },
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));

vi.mock('../hooks/useHousekeepingQueries', () => ({
  useHousekeepingBoard: () => ({ ...mocks.board }),
  useCreateHousekeepingTask: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateHousekeepingTask: () => ({ mutate: mocks.updateTaskMutate, isPending: false, error: null }),
  useSyncRoomStatuses: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('./MaintenanceTab', () => ({
  default: () => <div data-testid="maintenance-tab" />,
}));

import HousekeepingPage from './HousekeepingPage';

const room = (
  overrides: Partial<HousekeepingBoardResponse['rooms'][number]> & { id: number; room_number: string },
) => ({
  room_type: 'STDQ',
  status: 'dirty',
  floor: 2,
  ...overrides,
});

const renderBoard = (rooms: HousekeepingBoardResponse['rooms']) => {
  mocks.board.data = { rooms };
  return render(<HousekeepingPage />);
};

beforeEach(() => {
  mocks.permissions = new Set([
    'housekeeping:read',
    'housekeeping:create',
    'housekeeping:update',
    'rooms:update',
    'maintenance:read',
    'maintenance:write',
  ]);
  mocks.updateTaskMutate.mockReset();
});

afterEach(cleanup);

describe('HousekeepingPage board', () => {
  it('groups rooms under their status headings and shows open tasks', () => {
    renderBoard([
      room({ id: 1, room_number: '201', status: 'dirty', open_task: { id: 900, room_id: 1, task_type: 'cleaning', status: 'pending', priority: 'normal', created_at: '', updated_at: '' } as never }),
      room({ id: 2, room_number: '301', status: 'cleaning' }),
    ]);

    expect(screen.getByText('Room 201')).toBeTruthy();
    expect(screen.getByText('Room 301')).toBeTruthy();
    expect(screen.getByText(/pending/i)).toBeTruthy();
  });

  it('filters rooms by floor', () => {
    renderBoard([
      room({ id: 1, room_number: '201', floor: 2 }),
      room({ id: 2, room_number: '101', floor: 1 }),
      room({ id: 3, room_number: '102', floor: 1 }),
    ]);

    // Two selects exist (Floor, Priority); the Floor one is labelled.
    const floorSelect = screen.getByLabelText('Floor');
    fireEvent.mouseDown(floorSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Floor 1' }));

    expect(screen.queryByText('Room 201')).toBeNull();
    expect(screen.getByText('Room 101')).toBeTruthy();
    expect(screen.getByText('Room 102')).toBeTruthy();
  });

  it('starts a pending task with the right transition and actor', () => {
    renderBoard([
      room({
        id: 1,
        room_number: '201',
        open_task: { id: 900, room_id: 1, task_type: 'cleaning', status: 'pending', priority: 'normal', created_at: '', updated_at: '' } as never,
      }),
    ]);

    fireEvent.click(screen.getByText('Start'));
    expect(mocks.updateTaskMutate).toHaveBeenCalledWith({ taskId: 900, input: { status: 'in_progress' } });
  });

  it('completes an in-progress task assigned to the current user', () => {
    renderBoard([
      room({
        id: 1,
        room_number: '201',
        open_task: { id: 901, room_id: 1, task_type: 'cleaning', status: 'in_progress', priority: 'normal', created_at: '', updated_at: '' } as never,
      }),
    ]);

    const start = screen.queryByText('Start');
    expect(start).toBeNull();
    fireEvent.click(screen.getByText('Complete'));
    expect(mocks.updateTaskMutate).toHaveBeenCalledWith({ taskId: 901, input: { status: 'completed' } });
  });

  it('hides maintenance tab without maintenance:read and hides write controls for read-only staff', () => {
    mocks.permissions = new Set(['housekeeping:read']);

    renderBoard([
      room({
        id: 1,
        room_number: '201',
        open_task: { id: 902, room_id: 1, task_type: 'cleaning', status: 'pending', priority: 'normal', created_at: '', updated_at: '' } as never,
      }),
    ]);

    // Read-only: no action buttons on the task/room cards.
    expect(screen.queryByText('Start')).toBeNull();
    expect(screen.queryByText('Complete')).toBeNull();

    expect(screen.queryByRole('tab', { name: /Maintenance/i })).toBeNull();
  });
});
