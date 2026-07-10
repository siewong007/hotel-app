import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MaintenanceService } from '../../../api/maintenance.service';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import type {
  CreateMaintenanceTicketRequest,
  ListMaintenanceTicketsQuery,
  UpdateMaintenanceTicketRequest,
} from '../../../types/maintenance.types';

export function useMaintenanceTickets(params: ListMaintenanceTicketsQuery = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.maintenance.list(params as unknown as Record<string, unknown>),
    queryFn: () => MaintenanceService.listTickets(params),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useMaintenanceTicket(id: string | number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.maintenance.detail(id),
    queryFn: () => MaintenanceService.getTicket(id),
    enabled: enabled && id !== undefined && id !== null && id !== '',
    staleTime: queryStaleTime.short,
  });
}

export function useCreateMaintenanceTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateMaintenanceTicketRequest) => MaintenanceService.createTicket(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance.all });
    },
  });
}

export function useUpdateMaintenanceTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string | number; input: UpdateMaintenanceTicketRequest }) =>
      MaintenanceService.updateTicket(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance.all });
    },
  });
}
