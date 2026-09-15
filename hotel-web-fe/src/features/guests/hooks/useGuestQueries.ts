import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GuestsService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidateGuestDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import type { GuestCreateRequest, GuestListSegment, GuestUpdateRequest, GuestType, TourismType } from '../../../types';

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
  // CRM list filters (guest relations workspace). Only `true` is meaningful —
  // an absent key means "no filter", matching the backend's `unwrap_or(false)`.
  vip?: boolean;
  blacklisted?: boolean;
  has_open_support?: boolean;
  // Booking-derived segment (returning/in_house/upcoming/inactive) — a
  // single-select filter applied server-side.
  segment?: GuestListSegment;
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

/**
 * Server-side guest lookup for pickers.
 *
 * Replaces downloading the whole guest table and filtering it in the browser
 * (1,731 rows / ~1,093 kB measured). The backend searches name, email, phone,
 * IC, company and linked username, with trigram indexes behind the two biggest
 * columns, and returns a bounded page.
 *
 * Disabled below `minLength` so an empty picker issues no request at all; the
 * caller is expected to pass an already-debounced term.
 */
export function useGuestSearch(search: string, limit = 20, minLength = 2) {
  const term = search.trim();
  const params = { search: term, page_size: limit, page: 1 };
  return useQuery({
    queryKey: queryKeys.guests.page(params),
    queryFn: () => GuestsService.getGuestsPage(params),
    enabled: term.length >= minLength,
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

export function useTransferGuestPortalAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guestId, username }: { guestId: number; username: string }) =>
      GuestsService.transferPortalAccount(guestId, username),
    onSuccess: () => invalidateGuestDependencies(queryClient),
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
