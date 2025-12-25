import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  FormControl,
  InputLabel,
  Alert,
  Snackbar,
  CircularProgress,
  Divider,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Autocomplete,
  Tabs,
  Tab,
  FormGroup,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  CleaningServices as CleaningIcon,
  Build as MaintenanceIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Person as PersonIcon,
  PersonAdd as PersonAddIcon,
  Login as LoginIcon,
  Logout as LogoutIcon,
  History as HistoryIcon,
  Receipt as ReceiptIcon,
  Message as MessageIcon,
  Settings as SettingsIcon,
  Hotel as HotelIcon,
  Block as BlockIcon,
  EventAvailable as BookingIcon,
  AccessTime as TimeIcon,
  CardGiftcard as GiftIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room, Guest, BookingWithDetails, BookingCreateRequest, RoomHistory, Booking } from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { isValidEmail } from '../../../utils/validation';
import {
  getUnifiedStatusColor,
  getUnifiedStatusLabel,
  getUnifiedStatusShortLabel,
  RoomStatusType
} from '../../../config/roomStatusConfig';
import CheckoutInvoiceModal from '../../invoices/components/CheckoutInvoiceModal';
import EnhancedCheckInModal from '../../bookings/components/EnhancedCheckInModal';

interface RoomAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  color?: string;
  onClick: (room: Room) => void;
}

interface GuestWithCredits {
  id: number;
  full_name: string;
  email: string;
  legacy_complimentary_nights_credit: number;
  total_complimentary_credits: number;
  credits_by_room_type: {
    room_type_id: number;
    room_type_name: string;
    room_type_code: string;
    nights_available: number;
  }[];
}

