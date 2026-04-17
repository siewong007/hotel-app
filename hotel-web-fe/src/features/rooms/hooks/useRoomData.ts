import { useState, useCallback } from 'react';
import { HotelAPIService } from '../../../api';
import { Room, Guest, BookingWithDetails } from '../../../types';

export function useRoomData() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomBookings, setRoomBookings] = useState<Map<string, BookingWithDetails>>(new Map());
  const [reservedBookings, setReservedBookings] = useState<Map<string, BookingWithDetails>>(new Map());
  const [compCancelledBookings, setCompCancelledBookings] = useState<Map<string, BookingWithDetails>>(new Map());
  const [allBookingsData, setAllBookingsData] = useState<BookingWithDetails[]>([]);

  const loadRooms = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const data = await HotelAPIService.getAllRooms();
      setRooms(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load rooms');
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  const loadBookings = useCallback(async () => {
    try {
      const bookingsData = await HotelAPIService.getAllBookings();
      setAllBookingsData(bookingsData as BookingWithDetails[]);

      const bookingsMap = new Map<string, BookingWithDetails>();
      const reservedMap = new Map<string, BookingWithDetails>();
      const compCancelledMap = new Map<string, BookingWithDetails>();

      bookingsData.forEach((booking: BookingWithDetails) => {
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

      setRoomBookings(bookingsMap);
      setReservedBookings(reservedMap);
      setCompCancelledBookings(compCancelledMap);
    } catch (err: any) {
      console.error('Failed to load bookings:', err);
    }
  }, []);

  const loadGuests = useCallback(async () => {
    try {
      const data = await HotelAPIService.getAllGuests();
      setGuests(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load guests');
    }
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([loadRooms(true), loadGuests(), loadBookings()]);
  }, [loadRooms, loadGuests, loadBookings]);

  return {
    rooms, setRooms,
    guests, setGuests,
    loading,
    error,
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
