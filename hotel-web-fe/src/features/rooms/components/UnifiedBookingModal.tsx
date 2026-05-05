import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  Card,
  CardContent,
  CardActionArea,
  CircularProgress,
  Divider,
  Alert,
  Chip,
  Autocomplete,
  FormControlLabel,
  Checkbox,
  IconButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  PersonAdd as PersonAddIcon,
  EventAvailable as BookingIcon,
  CardGiftcard as GiftIcon,
  Hotel as HotelIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Bedtime as MoonIcon,
  Public as PublicIcon,
  Search as SearchIcon,
  ListAlt as SummaryIcon,
} from '@mui/icons-material';
import { Room, Guest, Booking, RoomType } from '../../../types';
import { HotelAPIService } from '../../../api';
import { useCurrency } from '../../../hooks/useCurrency';
import { useRoomAvailabilityCheck } from '../../../hooks/useRoomAvailabilityCheck';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { addLocalDays, formatLocalDate, parseLocalDate } from '../../../utils/date';
import { useUnifiedBookingData } from '../hooks/useUnifiedBookingData';
import { isValidEmail } from '../../../utils/validation';
import GuestSelector, { NewGuestForm, GuestWithCredits, emptyNewGuestForm } from './GuestSelector';

export type BookingType = 'direct' | 'walk_in' | 'online' | 'complimentary';
export type BookingMode = 'direct' | 'reservation';

interface UnifiedBookingModalProps {
  open: boolean;
  onClose: () => void;
  room?: Room | null;  // Optional - if not provided, room selection step will be shown
  rooms?: Room[];      // List of rooms for selection when room is not pre-selected
  guests: Guest[];
  initialGuest?: Guest | null;
  initialBookingType?: BookingType;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onBookingCreated?: (booking: Booking, guest: Guest) => void; // For direct booking to open enhanced check-in
  onRefreshData: () => Promise<void>;
}

// Main booking mode options (Step 1)
const BOOKING_MODE_CONFIG = {
  direct: {
    label: 'Direct Booking',
    description: 'Check in guest immediately',
    icon: PersonAddIcon,
    color: '#2196f3',
  },
  reservation: {
    label: 'Booking Reservation',
    description: 'Create reservation for future check-in',
    icon: BookingIcon,
    color: '#4caf50',
  },
};

// Reservation type options (Step 2 when reservation is selected)
const RESERVATION_TYPE_CONFIG = {
  walk_in: {
    label: 'Walk-in',
    description: 'Guest booking in person or by phone',
    icon: PersonAddIcon,
    color: '#2196f3',
  },
  online: {
    label: 'Online',
    description: 'OTA or website booking',
    icon: BookingIcon,
    color: '#4caf50',
  },
  complimentary: {
    label: 'Complimentary',
    description: 'Use guest free room credits',
    icon: GiftIcon,
    color: '#9c27b0',
  },
};

