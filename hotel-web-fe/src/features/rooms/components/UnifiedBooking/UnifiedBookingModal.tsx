import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Dialog, Alert, AlertTitle, Button } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Room, Guest, Booking, BookingCreateRequest, RoomType, CheckInAdvisory } from '../../../../types';
import { BookingsService, GuestsService } from '../../../../api';
import { useCurrency } from '../../../../hooks/useCurrency';
import { useRoomAvailabilityCheck } from '../../../../hooks/useRoomAvailabilityCheck';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { addLocalDays, formatLocalDate, parseLocalDate } from '../../../../utils/date';
import { isPositiveMoney, multiplyMoney, sumMoney, toMoneyNumber } from '../../../../utils/money';
import { useUnifiedBookingData } from '../../hooks/useUnifiedBookingData';
import { isValidEmail } from '../../../../utils/validation';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { useTranslation } from '../../../../i18n/useTranslation';
import { dateFormatter } from '../../../../i18n/format';
import GuestSelector, { NewGuestForm, GuestWithCredits, emptyNewGuestForm } from '../GuestSelector';
import { canCoverRoomsWithCredits, type RoomCreditBucket } from '../../utils/roomManagementUtils';
import { buildBookingTokens } from './bookingTokens';
import BookingModalHeader from './components/BookingModalHeader';
import BookingSummaryAside from './components/BookingSummaryAside';
import BookingModalFooter from './components/BookingModalFooter';
import RoomPickerSection from './components/RoomPickerSection';
import BookingModeSelector from './components/BookingModeSelector';
import ReservationTypeSection from './components/ReservationTypeSection';
import StaySection from './components/StaySection';
import RatePaymentSection from './components/RatePaymentSection';
import NotesSection from './components/NotesSection';
import CollapsibleSection from '../../../../components/common/CollapsibleSection';

import type { BookingType, BookingMode, ReservationType } from './bookingTypes';
import { errorMessage } from '../../../../utils/errorMessage';
export type { BookingType, BookingMode };

interface UnifiedBookingModalProps {
  open: boolean;
  onClose: () => void;
  room?: Room | null;  // Optional - if not provided, room selection step will be shown
  rooms?: Room[];      // Legacy caller prop; selection uses date-filtered availability
  guests: Guest[];
  initialGuest?: Guest | null;
  initialBookingType?: BookingType;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onBookingCreated?: (booking: Booking & { room_number?: string }, guest: Guest) => void; // For direct booking to open enhanced check-in
  onRefreshData: () => Promise<void>;
}

const getCreditNights = (credit: RoomCreditBucket | undefined): number => {
  const nights = Number(credit?.nights_available ?? 0);
  return Number.isFinite(nights) ? nights : 0;
};

const getGuestCreditRoomTypeLabels = (guest: GuestWithCredits | null, fallback: string): string => {
  if (!guest) return '';

  return guest.credits_by_room_type
    .filter((credit) => getCreditNights(credit) > 0)
    .map((credit) => credit.room_type_name || credit.room_type_code || fallback)
    .join(', ');
};

// Phone and IC/passport are optional at booking creation — both are collected
// at check-in. Online bookings frequently arrive without a contact number, so we
// must not block booking creation on it. Instead, surface a non-blocking,
// informational nudge encouraging staff to complete the phone number at check-in.
const notifyIfGuestContactIncomplete = (
  guest: Pick<NewGuestForm, 'phone'>,
  message: string
): void => {
  if (!guest.phone.trim()) {
    emitApiNotification({
      message,
      severity: 'info',
    });
  }
};

