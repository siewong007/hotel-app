import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { AuditService } from '../../../api';
import { queryKeys } from '../../../api/queryKeys';
import type { AuditLogQuery } from '../../../types/audit.types';

export function useAuditLogs(params: AuditLogQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.logs(params),
    queryFn: () => AuditService.getAuditLogs(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useAuditCategoryCounts(params: AuditLogQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.counts(params),
    queryFn: () => AuditService.getCategoryCounts(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useAuditActions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.actions(),
    queryFn: () => AuditService.getAuditActions(),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useAuditResourceTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.resourceTypes(),
    queryFn: () => AuditService.getAuditResourceTypes(),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useAuditUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.users(),
    queryFn: () => AuditService.getAuditUsers(),
    enabled,
    staleTime: 10 * 60_000,
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