const RoomManagementPage: React.FC = () => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  const [roomBookings, setRoomBookings] = useState<Map<string, BookingWithDetails>>(new Map());
  const [reservedBookings, setReservedBookings] = useState<Map<string, BookingWithDetails>>(new Map());
  const [complimentariseBookings, setComplimentariseBookings] = useState<Map<string, BookingWithDetails>>(new Map());
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);

  // Dialogs
  const [walkInDialogOpen, setWalkInDialogOpen] = useState(false);
  const [onlineCheckInDialogOpen, setOnlineCheckInDialogOpen] = useState(false);
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [roomDetailsDialogOpen, setRoomDetailsDialogOpen] = useState(false);
  const [changeRoomDialogOpen, setChangeRoomDialogOpen] = useState(false);
  const [complimentaryDialogOpen, setComplimentaryDialogOpen] = useState(false);
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [markingComplimentary, setMarkingComplimentary] = useState(false);

  // Room change state
  const [newSelectedRoom, setNewSelectedRoom] = useState<Room | null>(null);
  const [changingRoom, setChangingRoom] = useState(false);

  // Walk-in form state
  const [walkInGuest, setWalkInGuest] = useState<Guest | null>(null);
  const [walkInBookingChannel, setWalkInBookingChannel] = useState('');
  const [walkInReference, setWalkInReference] = useState('');
  const [walkInCheckInDate, setWalkInCheckInDate] = useState('');
  const [walkInCheckOutDate, setWalkInCheckOutDate] = useState('');
  const [walkInNumberOfNights, setWalkInNumberOfNights] = useState(1);
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [isCreatingNewGuest, setIsCreatingNewGuest] = useState(false);
  const [newGuestForm, setNewGuestForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    nationality: '',
    ic_number: ''
  });

  // Online check-in form state
  const [onlineCheckInGuest, setOnlineCheckInGuest] = useState<Guest | null>(null);
  const [onlineCheckInBookingChannel, setOnlineCheckInBookingChannel] = useState('');
  const [onlineReference, setOnlineReference] = useState('');
  const [onlineCheckInDate, setOnlineCheckInDate] = useState('');
  const [onlineCheckOutDate, setOnlineCheckOutDate] = useState('');
  const [onlineNumberOfNights, setOnlineNumberOfNights] = useState(1);
  const [isCreatingNewOnlineGuest, setIsCreatingNewOnlineGuest] = useState(false);
  const [newOnlineGuestForm, setNewOnlineGuestForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    nationality: '',
    ic_number: ''
  });

  // Complimentary check-in state
  const [complimentaryCheckInDialogOpen, setComplimentaryCheckInDialogOpen] = useState(false);
  const [complimentaryCheckInGuest, setComplimentaryCheckInGuest] = useState<GuestWithCredits | null>(null);
  const [complimentaryCheckInDate, setComplimentaryCheckInDate] = useState('');
  const [complimentaryCheckOutDate, setComplimentaryCheckOutDate] = useState('');
  const [complimentaryNumberOfNights, setComplimentaryNumberOfNights] = useState(1);
  const [guestsWithCredits, setGuestsWithCredits] = useState<GuestWithCredits[]>([]);
  const [loadingGuestsWithCredits, setLoadingGuestsWithCredits] = useState(false);

  // Room history state
  const [roomHistory, setRoomHistory] = useState<RoomHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedGuestDetails, setSelectedGuestDetails] = useState<Guest | null>(null);
  const [guestDetailsDialogOpen, setGuestDetailsDialogOpen] = useState(false);

  // Guest details tab state
  const [guestDetailsTab, setGuestDetailsTab] = useState(0);
  const [guestCredits, setGuestCredits] = useState<{
    guest_id: number;
    guest_name: string;
    total_nights: number;
    legacy_total_nights: number;
    credits_by_room_type: {
      id: number;
      room_type_id: number;
      room_type_name: string;
      room_type_code: string;
      nights_available: number;
    }[];
  } | null>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [availableRoomsForCredits, setAvailableRoomsForCredits] = useState<Room[]>([]);
  const [creditsBookingForm, setCreditsBookingForm] = useState({
    room_id: '',
    check_in_date: new Date().toISOString().split('T')[0],
    check_out_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    adults: 1,
    children: 0,
    special_requests: '',
  });
  const [selectedComplimentaryDates, setSelectedComplimentaryDates] = useState<string[]>([]);
  const [bookingWithCredits, setBookingWithCredits] = useState(false);
  const [creditsBookingSuccess, setCreditsBookingSuccess] = useState<{
    booking_id: number;
    booking_number: string;
    complimentary_nights: number;
  } | null>(null);
  const [roomBlockedDates, setRoomBlockedDates] = useState<{ start: string; end: string; status: string }[]>([]);

  // Enhanced check-in modal state
  const [enhancedCheckInOpen, setEnhancedCheckInOpen] = useState(false);
  const [checkInBooking, setCheckInBooking] = useState<Booking | null>(null);
  const [checkInGuest, setCheckInGuest] = useState<Guest | null>(null);

  // Get configurable booking channels and payment methods from hotel settings
  // Can be modified in Settings page or by editing hotelSettings.ts
  const BOOKING_CHANNELS = getHotelSettings().booking_channels;
  const PAYMENT_METHODS = getHotelSettings().payment_methods;

  useEffect(() => {
    loadData();
    // Refresh room status every 30 seconds
    const interval = setInterval(() => loadRooms(), 30000);
    return () => clearInterval(interval);
  }, []);

  // Clear any blocked dates from selection when room blocked dates are loaded
  useEffect(() => {
    if (roomBlockedDates.length > 0 && selectedComplimentaryDates.length > 0) {
      const availableDates = selectedComplimentaryDates.filter(date => !isDateBlocked(date));
      if (availableDates.length !== selectedComplimentaryDates.length) {
        setSelectedComplimentaryDates(availableDates);
      }
    }
  }, [roomBlockedDates]);

  const loadData = async () => {
    await Promise.all([loadRooms(), loadGuests(), loadBookings()]);
    await fixHiddenCleaningRooms(); // Fix any previously hidden dirty rooms
  };

  // Fix rooms that are marked as 'cleaning' but have available=false
  const fixHiddenCleaningRooms = async () => {
    try {
      const allRooms = await HotelAPIService.getAllRooms();
      const hiddenCleaningRooms = allRooms.filter(
        (room) => room.status === 'cleaning' && !room.available
      );

      // Fix each hidden cleaning room
      for (const room of hiddenCleaningRooms) {
        await HotelAPIService.updateRoom(room.id, { available: true });
      }

      // Reload rooms if we fixed any
      if (hiddenCleaningRooms.length > 0) {
        console.log(`Fixed ${hiddenCleaningRooms.length} hidden cleaning rooms`);
        await loadRooms();
      }
    } catch (error) {
      console.error('Failed to fix hidden cleaning rooms:', error);
    }
  };

  const loadRooms = async () => {
    try {
      setLoading(true);
      // Use getAllRooms() instead of searchRooms() to get ALL rooms including dirty ones
      const roomsData = await HotelAPIService.getAllRooms();
      setRooms(roomsData);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load rooms', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadBookings = async () => {
    try {
      const bookingsData = await HotelAPIService.getAllBookings();
      // Create a map of room_id to current active booking
      const bookingsMap = new Map<string, BookingWithDetails>();
      const reservedMap = new Map<string, BookingWithDetails>();
      const complimentariseMap = new Map<string, BookingWithDetails>();

      bookingsData.forEach((booking: BookingWithDetails) => {
        // Track checked_in bookings
        if (booking.status === 'checked_in') {
          bookingsMap.set(booking.room_id, booking);
        }
        // Track confirmed/pending bookings (reserved)
        if (booking.status === 'confirmed' || booking.status === 'pending') {
          reservedMap.set(booking.room_id, booking);
        }
        // Track complimentarise bookings (room released for guest to use credits elsewhere)
        if (booking.status === 'complimentarise') {
          complimentariseMap.set(booking.room_id, booking);
        }
      });

      setRoomBookings(bookingsMap);
      setReservedBookings(reservedMap);
      setComplimentariseBookings(complimentariseMap);
    } catch (error: any) {
      console.error('Failed to load bookings:', error);
    }
  };

  const loadGuests = async () => {
    try {
      const guestsData = await HotelAPIService.getAllGuests();
      setGuests(guestsData);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load guests', 'error');
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, room: Room) => {
    setAnchorEl(event.currentTarget);
    setSelectedRoom(room);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const getRoomStatusColor = (room: Room): string => {
    // Use centralized status config for consistent colors
    return getUnifiedStatusColor(room.status || 'available');
  };

  const getRoomStatusLabel = (room: Room): string => {
    // Use centralized status config for consistent labels
    if (!room.available && room.status) {
      return getUnifiedStatusShortLabel(room.status).toUpperCase();
    }
    return room.available ? 'VAC' : 'N/A';
  };

  const getRoomTypeCode = (roomType: string): string => {
    const codes: { [key: string]: string } = {
      'deluxe': 'DLXX',
      'superior': 'SUP',
      'standard': 'STD',
      'suite': 'STE',
      'standard queen': 'STDQ',
      'family room': 'FR',
    };
    return codes[roomType.toLowerCase()] || roomType.substring(0, 4).toUpperCase();
  };

  // Room Actions
  const handleWalkInGuest = async (room: Room) => {
    setSelectedRoom(room);
    handleMenuClose();

    // Initialize dates with defaults (today and tomorrow)
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    setWalkInCheckInDate(today);
    setWalkInCheckOutDate(tomorrow);
    setWalkInNumberOfNights(1);

    // Show guest selection dialog first
    setWalkInDialogOpen(true);
  };

  const handleOnlineCheckIn = (room: Room) => {
    setSelectedRoom(room);
    handleMenuClose();

    // Initialize dates with defaults (today and tomorrow)
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    setOnlineCheckInDate(today);
    setOnlineCheckOutDate(tomorrow);
    setOnlineNumberOfNights(1);

    // Show guest selection dialog first
    setOnlineCheckInDialogOpen(true);
  };

  const handleCloseWalkInDialog = () => {
    if (creatingBooking) return;

    setWalkInDialogOpen(false);
    // Reset form state
    setWalkInGuest(null);
    setIsCreatingNewGuest(false);
    setNewGuestForm({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      nationality: '',
      ic_number: ''
    });
  };

  const handleCloseOnlineCheckInDialog = () => {
    if (creatingBooking) return;

    setOnlineCheckInDialogOpen(false);
    // Reset form state
    setOnlineCheckInGuest(null);
    setOnlineCheckInBookingChannel('');
    setOnlineReference('');
    setIsCreatingNewOnlineGuest(false);
    setNewOnlineGuestForm({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      nationality: '',
      ic_number: ''
    });
  };

  // Complimentary Check-in handlers
  const handleComplimentaryCheckIn = async (room: Room) => {
    setSelectedRoom(room);
    handleMenuClose();

    // Initialize dates with defaults (today and tomorrow)
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    setComplimentaryCheckInDate(today);
    setComplimentaryCheckOutDate(tomorrow);
    setComplimentaryNumberOfNights(1);
    setComplimentaryCheckInGuest(null);

    // Fetch guests with credits (includes both legacy and room-type-specific credits)
    setLoadingGuestsWithCredits(true);
    try {
      const guestsWithAllCredits = await HotelAPIService.getMyGuestsWithCredits();
      // Filter to only show guests who have any credits (legacy OR room-type specific)
      const filteredGuests = guestsWithAllCredits.filter(
        g => g.legacy_complimentary_nights_credit > 0 || g.total_complimentary_credits > 0
      );
      setGuestsWithCredits(filteredGuests);
    } catch (error) {
      console.error('Failed to fetch guests with credits:', error);
      showSnackbar('Failed to load guests with credits', 'error');
    } finally {
      setLoadingGuestsWithCredits(false);
    }

    setComplimentaryCheckInDialogOpen(true);
  };

  const handleCloseComplimentaryCheckInDialog = () => {
    if (creatingBooking) return;

    setComplimentaryCheckInDialogOpen(false);
    setComplimentaryCheckInGuest(null);
    setComplimentaryCheckInDate('');
    setComplimentaryCheckOutDate('');
    setComplimentaryNumberOfNights(1);
  };

  const handleComplimentaryCheckInSubmit = async () => {
    if (!selectedRoom || !complimentaryCheckInGuest) {
      showSnackbar('Please select a guest with free room credits', 'error');
      return;
    }

    if (!complimentaryCheckInDate || !complimentaryCheckOutDate) {
      showSnackbar('Please select check-in and check-out dates', 'error');
      return;
    }

    try {
      setCreatingBooking(true);

      // Generate list of complimentary dates (all dates in the range)
      const complimentaryDates: string[] = [];
      const start = new Date(complimentaryCheckInDate);
      const end = new Date(complimentaryCheckOutDate);
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        complimentaryDates.push(d.toISOString().split('T')[0]);
      }

      // Use bookWithCredits API which properly deducts credits
      const bookingResult = await HotelAPIService.bookWithCredits({
        guest_id: complimentaryCheckInGuest.id,
        room_id: typeof selectedRoom.id === 'string' ? parseInt(selectedRoom.id) : selectedRoom.id,
        check_in_date: complimentaryCheckInDate,
        check_out_date: complimentaryCheckOutDate,
        complimentary_dates: complimentaryDates,
      });

      // Check in the guest
      await HotelAPIService.checkInGuest(bookingResult.booking_id.toString(), {
        checkin_notes: 'Complimentary check-in using free room credits',
      });

      showSnackbar(`${complimentaryCheckInGuest.full_name} checked into room ${selectedRoom.room_number} (Complimentary - ${bookingResult.complimentary_nights} nights used)`, 'success');
      setComplimentaryCheckInDialogOpen(false);
      setComplimentaryCheckInGuest(null);
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to check in guest', 'error');
    } finally {
      setCreatingBooking(false);
    }
  };

  const handleWalkInGuestSelected = async () => {
    if (!selectedRoom) {
      showSnackbar('Please select a room', 'error');
      return;
    }

    let guestToUse: Guest | null = null;

    try {
      setCreatingBooking(true);

      // If creating a new guest, create them first
      if (isCreatingNewGuest) {
        // Validate required fields
        if (!newGuestForm.first_name || !newGuestForm.last_name || !newGuestForm.email) {
          showSnackbar('Please fill in all required fields (First Name, Last Name, Email)', 'error');
          setCreatingBooking(false);
          return;
        }

        // Validate email format
        if (!isValidEmail(newGuestForm.email)) {
          showSnackbar('Please enter a valid email address', 'error');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate email
        const existingGuest = guests.find(g => g.email.toLowerCase() === newGuestForm.email.toLowerCase());
        if (existingGuest) {
          showSnackbar(`A guest with email ${newGuestForm.email} already exists. Please select from existing guests.`, 'error');
          setCreatingBooking(false);
          return;
        }

        // Create the new guest
        const newGuest = await HotelAPIService.createGuest({
          first_name: newGuestForm.first_name,
          last_name: newGuestForm.last_name,
          email: newGuestForm.email,
          phone: newGuestForm.phone,
          ic_number: newGuestForm.ic_number,
          nationality: newGuestForm.nationality,
        });

        guestToUse = newGuest;

        // Refresh guest list
        await loadGuests();

        // Reset new guest form
        setNewGuestForm({
          first_name: '',
          last_name: '',
          email: '',
          phone: '',
          nationality: '',
          ic_number: ''
        });
      } else {
        // Use existing selected guest
        if (!walkInGuest) {
          showSnackbar('Please select a guest', 'error');
          setCreatingBooking(false);
          return;
        }
        guestToUse = walkInGuest;
      }

      // Create a real booking in the database
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

      // Double-check that we have valid data
      if (!selectedRoom || !selectedRoom.id) {
        showSnackbar('Invalid room selection. Please try again.', 'error');
        setCreatingBooking(false);
        return;
      }

      const bookingData = {
        guest_id: guestToUse.id,
        room_id: String(selectedRoom.id), // Convert to string for validation
        check_in_date: walkInCheckInDate || today,
        check_out_date: walkInCheckOutDate || tomorrow,
        number_of_guests: 1,
        post_type: 'normal_stay' as const,
        booking_remarks: 'Walk-In Guest',
      };

      const createdBooking = await HotelAPIService.createBooking(bookingData);

      // Convert created booking to Booking type for the enhanced modal
      const bookingForModal: Booking = {
        id: createdBooking.id,
        guest_id: guestToUse.id.toString(),
        room_id: selectedRoom.id,
        room_type: selectedRoom.room_type,
        check_in_date: createdBooking.check_in_date,
        check_out_date: createdBooking.check_out_date,
        total_amount: createdBooking.total_amount,
        status: createdBooking.status,
        folio_number: createdBooking.folio_number || `WALKIN-${createdBooking.id}`,
        market_code: 'Walk-In',
        rate_code: 'RACK',
        payment_method: 'Cash',
        post_type: createdBooking.post_type,
        created_at: createdBooking.created_at,
        updated_at: createdBooking.updated_at,
      };

      setCheckInBooking(bookingForModal);
      setCheckInGuest(guestToUse);
      setWalkInDialogOpen(false);
      setEnhancedCheckInOpen(true);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create guest', 'error');
    } finally {
      setCreatingBooking(false);
    }
  };

  const handleConfirmWalkIn = async () => {
    if (!selectedRoom || !walkInGuest || !walkInBookingChannel) {
      showSnackbar('Please select a guest and booking channel', 'error');
      return;
    }

    try {
      setCreatingBooking(true);

      // Create booking for walk-in
      const bookingData: BookingCreateRequest = {
        guest_id: walkInGuest.id,
        room_id: String(selectedRoom.id), // Convert to string for validation
        check_in_date: walkInCheckInDate,
        check_out_date: walkInCheckOutDate,
        number_of_guests: 1,
        post_type: 'normal_stay',
        booking_remarks: walkInReference
          ? `${walkInBookingChannel} - Ref: ${walkInReference}`
          : walkInBookingChannel,
      };

      await HotelAPIService.createBooking(bookingData);

      // Update room status to occupied
      await HotelAPIService.updateRoomStatus(selectedRoom.id, {
        status: 'occupied',
        notes: `Walk-in via ${walkInBookingChannel}`,
      });

      showSnackbar(`${walkInGuest.full_name} checked into room ${selectedRoom.room_number} (${walkInBookingChannel})`, 'success');
      setWalkInDialogOpen(false);
      // Reset form
      setWalkInGuest(null);
      setWalkInBookingChannel('');
      setWalkInReference('');
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to check in guest', 'error');
    } finally {
      setCreatingBooking(false);
    }
  };

  const handleCheckIn = (room: Room) => {
    setSelectedRoom(room);
    handleMenuClose();

    // Check if there's a reserved booking for this room and auto-populate the form
    const reservedBooking = reservedBookings.get(room.id);
    if (reservedBooking) {
      // Auto-populate guest if available
      if (reservedBooking.guest_id) {
        const matchingGuest = guests.find(g => String(g.id) === String(reservedBooking.guest_id));
        if (matchingGuest) {
          setOnlineCheckInGuest(matchingGuest);
        }
      }

      // Auto-populate dates from the reservation
      if (reservedBooking.check_in_date) {
        setOnlineCheckInDate(reservedBooking.check_in_date.split('T')[0]);
      }
      if (reservedBooking.check_out_date) {
        setOnlineCheckOutDate(reservedBooking.check_out_date.split('T')[0]);
      }

      // Calculate number of nights
      if (reservedBooking.check_in_date && reservedBooking.check_out_date) {
        const checkIn = new Date(reservedBooking.check_in_date);
        const checkOut = new Date(reservedBooking.check_out_date);
        const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
        if (nights > 0) {
          setOnlineNumberOfNights(nights);
        }
      }

      // Set booking channel to 'online' for reserved bookings
      setOnlineCheckInBookingChannel('online');
    }

    // Show guest selection dialog first
    setOnlineCheckInDialogOpen(true);
  };

  const handleOnlineGuestSelected = async () => {
    if (!selectedRoom) {
      showSnackbar('Please select a room', 'error');
      return;
    }

    if (!onlineCheckInBookingChannel) {
      showSnackbar('Please select a booking channel', 'error');
      return;
    }

    let guestToUse: Guest | null = null;

    try {
      setCreatingBooking(true);

      // If creating a new guest, create them first
      if (isCreatingNewOnlineGuest) {
        // Validate required fields
        if (!newOnlineGuestForm.first_name || !newOnlineGuestForm.last_name || !newOnlineGuestForm.email) {
          showSnackbar('Please fill in all required fields (First Name, Last Name, Email)', 'error');
          setCreatingBooking(false);
          return;
        }

        // Validate email format
        if (!isValidEmail(newOnlineGuestForm.email)) {
          showSnackbar('Please enter a valid email address', 'error');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate email
        const existingGuest = guests.find(g => g.email.toLowerCase() === newOnlineGuestForm.email.toLowerCase());
        if (existingGuest) {
          showSnackbar(`A guest with email ${newOnlineGuestForm.email} already exists. Please select from existing guests.`, 'error');
          setCreatingBooking(false);
          return;
        }

        // Create the new guest
        const newGuest = await HotelAPIService.createGuest({
          first_name: newOnlineGuestForm.first_name,
          last_name: newOnlineGuestForm.last_name,
          email: newOnlineGuestForm.email,
          phone: newOnlineGuestForm.phone,
          ic_number: newOnlineGuestForm.ic_number,
          nationality: newOnlineGuestForm.nationality,
        });

        guestToUse = newGuest;

        // Refresh guest list
        await loadGuests();

        // Reset new guest form
        setNewOnlineGuestForm({
          first_name: '',
          last_name: '',
          email: '',
          phone: '',
          nationality: '',
          ic_number: ''
        });
      } else {
        // Use existing selected guest
        if (!onlineCheckInGuest) {
          showSnackbar('Please select a guest', 'error');
          setCreatingBooking(false);
          return;
        }
        guestToUse = onlineCheckInGuest;
      }

      // Create a real booking in the database
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

      // Double-check that we have valid data
      if (!selectedRoom || !selectedRoom.id) {
        console.error('Invalid room selection:', { selectedRoom, id: selectedRoom?.id });
        showSnackbar('Invalid room selection. Please try again.', 'error');
        setCreatingBooking(false);
        return;
      }

      // Ensure dates are valid
      const checkInDateToUse = onlineCheckInDate || today;
      const checkOutDateToUse = onlineCheckOutDate || tomorrow;

      console.log('Date debug:', {
        onlineCheckInDate,
        onlineCheckOutDate,
        checkInDateToUse,
        checkOutDateToUse,
        today,
        tomorrow
      });

      if (!checkInDateToUse || !checkOutDateToUse) {
        showSnackbar('Check-in and check-out dates are required', 'error');
        setCreatingBooking(false);
        return;
      }

      // Validate that check-out is after check-in
      const checkInTest = new Date(checkInDateToUse);
      const checkOutTest = new Date(checkOutDateToUse);
      if (checkOutTest <= checkInTest) {
        showSnackbar('Check-out date must be after check-in date', 'error');
        setCreatingBooking(false);
        return;
      }

      const bookingData = {
        guest_id: guestToUse.id,
        room_id: String(selectedRoom.id), // Convert to string for validation
        check_in_date: checkInDateToUse,
        check_out_date: checkOutDateToUse,
        number_of_guests: 1,
        post_type: 'normal_stay' as const,
        booking_remarks: onlineReference || 'Online Check-In',
      };

      console.log('Creating booking with data:', bookingData);

      const createdBooking = await HotelAPIService.createBooking(bookingData);

      // Convert created booking to Booking type for the enhanced modal
      const bookingForModal: Booking = {
        id: createdBooking.id,
        guest_id: guestToUse.id.toString(),
        room_id: selectedRoom.id,
        room_type: selectedRoom.room_type,
        check_in_date: createdBooking.check_in_date,
        check_out_date: createdBooking.check_out_date,
        total_amount: createdBooking.total_amount,
        status: createdBooking.status,
        folio_number: createdBooking.folio_number || `ONLINE-${createdBooking.id}`,
        market_code: onlineCheckInBookingChannel,
        rate_code: 'RACK',
        payment_method: 'Online Banking',
        post_type: createdBooking.post_type,
        created_at: createdBooking.created_at,
        updated_at: createdBooking.updated_at,
      };

      setCheckInBooking(bookingForModal);
      setCheckInGuest(guestToUse);
      setOnlineCheckInDialogOpen(false);
      setEnhancedCheckInOpen(true);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create guest', 'error');
    } finally {
      setCreatingBooking(false);
    }
  };

  const handleEnhancedCheckInSuccess = async () => {
    showSnackbar(`Guest checked in successfully!`, 'success');
    setEnhancedCheckInOpen(false);
    setCheckInBooking(null);
    setCheckInGuest(null);

    // Reset walk-in form state
    setWalkInGuest(null);
    setWalkInCheckInDate('');
    setWalkInCheckOutDate('');
    setWalkInNumberOfNights(1);
    setIsCreatingNewGuest(false);
    setNewGuestForm({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      nationality: '',
      ic_number: ''
    });

    // Reset online check-in form state
    setOnlineCheckInGuest(null);
    setOnlineCheckInBookingChannel('');
    setOnlineReference('');
    setOnlineCheckInDate('');
    setOnlineCheckOutDate('');
    setOnlineNumberOfNights(1);
    setIsCreatingNewOnlineGuest(false);
    setNewOnlineGuestForm({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      nationality: '',
      ic_number: ''
    });

    await loadData();
  };

  const handleOnlineCheckInSubmit = async () => {
    if (!selectedRoom || !onlineCheckInGuest) {
      showSnackbar('Please select a guest', 'error');
      return;
    }

    try {
      setCreatingBooking(true);

      // Create booking for online check-in
      const bookingData: BookingCreateRequest = {
        guest_id: onlineCheckInGuest.id,
        room_id: String(selectedRoom.id), // Convert to string for validation
        check_in_date: onlineCheckInDate,
        check_out_date: onlineCheckOutDate,
        number_of_guests: 1,
        post_type: 'normal_stay',
        booking_remarks: onlineReference || 'Online Guest',
      };

      await HotelAPIService.createBooking(bookingData);

      // Update room status to occupied
      await HotelAPIService.updateRoomStatus(selectedRoom.id, {
        status: 'occupied',
        notes: 'Online guest checked in',
      });

      showSnackbar(`${onlineCheckInGuest.full_name} checked into room ${selectedRoom.room_number}`, 'success');
      setOnlineCheckInDialogOpen(false);
      // Reset form
      setOnlineCheckInGuest(null);
      setOnlineReference('');
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to check in guest', 'error');
    } finally {
      setCreatingBooking(false);
    }
  };

  const handleCheckOut = (room: Room) => {
    setSelectedRoom(room);
    // Find the active booking for this room
    const booking = roomBookings.get(room.id);
    if (booking) {
      setSelectedBooking(booking);
      setCheckOutDialogOpen(true);
    } else {
      showSnackbar('No active booking found for this room', 'error');
    }
    handleMenuClose();
  };

  const handleConfirmCheckout = async () => {
    if (!selectedBooking) return;

    try {
      // Update booking status to checked_out
      await HotelAPIService.updateBooking(selectedBooking.id, { status: 'checked_out' });

      // Mark room as needs cleaning
      await HotelAPIService.updateRoomStatus(selectedBooking.room_id, {
        status: 'cleaning',
        notes: 'Room requires cleaning after checkout',
      });

      showSnackbar(`Room ${selectedRoom?.room_number} checked out successfully`, 'success');
      await loadData(); // Reload all data
      setCheckOutDialogOpen(false);
      setSelectedBooking(null);
    } catch (error: any) {
      throw new Error(error.message || 'Failed to process checkout');
    }
  };

  const handleMakeDirty = async (room: Room) => {
    try {
      // Update room status to cleaning (dirty)
      await HotelAPIService.updateRoomStatus(room.id, {
        status: 'cleaning',
        notes: 'Room marked as dirty - requires cleaning',
      });

      showSnackbar(`Room ${room.room_number} marked as dirty`, 'success');
      await loadData(); // Reload all data including rooms and bookings
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room status', 'error');
    }
    handleMenuClose();
  };

  const handleMakeClean = async (room: Room) => {
    try {
      // Update room status to available
      await HotelAPIService.updateRoomStatus(room.id, {
        status: 'available',
        notes: 'Room cleaned and ready for guests',
      });

      // Ensure room is available
      await HotelAPIService.updateRoom(room.id, { available: true });

      showSnackbar(`Room ${room.room_number} marked as clean`, 'success');
      await loadData(); // Reload all data including rooms and bookings
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room status', 'error');
    }
    handleMenuClose();
  };

  const handleMaintenance = async (room: Room) => {
    try {
      await HotelAPIService.updateRoomStatus(room.id, {
        status: 'maintenance',
        notes: 'Room under maintenance',
      });
      showSnackbar(`Room ${room.room_number} set to maintenance`, 'success');
      await loadData(); // Reload all data including rooms and bookings
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room status', 'error');
    }
    handleMenuClose();
  };

  const handleMakeUnavailable = async (room: Room) => {
    try {
      await HotelAPIService.updateRoom(room.id, { available: false });
      showSnackbar(`Room ${room.room_number} marked as unavailable`, 'success');
      await loadData(); // Reload all data including rooms and bookings
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room', 'error');
    }
    handleMenuClose();
  };

  const handleShowHistory = async (room: Room) => {
    setSelectedRoom(room);
    setHistoryDialogOpen(true);
    handleMenuClose();

    // Load room history
    try {
      setLoadingHistory(true);
      const history = await HotelAPIService.getRoomHistory(room.id);
      setRoomHistory(history);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load room history', 'error');
      setRoomHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleViewGuestDetails = async (guestId: string | number) => {
    try {
      const allGuests = await HotelAPIService.getAllGuests();
      console.log('All guests:', allGuests);
      console.log('Looking for guest ID:', guestId, 'Type:', typeof guestId);

      // Handle both string and number guest IDs
      const guest = allGuests.find(g => {
        const match = g.id.toString() === guestId.toString();
        console.log(`Comparing ${g.id} (${typeof g.id}) with ${guestId} (${typeof guestId}): ${match}`);
        return match;
      });

      console.log('Found guest:', guest);

      if (guest) {
        setSelectedGuestDetails(guest);
        setGuestDetailsTab(0); // Reset to first tab
        setGuestCredits(null);
        setCreditsBookingSuccess(null);
        setSelectedComplimentaryDates([]);
        setGuestDetailsDialogOpen(true);
        handleMenuClose();

        // Load guest credits in background
        loadGuestCredits(guest.id);
      } else {
        showSnackbar(`Guest not found (ID: ${guestId})`, 'error');
      }
    } catch (error: any) {
      console.error('Error loading guest details:', error);
      showSnackbar(error.message || 'Failed to load guest details', 'error');
    }
  };

  const loadGuestCredits = async (guestId: number) => {
    try {
      setLoadingCredits(true);
      const credits = await HotelAPIService.getGuestCredits(guestId);
      setGuestCredits(credits);
    } catch (error: any) {
      console.error('Error loading guest credits:', error);
      // Don't show error - credits may not be available for all guests
    } finally {
      setLoadingCredits(false);
    }
  };

  const loadAvailableRoomsForCredits = async () => {
    try {
      const allRooms = await HotelAPIService.getAllRooms();
      // Show all rooms, not just available ones - we'll show blocked dates for each
      setAvailableRoomsForCredits(allRooms);
    } catch (error: any) {
      console.error('Error loading available rooms:', error);
    }
  };

  const loadRoomBlockedDates = async (roomId: string) => {
    try {
      // Get all bookings and filter for this room
      const allBookings = await HotelAPIService.getAllBookings();
      const roomBookingsFiltered = allBookings.filter(b =>
        b.room_id?.toString() === roomId &&
        !['cancelled', 'no_show', 'checked_out'].includes(b.status)
      );

      const blocked = roomBookingsFiltered.map(b => ({
        start: b.check_in_date,
        end: b.check_out_date,
        status: b.status
      }));

      setRoomBlockedDates(blocked);
    } catch (error: any) {
      console.error('Error loading room blocked dates:', error);
      setRoomBlockedDates([]);
    }
  };

  const isDateBlocked = (dateStr: string): boolean => {
    const date = new Date(dateStr);
    date.setHours(0, 0, 0, 0);

    for (const booking of roomBlockedDates) {
      const start = new Date(booking.start);
      start.setHours(0, 0, 0, 0);
      const end = new Date(booking.end);
      end.setHours(0, 0, 0, 0);

      // Date is blocked if it's within the booking range (check-in to check-out - 1)
      if (date >= start && date < end) {
        return true;
      }
    }
    return false;
  };

  const getMinCheckInDate = (): string => {
    return new Date().toISOString().split('T')[0];
  };

  const getNextAvailableDate = (fromDate: string): string => {
    let date = new Date(fromDate);
    date.setHours(0, 0, 0, 0);

    // Find the next available date
    while (isDateBlocked(date.toISOString().split('T')[0])) {
      date.setDate(date.getDate() + 1);
    }
    return date.toISOString().split('T')[0];
  };

  const validateDateSelection = (): { valid: boolean; message: string } => {
    if (!creditsBookingForm.check_in_date || !creditsBookingForm.check_out_date) {
      return { valid: false, message: 'Please select dates' };
    }

    const checkIn = new Date(creditsBookingForm.check_in_date);
    const checkOut = new Date(creditsBookingForm.check_out_date);

    if (checkOut <= checkIn) {
      return { valid: false, message: 'Check-out must be after check-in' };
    }

    // Check if any date in the range is blocked
    for (let d = new Date(checkIn); d < checkOut; d.setDate(d.getDate() + 1)) {
      if (isDateBlocked(d.toISOString().split('T')[0])) {
        return { valid: false, message: `Date ${d.toLocaleDateString()} is already reserved` };
      }
    }

    return { valid: true, message: '' };
  };

  const getCreditsBookingDates = (): string[] => {
    const dates: string[] = [];
    const start = new Date(creditsBookingForm.check_in_date);
    const end = new Date(creditsBookingForm.check_out_date);
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  };

  const getTotalCreditsForRoom = (roomId: string): number => {
    if (!guestCredits || !roomId) return 0;
    const room = availableRoomsForCredits.find(r => r.id.toString() === roomId);
    if (!room) return guestCredits.legacy_total_nights;

    // Find credits for this room type
    const roomTypeCredits = guestCredits.credits_by_room_type.find(c =>
      room.room_type?.toLowerCase().includes(c.room_type_name.toLowerCase())
    );

    return (roomTypeCredits?.nights_available || 0) + guestCredits.legacy_total_nights;
  };

  const handleCreditsDateToggle = (date: string) => {
    // Prevent toggling blocked dates
    if (isDateBlocked(date)) return;

    const maxCredits = getTotalCreditsForRoom(creditsBookingForm.room_id);
    if (selectedComplimentaryDates.includes(date)) {
      setSelectedComplimentaryDates(prev => prev.filter(d => d !== date));
    } else if (selectedComplimentaryDates.length < maxCredits) {
      setSelectedComplimentaryDates(prev => [...prev, date]);
    }
  };

  const selectAllCreditsAvailable = () => {
    const dates = getCreditsBookingDates();
    const maxCredits = getTotalCreditsForRoom(creditsBookingForm.room_id);
    // Filter out blocked dates and only select available ones
    const availableDates = dates.filter(date => !isDateBlocked(date));
    setSelectedComplimentaryDates(availableDates.slice(0, maxCredits));
  };

  const handleBookWithCreditsAndCheckIn = async () => {
    if (!selectedGuestDetails || !creditsBookingForm.room_id || selectedComplimentaryDates.length === 0) {
      showSnackbar('Please select a room and at least one complimentary date', 'error');
      return;
    }

    try {
      setBookingWithCredits(true);
      const result = await HotelAPIService.bookWithCredits({
        guest_id: selectedGuestDetails.id,
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

      // Reload guest credits
      loadGuestCredits(selectedGuestDetails.id);
      // Reload rooms
      loadRooms();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to book with credits', 'error');
    } finally {
      setBookingWithCredits(false);
    }
  };

  const handleCheckInFromCreditsBooking = async () => {
    if (!creditsBookingSuccess) return;

    try {
      await HotelAPIService.checkInGuest(creditsBookingSuccess.booking_id.toString());
      showSnackbar('Guest checked in successfully!', 'success');
      setGuestDetailsDialogOpen(false);
      loadRooms();
      loadBookings();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to check in guest', 'error');
    }
  };

  const handleRoomProperties = (room: Room) => {
    setSelectedRoom(room);
    setRoomDetailsDialogOpen(true);
    handleMenuClose();
  };

  const handleChangeRoom = (room: Room) => {
    setSelectedRoom(room);
    setNewSelectedRoom(null);
    setChangeRoomDialogOpen(true);
    handleMenuClose();
  };

  const handleConfirmRoomChange = async () => {
    if (!selectedRoom || !newSelectedRoom || !selectedBooking) {
      showSnackbar('Please select a new room', 'error');
      return;
    }

    try {
      setChangingRoom(true);

      // Calculate price difference
      const oldPrice = typeof selectedRoom.price_per_night === 'string'
        ? parseFloat(selectedRoom.price_per_night)
        : selectedRoom.price_per_night;
      const newPrice = typeof newSelectedRoom.price_per_night === 'string'
        ? parseFloat(newSelectedRoom.price_per_night)
        : newSelectedRoom.price_per_night;
      const priceDifference = newPrice - oldPrice;

      // Update booking with new room
      await HotelAPIService.updateBooking(selectedBooking.id, {
        room_id: newSelectedRoom.id,
      });

      // Update old room status to cleaning
      await HotelAPIService.updateRoomStatus(selectedRoom.id, {
        status: 'cleaning',
        notes: `Guest moved to room ${newSelectedRoom.room_number}`,
      });

      // Update new room status to occupied
      await HotelAPIService.updateRoomStatus(newSelectedRoom.id, {
        status: 'occupied',
        notes: `Guest moved from room ${selectedRoom.room_number}`,
      });

      const changeMessage = priceDifference > 0
        ? `Room changed successfully. Additional charge: ${currencySymbol}${Math.abs(priceDifference).toFixed(2)}/night`
        : priceDifference < 0
        ? `Room changed successfully. Credit applied: ${currencySymbol}${Math.abs(priceDifference).toFixed(2)}/night`
        : 'Room changed successfully. No additional charges.';

      showSnackbar(changeMessage, 'success');
      setChangeRoomDialogOpen(false);
      setNewSelectedRoom(null);
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to change room', 'error');
    } finally {
      setChangingRoom(false);
    }
  };

  const handleMarkComplimentary = (room: Room) => {
    setSelectedRoom(room);
    // Get the reserved booking for this room
    const booking = reservedBookings.get(room.id);
    if (booking) {
      setSelectedBooking(booking);
      setComplimentaryReason('');
      setComplimentaryDialogOpen(true);
    } else {
      showSnackbar('No pending booking found for this room', 'error');
    }
    handleMenuClose();
  };

  const handleConfirmMarkComplimentary = async () => {
    if (!selectedBooking) {
      showSnackbar('No booking selected', 'error');
      return;
    }

    try {
      setMarkingComplimentary(true);

      // Call API to mark booking as complimentary
      const result = await HotelAPIService.markBookingComplimentary(selectedBooking.id, complimentaryReason || undefined);

      showSnackbar(`Booking marked as complimentary! ${result.nights_credited} night(s) of ${result.room_type} credits added to guest.`, 'success');
      setComplimentaryDialogOpen(false);
      setComplimentaryReason('');
      setSelectedBooking(null);
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to mark booking as complimentary', 'error');
    } finally {
      setMarkingComplimentary(false);
    }
  };

  const getMenuActions = (room: Room | null): RoomAction[] => {
    if (!room) return [];

    const booking = roomBookings.get(room.id);
    const reservedBooking = reservedBookings.get(room.id);

    // Compute dynamic status - same logic as in the render
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const hasCheckedInBooking = booking?.status === 'checked_in';
    const hasReservationForToday = reservedBooking && (() => {
      const checkInDate = new Date(reservedBooking.check_in_date);
      checkInDate.setHours(0, 0, 0, 0);
      return checkInDate <= today;
    })();

    const computedStatus = hasCheckedInBooking
      ? 'occupied'
      : hasReservationForToday
        ? 'reserved'
        : ['maintenance', 'out_of_order', 'dirty', 'cleaning'].includes(room.status || '')
          ? room.status
          : 'available';

    const isOccupied = computedStatus === 'occupied';
    const isReserved = computedStatus === 'reserved';
    // Only consider complimentary if explicitly true
    const isComplimentary = (isOccupied && booking?.is_complimentary === true) ||
                             (isReserved && reservedBooking?.is_complimentary === true);
    const actions: RoomAction[] = [];

    // Show complimentary info at the top if applicable
    if (isComplimentary) {
      actions.push(
        {
          id: 'complimentary-info',
          label: '🎁 Free Gift Booking - No Cancellation',
          icon: <GiftIcon />,
          color: 'secondary',
          onClick: () => {
            showSnackbar('This is a complimentary (Free Gift) booking. Cancellation is not recommended as the guest has used their free credits.', 'success');
          }
        }
      );
      actions.push({ id: 'divider-comp', label: '-', icon: <></>, onClick: () => {} });
    }

    // Check-in options (only if room is not occupied)
    if (!isOccupied) {
      actions.push(
        { id: 'walkin', label: 'Walk-in Guest Check-in', icon: <PersonAddIcon />, onClick: handleWalkInGuest },
        { id: 'online-checkin', label: 'Online Guest Check-in', icon: <BookingIcon />, onClick: handleOnlineCheckIn },
        { id: 'complimentary-checkin', label: 'Complimentary Check-in', icon: <GiftIcon />, color: 'secondary', onClick: handleComplimentaryCheckIn }
      );

      // Enhanced check-in for reserved rooms with existing booking
      if (isReserved && booking) {
        actions.push(
          { id: 'reserved-checkin', label: 'Check-in Reserved Booking', icon: <LoginIcon />, color: 'primary', onClick: handleCheckIn }
        );
      }

      // Mark as Complimentary for reserved rooms with booking (not yet checked in)
      if (isReserved && reservedBooking && !reservedBooking.is_complimentary) {
        actions.push(
          { id: 'complimentary', label: 'Mark as Complimentary', icon: <GiftIcon />, color: 'secondary', onClick: handleMarkComplimentary }
        );
      }
    }

    // View Guest Details (for occupied or reserved rooms with booking)
    if ((isOccupied || isReserved) && booking?.guest_id) {
      actions.push(
        { id: 'guest-details', label: 'View Guest Details', icon: <PersonIcon />, color: 'info', onClick: (r) => handleViewGuestDetails(booking.guest_id) }
      );
    }

    // Change Room option (only if room is occupied)
    if (isOccupied && booking) {
      actions.push(
        { id: 'change-room', label: 'Change Room', icon: <HotelIcon />, color: 'warning', onClick: handleChangeRoom }
      );
    }

    // Check-out option (only if room is occupied)
    if (isOccupied) {
      actions.push(
        { id: 'checkout', label: 'Check Out', icon: <LogoutIcon />, color: 'error', onClick: handleCheckOut }
      );
    }

    // Divider
    if (actions.length > 0) {
      actions.push({ id: 'divider1', label: '-', icon: <></>, onClick: () => {} });
    }

    // Make Vacant/Clean (only if room is NOT occupied)
    if (!isOccupied) {
      actions.push(
        { id: 'clean', label: 'Make Vacant/Clean', icon: <CheckCircleIcon />, color: 'success', onClick: handleMakeClean }
      );
    }

    // Make Dirty (always available)
    actions.push(
      { id: 'dirty', label: 'Make Dirty', icon: <CleaningIcon />, color: 'warning', onClick: handleMakeDirty }
    );

    // Maintenance and unavailable options
    actions.push(
      { id: 'maintenance', label: 'Maintenance', icon: <MaintenanceIcon />, color: 'warning', onClick: handleMaintenance },
      { id: 'unavailable', label: 'Make Unavailable', icon: <BlockIcon />, onClick: handleMakeUnavailable },
      { id: 'divider2', label: '-', icon: <></>, onClick: () => {} },
      { id: 'history', label: 'Show Room History', icon: <HistoryIcon />, onClick: handleShowHistory },
      { id: 'properties', label: 'Room Properties...', icon: <SettingsIcon />, onClick: handleRoomProperties }
    );

    return actions;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, display: 'flex', alignItems: 'center' }}>
          <HotelIcon sx={{ mr: 1, fontSize: 32 }} />
          Room Management Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Real-time room status and management. Click on a room for quick actions.
        </Typography>

        {/* Status Legend */}
        <Paper sx={{ p: 2, mt: 2, bgcolor: 'grey.50' }}>
          <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
            Status Legend:
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Chip label="Vacant/Clean" sx={{ bgcolor: '#66BB6A', color: 'white' }} size="small" />
            <Chip label="Occupied/Dirty" sx={{ bgcolor: '#FFA726', color: 'white' }} size="small" />
            <Chip label="Reserved" sx={{ bgcolor: '#42A5F5', color: 'white' }} size="small" />
            <Chip label="Maintenance" sx={{ bgcolor: '#EF5350', color: 'white' }} size="small" />
            <Chip label="Unavailable" sx={{ bgcolor: '#BDBDBD', color: 'white' }} size="small" />
          </Stack>
        </Paper>

        {/* Quick Stats */}
        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item xs={6} sm={3}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#66BB6A', color: 'white' }}>
              <Typography variant="h4" fontWeight={700}>
                {rooms.filter(r => r.available && r.status === 'available').length}
              </Typography>
              <Typography variant="body2">Available</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#FFA726', color: 'white' }}>
              <Typography variant="h4" fontWeight={700}>
                {rooms.filter(r => r.status === 'occupied').length}
              </Typography>
              <Typography variant="body2">Occupied</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#FFEB3B', color: '#333' }}>
              <Typography variant="h4" fontWeight={700}>
                {rooms.filter(r => r.status === 'cleaning').length}
              </Typography>
              <Typography variant="body2">Cleaning</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#EF5350', color: 'white' }}>
              <Typography variant="h4" fontWeight={700}>
                {rooms.filter(r => r.status === 'maintenance').length}
              </Typography>
              <Typography variant="body2">Maintenance</Typography>
            </Paper>
          </Grid>
        </Grid>
      </Box>

      {/* Room Grid */}
      <Grid container spacing={2}>
        {rooms.map((room) => {
          const booking = roomBookings.get(room.id);
          const reservedBooking = reservedBookings.get(room.id);
          const complimentariseBooking = complimentariseBookings.get(room.id);

          // Compute dynamic status based on bookings - ensures sync with reservation timeline
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          // Check if there's a checked-in booking (occupied)
          const hasCheckedInBooking = booking?.status === 'checked_in';

          // Check if there's a reservation for today or before (reserved)
          const hasReservationForToday = reservedBooking && (() => {
            const checkInDate = new Date(reservedBooking.check_in_date);
            checkInDate.setHours(0, 0, 0, 0);
            return checkInDate <= today;
          })();

          // Check if there's a future reservation (not today)
          const hasFutureReservation = reservedBooking && !hasReservationForToday;
          const futureCheckInDate = hasFutureReservation ? new Date(reservedBooking.check_in_date) : null;

          // Compute the effective status
          const computedStatus = hasCheckedInBooking
            ? 'occupied'
            : hasReservationForToday
              ? 'reserved'
              : ['maintenance', 'out_of_order', 'dirty', 'cleaning'].includes(room.status || '')
                ? room.status
                : 'available';

          // Create a room object with computed status for display
          const displayRoom = { ...room, status: computedStatus };

          const isOccupied = computedStatus === 'occupied' || computedStatus === 'cleaning';
          const isReserved = computedStatus === 'reserved';
          const isReservedToday = isReserved && hasReservationForToday;
          // Only show FREE GIFT if is_complimentary is explicitly true (not undefined/null)
          const isComplimentary = (isOccupied && booking?.is_complimentary === true) ||
                                   (isReserved && reservedBooking?.is_complimentary === true);

          return (
            <Grid item xs={6} sm={4} md={3} lg={2} key={room.id}>
              <Card
                sx={{
                  bgcolor: getRoomStatusColor(displayRoom),
                  color: computedStatus === 'cleaning' ? '#333' : 'white',
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6,
                  },
                  position: 'relative',
                  height: 200,
                  display: 'flex',
                  flexDirection: 'column',
                }}
                onClick={(e) => {
                  e.preventDefault();
                  handleMenuOpen(e, room);
                }}
              >
                <CardContent sx={{ p: 1.5, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* Booking Indicator for Reserved Rooms */}
                  {isReservedToday && (
                    <BookingIcon
                      sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        fontSize: 24,
                        color: 'inherit',
                        opacity: 0.9,
                      }}
                    />
                  )}

                  {/* Complimentary Indicator */}
                  {isComplimentary && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 8,
                        left: isReservedToday ? 36 : 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.3,
                        bgcolor: 'rgba(156, 39, 176, 0.9)',
                        borderRadius: 1,
                        px: 0.5,
                        py: 0.2,
                      }}
                    >
                      <GiftIcon sx={{ fontSize: 14 }} />
                      <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 600 }}>
                        FREE
                      </Typography>
                    </Box>
                  )}

                  {/* Room Number */}
                  <Typography variant="h5" fontWeight={700} gutterBottom sx={{ mt: isReservedToday || isComplimentary ? 3 : 0 }}>
                    {room.room_number}
                  </Typography>

                  {/* Room Type Code */}
                  <Chip
                    label={getRoomTypeCode(room.room_type)}
                    size="small"
                    sx={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      mb: 1,
                      bgcolor: 'rgba(0,0,0,0.2)',
                      color: 'inherit',
                    }}
                  />

                  {/* Status Label */}
                  <Typography variant="caption" display="block" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {getRoomStatusLabel(displayRoom)}
                    {isComplimentary && ' • 🎁 FREE GIFT'}
                    {complimentariseBooking && ' • 🔓 RELEASED'}
                  </Typography>

                  {/* Future Reservation Indicator with Guest Info */}
                  {hasFutureReservation && futureCheckInDate && reservedBooking && (
                    <Box sx={{ mb: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <BookingIcon sx={{ fontSize: 12 }} />
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{
                            fontSize: '0.6rem',
                            fontWeight: 500,
                            bgcolor: 'rgba(0,0,0,0.2)',
                            px: 0.5,
                            borderRadius: 0.5,
                          }}
                        >
                          📅 {new Date(reservedBooking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(reservedBooking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{
                          fontSize: '0.6rem',
                          opacity: 0.9,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        👤 {reservedBooking.guest_name}
                      </Typography>
                    </Box>
                  )}

                  {/* Complimentarise Booking Indicator - Room was released for guest to use credits elsewhere */}
                  {complimentariseBooking && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{
                          fontSize: '0.6rem',
                          fontWeight: 500,
                          bgcolor: 'rgba(156, 39, 176, 0.3)',
                          px: 0.5,
                          borderRadius: 0.5,
                        }}
                      >
                        Released: {new Date(complimentariseBooking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(complimentariseBooking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Typography>
                    </Box>
                  )}

                  {/* Staying Time for Occupied/Dirty Rooms */}
                  {isOccupied && booking && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <TimeIcon sx={{ fontSize: 14 }} />
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{
                          fontSize: '0.65rem',
                          fontWeight: 500,
                        }}
                      >
                        {new Date(booking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(booking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Typography>
                    </Box>
                  )}

                  {/* Guest Details for Occupied Rooms */}
                  {booking?.guest_name && isOccupied ? (
                    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          mb: 0.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {booking.guest_name}
                      </Typography>
                      {booking.guest_phone && (
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{
                            fontSize: '0.6rem',
                            opacity: 0.9,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          📞 {booking.guest_phone}
                        </Typography>
                      )}
                      {booking.guest_email && (
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{
                            fontSize: '0.6rem',
                            opacity: 0.9,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            mb: 0.5,
                          }}
                        >
                          ✉️ {booking.guest_email}
                        </Typography>
                      )}
                      {booking.guest_id && (
                        <Box
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewGuestDetails(booking.guest_id);
                          }}
                          sx={{
                            bgcolor: 'rgba(255,255,255,0.2)',
                            borderRadius: 1,
                            p: 0.5,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            '&:hover': {
                              bgcolor: 'rgba(255,255,255,0.3)',
                              transform: 'translateY(-1px)',
                            },
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.5,
                          }}
                        >
                          <PersonIcon sx={{ fontSize: 14 }} />
                          <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>
                            View Full Details
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  ) : room.status_notes ? (
                    <Typography
                      variant="caption"
                      display="block"
                      sx={{
                        fontSize: '0.65rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {room.status_notes}
                    </Typography>
                  ) : null}

                  {/* Online Check-in Button for Reserved Rooms */}
                  {isReservedToday && reservedBooking && (
                    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          mb: 0.25,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {reservedBooking.guest_name}
                      </Typography>
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{
                          fontSize: '0.6rem',
                          opacity: 0.9,
                          mb: 0.25,
                        }}
                      >
                        📅 {new Date(reservedBooking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(reservedBooking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Typography>
                      {reservedBooking.guest_phone && (
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{
                            fontSize: '0.6rem',
                            opacity: 0.9,
                            mb: 0.5,
                          }}
                        >
                          📞 {reservedBooking.guest_phone}
                        </Typography>
                      )}
                      <Box
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCheckIn(room);
                        }}
                        sx={{
                          bgcolor: 'rgba(255,255,255,0.2)',
                          borderRadius: 1,
                          p: 0.5,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          '&:hover': {
                            bgcolor: 'rgba(255,255,255,0.3)',
                            transform: 'translateY(-1px)',
                          },
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 0.5,
                        }}
                      >
                        <LoginIcon sx={{ fontSize: 14 }} />
                        <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>
                          Online Check-in
                        </Typography>
                      </Box>
                    </Box>
                  )}

                  {/* More Icon */}
                  <IconButton
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      color: 'inherit',
                      bgcolor: 'rgba(0,0,0,0.1)',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.2)' },
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMenuOpen(e, room);
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        PaperProps={{
          sx: { minWidth: 240 },
        }}
      >
        {selectedRoom && (
          <Box sx={{ px: 2, py: 1, bgcolor: 'grey.100' }}>
            <Typography variant="subtitle2" fontWeight={600}>
              Room {selectedRoom.room_number}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {selectedRoom.room_type} • Status: {selectedRoom.status?.toUpperCase() || 'UNKNOWN'}
            </Typography>
          </Box>
        )}
        <Divider />
        {getMenuActions(selectedRoom).map((action) =>
          action.label === '-' ? (
            <Divider key={action.id} sx={{ my: 1 }} />
          ) : (
            <MenuItem
              key={action.id}
              onClick={() => selectedRoom && action.onClick(selectedRoom)}
            >
              <ListItemIcon sx={{ color: action.color || 'inherit' }}>
                {action.icon}
              </ListItemIcon>
              <ListItemText
                primary={action.label}
                sx={{ color: action.color || 'inherit' }}
              />
            </MenuItem>
          )
        )}
      </Menu>

      {/* Walk-in Guest Dialog */}
      <Dialog
        open={walkInDialogOpen}
        onClose={handleCloseWalkInDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <LoginIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Walk-in Guest Check-in - Room {selectedRoom?.room_number || 'N/A'}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          <Grid container spacing={3}>
            {/* Toggle between existing guest and new guest */}
            <Grid item xs={12}>
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Button
                  variant={!isCreatingNewGuest ? 'contained' : 'outlined'}
                  onClick={() => setIsCreatingNewGuest(false)}
                  size="small"
                >
                  Select Existing Guest
                </Button>
                <Button
                  variant={isCreatingNewGuest ? 'contained' : 'outlined'}
                  onClick={() => setIsCreatingNewGuest(true)}
                  size="small"
                >
                  Register New Guest
                </Button>
              </Stack>
            </Grid>

            {/* Guest Selection (Existing Guest) */}
            {!isCreatingNewGuest && (
              <Grid item xs={12}>
                <Autocomplete
                  value={walkInGuest}
                  onChange={(_, newValue) => setWalkInGuest(newValue)}
                  options={guests}
                  getOptionLabel={(option) =>
                    `${option.full_name} - ${option.email}`
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Select Guest *"
                      placeholder="Search by name or email"
                    />
                  )}
                />
              </Grid>
            )}

            {/* New Guest Registration Form */}
            {isCreatingNewGuest && (
              <>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    required
                    label="First Name"
                    value={newGuestForm.first_name}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, first_name: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    required
                    label="Last Name"
                    value={newGuestForm.last_name}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, last_name: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    required
                    label="Email"
                    type="email"
                    value={newGuestForm.email}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, email: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Phone"
                    value={newGuestForm.phone}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, phone: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="IC/Passport Number"
                    value={newGuestForm.ic_number}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, ic_number: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Nationality"
                    value={newGuestForm.nationality}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, nationality: e.target.value })}
                  />
                </Grid>
              </>
            )}

            {/* Check-in Date */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-in Date"
                value={walkInCheckInDate}
                onChange={(e) => {
                  setWalkInCheckInDate(e.target.value);
                  // Calculate nights if both dates are set
                  if (walkInCheckOutDate) {
                    const checkIn = new Date(e.target.value);
                    const checkOut = new Date(walkInCheckOutDate);
                    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
                    setWalkInNumberOfNights(nights);
                  }
                }}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Check-out Date */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-out Date"
                value={walkInCheckOutDate}
                onChange={(e) => {
                  setWalkInCheckOutDate(e.target.value);
                  // Calculate nights
                  if (walkInCheckInDate) {
                    const checkIn = new Date(walkInCheckInDate);
                    const checkOut = new Date(e.target.value);
                    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
                    setWalkInNumberOfNights(nights);
                  }
                }}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Summary */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Booking Summary
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Number of Nights:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2">
                      {walkInNumberOfNights}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Rate:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2">
                      {currencySymbol}{selectedRoom?.price_per_night || 0} / night
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Total Amount:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" fontWeight="bold">
                      {currencySymbol}{(() => {
                        const price = selectedRoom?.price_per_night || 0;
                        const numPrice = typeof price === 'string' ? parseFloat(price) : price;
                        return (numPrice * walkInNumberOfNights).toFixed(2);
                      })()}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={handleCloseWalkInDialog} disabled={creatingBooking}>
            Cancel
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            onClick={handleWalkInGuestSelected}
            disabled={
              creatingBooking ||
              (!isCreatingNewGuest && !walkInGuest) ||
              (isCreatingNewGuest && (!newGuestForm.first_name || !newGuestForm.last_name || !newGuestForm.email))
            }
            startIcon={creatingBooking ? <CircularProgress size={20} /> : null}
            size="large"
          >
            {creatingBooking ? 'Processing...' : 'Check In Guest'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Online Check-in Dialog */}
      <Dialog
        open={onlineCheckInDialogOpen}
        onClose={handleCloseOnlineCheckInDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <BookingIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Online Guest Check-in - Room {selectedRoom?.room_number || 'N/A'}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          <Grid container spacing={3}>
            {/* Toggle between existing guest and new guest */}
            <Grid item xs={12}>
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Button
                  variant={!isCreatingNewOnlineGuest ? 'contained' : 'outlined'}
                  onClick={() => setIsCreatingNewOnlineGuest(false)}
                  size="small"
                >
                  Select Existing Guest
                </Button>
                <Button
                  variant={isCreatingNewOnlineGuest ? 'contained' : 'outlined'}
                  onClick={() => setIsCreatingNewOnlineGuest(true)}
                  size="small"
                >
                  Register New Guest
                </Button>
              </Stack>
            </Grid>

            {/* Guest Selection (Existing Guest) */}
            {!isCreatingNewOnlineGuest && (
              <Grid item xs={12}>
                <Autocomplete
                  value={onlineCheckInGuest}
                  onChange={(_, newValue) => setOnlineCheckInGuest(newValue)}
                  options={guests}
                  getOptionLabel={(option) =>
                    `${option.full_name} - ${option.email}`
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Select Guest *"
                      placeholder="Search by name or email"
                    />
                  )}
                />
              </Grid>
            )}

            {/* New Guest Registration Form */}
            {isCreatingNewOnlineGuest && (
              <>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    required
                    label="First Name"
                    value={newOnlineGuestForm.first_name}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, first_name: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    required
                    label="Last Name"
                    value={newOnlineGuestForm.last_name}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, last_name: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    required
                    label="Email"
                    type="email"
                    value={newOnlineGuestForm.email}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, email: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Phone"
                    value={newOnlineGuestForm.phone}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, phone: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="IC/Passport Number"
                    value={newOnlineGuestForm.ic_number}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, ic_number: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Nationality"
                    value={newOnlineGuestForm.nationality}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, nationality: e.target.value })}
                  />
                </Grid>
              </>
            )}

            {/* Booking Channel */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>Booking Channel</InputLabel>
                <Select
                  value={onlineCheckInBookingChannel}
                  onChange={(e) => setOnlineCheckInBookingChannel(e.target.value)}
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

            {/* Booking Reference */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Booking Reference"
                value={onlineReference}
                onChange={(e) => setOnlineReference(e.target.value)}
                placeholder="e.g., OL-123456"
              />
            </Grid>

            {/* Check-in Date */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-in Date"
                value={onlineCheckInDate}
                onChange={(e) => {
                  setOnlineCheckInDate(e.target.value);
                  // Calculate nights if both dates are set
                  if (onlineCheckOutDate) {
                    const checkIn = new Date(e.target.value);
                    const checkOut = new Date(onlineCheckOutDate);
                    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
                    setOnlineNumberOfNights(nights);
                  }
                }}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Check-out Date */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-out Date"
                value={onlineCheckOutDate}
                onChange={(e) => {
                  setOnlineCheckOutDate(e.target.value);
                  // Calculate nights
                  if (onlineCheckInDate) {
                    const checkIn = new Date(onlineCheckInDate);
                    const checkOut = new Date(e.target.value);
                    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
                    setOnlineNumberOfNights(nights);
                  }
                }}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Summary */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Booking Summary
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Number of Nights:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2">
                      {onlineNumberOfNights}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Rate:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2">
                      {currencySymbol}{selectedRoom?.price_per_night || 0} / night
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Total Amount:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" fontWeight="bold">
                      {currencySymbol}{(() => {
                        const price = selectedRoom?.price_per_night || 0;
                        const numPrice = typeof price === 'string' ? parseFloat(price) : price;
                        return (numPrice * onlineNumberOfNights).toFixed(2);
                      })()}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={handleCloseOnlineCheckInDialog} disabled={creatingBooking}>
            Cancel
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            onClick={handleOnlineGuestSelected}
            disabled={
              creatingBooking ||
              !onlineCheckInBookingChannel ||
              (!isCreatingNewOnlineGuest && !onlineCheckInGuest) ||
              (isCreatingNewOnlineGuest && (!newOnlineGuestForm.first_name || !newOnlineGuestForm.last_name || !newOnlineGuestForm.email))
            }
            startIcon={creatingBooking ? <CircularProgress size={20} /> : null}
            size="large"
          >
            {creatingBooking ? 'Processing...' : 'Continue to Check-In'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Complimentary Check-in Dialog */}
      <Dialog
        open={complimentaryCheckInDialogOpen}
        onClose={handleCloseComplimentaryCheckInDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'secondary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <GiftIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Complimentary Check-in - Room {selectedRoom?.room_number || 'N/A'}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          <Grid container spacing={3}>
            {/* Info Banner */}
            <Grid item xs={12}>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  This check-in uses the guest's <strong>Free Room Credits</strong>. Only guests with available credits are shown below.
                </Typography>
              </Alert>
            </Grid>

            {/* Guest Selection (Only guests with credits) */}
            <Grid item xs={12}>
              {loadingGuestsWithCredits ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                  <CircularProgress size={24} />
                  <Typography sx={{ ml: 1 }}>Loading guests with credits...</Typography>
                </Box>
              ) : (
                <Autocomplete
                  value={complimentaryCheckInGuest}
                  onChange={(_, newValue) => setComplimentaryCheckInGuest(newValue)}
                  options={guestsWithCredits}
                  getOptionLabel={(option) => {
                    const totalCredits = option.legacy_complimentary_nights_credit + option.total_complimentary_credits;
                    return `${option.full_name} - ${option.email} (${totalCredits} credits)`;
                  }}
                  renderOption={(props, option) => {
                    const totalCredits = option.legacy_complimentary_nights_credit + option.total_complimentary_credits;
                    return (
                      <Box component="li" {...props}>
                        <Box sx={{ width: '100%' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box>
                              <Typography variant="body1">{option.full_name}</Typography>
                              <Typography variant="caption" color="text.secondary">{option.email}</Typography>
                            </Box>
                            <Chip
                              icon={<GiftIcon sx={{ fontSize: 14 }} />}
                              label={`${totalCredits} night${totalCredits !== 1 ? 's' : ''}`}
                              size="small"
                              color="secondary"
                            />
                          </Box>
                          {/* Show room-type-specific credits breakdown */}
                          {option.credits_by_room_type.length > 0 && (
                            <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {option.credits_by_room_type.map((credit) => (
                                <Chip
                                  key={credit.room_type_id}
                                  label={`${credit.room_type_name}: ${credit.nights_available}`}
                                  size="small"
                                  variant="outlined"
                                  sx={{ fontSize: '0.65rem', height: 20 }}
                                />
                              ))}
                              {option.legacy_complimentary_nights_credit > 0 && (
                                <Chip
                                  label={`Any room: ${option.legacy_complimentary_nights_credit}`}
                                  size="small"
                                  variant="outlined"
                                  sx={{ fontSize: '0.65rem', height: 20 }}
                                />
                              )}
                            </Box>
                          )}
                        </Box>
                      </Box>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Select Guest with Free Room Credits *"
                      placeholder="Search by name or email"
                    />
                  )}
                  noOptionsText="No guests with free room credits found"
                />
              )}
            </Grid>

            {/* Check-in Date */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-in Date"
                value={complimentaryCheckInDate}
                onChange={(e) => {
                  setComplimentaryCheckInDate(e.target.value);
                  if (complimentaryCheckOutDate) {
                    const checkIn = new Date(e.target.value);
                    const checkOut = new Date(complimentaryCheckOutDate);
                    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
                    setComplimentaryNumberOfNights(nights);
                  }
                }}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Check-out Date */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-out Date"
                value={complimentaryCheckOutDate}
                onChange={(e) => {
                  setComplimentaryCheckOutDate(e.target.value);
                  if (complimentaryCheckInDate) {
                    const checkIn = new Date(complimentaryCheckInDate);
                    const checkOut = new Date(e.target.value);
                    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
                    setComplimentaryNumberOfNights(nights);
                  }
                }}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Summary */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: 'secondary.light' }}>
                <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <GiftIcon /> Booking Summary
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Number of Nights:</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2">{complimentaryNumberOfNights}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Room Rate:</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'text.disabled' }}>
                      {currencySymbol}{selectedRoom?.price_per_night || 0} / night
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Total Amount:</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" fontWeight="bold" color="success.main">
                      FREE (Complimentary)
                    </Typography>
                  </Grid>
                  {complimentaryCheckInGuest && (
                    <>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">Credits Available:</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {complimentaryCheckInGuest.credits_by_room_type.map((credit) => (
                            <Chip
                              key={credit.room_type_id}
                              size="small"
                              label={`${credit.room_type_name}: ${credit.nights_available}`}
                              color="secondary"
                              variant="outlined"
                              sx={{ fontSize: '0.7rem' }}
                            />
                          ))}
                          {complimentaryCheckInGuest.legacy_complimentary_nights_credit > 0 && (
                            <Chip
                              size="small"
                              icon={<GiftIcon sx={{ fontSize: 14 }} />}
                              label={`Any: ${complimentaryCheckInGuest.legacy_complimentary_nights_credit}`}
                              color="secondary"
                            />
                          )}
                        </Box>
                      </Grid>
                    </>
                  )}
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={handleCloseComplimentaryCheckInDialog} disabled={creatingBooking}>
            Cancel
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            color="secondary"
            onClick={handleComplimentaryCheckInSubmit}
            disabled={creatingBooking || !complimentaryCheckInGuest}
            startIcon={creatingBooking ? <CircularProgress size={20} /> : <GiftIcon />}
            size="large"
          >
            {creatingBooking ? 'Processing...' : 'Check In (Complimentary)'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Change Room Dialog */}
      <Dialog
        open={changeRoomDialogOpen}
        onClose={() => !changingRoom && setChangeRoomDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <HotelIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Change Room - Current: {selectedRoom?.room_number || 'N/A'}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          <Grid container spacing={3}>
            {/* Current Room Info */}
            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Current Room
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Number:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" fontWeight="bold">
                      {selectedRoom?.room_number}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Type:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2">
                      {selectedRoom?.room_type}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Current Rate:
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2">
                      {currencySymbol}{selectedRoom?.price_per_night} / night
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {/* New Room Selection */}
            <Grid item xs={12}>
              <FormControl fullWidth required>
                <InputLabel>Select New Room</InputLabel>
                <Select
                  value={newSelectedRoom?.id || ''}
                  onChange={(e) => {
                    const room = rooms.find(r => r.id === e.target.value);
                    setNewSelectedRoom(room || null);
                  }}
                  label="Select New Room"
                >
                  {rooms
                    .filter(r => r.status === 'available' && r.id !== selectedRoom?.id)
                    .map((room) => (
                      <MenuItem key={room.id} value={room.id}>
                        Room {room.room_number} - {room.room_type} ({currencySymbol}{room.price_per_night}/night)
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Price Difference Display */}
            {newSelectedRoom && selectedRoom && (
              <Grid item xs={12}>
                <Paper sx={{ p: 2, bgcolor: 'info.lighter' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Price Difference
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        New Room Rate:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" fontWeight="bold">
                        {currencySymbol}{newSelectedRoom.price_per_night} / night
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Difference per Night:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography
                        variant="body2"
                        fontWeight="bold"
                        color={(() => {
                          const oldPrice = typeof selectedRoom.price_per_night === 'string'
                            ? parseFloat(selectedRoom.price_per_night)
                            : selectedRoom.price_per_night;
                          const newPrice = typeof newSelectedRoom.price_per_night === 'string'
                            ? parseFloat(newSelectedRoom.price_per_night)
                            : newSelectedRoom.price_per_night;
                          const diff = newPrice - oldPrice;
                          return diff > 0 ? 'error.main' : diff < 0 ? 'success.main' : 'text.primary';
                        })()}
                      >
                        {(() => {
                          const oldPrice = typeof selectedRoom.price_per_night === 'string'
                            ? parseFloat(selectedRoom.price_per_night)
                            : selectedRoom.price_per_night;
                          const newPrice = typeof newSelectedRoom.price_per_night === 'string'
                            ? parseFloat(newSelectedRoom.price_per_night)
                            : newSelectedRoom.price_per_night;
                          const diff = newPrice - oldPrice;
                          return diff > 0
                            ? `+${currencySymbol}${diff.toFixed(2)} (Additional Charge)`
                            : diff < 0
                            ? `-${currencySymbol}${Math.abs(diff).toFixed(2)} (Credit)`
                            : `${currencySymbol}0.00 (No Change)`;
                        })()}
                      </Typography>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            )}
          </Grid>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => setChangeRoomDialogOpen(false)} disabled={changingRoom}>
            Cancel
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            onClick={handleConfirmRoomChange}
            disabled={!newSelectedRoom || changingRoom}
            startIcon={changingRoom ? <CircularProgress size={20} /> : null}
            size="large"
            color="warning"
          >
            {changingRoom ? 'Changing Room...' : 'Confirm Room Change'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Enhanced Check-In Modal */}
      <EnhancedCheckInModal
        open={enhancedCheckInOpen}
        onClose={() => {
          setEnhancedCheckInOpen(false);
          setCheckInBooking(null);
          setCheckInGuest(null);
        }}
        booking={checkInBooking}
        guest={checkInGuest}
        onCheckInSuccess={handleEnhancedCheckInSuccess}
      />

      {/* Check Out Dialog with Invoice */}
      <CheckoutInvoiceModal
        open={checkOutDialogOpen}
        onClose={() => {
          setCheckOutDialogOpen(false);
          setSelectedBooking(null);
        }}
        booking={selectedBooking}
        onConfirmCheckout={handleConfirmCheckout}
      />

      {/* Room History Dialog - Enhanced */}
      <Dialog open={historyDialogOpen} onClose={() => setHistoryDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <HistoryIcon sx={{ fontSize: 28 }} />
                <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
                  Room History - {selectedRoom?.room_number}
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ opacity: 0.9, ml: 5 }}>
                {selectedRoom?.room_type} • Current Status: {selectedRoom?.status || 'Unknown'}
              </Typography>
            </Box>
            <IconButton
              onClick={() => setHistoryDialogOpen(false)}
              sx={{ color: 'white' }}
            >
              <CancelIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {loadingHistory ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : roomHistory.length === 0 ? (
            <Alert severity="info" sx={{ m: 2 }}>
              No history records found for this room
            </Alert>
          ) : (
            <Box sx={{ p: 2 }}>
              {/* Current Status Section */}
              {selectedRoom && (
                <Paper sx={{ p: 2, mb: 2, bgcolor: 'primary.50', borderLeft: 4, borderColor: 'primary.main' }}>
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                    Current Status
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Status</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {selectedRoom.status?.toUpperCase() || 'UNKNOWN'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">Available</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {selectedRoom.available ? 'Yes' : 'No'}
                      </Typography>
                    </Grid>
                    {selectedRoom.status_notes && (
                      <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary">Notes</Typography>
                        <Typography variant="body2">{selectedRoom.status_notes}</Typography>
                      </Grid>
                    )}
                    {roomBookings.get(selectedRoom.id) && (
                      <>
                        <Grid item xs={12}>
                          <Divider sx={{ my: 1 }} />
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Guest</Typography>
                          <Typography variant="body2" fontWeight={600}>
                            {roomBookings.get(selectedRoom.id)?.guest_name}
                          </Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Booking Period</Typography>
                          <Typography variant="body2">
                            {new Date(roomBookings.get(selectedRoom.id)!.check_in_date).toLocaleDateString()} - {new Date(roomBookings.get(selectedRoom.id)!.check_out_date).toLocaleDateString()}
                          </Typography>
                        </Grid>
                        <Grid item xs={12}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PersonIcon />}
                            onClick={() => handleViewGuestDetails(roomBookings.get(selectedRoom.id)!.guest_id)}
                          >
                            View Guest Details
                          </Button>
                        </Grid>
                      </>
                    )}
                  </Grid>
                </Paper>
              )}

              {/* History Timeline */}
              <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mt: 2, mb: 1 }}>
                History Timeline
              </Typography>
              <Stack spacing={1}>
                {roomHistory.map((entry) => {
                  const statusIcon = entry.to_status === 'occupied' ? <LoginIcon /> :
                                   entry.to_status === 'available' ? <CheckCircleIcon /> :
                                   entry.to_status === 'cleaning' ? <CleaningIcon /> :
                                   entry.to_status === 'maintenance' ? <MaintenanceIcon /> :
                                   entry.to_status === 'reserved' ? <BookingIcon /> :
                                   <HistoryIcon />;

                  const statusColor = entry.to_status === 'occupied' ? '#FFA726' :
                                    entry.to_status === 'available' ? '#66BB6A' :
                                    entry.to_status === 'cleaning' ? '#FFEB3B' :
                                    entry.to_status === 'maintenance' ? '#EF5350' :
                                    entry.to_status === 'reserved' ? '#42A5F5' :
                                    '#BDBDBD';

                  return (
                    <Paper
                      key={entry.id}
                      sx={{
                        p: 2,
                        borderLeft: 4,
                        borderColor: statusColor,
                        cursor: entry.guest_id ? 'pointer' : 'default',
                        '&:hover': entry.guest_id ? {
                          bgcolor: 'grey.50',
                          boxShadow: 2,
                        } : {},
                      }}
                      onClick={() => entry.guest_id && handleViewGuestDetails(entry.guest_id)}
                    >
                      <Grid container spacing={1} alignItems="center">
                        <Grid item>
                          <Box
                            sx={{
                              width: 40,
                              height: 40,
                              borderRadius: '50%',
                              bgcolor: statusColor,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: entry.to_status === 'cleaning' ? '#333' : 'white',
                            }}
                          >
                            {statusIcon}
                          </Box>
                        </Grid>
                        <Grid item xs>
                          <Typography variant="body2" fontWeight={600}>
                            {entry.from_status ? `${entry.from_status.toUpperCase()} → ${entry.to_status.toUpperCase()}` : entry.to_status.toUpperCase()}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {new Date(entry.created_at).toLocaleString()}
                            {entry.changed_by_name && ` • By: ${entry.changed_by_name}`}
                          </Typography>
                          {entry.guest_name && (
                            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                              Guest: {entry.guest_name}
                              {entry.start_date && entry.end_date && (
                                <> • {new Date(entry.start_date).toLocaleDateString()} - {new Date(entry.end_date).toLocaleDateString()}</>
                              )}
                            </Typography>
                          )}
                          {entry.notes && (
                            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                              {entry.notes}
                            </Typography>
                          )}
                          {entry.guest_id && (
                            <Chip
                              label="Click to view guest details"
                              size="small"
                              sx={{ mt: 1 }}
                              icon={<PersonIcon />}
                            />
                          )}
                        </Grid>
                      </Grid>
                    </Paper>
                  );
                })}
              </Stack>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => setHistoryDialogOpen(false)} variant="outlined">Close</Button>
        </DialogActions>
      </Dialog>

      {/* Room Properties Dialog - Placeholder */}
      <Dialog open={roomDetailsDialogOpen} onClose={() => setRoomDetailsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <SettingsIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Room Properties - {selectedRoom?.room_number}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {selectedRoom && (
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Room Number</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedRoom.room_number}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Room Type</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedRoom.room_type}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Price per Night</Typography>
                  <Typography variant="body1" fontWeight={600}>{formatCurrency(Number(selectedRoom.price_per_night))}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Max Occupancy</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedRoom.max_occupancy} guests</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedRoom.status}</Typography>
                </Grid>
                {selectedRoom.description && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">Description</Typography>
                    <Typography variant="body2">{selectedRoom.description}</Typography>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => setRoomDetailsDialogOpen(false)} variant="outlined">Close</Button>
        </DialogActions>
      </Dialog>

      {/* Guest Details Dialog with Tabs */}
      <Dialog
        open={guestDetailsDialogOpen}
        onClose={() => setGuestDetailsDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <PersonIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              {selectedGuestDetails?.full_name || 'Guest Details'}
            </Typography>
          </Box>
        </DialogTitle>

        <Tabs
          value={guestDetailsTab}
          onChange={(_, v) => {
            setGuestDetailsTab(v);
            if (v === 1) {
              loadAvailableRoomsForCredits();
            }
          }}
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          <Tab label="Guest Info" icon={<PersonIcon />} iconPosition="start" />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <GiftIcon />
                <span>Free Gift Credits</span>
                {guestCredits && (guestCredits.total_nights + guestCredits.legacy_total_nights) > 0 && (
                  <Chip
                    label={guestCredits.total_nights + guestCredits.legacy_total_nights}
                    size="small"
                    color="secondary"
                    sx={{ ml: 1 }}
                  />
                )}
              </Box>
            }
          />
        </Tabs>

        <DialogContent sx={{ pt: 3, pb: 3, minHeight: 400 }}>
          {/* Tab 0: Guest Info */}
          {guestDetailsTab === 0 && selectedGuestDetails && (
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Email</Typography>
                <Typography variant="body2">{selectedGuestDetails.email}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Phone</Typography>
                <Typography variant="body2">{selectedGuestDetails.phone || 'N/A'}</Typography>
              </Grid>
              {selectedGuestDetails.address_line1 && (
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">Address</Typography>
                  <Typography variant="body2">
                    {selectedGuestDetails.address_line1}
                    {selectedGuestDetails.city && `, ${selectedGuestDetails.city}`}
                    {selectedGuestDetails.state_province && `, ${selectedGuestDetails.state_province}`}
                    {selectedGuestDetails.postal_code && ` ${selectedGuestDetails.postal_code}`}
                  </Typography>
                </Grid>
              )}
              {selectedGuestDetails.country && (
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Country</Typography>
                  <Typography variant="body2">{selectedGuestDetails.country}</Typography>
                </Grid>
              )}
              {selectedGuestDetails.nationality && (
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Nationality</Typography>
                  <Typography variant="body2">{selectedGuestDetails.nationality}</Typography>
                </Grid>
              )}
              {selectedGuestDetails.ic_number && (
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">IC Number</Typography>
                  <Typography variant="body2">{selectedGuestDetails.ic_number}</Typography>
                </Grid>
              )}
              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary">Member Since</Typography>
                <Typography variant="body2">
                  {new Date(selectedGuestDetails.created_at).toLocaleDateString()}
                </Typography>
              </Grid>
            </Grid>
          )}

          {/* Tab 1: Free Gift Credits */}
          {guestDetailsTab === 1 && (
            <Box>
              {loadingCredits ? (
                <Box display="flex" justifyContent="center" py={4}>
                  <CircularProgress />
                </Box>
              ) : creditsBookingSuccess ? (
                /* Booking Success - Show Check-in Option */
                <Box>
                  <Alert severity="success" sx={{ mb: 3 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      🎉 Booking Created Successfully!
                    </Typography>
                    <Typography variant="body2">
                      Booking #{creditsBookingSuccess.booking_number} - {creditsBookingSuccess.complimentary_nights} night(s) are complimentary
                    </Typography>
                  </Alert>

                  <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                    <Button
                      variant="contained"
                      color="primary"
                      size="large"
                      startIcon={<LoginIcon />}
                      onClick={handleCheckInFromCreditsBooking}
                    >
                      Check In Now
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setCreditsBookingSuccess(null);
                        setSelectedComplimentaryDates([]);
                      }}
                    >
                      Book Another Room
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Grid container spacing={3}>
                  {/* Credits Summary */}
                  <Grid item xs={12}>
                    <Paper sx={{ p: 2, bgcolor: 'secondary.light' }}>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <GiftIcon /> Available Free Gift Credits
                      </Typography>
                      {guestCredits && (guestCredits.total_nights + guestCredits.legacy_total_nights) > 0 ? (
                        <Box>
                          {guestCredits.credits_by_room_type.map((credit) => (
                            <Chip
                              key={credit.id}
                              icon={<GiftIcon />}
                              label={`${credit.room_type_name}: ${credit.nights_available} night(s)`}
                              color="success"
                              sx={{ mr: 1, mb: 1 }}
                            />
                          ))}
                          {guestCredits.legacy_total_nights > 0 && (
                            <Chip
                              icon={<GiftIcon />}
                              label={`Any Room: ${guestCredits.legacy_total_nights} night(s)`}
                              color="info"
                              sx={{ mr: 1, mb: 1 }}
                            />
                          )}
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No complimentary credits available
                        </Typography>
                      )}
                    </Paper>
                  </Grid>

                  {/* Booking Form */}
                  {guestCredits && (guestCredits.total_nights + guestCredits.legacy_total_nights) > 0 && (
                    <>
                      <Grid item xs={12}>
                        <Typography variant="subtitle1" fontWeight={600}>
                          Book a Room with Free Gift Credits
                        </Typography>
                      </Grid>

                      <Grid item xs={6}>
                        <TextField
                          label="Check-in Date"
                          type="date"
                          fullWidth
                          value={creditsBookingForm.check_in_date}
                          onChange={(e) => {
                            setCreditsBookingForm({ ...creditsBookingForm, check_in_date: e.target.value });
                            setSelectedComplimentaryDates([]);
                          }}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          label="Check-out Date"
                          type="date"
                          fullWidth
                          value={creditsBookingForm.check_out_date}
                          onChange={(e) => {
                            setCreditsBookingForm({ ...creditsBookingForm, check_out_date: e.target.value });
                            setSelectedComplimentaryDates([]);
                          }}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>

                      <Grid item xs={12}>
                        <FormControl fullWidth>
                          <InputLabel>Select Room</InputLabel>
                          <Select
                            value={creditsBookingForm.room_id}
                            onChange={(e) => {
                              setCreditsBookingForm({ ...creditsBookingForm, room_id: e.target.value });
                              setSelectedComplimentaryDates([]);
                              setRoomBlockedDates([]);
                              if (e.target.value) {
                                loadRoomBlockedDates(e.target.value);
                              }
                            }}
                            label="Select Room"
                          >
                            {availableRoomsForCredits.map((room) => (
                              <MenuItem key={room.id} value={room.id.toString()}>
                                Room {room.room_number} - {room.room_type}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>

                      {/* Date Selection for Complimentary Nights */}
                      {creditsBookingForm.room_id && getCreditsBookingDates().length > 0 && (
                        <Grid item xs={12}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography variant="subtitle2">
                              Select Complimentary Dates (Available: {getTotalCreditsForRoom(creditsBookingForm.room_id)})
                            </Typography>
                            <Button size="small" onClick={selectAllCreditsAvailable}>
                              Select All Available
                            </Button>
                          </Box>
                          <Paper variant="outlined" sx={{ p: 2, maxHeight: 180, overflow: 'auto' }}>
                            {roomBlockedDates.length > 0 && (
                              <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Box sx={{ width: 12, height: 12, backgroundColor: 'error.light', borderRadius: 0.5 }} />
                                <Typography variant="caption" color="text.secondary">
                                  Reserved (unavailable)
                                </Typography>
                              </Box>
                            )}
                            <FormGroup row>
                              {getCreditsBookingDates().map((date) => {
                                const isSelected = selectedComplimentaryDates.includes(date);
                                const isBlocked = isDateBlocked(date);
                                const canSelect = !isBlocked && (isSelected || selectedComplimentaryDates.length < getTotalCreditsForRoom(creditsBookingForm.room_id));

                                // Show blocked dates with a block icon instead of checkbox
                                if (isBlocked) {
                                  return (
                                    <Box
                                      key={date}
                                      sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                        backgroundColor: 'rgba(211, 47, 47, 0.12)',
                                        borderRadius: 1,
                                        mr: 1,
                                        mb: 1,
                                        px: 1,
                                        py: 0.5,
                                        border: '1px solid rgba(211, 47, 47, 0.4)',
                                        cursor: 'not-allowed',
                                      }}
                                    >
                                      <BlockIcon sx={{ fontSize: 18, color: 'error.main' }} />
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          textDecoration: 'line-through',
                                          color: 'error.main',
                                          fontSize: '0.85rem',
                                        }}
                                      >
                                        {new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                      </Typography>
                                    </Box>
                                  );
                                }

                                return (
                                  <FormControlLabel
                                    key={date}
                                    control={
                                      <Checkbox
                                        checked={isSelected}
                                        onChange={() => handleCreditsDateToggle(date)}
                                        disabled={!canSelect && !isSelected}
                                        color="secondary"
                                      />
                                    }
                                    label={new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                    sx={{
                                      backgroundColor: isSelected ? 'rgba(156, 39, 176, 0.1)' : 'transparent',
                                      borderRadius: 1,
                                      mr: 1,
                                      mb: 1,
                                      px: 1,
                                    }}
                                  />
                                );
                              })}
                            </FormGroup>
                          </Paper>
                          {selectedComplimentaryDates.length > 0 && (
                            <Alert severity="success" sx={{ mt: 1 }}>
                              {selectedComplimentaryDates.length} night(s) will be complimentary (Free Gift)
                            </Alert>
                          )}
                        </Grid>
                      )}

                      <Grid item xs={6}>
                        <TextField
                          label="Adults"
                          type="number"
                          fullWidth
                          value={creditsBookingForm.adults}
                          onChange={(e) => setCreditsBookingForm({ ...creditsBookingForm, adults: parseInt(e.target.value) || 1 })}
                          inputProps={{ min: 1, max: 10 }}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          label="Children"
                          type="number"
                          fullWidth
                          value={creditsBookingForm.children}
                          onChange={(e) => setCreditsBookingForm({ ...creditsBookingForm, children: parseInt(e.target.value) || 0 })}
                          inputProps={{ min: 0, max: 10 }}
                        />
                      </Grid>

                      <Grid item xs={12}>
                        <Button
                          variant="contained"
                          color="secondary"
                          fullWidth
                          size="large"
                          startIcon={bookingWithCredits ? <CircularProgress size={20} color="inherit" /> : <GiftIcon />}
                          onClick={handleBookWithCreditsAndCheckIn}
                          disabled={
                            bookingWithCredits ||
                            !creditsBookingForm.room_id ||
                            selectedComplimentaryDates.length === 0 ||
                            getCreditsBookingDates().length === 0
                          }
                        >
                          {bookingWithCredits ? 'Creating Booking...' : 'Book with Free Gift Credits'}
                        </Button>
                      </Grid>
                    </>
                  )}
                </Grid>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => setGuestDetailsDialogOpen(false)} variant="outlined">Close</Button>
        </DialogActions>
      </Dialog>

      {/* Mark as Complimentary Dialog */}
      <Dialog
        open={complimentaryDialogOpen}
        onClose={() => !markingComplimentary && setComplimentaryDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'secondary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <GiftIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Mark Booking as Complimentary
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          {selectedBooking && (
            <Grid container spacing={3}>
              {/* Booking Info */}
              <Grid item xs={12}>
                <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Booking Details
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Room:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" fontWeight="bold">
                        {selectedRoom?.room_number} - {selectedRoom?.room_type}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Guest:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" fontWeight="bold">
                        {selectedBooking.guest_name}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Check-in Date:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">
                        {new Date(selectedBooking.check_in_date).toLocaleDateString()}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Check-out Date:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">
                        {new Date(selectedBooking.check_out_date).toLocaleDateString()}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Original Amount:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'error.main' }}>
                        {currencySymbol}{Number(selectedBooking.total_amount).toFixed(2)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        New Amount:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" fontWeight="bold" color="success.main">
                        {currencySymbol}0.00 (Complimentary)
                      </Typography>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>

              {/* Reason Input */}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Reason for Complimentary Stay"
                  placeholder="e.g., VIP guest, compensation, promotional offer"
                  value={complimentaryReason}
                  onChange={(e) => setComplimentaryReason(e.target.value)}
                  multiline
                  rows={2}
                />
              </Grid>

              {/* Info Alert */}
              <Grid item xs={12}>
                <Alert severity="info" sx={{ mt: 1 }}>
                  Marking this booking as complimentary will set the total amount to {currencySymbol}0.00.
                  If the guest cancels or doesn't show up, the complimentary nights will be converted to credits for future use.
                </Alert>
              </Grid>
            </Grid>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => setComplimentaryDialogOpen(false)} disabled={markingComplimentary}>
            Cancel
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            color="secondary"
            onClick={handleConfirmMarkComplimentary}
            disabled={markingComplimentary}
            startIcon={markingComplimentary ? <CircularProgress size={20} /> : <GiftIcon />}
            size="large"
          >
            {markingComplimentary ? 'Processing...' : 'Confirm Complimentary'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RoomManagementPage;
