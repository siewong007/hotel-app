import { useCallback, useMemo, useState } from 'react';

import type { BookingWithDetails, Room } from '../../../types';
import type { RoomStatusType } from '../config';
import { getStatusAccentColor, getStatusPriority } from '../config';
import { deriveRoomStatusInfo } from '../utils/roomManagementUtils';
import { getHotelSetting } from '../../../utils/hotelSettings';

// Display status is DERIVED here, not stored: computedStatus fuses
// room.status (the backend column) with today's bookings and the configured
// check-in time, so it can legitimately differ from what the database says —
// e.g. a clean room reads 'reserved' once check-in time passes on arrival day.
export interface RoomManagementStatusInfo {
  computedStatus: RoomStatusType;
  booking: BookingWithDetails | undefined;
  reservedBooking: BookingWithDetails | undefined;
  hasCheckedInBooking: boolean;
  hasReservationForToday: boolean;
  hasFutureReservation: boolean;
  futureCheckInDate: Date | null;
  isOccupied: boolean;
  isReserved: boolean;
  isReservedToday: boolean;
  isComplimentary: boolean;
}

export interface RoomFilterOption {
  value: RoomStatusType | 'all';
  label: string;
  count: number;
  color: string;
}

export interface RoomAttributeFilters {
  smoking: boolean;
  daily: boolean;
  nodaily: boolean;
}

interface UseRoomManagementFiltersParams {
  rooms: Room[];
  roomBookings: Map<string, BookingWithDetails>;
  reservedBookings: Map<string, BookingWithDetails>;
}

