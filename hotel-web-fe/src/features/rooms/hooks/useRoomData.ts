import { useState, useCallback, useMemo } from 'react';
import { Room, Guest, BookingWithDetails } from '../../../types';
import { useAllBookings } from '../../bookings/hooks/useBookingQueries';
import { useGuests } from '../../guests/hooks/useGuestQueries';
import { useRooms } from './useRoomQueries';

export function useRoomData() {
  const roomsQuery = useRooms();
  const guestsQuery = useGuests();
  const bookingsQuery = useAllBookings();
  const [roomOverrides, setRooms] = useState<Room[] | null>(null);
  const [guestOverrides, setGuests] = useState<Guest[] | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRooms = useCallback(async (showLoader = false) => {
    if (showLoader) setManualLoading(true);
    try {
      const result = await roomsQuery.refetch();
      if (result.data) setRooms(null);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load rooms');
    } finally {
      if (showLoader) setManualLoading(false);
    }
  }, [roomsQuery]);

  const loadBookings = useCallback(async () => {
    try {
      await bookingsQuery.refetch();
    } catch (err: any) {
      console.error('Failed to load bookings:', err);
    }
  }, [bookingsQuery]);

  const loadGuests = useCallback(async () => {
    try {
      const result = await guestsQuery.refetch();
      if (result.data) setGuests(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load guests');
    }
  }, [guestsQuery]);

  const reload = useCallback(async () => {
    await Promise.all([loadRooms(true), loadGuests(), loadBookings()]);
  }, [loadRooms, loadGuests, loadBookings]);

  const allBookingsData = (bookingsQuery.data ?? []) as BookingWithDetails[];
  const rooms = roomOverrides ?? (roomsQuery.data ?? []);
  const guests = guestOverrides ?? (guestsQuery.data ?? []);
  const queryError = roomsQuery.error || guestsQuery.error || bookingsQuery.error;
  const loading = manualLoading || roomsQuery.isPending;

  const {
    roomBookings,
    reservedBookings,
    compCancelledBookings,
  } = useMemo(() => {
    const bookingsMap = new Map<string, BookingWithDetails>();
    const reservedMap = new Map<string, BookingWithDetails>();
    const compCancelledMap = new Map<string, BookingWithDetails>();

    allBookingsData.forEach((booking: BookingWithDetails) => {
      if (booking.status === 'checked_in' || booking.status === 'auto_checked_in') {
        bookingsMap.set(booking.room_id, booking);
      }
      if (booking.status === 'confirmed' || booking.status === 'pending') {
        const existing = reservedMap.get(booking.room_id);
        if (!existing || new Date(booking.check_in_date) < new Date(existing.check_in_date)) {
          reservedMap.set(booking.room_id, booking);
        }
      }
      if (booking.status === 'voided') {
        compCancelledMap.set(booking.room_id, booking);
      }
    });

    return {
      roomBookings: bookingsMap,
      reservedBookings: reservedMap,
      compCancelledBookings: compCancelledMap,
    };
  }, [allBookingsData]);

  return {
    rooms, setRooms,
    guests, setGuests,
    loading,
    error: error || (queryError instanceof Error ? queryError.message : null),
    roomBookings,
    reservedBookings,
    compCancelledBookings,
    allBookingsData,
    reload,
    reloadRooms: loadRooms,
    reloadGuests: loadGuests,
    reloadBookings: loadBookings,
  };
}
