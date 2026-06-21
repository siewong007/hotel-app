import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GuestsService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidateGuestDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import type { GuestCreateRequest, GuestUpdateRequest, GuestType, TourismType } from '../../../types';

type GuestListParams = {
  search?: string;
  guest_type?: GuestType;
};

type GuestPageParams = {
  page?: number;
  page_size?: number;
  search?: string;
  guest_type?: GuestType;
  tourism_type?: TourismType;
  missing_tourism?: boolean;
  missing_info?: boolean;
};

export function useGuests(params?: GuestListParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.list(params as Record<string, unknown> | undefined),
    queryFn: () => GuestsService.getAllGuests(params),
    enabled,
    staleTime: queryStaleTime.standard,
  });
}

export function useGuestsPage(params?: GuestPageParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.page(params as Record<string, unknown> | undefined),
    queryFn: () => GuestsService.getGuestsPage(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: queryStaleTime.short,
  });
}

export function useGuest(id?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.detail(id ?? ''),
    queryFn: () => GuestsService.getGuest(id as string | number),
    enabled: enabled && id != null && id !== '',
    staleTime: queryStaleTime.standard,
  });
}

export function useGuestProfile(id?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.profile(id ?? ''),
    queryFn: () => GuestsService.getGuestProfile(id as string | number),
    enabled: enabled && id != null && id !== '',
    staleTime: queryStaleTime.short,
  });
}

export function useGuestBookings(guestId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.bookings(guestId ?? ''),
    queryFn: () => GuestsService.getGuestBookings(guestId as number),
    enabled: enabled && guestId != null && guestId !== '',
    staleTime: queryStaleTime.short,
  });
}

export function useGuestCredits(guestId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.credits(guestId ?? ''),
    queryFn: () => GuestsService.getGuestCredits(guestId as number),
    enabled: enabled && guestId != null && guestId !== '',
    staleTime: queryStaleTime.short,
  });
}

export function useMyGuests(enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.mine(),
    queryFn: () => GuestsService.getMyGuests(),
    enabled,
    staleTime: queryStaleTime.standard,
  });
}

export function useMyGuestsWithCredits(enabled = true) {
  return useQuery({
    queryKey: queryKeys.guests.mineWithCredits(),
    queryFn: () => GuestsService.getMyGuestsWithCredits(),
    enabled,
    staleTime: queryStaleTime.standard,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.profile(variables.guestId) });
      invalidateGuestDependencies(queryClient);
    },
  });
}

export function useApplyGuestTourismFromLastCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (guestId: number) => GuestsService.applyTourismTypeFromLastCheckIn(guestId),
    onSuccess: (response, guestId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.detail(guestId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.profile(guestId) });
      queryClient.setQueryData(queryKeys.guests.detail(guestId), response.guest);
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
