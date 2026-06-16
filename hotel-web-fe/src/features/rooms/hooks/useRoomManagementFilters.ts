import { useCallback, useMemo, useState } from 'react';

import type { BookingWithDetails, Room } from '../../../types';
import type { RoomStatusType } from '../config';
import { deriveRoomStatusInfo } from '../utils/roomManagementUtils';

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

  const getRoomStatusInfo = useCallback((room: Room): RoomManagementStatusInfo => {
    return deriveRoomStatusInfo({
      room,
      booking: roomBookings.get(room.id),
      reservedBooking: reservedBookings.get(room.id),
    }) as RoomManagementStatusInfo;
  }, [roomBookings, reservedBookings]);

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

    for (const room of rooms) {
      const info = getRoomStatusInfo(room);

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

      if (roomStatusFilter !== 'all' && info.computedStatus !== roomStatusFilter) {
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

      filtered.push(room);
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
  }, [attrFilters, getRoomStatusInfo, roomStatusFilter, rooms]);

  const filterOptions = useMemo<RoomFilterOption[]>(() => [
    { value: 'all', label: 'All', count: rooms.length, color: 'transparent' },
    { value: 'occupied', label: 'Occupied', count: occupiedCount, color: '#ec7c32' },
    { value: 'available', label: 'Vacant', count: availableCount, color: '#3f8f5b' },
    { value: 'reserved', label: 'Reserved', count: reservedCount, color: '#3f7fbd' },
    { value: 'dirty', label: 'Dirty', count: dirtyCount, color: '#b8942f' },
    { value: 'maintenance', label: 'Maintenance', count: maintenanceCount, color: '#8d9691' },
  ], [availableCount, dirtyCount, maintenanceCount, occupiedCount, reservedCount, rooms.length]);

  return {
    roomStatusFilter,
    setRoomStatusFilter,
    attrFilters,
    toggleAttrFilter,
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
