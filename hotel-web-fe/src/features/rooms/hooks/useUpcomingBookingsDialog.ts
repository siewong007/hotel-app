import { useCallback, useState } from 'react';
import type { BookingWithDetails, Room } from '../../../types';

interface UseUpcomingBookingsDialogArgs {
  allBookings: BookingWithDetails[];
  onSelectRoom: (room: Room) => void;
  onCloseMenu: () => void;
}

export function useUpcomingBookingsDialog({
  allBookings,
  onSelectRoom,
  onCloseMenu,
}: UseUpcomingBookingsDialogArgs) {
  const [open, setOpen] = useState(false);
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [loading] = useState(false);

  const openForRoom = useCallback((room: Room) => {
    onCloseMenu();
    onSelectRoom(room);
    setOpen(true);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const roomUpcomingBookings = allBookings
      .filter(booking => {
        const isThisRoom = booking.room_id?.toString() === room.id.toString();
        const checkInDate = new Date(booking.check_in_date);
        checkInDate.setHours(0, 0, 0, 0);
        const isUpcoming = checkInDate >= today;
        const isActive = ['pending', 'confirmed', 'checked_in', 'auto_checked_in'].includes(booking.status);
        return isThisRoom && (isUpcoming || booking.status === 'checked_in') && isActive;
      })
      .sort((a, b) => new Date(a.check_in_date).getTime() - new Date(b.check_in_date).getTime());

    setBookings(roomUpcomingBookings);
  }, [allBookings, onCloseMenu, onSelectRoom]);

  const close = useCallback(() => setOpen(false), []);

  return {
    open,
    close,
    bookings,
    loading,
    openForRoom,
  };
}
