import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookingsService,
  CompaniesService,
  InvoicesService,
  RatesService,
} from '../../../api';
import { queryKeys } from '../../../api/queryKeys';
import type {
  BookingCreateRequest,
  BookingUpdateRequest,
  CheckInRequest,
} from '../../../types';

type BookingsPageParams = Record<string, unknown>;

const invalidateBookingDependencies = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.guests.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.nightAudit.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
};

export function useBookingsPage(params?: BookingsPageParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.bookings.page(params),
    queryFn: () => BookingsService.getBookingsPage(params as any),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useBookingsWithDetails(filters?: BookingsPageParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.bookings.withDetails(filters),
    queryFn: () => BookingsService.getBookingsWithDetails(filters as any),
    enabled,
    staleTime: 30_000,
  });
}

export function useAllBookings(filters?: { room_number?: string; company_billed?: boolean }, enabled = true) {
  return useQuery({
    queryKey: queryKeys.bookings.list(filters as BookingsPageParams | undefined),
    queryFn: () => BookingsService.getAllBookings(filters),
    enabled,
    staleTime: 30_000,
  });
}

export function useMyBookings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.bookings.mine(),
    queryFn: () => BookingsService.getMyBookings(),
    enabled,
    staleTime: 30_000,
  });
}

export function useBookingStats(enabled = true) {
  return useQuery({
    queryKey: queryKeys.bookings.stats(),
    queryFn: () => BookingsService.getBookingStats(),
    enabled,
    staleTime: 60_000,
  });
}

export function useBooking(id?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.bookings.detail(id ?? ''),
    queryFn: () => BookingsService.getBookingById(String(id)),
    enabled: enabled && id != null && id !== '',
    staleTime: 30_000,
  });
}

export function useBookingTimeline(id?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.bookings.timeline(id ?? ''),
    queryFn: () => BookingsService.getBookingTimeline(id as string | number),
    enabled: enabled && id != null && id !== '',
    staleTime: 30_000,
  });
}

export function usePaymentWorkflowSummary(id?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.bookings.paymentWorkflow(id ?? ''),
    queryFn: () => InvoicesService.getPaymentWorkflowSummary(id as string | number),
    enabled: enabled && id != null && id !== '',
    staleTime: 15_000,
  });
}

export function useRateCodes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rates.rateCodes(),
    queryFn: () => RatesService.getRateCodes(),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useMarketCodes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rates.marketCodes(),
    queryFn: () => RatesService.getMarketCodes(),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useActiveCompanies(enabled = true) {
  const params = { is_active: true };
  return useQuery({
    queryKey: queryKeys.companies.list(params),
    queryFn: () => CompaniesService.getCompanies(params),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BookingCreateRequest) => BookingsService.createBooking(data),
    onSuccess: () => invalidateBookingDependencies(queryClient),
  });
}

export function useUpdateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, data }: { bookingId: string | number; data: BookingUpdateRequest | Record<string, unknown> }) =>
      BookingsService.updateBooking(String(bookingId), data as BookingUpdateRequest),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(variables.bookingId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.timeline(variables.bookingId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.paymentWorkflow(variables.bookingId) });
      invalidateBookingDependencies(queryClient);
    },
  });
}

export function useCheckInGuestMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, data }: { bookingId: string | number; data?: CheckInRequest }) =>
      BookingsService.checkInGuest(String(bookingId), data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(variables.bookingId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.timeline(variables.bookingId) });
      invalidateBookingDependencies(queryClient);
    },
  });
}

export function useReactivateBookingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string | number) => BookingsService.reactivateBooking(String(bookingId)),
    onSuccess: (_, bookingId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(bookingId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.timeline(bookingId) });
      invalidateBookingDependencies(queryClient);
    },
  });
}

export function useRecordPaymentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof InvoicesService.recordPayment>[0]) => InvoicesService.recordPayment(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(variables.booking_id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.paymentWorkflow(variables.booking_id) });
      invalidateBookingDependencies(queryClient);
    },
  });
}

export function useMarkBookingComplimentaryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      bookingId,
      reason,
      startDate,
      endDate,
    }: {
      bookingId: string | number;
      reason?: string;
      startDate?: string;
      endDate?: string;
    }) => BookingsService.markBookingComplimentary(String(bookingId), reason, startDate, endDate),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(variables.bookingId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.all });
      invalidateBookingDependencies(queryClient);
    },
  });
}

export function useBookWithCreditsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof BookingsService.bookWithCredits>[0]) => BookingsService.bookWithCredits(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.guests.all });
      invalidateBookingDependencies(queryClient);
    },
  });
}

export function useBookingWorkflowFetcher() {
  const queryClient = useQueryClient();
  return (bookingId: string | number) =>
    Promise.all([
      queryClient.ensureQueryData({
        queryKey: queryKeys.bookings.paymentWorkflow(bookingId),
        queryFn: () => InvoicesService.getPaymentWorkflowSummary(bookingId),
        staleTime: 15_000,
      }),
      queryClient.ensureQueryData({
        queryKey: queryKeys.bookings.timeline(bookingId),
        queryFn: () => BookingsService.getBookingTimeline(bookingId),
        staleTime: 30_000,
      }),
    ]);
}
