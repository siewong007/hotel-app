import { useState, useCallback, useEffect, useRef } from 'react';
import { HotelAPIService } from '../../../api';
import { BookingWithDetails, Room, Guest } from '../../../types';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';

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
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalBookings, setTotalBookings] = useState(0);
  const [statsData, setStatsData] = useState<BookingStats>({ total: 0, checked_in: 0, confirmed: 0, today_check_ins: 0 });

  // Filter & sort state
  const [sortField, setSortField] = useState<SortField>('check_in_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [roomNumberFilter, setRoomNumberFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [searchDate, setSearchDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 700);
  const debouncedRoomNumberFilter = useDebouncedValue(roomNumberFilter, 700);
  const bookingsRequestId = useRef(0);
  const previousDebouncedTextFilters = useRef({
    searchQuery: debouncedSearchQuery,
    roomNumberFilter: debouncedRoomNumberFilter,
  });
  const skipNextLoadForPageReset = useRef(false);

  const loadRooms = useCallback(async () => {
    try {
      const data = await HotelAPIService.getAllRooms();
      setRooms(data);
    } catch (err: any) {
      console.error('Failed to load rooms:', err);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await HotelAPIService.getBookingStats();
      setStatsData(data);
    } catch (err: any) {
      console.error('Failed to load booking stats:', err);
    }
  }, []);

  const loadGuests = useCallback(async () => {
    try {
      const data = await HotelAPIService.getAllGuests();
      setGuests(data);
    } catch (err: any) {
      console.error('Failed to load guests:', err);
    }
  }, []);

  const loadBookings = useCallback(async (params?: {
    page?: number;
    sort_by?: SortField;
    sort_order?: SortOrder;
    search?: string;
    room_number?: string;
    status?: string;
    date_filter?: DateFilter;
    custom_start?: string;
    custom_end?: string;
    date_search?: string;
  }) => {
    const requestId = bookingsRequestId.current + 1;
    bookingsRequestId.current = requestId;

    try {
      setLoading(true);

      const today = new Date().toISOString().split('T')[0];
      const addDays = (base: string, n: number) => {
        const d = new Date(base);
        d.setDate(d.getDate() + n);
        return d.toISOString().split('T')[0];
      };

      const p = params || {};
      const resolvedPage = p.page ?? currentPage;
      const resolvedSort = p.sort_by ?? sortField;
      const resolvedOrder = p.sort_order ?? sortOrder;
      const resolvedSearch = p.search ?? debouncedSearchQuery;
      const resolvedRoom = p.room_number ?? debouncedRoomNumberFilter;
      const resolvedStatus = p.status ?? statusFilter;
      const resolvedDateFilter = p.date_filter ?? dateFilter;
      const resolvedCustomStart = p.custom_start ?? customStartDate;
      const resolvedCustomEnd = p.custom_end ?? customEndDate;
      const resolvedSearchDate = p.date_search ?? searchDate;

      const apiParams: Record<string, any> = {
        page: resolvedPage,
        page_size: PAGE_SIZE,
        sort_by: resolvedSort,
        sort_order: resolvedOrder,
      };
      if (resolvedSearch.trim()) apiParams.search = resolvedSearch.trim();
      if (resolvedRoom.trim()) apiParams.room_number = resolvedRoom.trim();
      apiParams.status = resolvedStatus;
      if (resolvedDateFilter === 'today') { apiParams.check_in_from = today; apiParams.check_in_to = today; }
      else if (resolvedDateFilter === 'week') { apiParams.check_in_from = today; apiParams.check_in_to = addDays(today, 7); }
      else if (resolvedDateFilter === 'month') { apiParams.check_in_from = today; apiParams.check_in_to = addDays(today, 30); }
      else if (resolvedDateFilter === 'custom' && resolvedCustomStart && resolvedCustomEnd) { apiParams.check_in_from = resolvedCustomStart; apiParams.check_in_to = resolvedCustomEnd; }
      else if (resolvedDateFilter === 'date_search' && resolvedSearchDate) { apiParams.date_search = resolvedSearchDate; }

      const resp = await HotelAPIService.getBookingsPage(apiParams);
      if (bookingsRequestId.current !== requestId) return;

      setBookings(resp.data);
      setTotalBookings(resp.total);
      setError(null);
    } catch (err: any) {
      if (bookingsRequestId.current !== requestId) return;

      console.error('Failed to load bookings:', err);
      setError(err.message || 'Failed to load bookings. Please check your connection and try again.');
    } finally {
      if (bookingsRequestId.current === requestId) {
        setLoading(false);
      }
    }
  }, [currentPage, sortField, sortOrder, debouncedSearchQuery, debouncedRoomNumberFilter, statusFilter, dateFilter, customStartDate, customEndDate, searchDate]);

  const reload = useCallback(async () => {
    await Promise.all([loadBookings(), loadStats(), loadGuests()]);
  }, [loadBookings, loadStats, loadGuests]);

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
    setStatusFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSearchDate('');
    setSortField('check_in_date');
    setSortOrder('desc');
    setCurrentPage(1);
  }, []);

  // Initial load
  useEffect(() => {
    loadRooms();
    loadStats();
    const timer = setTimeout(() => loadGuests(), 800);
    return () => clearTimeout(timer);
  }, [loadRooms, loadStats, loadGuests]);

  useEffect(() => {
    const textFiltersChanged =
      previousDebouncedTextFilters.current.searchQuery !== debouncedSearchQuery ||
      previousDebouncedTextFilters.current.roomNumberFilter !== debouncedRoomNumberFilter;

    previousDebouncedTextFilters.current = {
      searchQuery: debouncedSearchQuery,
      roomNumberFilter: debouncedRoomNumberFilter,
    };

    if (textFiltersChanged && currentPage !== 1) {
      skipNextLoadForPageReset.current = true;
      setCurrentPage(1);
    }
  }, [debouncedSearchQuery, debouncedRoomNumberFilter, currentPage]);

  // Reload bookings on committed filter/page changes. Text inputs commit via debounce.
  useEffect(() => {
    if (skipNextLoadForPageReset.current) {
      skipNextLoadForPageReset.current = false;
      return;
    }

    loadBookings();
  }, [currentPage, sortField, sortOrder, debouncedSearchQuery, debouncedRoomNumberFilter, statusFilter, dateFilter, customStartDate, customEndDate, searchDate]);

  return {
    bookings,
    rooms,
    setRooms,
    guests,
    loading,
    error,
    setError,
    totalBookings,
    statsData,
    sortField,
    sortOrder,
    searchQuery,
    setSearchQuery,
    roomNumberFilter,
    setRoomNumberFilter,
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
