import { useCallback } from 'react';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { useInsightsOverview } from '../../insights/hooks';
import type { InsightsOverview } from '../../insights/types';

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

const emptyBookingStats: BookingStats = {
  totalBookings: 0,
  todayCheckIns: 0,
  todayCheckOuts: 0,
  pendingBookings: 0,
};

const emptyData: DashboardAnalyticsData = {
  roomStats: emptyRoomStats,
  bookingStats: emptyBookingStats,
  roomTypeStats: [],
  totalGuests: 0,
  revenueData: [],
};

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function buildRevenueData(
  revenuePoints: InsightsOverview['revenue_last_7_days'] | undefined,
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
  overview: InsightsOverview | undefined,
  now = new Date()
): DashboardAnalyticsData {
  if (!overview) return emptyData;

  return {
    roomStats: {
      totalRooms: overview.rooms.total,
      availableRooms: overview.rooms.available,
      occupiedRooms: overview.rooms.occupied,
      reservedRooms: overview.rooms.reserved,
      maintenanceRooms: overview.rooms.maintenance,
      cleaningRooms: overview.rooms.cleaning,
    },
    bookingStats: {
      totalBookings: overview.bookings.total,
      todayCheckIns: overview.bookings.today_check_ins,
      todayCheckOuts: overview.bookings.today_check_outs,
      pendingBookings: overview.bookings.pending,
    },
    roomTypeStats: overview.room_types.map((rt) => ({
      name: rt.name,
      count: rt.total,
      occupied: rt.occupied,
      available: rt.available,
    })),
    totalGuests: overview.guests_total,
    revenueData: buildRevenueData(overview.revenue_last_7_days, now),
  };
}

export function useDashboardAnalytics(enabled = true) {
  const overview = useInsightsOverview(enabled);

  const refetch = useCallback(() => overview.refetch(), [overview]);

  return {
    data: buildDashboardAnalyticsData(overview.data),
    loading: overview.isPending,
    fetching: overview.isFetching,
    error: getQueryErrorMessage(overview.error, 'Failed to load analytics data'),
    refetch,
  };
}
