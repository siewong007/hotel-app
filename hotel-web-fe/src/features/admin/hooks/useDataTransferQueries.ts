import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DataTransferService } from '../../../api';
import { queryKeys } from '../../../api/queryKeys';
import type { BookingDataExport, ImportMode } from '../../../types';

const invalidateImportedData = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.guests.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.roomTypes.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.nightAudit.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
};

export function useExportDataMutation() {
  return useMutation({
    mutationKey: queryKeys.dataTransfer.export(),
    mutationFn: () => DataTransferService.exportData(),
  });
}

export function useImportDataMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, data }: { mode: ImportMode; data: BookingDataExport }) =>
      DataTransferService.importData(mode, data),
    onSuccess: () => invalidateImportedData(queryClient),
  });
}
