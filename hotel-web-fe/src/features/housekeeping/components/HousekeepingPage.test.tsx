import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HousekeepingBoardResponse } from '../../../types';

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>([
    'housekeeping:read',
    'housekeeping:create',
    'housekeeping:update',
    'rooms:update',
    'maintenance:read',
    'maintenance:write',
  ]),
  board: {
    data: undefined as HousekeepingBoardResponse | undefined,
    error: null as unknown,
    isLoading: false,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
    dataUpdatedAt: 0,
  },
  tasks: {
    data: undefined as { items: unknown[]; total: number } | undefined,
    error: null as unknown,
    isLoading: false,
    refetch: vi.fn(),
  },
  updateTaskMutate: vi.fn(),
  updateTaskMutateAsync: vi.fn().mockResolvedValue({}),
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '5' },
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));

vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('../hooks/useHousekeepingQueries', () => ({
  useHousekeepingBoard: () => ({ ...mocks.board }),
  useHousekeepingTasks: () => ({ ...mocks.tasks }),
  useAssignableStaff: () => ({ data: [], isLoading: false }),
  useCreateHousekeepingTask: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateHousekeepingTask: () => ({
    mutate: mocks.updateTaskMutate,
    mutateAsync: mocks.updateTaskMutateAsync,
    isPending: false,
    error: null,
    variables: undefined,
  }),
  useSyncRoomStatuses: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../hooks/useMaintenanceQueries', () => ({
  useMaintenanceTickets: () => ({ data: { items: [], total: 0 }, isLoading: false, error: null, refetch: vi.fn() }),
  useMaintenanceTicket: () => ({ data: undefined }),
  useCreateMaintenanceTicket: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMaintenanceTicket: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
}));

vi.mock('../../rooms/hooks/useRoomQueries', () => ({
  useRooms: () => ({ data: [], isLoading: false }),
  useRoomDetailedStatus: () => ({ data: undefined, isLoading: false, error: null }),
  useRoomHistory: () => ({ data: [], isLoading: false }),
  useUpdateRoomStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('./MaintenanceTab', () => ({
  default: () => <div data-testid="maintenance-tab" />,
}));

import HousekeepingPage from './HousekeepingPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const room = (
  overrides: Partial<HousekeepingBoardResponse['rooms'][number]> & {
    id: number;
    room_number: string;
  },
) => ({
  room_type: 'STDQ',
  status: 'dirty',
  floor: 2,
  ...overrides,
});

const openTask = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 900,
    room_id: 1,
    task_type: 'cleaning',
    status: 'pending',
    priority: 'normal',
    task_date: '2026-09-13',
    created_at: '',
    updated_at: '',
    ...overrides,
  }) as never;

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
  mocks.tasks.data = { items: [], total: 0 };
  mocks.updateTaskMutate.mockReset();
  mocks.updateTaskMutateAsync.mockReset().mockResolvedValue({});
  mocks.confirm.mockReset().mockResolvedValue(true);
});

afterEach(cleanup);

describe('HousekeepingPage board', () => {
  it('reports no critical axe violations', async () => {
    const { container } = renderBoard([
      room({ id: 1, room_number: '101' }),
      room({ id: 2, room_number: '102', status: 'available' }),
    ]);
    await expectNoCriticalAxeViolations(container);
  });

  it('groups rooms under their status headings and shows open tasks', () => {
    renderBoard([
      room({ id: 1, room_number: '201', open_task: openTask() }),
      room({ id: 2, room_number: '301', status: 'cleaning' }),
    ]);

    expect(screen.getByText('Room 201')).toBeTruthy();
    expect(screen.getByText('Room 301')).toBeTruthy();
    expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cleaning').length).toBeGreaterThan(0);
  });

  it('filters rooms by floor', () => {
    renderBoard([
      room({ id: 1, room_number: '201', floor: 2 }),
      room({ id: 2, room_number: '101', floor: 1 }),
      room({ id: 3, room_number: '102', floor: 1 }),
    ]);

    const floorSelect = screen.getByLabelText('Floor');
    fireEvent.mouseDown(floorSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Floor 1' }));

    expect(screen.queryByText('Room 201')).toBeNull();
    expect(screen.getByText('Room 101')).toBeTruthy();
    expect(screen.getByText('Room 102')).toBeTruthy();
  });

  it('filters rooms by room-number search', () => {
    renderBoard([
      room({ id: 1, room_number: '412' }),
      room({ id: 2, room_number: '204' }),
    ]);

    fireEvent.change(screen.getByLabelText('Search rooms'), { target: { value: '412' } });

    expect(screen.getByText('Room 412')).toBeTruthy();
    expect(screen.queryByText('Room 204')).toBeNull();
  });

  it('narrows the board with the Needs attention toggle', () => {
    renderBoard([
      room({ id: 1, room_number: '101', status: 'dirty' }),
      room({ id: 2, room_number: '102', status: 'occupied' }),
      room({ id: 3, room_number: '103', status: 'available' }),
    ]);

    fireEvent.click(screen.getByText('Needs attention', { selector: 'span' }));

    expect(screen.getByText('Room 101')).toBeTruthy();
    expect(screen.queryByText('Room 102')).toBeNull();
    expect(screen.queryByText('Room 103')).toBeNull();
  });

  it('starts a pending task with the right transition', () => {
    renderBoard([room({ id: 1, room_number: '201', open_task: openTask() })]);

    fireEvent.click(screen.getByText('Start'));
    expect(mocks.updateTaskMutateAsync).toHaveBeenCalledWith({
      taskId: 900,
      input: { status: 'in_progress' },
    });
  });

  it('completes an in-progress task after confirmation', async () => {
    renderBoard([
      room({ id: 1, room_number: '201', open_task: openTask({ id: 901, status: 'in_progress' }) }),
    ]);

    fireEvent.click(screen.getByText('Complete'));
    await vi.waitFor(() =>
      expect(mocks.updateTaskMutateAsync).toHaveBeenCalledWith({
        taskId: 901,
        input: { status: 'completed' },
      }),
    );
    expect(mocks.confirm).toHaveBeenCalled();
  });

  it('hides maintenance tab without maintenance:read and hides write controls for read-only staff', () => {
    mocks.permissions = new Set(['housekeeping:read']);

    renderBoard([room({ id: 1, room_number: '201', open_task: openTask({ id: 902 }) })]);

    expect(screen.queryByText('Start')).toBeNull();
    expect(screen.queryByText('Complete')).toBeNull();
    expect(screen.queryByRole('tab', { name: /Maintenance/i })).toBeNull();
  });

  it('shows the Tasks and Maintenance tabs when permitted', () => {
    renderBoard([room({ id: 1, room_number: '201' })]);

    expect(screen.getByRole('tab', { name: 'Board' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Tasks' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Maintenance' })).toBeTruthy();
  });

  it('shows operational summary tiles', () => {
    renderBoard([
      room({ id: 1, room_number: '101', status: 'dirty' }),
      room({ id: 2, room_number: '102', status: 'available' }),
      room({ id: 3, room_number: '103', status: 'out_of_order' }),
    ]);

    expect(screen.getAllByText('Needs cleaning').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blocked rooms').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
  });
});
