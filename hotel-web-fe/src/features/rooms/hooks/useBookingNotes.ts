import { useCallback, useState } from 'react';

import { BookingsService } from '../../../api';
import type { BookingWithDetails } from '../../../types';
import type { ApiNotificationSeverity } from '../../../utils/apiNotifications';
import { errorMessage } from '../../../utils/errorMessage';

interface UseBookingNotesParams {
  reload: () => Promise<void> | void;
  showSnackbar: (message: string, severity: ApiNotificationSeverity) => void;
}

interface StoppableEvent {
  stopPropagation: () => void;
}

export function useBookingNotes({ reload, showSnackbar }: UseBookingNotesParams) {
  const [bookingNotesDialogOpen, setBookingNotesDialogOpen] = useState(false);
  const [bookingNotesEditBooking, setBookingNotesEditBooking] = useState<BookingWithDetails | null>(null);
  const [editedBookingNotes, setEditedBookingNotes] = useState('');
  const [editedCleaningPreference, setEditedCleaningPreference] = useState<boolean | null>(null);
  const [savingBookingNotes, setSavingBookingNotes] = useState(false);

  const openBookingNotes = useCallback((booking: BookingWithDetails, event?: StoppableEvent) => {
    event?.stopPropagation();
    setBookingNotesEditBooking(booking);
    setEditedBookingNotes(booking.remarks || booking.special_requests || '');
    setEditedCleaningPreference(booking.cleaning_preference ?? null);
    setBookingNotesDialogOpen(true);
  }, []);

  const closeBookingNotes = useCallback(() => {
    if (savingBookingNotes) return;
    setBookingNotesDialogOpen(false);
    setBookingNotesEditBooking(null);
    setEditedBookingNotes('');
    setEditedCleaningPreference(null);
  }, [savingBookingNotes]);

  const saveBookingNotes = useCallback(async () => {
    if (!bookingNotesEditBooking) return;

    setSavingBookingNotes(true);
    try {
      await BookingsService.updateBooking(bookingNotesEditBooking.id, {
        remarks: editedBookingNotes,
        cleaning_preference: editedCleaningPreference,
      });
      showSnackbar('Notes updated successfully', 'success');
      setBookingNotesDialogOpen(false);
      setBookingNotesEditBooking(null);
      setEditedBookingNotes('');
      setEditedCleaningPreference(null);
      await reload();
    } catch (error) {
      showSnackbar(errorMessage(error, 'Failed to update notes'), 'error');
    } finally {
      setSavingBookingNotes(false);
    }
  }, [bookingNotesEditBooking, editedBookingNotes, editedCleaningPreference, reload, showSnackbar]);

  return {
    bookingNotesDialogOpen,
    bookingNotesEditBooking,
    editedBookingNotes,
    setEditedBookingNotes,
    editedCleaningPreference,
    setEditedCleaningPreference,
    savingBookingNotes,
    openBookingNotes,
    closeBookingNotes,
    saveBookingNotes,
  };
}
