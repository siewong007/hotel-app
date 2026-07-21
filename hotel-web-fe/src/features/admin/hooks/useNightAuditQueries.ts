import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NightAuditService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidateNightAuditDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import type { RunNightAuditRequest } from '../../../types';

export function useNightAuditPreview(date: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nightAudit.preview(date),
    queryFn: () => NightAuditService.getPreview(date),
    enabled: enabled && !!date,
    staleTime: queryStaleTime.realtime,
  });
}

export interface NightAuditListFilters {
  page: number;
  pageSize: number;
  year?: number;
  month?: number;
}

export function useNightAuditRuns(
  filters: NightAuditListFilters = { page: 1, pageSize: 30 },
  enabled = true
) {
  const { page, pageSize, year, month } = filters;

  return useQuery({
    queryKey: queryKeys.nightAudit.runs(page, pageSize, year, month),
    queryFn: () => NightAuditService.listNightAudits({ page, pageSize, year, month }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: queryStaleTime.short,
  });
}

export function useNightAuditRun(id?: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nightAudit.detail(id ?? ''),
    queryFn: () => NightAuditService.getNightAudit(id as number),
    enabled: enabled && id != null,
    staleTime: queryStaleTime.standard,
  });
}

export function useNightAuditDetails(id?: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nightAudit.details(id ?? ''),
    queryFn: () => NightAuditService.getAuditDetails(id as number),
    enabled: enabled && id != null,
    staleTime: queryStaleTime.standard,
  });
}

export function useBookingPostedStatus(bookingId?: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nightAudit.bookingPosted(bookingId ?? ''),
    queryFn: () => NightAuditService.isBookingPosted(bookingId as number),
    enabled: enabled && bookingId != null,
    staleTime: queryStaleTime.standard,
  });
}

export function useRunNightAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RunNightAuditRequest) => NightAuditService.runNightAudit(request),
    onSuccess: () => invalidateNightAuditDependencies(queryClient),
  });
}

export function useNightAuditDetailsFetcher() {
  const queryClient = useQueryClient();
  return (id: number) =>
    queryClient.ensureQueryData({
      queryKey: queryKeys.nightAudit.details(id),
      queryFn: () => NightAuditService.getAuditDetails(id),
      staleTime: queryStaleTime.standard,
    });
}
