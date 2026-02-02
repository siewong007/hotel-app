import React, { useState, useEffect, useRef } from 'react';
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
  Tabs,
  Tab,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  PersonAdd as PersonAddIcon,
  EventAvailable as BookingIcon,
  CardGiftcard as GiftIcon,
  Hotel as HotelIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { Room, Guest, Booking, CheckInRequest, GuestUpdateRequest, BookingUpdateRequest } from '../../../types';
import { HotelAPIService } from '../../../api';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings } from '../../../utils/hotelSettings';
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
  initialBookingType,
  onSuccess,
  onError,
  onBookingCreated,
  onRefreshData,
}) => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const BOOKING_CHANNELS = getHotelSettings().booking_channels;
  const roomCardDepositDefault = getHotelSettings().room_card_deposit;

  // Determine if we need room selection (when room is not pre-selected)
  const needsRoomSelection = !roomProp;

  // Stepper state
  const [activeStep, setActiveStep] = useState(0);
  const [bookingMode, setBookingMode] = useState<BookingMode | null>(null);
  const [reservationType, setReservationType] = useState<'walk_in' | 'online' | 'complimentary' | null>(null);

  // Guest state
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [newGuestForm, setNewGuestForm] = useState<NewGuestForm>(emptyNewGuestForm);
  const [isCreatingNewGuest, setIsCreatingNewGuest] = useState(false);
  const [guestsWithCredits, setGuestsWithCredits] = useState<GuestWithCredits[]>([]);
  const [selectedGuestWithCredits, setSelectedGuestWithCredits] = useState<GuestWithCredits | null>(null);
  const [loadingGuestsWithCredits, setLoadingGuestsWithCredits] = useState(false);

  // Booking details state
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [numberOfNights, setNumberOfNights] = useState(1);
  const [bookingChannel, setBookingChannel] = useState('');
  const [bookingReference, setBookingReference] = useState('');

  // Payment state (for walk-in)
  const [deposit, setDeposit] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [roomCardDeposit, setRoomCardDeposit] = useState(roomCardDepositDefault);

  // Custom rate override state
  const [useCustomRate, setUseCustomRate] = useState(false);
  const [customRate, setCustomRate] = useState<number>(0);

  // Processing state
  const [processing, setProcessing] = useState(false);

  // Room selection state (when room is not pre-selected)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [loadingAvailableRooms, setLoadingAvailableRooms] = useState(false);

  // Check-in step state (for direct booking)
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  const [createdGuest, setCreatedGuest] = useState<Guest | null>(null);
  const [checkInTabIndex, setCheckInTabIndex] = useState(0);
  const [guestUpdateData, setGuestUpdateData] = useState<GuestUpdateRequest>({});
  const [bookingUpdateData, setBookingUpdateData] = useState<BookingUpdateRequest>({});
  const [rateCodes, setRateCodes] = useState<string[]>([]);
  const [marketCodes, setMarketCodes] = useState<string[]>([]);

  // Use selected room or prop room
  const room = roomProp || selectedRoom;

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      // Set defaults
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      setCheckInDate(today);
      setCheckOutDate(tomorrow);
      setNumberOfNights(1);
      setActiveStep(0);
      setBookingMode(null);
      setReservationType(null);
      setSelectedRoom(null);
      setAvailableRooms([]);
    } else {
      // Reset all state when closing
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
      setBookingChannel('');
      setBookingReference('');
      setDeposit(0);
      setPaymentMethod('cash');
      setRoomCardDeposit(roomCardDepositDefault);
      setUseCustomRate(false);
      setCustomRate(0);
      setSelectedRoom(null);
      setAvailableRooms([]);
      // Reset check-in state
      setCreatedBooking(null);
      setCreatedGuest(null);
      setCheckInTabIndex(0);
      setGuestUpdateData({});
      setBookingUpdateData({});
    }
  }, [open, roomCardDepositDefault]);

  // Store rooms in a ref to avoid dependency issues
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  // Fetch available rooms when dates change (for room selection mode)
  useEffect(() => {
    // Only fetch when we need room selection and have valid dates
    if (!needsRoomSelection || !checkInDate || !checkOutDate) {
      return;
    }

    const fetchAvailableRooms = async () => {
      setLoadingAvailableRooms(true);
      try {
        // Fetch available rooms for the date range
        const available = await HotelAPIService.getAvailableRoomsForDates(checkInDate, checkOutDate);
        setAvailableRooms(available);
      } catch (error) {
        console.error('Failed to fetch available rooms:', error);
        // Fall back to all rooms if search fails
        setAvailableRooms(roomsRef.current);
      } finally {
        setLoadingAvailableRooms(false);
      }
    };

    fetchAvailableRooms();
  }, [needsRoomSelection, checkInDate, checkOutDate]);

  // Load guests with credits when complimentary reservation is selected
  useEffect(() => {
    if (reservationType === 'complimentary' && open) {
      loadGuestsWithCredits();
    }
  }, [reservationType, open]);

  // Load rate/market codes when entering check-in step
  useEffect(() => {
    const loadDropdownData = async () => {
      try {
        const [ratesResp, marketsResp] = await Promise.all([
          HotelAPIService.getRateCodes(),
          HotelAPIService.getMarketCodes(),
        ]);
        setRateCodes(ratesResp.rate_codes);
        setMarketCodes(marketsResp.market_codes);
      } catch (err) {
        console.error('Failed to load dropdown data:', err);
      }
    };

    if (createdBooking && open) {
      loadDropdownData();
    }
  }, [createdBooking, open]);

  const loadGuestsWithCredits = async () => {
    setLoadingGuestsWithCredits(true);
    try {
      const response = await HotelAPIService.getMyGuestsWithCredits();
      // Filter to only show guests who have any credits
      const filteredGuests = response.filter(g => g.total_complimentary_credits > 0);
      setGuestsWithCredits(filteredGuests);
    } catch (error) {
      console.error('Failed to load guests with credits:', error);
    } finally {
      setLoadingGuestsWithCredits(false);
    }
  };

  // Calculate nights when dates change
  const handleDateChange = (field: 'checkIn' | 'checkOut', value: string) => {
    if (field === 'checkIn') {
      setCheckInDate(value);
      if (checkOutDate) {
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

  // Handle member selection - reset room card deposit
  const handleMemberSelected = (isMember: boolean) => {
    if (isMember) {
      setRoomCardDeposit(0);
    } else {
      setRoomCardDeposit(roomCardDepositDefault);
    }
  };

  // Get steps based on booking mode and room selection need
  const getSteps = (): string[] => {
    if (needsRoomSelection) {
      // Room selection mode: add Room step after Mode
      if (bookingMode === 'direct') {
        return ['Mode', 'Room', 'Guest', 'Dates & Payment', 'Confirm', 'Check-In'];
      } else if (bookingMode === 'reservation') {
        return ['Mode', 'Type', 'Room', 'Guest', 'Details', 'Confirm'];
      }
      return ['Mode', 'Room', 'Guest', 'Details', 'Confirm'];
    } else {
      // Room pre-selected: original flow
      if (bookingMode === 'direct') {
        return ['Mode', 'Guest', 'Dates & Payment', 'Confirm', 'Check-In'];
      } else if (bookingMode === 'reservation') {
        return ['Mode', 'Type', 'Guest', 'Details', 'Confirm'];
      }
      return ['Mode', 'Guest', 'Details', 'Confirm'];
    }
  };

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
        if (new Date(checkOutDate) <= new Date(checkInDate)) return false;
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
        if (new Date(checkOutDate) <= new Date(checkInDate)) return false;
        return true;

      case 'Details':
        // For reservation mode
        if (!needsRoomSelection) {
          // Dates validation needed only when room is pre-selected
          if (!checkInDate || !checkOutDate) return false;
          if (new Date(checkOutDate) <= new Date(checkInDate)) return false;
        }
        if (reservationType === 'online' && !bookingChannel) return false;
        return true;

      case 'Confirm':
        return true;

      case 'Check-In':
        // Check-in step validation - require first name at minimum
        return !!(guestUpdateData.first_name && guestUpdateData.first_name.trim());

      default:
        return false;
    }
  };

  // Handle next step
  const handleNext = async () => {
    const steps = getSteps();
    const currentStepName = steps[activeStep];

    // For direct booking, create the booking when moving from Confirm to Check-In step
    if (bookingMode === 'direct' && currentStepName === 'Confirm') {
      await createBookingForCheckIn();
      return;
    }

    setActiveStep((prev) => prev + 1);
  };

  // Create booking and transition to check-in step (for direct booking)
  const createBookingForCheckIn = async () => {
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
      const effectiveRoomCardDeposit = isMember ? 0 : roomCardDeposit;

      const bookingData = {
        guest_id: guestToUse.id,
        room_id: String(room.id),
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        number_of_guests: 1,
        post_type: 'normal_stay' as const,
        booking_remarks: isMember ? 'Walk-In Guest (Member - Card Deposit Waived)' : 'Walk-In Guest',
        source: 'walk_in' as const,
        room_card_deposit: effectiveRoomCardDeposit,
        payment_method: paymentMethod,
        amount_paid: deposit,
        room_rate_override: useCustomRate && customRate > 0 ? customRate : undefined,
      };

      const createdBookingResult = await HotelAPIService.createBooking(bookingData);

      // Create booking object for check-in step
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
        payment_method: paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Card' : paymentMethod === 'bank_transfer' ? 'Bank Transfer' : 'E-Wallet',
        post_type: createdBookingResult.post_type,
        created_at: createdBookingResult.created_at,
        updated_at: createdBookingResult.updated_at,
      };

      // Parse full_name into first and last name
      const nameParts = guestToUse.full_name?.split(' ') || [];
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Initialize guest update data from guest
      setGuestUpdateData({
        first_name: firstName,
        last_name: lastName,
        email: guestToUse.email,
        phone: guestToUse.phone,
        ic_number: guestToUse.ic_number,
        nationality: guestToUse.nationality,
        address_line1: guestToUse.address_line1,
        city: guestToUse.city,
        state_province: guestToUse.state_province,
        postal_code: guestToUse.postal_code,
        country: guestToUse.country,
        title: guestToUse.title,
        alt_phone: guestToUse.alt_phone,
      });

      // Initialize booking update data
      setBookingUpdateData({
        market_code: 'WKII',
        rate_code: 'RACK',
        payment_method: paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Credit Card' : paymentMethod === 'bank_transfer' ? 'Online Banking' : 'E-Wallet',
      });

      setCreatedBooking(bookingForCheckIn);
      setCreatedGuest(guestToUse);
      setActiveStep((prev) => prev + 1);
    } catch (error: any) {
      onError(error.message || 'Failed to create booking');
    } finally {
      setProcessing(false);
    }
  };

  // Handle back step
  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  // Handle mode selection (Step 0)
  const handleModeSelect = (mode: BookingMode) => {
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
    setReservationType(type);
    // Reset guest state when changing type
    setSelectedGuest(null);
    setSelectedGuestWithCredits(null);
    setIsCreatingNewGuest(false);
    setNewGuestForm(emptyNewGuestForm);
  };

  // Get effective booking type for submission (combines mode + reservation type)
  const getEffectiveBookingType = (): 'walk_in' | 'online' | 'complimentary' | null => {
    if (bookingMode === 'direct') {
      return 'walk_in'; // Direct booking uses walk_in flow but checks in immediately
    }
    return reservationType;
  };

  // Submit booking (or complete check-in for direct booking)
  const handleSubmit = async () => {
    const steps = getSteps();
    const currentStepName = steps[activeStep];

    // Handle check-in completion for direct booking
    if (bookingMode === 'direct' && currentStepName === 'Check-In' && createdBooking) {
      await completeCheckIn();
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
          const effectiveRoomCardDeposit = isMember ? 0 : roomCardDeposit;

          const bookingData = {
            guest_id: guestToUse!.id,
            room_id: String(room.id),
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            number_of_guests: 1,
            post_type: 'normal_stay' as const,
            booking_remarks: isMember ? 'Walk-In Guest (Member - Card Deposit Waived)' : 'Walk-In Guest',
            source: 'walk_in' as const,
            room_card_deposit: effectiveRoomCardDeposit,
            payment_method: paymentMethod,
            amount_paid: deposit,
            room_rate_override: useCustomRate && customRate > 0 ? customRate : undefined,
          };

          await HotelAPIService.createBooking(bookingData);

          onSuccess(`Reservation created for ${guestToUse!.full_name} in Room ${room.room_number}`);
          onClose();
          await onRefreshData();
          break;
        }

        case 'online': {
          const bookingData = {
            guest_id: guestToUse!.id,
            room_id: String(room.id),
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            number_of_guests: 1,
            post_type: 'normal_stay' as const,
            source: 'online' as const,
            booking_remarks: bookingReference
              ? `${bookingChannel} - Ref: ${bookingReference}`
              : `${bookingChannel} Booking`,
            room_rate_override: useCustomRate && customRate > 0 ? customRate : undefined,
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
          const start = new Date(checkInDate);
          const end = new Date(checkOutDate);
          for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
            complimentaryDates.push(d.toISOString().split('T')[0]);
          }

          const bookingResult = await HotelAPIService.bookWithCredits({
            guest_id: selectedGuestWithCredits.id,
            room_id: typeof room.id === 'string' ? parseInt(room.id) : room.id,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            complimentary_dates: complimentaryDates,
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

  // Complete check-in for direct booking
  const completeCheckIn = async () => {
    if (!createdBooking) {
      onError('No booking found for check-in');
      return;
    }

    setProcessing(true);

    try {
      const checkinRequest: CheckInRequest = {
        guest_update: guestUpdateData,
        booking_update: bookingUpdateData,
      };

      await HotelAPIService.checkInGuest(createdBooking.id, checkinRequest);

      onSuccess(`Guest checked in successfully to Room ${room?.room_number}`);
      onClose();
      await onRefreshData();
    } catch (error: any) {
      onError(error.message || 'Failed to complete check-in');
    } finally {
      setProcessing(false);
    }
  };

  // Calculate total amount
  const calculateTotal = () => {
    if (useCustomRate && customRate > 0) {
      return customRate * numberOfNights;
    }
    const price = room?.price_per_night || 0;
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    return numPrice * numberOfNights;
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
                <Grid item xs={12} sm={6} key={mode}>
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
                <Grid item xs={12} sm={4} key={type}>
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
            {/* Dates */}
            <Grid item xs={12} md={6}>
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
            <Grid item xs={12} md={6}>
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
            {/* Room selection */}
            <Grid item xs={12}>
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
              <Grid item xs={12}>
                <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Room Number</Typography>
                      <Typography variant="body1" fontWeight={600}>{selectedRoom.room_number}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Room Type</Typography>
                      <Typography variant="body1">{selectedRoom.room_type}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Rate per Night</Typography>
                      <Typography variant="body1">{formatCurrency(Number(selectedRoom.price_per_night))}</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Total ({numberOfNights} night{numberOfNights > 1 ? 's' : ''})</Typography>
                      <Typography variant="body1" fontWeight={600}>{formatCurrency(Number(selectedRoom.price_per_night) * numberOfNights)}</Typography>
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
            onToggleMode={setIsCreatingNewGuest}
            filterByCredits={effectiveType === 'complimentary'}
            guestsWithCredits={guestsWithCredits}
            selectedGuestWithCredits={selectedGuestWithCredits}
            onGuestWithCreditsSelect={setSelectedGuestWithCredits}
            loadingGuestsWithCredits={loadingGuestsWithCredits}
            onMemberSelected={handleMemberSelected}
          />
        </Box>
      );
    }

    // Details step (Dates & Payment or just Details for online)
    if (currentStepName === 'Dates & Payment' || currentStepName === 'Details') {
      const isWalkIn = effectiveType === 'walk_in';
      const isOnline = effectiveType === 'online';
      const showPayment = isWalkIn && bookingMode === 'direct';
      // Only show dates if room was pre-selected (dates already entered in Room step otherwise)
      const showDates = !needsRoomSelection;

      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            {showPayment ? 'Dates & Payment' : isOnline ? 'Booking Details' : showDates ? 'Select Dates' : 'Additional Details'}
          </Typography>

          <Grid container spacing={2}>
            {/* Dates - only show if room was pre-selected */}
            {showDates && (
              <>
                <Grid item xs={12} md={6}>
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
                <Grid item xs={12} md={6}>
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
              </>
            )}

            {/* Online booking specific fields */}
            {isOnline && (
              <>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth required>
                    <InputLabel>Booking Channel</InputLabel>
                    <Select
                      value={bookingChannel}
                      onChange={(e) => setBookingChannel(e.target.value)}
                      label="Booking Channel"
                    >
                      {BOOKING_CHANNELS.map((channel) => (
                        <MenuItem key={channel} value={channel}>
                          {channel}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
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
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                    Room Rate
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
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
                  <Grid item xs={12} md={6}>
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

            {/* Walk-in payment fields (only for direct booking) */}
            {showPayment && (
              <>
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                    Payment Details
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Payment Method</InputLabel>
                    <Select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      label="Payment Method"
                    >
                      {getHotelSettings().payment_methods.map((method) => (
                        <MenuItem key={method} value={method}>{method}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Deposit Amount"
                    value={deposit}
                    onChange={(e) => setDeposit(parseFloat(e.target.value) || 0)}
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>,
                    }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Room Card Deposit"
                    value={roomCardDeposit}
                    onChange={(e) => setRoomCardDeposit(parseFloat(e.target.value) || 0)}
                    disabled={selectedGuest?.guest_type === 'member'}
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>,
                    }}
                    helperText={selectedGuest?.guest_type === 'member' ? 'Waived for members' : ''}
                  />
                </Grid>
              </>
            )}
          </Grid>
        </Box>
      );
    }

    // Check-In step (for direct booking)
    if (currentStepName === 'Check-In' && createdBooking) {
      const titleOptions = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof'];
      const paymentMethods = getHotelSettings().payment_methods;

      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            Complete Check-In - Folio: {createdBooking.folio_number}
          </Typography>

          <Alert severity="success" sx={{ mb: 2 }}>
            Booking created successfully! Please verify guest details and complete the check-in.
          </Alert>

          <Tabs
            value={checkInTabIndex}
            onChange={(_, newValue) => setCheckInTabIndex(newValue)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 2 }}
          >
            <Tab label="Guest Info" />
            <Tab label="Stay Details" />
            <Tab label="Payment" />
          </Tabs>

          {/* Tab 0: Guest Information */}
          {checkInTabIndex === 0 && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Title</InputLabel>
                  <Select
                    value={guestUpdateData.title || ''}
                    onChange={(e) => setGuestUpdateData({ ...guestUpdateData, title: e.target.value })}
                    label="Title"
                  >
                    {titleOptions.map(title => (
                      <MenuItem key={title} value={title}>{title}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4.5}>
                <TextField
                  fullWidth
                  size="small"
                  label="First Name"
                  value={guestUpdateData.first_name || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, first_name: e.target.value })}
                  required
                />
              </Grid>
              <Grid item xs={12} sm={4.5}>
                <TextField
                  fullWidth
                  size="small"
                  label="Last Name"
                  value={guestUpdateData.last_name || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, last_name: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Email"
                  type="email"
                  value={guestUpdateData.email || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, email: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Phone"
                  value={guestUpdateData.phone || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, phone: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="IC/Passport Number"
                  value={guestUpdateData.ic_number || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, ic_number: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Nationality"
                  value={guestUpdateData.nationality || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, nationality: e.target.value })}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Address"
                  value={guestUpdateData.address_line1 || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, address_line1: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="City"
                  value={guestUpdateData.city || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, city: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Country"
                  value={guestUpdateData.country || ''}
                  onChange={(e) => setGuestUpdateData({ ...guestUpdateData, country: e.target.value })}
                />
              </Grid>
            </Grid>
          )}

          {/* Tab 1: Stay Details */}
          {checkInTabIndex === 1 && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Check-in Date"
                  type="date"
                  value={createdBooking.check_in_date}
                  disabled
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Check-out Date"
                  type="date"
                  value={createdBooking.check_out_date}
                  disabled
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Rate Code</InputLabel>
                  <Select
                    value={bookingUpdateData.rate_code || 'RACK'}
                    onChange={(e) => setBookingUpdateData({ ...bookingUpdateData, rate_code: e.target.value })}
                    label="Rate Code"
                  >
                    {rateCodes.length > 0 ? rateCodes.map(code => (
                      <MenuItem key={code} value={code}>{code}</MenuItem>
                    )) : (
                      <MenuItem value="RACK">RACK</MenuItem>
                    )}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Market Code</InputLabel>
                  <Select
                    value={bookingUpdateData.market_code || 'WKII'}
                    onChange={(e) => setBookingUpdateData({ ...bookingUpdateData, market_code: e.target.value })}
                    label="Market Code"
                  >
                    {marketCodes.length > 0 ? marketCodes.map(code => (
                      <MenuItem key={code} value={code}>{code}</MenuItem>
                    )) : (
                      <MenuItem value="WKII">WKII</MenuItem>
                    )}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                  <Typography variant="subtitle2" gutterBottom>Room Details</Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Room:</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">{room?.room_number} ({room?.room_type})</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Total:</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" fontWeight="bold">{formatCurrency(Number(createdBooking.total_amount))}</Typography>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </Grid>
          )}

          {/* Tab 2: Payment */}
          {checkInTabIndex === 2 && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Payment Method</InputLabel>
                  <Select
                    value={bookingUpdateData.payment_method || 'Cash'}
                    onChange={(e) => setBookingUpdateData({ ...bookingUpdateData, payment_method: e.target.value })}
                    label="Payment Method"
                  >
                    {paymentMethods.map(method => (
                      <MenuItem key={method} value={method}>{method}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <Paper sx={{ p: 2, bgcolor: 'info.50', borderLeft: 4, borderColor: 'info.main' }}>
                  <Typography variant="body2">
                    <strong>Folio Number:</strong> {createdBooking.folio_number}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    <strong>Status:</strong> {createdBooking.status.toUpperCase()}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    <strong>Total Amount:</strong> {formatCurrency(Number(createdBooking.total_amount))}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
          )}
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

    // Confirm step content (shown for both direct booking and reservation modes)
    if (currentStepName !== 'Confirm') {
      return null; // Should not reach here
    }

    return (
      <Box>
        <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
          Review & Confirm
        </Typography>

        <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
          <Grid container spacing={2}>
            {/* Booking Type */}
            <Grid item xs={12}>
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

            <Grid item xs={12}>
              <Divider />
            </Grid>

            {/* Room Info */}
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Room</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={600}>
                {room?.room_number} ({room?.room_type})
              </Typography>
            </Grid>

            {/* Guest Info */}
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Guest</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={600}>
                {effectiveType === 'complimentary'
                  ? selectedGuestWithCredits?.full_name
                  : isCreatingNewGuest
                    ? `${newGuestForm.first_name} ${newGuestForm.last_name} (New)`
                    : selectedGuest?.full_name}
              </Typography>
            </Grid>

            {/* Dates */}
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Check-in</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{checkInDate}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Check-out</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{checkOutDate}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Nights</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{numberOfNights}</Typography>
            </Grid>

            {/* Online booking info */}
            {effectiveType === 'online' && bookingChannel && (
              <>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Channel</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2">{bookingChannel}</Typography>
                </Grid>
                {bookingReference && (
                  <>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Reference</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">{bookingReference}</Typography>
                    </Grid>
                  </>
                )}
              </>
            )}

            <Grid item xs={12}>
              <Divider />
            </Grid>

            {/* Pricing */}
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Rate{useCustomRate ? ' (Custom)' : ''}
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">
                {effectiveType === 'complimentary' ? (
                  <Box component="span" sx={{ textDecoration: 'line-through', color: 'text.disabled' }}>
                    {currencySymbol}{room?.price_per_night}/night
                  </Box>
                ) : useCustomRate && customRate > 0 ? (
                  <>
                    {formatCurrency(customRate)}/night
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      (was {formatCurrency(Number(room?.price_per_night || 0))})
                    </Typography>
                  </>
                ) : (
                  `${currencySymbol}${room?.price_per_night}/night`
                )}
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={600}>Total</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={600} color={effectiveType === 'complimentary' ? 'success.main' : 'text.primary'}>
                {effectiveType === 'complimentary' ? 'FREE (Complimentary)' : formatCurrency(calculateTotal())}
              </Typography>
            </Grid>

            {/* Walk-in payment summary (only for direct booking) */}
            {effectiveType === 'walk_in' && bookingMode === 'direct' && (
              <>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Deposit</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="success.main">
                    {currencySymbol}{deposit.toFixed(2)}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Room Card Deposit</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2">
                    {roomCardDeposit > 0 ? `${currencySymbol}${roomCardDeposit.toFixed(2)}` : 'Waived'}
                  </Typography>
                </Grid>
              </>
            )}

            {/* Credits info for complimentary */}
            {effectiveType === 'complimentary' && selectedGuestWithCredits && (
              <>
                <Grid item xs={12}>
                  <Divider />
                </Grid>
                <Grid item xs={12}>
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

  const steps = getSteps();
  // Last step is always steps.length - 1 (0-indexed)
  const isLastStep = activeStep === steps.length - 1;
  const canProceed = isStepValid();
  const effectiveType = getEffectiveBookingType();

  // Get header color based on booking mode
  const getHeaderColor = () => {
    if (bookingMode === 'direct') return BOOKING_MODE_CONFIG.direct.color;
    if (reservationType) return RESERVATION_TYPE_CONFIG[reservationType].color;
    return '#1976d2';
  };

  // Get submit button text
  const getSubmitButtonText = () => {
    if (processing) return 'Processing...';
    const currentStepName = steps[activeStep];
    if (bookingMode === 'direct' && currentStepName === 'Check-In') {
      return 'Complete Check-In';
    }
    return 'Create Reservation';
  };

  // Get next button text (for direct booking Confirm step)
  const getNextButtonText = () => {
    const currentStepName = steps[activeStep];
    if (bookingMode === 'direct' && currentStepName === 'Confirm') {
      return processing ? 'Creating...' : 'Create Booking';
    }
    return 'Next';
  };

  return (
    <Dialog
      open={open}
      onClose={() => !processing && onClose()}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle
        sx={{
          bgcolor: getHeaderColor(),
          color: 'white',
          py: 2,
          px: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HotelIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            New Booking - Room {room?.room_number || 'N/A'}
          </Typography>
        </Box>
      </DialogTitle>

      <Box sx={{ px: 3, pt: 2 }}>
        <Stepper activeStep={activeStep} alternativeLabel>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <DialogContent sx={{ pt: 3, minHeight: 300 }}>
        {renderStepContent()}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} disabled={processing}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        {activeStep > 0 && steps[activeStep] !== 'Check-In' && (
          <Button
            onClick={handleBack}
            disabled={processing}
            startIcon={<ArrowBackIcon />}
          >
            Back
          </Button>
        )}
        {!isLastStep ? (
          <Button
            variant="contained"
            onClick={handleNext}
            disabled={!canProceed || processing}
            endIcon={processing ? <CircularProgress size={20} /> : <ArrowForwardIcon />}
          >
            {getNextButtonText()}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={processing || !canProceed}
            startIcon={processing ? <CircularProgress size={20} /> : <CheckIcon />}
            color={effectiveType === 'complimentary' ? 'secondary' : 'primary'}
          >
            {getSubmitButtonText()}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default UnifiedBookingModal;
