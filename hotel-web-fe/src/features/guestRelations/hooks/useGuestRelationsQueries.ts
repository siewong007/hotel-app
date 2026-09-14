import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { GuestRelationsService } from '../../../api/guestRelations.service';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidateGuestDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import { supportQueryKeys } from '../../support/hooks/useSupportQueries';
import { CommunicationsApi } from '../../communications/api';
import type { PreferenceUpdateInput } from '../../communications/types';
import type {
  CreateStaffSupportConversationRequest,
  FollowUpDue,
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

/**
 * Load-more variant of `useGuestInteractions` for the Interactions timeline:
 * `useInfiniteQuery` accumulates pages and — unlike manual page-by-page
 * accumulation — refetches every loaded page when a mutation invalidates the
 * shared `queryKeys.guests.interactions(guestId, …)` prefix.
 */
export function useGuestInteractionsFeed(
  guestId?: number | string | null,
  options?: { pageSize?: number; includeCompletedFollowups?: boolean },
  enabled = true,
) {
  const pageSize = options?.pageSize ?? 20;
  const includeCompletedFollowups = options?.includeCompletedFollowups ?? false;
  return useInfiniteQuery({
    queryKey: queryKeys.guests.interactions(guestId ?? '', {
      feed: true,
      page_size: pageSize,
      include_completed_followups: includeCompletedFollowups,
    }),
    queryFn: ({ pageParam }) =>
      GuestRelationsService.getInteractions(guestId as number | string, {
        page: pageParam,
        page_size: pageSize,
        include_completed_followups: includeCompletedFollowups,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.page_size < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: enabled && isUsableGuestId(guestId),
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

/**
 * Staff-recorded consent — `POST /admin/communications/guests/{id}/consent`
 * (`communications:manage`). The endpoint lives on the communications
 * feature's API module, so this wraps it rather than duplicating a method on
 * `GuestRelationsService`. Only the per-guest communications summary reads the
 * subscription rows, so that key alone is invalidated (the mutation doesn't
 * touch `guests.marketing_opt_in` or other guest fields).
 */
export function useRecordGuestConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guestId, data }: { guestId: number; data: PreferenceUpdateInput }) =>
      CommunicationsApi.recordStaffConsent(guestId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.guests.communications(variables.guestId),
      });
    },
  });
}

// ---------------------------------------------------------------------
// Phase 2 — cross-guest operational layer (overview + follow-up queue)
// ---------------------------------------------------------------------

/**
 * `GET /guest-relations/overview` — dashboard aggregate. The `support` /
 * `reviews` sections are absent unless the caller holds those read
 * permissions, so consumers must tolerate `overview.support == null`.
 */
export function useGuestRelationsOverview(enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.overview,
    queryFn: () => GuestRelationsService.getOverview(),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

/** Paginated open follow-up queue (`GET /guest-relations/follow-ups`). */
export function useGuestFollowUps(due: FollowUpDue = 'all', page = 1, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.followUps(due, page),
    queryFn: () => GuestRelationsService.listFollowUps({ due, page }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: queryStaleTime.short,
  });
}

/**
 * Complete a queue follow-up — wraps `useUpdateInteraction` with
 * `{ follow_up_completed: true }` (PATCHes `guests/{id}/interactions/{nid}`
 * and reuses its per-guest invalidations), then refreshes the queue and the
 * overview's `follow_ups` section.
 */
export function useCompleteFollowUp() {
  const queryClient = useQueryClient();
  const updateInteraction = useUpdateInteraction();
  return useMutation({
    mutationFn: ({ guestId, noteId }: { guestId: number; noteId: number }) =>
      updateInteraction.mutateAsync({
        guestId,
        interactionId: noteId,
        data: { follow_up_completed: true },
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.followUps() });
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.overview });
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.interactions(variables.guestId) });
    },
  });
}
