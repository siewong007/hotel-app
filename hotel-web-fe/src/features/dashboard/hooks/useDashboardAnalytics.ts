import { useCallback, useMemo } from 'react';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import type { BookingStatsResponse } from '../../../api/bookings.service';
import { useBookingStats } from '../../bookings/hooks/useBookingQueries';
import { useGuestsPage } from '../../guests/hooks/useGuestQueries';
import { useRoomTypes, useRooms } from '../../rooms/hooks/useRoomQueries';
import type { Room, RoomType } from '../../../types';

export interface RoomStats {
  totalRooms: number;
  availableRooms: number;
  occupiedRooms: number;
  reservedRooms: number;
  maintenanceRooms: number;
  cleaningRooms: number;
}

export interface BookingStats {
  totalBookings: number;
  todayCheckIns: number;
  todayCheckOuts: number;
  pendingBookings: number;
}

export interface RoomTypeStats {
  name: string;
  count: number;
  occupied: number;
  available: number;
}

export interface DashboardAnalyticsData {
  roomStats: RoomStats;
  bookingStats: BookingStats;
  roomTypeStats: RoomTypeStats[];
  totalGuests: number;
  revenueData: { name: string; revenue: number }[];
}

const emptyRoomStats: RoomStats = {
  totalRooms: 0,
  availableRooms: 0,
  occupiedRooms: 0,
  reservedRooms: 0,
  maintenanceRooms: 0,
  cleaningRooms: 0,
};

const emptyBookingStatsResponse: BookingStatsResponse = {
  total: 0,
  checked_in: 0,
  confirmed: 0,
  today_check_ins: 0,
  today_check_outs: 0,
  pending: 0,
  active: 0,
  total_revenue: 0,
  revenue_last_7_days: [],
};

const guestTotalParams = { page: 1, page_size: 1 } as const;

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRoomStatus = (room: Room) =>
  (room.status || (room.available ? 'available' : 'occupied')).toLowerCase();

const isOccupiedRoom = (room: Room) => {
  const status = getRoomStatus(room);
  return status === 'occupied' || status === 'checked_in';
};

function buildRevenueData(
  revenuePoints: BookingStatsResponse['revenue_last_7_days'] | undefined,
  now: Date
) {
  const days: { key: string; name: string; revenue: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    days.push({
      key: toDateKey(date),
      name: date.toLocaleDateString(undefined, { weekday: 'short' }),
      revenue: 0,
    });
  }

  const dayByKey = new Map(days.map((day) => [day.key, day]));
  revenuePoints?.forEach((point) => {
    const day = dayByKey.get(point.date);
    if (day) day.revenue = Number(point.revenue) || 0;
  });

  return days.map(({ name, revenue }) => ({ name, revenue }));
}

export function buildDashboardAnalyticsData(
  rooms: Room[],
  bookingStatsResponse: BookingStatsResponse | undefined,
  totalGuests: number,
  roomTypes: RoomType[],
  now = new Date()
): DashboardAnalyticsData {
  const backendStats = bookingStatsResponse ?? emptyBookingStatsResponse;

  const roomStats = rooms.reduce<RoomStats>((stats, room) => {
    const status = getRoomStatus(room);
    if (status === 'maintenance' || status === 'out_of_order') stats.maintenanceRooms += 1;
    else if (status === 'cleaning' || status === 'dirty' || status === 'reserved_dirty') stats.cleaningRooms += 1;
    else if (status === 'occupied' || status === 'checked_in') stats.occupiedRooms += 1;
    else if (status === 'reserved') stats.reservedRooms += 1;
    else stats.availableRooms += 1;
    return stats;
  }, { ...emptyRoomStats, totalRooms: rooms.length });

  const bookingStats: BookingStats = {
    totalBookings: backendStats.total,
    todayCheckIns: backendStats.today_check_ins,
    todayCheckOuts: backendStats.today_check_outs,
    pendingBookings: backendStats.pending,
  };

  const roomTypeStats = roomTypes
    .map((roomType) => {
      const roomsOfType = rooms.filter((room) => room.room_type === roomType.name);
      const occupied = roomsOfType.filter(isOccupiedRoom).length;
      return {
        name: roomType.name,
        count: roomsOfType.length,
        occupied,
        available: roomsOfType.length - occupied,
      };
    })
    .filter((roomType) => roomType.count > 0);

  return {
    roomStats,
    bookingStats,
    roomTypeStats,
    totalGuests,
    revenueData: buildRevenueData(backendStats.revenue_last_7_days, now),
  };
}

export function useDashboardAnalytics(enabled = true) {
  const roomsQuery = useRooms(enabled);
  const bookingStatsQuery = useBookingStats(enabled);
  const guestsTotalQuery = useGuestsPage(guestTotalParams, enabled);
  const roomTypesQuery = useRoomTypes(enabled);

  const data = useMemo(() => buildDashboardAnalyticsData(
    roomsQuery.data ?? [],
    bookingStatsQuery.data,
    guestsTotalQuery.data?.total ?? 0,
    roomTypesQuery.data ?? []
  ), [bookingStatsQuery.data, guestsTotalQuery.data?.total, roomTypesQuery.data, roomsQuery.data]);

  const refetch = useCallback(() => Promise.all([
    roomsQuery.refetch(),
    bookingStatsQuery.refetch(),
    guestsTotalQuery.refetch(),
    roomTypesQuery.refetch(),
  ]), [bookingStatsQuery, guestsTotalQuery, roomTypesQuery, roomsQuery]);

  const firstError = roomsQuery.error || bookingStatsQuery.error || guestsTotalQuery.error || roomTypesQuery.error;

  return {
    data,
    loading: roomsQuery.isPending || bookingStatsQuery.isPending || guestsTotalQuery.isPending || roomTypesQuery.isPending,
    fetching: roomsQuery.isFetching || bookingStatsQuery.isFetching || guestsTotalQuery.isFetching || roomTypesQuery.isFetching,
    error: getQueryErrorMessage(firstError, 'Failed to load analytics data'),
    refetch,
  };
}
