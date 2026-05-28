import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { HotelAPIService } from '../../../api';

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: queryKeys.twoFactor.status(),
    queryFn: () => HotelAPIService.getTwoFactorStatus(),
  });
}

export function useSetupTwoFactor() {
  return useMutation({
    mutationFn: () => HotelAPIService.setupTwoFactor(),
  });
}

export function useEnableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => HotelAPIService.enableTwoFactor(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}

export function useDisableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => HotelAPIService.disableTwoFactor(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}

export function useRegenerateBackupCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => HotelAPIService.regenerateBackupCodes(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}
