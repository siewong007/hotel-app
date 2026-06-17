import { useCallback, useEffect, useState } from 'react';
import { HotelAPIService } from '../../../api';
import type { Guest, Room } from '../../../types';
import type { GuestWithCredits } from '../components/RoomManagement/types';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import type { ApiNotificationSeverity } from '../../../utils/apiNotifications';
import {
  buildBlockedDateRangesForRoom,
  type BlockedDateRange,
  getCreditBookingDates,
  getTotalCreditsForRoom as getCreditsForRoomType,
  isDateBlockedByRanges,
} from '../utils/roomManagementUtils';

interface GuestCredits {
  guest_id: number;
  guest_name: string;
  total_nights: number;
  credits_by_room_type: {
    id: number;
    room_type_id: number;
    room_type_name: string;
    room_type_code: string;
    nights_available: number;
  }[];
}

interface CreditsBookingForm {
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
  special_requests: string;
}

interface CreditsBookingSuccess {
  booking_id: number;
  booking_number: string;
  complimentary_nights: number;
}

interface UseGuestCreditsWorkflowArgs {
  guests: Guest[];
  rooms: Room[];
  allBookings: { room_id?: string | number; check_in_date: string; check_out_date: string; status: string }[];
  reloadRooms: () => Promise<void> | void;
  reloadBookings: () => Promise<void> | void;
  showSnackbar: (message: string, severity: ApiNotificationSeverity) => void;
  onCloseMenu: () => void;
}