export function useRoomManagementFilters({
  rooms,
  roomBookings,
  reservedBookings,
}: UseRoomManagementFiltersParams) {
  const [roomStatusFilter, setRoomStatusFilter] = useState<RoomStatusType | 'all'>('all');
  const [attrFilters, setAttrFilters] = useState<RoomAttributeFilters>({
    smoking: false,
    daily: false,
    nodaily: false,
  });
  const [floorFilter, setFloorFilter] = useState<number | 'all'>('all');
  const [roomSearch, setRoomSearch] = useState('');
  const [prioritySort, setPrioritySort] = useState(false);

  const floors = useMemo(() => (
    Array.from(new Set(rooms.map((r) => r.floor).filter((f): f is number => f != null)))
      .sort((a, b) => a - b)
  ), [rooms]);

  // Derive every room's status info once per data change. This also hoists the
  // check-in-time setting read out of deriveRoomStatusInfo — the default reads
  // localStorage on every call, so calling it per room per render was O(rooms).
  const statusInfoByRoom = useMemo(() => {
    const checkInTime = getHotelSetting('check_in_time');
    const map = new Map<string, RoomManagementStatusInfo>();
    for (const room of rooms) {
      map.set(room.id, deriveRoomStatusInfo({
        room,
        booking: roomBookings.get(room.id),
        reservedBooking: reservedBookings.get(room.id),
        checkInTime,
      }) as RoomManagementStatusInfo);
    }
    return map;
  }, [rooms, roomBookings, reservedBookings]);

  const getRoomStatusInfo = useCallback((room: Room): RoomManagementStatusInfo => {
    return statusInfoByRoom.get(room.id)
      ?? deriveRoomStatusInfo({ room, booking: undefined, reservedBooking: undefined }) as RoomManagementStatusInfo;
  }, [statusInfoByRoom]);

  const toggleAttrFilter = useCallback((key: keyof RoomAttributeFilters) => {
    setAttrFilters((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const {
    availableCount,
    occupiedCount,
    reservedCount,
    dirtyCount,
    maintenanceCount,
    occupancyRate,
    smokingCount,
    dailyCleaningCount,
    noCleaningCount,
    filteredRooms,
  } = useMemo(() => {
    let available = 0;
    let occupied = 0;
    let reserved = 0;
    let dirty = 0;
    let maintenance = 0;
    let smoking = 0;
    let dailyCleaning = 0;
    let noCleaning = 0;

    const filtered: Room[] = [];
    const search = roomSearch.trim().toLowerCase();

    for (const room of rooms) {
      const info = statusInfoByRoom.get(room.id);
      if (!info) continue;

      switch (info.computedStatus) {
        case 'available':
          available += 1;
          break;
        case 'occupied':
          occupied += 1;
          break;
        case 'reserved':
          reserved += 1;
          break;
        case 'dirty':
        case 'reserved_dirty':
          dirty += 1;
          break;
        case 'maintenance':
          maintenance += 1;
          break;
        default:
          break;
      }

      if (room.is_smoking) smoking += 1;
      if (info.computedStatus === 'occupied' && info.booking?.cleaning_preference === true) {
        dailyCleaning += 1;
      }
      if (info.computedStatus === 'occupied' && info.booking?.cleaning_preference === false) {
        noCleaning += 1;
      }

      // The Dirty filter covers reserved_dirty too — the header count lumps
      // them together and there is no separate Res-Dirty filter option.
      const matchesStatus = roomStatusFilter === 'all'
        || info.computedStatus === roomStatusFilter
        || (roomStatusFilter === 'dirty' && info.computedStatus === 'reserved_dirty');
      if (!matchesStatus) {
        continue;
      }
      if (attrFilters.smoking && !room.is_smoking) {
        continue;
      }
      if (attrFilters.daily || attrFilters.nodaily) {
        const cleaningPreference = info.computedStatus === 'occupied'
          ? info.booking?.cleaning_preference
          : undefined;
        if (attrFilters.daily && cleaningPreference !== true) {
          continue;
        }
        if (attrFilters.nodaily && cleaningPreference !== false) {
          continue;
        }
      }
      if (floorFilter !== 'all' && room.floor !== floorFilter) {
        continue;
      }
      if (search && !room.room_number.toLowerCase().includes(search)) {
        continue;
      }

      filtered.push(room);
    }

    if (prioritySort) {
      filtered.sort((a, b) => {
        const pa = getStatusPriority(statusInfoByRoom.get(a.id)?.computedStatus ?? 'available');
        const pb = getStatusPriority(statusInfoByRoom.get(b.id)?.computedStatus ?? 'available');
        return pa - pb || a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
      });
    }

    return {
      availableCount: available,
      occupiedCount: occupied,
      reservedCount: reserved,
      dirtyCount: dirty,
      maintenanceCount: maintenance,
      occupancyRate: rooms.length > 0 ? Math.round((occupied / rooms.length) * 100) : 0,
      smokingCount: smoking,
      dailyCleaningCount: dailyCleaning,
      noCleaningCount: noCleaning,
      filteredRooms: filtered,
    };
  }, [attrFilters, floorFilter, prioritySort, roomSearch, roomStatusFilter, rooms, statusInfoByRoom]);

  const filterOptions = useMemo<RoomFilterOption[]>(() => ([
    { value: 'all' as const, label: 'All', count: rooms.length, color: 'transparent' },
    ...([
      { value: 'occupied', label: 'Occupied', count: occupiedCount },
      { value: 'available', label: 'Vacant', count: availableCount },
      { value: 'reserved', label: 'Reserved', count: reservedCount },
      { value: 'dirty', label: 'Dirty', count: dirtyCount },
      { value: 'maintenance', label: 'Maintenance', count: maintenanceCount },
    ] as { value: RoomStatusType; label: string; count: number }[]).map((option) => ({
      ...option,
      color: getStatusAccentColor(option.value),
    })),
  ]), [availableCount, dirtyCount, maintenanceCount, occupiedCount, reservedCount, rooms.length]);

  return {
    roomStatusFilter,
    setRoomStatusFilter,
    attrFilters,
    toggleAttrFilter,
    floorFilter,
    setFloorFilter,
    roomSearch,
    setRoomSearch,
    prioritySort,
    togglePrioritySort: () => setPrioritySort((v) => !v),
    floors,
    getRoomStatusInfo,
    availableCount,
    occupiedCount,
    reservedCount,
    dirtyCount,
    maintenanceCount,
    occupancyRate,
    smokingCount,
    dailyCleaningCount,
    noCleaningCount,
    filteredRooms,
    filterOptions,
  };
}
