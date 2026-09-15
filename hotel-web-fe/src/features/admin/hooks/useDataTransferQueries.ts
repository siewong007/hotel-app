import { useMutation, useQuery } from '@tanstack/react-query';
import { DataTransferService } from '../../../api';
import { queryKeys } from '../../../api/queryKeys';
import type { BackupImportMode, ConflictPolicy, ExportScope, StepUpRequest } from '../../../types';

export function useExportPreviewMutation() {
  return useMutation({
    mutationKey: queryKeys.dataTransfer.exportPreview(),
    mutationFn: (scope: ExportScope) => DataTransferService.previewExport(scope),
  });
}

export function useExportDataMutation() {
  return useMutation({
    mutationKey: queryKeys.dataTransfer.export(),
    mutationFn: ({ scope, stepUpToken }: { scope: ExportScope; stepUpToken?: string }) =>
      DataTransferService.exportData(scope, stepUpToken),
  });
}

/** Step-up re-authentication — mints the short-lived `X-Step-Up` token that
 * full/backup exports and restore imports require. */
export function useStepUpMutation() {
  return useMutation({
    mutationFn: (input: StepUpRequest) => DataTransferService.stepUp(input),
  });
}

/** Server-backed transfer history — the audit-log projection of exports,
 * imports, and step-up events. Replaces the old device-local list. */
export function useTransferHistoryQuery(limit = 100) {
  return useQuery({
    queryKey: [...queryKeys.dataTransfer.history(), limit] as const,
    queryFn: () => DataTransferService.transferHistory(limit),
  });
}

export function useUploadBackupMutation() {
  return useMutation({
    mutationFn: (file: File) => DataTransferService.uploadBackup(file),
  });
}

export function useImportPreviewMutation() {
  return useMutation({
    mutationFn: (uploadId: string) => DataTransferService.previewImport(uploadId),
  });
}

export function useExecuteImportMutation() {
  return useMutation({
    mutationFn: (input: {
      uploadId: string;
      mode: BackupImportMode;
      onConflict?: ConflictPolicy;
      tables?: string[];
      stepUpToken?: string;
    }) => {
      const { stepUpToken, ...body } = input;
      return DataTransferService.executeImport(body, stepUpToken);
    },
  });
}

/**
 * Poll an import job until it leaves `running`. `refetchInterval` reads the
 * cached status, so polling stops itself the moment a terminal state
 * (`succeeded`/`failed`) lands — no effect cleanup needed in the wizard.
 */
export function useImportJob(jobId: string | null, refetchIntervalMs = 1500) {
  return useQuery({
    queryKey: queryKeys.dataTransfer.importJob(jobId ?? 'none'),
    queryFn: () => DataTransferService.getImportJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      query.state.data == null || query.state.data.status === 'running'
        ? refetchIntervalMs
        : false,
  });
}

export function useDeleteUploadMutation() {
  return useMutation({
    mutationFn: (uploadId: string) => DataTransferService.deleteUpload(uploadId),
  });
}
