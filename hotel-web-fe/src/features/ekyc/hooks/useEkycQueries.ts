import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { EkycService } from '../../../api/ekyc.service';

export function useEkycStatus() {
  return useQuery({
    queryKey: queryKeys.ekyc.myStatus(),
    queryFn: () => EkycService.getEkycStatus(),
  });
}

export function useEkycVerificationDetails() {
  return useQuery({
    queryKey: queryKeys.ekyc.myVerification(),
    queryFn: () => EkycService.getEkycVerificationDetails(),
  });
}

export function useAllEkycVerifications() {
  return useQuery({
    queryKey: queryKeys.ekyc.allVerifications(),
    queryFn: () => EkycService.getAllEkycVerifications(),
  });
}

export function useSubmitEkycVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => EkycService.submitEkycVerification(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ekyc.all });
    },
  });
}

export function useApproveEkyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (verificationId: number) => EkycService.approveEkycVerification(verificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ekyc.all });
    },
  });
}

export function useRejectEkyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ verificationId, reason }: { verificationId: number; reason: string }) =>
      EkycService.rejectEkycVerification(verificationId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ekyc.all });
    },
  });
}

export function useUpdateEkycVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ verificationId, updates }: { verificationId: number; updates: any }) =>
      EkycService.updateEkycVerification(verificationId, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ekyc.all });
    },
  });
}
