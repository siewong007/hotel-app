import { useState, useCallback, useMemo } from 'react';
import { BookingWithDetails } from '../../../types';
import { useActiveBookings } from '../../bookings/hooks/useBookingQueries';
import { useGuests } from '../../guests/hooks/useGuestQueries';
import { useRooms } from './useRoomQueries';
import { errorMessage } from '../../../utils/errorMessage';

const ROOM_DATA_REFETCH_INTERVAL_MS = 30_000;

// `guestsEnabled` gates the full guest list — only the booking modal's guest
// picker needs it, so the page passes its modal-open flag and the whole-table
// fetch stays off the initial-load path.
export function useRoomData(guestsEnabled = true) {
  // Query-level polling pauses while the tab is hidden, unlike a setInterval.
  const roomsQuery = useRooms(true, ROOM_DATA_REFETCH_INTERVAL_MS);
  const guestsQuery = useGuests(undefined, guestsEnabled);
  const bookingsQuery = useActiveBookings(true, ROOM_DATA_REFETCH_INTERVAL_MS);
  const { refetch: refetchRooms } = roomsQuery;
  const { refetch: refetchGuests } = guestsQuery;
  const { refetch: refetchBookings } = bookingsQuery;
  const [error, setError] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      await refetchRooms();
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load rooms'));
    }
  }, [refetchRooms]);

  const loadBookings = useCallback(async () => {
    try {
      await refetchBookings();
    } catch (err) {
      console.error('Failed to load bookings:', err);
    }
  }, [refetchBookings]);

  const loadGuests = useCallback(async () => {
    try {
      await refetchGuests();
    } catch (err) {
      setError(errorMessage(err, 'Failed to load guests'));
    }
  }, [refetchGuests]);

  const reload = useCallback(async () => {
    await Promise.all([loadRooms(), loadGuests(), loadBookings()]);
  }, [loadRooms, loadGuests, loadBookings]);

  const allBookingsData = useMemo(
    () => (bookingsQuery.data ?? []) as BookingWithDetails[],
    [bookingsQuery.data]
  );
  const rooms = roomsQuery.data ?? [];
  const guests = guestsQuery.data ?? [];
  const queryError = roomsQuery.error || guestsQuery.error || bookingsQuery.error;
  // Block the page only while there is no room data at all; refetches keep the
  // grid mounted so actions don't flash a full-page spinner.
  const loading = roomsQuery.isPending;

  const { roomBookings, reservedBookings } = useMemo(() => {
    const bookingsMap = new Map<string, BookingWithDetails>();
    const reservedMap = new Map<string, BookingWithDetails>();

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
    });

    return {
      roomBookings: bookingsMap,
      reservedBookings: reservedMap,
    };
  }, [allBookingsData]);

  return {
    rooms,
    guests,
    loading,
    error: error || (queryError instanceof Error ? queryError.message : null),
    roomBookings,
    reservedBookings,
    allBookingsData,
    reload,
    reloadRooms: loadRooms,
    reloadGuests: loadGuests,
    reloadBookings: loadBookings,
  };
}
