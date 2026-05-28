import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { AuditService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import type { AuditLogQuery } from '../../../types/audit.types';

export function useAuditLogs(params: AuditLogQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.logs(params),
    queryFn: () => AuditService.getAuditLogs(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: queryStaleTime.realtime,
  });
}

export function useAuditCategoryCounts(params: AuditLogQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.counts(params),
    queryFn: () => AuditService.getCategoryCounts(params),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useAuditActions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.actions(),
    queryFn: () => AuditService.getAuditActions(),
    enabled,
    staleTime: queryStaleTime.static,
  });
}

export function useAuditResourceTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.resourceTypes(),
    queryFn: () => AuditService.getAuditResourceTypes(),
    enabled,
    staleTime: queryStaleTime.static,
  });
}

export function useAuditUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.users(),
    queryFn: () => AuditService.getAuditUsers(),
    enabled,
    staleTime: queryStaleTime.static,
  });
}

export function useExportAuditCsv() {
  return useMutation({
    mutationFn: (params: AuditLogQuery) => AuditService.downloadCSV(params),
  });
}

export function useExportAuditPdf() {
  return useMutation({
    mutationFn: (params: AuditLogQuery) => AuditService.downloadPDF(params),
  });
}