export function useGuestCreditsWorkflow({
  guests,
  rooms,
  allBookings,
  reloadRooms,
  reloadBookings,
  showSnackbar,
  onCloseMenu,
}: UseGuestCreditsWorkflowArgs) {
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const [guestCredits, setGuestCredits] = useState<GuestCredits | null>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [availableRoomsForCredits, setAvailableRoomsForCredits] = useState<Room[]>([]);
  const [creditsBookingForm, setCreditsBookingForm] = useState<CreditsBookingForm>({
    room_id: '',
    check_in_date: formatLocalDate(),
    check_out_date: formatLocalDate(addLocalDays(new Date(), 1)),
    adults: 1,
    children: 0,
    special_requests: '',
  });
  const [selectedComplimentaryDates, setSelectedComplimentaryDates] = useState<string[]>([]);
  const [bookingWithCredits, setBookingWithCredits] = useState(false);
  const [creditsBookingSuccess, setCreditsBookingSuccess] = useState<CreditsBookingSuccess | null>(null);
  const [roomBlockedDates, setRoomBlockedDates] = useState<BlockedDateRange[]>([]);
  const [guestsWithCredits] = useState<GuestWithCredits[]>([]);
  const [loadingGuestsWithCredits] = useState(false);

  const isDateBlocked = useCallback((dateStr: string): boolean => {
    return isDateBlockedByRanges(dateStr, roomBlockedDates);
  }, [roomBlockedDates]);

  useEffect(() => {
    if (roomBlockedDates.length === 0 || selectedComplimentaryDates.length === 0) return;

    const availableDates = selectedComplimentaryDates.filter(date => !isDateBlocked(date));
    if (availableDates.length !== selectedComplimentaryDates.length) {
      setSelectedComplimentaryDates(availableDates);
    }
  }, [isDateBlocked, roomBlockedDates.length, selectedComplimentaryDates]);

  const loadGuestCredits = useCallback(async (guestId: number) => {
    try {
      setLoadingCredits(true);
      const credits = await HotelAPIService.getGuestCredits(guestId);
      setGuestCredits(credits);
    } catch (error: any) {
      console.error('Error loading guest credits:', error);
    } finally {
      setLoadingCredits(false);
    }
  }, []);

  const openGuestDetails = useCallback((guestId: string | number) => {
    const guest = guests.find(candidate => candidate.id.toString() === guestId.toString());

    if (!guest) {
      showSnackbar(`Guest not found (ID: ${guestId})`, 'warning');
      return;
    }

    setSelectedGuest(guest);
    setTab(0);
    setGuestCredits(null);
    setCreditsBookingSuccess(null);
    setSelectedComplimentaryDates([]);
    setDialogOpen(true);
    onCloseMenu();
    void loadGuestCredits(guest.id);
  }, [guests, loadGuestCredits, onCloseMenu, showSnackbar]);

  const close = useCallback(() => setDialogOpen(false), []);

  const loadAvailableRoomsForCredits = useCallback(() => {
    setAvailableRoomsForCredits(rooms);
  }, [rooms]);

  const loadRoomBlockedDates = useCallback((roomId: string) => {
    setRoomBlockedDates(buildBlockedDateRangesForRoom(allBookings, roomId));
  }, [allBookings]);

  const getCreditsBookingDatesForForm = useCallback((): string[] => {
    return getCreditBookingDates(
      creditsBookingForm.check_in_date,
      creditsBookingForm.check_out_date,
    );
  }, [creditsBookingForm.check_in_date, creditsBookingForm.check_out_date]);

  const getTotalCreditsForRoom = useCallback((roomId: string): number => {
    return getCreditsForRoomType(guestCredits, availableRoomsForCredits, roomId);
  }, [availableRoomsForCredits, guestCredits]);

  const toggleDate = useCallback((date: string) => {
    if (isDateBlocked(date)) return;

    const maxCredits = getTotalCreditsForRoom(creditsBookingForm.room_id);
    if (selectedComplimentaryDates.includes(date)) {
      setSelectedComplimentaryDates(prev => prev.filter(selectedDate => selectedDate !== date));
    } else if (selectedComplimentaryDates.length < maxCredits) {
      setSelectedComplimentaryDates(prev => [...prev, date]);
    }
  }, [
    creditsBookingForm.room_id,
    getTotalCreditsForRoom,
    isDateBlocked,
    selectedComplimentaryDates,
  ]);

  const selectAllAvailable = useCallback(() => {
    const dates = getCreditsBookingDatesForForm();
    const maxCredits = getTotalCreditsForRoom(creditsBookingForm.room_id);
    const availableDates = dates.filter(date => !isDateBlocked(date));
    setSelectedComplimentaryDates(availableDates.slice(0, maxCredits));
  }, [
    creditsBookingForm.room_id,
    getCreditsBookingDatesForForm,
    getTotalCreditsForRoom,
    isDateBlocked,
  ]);

  const bookWithCreditsAndCheckIn = useCallback(async () => {
    if (!selectedGuest || !creditsBookingForm.room_id || selectedComplimentaryDates.length === 0) {
      showSnackbar('Please select a room and at least one complimentary date', 'warning');
      return;
    }

    try {
      setBookingWithCredits(true);
      const result = await HotelAPIService.bookWithCredits({
        guest_id: selectedGuest.id,
        room_id: parseInt(creditsBookingForm.room_id, 10),
        check_in_date: creditsBookingForm.check_in_date,
        check_out_date: creditsBookingForm.check_out_date,
        adults: creditsBookingForm.adults,
        children: creditsBookingForm.children,
        special_requests: creditsBookingForm.special_requests,
        complimentary_dates: selectedComplimentaryDates,
      });

      setCreditsBookingSuccess({
        booking_id: result.booking_id,
        booking_number: result.booking_number,
        complimentary_nights: result.complimentary_nights,
      });

      showSnackbar(`Booking created successfully! ${result.complimentary_nights} night(s) are complimentary.`, 'success');
      void loadGuestCredits(selectedGuest.id);
      void reloadRooms();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to book with credits', 'error');
    } finally {
      setBookingWithCredits(false);
    }
  }, [
    creditsBookingForm,
    loadGuestCredits,
    reloadRooms,
    selectedComplimentaryDates,
    selectedGuest,
    showSnackbar,
  ]);

  const checkInFromCreditsBooking = useCallback(async () => {
    if (!creditsBookingSuccess) return;

    try {
      await HotelAPIService.checkInGuest(creditsBookingSuccess.booking_id.toString());
      showSnackbar('Guest checked in successfully!', 'success');
      setDialogOpen(false);
      void reloadRooms();
      void reloadBookings();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to check in guest', 'error');
    }
  }, [creditsBookingSuccess, reloadBookings, reloadRooms, showSnackbar]);

  const changeTab = useCallback((value: number) => {
    setTab(value);
    if (value === 1) {
      loadAvailableRoomsForCredits();
    }
  }, [loadAvailableRoomsForCredits]);

  const updateForm = useCallback((patch: Partial<CreditsBookingForm>) => {
    setCreditsBookingForm(prev => ({ ...prev, ...patch }));
  }, []);

  const changeCheckInDate = useCallback((value: string) => {
    updateForm({ check_in_date: value });
    setSelectedComplimentaryDates([]);
  }, [updateForm]);

  const changeCheckOutDate = useCallback((value: string) => {
    updateForm({ check_out_date: value });
    setSelectedComplimentaryDates([]);
  }, [updateForm]);

  const changeRoom = useCallback((value: string) => {
    updateForm({ room_id: value });
    setSelectedComplimentaryDates([]);
    setRoomBlockedDates([]);
    if (value) {
      loadRoomBlockedDates(value);
    }
  }, [loadRoomBlockedDates, updateForm]);

  const bookAnother = useCallback(() => {
    setCreditsBookingSuccess(null);
    setSelectedComplimentaryDates([]);
  }, []);

  return {
    dialogOpen,
    close,
    selectedGuest,
    tab,
    changeTab,
    guestCredits,
    loadingCredits,
    creditsBookingSuccess,
    creditsBookingForm,
    availableRoomsForCredits,
    roomBlockedDates,
    selectedComplimentaryDates,
    bookingWithCredits,
    guestsWithCredits,
    loadingGuestsWithCredits,
    openGuestDetails,
    getCreditsBookingDates: getCreditsBookingDatesForForm,
    getTotalCreditsForRoom,
    isDateBlocked,
    checkInFromCreditsBooking,
    bookAnother,
    changeCheckInDate,
    changeCheckOutDate,
    changeRoom,
    changeAdults: (value: number) => updateForm({ adults: value }),
    changeChildren: (value: number) => updateForm({ children: value }),
    selectAllAvailable,
    toggleDate,
    bookWithCreditsAndCheckIn,
  };
}
