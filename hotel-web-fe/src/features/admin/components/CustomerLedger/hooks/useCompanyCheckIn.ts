import { useState } from 'react';
import { BookingsService, GuestsService, RoomsService } from '../../../../../api';
import { api } from '../../../../../api/client';
import type { Booking, BookingWithDetails, Company, Guest, Room } from '../../../../../types';
import { formatLocalDate, addLocalDays } from '../../../../../utils/date';
import { isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';
import type { ApiNotificationSeverity } from '../../../../../utils/apiNotifications';

// Sort rooms by room number ascending — shared with the page's ledger-room list.
export const sortRoomsByNumber = (roomList: Room[]) => {
  return [...roomList].sort((a, b) => {
    const numA = parseInt(a.room_number, 10);
    const numB = parseInt(b.room_number, 10);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return a.room_number.localeCompare(b.room_number);
  });
};

const EMPTY_GUEST_FORM = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  ic_number: '',
  tourism_type: 'local',
  nationality: '',
  address_line1: '',
  city: '',
  state_province: '',
  postal_code: '',
  country: '',
};

interface UseCompanyCheckInParams {
  showSnackbar: (message: string, severity?: ApiNotificationSeverity) => void;
  // Runs after a successful check-in: ledger rows, company list, and the
  // active-bookings strip all refresh — the page owns those loaders.
  reloadWorkspace: () => Promise<void>;
}

