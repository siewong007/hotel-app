import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { AuthService } from '../../../api';
import type { ApiRequestOptions } from '../../../api/auth.service';

export function useTwoFactorStatus(options?: ApiRequestOptions) {
  return useQuery({
    queryKey: queryKeys.twoFactor.status(),
    queryFn: () => AuthService.getTwoFactorStatus(options),
    staleTime: queryStaleTime.standard,
  });
}

export function useSetupTwoFactor(options?: ApiRequestOptions) {
  return useMutation({
    mutationFn: () => AuthService.setupTwoFactor(options),
  });
}

export function useEnableTwoFactor(options?: ApiRequestOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, challengeCode }: { code: string; challengeCode: string }) =>
      AuthService.enableTwoFactor(code, challengeCode, options),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}

export function useDisableTwoFactor(options?: ApiRequestOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => AuthService.disableTwoFactor(code, options),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}

export function useRegenerateBackupCodes(options?: ApiRequestOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => AuthService.regenerateBackupCodes(code, options),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.twoFactor.all });
    },
  });
}
