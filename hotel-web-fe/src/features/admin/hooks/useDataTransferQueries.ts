import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DataTransferService } from '../../../api';
import { invalidateImportedData } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import type { BookingDataExport, ImportMode } from '../../../types';

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

export function useImportDataMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, data, tables }: { mode: ImportMode; data: BookingDataExport; tables: string[] }) =>
      DataTransferService.importData(mode, data, tables),
    onSuccess: () => invalidateImportedData(queryClient),
  });
}
