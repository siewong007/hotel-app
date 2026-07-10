import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HousekeepingService } from '../../../api/housekeeping.service';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import type {
  CreateHousekeepingTaskRequest,
  ListHousekeepingTasksQuery,
  UpdateHousekeepingTaskRequest,
} from '../../../types/housekeeping.types';

export function useHousekeepingBoard(enabled = true) {
  return useQuery({
    queryKey: queryKeys.housekeeping.board(),
    queryFn: () => HousekeepingService.getBoard(),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useHousekeepingTasks(params: ListHousekeepingTasksQuery = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.housekeeping.tasks(params as unknown as Record<string, unknown>),
    queryFn: () => HousekeepingService.listTasks(params),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useCreateHousekeepingTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateHousekeepingTaskRequest) => HousekeepingService.createTask(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.housekeeping.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    },
  });
}

export function useUpdateHousekeepingTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string | number; input: UpdateHousekeepingTaskRequest }) =>
      HousekeepingService.updateTask(taskId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.housekeeping.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    },
  });
}
