import { useQuery } from '@tanstack/react-query';
import { InsightsApi } from './api';
import type { ReportQueryParams } from './types';
import { queryGcTime, queryStaleTime } from '../../api/queryConfig';

export function useInsightsOverview(enabled = true) {
  return useQuery({
    queryKey: ['insights', 'overview'],
    queryFn: InsightsApi.getOverview,
    enabled,
    staleTime: queryStaleTime.short,
    gcTime: queryGcTime.standard,
  });
}

export function useReportCatalog(enabled = true) {
  return useQuery({
    queryKey: ['insights', 'reports'],
    queryFn: InsightsApi.listReports,
    enabled,
    staleTime: queryStaleTime.long,
    gcTime: queryGcTime.long,
  });
}

export function useReportEnvelope(
  reportId: string | null,
  params: ReportQueryParams | null,
) {
  return useQuery({
    queryKey: ['insights', 'report', reportId, params],
    queryFn: () => InsightsApi.runReport(reportId!, params!),
    enabled: reportId != null && params != null,
    staleTime: queryStaleTime.short,
    gcTime: queryGcTime.long,
  });
}