const UnifiedBookingModal: React.FC<UnifiedBookingModalProps> = ({
  open,
  onClose,
  room: roomProp,
  guests,
  initialGuest = null,
  initialBookingType,
  onSuccess,
  onBookingCreated,
  onRefreshData,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('rooms');
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();

  // Memoize hotel settings to prevent unnecessary re-renders
  const hotelSettings = useMemo(() => getHotelSettings(), []);
  const BOOKING_CHANNELS = hotelSettings.booking_channels;

  // Determine if we need room selection (when room is not pre-selected)
  const needsRoomSelection = !roomProp;

  const {
    guestsWithCredits,
    loadingGuestsWithCredits,
    availableRooms,
    setAvailableRooms,
    loadingAvailableRooms,
    roomTypeConfig,
    setRoomTypeConfig,
    loadGuestsWithCredits,
    loadAvailableRooms,
    loadRoomTypeConfig,
  } = useUnifiedBookingData();

  // Booking mode / reservation-type state
  const [bookingMode, setBookingMode] = useState<BookingMode | null>(null);
  const [reservationType, setReservationType] = useState<ReservationType | null>(null);

  // Guest state
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [newGuestForm, setNewGuestForm] = useState<NewGuestForm>(emptyNewGuestForm);
  const [isCreatingNewGuest, setIsCreatingNewGuest] = useState(false);
  const [selectedGuestWithCredits, setSelectedGuestWithCredits] = useState<GuestWithCredits | null>(null);
  // Confirm-company-check-in advisory for the selected existing guest (keyed on
  // their company-billing history; see checkin_advisory backend).
  const [guestAdvisory, setGuestAdvisory] = useState<CheckInAdvisory | null>(null);
  // Company billing attached inline in response to the advisory. When set, the
  // created booking(s) carry this company_id/company_name (city-ledger billing).
  const [companyBilling, setCompanyBilling] = useState<{ id?: number; name: string } | null>(null);

  // Booking details state
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [numberOfNights, setNumberOfNights] = useState(1);
  const [isHourlyBooking, setIsHourlyBooking] = useState(false);
  const [bookingChannel, setBookingChannel] = useState('');
  const [bookingReference, setBookingReference] = useState('');

  // Booking notes
  const [bookingNotes, setBookingNotes] = useState('');

  // Custom rate override state
  const [useCustomRate, setUseCustomRate] = useState(false);
  const [customRate, setCustomRate] = useState<number>(0);

  // Tourism tax - derived from guest's tourism_type
  // Foreign tourism = tax applies, Local tourism = no tax
  const getIsForeignTourist = (): boolean => {
    if (isCreatingNewGuest) {
      return newGuestForm.tourism_type === 'foreign';
    }
    return selectedGuest?.tourism_type === 'foreign';
  };
  const isTourist = getIsForeignTourist();

  // Fetch the company check-in advisory whenever an existing guest is selected.
  // New (unsaved) guests have no history, so skip them.
  useEffect(() => {
    // Switching guest clears any company billing attached for the previous one.
    setCompanyBilling(null);
    if (isCreatingNewGuest || !selectedGuest?.id) {
      setGuestAdvisory(null);
      return;
    }
    let cancelled = false;
    BookingsService.getGuestCheckInAdvisory(selectedGuest.id)
      .then((advisory) => {
        if (!cancelled) setGuestAdvisory(advisory);
      })
      .catch(() => {
        if (!cancelled) setGuestAdvisory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGuest?.id, isCreatingNewGuest]);

  // Extra bed state
  const [extraBedCount, setExtraBedCount] = useState(0);
  const [extraBedCharge, setExtraBedCharge] = useState(0);

  // Processing state
  const [processing, setProcessing] = useState(false);

  // Surface validation/submit errors as a floating top-right notification via
  // the global ApiNotificationHost snackbar (it portals above the modal, so the
  // user always sees it). `warning` (deep yellow) is used for required-field /
  // validation messages; `error` (red) for actual booking/server failures.
  const reportError = (message: string, severity: 'warning' | 'error' = 'warning') => {
    emitApiNotification({ message, severity });
  };

  // Room selection state (when room is not pre-selected)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedRooms, setSelectedRooms] = useState<Room[]>([]);

  // Use selected room or prop room
  const selectedBookingRooms = useMemo(() => {
    if (roomProp) return [roomProp];
    if (selectedRooms.length > 0) return selectedRooms;
    return selectedRoom ? [selectedRoom] : [];
  }, [roomProp, selectedRoom, selectedRooms]);
  const room = roomProp || selectedBookingRooms[0] || null;
  const roomCount = selectedBookingRooms.length;
  const selectedRoomNumbers = selectedBookingRooms.map((r) => r.room_number).join(', ');

  // Check availability when room is pre-selected and dates change
  const { isAvailable: roomIsAvailable, isChecking: checkingAvailability } = useRoomAvailabilityCheck(
    roomProp?.id ?? null,
    checkInDate,
    checkOutDate,
    !!roomProp
  );

  // Track previous open state to detect true open/close transitions
  const wasOpenRef = useRef(false);
  // Track if modal is currently initializing to prevent race conditions
  const isInitializingRef = useRef(false);


  // Derived extra bed config from room type
  const allowsExtraBed = roomTypeConfig?.allows_extra_bed ?? false;
  const maxExtraBeds = roomTypeConfig?.max_extra_beds ?? 0;
  const extraBedChargePerBed = roomTypeConfig
    ? toMoneyNumber(roomTypeConfig.extra_bed_charge)
    : 0;

  // Load room type config when room changes
  useEffect(() => {
    if (room?.room_type && open) {
      loadRoomTypeConfig(room.room_type);
    }
  }, [room?.room_type, open, loadRoomTypeConfig]);

  // Reset form when modal opens/closes - use proper transition detection
  // IMPORTANT: Only depends on `open` to prevent unexpected resets
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    // Only run initialization when transitioning from closed to open
    if (open && !wasOpen) {
      // Prevent multiple concurrent initializations
      if (isInitializingRef.current) return;
      isInitializingRef.current = true;

      // Set defaults for new modal session
      const today = formatLocalDate();
      const tomorrow = formatLocalDate(addLocalDays(today, 1));

      // Batch all state resets together using functional updates.
      // Defaults match the New Booking · Light design (Reservation + Online).
      setBookingMode('reservation');
      setReservationType('online');
      setSelectedGuest(initialGuest);
      setNewGuestForm(emptyNewGuestForm);
      setIsCreatingNewGuest(false);
      setSelectedGuestWithCredits(null);
      setCheckInDate(today);
      setCheckOutDate(tomorrow);
      setNumberOfNights(1);
      setIsHourlyBooking(false);
      setBookingChannel('');
      setBookingReference('');
      setUseCustomRate(false);
      setCustomRate(0);
      setExtraBedCount(0);
      setExtraBedCharge(0);
      setBookingNotes('');
      setRoomTypeConfig(null);
      setSelectedRoom(null);
      setSelectedRooms([]);
      setAvailableRooms([]);

      // Mark initialization complete after a microtask to ensure state has settled
      Promise.resolve().then(() => {
        isInitializingRef.current = false;
      });
    }

    // Only run cleanup when transitioning from open to closed
    if (!open && wasOpen) {
      // Reset state when closing (for cleanup)
      setBookingMode(null);
      setReservationType(null);
      setSelectedGuest(null);
      setNewGuestForm(emptyNewGuestForm);
      setIsCreatingNewGuest(false);
      setSelectedGuestWithCredits(null);
      setCheckInDate('');
      setCheckOutDate('');
      setNumberOfNights(1);
      setIsHourlyBooking(false);
      setBookingChannel('');
      setBookingReference('');
      setUseCustomRate(false);
      setCustomRate(0);
      setExtraBedCount(0);
      setExtraBedCharge(0);
      setBookingNotes('');
      setRoomTypeConfig(null);
      setSelectedRoom(null);
      setSelectedRooms([]);
      setAvailableRooms([]);
    }
  }, [open, initialGuest, setAvailableRooms, setRoomTypeConfig]);

  // Sort rooms by room number ascending
  const sortRoomsByNumber = (roomList: Room[]) => {
    return [...roomList].sort((a, b) => {
      const numA = parseInt(a.room_number, 10);
      const numB = parseInt(b.room_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.room_number.localeCompare(b.room_number);
    });
  };

  // Fetch available rooms when dates change (for room selection mode)
  useEffect(() => {
    if (!needsRoomSelection || !checkInDate || !checkOutDate) return;
    loadAvailableRooms(checkInDate, checkOutDate, sortRoomsByNumber);
  }, [needsRoomSelection, checkInDate, checkOutDate, loadAvailableRooms]);

  useEffect(() => {
    if (!needsRoomSelection || loadingAvailableRooms || !checkInDate || !checkOutDate) return;

    const availableIds = new Set(availableRooms.map((availableRoom) => String(availableRoom.id)));
    setSelectedRooms((prev) => {
      const filtered = prev.filter((selected) => availableIds.has(String(selected.id)));
      setSelectedRoom(filtered[0] || null);
      return filtered;
    });
  }, [availableRooms, checkInDate, checkOutDate, loadingAvailableRooms, needsRoomSelection]);

  // Load guests with credits when complimentary reservation is selected
  useEffect(() => {
    if (reservationType === 'complimentary' && open) {
      loadGuestsWithCredits();
    }
  }, [reservationType, open, loadGuestsWithCredits]);

  // Calculate nights when dates change
  const handleDateChange = (field: 'checkIn' | 'checkOut', value: string) => {
    if (field === 'checkIn') {
      setCheckInDate(value);
      if (isHourlyBooking) {
        setCheckOutDate(value);
        setNumberOfNights(1);
      } else if (checkOutDate) {
        const nights = Math.max(1, Math.ceil((new Date(checkOutDate).getTime() - new Date(value).getTime()) / (1000 * 60 * 60 * 24)));
        setNumberOfNights(nights);
      }
    } else {
      setCheckOutDate(value);
      if (checkInDate) {
        const nights = Math.max(1, Math.ceil((new Date(value).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24)));
        setNumberOfNights(nights);
      }
    }
  };

  // Handle hourly booking toggle
  const handleHourlyToggle = (checked: boolean) => {
    setIsHourlyBooking(checked);
    if (checked) {
      // Set checkout to same day as check-in
      setCheckOutDate(checkInDate);
      setNumberOfNights(1);
    } else {
      // Reset to next day
      if (checkInDate) {
        const nextDayStr = formatLocalDate(addLocalDays(checkInDate, 1));
        setCheckOutDate(nextDayStr);
        setNumberOfNights(1);
      }
    }
  };


  // Create booking and hand off to EnhancedCheckInModal (for direct booking)
  const createBookingAndHandOff = async () => {
    if (!room) {
      reportError(t('unified.errNoRoom'));
      return;
    }

    setProcessing(true);

    try {
      let guestToUse: Guest | null = null;

      // Create new guest if needed
      if (isCreatingNewGuest) {
        // Fast booking: a name is all that is strictly needed. Last name, email,
        // phone and IC are optional and collected at check-in.
        if (!newGuestForm.first_name.trim()) {
          reportError(t('unified.errGuestName'));
          setProcessing(false);
          return;
        }

        // Tourism type is never defaulted — it decides whether tourism tax is
        // charged, so it must be an explicit staff choice.
        if (!newGuestForm.tourism_type) {
          reportError(t('unified.errTourismType'));
          setProcessing(false);
          return;
        }

        notifyIfGuestContactIncomplete(newGuestForm, t('unified.noPhoneHint'));
        const tourismType = newGuestForm.tourism_type;

        if (newGuestForm.email && newGuestForm.email.trim() && !isValidEmail(newGuestForm.email)) {
          reportError(t('validation:email'));
          setProcessing(false);
          return;
        }

        // Check for duplicate guest name. Built the same way the backend builds
        // `full_name` (join then trim), so a single-name guest matches correctly.
        const modalDisplayName = [newGuestForm.first_name.trim(), newGuestForm.last_name.trim()]
          .filter(Boolean)
          .join(' ');
        const modalFullName = modalDisplayName.toLowerCase();
        const existingGuestByName = guests.find(g => g.nick_name.toLowerCase().trim() === modalFullName);
        if (existingGuestByName) {
          reportError(t('unified.errDuplicateGuestName', { name: modalDisplayName }));
          setProcessing(false);
          return;
        }

        // Check for duplicate email
        if (newGuestForm.email && newGuestForm.email.trim()) {
          const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newGuestForm.email.toLowerCase());
          if (existingGuest) {
            reportError(t('unified.errDuplicateGuestEmail', { email: newGuestForm.email }));
            setProcessing(false);
            return;
          }
        }

        const newGuest = await GuestsService.createGuest({
          first_name: newGuestForm.first_name,
          last_name: newGuestForm.last_name,
          email: newGuestForm.email.trim() || undefined,
          phone: newGuestForm.phone.trim() || undefined,
          ic_number: newGuestForm.ic_number.trim() || undefined,
          nationality: newGuestForm.nationality.trim() || undefined,
          tourism_type: tourismType,
          guest_type: newGuestForm.guest_type || 'non_member',
          company_name: newGuestForm.company_name || undefined,
          address_line1: newGuestForm.address_line1 || undefined,
          city: newGuestForm.city || undefined,
          state_province: newGuestForm.state_province || undefined,
          postal_code: newGuestForm.postal_code || undefined,
          country: newGuestForm.country || undefined,
        });

        guestToUse = newGuest;
      } else {
        guestToUse = selectedGuest;
      }

      if (!guestToUse) {
        reportError(t('unified.errSelectGuest'));
        setProcessing(false);
        return;
      }

      const isMember = guestToUse.guest_type === 'member';

      // Build booking remarks based on guest type
      const getBookingRemarks = () => {
        const hourlyTag = isHourlyBooking ? ' [Hourly Stay]' : '';
        if (isMember) {
          return `Walk-In Guest (Member)${hourlyTag}`;
        } else {
          return `Walk-In Guest${hourlyTag}`;
        }
      };

      const remarks = [getBookingRemarks(), bookingNotes.trim()].filter(Boolean).join(' | ');
      const bookingData: Omit<BookingCreateRequest, 'room_id'> = {
        guest_id: guestToUse.id,
        check_in_date: checkInDate,
        check_out_date: isHourlyBooking ? checkInDate : checkOutDate,
        number_of_guests: 1,
        post_type: (isHourlyBooking ? 'hourly' : 'normal_stay') as 'normal_stay' | 'same_day' | 'hourly',
        booking_remarks: remarks,
        special_requests: bookingNotes.trim() || undefined,
        source: 'walk_in' as const,
        payment_status: 'unpaid' as const,
        room_rate_override: useCustomRate && isPositiveMoney(customRate) ? customRate : undefined,
        extra_bed_count: extraBedCount > 0 ? extraBedCount : undefined,
        extra_bed_charge: isPositiveMoney(extraBedCharge) ? extraBedCharge : undefined,
      };

      const [createdBookingResult] = await createBookingsForSelectedRooms(bookingData);

      // Create booking object for EnhancedCheckInModal
      const bookingForCheckIn: Booking = {
        id: createdBookingResult.id,
        guest_id: guestToUse.id.toString(),
        room_id: room.id,
        room_type: room.room_type,
        check_in_date: createdBookingResult.check_in_date,
        check_out_date: createdBookingResult.check_out_date,
        total_amount: createdBookingResult.total_amount,
        status: createdBookingResult.status,
        folio_number: createdBookingResult.folio_number || `WALKIN-${createdBookingResult.id}`,
        market_code: 'Walk-In',
        rate_code: 'RACK',
        post_type: createdBookingResult.post_type,
        created_at: createdBookingResult.created_at,
        updated_at: createdBookingResult.updated_at,
        is_tourist: isTourist,
        tourism_tax_amount: createdBookingResult.tourism_tax_amount || (isPositiveMoney(tourismTaxAmount) ? tourismTaxAmount : undefined),
        source: 'walk_in',
      };

      // Add room_number to booking for EnhancedCheckInModal display. Booking
      // itself has no room column (rooms join by room_id), so the hand-off
      // type carries it as an explicit optional overlay.
      const bookingWithRoom: Booking & { room_number?: string } = {
        ...bookingForCheckIn,
        room_number: room.room_number,
      };

      // Hand off to EnhancedCheckInModal
      if (onBookingCreated) {
        onBookingCreated(bookingWithRoom, guestToUse);
      }
      onClose();
      await onRefreshData();
    } catch (error) {
      reportError(errorMessage(error, t('errors.createBooking')), 'error');
    } finally {
      setProcessing(false);
    }
  };


  // Handle mode selection (Step 0)
  const handleModeSelect = (mode: BookingMode) => {
    // Guard against selection during processing or initialization
    if (processing || isInitializingRef.current) return;

    // Only change if actually different to prevent unnecessary re-renders
    if (mode === bookingMode) return;

    setBookingMode(mode);
    // Reset dependent state
    setReservationType(null);
    setSelectedGuest(null);
    setSelectedGuestWithCredits(null);
    setIsCreatingNewGuest(false);
    setNewGuestForm(emptyNewGuestForm);
  };

  // Handle reservation type selection (Step 1 for reservation mode)
  const handleReservationTypeSelect = (type: ReservationType) => {
    // Guard against selection during processing or initialization
    if (processing || isInitializingRef.current) return;

    // Only change if actually different
    if (type === reservationType) return;

    setReservationType(type);
    // Reset guest state when changing type
    setSelectedGuest(null);
    setSelectedGuestWithCredits(null);
    setIsCreatingNewGuest(false);
    setNewGuestForm(emptyNewGuestForm);
  };

  // Handle toggle between existing guest and new guest mode
  const handleToggleGuestMode = (isNew: boolean) => {
    setIsCreatingNewGuest(isNew);
  };

  // Get effective booking type for submission (combines mode + reservation type)
  const getEffectiveBookingType = (): 'walk_in' | 'online' | 'complimentary' | null => {
    if (bookingMode === 'direct') {
      return 'walk_in'; // Direct booking uses walk_in flow but checks in immediately
    }
    return reservationType;
  };

  const createBookingsForSelectedRooms = async (
    bookingData: Omit<BookingCreateRequest, 'room_id'>
  ): Promise<Booking[]> => {
    if (selectedBookingRooms.length === 0) {
      throw new Error(t('unified.errNoRoom'));
    }

    const multiRoomNote = selectedBookingRooms.length > 1
      ? `Multi-room booking (${selectedBookingRooms.length} rooms: ${selectedRoomNumbers})`
      : '';

    const createdBookings: Booking[] = [];
    for (const [index, bookingRoom] of selectedBookingRooms.entries()) {
      const bookingRemarks = [
        bookingData.booking_remarks,
        multiRoomNote,
      ].filter(Boolean).join(' | ');

      const created = await BookingsService.createBooking({
        ...bookingData,
        room_id: String(bookingRoom.id),
        booking_remarks: bookingRemarks || undefined,
        extra_bed_count: index === 0 ? bookingData.extra_bed_count : undefined,
        extra_bed_charge: index === 0 ? bookingData.extra_bed_charge : undefined,
        // Inline company billing attached via the check-in advisory, if any.
        ...(companyBilling
          ? { company_id: companyBilling.id, company_name: companyBilling.name }
          : {}),
      });
      createdBookings.push(created);
    }

    return createdBookings;
  };

  // Submit booking
  const handleSubmit = async () => {
    // Handle direct booking: create booking and hand off to EnhancedCheckInModal
    if (bookingMode === 'direct') {
      await createBookingAndHandOff();
      return;
    }

    if (!room) {
      reportError(t('unified.errNoRoom'));
      return;
    }

    const effectiveType = getEffectiveBookingType();
    if (!effectiveType) {
      reportError(t('unified.errSelectType'));
      return;
    }

    setProcessing(true);

    try {
      let guestToUse: Guest | null = null;

      // Create new guest if needed (for walk-in and online)
      if (effectiveType !== 'complimentary') {
        if (isCreatingNewGuest) {
          // Fast booking: see the reservation path above — only a name is required.
          if (!newGuestForm.first_name.trim()) {
            reportError(t('unified.errGuestName'));
            setProcessing(false);
            return;
          }

          if (!newGuestForm.tourism_type) {
            reportError(t('unified.errTourismType'));
            setProcessing(false);
            return;
          }

          notifyIfGuestContactIncomplete(newGuestForm, t('unified.noPhoneHint'));
          const tourismType = newGuestForm.tourism_type;

          if (newGuestForm.email && newGuestForm.email.trim() && !isValidEmail(newGuestForm.email)) {
            reportError(t('validation:email'));
            setProcessing(false);
            return;
          }

          // Check for duplicate email
          if (newGuestForm.email && newGuestForm.email.trim()) {
            const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newGuestForm.email.toLowerCase());
            if (existingGuest) {
              reportError(t('unified.errDuplicateGuestEmail', { email: newGuestForm.email }));
              setProcessing(false);
              return;
            }
          }

          const newGuest = await GuestsService.createGuest({
            first_name: newGuestForm.first_name,
            last_name: newGuestForm.last_name,
            email: newGuestForm.email.trim() || undefined,
            phone: newGuestForm.phone.trim() || undefined,
            ic_number: newGuestForm.ic_number.trim() || undefined,
            nationality: newGuestForm.nationality.trim() || undefined,
            tourism_type: tourismType,
            guest_type: newGuestForm.guest_type || 'non_member',
            company_name: newGuestForm.company_name || undefined,
          });

          guestToUse = newGuest;
        } else {
          guestToUse = selectedGuest;
        }

        if (!guestToUse) {
          reportError(t('unified.errSelectGuest'));
          setProcessing(false);
          return;
        }
      }

      // Create booking based on type (only for reservation mode, not direct booking)
      switch (effectiveType) {
        case 'walk_in': {
          // For reservation mode walk-in (direct booking handled via Check-In step now)
          const isMember = guestToUse!.guest_type === 'member';

          // Build booking remarks based on guest type
          const getRemarks = () => {
            const hourlyTag = isHourlyBooking ? ' [Hourly Stay]' : '';
            if (isMember) {
              return `Walk-In Guest (Member)${hourlyTag}`;
            } else {
              return `Walk-In Guest${hourlyTag}`;
            }
          };

          const remarksStr = [getRemarks(), bookingNotes.trim()].filter(Boolean).join(' | ');
          const bookingData: Omit<BookingCreateRequest, 'room_id'> = {
            guest_id: guestToUse!.id,
            check_in_date: checkInDate,
            check_out_date: isHourlyBooking ? checkInDate : checkOutDate,
            number_of_guests: 1,
            post_type: (isHourlyBooking ? 'hourly' : 'normal_stay') as 'normal_stay' | 'same_day' | 'hourly',
            booking_remarks: remarksStr,
            special_requests: bookingNotes.trim() || undefined,
            source: 'walk_in' as const,
            payment_status: 'unpaid' as const,
            room_rate_override: useCustomRate && isPositiveMoney(customRate) ? customRate : undefined,
            extra_bed_count: extraBedCount > 0 ? extraBedCount : undefined,
            extra_bed_charge: isPositiveMoney(extraBedCharge) ? extraBedCharge : undefined,
          };

          await createBookingsForSelectedRooms(bookingData);

          onSuccess(
            roomCount > 1
              ? t('unified.successMulti', { guest: guestToUse!.nick_name, rooms: selectedRoomNumbers })
              : t('unified.successSingle', { guest: guestToUse!.nick_name, room: room.room_number })
          );
          onClose();
          await onRefreshData();
          break;
        }

        case 'online': {
          const onlineRemarks = [
            bookingReference ? `${bookingChannel} - Ref: ${bookingReference}` : `${bookingChannel} Booking`,
            bookingNotes.trim(),
          ].filter(Boolean).join(' | ');
          const bookingData: Omit<BookingCreateRequest, 'room_id'> = {
            guest_id: guestToUse!.id,
            check_in_date: checkInDate,
            check_out_date: isHourlyBooking ? checkInDate : checkOutDate,
            number_of_guests: 1,
            post_type: (isHourlyBooking ? 'hourly' : 'normal_stay') as 'normal_stay' | 'same_day' | 'hourly',
            source: 'online' as const,
            booking_remarks: onlineRemarks,
            special_requests: bookingNotes.trim() || undefined,
            room_rate_override: useCustomRate && isPositiveMoney(customRate) ? customRate : undefined,
            extra_bed_count: extraBedCount > 0 ? extraBedCount : undefined,
            extra_bed_charge: isPositiveMoney(extraBedCharge) ? extraBedCharge : undefined,
            payment_status: 'unpaid' as const,
          };

          await createBookingsForSelectedRooms({
            ...bookingData,
            extra_bed_count: extraBedCount > 0 ? extraBedCount : undefined,
            extra_bed_charge: isPositiveMoney(extraBedCharge) ? extraBedCharge : undefined,
          });

          onSuccess(
            roomCount > 1
              ? t('unified.successMulti', { guest: guestToUse!.nick_name, rooms: selectedRoomNumbers })
              : t('unified.successSingle', { guest: guestToUse!.nick_name, room: room.room_number })
          );
          onClose();
          await onRefreshData();
          break;
        }

        case 'complimentary': {
          if (!selectedGuestWithCredits) {
            reportError(t('unified.errSelectCreditGuest'));
            setProcessing(false);
            return;
          }

          if (!canCoverRoomsWithCredits(selectedGuestWithCredits, selectedBookingRooms, requiredCreditNights)) {
            reportError(t('unified.errInsufficientCredit'));
            setProcessing(false);
            return;
          }

          // Generate complimentary dates
          const complimentaryDates: string[] = [];
          const start = parseLocalDate(checkInDate);
          const end = parseLocalDate(checkOutDate);
          for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
            complimentaryDates.push(formatLocalDate(d));
          }

          const bookingResults: Array<{ complimentary_nights?: number; [key: string]: unknown }> = [];
          for (const bookingRoom of selectedBookingRooms) {
            const bookingResult = await BookingsService.bookWithCredits({
              guest_id: selectedGuestWithCredits.id,
              room_id: typeof bookingRoom.id === 'string' ? parseInt(bookingRoom.id) : bookingRoom.id,
              check_in_date: checkInDate,
              check_out_date: checkOutDate,
              complimentary_dates: complimentaryDates,
              special_requests: bookingNotes.trim() || undefined,
            });
            bookingResults.push(bookingResult);
          }

          const complimentaryNights = bookingResults.reduce((sum, result) => sum + (result.complimentary_nights || 0), 0);
          onSuccess(
            roomCount > 1
              ? t('unified.successCompMulti', { guest: selectedGuestWithCredits.nick_name, rooms: selectedRoomNumbers, count: complimentaryNights })
              : t('unified.successCompSingle', { guest: selectedGuestWithCredits.nick_name, room: room.room_number, count: complimentaryNights })
          );
          onClose();
          await onRefreshData();
          break;
        }
      }
    } catch (error) {
      reportError(errorMessage(error, t('errors.createBooking')), 'error');
    } finally {
      setProcessing(false);
    }
  };

  // For hourly bookings, billable nights is always 1
  const billableNights = isHourlyBooking ? 1 : numberOfNights;
  const pricingRoomCount = Math.max(1, roomCount);

  // Calculate tourism tax amount
  const perRoomTourismTaxAmount = isTourist ? multiplyMoney(hotelSettings.tourism_tax_rate, billableNights) : 0;
  const tourismTaxAmount = multiplyMoney(perRoomTourismTaxAmount, pricingRoomCount);

  // Calculate total amount
  const calculateTotal = () => {
    let roomSubtotal: number;
    if (useCustomRate && isPositiveMoney(customRate)) {
      roomSubtotal = multiplyMoney(customRate, billableNights * pricingRoomCount);
    } else {
      roomSubtotal = selectedBookingRooms.reduce((sum, bookingRoom) => {
        const roomTotal = multiplyMoney(bookingRoom.price_per_night, billableNights);
        return sumMoney([sum, roomTotal]);
      }, 0);
    }
    return sumMoney([roomSubtotal, tourismTaxAmount, extraBedCharge]);
  };



  const effectiveType = getEffectiveBookingType();
  const requiredCreditNights = Math.max(1, billableNights);
  const isComplimentaryFlow = effectiveType === 'complimentary';

  const creditFilteredGuests = useMemo(() => {
    const candidates = guestsWithCredits.filter((guest) => guest.total_complimentary_credits > 0);
    if (!isComplimentaryFlow || selectedBookingRooms.length === 0) return candidates;

    return candidates.filter((guest) => (
      canCoverRoomsWithCredits(guest, selectedBookingRooms, requiredCreditNights)
    ));
  }, [guestsWithCredits, isComplimentaryFlow, selectedBookingRooms, requiredCreditNights]);

  const creditFilteredAvailableRooms = useMemo(() => {
    if (!isComplimentaryFlow) return availableRooms;

    return availableRooms.filter((availableRoom) => {
      const alreadySelected = selectedBookingRooms.some((selected) => String(selected.id) === String(availableRoom.id));
      const roomsToCover = alreadySelected
        ? selectedBookingRooms
        : [...selectedBookingRooms, availableRoom];

      if (selectedGuestWithCredits) {
        return canCoverRoomsWithCredits(selectedGuestWithCredits, roomsToCover, requiredCreditNights);
      }

      if (loadingGuestsWithCredits) return true;

      return creditFilteredGuests.some((guest) => (
        canCoverRoomsWithCredits(guest, roomsToCover, requiredCreditNights)
      ));
    });
  }, [
    availableRooms,
    isComplimentaryFlow,
    selectedBookingRooms,
    selectedGuestWithCredits,
    loadingGuestsWithCredits,
    creditFilteredGuests,
    requiredCreditNights,
  ]);

  const selectedRoomTypeNames = useMemo(() => (
    Array.from(new Set(selectedBookingRooms.map((selected) => selected.room_type).filter(Boolean))).join(', ')
  ), [selectedBookingRooms]);

  const selectedGuestCreditRoomTypes = useMemo(
    () => getGuestCreditRoomTypeLabels(selectedGuestWithCredits, t('unified.creditedRoomType')),
    [selectedGuestWithCredits, t],
  );

  const guestCreditsNoOptionsText = selectedBookingRooms.length > 0
    ? t('unified.noCreditForType', { types: selectedRoomTypeNames || t('unified.selectedRoomTypeFallback') })
    : t('guestSelector.noCredits');

  const roomPickerEmptyText = isComplimentaryFlow && selectedGuestWithCredits
    ? t('unified.noRoomsMatchGuestType', {
        guest: selectedGuestWithCredits.nick_name,
        types: selectedGuestCreditRoomTypes ? ` (${selectedGuestCreditRoomTypes})` : '',
      })
    : isComplimentaryFlow && !loadingGuestsWithCredits && guestsWithCredits.length > 0 && availableRooms.length > 0
      ? t('unified.noRoomsMatchAnyCredit')
      : t('unified.noRoomsForDates');

  const noMatchingGuestsForSelectedRooms = Boolean(
    isComplimentaryFlow
    && !loadingGuestsWithCredits
    && selectedBookingRooms.length > 0
    && creditFilteredGuests.length === 0,
  );

  const noMatchingRoomsForSelectedGuest = Boolean(
    isComplimentaryFlow
    && needsRoomSelection
    && checkInDate
    && checkOutDate
    && !loadingAvailableRooms
    && !loadingGuestsWithCredits
    && (selectedGuestWithCredits || guestsWithCredits.length > 0)
    && creditFilteredAvailableRooms.length === 0,
  );

  useEffect(() => {
    if (!isComplimentaryFlow || !selectedGuestWithCredits) return;
    const stillSelectable = creditFilteredGuests.some((guest) => guest.id === selectedGuestWithCredits.id);
    if (!stillSelectable) {
      setSelectedGuestWithCredits(null);
    }
  }, [isComplimentaryFlow, creditFilteredGuests, selectedGuestWithCredits]);

  useEffect(() => {
    if (!needsRoomSelection || !isComplimentaryFlow || !selectedGuestWithCredits) return;

    const allowedRoomIds = new Set(creditFilteredAvailableRooms.map((availableRoom) => String(availableRoom.id)));
    setSelectedRooms((prev) => {
      const filtered = prev.filter((selected) => allowedRoomIds.has(String(selected.id)));
      if (filtered.length === prev.length) return prev;
      setSelectedRoom(filtered[0] || null);
      return filtered;
    });
  }, [needsRoomSelection, isComplimentaryFlow, selectedGuestWithCredits, creditFilteredAvailableRooms]);

  // Submit button label depends on flow
  const submitLabel = (() => {
    if (processing) return t('common:state.processing');
    if (bookingMode === 'direct') return t('unified.submitDirect');
    if (effectiveType === 'complimentary') return t('unified.submitComp');
    return t('unified.submitReservation');
  })();

  // Lenient submit gate — only block on truly impossible state. The downstream
  // submit handlers (createBookingAndHandOff / handleSubmit) already validate
  // guest, channel, etc. and surface precise errors via reportError(), so we
  // don't need to disable the button for those cases.
  const formIsValid = (() => {
    if (selectedBookingRooms.length === 0) return false;
    if (!bookingMode) return false;
    if (bookingMode === 'reservation' && !reservationType) return false;
    if (!checkInDate || !checkOutDate) return false;
    if (!isHourlyBooking && new Date(checkOutDate) <= new Date(checkInDate)) return false;
    return true;
  })();

  const D = useMemo(() => buildBookingTokens(theme), [theme]);

  // Quick-set night helpers
  const setNights = (nights: number) => {
    if (!checkInDate) return;
    const checkout = formatLocalDate(addLocalDays(checkInDate, nights));
    setCheckOutDate(checkout);
    setNumberOfNights(nights);
    setIsHourlyBooking(false);
  };

  // Date inputs: long format echoed in helper text below
  const formatHumanDate = (d: string) => {
    if (!d) return '';
    try {
      return dateFormatter({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(parseLocalDate(d));
    } catch { return d; }
  };

  // Selected guest display (handles new/existing)
  const summaryGuestName = (() => {
    if (effectiveType === 'complimentary') return selectedGuestWithCredits?.nick_name || '—';
    if (isCreatingNewGuest) return [newGuestForm.first_name, newGuestForm.last_name].filter(Boolean).join(' ') || '—';
    return selectedGuest?.nick_name || '—';
  })();

  // Top-right "active mode/type" pill colors used in the summary aside
  const tagColor = bookingMode === 'direct' ? D.orange
    : effectiveType === 'walk_in' ? D.orange
    : effectiveType === 'complimentary' ? D.purple
    : D.blue;
  const tagSoft = bookingMode === 'direct' ? D.orangeSoft
    : effectiveType === 'walk_in' ? D.orangeSoft
    : effectiveType === 'complimentary' ? D.purpleSoft
    : D.blueSoft;
  const tagLabel = bookingMode === 'direct'
    ? t('unified.tagDirect')
    : t('unified.tagReservation', {
        type: effectiveType === 'walk_in'
          ? t('unified.tagTypeWalkIn')
          : effectiveType === 'complimentary'
            ? t('unified.tagTypeComp')
            : t('unified.tagTypeOnline'),
      });

  // Rate per night used for the summary preview
  const ratePerNight = useCustomRate && isPositiveMoney(customRate)
    ? customRate
    : toMoneyNumber(room?.price_per_night);
  const nightlyRoomTotal = useCustomRate && isPositiveMoney(customRate)
    ? multiplyMoney(customRate, pricingRoomCount)
    : selectedBookingRooms.reduce((sum, bookingRoom) => {
        return sumMoney([sum, bookingRoom.price_per_night]);
      }, 0);
  const subtotal = multiplyMoney(nightlyRoomTotal, billableNights);
  const total = calculateTotal();

  // Step glyphs auto-shift down when the Room picker section is rendered up
  // top — keeps the labels in sync without needing per-call offsets.
  const STEP_GLYPHS = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
  const step = (i: number) => STEP_GLYPHS[i - 1 + (needsRoomSelection ? 1 : 0)] ?? '·';

  return (
    <Dialog
      open={open}
      onClose={() => !processing && onClose()}
      maxWidth={false}
      fullWidth
      slotProps={{
        paper: {
          sx: {
            overflow: 'hidden',
            boxShadow: 'var(--hotel-shadow-lg)',
            // Floating card only at `sm` and up — below that the theme's
            // full-screen sheet rule (MuiDialog paper override) owns the
            // paper: 100dvh, no margin, no border radius.
            [theme.breakpoints.up('sm')]: {
              width: 'min(1040px, 100%)',
              maxWidth: 'calc(100vw - 48px)',
              maxHeight: 'calc(100vh - 48px)',
              borderRadius: 2,
              border: `1px solid ${D.border}`,
            },
          },
        }
      }}
    >
      {/* ============= HEADER ============= */}
      <BookingModalHeader
        D={D}
        room={room}
        roomCount={roomCount}
        selectedRoomNumbers={selectedRoomNumbers}
        roomIsAvailable={roomIsAvailable}
        processing={processing}
        onClose={onClose}
      />
      {/* ============= BODY ============= */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 340px' },
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        {/* LEFT — FORM */}
        <Box sx={{ p: '22px 24px', overflowY: 'auto' }}>

          {/* Room picker — only when opened without a pre-selected room
             (e.g. the "Add booking" CTA on the Bookings page). */}
          {needsRoomSelection && (
            <>
              <RoomPickerSection
                D={D}
                selectedRooms={selectedRooms}
                onRoomsChange={(value) => {
                  setSelectedRooms(value);
                  setSelectedRoom(value[0] || null);
                }}
                availableRooms={creditFilteredAvailableRooms}
                loadingAvailableRooms={loadingAvailableRooms}
                checkInDate={checkInDate}
                checkOutDate={checkOutDate}
                currencySymbol={currencySymbol}
                selectedRoomNumbers={selectedRoomNumbers}
                emptyAvailabilityText={roomPickerEmptyText}
                noOptionsText={roomPickerEmptyText}
              />
              {noMatchingRoomsForSelectedGuest && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {roomPickerEmptyText}
                </Alert>
              )}
            </>
          )}

          {/* Mode */}
          <BookingModeSelector
            D={D}
            glyph={step(1)}
            bookingMode={bookingMode}
            onSelect={handleModeSelect}
          />

          {/* Reservation type — only when mode === reservation */}
          {bookingMode === 'reservation' && (
            <ReservationTypeSection
              D={D}
              glyph={step(2)}
              reservationType={reservationType}
              onSelectType={handleReservationTypeSelect}
              bookingChannels={BOOKING_CHANNELS}
              bookingChannel={bookingChannel}
              onChannelSelect={setBookingChannel}
              bookingReference={bookingReference}
              onReferenceChange={setBookingReference}
              currencySymbol={currencySymbol}
            />
          )}

          {/* Guest — expanded always; the header doubles as a collapse
             toggle so a phone user can fold a finished section away. */}
          <CollapsibleSection title={`${step(3)} ${t('unified.secGuest')}`} sx={{ mb: 2.75 }}>
            <GuestSelector
              guests={guests}
              selectedGuest={selectedGuest}
              onGuestSelect={setSelectedGuest}
              isCreatingNew={isCreatingNewGuest}
              onToggleMode={handleToggleGuestMode}
              newGuestForm={newGuestForm}
              onNewGuestFormChange={setNewGuestForm}
              filterByCredits={effectiveType === 'complimentary'}
              guestsWithCredits={creditFilteredGuests}
              selectedGuestWithCredits={selectedGuestWithCredits}
              onGuestWithCreditsSelect={setSelectedGuestWithCredits}
              loadingGuestsWithCredits={loadingGuestsWithCredits}
              guestCreditsNoOptionsText={guestCreditsNoOptionsText}
            />
            {noMatchingGuestsForSelectedRooms && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {guestCreditsNoOptionsText}
              </Alert>
            )}
            {companyBilling ? (
              <Alert
                severity="success"
                sx={{ mt: 1.5 }}
                action={
                  <Button color="inherit" size="small" onClick={() => setCompanyBilling(null)}>
                    {t('common:actions.remove')}
                  </Button>
                }
              >
                <AlertTitle>{t('unified.companyCheckIn')}</AlertTitle>
                {t('unified.billToPre')}<strong>{companyBilling.name}</strong>{t('unified.billToPost')}
              </Alert>
            ) : (
              guestAdvisory?.needs_attention && (
                <Alert
                  severity="warning"
                  sx={{ mt: 1.5 }}
                  onClose={() => setGuestAdvisory(null)}
                  action={
                    guestAdvisory.suggested_company_name ? (
                      <Button
                        color="inherit"
                        size="small"
                        onClick={() =>
                          setCompanyBilling({
                            id: guestAdvisory.suggested_company_id ?? undefined,
                            name: guestAdvisory.suggested_company_name as string,
                          })
                        }
                      >
                        {t('unified.billTo', { name: guestAdvisory.suggested_company_name })}
                      </Button>
                    ) : undefined
                  }
                >
                  <AlertTitle>{t('unified.useCompanyCheckIn')}</AlertTitle>
                  {guestAdvisory.message}
                </Alert>
              )
            )}
          </CollapsibleSection>

          {/* Stay */}
          <StaySection
            D={D}
            glyph={step(4)}
            checkInDate={checkInDate}
            checkOutDate={checkOutDate}
            isHourlyBooking={isHourlyBooking}
            billableNights={billableNights}
            onDateChange={handleDateChange}
            onHourlyToggle={handleHourlyToggle}
            onQuickSetNights={setNights}
            formatHumanDate={formatHumanDate}
          />

          {/* Rate & payment */}
          <RatePaymentSection
            D={D}
            glyph={step(5)}
            room={room}
            useCustomRate={useCustomRate}
            onUseCustomRateChange={setUseCustomRate}
            customRate={customRate}
            onCustomRateChange={setCustomRate}
            isTourist={isTourist}
            tourismTaxRate={hotelSettings.tourism_tax_rate}
            currencySymbol={currencySymbol}
            formatCurrency={formatCurrency}
            hideTourismStatus={isCreatingNewGuest}
          />

          {/* Notes */}
          <NotesSection
            D={D}
            glyph={step(6)}
            bookingNotes={bookingNotes}
            onNotesChange={setBookingNotes}
          />
        </Box>

        {/* RIGHT — LIVE SUMMARY */}
        <BookingSummaryAside
          D={D}
          room={room}
          roomCount={roomCount}
          selectedRoomNumbers={selectedRoomNumbers}
          roomIsAvailable={roomIsAvailable}
          checkingAvailability={checkingAvailability}
          tagColor={tagColor}
          tagSoft={tagSoft}
          tagLabel={tagLabel}
          summaryGuestName={summaryGuestName}
          effectiveType={effectiveType}
          bookingChannel={bookingChannel}
          checkInDate={checkInDate}
          checkOutDate={checkOutDate}
          isHourlyBooking={isHourlyBooking}
          billableNights={billableNights}
          ratePerNight={ratePerNight}
          nightlyRoomTotal={nightlyRoomTotal}
          subtotal={subtotal}
          tourismTaxAmount={tourismTaxAmount}
          extraBedCharge={extraBedCharge}
          total={total}
          formatCurrency={formatCurrency}
          formatHumanDate={formatHumanDate}
        />
      </Box>
      {/* ============= FOOTER ============= */}
      <BookingModalFooter
        D={D}
        processing={processing}
        formIsValid={formIsValid}
        submitLabel={submitLabel}
        onClose={onClose}
        onSubmit={handleSubmit}
        total={total}
        billableNights={billableNights}
        formatCurrency={formatCurrency}
      />
    </Dialog>
  );
};

export default React.memo(UnifiedBookingModal);
