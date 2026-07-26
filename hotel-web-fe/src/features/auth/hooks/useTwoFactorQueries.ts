import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { AuthService } from '../../../api';

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: queryKeys.twoFactor.status(),
    queryFn: () => AuthService.getTwoFactorStatus(),
    staleTime: queryStaleTime.standard,
  });
}

export function useSetupTwoFactor() {
  return useMutation({
    mutationFn: () => AuthService.setupTwoFactor(),
  });
}

export function useEnableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, challengeCode }: { code: string; challengeCode: string }) =>
      AuthService.enableTwoFactor(code, challengeCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}

export function useDisableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => AuthService.disableTwoFactor(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}

export function useRegenerateBackupCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => AuthService.regenerateBackupCodes(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}
