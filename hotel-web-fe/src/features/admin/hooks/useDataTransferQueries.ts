import { useMutation, useQuery } from '@tanstack/react-query';
import { DataTransferService } from '../../../api';
import { queryKeys } from '../../../api/queryKeys';
import type { BackupImportMode, ConflictPolicy } from '../../../types';

export function useExportPreviewMutation() {
  return useMutation({
    mutationKey: queryKeys.dataTransfer.exportPreview(),
    mutationFn: () => DataTransferService.previewExport(),
  });
}

export function useExportDataMutation() {
  return useMutation({
    mutationKey: queryKeys.dataTransfer.export(),
    mutationFn: () => DataTransferService.exportData(),
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
    }) => DataTransferService.executeImport(input),
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