const UnifiedBookingModal: React.FC<UnifiedBookingModalProps> = ({
  open,
  onClose,
  room: roomProp,
  rooms = [],
  guests,
  initialGuest = null,
  initialBookingType,
  onSuccess,
  onError,
  onBookingCreated,
  onRefreshData,
}) => {
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

  // Stepper state
  const [activeStep, setActiveStep] = useState(0);
  const [bookingMode, setBookingMode] = useState<BookingMode | null>(null);
  const [reservationType, setReservationType] = useState<'walk_in' | 'online' | 'complimentary' | null>(null);

  // Guest state
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [newGuestForm, setNewGuestForm] = useState<NewGuestForm>(emptyNewGuestForm);
  const [isCreatingNewGuest, setIsCreatingNewGuest] = useState(false);
  const [selectedGuestWithCredits, setSelectedGuestWithCredits] = useState<GuestWithCredits | null>(null);

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

  // Extra bed state
  const [extraBedCount, setExtraBedCount] = useState(0);
  const [extraBedCharge, setExtraBedCharge] = useState(0);

  // Processing state
  const [processing, setProcessing] = useState(false);

  // Room selection state (when room is not pre-selected)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  // Use selected room or prop room
  const room = roomProp || selectedRoom;

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
    ? (typeof roomTypeConfig.extra_bed_charge === 'string'
        ? parseFloat(roomTypeConfig.extra_bed_charge)
        : roomTypeConfig.extra_bed_charge) || 0
    : 0;

  // Load room type config when room changes
  useEffect(() => {
    if (room?.room_type && open) {
      loadRoomTypeConfig(room.room_type);
    }
  }, [room?.room_type, open]);

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
      setActiveStep(0);
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
      setAvailableRooms([]);

      // Mark initialization complete after a microtask to ensure state has settled
      Promise.resolve().then(() => {
        isInitializingRef.current = false;
      });
    }

    // Only run cleanup when transitioning from open to closed
    if (!open && wasOpen) {
      // Reset state when closing (for cleanup)
      setActiveStep(0);
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
      setAvailableRooms([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Store rooms in a ref to avoid dependency issues
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

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
    loadAvailableRooms(checkInDate, checkOutDate, sortRoomsByNumber, roomsRef.current);
  }, [needsRoomSelection, checkInDate, checkOutDate]);

  // Load guests with credits when complimentary reservation is selected
  useEffect(() => {
    if (reservationType === 'complimentary' && open) {
      loadGuestsWithCredits();
    }
  }, [reservationType, open]);

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

  // Get steps based on booking mode and room selection need
  // Memoized to prevent unnecessary recalculations
  const getSteps = useCallback((): string[] => {
    if (needsRoomSelection) {
      // Room selection mode: add Room step after Mode
      if (bookingMode === 'direct') {
        return ['Mode', 'Room', 'Guest', 'Dates & Payment', 'Confirm'];
      } else if (bookingMode === 'reservation') {
        return ['Mode', 'Type', 'Room', 'Guest', 'Details', 'Confirm'];
      }
      return ['Mode', 'Room', 'Guest', 'Details', 'Confirm'];
    } else {
      // Room pre-selected: original flow
      if (bookingMode === 'direct') {
        return ['Mode', 'Guest', 'Dates & Payment', 'Confirm'];
      } else if (bookingMode === 'reservation') {
        return ['Mode', 'Type', 'Guest', 'Details', 'Confirm'];
      }
      return ['Mode', 'Guest', 'Details', 'Confirm'];
    }
  }, [needsRoomSelection, bookingMode]);

  // Guard against activeStep becoming invalid when steps array changes
  // This prevents glitches when switching between modes
  useEffect(() => {
    const steps = getSteps();
    if (activeStep >= steps.length && steps.length > 0) {
      setActiveStep(steps.length - 1);
    }
  }, [getSteps, activeStep]);

  // Get step indices dynamically based on booking mode and room selection
  const getStepIndex = (stepName: string): number => {
    const steps = getSteps();
    return steps.indexOf(stepName);
  };

  // Validation for each step
  const isStepValid = (): boolean => {
    const steps = getSteps();
    const currentStepName = steps[activeStep];

    switch (currentStepName) {
      case 'Mode':
        return !!bookingMode;

      case 'Type':
        return !!reservationType;

      case 'Room':
        // Room selection step - need dates and room selected
        if (!checkInDate || !checkOutDate) return false;
        if (!isHourlyBooking && new Date(checkOutDate) <= new Date(checkInDate)) return false;
        if (isHourlyBooking && checkOutDate !== checkInDate) return false;
        return !!selectedRoom;

      case 'Guest':
        if (reservationType === 'complimentary') {
          return !!selectedGuestWithCredits;
        }
        if (isCreatingNewGuest) {
          return !!(newGuestForm.first_name && newGuestForm.last_name);
        }
        return !!selectedGuest;

      case 'Dates & Payment':
        // For direct booking with room pre-selected
        if (!checkInDate || !checkOutDate) return false;
        if (!isHourlyBooking && new Date(checkOutDate) <= new Date(checkInDate)) return false;
        if (roomIsAvailable === false) return false;
        return true;

      case 'Details':
        // For reservation mode
        if (!needsRoomSelection) {
          // Dates validation needed only when room is pre-selected
          if (!checkInDate || !checkOutDate) return false;
          if (!isHourlyBooking && new Date(checkOutDate) <= new Date(checkInDate)) return false;
          if (roomIsAvailable === false) return false;
        }
        if (reservationType === 'online' && !bookingChannel) return false;
        return true;

      case 'Confirm':
        return true;

      default:
        return false;
    }
  };

  // Handle next step
  const handleNext = async () => {
    // Guard against navigation during processing or initialization
    if (processing || isInitializingRef.current) return;

    const steps = getSteps();

    // Guard against invalid step navigation
    if (activeStep >= steps.length - 1) return;

    setActiveStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  // Create booking and hand off to EnhancedCheckInModal (for direct booking)
  const createBookingAndHandOff = async () => {
    if (!room) {
      onError('No room selected');
      return;
    }

    setProcessing(true);

    try {
      let guestToUse: Guest | null = null;

      // Create new guest if needed
      if (isCreatingNewGuest) {
        if (!newGuestForm.first_name || !newGuestForm.last_name) {
          onError('Please fill in required guest fields');
          setProcessing(false);
          return;
        }

        if (newGuestForm.email && newGuestForm.email.trim() && !isValidEmail(newGuestForm.email)) {
          onError('Please enter a valid email address');
          setProcessing(false);
          return;
        }

        // Check for duplicate guest name
        const modalFullName = `${newGuestForm.first_name.trim()} ${newGuestForm.last_name.trim()}`.toLowerCase();
        const existingGuestByName = guests.find(g => g.full_name.toLowerCase().trim() === modalFullName);
        if (existingGuestByName) {
          onError(`A guest with the name '${newGuestForm.first_name.trim()} ${newGuestForm.last_name.trim()}' already exists. Please select the existing guest instead.`);
          setProcessing(false);
          return;
        }

        // Check for duplicate email
        if (newGuestForm.email && newGuestForm.email.trim()) {
          const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newGuestForm.email.toLowerCase());
          if (existingGuest) {
            onError(`A guest with email ${newGuestForm.email} already exists`);
            setProcessing(false);
            return;
          }
        }

        const newGuest = await HotelAPIService.createGuest({
          first_name: newGuestForm.first_name,
          last_name: newGuestForm.last_name,
          email: newGuestForm.email || undefined,
          phone: newGuestForm.phone,
          ic_number: newGuestForm.ic_number,
          nationality: newGuestForm.nationality,
          tourism_type: newGuestForm.tourism_type,
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
        onError('Please select a guest');
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
      const bookingData = {
        guest_id: guestToUse.id,
        room_id: String(room.id),
        check_in_date: checkInDate,
        check_out_date: isHourlyBooking ? checkInDate : checkOutDate,
        number_of_guests: 1,
        post_type: (isHourlyBooking ? 'hourly' : 'normal_stay') as 'normal_stay' | 'same_day' | 'hourly',
        booking_remarks: remarks,
        special_requests: bookingNotes.trim() || undefined,
        source: 'walk_in' as const,
        payment_status: 'unpaid' as const,
        room_rate_override: useCustomRate && customRate > 0 ? customRate : undefined,
        is_tourist: isTourist,
        tourism_tax_amount: tourismTaxAmount > 0 ? tourismTaxAmount : undefined,
        extra_bed_count: extraBedCount > 0 ? extraBedCount : undefined,
        extra_bed_charge: extraBedCharge > 0 ? extraBedCharge : undefined,
      };

      const createdBookingResult = await HotelAPIService.createBooking(bookingData);

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
        tourism_tax_amount: createdBookingResult.tourism_tax_amount || (tourismTaxAmount > 0 ? tourismTaxAmount : undefined),
        source: 'walk_in',
      };

      // Add room_number to booking for EnhancedCheckInModal display
      (bookingForCheckIn as any).room_number = room.room_number;

      // Hand off to EnhancedCheckInModal
      if (onBookingCreated) {
        onBookingCreated(bookingForCheckIn, guestToUse);
      }
      onClose();
      await onRefreshData();
    } catch (error: any) {
      onError(error.message || 'Failed to create booking');
    } finally {
      setProcessing(false);
    }
  };

  // Handle back step
  const handleBack = () => {
    // Guard against navigation during processing or initialization
    if (processing || isInitializingRef.current) return;

    // Guard against going below step 0
    if (activeStep <= 0) return;

    setActiveStep((prev) => Math.max(prev - 1, 0));
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
  const handleReservationTypeSelect = (type: 'walk_in' | 'online' | 'complimentary') => {
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

  // Submit booking
  const handleSubmit = async () => {
    // Handle direct booking: create booking and hand off to EnhancedCheckInModal
    if (bookingMode === 'direct') {
      await createBookingAndHandOff();
      return;
    }

    if (!room) {
      onError('No room selected');
      return;
    }

    const effectiveType = getEffectiveBookingType();
    if (!effectiveType) {
      onError('Please select a booking type');
      return;
    }

    setProcessing(true);

    try {
      let guestToUse: Guest | null = null;

      // Create new guest if needed (for walk-in and online)
      if (effectiveType !== 'complimentary') {
        if (isCreatingNewGuest) {
          if (!newGuestForm.first_name || !newGuestForm.last_name) {
            onError('Please fill in required guest fields');
            setProcessing(false);
            return;
          }

          if (newGuestForm.email && newGuestForm.email.trim() && !isValidEmail(newGuestForm.email)) {
            onError('Please enter a valid email address');
            setProcessing(false);
            return;
          }

          // Check for duplicate email
          if (newGuestForm.email && newGuestForm.email.trim()) {
            const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newGuestForm.email.toLowerCase());
            if (existingGuest) {
              onError(`A guest with email ${newGuestForm.email} already exists`);
              setProcessing(false);
              return;
            }
          }

          const newGuest = await HotelAPIService.createGuest({
            first_name: newGuestForm.first_name,
            last_name: newGuestForm.last_name,
            email: newGuestForm.email || undefined,
            phone: newGuestForm.phone,
            ic_number: newGuestForm.ic_number,
            nationality: newGuestForm.nationality,
            tourism_type: newGuestForm.tourism_type,
            guest_type: newGuestForm.guest_type || 'non_member',
            company_name: newGuestForm.company_name || undefined,
          });

          guestToUse = newGuest;
        } else {
          guestToUse = selectedGuest;
        }

        if (!guestToUse) {
          onError('Please select a guest');
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
          const bookingData = {
            guest_id: guestToUse!.id,
            room_id: String(room.id),
            check_in_date: checkInDate,
            check_out_date: isHourlyBooking ? checkInDate : checkOutDate,
            number_of_guests: 1,
            post_type: (isHourlyBooking ? 'hourly' : 'normal_stay') as 'normal_stay' | 'same_day' | 'hourly',
            booking_remarks: remarksStr,
            special_requests: bookingNotes.trim() || undefined,
            source: 'walk_in' as const,
            payment_status: 'unpaid' as const,
            room_rate_override: useCustomRate && customRate > 0 ? customRate : undefined,
            is_tourist: isTourist,
            tourism_tax_amount: tourismTaxAmount > 0 ? tourismTaxAmount : undefined,
            extra_bed_count: extraBedCount > 0 ? extraBedCount : undefined,
            extra_bed_charge: extraBedCharge > 0 ? extraBedCharge : undefined,
          };

          await HotelAPIService.createBooking(bookingData);

          onSuccess(`Reservation created for ${guestToUse!.full_name} in Room ${room.room_number}`);
          onClose();
          await onRefreshData();
          break;
        }

        case 'online': {
          const onlineRemarks = [
            bookingReference ? `${bookingChannel} - Ref: ${bookingReference}` : `${bookingChannel} Booking`,
            bookingNotes.trim(),
          ].filter(Boolean).join(' | ');
          const bookingData = {
            guest_id: guestToUse!.id,
            room_id: String(room.id),
            check_in_date: checkInDate,
            check_out_date: isHourlyBooking ? checkInDate : checkOutDate,
            number_of_guests: 1,
            post_type: (isHourlyBooking ? 'hourly' : 'normal_stay') as 'normal_stay' | 'same_day' | 'hourly',
            source: 'online' as const,
            booking_remarks: onlineRemarks,
            special_requests: bookingNotes.trim() || undefined,
            room_rate_override: useCustomRate && customRate > 0 ? customRate : undefined,
            is_tourist: isTourist,
            tourism_tax_amount: tourismTaxAmount > 0 ? tourismTaxAmount : undefined,
            extra_bed_count: extraBedCount > 0 ? extraBedCount : undefined,
            extra_bed_charge: extraBedCharge > 0 ? extraBedCharge : undefined,
            payment_status: 'unpaid' as const,
          };

          await HotelAPIService.createBooking(bookingData);

          onSuccess(`Reservation created for ${guestToUse!.full_name} in Room ${room.room_number}`);
          onClose();
          await onRefreshData();
          break;
        }

        case 'complimentary': {
          if (!selectedGuestWithCredits) {
            onError('Please select a guest with free room credits');
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

          const bookingResult = await HotelAPIService.bookWithCredits({
            guest_id: selectedGuestWithCredits.id,
            room_id: typeof room.id === 'string' ? parseInt(room.id) : room.id,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            complimentary_dates: complimentaryDates,
            special_requests: bookingNotes.trim() || undefined,
          });

          onSuccess(`Complimentary reservation created for ${selectedGuestWithCredits.full_name} in Room ${room.room_number} (${bookingResult.complimentary_nights} nights used)`);
          onClose();
          await onRefreshData();
          break;
        }
      }
    } catch (error: any) {
      onError(error.message || 'Failed to create booking');
    } finally {
      setProcessing(false);
    }
  };

  // For hourly bookings, billable nights is always 1
  const billableNights = isHourlyBooking ? 1 : numberOfNights;

  // Calculate tourism tax amount
  const tourismTaxAmount = isTourist ? billableNights * hotelSettings.tourism_tax_rate : 0;

  // Calculate total amount
  const calculateTotal = () => {
    let total: number;
    if (useCustomRate && customRate > 0) {
      total = customRate * billableNights;
    } else {
      const price = room?.price_per_night || 0;
      const numPrice = typeof price === 'string' ? parseFloat(price) : price;
      total = numPrice * billableNights;
    }
    return total + tourismTaxAmount + extraBedCharge;
  };


  // Render step content
  const renderStepContent = () => {
    const effectiveType = getEffectiveBookingType();
    const steps = getSteps();
    const currentStepName = steps[activeStep];

    // Mode selection step
    if (currentStepName === 'Mode') {
      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            How would you like to proceed?
          </Typography>
          <Grid container spacing={2}>
            {(Object.keys(BOOKING_MODE_CONFIG) as BookingMode[]).map((mode) => {
              const config = BOOKING_MODE_CONFIG[mode];
              const Icon = config.icon;
              return (
                <Grid key={mode} size={{ xs: 12, sm: 6 }}>
                  <Card
                    sx={{
                      border: bookingMode === mode ? 2 : 1,
                      borderColor: bookingMode === mode ? config.color : 'divider',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: config.color,
                        transform: 'translateY(-2px)',
                      },
                    }}
                  >
                    <CardActionArea onClick={() => handleModeSelect(mode)}>
                      <CardContent sx={{ textAlign: 'center', py: 3 }}>
                        <Box
                          sx={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            bgcolor: bookingMode === mode ? config.color : 'grey.100',
                            color: bookingMode === mode ? 'white' : config.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mx: 'auto',
                            mb: 1.5,
                            transition: 'all 0.2s',
                          }}
                        >
                          <Icon sx={{ fontSize: 28 }} />
                        </Box>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {config.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {config.description}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      );
    }

    // Type selection step (for reservation mode)
    if (currentStepName === 'Type') {
      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            Select Reservation Type
          </Typography>
          <Grid container spacing={2}>
            {(Object.keys(RESERVATION_TYPE_CONFIG) as ('walk_in' | 'online' | 'complimentary')[]).map((type) => {
              const config = RESERVATION_TYPE_CONFIG[type];
              const Icon = config.icon;
              return (
                <Grid key={type} size={{ xs: 12, sm: 4 }}>
                  <Card
                    sx={{
                      border: reservationType === type ? 2 : 1,
                      borderColor: reservationType === type ? config.color : 'divider',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: config.color,
                        transform: 'translateY(-2px)',
                      },
                    }}
                  >
                    <CardActionArea onClick={() => handleReservationTypeSelect(type)}>
                      <CardContent sx={{ textAlign: 'center', py: 3 }}>
                        <Box
                          sx={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            bgcolor: reservationType === type ? config.color : 'grey.100',
                            color: reservationType === type ? 'white' : config.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mx: 'auto',
                            mb: 1.5,
                            transition: 'all 0.2s',
                          }}
                        >
                          <Icon sx={{ fontSize: 28 }} />
                        </Box>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {config.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {config.description}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      );
    }

    // Room selection step (when room is not pre-selected)
    if (currentStepName === 'Room') {
      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            Select Dates & Room
          </Typography>
          <Grid container spacing={2}>
            {/* Hourly toggle */}
            <Grid size={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isHourlyBooking}
                    onChange={(e) => handleHourlyToggle(e.target.checked)}
                    color="warning"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Hourly Check-In
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Guest checks in and out on the same day
                    </Typography>
                  </Box>
                }
              />
            </Grid>
            {/* Dates */}
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-in Date"
                value={checkInDate}
                onChange={(e) => handleDateChange('checkIn', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            {!isHourlyBooking && (
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  type="date"
                  label="Check-out Date"
                  value={checkOutDate}
                  onChange={(e) => handleDateChange('checkOut', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            )}
            {isHourlyBooking && (
              <Grid size={{ xs: 12, md: 6 }}>
                <Alert severity="info" sx={{ py: 0.5 }}>
                  <Typography variant="body2">
                    Guest will check out at {hotelSettings.check_out_time || '12:00 PM'} on the same day
                  </Typography>
                </Alert>
              </Grid>
            )}
            {/* Room selection */}
            <Grid size={12}>
              <Autocomplete
                fullWidth
                options={availableRooms}
                loading={loadingAvailableRooms}
                getOptionLabel={(option) => `Room ${option.room_number} - ${option.room_type} (${formatCurrency(Number(option.price_per_night))}/night)`}
                value={selectedRoom}
                onChange={(event, newValue) => {
                  setSelectedRoom(newValue);
                }}
                noOptionsText={
                  !checkInDate || !checkOutDate
                    ? "Select dates first to see available rooms"
                    : loadingAvailableRooms
                      ? "Loading available rooms..."
                      : "No rooms available for selected dates"
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Room"
                    placeholder={checkInDate && checkOutDate ? "Search available rooms..." : "Select dates first..."}
                    helperText={checkInDate && checkOutDate ? `${availableRooms.length} room(s) available for selected dates` : ""}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingAvailableRooms ? <CircularProgress color="inherit" size={20} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                disabled={!checkInDate || !checkOutDate}
              />
            </Grid>
            {/* Show selected room details */}
            {selectedRoom && (
              <Grid size={12}>
                <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                  <Grid container spacing={1}>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">Room Number</Typography>
                      <Typography variant="body1" fontWeight={600}>{selectedRoom.room_number}</Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">Room Type</Typography>
                      <Typography variant="body1">{selectedRoom.room_type}</Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">Rate per Night</Typography>
                      <Typography variant="body1">{formatCurrency(Number(selectedRoom.price_per_night))}</Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">Total ({isHourlyBooking ? 'Hourly Stay' : `${numberOfNights} night${numberOfNights > 1 ? 's' : ''}`})</Typography>
                      <Typography variant="body1" fontWeight={600}>{formatCurrency(Number(selectedRoom.price_per_night) * billableNights)}</Typography>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            )}
          </Grid>
        </Box>
      );
    }

    // Guest step
    if (currentStepName === 'Guest') {
      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            {effectiveType === 'complimentary' ? 'Select Guest with Credits' : 'Guest Information'}
          </Typography>
          <GuestSelector
            selectedGuest={selectedGuest}
            onGuestSelect={setSelectedGuest}
            guests={guests}
            newGuestForm={newGuestForm}
            onNewGuestFormChange={setNewGuestForm}
            isCreatingNew={isCreatingNewGuest}
            onToggleMode={handleToggleGuestMode}
            filterByCredits={effectiveType === 'complimentary'}
            guestsWithCredits={guestsWithCredits}
            selectedGuestWithCredits={selectedGuestWithCredits}
            onGuestWithCreditsSelect={setSelectedGuestWithCredits}
            loadingGuestsWithCredits={loadingGuestsWithCredits}
          />
        </Box>
      );
    }

    // Details step (Dates & Payment or just Details for online)
    if (currentStepName === 'Dates & Payment' || currentStepName === 'Details') {
      const isWalkIn = effectiveType === 'walk_in';
      const isOnline = effectiveType === 'online';
      const showPayment = isWalkIn;
      // Only show dates if room was pre-selected (dates already entered in Room step otherwise)
      const showDates = !needsRoomSelection;

      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            {showPayment ? 'Booking Details' : isOnline ? 'Booking Details' : showDates ? 'Select Dates' : 'Additional Details'}
          </Typography>

          <Grid container spacing={2}>
            {/* Hourly toggle - show when dates are shown */}
            {showDates && (
              <Grid size={12}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={isHourlyBooking}
                      onChange={(e) => handleHourlyToggle(e.target.checked)}
                      color="warning"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Hourly Check-In
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Guest checks in and out on the same day
                      </Typography>
                    </Box>
                  }
                />
              </Grid>
            )}
            {/* Dates - only show if room was pre-selected */}
            {showDates && (
              <>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    required
                    type="date"
                    label="Check-in Date"
                    value={checkInDate}
                    onChange={(e) => handleDateChange('checkIn', e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                {!isHourlyBooking && (
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      fullWidth
                      required
                      type="date"
                      label="Check-out Date"
                      value={checkOutDate}
                      onChange={(e) => handleDateChange('checkOut', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                )}
                {isHourlyBooking && (
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Alert severity="info" sx={{ py: 0.5 }}>
                      <Typography variant="body2">
                        Guest will check out at {hotelSettings.check_out_time || '12:00 PM'} on the same day
                      </Typography>
                    </Alert>
                  </Grid>
                )}
              </>
            )}
            {/* Room availability warning for pre-selected rooms */}
            {showDates && roomIsAvailable === false && (
              <Grid size={12}>
                <Alert severity="warning">
                  Room {room?.room_number} is not available for these dates. It has an overlapping booking. Please choose different dates.
                </Alert>
              </Grid>
            )}
            {showDates && checkingAvailability && (
              <Grid size={12}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">Checking room availability...</Typography>
                </Box>
              </Grid>
            )}

            {/* Online booking specific fields */}
            {isOnline && (
              <>
                <Grid size={{ xs: 12, md: 6 }}>
                  <FormControl fullWidth required>
                    <InputLabel>Booking Channel</InputLabel>
                    <Select
                      value={bookingChannel}
                      onChange={(e) => setBookingChannel(e.target.value)}
                      label="Booking Channel"
                    >
                      {BOOKING_CHANNELS.map((channel) => (
                        <MenuItem key={channel.name} value={channel.name}>
                          {channel.abbreviation ? `${channel.name} (${channel.abbreviation})` : channel.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Booking Reference"
                    value={bookingReference}
                    onChange={(e) => setBookingReference(e.target.value)}
                    placeholder="e.g., OL-123456"
                  />
                </Grid>
              </>
            )}

            {/* Custom Rate Override (for walk-in and online, not complimentary) */}
            {(isWalkIn || isOnline) && (
              <>
                <Grid size={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                    Room Rate
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={useCustomRate}
                        onChange={(e) => {
                          setUseCustomRate(e.target.checked);
                          if (e.target.checked && room) {
                            const price = typeof room.price_per_night === 'string'
                              ? parseFloat(room.price_per_night)
                              : room.price_per_night;
                            setCustomRate(price);
                          }
                        }}
                        color="primary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Use Custom Rate
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Override the default room rate
                        </Typography>
                      </Box>
                    }
                  />
                </Grid>
                {useCustomRate && (
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      fullWidth
                      label="Custom Rate per Night"
                      type="number"
                      value={customRate}
                      onChange={(e) => setCustomRate(parseFloat(e.target.value) || 0)}
                      InputProps={{
                        startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>,
                      }}
                      helperText={`Original rate: ${formatCurrency(Number(room?.price_per_night || 0))}/night`}
                    />
                  </Grid>
                )}
              </>
            )}

            {/* Tourism Tax Toggle (for walk-in and online, not complimentary) */}
            {(isWalkIn || isOnline) && (
              <>
                <Grid size={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                    Tourism Tax
                  </Typography>
                </Grid>
                <Grid size={12}>
                  {isTourist ? (
                    <Alert severity="warning" sx={{ py: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Foreign Tourist - Tourism Tax Applies
                      </Typography>
                      <Typography variant="body2">
                        Tourism Tax: {formatCurrency(hotelSettings.tourism_tax_rate)} x {isHourlyBooking ? '1 (hourly stay)' : `${numberOfNights} night(s)`} = {formatCurrency(tourismTaxAmount)}
                      </Typography>
                    </Alert>
                  ) : (
                    <Alert severity="info" sx={{ py: 0.5 }}>
                      <Typography variant="body2">
                        {(isCreatingNewGuest ? newGuestForm.tourism_type : selectedGuest?.tourism_type) === 'local'
                          ? 'Local Tourist - No Tourism Tax'
                          : 'Tourism type not specified - No Tourism Tax'}
                      </Typography>
                    </Alert>
                  )}
                </Grid>
              </>
            )}

            {/* Extra Bed (for walk-in and online, not complimentary) */}
            {(isWalkIn || isOnline) && allowsExtraBed && maxExtraBeds > 0 && (
              <>
                <Grid size={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                    Extra Bed
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Number of Extra Beds"
                    type="number"
                    value={extraBedCount}
                    onChange={(e) => {
                      const count = Math.min(Math.max(parseInt(e.target.value) || 0, 0), maxExtraBeds);
                      setExtraBedCount(count);
                      setExtraBedCharge(count * extraBedChargePerBed);
                    }}
                    inputProps={{ min: 0, max: maxExtraBeds }}
                    helperText={`${formatCurrency(extraBedChargePerBed)} per extra bed (max ${maxExtraBeds})`}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Extra Bed Charge"
                    type="number"
                    value={extraBedCharge}
                    onChange={(e) => setExtraBedCharge(parseFloat(e.target.value) || 0)}
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>,
                    }}
                    helperText="Auto-calculated or manually adjust"
                  />
                </Grid>
              </>
            )}

            {/* Booking Notes */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                Booking Notes
              </Typography>
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Notes"
                value={bookingNotes}
                onChange={(e) => setBookingNotes(e.target.value)}
                placeholder="Add any special requests, remarks, or instructions..."
              />
            </Grid>
          </Grid>
        </Box>
      );
    }

    // Confirm step
    const getModeLabel = () => {
      if (bookingMode === 'direct') return 'Direct Booking';
      if (reservationType === 'walk_in') return 'Walk-in Reservation';
      if (reservationType === 'online') return 'Online Reservation';
      if (reservationType === 'complimentary') return 'Complimentary Reservation';
      return 'Reservation';
    };

    const getModeColor = () => {
      if (bookingMode === 'direct') return BOOKING_MODE_CONFIG.direct.color;
      if (reservationType) return RESERVATION_TYPE_CONFIG[reservationType].color;
      return '#1976d2';
    };

    // Guard: should only reach here for Confirm step
    if (currentStepName !== 'Confirm') {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <CircularProgress />
        </Box>
      );
    }

    return (
      <Box>
        <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
          Review & Confirm
        </Typography>

        <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
          <Grid container spacing={2}>
            {/* Booking Type */}
            <Grid size={12}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Chip
                  label={getModeLabel()}
                  sx={{
                    bgcolor: getModeColor(),
                    color: 'white',
                    fontWeight: 600,
                  }}
                />
              </Box>
            </Grid>

            <Grid size={12}>
              <Divider />
            </Grid>

            {/* Room Info */}
            <Grid size={6}>
              <Typography variant="body2" color="text.secondary">Room</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" fontWeight={600}>
                {room?.room_number} ({room?.room_type})
              </Typography>
            </Grid>

            {/* Guest Info */}
            <Grid size={6}>
              <Typography variant="body2" color="text.secondary">Guest</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" fontWeight={600}>
                {effectiveType === 'complimentary'
                  ? selectedGuestWithCredits?.full_name
                  : isCreatingNewGuest
                    ? `${newGuestForm.first_name} ${newGuestForm.last_name} (New)`
                    : selectedGuest?.full_name}
              </Typography>
            </Grid>

            {/* Dates */}
            <Grid size={6}>
              <Typography variant="body2" color="text.secondary">Check-in</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">{checkInDate}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" color="text.secondary">Check-out</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">{checkOutDate}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" color="text.secondary">Duration</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">
                {isHourlyBooking ? (
                  <Chip label="Hourly Stay" size="small" color="warning" sx={{ height: 20, fontSize: '0.75rem' }} />
                ) : (
                  `${numberOfNights} night(s)`
                )}
              </Typography>
            </Grid>

            {/* Online booking info */}
            {effectiveType === 'online' && bookingChannel && (
              <>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Channel</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">{bookingChannel}</Typography>
                </Grid>
                {bookingReference && (
                  <>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">Reference</Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2">{bookingReference}</Typography>
                    </Grid>
                  </>
                )}
              </>
            )}

            {/* Booking Notes */}
            {bookingNotes.trim() && (
              <>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Notes</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{bookingNotes.trim()}</Typography>
                </Grid>
              </>
            )}

            <Grid size={12}>
              <Divider />
            </Grid>

            {/* Pricing */}
            <Grid size={6}>
              <Typography variant="body2" color="text.secondary">
                Rate{useCustomRate ? ' (Custom)' : ''}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">
                {effectiveType === 'complimentary' ? (
                  <Box component="span" sx={{ textDecoration: 'line-through', color: 'text.disabled' }}>
                    {currencySymbol}{room?.price_per_night}/{isHourlyBooking ? 'stay' : 'night'}
                  </Box>
                ) : useCustomRate && customRate > 0 ? (
                  <>
                    {formatCurrency(customRate)}/{isHourlyBooking ? 'stay' : 'night'}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      (was {formatCurrency(Number(room?.price_per_night || 0))})
                    </Typography>
                  </>
                ) : (
                  `${currencySymbol}${room?.price_per_night}/${isHourlyBooking ? 'stay' : 'night'}`
                )}
              </Typography>
            </Grid>
            {/* Tourism Tax */}
            {isTourist && effectiveType !== 'complimentary' && (
              <>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">
                    Tourism Tax ({formatCurrency(hotelSettings.tourism_tax_rate)}/{isHourlyBooking ? 'stay' : 'night'})
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">
                    {formatCurrency(tourismTaxAmount)}
                  </Typography>
                </Grid>
              </>
            )}

            {/* Extra Bed */}
            {extraBedCount > 0 && effectiveType !== 'complimentary' && (
              <>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">
                    Extra Bed ({extraBedCount})
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">
                    {formatCurrency(extraBedCharge)}
                  </Typography>
                </Grid>
              </>
            )}

            <Grid size={6}>
              <Typography variant="body2" fontWeight={600}>Total</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" fontWeight={600} color={effectiveType === 'complimentary' ? 'success.main' : 'text.primary'}>
                {effectiveType === 'complimentary' ? 'FREE (Complimentary)' : formatCurrency(calculateTotal())}
              </Typography>
            </Grid>


            {/* Credits info for complimentary */}
            {effectiveType === 'complimentary' && selectedGuestWithCredits && (
              <>
                <Grid size={12}>
                  <Divider />
                </Grid>
                <Grid size={12}>
                  <Alert severity="info" sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      Using {numberOfNights} night(s) from guest's free room credits
                    </Typography>
                  </Alert>
                </Grid>
              </>
            )}
          </Grid>
        </Paper>
      </Box>
    );
  };

  const effectiveType = getEffectiveBookingType();

  // Submit button label depends on flow
  const submitLabel = (() => {
    if (processing) return 'Processing…';
    if (bookingMode === 'direct') return 'Create booking · Check in';
    if (effectiveType === 'complimentary') return 'Create complimentary stay';
    return 'Create reservation';
  })();

  // Lenient submit gate — only block on truly impossible state. The downstream
  // submit handlers (createBookingAndHandOff / handleSubmit) already validate
  // guest, channel, etc. and surface precise errors via onError(), so we don't
  // need to disable the button for those cases.
  const formIsValid = (() => {
    if (!room) return false;
    if (!bookingMode) return false;
    if (bookingMode === 'reservation' && !reservationType) return false;
    if (!checkInDate || !checkOutDate) return false;
    if (!isHourlyBooking && new Date(checkOutDate) <= new Date(checkInDate)) return false;
    return true;
  })();

  // Design tokens borrowed from Salim Inn — New Booking · Light
  const D = {
    bg: '#F4F6F8',
    surface: '#FFFFFF',
    surface2: '#F8FAFB',
    surface3: '#EFF2F5',
    border: '#E2E6EC',
    borderHi: '#CBD2DA',
    ink: '#0F172A',
    ink2: '#475569',
    ink3: '#7B8794',
    emerald: '#10A47C',
    emeraldDeep: '#0E8C6A',
    emeraldSoft: '#E7F5EF',
    blue: '#2F7DE1',
    blueSoft: '#E8F1FB',
    green: '#2BA068',
    amber: '#C8941D',
    purple: '#8C4FCF',
    purpleSoft: '#F2EAFB',
    orange: '#D97757',
    orangeSoft: '#FBEFE9',
  };

  // Style preset for the Mode segmented control
  const MODE_OPTIONS: Array<{ k: BookingMode; label: string; desc: string; icon: React.ReactNode }> = [
    { k: 'direct',      label: 'Direct booking', desc: 'Check guest in immediately', icon: <PersonAddIcon sx={{ fontSize: 16 }} /> },
    { k: 'reservation', label: 'Reservation',    desc: 'Reserve for a future date', icon: <BookingIcon sx={{ fontSize: 16 }} /> },
  ];

  // Reservation type tiles
  const TYPE_TILES: Array<{
    k: 'walk_in' | 'online' | 'complimentary';
    label: string;
    desc: string;
    icon: React.ReactNode;
    color: string;
    soft: string;
  }> = [
    { k: 'walk_in',       label: 'Walk-in',       desc: 'In person or by phone',  icon: <PersonAddIcon sx={{ fontSize: 20 }} />, color: D.orange, soft: D.orangeSoft },
    { k: 'online',        label: 'Online',        desc: 'OTA or website booking', icon: <BookingIcon sx={{ fontSize: 20 }} />,   color: D.blue,   soft: D.blueSoft },
    { k: 'complimentary', label: 'Complimentary', desc: 'Use guest free credits', icon: <GiftIcon sx={{ fontSize: 20 }} />,      color: D.purple, soft: D.purpleSoft },
  ];

  // Map a booking channel name → 1-2 letter logo + brand colour
  const channelLogo = (name: string): { letters: string; bg: string; fg: string } => {
    const lc = name.toLowerCase();
    if (lc.includes('agoda'))     return { letters: 'A',  bg: '#FF4E63', fg: '#fff' };
    if (lc.includes('booking'))   return { letters: 'B.', bg: '#003580', fg: '#fff' };
    if (lc.includes('traveloka')) return { letters: 'T',  bg: '#0194F3', fg: '#fff' };
    if (lc.includes('expedia'))   return { letters: 'E',  bg: '#FFC72C', fg: '#1F2F4F' };
    if (lc.includes('airbnb'))    return { letters: 'A',  bg: '#FF5A5F', fg: '#fff' };
    if (lc.includes('hotels'))    return { letters: 'H',  bg: '#D32F2F', fg: '#fff' };
    if (lc.includes('trip'))      return { letters: 'TR', bg: '#287DFA', fg: '#fff' };
    if (lc.includes('direct'))    return { letters: '⌂',  bg: D.emerald, fg: '#fff' };
    return { letters: '+', bg: '#94A3B8', fg: '#fff' };
  };

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
      return parseLocalDate(d).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return d; }
  };

  // Selected guest display (handles new/existing)
  const summaryGuestName = (() => {
    if (effectiveType === 'complimentary') return selectedGuestWithCredits?.full_name || '—';
    if (isCreatingNewGuest) return [newGuestForm.first_name, newGuestForm.last_name].filter(Boolean).join(' ') || '—';
    return selectedGuest?.full_name || '—';
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
    ? 'Walk-in · Direct'
    : `${effectiveType === 'walk_in' ? 'Walk-in' : effectiveType === 'complimentary' ? 'Complimentary' : 'Online'} · Reservation`;

  // Rate per night used for the summary preview
  const ratePerNight = useCustomRate && customRate > 0
    ? customRate
    : (typeof room?.price_per_night === 'string' ? parseFloat(room.price_per_night) : (room?.price_per_night || 0));
  const subtotal = ratePerNight * billableNights;
  const total = calculateTotal();

  // Step glyphs auto-shift down when the Room picker section is rendered up
  // top — keeps the labels in sync without needing per-call offsets.
  const STEP_GLYPHS = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
  const step = (i: number) => STEP_GLYPHS[i - 1 + (needsRoomSelection ? 1 : 0)] ?? '·';

  // SECTION header used throughout the form
  const sectionHeader = (number: string, label: React.ReactNode) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
      <Typography sx={{ m: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: D.ink3, textTransform: 'uppercase' }}>
        {number} {label}
      </Typography>
      <Box sx={{ flex: 1, height: 1, bgcolor: D.border }} />
    </Box>
  );

  // KBD chip
  const kbd = (txt: string) => (
    <Box component="kbd" sx={{ bgcolor: '#fff', border: `1px solid ${D.border}`, px: 0.75, py: '1px', borderRadius: 0.5, fontSize: 10, fontFamily: 'inherit', color: D.ink2 }}>{txt}</Box>
  );

  return (
    <Dialog
      open={open}
      onClose={() => !processing && onClose()}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          width: 'min(1040px, 100%)',
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 48px)',
          borderRadius: 2,
          overflow: 'hidden',
          border: `1px solid ${D.border}`,
          boxShadow: '0 20px 50px rgba(15,23,42,0.18)',
        },
      }}
    >
      {/* ============= HEADER ============= */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, px: 2.75, py: 2, borderBottom: `1px solid ${D.border}`, bgcolor: D.surface }}>
        <Box sx={{
          width: 40,
          height: 40,
          borderRadius: 1.25,
          background: `linear-gradient(135deg, ${D.emerald}, ${D.emeraldDeep})`,
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
        }}>
          <HotelIcon sx={{ fontSize: 22 }} />
        </Box>
        <Box>
          <Typography sx={{ m: 0, fontSize: 17, fontWeight: 700, color: D.ink, lineHeight: 1.2 }}>
            New Booking
          </Typography>
          <Typography sx={{ m: 0, mt: '2px', fontSize: 12, color: D.ink3 }}>
            Set type, guest, dates and rate — all on one screen
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {room && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, bgcolor: D.surface2, border: `1px solid ${D.border}`, borderRadius: 1.25, px: 1.5, py: 0.75 }}>
            <Typography sx={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px', color: D.ink, lineHeight: 1 }}>
              {room.room_number}
            </Typography>
            <Box>
              <Typography sx={{ fontSize: 10, fontWeight: 700, color: D.ink3, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                {room.room_type}
              </Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: D.green, mt: '1px' }}>
                ● {roomIsAvailable === false ? 'Unavailable' : 'Available'}
              </Typography>
            </Box>
          </Box>
        )}
        <IconButton
          onClick={onClose}
          disabled={processing}
          aria-label="Close"
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1,
            color: D.ink3,
            border: '1px solid transparent',
            '&:hover': { borderColor: D.border, bgcolor: D.surface2, color: D.ink },
          }}
        >
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

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
            <Box sx={{ mb: 2.75 }}>
              {sectionHeader('①', 'Room')}
              <Autocomplete
                size="small"
                value={selectedRoom}
                onChange={(_, value) => setSelectedRoom(value)}
                options={
                  // Prefer date-filtered availability list when dates are set;
                  // otherwise fall back to the full rooms array.
                  availableRooms.length > 0
                    ? availableRooms
                    : sortRoomsByNumber(rooms)
                }
                loading={loadingAvailableRooms}
                getOptionLabel={(o) => o ? `Room ${o.room_number} · ${o.room_type}` : ''}
                isOptionEqualToValue={(o, v) => String(o.id) === String(v?.id)}
                renderOption={(props, option) => {
                  const { key, ...rest } = props;
                  const price = typeof option.price_per_night === 'string'
                    ? parseFloat(option.price_per_night)
                    : (option.price_per_night || 0);
                  return (
                    <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.5px', color: D.ink, minWidth: 38 }}>
                        {option.room_number}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ fontSize: 13, fontWeight: 600, color: D.ink, textTransform: 'capitalize' }}>
                          {option.room_type}
                        </Box>
                        <Box sx={{ fontSize: 11, color: D.ink3 }}>
                          {price > 0 ? `${currencySymbol} ${price.toFixed(2)} / night` : 'Rate not set'}
                          {option.floor != null ? ` · Floor ${option.floor}` : ''}
                        </Box>
                      </Box>
                    </Box>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    placeholder={
                      !checkInDate || !checkOutDate
                        ? 'Pick a room (set dates below to filter by availability)'
                        : loadingAvailableRooms
                          ? 'Loading available rooms…'
                          : 'Select a room'
                    }
                    sx={{ bgcolor: '#fff' }}
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <Box sx={{ pl: 0.5, pr: 0.75, color: D.ink3, display: 'inline-flex' }}>
                          <SearchIcon sx={{ fontSize: 16 }} />
                        </Box>
                      ),
                    }}
                  />
                )}
              />
              {checkInDate && checkOutDate && availableRooms.length === 0 && !loadingAvailableRooms && (
                <Typography sx={{ mt: 0.75, fontSize: 11, color: D.ink3, fontStyle: 'italic' }}>
                  No rooms available for the selected dates — pick different dates below.
                </Typography>
              )}
            </Box>
          )}

          {/* ① Mode */}
          <Box sx={{ mb: 2.75 }}>
            {sectionHeader(step(1), 'Mode')}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 1,
              bgcolor: D.surface2,
              border: `1px solid ${D.border}`,
              borderRadius: 1.5,
              p: '5px',
            }}>
              {MODE_OPTIONS.map((m) => {
                const on = bookingMode === m.k;
                return (
                  <Box
                    key={m.k}
                    component="button"
                    onClick={() => handleModeSelect(m.k)}
                    sx={{
                      bgcolor: on ? '#fff' : 'transparent',
                      border: on ? `1px solid ${D.emerald}` : '1px solid transparent',
                      borderRadius: 1,
                      px: 1.5,
                      py: 1.25,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.25,
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      color: on ? D.ink : D.ink2,
                      boxShadow: on ? `0 0 0 1px ${D.emerald} inset, 0 1px 3px rgba(15,23,42,0.06)` : 'none',
                    }}
                  >
                    <Box sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1,
                      bgcolor: on ? D.emeraldSoft : D.surface3,
                      color: on ? D.emerald : D.ink2,
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}>
                      {m.icon}
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: D.ink, lineHeight: 1.2 }}>{m.label}</Typography>
                      <Typography sx={{ fontSize: 11, color: D.ink3, mt: '1px' }}>{m.desc}</Typography>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* ② Reservation type — only when mode === reservation */}
          {bookingMode === 'reservation' && (
            <Box sx={{ mb: 2.75 }}>
              {sectionHeader(step(2), 'Reservation type')}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.25 }}>
                {TYPE_TILES.map((t) => {
                  const on = reservationType === t.k;
                  return (
                    <Box
                      key={t.k}
                      component="button"
                      onClick={() => handleReservationTypeSelect(t.k)}
                      sx={{
                        bgcolor: on ? t.soft : '#fff',
                        border: `1.5px solid ${on ? t.color : D.border}`,
                        borderRadius: 1.5,
                        p: '14px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 1.25,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        color: D.ink,
                        textAlign: 'center',
                        transition: 'border-color 120ms, background 120ms',
                        '&:hover': { borderColor: on ? t.color : D.borderHi },
                      }}
                    >
                      <Box sx={{ width: 38, height: 38, borderRadius: 1.25, display: 'grid', placeItems: 'center', bgcolor: t.soft, color: t.color }}>
                        {t.icon}
                      </Box>
                      <Box>
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: D.ink, lineHeight: 1.2 }}>{t.label}</Typography>
                        <Typography sx={{ fontSize: 11, color: D.ink3, lineHeight: 1.35 }}>{t.desc}</Typography>
                      </Box>
                      {on && (
                        <Box sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: t.color, bgcolor: '#fff', border: `1px solid ${t.color}`, px: 0.85, py: '2px', borderRadius: 999 }}>
                          SELECTED
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>

              {/* Channel picker — only for Online */}
              {reservationType === 'online' && (
                <Box sx={{ mt: 1.5, bgcolor: D.blueSoft, border: `1px solid ${alpha(D.blue, 0.25)}`, borderRadius: 1.5, p: 1.75 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12, fontWeight: 700, color: D.blue, mb: 1.25 }}>
                    <PublicIcon sx={{ fontSize: 14 }} /> Booking channel <Box component="span" sx={{ color: D.blue }}>*</Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                    {BOOKING_CHANNELS.map((channel) => {
                      const on = bookingChannel === channel.name;
                      const logo = channelLogo(channel.name);
                      return (
                        <Box
                          key={channel.name}
                          component="button"
                          onClick={() => setBookingChannel(channel.name)}
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 1,
                            bgcolor: on ? D.blue : '#fff',
                            border: `1px solid ${on ? D.blue : D.border}`,
                            borderRadius: 999,
                            pl: '5px',
                            pr: 1.75,
                            py: '5px',
                            fontSize: 12,
                            fontWeight: on ? 600 : 500,
                            color: on ? '#fff' : D.ink2,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            boxShadow: on ? `0 2px 8px ${alpha(D.blue, 0.30)}` : 'none',
                          }}
                        >
                          <Box sx={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: '-0.5px',
                            bgcolor: on ? 'rgba(255,255,255,0.2)' : logo.bg,
                            color: on ? '#fff' : logo.fg,
                          }}>
                            {logo.letters}
                          </Box>
                          {channel.name}
                        </Box>
                      );
                    })}
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 1.5 }}>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Booking reference *</Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="e.g. 2004721892"
                        value={bookingReference}
                        onChange={(e) => setBookingReference(e.target.value)}
                        sx={{ bgcolor: '#fff' }}
                      />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Prepaid amount</Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder={`${currencySymbol} 0.00`}
                        sx={{ bgcolor: '#fff' }}
                        disabled
                        helperText="Tracked at check-in"
                      />
                    </Box>
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {/* ③ Guest */}
          <Box sx={{ mb: 2.75 }}>
            {sectionHeader(step(3), 'Guest')}
            <GuestSelector
              guests={guests}
              selectedGuest={selectedGuest}
              onGuestSelect={setSelectedGuest}
              isCreatingNew={isCreatingNewGuest}
              onToggleMode={handleToggleGuestMode}
              newGuestForm={newGuestForm}
              onNewGuestFormChange={setNewGuestForm}
              filterByCredits={effectiveType === 'complimentary'}
              guestsWithCredits={guestsWithCredits}
              selectedGuestWithCredits={selectedGuestWithCredits}
              onGuestWithCreditsSelect={setSelectedGuestWithCredits}
              loadingGuestsWithCredits={loadingGuestsWithCredits}
            />
          </Box>

          {/* ④ Stay */}
          <Box sx={{ mb: 2.75 }}>
            {sectionHeader(step(4), 'Stay')}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 1.5, alignItems: 'flex-end' }}>
              <Box>
                <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Check-in</Typography>
                <TextField
                  type="date"
                  fullWidth
                  size="small"
                  value={checkInDate}
                  onChange={(e) => handleDateChange('checkIn', e.target.value)}
                  helperText={formatHumanDate(checkInDate)}
                  sx={{ bgcolor: '#fff' }}
                />
              </Box>
              <Box sx={{ pb: 4, color: D.ink3 }}>
                <ArrowForwardIcon sx={{ fontSize: 18 }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Check-out</Typography>
                <TextField
                  type="date"
                  fullWidth
                  size="small"
                  value={checkOutDate}
                  onChange={(e) => handleDateChange('checkOut', e.target.value)}
                  disabled={isHourlyBooking}
                  helperText={formatHumanDate(checkOutDate)}
                  sx={{ bgcolor: '#fff' }}
                />
              </Box>
            </Box>
            <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
              <Box sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                bgcolor: D.emeraldSoft,
                color: D.emerald,
                border: `1px solid ${alpha(D.emerald, 0.3)}`,
                borderRadius: 999,
                px: 1.25,
                py: 0.5,
                fontSize: 11,
                fontWeight: 700,
              }}>
                <MoonIcon sx={{ fontSize: 12 }} />
                {billableNights} {billableNights === 1 ? 'night' : 'nights'}
              </Box>
              <Typography sx={{ color: D.ink3, fontSize: 11 }}>Quick set:</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {[
                  { k: '1', label: '1 night', n: 1 },
                  { k: '2', label: '2 nights', n: 2 },
                  { k: '3', label: '3 nights', n: 3 },
                  { k: '7', label: '1 week', n: 7 },
                ].map((q) => (
                  <Box
                    key={q.k}
                    component="button"
                    onClick={() => setNights(q.n)}
                    sx={{
                      bgcolor: '#fff',
                      border: `1px solid ${D.border}`,
                      color: D.ink2,
                      borderRadius: 999,
                      px: 1.25,
                      py: 0.5,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      '&:hover': { borderColor: D.borderHi, color: D.ink },
                    }}
                  >
                    {q.label}
                  </Box>
                ))}
              </Box>
              <Box sx={{ ml: 'auto', fontSize: 11, color: D.ink2 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={isHourlyBooking}
                      onChange={(e) => handleHourlyToggle(e.target.checked)}
                      size="small"
                      sx={{ p: 0.5 }}
                    />
                  }
                  label={<Box sx={{ fontSize: 11, color: D.ink2 }}>Hourly check-in</Box>}
                  sx={{ m: 0 }}
                />
              </Box>
            </Box>
          </Box>

          {/* ⑤ Rate & payment */}
          <Box sx={{ mb: 2.75 }}>
            {sectionHeader(step(5), 'Rate & payment')}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <Box>
                <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Rate per night</Typography>
                <TextField
                  type="number"
                  size="small"
                  fullWidth
                  value={useCustomRate ? customRate : (typeof room?.price_per_night === 'string' ? parseFloat(room.price_per_night) : (room?.price_per_night || 0))}
                  onChange={(e) => {
                    setCustomRate(parseFloat(e.target.value) || 0);
                    setUseCustomRate(true);
                  }}
                  InputProps={{ startAdornment: <Box sx={{ color: D.ink3, mr: 1, fontSize: 13 }}>{currencySymbol}</Box> }}
                  sx={{ bgcolor: '#fff' }}
                />
              </Box>
              <Box>
                <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Tourism status</Typography>
                <TextField
                  size="small"
                  fullWidth
                  value={isTourist ? `Foreign guest (${currencySymbol} ${hotelSettings.tourism_tax_rate}/night)` : 'Local — no tourism tax'}
                  disabled
                  helperText="Set on the guest profile"
                  sx={{ bgcolor: '#fff' }}
                />
              </Box>
            </Box>
            <Box
              component="label"
              sx={{
                mt: 1.25,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.25,
                p: 1.5,
                border: `1px solid ${useCustomRate ? D.emerald : D.border}`,
                borderRadius: 1.25,
                bgcolor: useCustomRate ? D.emeraldSoft : '#fff',
                cursor: 'pointer',
              }}
            >
              <Checkbox
                checked={useCustomRate}
                onChange={(e) => setUseCustomRate(e.target.checked)}
                size="small"
                sx={{ p: 0, mt: 0.25 }}
              />
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: D.ink }}>Use custom rate</Typography>
                <Typography sx={{ fontSize: 11, color: D.ink3, mt: 0.25 }}>
                  Override the default rate of {formatCurrency(typeof room?.price_per_night === 'string' ? parseFloat(room.price_per_night) : (room?.price_per_night || 0))} / night
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Notes */}
          <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
              <Typography sx={{ m: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: D.ink3, textTransform: 'uppercase' }}>
                {step(6)} Notes
              </Typography>
              <Typography sx={{ fontSize: 11, color: D.ink3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                · optional
              </Typography>
              <Box sx={{ flex: 1, height: 1, bgcolor: D.border }} />
            </Box>
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              placeholder="Special requests, deposit info, payment notes…"
              value={bookingNotes}
              onChange={(e) => setBookingNotes(e.target.value)}
              sx={{ bgcolor: '#fff' }}
            />
          </Box>
        </Box>

        {/* RIGHT — LIVE SUMMARY */}
        <Box sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          gap: 1.75,
          bgcolor: D.surface2,
          borderLeft: `1px solid ${D.border}`,
          p: 2.75,
          overflowY: 'auto',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 11, letterSpacing: 1.2, fontWeight: 700, color: D.ink3, textTransform: 'uppercase' }}>
            <SummaryIcon sx={{ fontSize: 14 }} /> Booking summary
          </Box>

          {room && (
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1.75,
              bgcolor: '#fff',
              border: `1px solid ${D.border}`,
              borderRadius: 1.5,
              borderLeft: `4px solid ${D.green}`,
            }}>
              <Box>
                <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, color: D.ink }}>
                  {room.room_number}
                </Typography>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: D.ink3, letterSpacing: 0.6, mt: 0.25, textTransform: 'uppercase' }}>
                  {room.room_type}
                </Typography>
                <Typography sx={{ fontSize: 11, color: D.green, fontWeight: 700, mt: 0.5 }}>
                  ● {roomIsAvailable === false ? 'Conflict' : 'Available now'}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, textAlign: 'right' }}>
                <Box sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  px: 1,
                  py: 0.4,
                  borderRadius: 999,
                  bgcolor: tagSoft,
                  color: tagColor,
                }}>
                  {tagLabel}
                </Box>
              </Box>
            </Box>
          )}

          <Box sx={{ bgcolor: '#fff', border: `1px solid ${D.border}`, borderRadius: 1.5, p: 1.75 }}>
            {[
              { k: 'Guest',     v: summaryGuestName },
              { k: 'Source',    v: effectiveType === 'online' ? (bookingChannel || '—') : (effectiveType === 'walk_in' ? 'Walk-in' : effectiveType === 'complimentary' ? 'Free credit' : '—') },
              { k: 'Check-in',  v: formatHumanDate(checkInDate) || '—' },
              { k: 'Check-out', v: isHourlyBooking ? `${formatHumanDate(checkInDate)} (hourly)` : (formatHumanDate(checkOutDate) || '—') },
              { k: 'Duration',  v: `${billableNights} ${billableNights === 1 ? 'night' : 'nights'}` },
            ].map((r) => (
              <Box key={r.k} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', py: 0.75, fontSize: 12.5 }}>
                <Box sx={{ color: D.ink3 }}>{r.k}</Box>
                <Box sx={{ color: D.ink, fontWeight: 600, textAlign: 'right', maxWidth: '62%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.v}</Box>
              </Box>
            ))}
          </Box>

          <Box sx={{ bgcolor: '#fff', border: `1px solid ${D.border}`, borderRadius: 1.5, p: 1.75 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
              <Box sx={{ color: D.ink3 }}>Rate</Box>
              <Box sx={{ color: D.ink, fontWeight: 600 }}>{formatCurrency(ratePerNight)} / night</Box>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
              <Box sx={{ color: D.ink3 }}>Subtotal (×{billableNights})</Box>
              <Box sx={{ color: D.ink, fontWeight: 600 }}>{formatCurrency(subtotal)}</Box>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
              <Box sx={{ color: D.ink3 }}>Tourism tax</Box>
              <Box sx={{ color: tourismTaxAmount > 0 ? D.ink : D.ink3, fontWeight: tourismTaxAmount > 0 ? 600 : 500 }}>
                {tourismTaxAmount > 0 ? formatCurrency(tourismTaxAmount) : '—'}
              </Box>
            </Box>
            {extraBedCharge > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
                <Box sx={{ color: D.ink3 }}>Extra bed</Box>
                <Box sx={{ color: D.ink, fontWeight: 600 }}>{formatCurrency(extraBedCharge)}</Box>
              </Box>
            )}
            <Box sx={{
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: `1px solid ${D.border}`,
              mt: 1,
              pt: 1.5,
              fontSize: 14,
            }}>
              <Box sx={{ color: D.ink, fontWeight: 700 }}>Total</Box>
              <Box sx={{ color: D.emerald, fontWeight: 800, fontSize: 20, letterSpacing: '-0.4px' }}>
                {formatCurrency(total)}
              </Box>
            </Box>
          </Box>

          <Box sx={{
            bgcolor: '#fff',
            border: `1px solid ${D.border}`,
            borderRadius: 1.5,
            p: 1.5,
            fontSize: 11,
            color: D.ink2,
            lineHeight: 1.5,
          }}>
            {checkingAvailability ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: D.ink3 }}>
                <CircularProgress size={12} /> Checking availability…
              </Box>
            ) : roomIsAvailable === false ? (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: D.orange, fontWeight: 700, mb: 0.5 }}>
                  <CheckIcon sx={{ fontSize: 13 }} /> Room conflict
                </Box>
                Another booking exists for the selected dates.
              </Box>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: D.green, fontWeight: 700, mb: 0.5 }}>
                  <CheckIcon sx={{ fontSize: 13 }} /> No conflicts found
                </Box>
                {checkInDate && checkOutDate && room
                  ? `Room is available for ${formatHumanDate(checkInDate)} → ${formatHumanDate(checkOutDate)}.`
                  : 'Pick check-in and check-out dates to verify.'}
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* ============= FOOTER ============= */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 2.75,
        py: 1.75,
        borderTop: `1px solid ${D.border}`,
        bgcolor: D.surface2,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: D.ink3, fontSize: 12 }}>
          {kbd('Esc')} cancel
          <Box component="span" sx={{ mx: 0.5 }}>·</Box>
          {kbd('⌘ Enter')} create
        </Box>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={onClose}
          disabled={processing}
          sx={{
            color: D.ink2,
            textTransform: 'none',
            px: 2,
            py: 1,
            borderRadius: 1,
            border: '1px solid transparent',
            '&:hover': { color: D.ink, bgcolor: D.surface3 },
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={processing || !formIsValid}
          startIcon={processing ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <CheckIcon sx={{ fontSize: 14 }} />}
          sx={{
            background: `linear-gradient(180deg, ${D.emerald}, ${D.emeraldDeep})`,
            border: `1px solid ${D.emeraldDeep}`,
            color: '#fff',
            textTransform: 'none',
            px: 2,
            py: 1.1,
            borderRadius: 1,
            fontWeight: 600,
            boxShadow: '0 1px 0 rgba(255,255,255,0.25) inset, 0 4px 14px rgba(16,164,124,0.3)',
            '&:hover': { filter: 'brightness(1.05)', background: `linear-gradient(180deg, ${D.emerald}, ${D.emeraldDeep})` },
            '&.Mui-disabled': { background: D.surface3, color: D.ink3, border: `1px solid ${D.border}`, boxShadow: 'none' },
          }}
        >
          {submitLabel}
        </Button>
      </Box>
    </Dialog>
  );
};

export default React.memo(UnifiedBookingModal);