export function useCompanyCheckIn({ showSnackbar, reloadWorkspace }: UseCompanyCheckInParams) {
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [companyBookings, setCompanyBookings] = useState<BookingWithDetails[]>([]);
  const [checkInCompany, setCheckInCompany] = useState<Company | null>(null);
  const [checkInGuest, setCheckInGuest] = useState<Guest | null>(null);
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [checkInRoomRate, setCheckInRoomRate] = useState('');
  const [checkInDate, setCheckInDate] = useState<string>(formatLocalDate());
  const [checkOutDate, setCheckOutDate] = useState<string>(() => formatLocalDate(addLocalDays(new Date(), 1)));
  const [processingCheckIn, setProcessingCheckIn] = useState(false);
  const [isCreatingNewCheckInGuest, setIsCreatingNewCheckInGuest] = useState(false);
  const [newCheckInGuestForm, setNewCheckInGuestForm] = useState(EMPTY_GUEST_FORM);

  // Load guests for check-in
  const loadGuests = async () => {
    try {
      const guestsData = await GuestsService.getAllGuests();
      setGuests(guestsData.sort((a, b) => a.nick_name.localeCompare(b.nick_name)));
    } catch (err) {
      console.error('Failed to load guests:', err);
    }
  };

  // Load available rooms for given dates
  const loadAvailableRooms = async (checkIn: string, checkOut: string) => {
    try {
      const rooms = await RoomsService.getAvailableRoomsForDates(checkIn, checkOut);
      setAvailableRooms(sortRoomsByNumber(rooms));
    } catch (err) {
      console.error('Failed to load available rooms:', err);
      setAvailableRooms([]);
    }
  };

  // Load bookings for a specific company
  const loadCompanyBookings = async (companyId: number) => {
    try {
      const allBookings = await BookingsService.getBookingsWithDetails();
      const filtered = allBookings.filter(b => b.company_id === companyId);
      setCompanyBookings(filtered);
    } catch (err) {
      console.error('Failed to load company bookings:', err);
      setCompanyBookings([]);
    }
  };

  // Handle opening company check-in dialog
  const handleOpenCheckInDialog = async (company?: Company) => {
    setCheckInDialogOpen(true);
    if (company) {
      setCheckInCompany(company);
      await loadCompanyBookings(company.id);
    }
    await loadAvailableRooms(checkInDate, checkOutDate);
  };

  // Company selection from the check-in Autocomplete. Loads that company's
  // bookings (API) on select — kept page-side so the dialog stays presentational.
  const handleCheckInCompanyChange = (newValue: Company | null) => {
    setCheckInCompany(newValue);
    if (newValue) {
      loadCompanyBookings(newValue.id);
    } else {
      setCompanyBookings([]);
    }
  };

  // Reset check-in form
  const resetCheckInForm = () => {
    setCheckInCompany(null);
    setCheckInGuest(null);
    setCheckInRoom(null);
    setCheckInRoomRate('');
    setCheckInDate(formatLocalDate());
    setCheckOutDate(formatLocalDate(addLocalDays(new Date(), 1)));
    setIsCreatingNewCheckInGuest(false);
    setNewCheckInGuestForm(EMPTY_GUEST_FORM);
    setCompanyBookings([]);
  };

  // Handle company check-in
  const handleCompanyCheckIn = async () => {
    if (!checkInCompany || !checkInRoom) {
      showSnackbar('Please select a company and room', 'warning');
      return;
    }

    const customRoomRateInput = checkInRoomRate.trim();
    const roomRateOverride = customRoomRateInput ? toMoneyNumber(customRoomRateInput) : undefined;
    if (roomRateOverride !== undefined && !isPositiveMoney(roomRateOverride)) {
      showSnackbar('Please enter a valid room rate', 'warning');
      return;
    }

    try {
      setProcessingCheckIn(true);

      let guestToUse = checkInGuest;

      // Create new guest if needed
      if (isCreatingNewCheckInGuest) {
        if (!newCheckInGuestForm.first_name || !newCheckInGuestForm.last_name) {
          showSnackbar('Please enter guest first and last name', 'warning');
          setProcessingCheckIn(false);
          return;
        }

        if (!newCheckInGuestForm.ic_number.trim()) {
          showSnackbar('Please enter IC/Passport number for the guest', 'warning');
          setProcessingCheckIn(false);
          return;
        }

        // Email and phone are optional — online bookings often arrive without
        // either, and contact details are collected at check-in. Do not block.

        // Validate email format only if provided
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (newCheckInGuestForm.email && newCheckInGuestForm.email.trim() && !emailRegex.test(newCheckInGuestForm.email)) {
          showSnackbar('Please enter a valid email address for the guest', 'warning');
          setProcessingCheckIn(false);
          return;
        }

        const newGuest = await GuestsService.createGuest({
          first_name: newCheckInGuestForm.first_name,
          last_name: newCheckInGuestForm.last_name,
          email: newCheckInGuestForm.email.trim() || undefined,
          phone: newCheckInGuestForm.phone.trim() || undefined,
          ic_number: newCheckInGuestForm.ic_number.trim() || undefined,
          tourism_type: (newCheckInGuestForm.tourism_type || 'local') as 'local' | 'foreign',
          nationality: newCheckInGuestForm.nationality.trim() || undefined,
          address_line1: newCheckInGuestForm.address_line1.trim() || undefined,
          city: newCheckInGuestForm.city.trim() || undefined,
          state_province: newCheckInGuestForm.state_province.trim() || undefined,
          postal_code: newCheckInGuestForm.postal_code.trim() || undefined,
          country: newCheckInGuestForm.country.trim() || undefined,
        });
        guestToUse = newGuest;
      }

      if (!guestToUse) {
        showSnackbar('Please select or create a guest', 'warning');
        setProcessingCheckIn(false);
        return;
      }

      // Get room_id - handle both 'id' and potential 'room_id' field names. The
      // `Room` type only ever declares `id`; `room_id` is a defensive fallback for
      // a differently-shaped payload that has never been observed from the API.
      const roomId = checkInRoom.id || (checkInRoom as unknown as { room_id?: string }).room_id;
      if (!roomId) {
        showSnackbar('Room ID not found. Please select a different room.', 'warning');
        setProcessingCheckIn(false);
        return;
      }

      // Create booking with company billing (bypass frontend date validation for back-dated entries)
      const guestId = typeof guestToUse.id === 'string' ? parseInt(guestToUse.id, 10) : guestToUse.id;
      const booking = await api.post('bookings', {
        json: {
          guest_id: guestId,
          room_id: roomId,
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          post_type: 'normal_stay',
          payment_status: 'unpaid',
          booking_remarks: `Company Billing: ${checkInCompany.company_name}`,
          room_rate_override: roomRateOverride,
        },
      }).json<Booking>();

      // Update booking with company info
      await BookingsService.updateBooking(booking.id, {
        company_id: checkInCompany.id,
        company_name: checkInCompany.company_name,
      });

      // Check in the guest
      await BookingsService.checkInGuest(booking.id, {});

      // For back-dated bookings: auto-checkout if check-out date is today or in the past.
      // Backend's auto_post_company_ledger handles the room_charge ledger row on the
      // checked_out transition (and dedupes via an EXISTS check), so no client-side post here.
      const today = formatLocalDate();
      if (checkOutDate <= today) {
        await BookingsService.updateBooking(booking.id, { status: 'checked_out' });
      }

      showSnackbar(`Guest ${guestToUse.nick_name} checked in to Room ${checkInRoom.room_number} (Company: ${checkInCompany.company_name})`);

      // Reset and close dialog
      setCheckInDialogOpen(false);
      resetCheckInForm();
      await reloadWorkspace();
    } catch (err) {
      console.error('Failed to perform company check-in:', err);
      showSnackbar(err instanceof Error && err.message ? err.message : 'Failed to perform company check-in', 'error');
    } finally {
      setProcessingCheckIn(false);
    }
  };

  // Handle date change and reload rooms
  const handleCheckInDateChange = async (newDate: string) => {
    setCheckInDate(newDate);
    await loadAvailableRooms(newDate, checkOutDate);
  };

  const handleCheckOutDateChange = async (newDate: string) => {
    setCheckOutDate(newDate);
    await loadAvailableRooms(checkInDate, newDate);
  };

  const closeCheckInDialog = () => {
    setCheckInDialogOpen(false);
    resetCheckInForm();
  };

  return {
    checkInDialogOpen,
    guests,
    availableRooms,
    companyBookings,
    checkInCompany,
    checkInGuest,
    checkInRoom,
    checkInRoomRate,
    checkInDate,
    checkOutDate,
    processingCheckIn,
    isCreatingNewCheckInGuest,
    newCheckInGuestForm,
    setCheckInGuest,
    setCheckInRoom,
    setCheckInRoomRate,
    setIsCreatingNewCheckInGuest,
    setNewCheckInGuestForm,
    loadGuests,
    handleOpenCheckInDialog,
    handleCheckInCompanyChange,
    handleCompanyCheckIn,
    resetCheckInForm,
    handleCheckInDateChange,
    handleCheckOutDateChange,
    closeCheckInDialog,
  };
}
