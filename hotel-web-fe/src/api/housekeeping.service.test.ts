import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      patch: (...args: any[]) => patch(...args),
    },
  };
});

import { HousekeepingService } from './housekeeping.service';
import type {
  CreateHousekeepingTaskRequest,
  HousekeepingBoardResponse,
  HousekeepingTask,
  HousekeepingTaskListResponse,
  UpdateHousekeepingTaskRequest,
} from '../types/housekeeping.types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Read the searchParams object passed to the most recent api.get call. */
function lastGetSearchParams(): Record<string, any> {
  const call = get.mock.calls[get.mock.calls.length - 1];
  return call?.[1]?.searchParams ?? {};
}

function buildTask(overrides: Partial<HousekeepingTask> = {}): HousekeepingTask {
  return {
    id: 1,
    room_id: 5,
    room_number: '101',
    room_type: 'Deluxe',
    task_type: 'cleaning',
    priority: 'normal',
    status: 'pending',
    task_date: '2026-07-26',
    created_at: '2026-07-26T00:00:00Z',
    updated_at: '2026-07-26T00:00:00Z',
    ...overrides,
  };
}

describe('HousekeepingService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  describe('getBoard', () => {
    it('calls GET housekeeping/board and returns the board', async () => {
      const board: HousekeepingBoardResponse = { rooms: [] };
      get.mockReturnValue(mockJsonResponse(board));

      const result = await HousekeepingService.getBoard();

      expect(get).toHaveBeenCalledWith('housekeeping/board');
      expect(result).toEqual(board);
    });
  });

  describe('listTasks', () => {
    it('calls GET housekeeping/tasks with no searchParams when no query is given', async () => {
      const response: HousekeepingTaskListResponse = { items: [], total: 0, page: 1, page_size: 50 };
      get.mockReturnValue(mockJsonResponse(response));

      const result = await HousekeepingService.listTasks();

      expect(get).toHaveBeenCalledWith('housekeeping/tasks', { searchParams: {} });
      expect(result).toEqual(response);
    });

    it('forwards status, room_id, assigned_to, scheduled_date, page and page_size as searchParams', async () => {
      get.mockReturnValue(mockJsonResponse({ items: [], total: 0, page: 2, page_size: 25 }));

      await HousekeepingService.listTasks({
        status: 'pending',
        room_id: 5,
        assigned_to: 3,
        scheduled_date: '2026-07-26',
        page: 2,
        page_size: 25,
      });

      expect(lastGetSearchParams()).toEqual({
        status: 'pending',
        room_id: 5,
        assigned_to: 3,
        scheduled_date: '2026-07-26',
        page: 2,
        page_size: 25,
      });
    });
  });

  describe('createTask', () => {
    it('posts the input as json to housekeeping/tasks', async () => {
      const input: CreateHousekeepingTaskRequest = { room_id: 5, task_type: 'cleaning' };
      const created = buildTask();
      post.mockReturnValue(mockJsonResponse(created));

      const result = await HousekeepingService.createTask(input);

      expect(post).toHaveBeenCalledWith('housekeeping/tasks', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('updateTask', () => {
    it('patches housekeeping/tasks/<id> with the input as json', async () => {
      const input: UpdateHousekeepingTaskRequest = { status: 'completed' };
      const updated = buildTask({ id: 3, status: 'completed' });
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await HousekeepingService.updateTask(3, input);

      expect(patch).toHaveBeenCalledWith('housekeeping/tasks/3', { json: input });
      expect(result).toEqual(updated);
    });

    it('accepts a string taskId and interpolates it directly into the path', async () => {
      patch.mockReturnValue(mockJsonResponse(buildTask({ id: 3 })));

      await HousekeepingService.updateTask('abc', { notes: 'done' });

      expect(patch).toHaveBeenCalledWith('housekeeping/tasks/abc', { json: { notes: 'done' } });
    });
  });
});
