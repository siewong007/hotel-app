import { useState, useCallback, useMemo } from 'react';
import { BookingWithDetails, Room, Guest } from '../../../types';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { normalizePage, toPaginationSearchParams } from '../../../utils/pagination';
import { formatLocalDate, addLocalDays } from '../../../utils/date';
import { useBookingStats, useBookingsPage } from './useBookingQueries';
import { useGuests } from '../../guests/hooks/useGuestQueries';
import { useRooms } from '../../rooms/hooks/useRoomQueries';

export type SortField = 'check_in_date' | 'check_out_date' | 'guest_name' | 'room_number' | 'status' | 'folio_number' | 'invoice_number';
export type SortOrder = 'asc' | 'desc';
export type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom' | 'date_search';

export const PAGE_SIZE = 50;

export interface BookingStats {
  total: number;
  checked_in: number;
  confirmed: number;
  today_check_ins: number;
}

export function useBookings() {
  const [error, setError] = useState<string | null>(null);
  const [roomOverrides, setRooms] = useState<Room[] | null>(null);

  // Filter & sort state
  const [sortField, setSortField] = useState<SortField>('check_in_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [roomNumberFilter, setRoomNumberFilter] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('');
  const [onlineChannelFilter, setOnlineChannelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [searchDate, setSearchDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 700);
  const debouncedRoomNumberFilter = useDebouncedValue(roomNumberFilter, 700);

  const apiParams = useMemo(() => {
    const today = formatLocalDate();
    const addDays = (base: string, n: number) => formatLocalDate(addLocalDays(base, n));

    const params: Record<string, any> = {
      ...toPaginationSearchParams({ page: normalizePage(currentPage), pageSize: PAGE_SIZE }),
      sort_by: sortField,
      sort_order: sortOrder,
      status: statusFilter,
    };

    if (debouncedSearchQuery.trim()) params.search = debouncedSearchQuery.trim();
    if (debouncedRoomNumberFilter.trim()) params.room_number = debouncedRoomNumberFilter.trim();
    if (paymentMethodFilter.trim()) params.payment_method = paymentMethodFilter.trim();
    if (onlineChannelFilter.trim()) params.online_channel = onlineChannelFilter.trim();
    if (dateFilter === 'today') { params.check_in_from = today; params.check_in_to = today; }
    else if (dateFilter === 'week') { params.check_in_from = today; params.check_in_to = addDays(today, 7); }
    else if (dateFilter === 'month') { params.check_in_from = today; params.check_in_to = addDays(today, 30); }
    else if (dateFilter === 'custom' && customStartDate && customEndDate) { params.check_in_from = customStartDate; params.check_in_to = customEndDate; }
    else if (dateFilter === 'date_search' && searchDate) { params.date_search = searchDate; }

    return params;
  }, [currentPage, sortField, sortOrder, debouncedSearchQuery, debouncedRoomNumberFilter, paymentMethodFilter, onlineChannelFilter, statusFilter, dateFilter, customStartDate, customEndDate, searchDate]);

  const bookingsQuery = useBookingsPage(apiParams);
  const roomsQuery = useRooms();
  const statsQuery = useBookingStats();
  const guestsQuery = useGuests();

  const bookings = (bookingsQuery.data?.data ?? []) as BookingWithDetails[];
  const rooms = roomOverrides ?? (roomsQuery.data ?? []);
  const guests = (guestsQuery.data ?? []) as Guest[];
  const totalBookings = bookingsQuery.data?.total ?? 0;
  const statsData = (statsQuery.data ?? { total: 0, checked_in: 0, confirmed: 0, today_check_ins: 0 }) as BookingStats;
  const loading = bookingsQuery.isPending;
  const queryError = bookingsQuery.error || roomsQuery.error || guestsQuery.error || statsQuery.error;
  const effectiveError = error || (queryError instanceof Error ? queryError.message : null);

  const loadRooms = useCallback(async () => {
    const result = await roomsQuery.refetch();
    if (result.data) setRooms(null);
  }, [roomsQuery]);

  const loadStats = useCallback(async () => {
    await statsQuery.refetch();
  }, [statsQuery]);

  const loadGuests = useCallback(async () => {
    await guestsQuery.refetch();
  }, [guestsQuery]);

  const loadBookings = useCallback(async () => {
    await bookingsQuery.refetch();
  }, [bookingsQuery]);

  const reload = useCallback(async () => {
    await Promise.all([bookingsQuery.refetch(), statsQuery.refetch(), guestsQuery.refetch(), roomsQuery.refetch()]);
  }, [bookingsQuery, statsQuery, guestsQuery, roomsQuery]);

  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
      else { setSortOrder('asc'); }
      return field;
    });
    setCurrentPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setRoomNumberFilter('');
    setPaymentMethodFilter('');
    setOnlineChannelFilter('');
    setStatusFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSearchDate('');
    setSortField('check_in_date');
    setSortOrder('desc');
    setCurrentPage(1);
  }, []);

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  }, []);

  const handleRoomNumberFilterChange = useCallback((value: string) => {
    setRoomNumberFilter(value);
    setCurrentPage(1);
  }, []);

  const handlePaymentMethodFilterChange = useCallback((value: string) => {
    setPaymentMethodFilter(value);
    setCurrentPage(1);
  }, []);

  const handleOnlineChannelFilterChange = useCallback((value: string) => {
    setOnlineChannelFilter(value);
    setCurrentPage(1);
  }, []);

  return {
    bookings,
    rooms,
    setRooms,
    guests,
    loading,
    error: effectiveError,
    setError,
    totalBookings,
    statsData,
    sortField,
    sortOrder,
    searchQuery,
    setSearchQuery: handleSearchQueryChange,
    roomNumberFilter,
    setRoomNumberFilter: handleRoomNumberFilterChange,
    paymentMethodFilter,
    setPaymentMethodFilter: handlePaymentMethodFilterChange,
    onlineChannelFilter,
    setOnlineChannelFilter: handleOnlineChannelFilterChange,
    statusFilter,
    setStatusFilter,
    dateFilter,
    setDateFilter,
    customStartDate,
    setCustomStartDate,
    customEndDate,
    setCustomEndDate,
    searchDate,
    setSearchDate,
    currentPage,
    setCurrentPage,
    loadRooms,
    loadStats,
    loadGuests,
    loadBookings,
    reload,
    handleSort,
    clearFilters,
  };
}
