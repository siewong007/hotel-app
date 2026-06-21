import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import {
  EkycActionPayload,
  EkycAdminCreatePayload,
  EkycListParams,
  EkycService,
} from '../../../api/ekyc.service';

export function useEkycStatus() {
  return useQuery({
    queryKey: queryKeys.ekyc.myStatus(),
    queryFn: () => EkycService.getEkycStatus(),
    staleTime: queryStaleTime.standard,
  });
}

export function useEkycVerificationDetails() {
  return useQuery({
    queryKey: queryKeys.ekyc.myVerification(),
    queryFn: () => EkycService.getEkycVerificationDetails(),
    staleTime: queryStaleTime.standard,
  });
}

export function useAllEkycVerifications(params?: EkycListParams) {
  return useQuery({
    queryKey: queryKeys.ekyc.allVerifications(params),
    queryFn: () => EkycService.getAllEkycVerifications(params),
    staleTime: queryStaleTime.short,
  });
}

export function useEkycApplication(applicationId?: number) {
  return useQuery({
    queryKey: applicationId ? queryKeys.ekyc.application(applicationId) : queryKeys.ekyc.application('none'),
    queryFn: () => EkycService.getEkycApplication(applicationId as number),
    enabled: Boolean(applicationId),
    staleTime: queryStaleTime.short,
  });
}

export function useEkycReasonCodes() {
  return useQuery({
    queryKey: queryKeys.ekyc.reasonCodes(),
    queryFn: () => EkycService.getReasonCodes(),
    staleTime: queryStaleTime.standard,
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

export function useCreateEkycApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: EkycAdminCreatePayload) => EkycService.createEkycApplication(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ekyc.all });
    },
  });
}

export function useReviewEkycAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ applicationId, payload }: { applicationId: number; payload: EkycActionPayload }) =>
      EkycService.performReviewAction(applicationId, payload),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.ekyc.all });
      qc.invalidateQueries({ queryKey: queryKeys.ekyc.application(variables.applicationId) });
    },
  });
}

export function useRevealEkycField() {
  return useMutation({
    mutationFn: ({ applicationId, field, reason }: { applicationId: number; field: string; reason: string }) =>
      EkycService.revealSensitiveField(applicationId, field, reason),
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
