import { api } from './client';
import type {
  CreateHousekeepingTaskRequest,
  HousekeepingBoardResponse,
  HousekeepingTask,
  HousekeepingTaskListResponse,
  ListHousekeepingTasksQuery,
  UpdateHousekeepingTaskRequest,
} from '../types/housekeeping.types';

export class HousekeepingService {
  static async getBoard(): Promise<HousekeepingBoardResponse> {
    return api.get('housekeeping/board').json<HousekeepingBoardResponse>();
  }

  static async listTasks(params: ListHousekeepingTasksQuery = {}): Promise<HousekeepingTaskListResponse> {
    return api.get('housekeeping/tasks', { searchParams: params as Record<string, string | number> })
      .json<HousekeepingTaskListResponse>();
  }

  static async createTask(input: CreateHousekeepingTaskRequest): Promise<HousekeepingTask> {
    return api.post('housekeeping/tasks', { json: input }).json<HousekeepingTask>();
  }

  static async updateTask(
    taskId: string | number,
    input: UpdateHousekeepingTaskRequest,
  ): Promise<HousekeepingTask> {
    return api.patch(`housekeeping/tasks/${taskId}`, { json: input }).json<HousekeepingTask>();
  }
}
