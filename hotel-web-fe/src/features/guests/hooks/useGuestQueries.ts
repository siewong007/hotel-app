import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GuestsService } from '../../../api';
import { queryKeys } from '../../../api/queryKeys';
import type { GuestCreateRequest, GuestUpdateRequest, GuestType } from '../../../types';

type GuestListParams = {
  search?: string;
  guest_type?: GuestType;
};

type GuestPageParams = {
  page?: number;
  page_size?: number;
  search?: string;
  guest_type?: GuestType;
};

const invalidateGuestDependencies = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.guests.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
};

export function useGuests(params?: GuestListParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.list(params as Record<string, unknown> | undefined),
    queryFn: () => GuestsService.getAllGuests(params),
    enabled,
    staleTime: 60_000,
  });
}

export function useGuestsPage(params?: GuestPageParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.page(params as Record<string, unknown> | undefined),
    queryFn: () => GuestsService.getGuestsPage(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useGuest(id?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.detail(id ?? ''),
    queryFn: () => GuestsService.getGuest(id as string | number),
    enabled: enabled && id != null && id !== '',
    staleTime: 60_000,
  });
}

export function useGuestBookings(guestId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.bookings(guestId ?? ''),
    queryFn: () => GuestsService.getGuestBookings(guestId as number),
    enabled: enabled && guestId != null && guestId !== '',
    staleTime: 30_000,
  });
}

export function useGuestCredits(guestId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.credits(guestId ?? ''),
    queryFn: () => GuestsService.getGuestCredits(guestId as number),
    enabled: enabled && guestId != null && guestId !== '',
    staleTime: 30_000,
  });
}

export function useMyGuests(enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.mine(),
    queryFn: () => GuestsService.getMyGuests(),
    enabled,
    staleTime: 60_000,
  });
}

export function useMyGuestsWithCredits(enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.mineWithCredits(),
    queryFn: () => GuestsService.getMyGuestsWithCredits(),
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateGuest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: GuestCreateRequest) => GuestsService.createGuest(data),
    onSuccess: () => invalidateGuestDependencies(queryClient),
  });
}

export function useUpdateGuest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guestId, data }: { guestId: number; data: GuestUpdateRequest | Partial<GuestCreateRequest> }) =>
      GuestsService.updateGuest(guestId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.detail(variables.guestId) });
      invalidateGuestDependencies(queryClient);
    },
  });
}

export function useDeleteGuest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (guestId: number) => GuestsService.deleteGuest(guestId),
    onSuccess: (_, guestId) => {
      queryClient.removeQueries({ queryKey: queryKeys.guests.detail(guestId) });
      invalidateGuestDependencies(queryClient);
    },
  });
}
