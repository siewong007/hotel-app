import { useMemo } from 'react';
import {
  RoomStatusType,
  calculateStatusStatistics,
  filterRoomsByStatus,
  filterAvailableRooms,
  sortRoomsByStatusPriority,
  isRoomAvailableForBooking,
  getStatusConfig,
  StatusStatistics,
} from '../config/roomStatusConfig';
import { Room, BookingWithDetails } from '../types';

export interface EnhancedRoom extends Room {
  computedStatus: RoomStatusType;
  currentGuest?: string;
  checkInDate?: string;
  checkOutDate?: string;
  bookingId?: string;
}

/**
 * Custom Hook for Room Status Management
 * Provides computed room statuses and utility functions
 */
export const useRoomStatus = (
  rooms: Room[],
  bookings: BookingWithDetails[]
) => {
  /**
   * Enhance rooms with computed status based on booking data
   */
  const enhancedRooms = useMemo<EnhancedRoom[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return rooms.map((room) => {
      let computedStatus: RoomStatusType = 'available';
      let currentGuest: string | undefined;
      let checkInDate: string | undefined;
      let checkOutDate: string | undefined;
      let bookingId: string | undefined;

      // Priority 1: Check if guest is checked in (OCCUPIED)
      const currentOccupancy = bookings.find((booking) => {
        if (String(booking.room_id) !== String(room.id)) return false;

        const checkIn = new Date(booking.check_in_date);
        const checkOut = new Date(booking.check_out_date);
        checkIn.setHours(0, 0, 0, 0);
        checkOut.setHours(0, 0, 0, 0);

        return (
          booking.status === 'checked_in' &&
          checkIn <= today &&
          checkOut >= today
        );
      });

      if (currentOccupancy) {
        computedStatus = 'occupied';
        currentGuest = currentOccupancy.guest_name;
        checkInDate = currentOccupancy.check_in_date;
        checkOutDate = currentOccupancy.check_out_date;
        bookingId = String(currentOccupancy.id);
      }
      // Priority 2: Check for today's arrival (RESERVED)
      else {
        const todayArrival = bookings.find((booking) => {
          if (String(booking.room_id) !== String(room.id)) return false;

          const checkIn = new Date(booking.check_in_date);
          checkIn.setHours(0, 0, 0, 0);

          return (
            (booking.status === 'pending' || booking.status === 'confirmed') &&
            checkIn.getTime() === today.getTime()
          );
        });

        if (todayArrival) {
          computedStatus = 'reserved';
          currentGuest = todayArrival.guest_name;
          checkInDate = todayArrival.check_in_date;
          checkOutDate = todayArrival.check_out_date;
          bookingId = String(todayArrival.id);
        }
        // Priority 3: Check for future reservation (RESERVED)
        else {
          const futureReservation = bookings.find((booking) => {
            if (String(booking.room_id) !== String(room.id)) return false;

            const checkIn = new Date(booking.check_in_date);
            checkIn.setHours(0, 0, 0, 0);

            return (
              (booking.status === 'pending' || booking.status === 'confirmed') &&
              checkIn > today
            );
          });

          if (futureReservation) {
            computedStatus = 'reserved';
            currentGuest = futureReservation.guest_name;
            checkInDate = futureReservation.check_in_date;
            checkOutDate = futureReservation.check_out_date;
            bookingId = String(futureReservation.id);
          }
          // Priority 4: Use room table status for operational states
          else if (room.status && ['dirty', 'cleaning', 'maintenance', 'out_of_order'].includes(room.status)) {
            computedStatus = room.status as RoomStatusType;
          }
          // Priority 5: Default to available
          else {
            computedStatus = 'available';
          }
        }
      }

      return {
        ...room,
        computedStatus,
        currentGuest,
        checkInDate,
        checkOutDate,
        bookingId,
      };
    });
  }, [rooms, bookings]);

  /**
   * Calculate statistics
   */
  const statistics = useMemo<StatusStatistics>(() => {
    return calculateStatusStatistics(enhancedRooms);
  }, [enhancedRooms]);

  /**
   * Get rooms by status
   */
  const getRoomsByStatus = (status: RoomStatusType): EnhancedRoom[] => {
    return filterRoomsByStatus(enhancedRooms, [status]);
  };

  /**
   * Get available rooms for booking
   */
  const availableRooms = useMemo<EnhancedRoom[]>(() => {
    return filterAvailableRooms(enhancedRooms);
  }, [enhancedRooms]);

  /**
   * Get rooms that require action
   */
  const roomsRequiringAction = useMemo<EnhancedRoom[]>(() => {
    return enhancedRooms.filter(room => {
      const config = getStatusConfig(room.computedStatus);
      return config.requiresAction;
    });
  }, [enhancedRooms]);

  /**
   * Get rooms sorted by priority
   */
  const roomsByPriority = useMemo<EnhancedRoom[]>(() => {
    return sortRoomsByStatusPriority(enhancedRooms);
  }, [enhancedRooms]);

  /**
   * Check if room can be booked
   */
  const canBookRoom = (roomId: string): boolean => {
    const room = enhancedRooms.find(r => r.id === roomId);
    if (!room) return false;
    return isRoomAvailableForBooking(room.computedStatus);
  };

  /**
   * Get room by ID
   */
  const getRoomById = (roomId: string): EnhancedRoom | undefined => {
    return enhancedRooms.find(r => r.id === roomId);
  };

  /**
   * Get rooms by floor
   */
  const getRoomsByFloor = (floor: number): EnhancedRoom[] => {
    return enhancedRooms.filter(r => r.floor === floor);
  };

  /**
   * Get unique floors
   */
  const floors = useMemo<number[]>(() => {
    const uniqueFloors = new Set(enhancedRooms.map(r => r.floor || 1));
    return Array.from(uniqueFloors).sort((a, b) => a - b);
  }, [enhancedRooms]);

  return {
    // Enhanced data
    enhancedRooms,
    availableRooms,
    roomsRequiringAction,
    roomsByPriority,

    // Statistics
    statistics,

    // Query functions
    getRoomsByStatus,
    getRoomById,
    getRoomsByFloor,
    canBookRoom,

    // Metadata
    floors,
    totalRooms: enhancedRooms.length,
  };
};

export default useRoomStatus;
