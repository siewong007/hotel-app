import { api } from './client';
import { grpcEnabled } from './grpc/flags';
import * as grpcHousekeeping from './grpc/housekeeping';
import type {
  AssignableStaffMember,
  AssignableStaffScope,
  CreateHousekeepingTaskRequest,
  HousekeepingBoardResponse,
  HousekeepingTask,
  HousekeepingTaskListResponse,
  ListHousekeepingTasksQuery,
  UpdateHousekeepingTaskRequest,
} from '../types/housekeeping.types';

export class HousekeepingService {
  static async getBoard(): Promise<HousekeepingBoardResponse> {
    if (grpcEnabled('housekeeping')) {
      return await grpcHousekeeping.getBoard();
    }
    return api.get('housekeeping/board').json<HousekeepingBoardResponse>();
  }

  static async listTasks(params: ListHousekeepingTasksQuery = {}): Promise<HousekeepingTaskListResponse> {
    if (grpcEnabled('housekeeping')) {
      return await grpcHousekeeping.listTasks(params);
    }
    return api.get('housekeeping/tasks', { searchParams: params as Record<string, string | number> })
      .json<HousekeepingTaskListResponse>();
  }

  static async createTask(input: CreateHousekeepingTaskRequest): Promise<HousekeepingTask> {
    if (grpcEnabled('housekeeping')) {
      return await grpcHousekeeping.createTask(input);
    }
    return api.post('housekeeping/tasks', { json: input }).json<HousekeepingTask>();
  }

  static async updateTask(
    taskId: string | number,
    input: UpdateHousekeepingTaskRequest,
  ): Promise<HousekeepingTask> {
    if (grpcEnabled('housekeeping')) {
      return await grpcHousekeeping.updateTask(taskId, input);
    }
    return api.patch(`housekeeping/tasks/${taskId}`, { json: input }).json<HousekeepingTask>();
  }

  static async getAssignableStaff(
    scope: AssignableStaffScope = 'housekeeping',
  ): Promise<AssignableStaffMember[]> {
    if (grpcEnabled('housekeeping')) {
      return await grpcHousekeeping.getAssignableStaff(scope);
    }
    return api
      .get('housekeeping/assignable-staff', { searchParams: { scope } })
      .json<AssignableStaffMember[]>();
  }
}
