import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GuestRelationsService } from '../../../api/guestRelations.service';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidateGuestDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import { supportQueryKeys } from '../../support/hooks/useSupportQueries';
import type {
  CreateStaffSupportConversationRequest,
  GuestInteractionInput,
  GuestInteractionListParams,
  GuestInteractionUpdate,
  GuestPreferencesPutRequest,
  GuestReviewResponseInput,
} from '../../../types';

const isUsableGuestId = (guestId?: number | string | null) => guestId != null && guestId !== '';

// ---------------------------------------------------------------------
// Interactions (guest_notes)
// ---------------------------------------------------------------------

export function useGuestInteractions(
  guestId?: number | string | null,
  params?: GuestInteractionListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.guests.interactions(
      guestId ?? '',
      params as Record<string, unknown> | undefined,
    ),
    queryFn: () => GuestRelationsService.getInteractions(guestId as number | string, params),
    enabled: enabled && isUsableGuestId(guestId),
    placeholderData: keepPreviousData,
    staleTime: queryStaleTime.short,
  });
}

export function useCreateInteraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guestId, data }: { guestId: number; data: GuestInteractionInput }) =>
      GuestRelationsService.createInteraction(guestId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.interactions(variables.guestId) });
      invalidateGuestDependencies(queryClient);
    },
  });
}

export function useUpdateInteraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      guestId,
      interactionId,
      data,
    }: {
      guestId: number;
      interactionId: number;
      data: GuestInteractionUpdate;
    }) => GuestRelationsService.updateInteraction(guestId, interactionId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.interactions(variables.guestId) });
      invalidateGuestDependencies(queryClient);
    },
  });
}

export function useDeleteInteraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guestId, interactionId }: { guestId: number; interactionId: number }) =>
      GuestRelationsService.deleteInteraction(guestId, interactionId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.interactions(variables.guestId) });
      invalidateGuestDependencies(queryClient);
    },
  });
}

// ---------------------------------------------------------------------
// Preferences (guest_preferences)
// ---------------------------------------------------------------------

export function useGuestPreferences(guestId?: number | string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.preferences(guestId ?? ''),
    queryFn: () => GuestRelationsService.getPreferences(guestId as number | string),
    enabled: enabled && isUsableGuestId(guestId),
    staleTime: queryStaleTime.short,
  });
}

export function usePutGuestPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guestId, data }: { guestId: number; data: GuestPreferencesPutRequest }) =>
      GuestRelationsService.putPreferences(guestId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.preferences(variables.guestId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.detail(variables.guestId) });
      invalidateGuestDependencies(queryClient);
    },
  });
}

// ---------------------------------------------------------------------
// Reviews (guest_reviews)
// ---------------------------------------------------------------------

export function useGuestReviews(guestId?: number | string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.reviews(guestId ?? ''),
    queryFn: () => GuestRelationsService.getReviews(guestId as number | string),
    enabled: enabled && isUsableGuestId(guestId),
    staleTime: queryStaleTime.short,
  });
}

export function useRespondToReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      guestId,
      reviewId,
      data,
    }: {
      guestId: number;
      reviewId: number;
      data: GuestReviewResponseInput;
    }) => GuestRelationsService.respondToReview(guestId, reviewId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.reviews(variables.guestId) });
      invalidateGuestDependencies(queryClient);
    },
  });
}

// ---------------------------------------------------------------------
// Loyalty / vouchers / communications / support
// ---------------------------------------------------------------------

/** Resolves to `null` when the guest has no loyalty membership. */
export function useGuestLoyalty(guestId?: number | string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.loyalty(guestId ?? ''),
    queryFn: () => GuestRelationsService.getLoyalty(guestId as number | string),
    enabled: enabled && isUsableGuestId(guestId),
    staleTime: queryStaleTime.standard,
  });
}

export function useGuestVouchers(guestId?: number | string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.vouchers(guestId ?? ''),
    queryFn: () => GuestRelationsService.getVouchers(guestId as number | string),
    enabled: enabled && isUsableGuestId(guestId),
    staleTime: queryStaleTime.short,
  });
}

export function useGuestCommunications(guestId?: number | string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.communications(guestId ?? ''),
    queryFn: () => GuestRelationsService.getCommunications(guestId as number | string),
    enabled: enabled && isUsableGuestId(guestId),
    staleTime: queryStaleTime.short,
  });
}

export function useGuestSupportConversations(guestId?: number | string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.support(guestId ?? ''),
    queryFn: () => GuestRelationsService.getSupportConversations(guestId as number | string),
    enabled: enabled && isUsableGuestId(guestId),
    staleTime: queryStaleTime.short,
  });
}

/** Staff-side `POST /support/conversations` — refreshes both the per-guest list and the staff queue. */
export function useCreateSupportConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStaffSupportConversationRequest) =>
      GuestRelationsService.createSupportConversation(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.support(variables.guest_id) });
      queryClient.invalidateQueries({ queryKey: supportQueryKeys.all });
      invalidateGuestDependencies(queryClient);
    },
  });
}
