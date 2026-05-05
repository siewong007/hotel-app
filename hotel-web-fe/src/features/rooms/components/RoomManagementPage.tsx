import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  InputAdornment,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
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
  CalendarMonth as CalendarIcon,
  Update as ExtendIcon,
  SwapHoriz as SwapIcon,
  Phone as PhoneIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Notes as NotesIcon,
  Payment as PaymentIcon,
  MoneyOff as MoneyOffIcon,
  MoreHoriz as MoreHorizIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';

import { Room, Guest, BookingWithDetails, BookingCreateRequest, RoomHistory, Booking } from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';
import { useRoomData } from '../hooks/useRoomData';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { addLocalDays, formatLocalDate, parseLocalDate } from '../../../utils/date';
import { isValidEmail } from '../../../utils/validation';
import {
  getUnifiedStatusColor,
  getUnifiedStatusLabel,
  getUnifiedStatusShortLabel,
  RoomStatusType
} from '../config';
import CheckoutInvoiceModal from '../../invoices/components/CheckoutInvoiceModal';
import UnifiedBookingModal, { BookingType } from './UnifiedBookingModal';
import UpdateCheckoutDateDialog from './UpdateCheckoutDateDialog';

interface RoomAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  color?: string;
  onClick: (room: Room) => void;
  secondary?: string;
  badge?: string | number;
}

interface MenuSection {
  title: string;
  actions: RoomAction[];
}

interface MenuLayout {
  primary?: {
    label: string;
    icon: React.ReactNode;
    onClick: (room: Room) => void;
    color?: 'primary' | 'success' | 'error' | 'warning' | 'info';
    dark?: boolean;
  };
  sections: MenuSection[];
}

interface GuestWithCredits {
  id: number;
  full_name: string;
  email: string;
  total_complimentary_credits: number;
  credits_by_room_type: {
    room_type_id: number;
    room_type_name: string;
    room_type_code: string;
    nights_available: number;
  }[];
}

const RoomManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const {
    rooms, setRooms,
    guests, setGuests,
    loading,
    error: dataError,
    roomBookings,
    reservedBookings,
    compCancelledBookings,
    allBookingsData,
    reload: loadData,
    reloadRooms: loadRooms,
    reloadGuests: loadGuests,
    reloadBookings: loadBookings,
  } = useRoomData();
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);

  // Dialogs
  const [walkInDialogOpen, setWalkInDialogOpen] = useState(false);
  const [onlineCheckInDialogOpen, setOnlineCheckInDialogOpen] = useState(false);
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [roomDetailsDialogOpen, setRoomDetailsDialogOpen] = useState(false);
  const [changeRoomDialogOpen, setChangeRoomDialogOpen] = useState(false);
  const [updateCheckoutDialogOpen, setUpdateCheckoutDialogOpen] = useState(false);
  const [updateCheckoutBooking, setUpdateCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const [complimentaryDialogOpen, setComplimentaryDialogOpen] = useState(false);
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [markingComplimentary, setMarkingComplimentary] = useState(false);

  // Room notes state
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Booking notes editing state
  const [bookingNotesDialogOpen, setBookingNotesDialogOpen] = useState(false);
  const [bookingNotesEditBooking, setBookingNotesEditBooking] = useState<BookingWithDetails | null>(null);
  const [editedBookingNotes, setEditedBookingNotes] = useState('');
  const [savingBookingNotes, setSavingBookingNotes] = useState(false);

  // Room change state
  const [newSelectedRoom, setNewSelectedRoom] = useState<Room | null>(null);
  const [changingRoom, setChangingRoom] = useState(false);
  const [changeRoomCustomRate, setChangeRoomCustomRate] = useState<string>('');

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
  // Walk-in payment/deposit state
  const [walkInDeposit, setWalkInDeposit] = useState<number>(0);
  const [walkInPaymentMethod, setWalkInPaymentMethod] = useState<string>('Cash');
  const [walkInRoomCardDeposit, setWalkInRoomCardDeposit] = useState<number>(0);

  // Payment method options
  const paymentMethods = [
    { value: 'cash', label: 'Cash' },
    { value: 'card', label: 'Credit/Debit Card' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'e_wallet', label: 'E-Wallet' },
  ];

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
  const [isEditingGuest, setIsEditingGuest] = useState(false);
  const [guestEditForm, setGuestEditForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    ic_number: '',
    nationality: '',
    company_name: '',
    address_line1: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: '',
  });
  const [savingGuestEdit, setSavingGuestEdit] = useState(false);
  const [guestCredits, setGuestCredits] = useState<{
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
  } | null>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [availableRoomsForCredits, setAvailableRoomsForCredits] = useState<Room[]>([]);
  const [creditsBookingForm, setCreditsBookingForm] = useState({
    room_id: '',
    check_in_date: formatLocalDate(),
    check_out_date: formatLocalDate(addLocalDays(new Date(), 1)),
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

  // Unified booking modal state
  const [unifiedBookingOpen, setUnifiedBookingOpen] = useState(false);
  const [unifiedBookingType, setUnifiedBookingType] = useState<BookingType | undefined>(undefined);

  // Upcoming bookings dialog state
  const [upcomingBookingsDialogOpen, setUpcomingBookingsDialogOpen] = useState(false);
  const [upcomingBookingsForRoom, setUpcomingBookingsForRoom] = useState<BookingWithDetails[]>([]);
  const [loadingUpcomingBookings, setLoadingUpcomingBookings] = useState(false);

  // Reserved check-in dialog state (for streamlined check-in of reserved rooms)
  const [reservedCheckInDialogOpen, setReservedCheckInDialogOpen] = useState(false);
  const [reservedCheckInBooking, setReservedCheckInBooking] = useState<BookingWithDetails | null>(null);
  const [processingReservedCheckIn, setProcessingReservedCheckIn] = useState(false);
  const [collectingDeposit, setCollectingDeposit] = useState(false);
  const [depositPaymentMethod, setDepositPaymentMethod] = useState('');

  // Reserved check-in payment/deposit options
  const [rcPaymentChoice, setRcPaymentChoice] = useState<'pay_now' | 'pay_later'>('pay_later');
  const [rcPaymentMethod, setRcPaymentMethod] = useState('Cash');
  const [rcAmountPaid, setRcAmountPaid] = useState(0);
  const [rcDepositChoice, setRcDepositChoice] = useState<'receive' | 'waive'>('receive');
  const [rcDepositAmount, setRcDepositAmount] = useState(0);
  const [rcDepositMethod, setRcDepositMethod] = useState('Cash');
  const [rcWaiveReason, setRcWaiveReason] = useState('');

  // Payment collection dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState<BookingWithDetails | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [roomStatusFilter, setRoomStatusFilter] = useState<RoomStatusType | 'all'>('all');

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

  // Show data loading errors in snackbar
  useEffect(() => {
    if (dataError) showSnackbar(dataError, 'error');
  }, [dataError]);

  // Clear any blocked dates from selection when room blocked dates are loaded
  useEffect(() => {
    if (roomBlockedDates.length > 0 && selectedComplimentaryDates.length > 0) {
      const availableDates = selectedComplimentaryDates.filter(date => !isDateBlocked(date));
      if (availableDates.length !== selectedComplimentaryDates.length) {
        setSelectedComplimentaryDates(availableDates);
      }
    }
  }, [roomBlockedDates]);

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  // Memoized callbacks for UnifiedBookingModal to prevent re-renders during periodic refresh
  const handleUnifiedBookingClose = useCallback(() => {
    setUnifiedBookingOpen(false);
    setUnifiedBookingType(undefined);
  }, []);

  const handleUnifiedBookingSuccess = useCallback((message: string) => {
    showSnackbar(message, 'success');
  }, []);

  const handleUnifiedBookingError = useCallback((message: string) => {
    showSnackbar(message, 'error');
  }, []);

  const handleUnifiedBookingCreated = useCallback((booking: any, guest: any) => {
    // Convert to BookingWithDetails for the reserved check-in dialog
    const bwd: BookingWithDetails = {
      ...booking,
      guest_name: guest.full_name || `${guest.first_name || ''} ${guest.last_name || ''}`.trim(),
      guest_email: guest.email || '',
      guest_phone: guest.phone || '',
      room_number: booking.room_number || String(booking.room_id),
      room_type: booking.room_type || '',
      booking_number: booking.folio_number || booking.booking_number || '',
    };
    const settingsDeposit = getHotelSettings().deposit_amount;
    setReservedCheckInBooking(bwd);
    setRcPaymentChoice('pay_later');
    setRcPaymentMethod(booking.payment_method || 'Cash');
    setRcAmountPaid(Number(booking.total_amount || 0));
    setRcDepositChoice('receive');
    setRcDepositAmount(settingsDeposit);
    setRcDepositMethod('Cash');
    setRcWaiveReason('');
    setReservedCheckInDialogOpen(true);
  }, []);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, room: Room) => {
    event.preventDefault();
    setMenuPosition({ top: event.clientY, left: event.clientX });
    setSelectedRoom(room);
  };

  const handleMenuClose = () => {
    setMenuPosition(null);
  };

  const getRoomStatusColor = (room: Room): string => {
    // Use centralized status config for consistent colors based on computed status
    return getUnifiedStatusColor(room.status || 'available');
  };

  const getRoomStatusLabel = (room: Room): string => {
    // Use the status directly (should be computed status passed via displayRoom)
    const status = room.status || 'available';
    return getUnifiedStatusShortLabel(status).toUpperCase();
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

  // Room Actions - Unified Booking Modal
  const openUnifiedBooking = (room: Room, bookingType?: BookingType) => {
    setSelectedRoom(room);
    setUnifiedBookingType(bookingType);
    setUnifiedBookingOpen(true);
    handleMenuClose();
  };

  const handleWalkInGuest = (room: Room) => {
    openUnifiedBooking(room, 'walk_in');
  };

  const handleOnlineCheckIn = (room: Room) => {
    openUnifiedBooking(room, 'online');
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
    // Reset deposit/payment state
    setWalkInDeposit(0);
    setWalkInPaymentMethod('cash');
    setWalkInRoomCardDeposit(0);
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
  const handleComplimentaryCheckIn = (room: Room) => {
    openUnifiedBooking(room, 'complimentary');
  };

  const handleCloseComplimentaryCheckInDialog = () => {
    if (creatingBooking) return;

    setComplimentaryCheckInDialogOpen(false);
    setComplimentaryCheckInGuest(null);
    setComplimentaryCheckInDate('');
    setComplimentaryCheckOutDate('');
    setComplimentaryNumberOfNights(1);
  };

  const handleComplimentaryBookingSubmit = async () => {
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
      const start = parseLocalDate(complimentaryCheckInDate);
      const end = parseLocalDate(complimentaryCheckOutDate);
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        complimentaryDates.push(formatLocalDate(d));
      }

      // Use bookWithCredits API which properly deducts credits - creates a RESERVATION (not check-in)
      const bookingResult = await HotelAPIService.bookWithCredits({
        guest_id: complimentaryCheckInGuest.id,
        room_id: typeof selectedRoom.id === 'string' ? parseInt(selectedRoom.id) : selectedRoom.id,
        check_in_date: complimentaryCheckInDate,
        check_out_date: complimentaryCheckOutDate,
        complimentary_dates: complimentaryDates,
      });

      showSnackbar(`Complimentary reservation created for ${complimentaryCheckInGuest.full_name} in Room ${selectedRoom.room_number} (${bookingResult.complimentary_nights} nights used)`, 'success');
      setComplimentaryCheckInDialogOpen(false);
      setComplimentaryCheckInGuest(null);
      setComplimentaryCheckInDate('');
      setComplimentaryCheckOutDate('');
      setComplimentaryNumberOfNights(1);
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create reservation', 'error');
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
        if (!newGuestForm.first_name || !newGuestForm.last_name) {
          showSnackbar('Please fill in all required fields (First Name, Last Name)', 'error');
          setCreatingBooking(false);
          return;
        }

        // Validate email format only if provided
        if (newGuestForm.email && newGuestForm.email.trim() && !isValidEmail(newGuestForm.email)) {
          showSnackbar('Please enter a valid email address', 'error');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate guest name
        const fullName = `${newGuestForm.first_name.trim()} ${newGuestForm.last_name.trim()}`.toLowerCase();
        const existingGuestByName = guests.find(g => g.full_name.toLowerCase().trim() === fullName);
        if (existingGuestByName) {
          showSnackbar(`A guest with the name '${newGuestForm.first_name.trim()} ${newGuestForm.last_name.trim()}' already exists. Please select from existing guests.`, 'error');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate email only if provided
        if (newGuestForm.email && newGuestForm.email.trim()) {
          const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newGuestForm.email.toLowerCase());
          if (existingGuest) {
            showSnackbar(`A guest with email ${newGuestForm.email} already exists. Please select from existing guests.`, 'error');
            setCreatingBooking(false);
            return;
          }
        }

        // Create the new guest
        const newGuest = await HotelAPIService.createGuest({
          first_name: newGuestForm.first_name,
          last_name: newGuestForm.last_name,
          email: newGuestForm.email || undefined,
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
      const today = formatLocalDate();
      const tomorrow = formatLocalDate(addLocalDays(today, 1));

      // Double-check that we have valid data
      if (!selectedRoom || !selectedRoom.id) {
        showSnackbar('Invalid room selection. Please try again.', 'error');
        setCreatingBooking(false);
        return;
      }

      // Check if guest is member - waive room card deposit
      const isMemberGuest = guestToUse.guest_type === 'member';
      const effectiveRoomCardDeposit = isMemberGuest ? 0 : walkInRoomCardDeposit;

      const bookingData = {
        guest_id: guestToUse.id,
        room_id: String(selectedRoom.id), // Convert to string for validation
        check_in_date: walkInCheckInDate || today,
        check_out_date: walkInCheckOutDate || tomorrow,
        number_of_guests: 1,
        post_type: 'normal_stay' as const,
        booking_remarks: isMemberGuest ? 'Walk-In Guest (Member - Card Deposit Waived)' : 'Walk-In Guest',
        source: 'walk_in' as const,
        payment_status: 'unpaid' as const,
      };

      const createdBooking = await HotelAPIService.createBooking(bookingData);

      // Convert to BookingWithDetails for the reserved check-in dialog
      const bwd: BookingWithDetails = {
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
        payment_method: walkInPaymentMethod,
        post_type: createdBooking.post_type,
        created_at: createdBooking.created_at,
        updated_at: createdBooking.updated_at,
        guest_name: guestToUse.full_name || '',
        guest_email: guestToUse.email || '',
        guest_phone: guestToUse.phone || '',
        room_number: selectedRoom.room_number,
        booking_number: createdBooking.folio_number || `WALKIN-${createdBooking.id}`,
        price_per_night: selectedRoom.price_per_night || 0,
      };
      const settingsDepositWI = getHotelSettings().deposit_amount;
      setReservedCheckInBooking(bwd);
      setRcPaymentChoice('pay_later');
      setRcPaymentMethod(walkInPaymentMethod || 'Cash');
      setRcAmountPaid(Number(createdBooking.total_amount || 0));
      setRcDepositChoice('receive');
      setRcDepositAmount(settingsDepositWI);
      setRcDepositMethod('Cash');
      setRcWaiveReason('');
      setWalkInDialogOpen(false);
      setReservedCheckInDialogOpen(true);
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

    // Check if there's a reserved booking for this room
    const reservedBooking = reservedBookings.get(room.id);
    if (reservedBooking) {
      // For reserved rooms, open the streamlined check-in dialog
      setReservedCheckInBooking(reservedBooking);
      setDepositPaymentMethod('');
      setCollectingDeposit(false);
      const totalAmt = Number(reservedBooking.total_amount || 0);
      const settingsDeposit = getHotelSettings().deposit_amount;
      setRcPaymentChoice(reservedBooking.payment_status === 'paid' ? 'pay_now' : 'pay_later');
      setRcPaymentMethod(reservedBooking.payment_method || 'Cash');
      setRcAmountPaid(totalAmt);
      setRcDepositChoice('receive');
      setRcDepositAmount(settingsDeposit);
      setRcDepositMethod('Cash');
      setRcWaiveReason('');
      setReservedCheckInDialogOpen(true);
      return;
    }

    // For non-reserved rooms, use the online check-in dialog
    setOnlineCheckInDialogOpen(true);
  };

  // Handle reserved room check-in (streamlined - booking details already exist)
  const handleReservedCheckIn = async (collectDeposit: boolean = false) => {
    console.log('handleReservedCheckIn called, booking:', reservedCheckInBooking);

    if (!reservedCheckInBooking) {
      showSnackbar('No booking selected', 'error');
      return;
    }

    if (rcDepositChoice === 'receive' && Number(rcDepositAmount) <= 0) {
      showSnackbar('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.', 'error');
      return;
    }

    try {
      setProcessingReservedCheckIn(true);
      console.log('Processing check-in for booking ID:', reservedCheckInBooking.id);

      // Build payment/deposit update
      const updateData: any = {};
      if (rcPaymentChoice === 'pay_now') {
        updateData.payment_status = 'paid';
        updateData.amount_paid = rcAmountPaid;
        updateData.payment_method = rcPaymentMethod;
      } else {
        updateData.payment_status = 'unpaid';
      }
      if (rcDepositChoice === 'receive') {
        updateData.deposit_paid = true;
        updateData.deposit_amount = rcDepositAmount;
        updateData.payment_note = `Deposit received (${rcDepositMethod})`;
      } else {
        updateData.deposit_paid = false;
        updateData.deposit_amount = 0;
        updateData.payment_note = `Deposit waived: ${rcWaiveReason}`;
      }

      // Update booking with payment/deposit info
      await HotelAPIService.updateBooking(reservedCheckInBooking.id, updateData);

      // Perform check-in (with payment data if paying now)
      const checkinPayload = (rcPaymentChoice === 'pay_now' && rcAmountPaid > 0)
        ? {
            payment_record: {
              amount: rcAmountPaid,
              payment_method: rcPaymentMethod,
              payment_type: 'booking',
              notes: 'Payment collected at check-in',
            },
          }
        : undefined;
      const result = await HotelAPIService.checkInGuest(String(reservedCheckInBooking.id), checkinPayload);

      showSnackbar(`Guest ${reservedCheckInBooking.guest_name} checked in successfully to Room ${reservedCheckInBooking.room_number}`, 'success');

      // Close dialog and reset state
      setReservedCheckInDialogOpen(false);
      setReservedCheckInBooking(null);
      setCollectingDeposit(false);
      setDepositPaymentMethod('');

      // Reload data
      await loadData();
    } catch (error: any) {
      console.error('Check-in error:', error);
      showSnackbar(error.message || 'Failed to check in guest', 'error');
    } finally {
      setProcessingReservedCheckIn(false);
    }
  };

  // Handle deposit collection for reserved bookings
  const handleCollectPayment = async () => {
    if (!paymentBooking) {
      showSnackbar('No booking selected', 'error');
      return;
    }

    if (!paymentMethod) {
      showSnackbar('Please select a payment method', 'error');
      return;
    }

    try {
      setProcessingPayment(true);

      await HotelAPIService.updateBooking(paymentBooking.id, {
        payment_status: 'paid',
        payment_method: paymentMethod,
      });

      showSnackbar(`Deposit collected for booking ${paymentBooking.booking_number}. Room is now ready for check-in.`, 'success');

      // Close dialog and reset state
      setPaymentDialogOpen(false);
      setPaymentBooking(null);
      setPaymentMethod('');

      // Reload data
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to collect deposit', 'error');
    } finally {
      setProcessingPayment(false);
    }
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
        if (!newOnlineGuestForm.first_name || !newOnlineGuestForm.last_name) {
          showSnackbar('Please fill in all required fields (First Name, Last Name)', 'error');
          setCreatingBooking(false);
          return;
        }

        // Validate email format only if provided
        if (newOnlineGuestForm.email && newOnlineGuestForm.email.trim() && !isValidEmail(newOnlineGuestForm.email)) {
          showSnackbar('Please enter a valid email address', 'error');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate guest name
        const onlineFullName = `${newOnlineGuestForm.first_name.trim()} ${newOnlineGuestForm.last_name.trim()}`.toLowerCase();
        const existingGuestByName = guests.find(g => g.full_name.toLowerCase().trim() === onlineFullName);
        if (existingGuestByName) {
          showSnackbar(`A guest with the name '${newOnlineGuestForm.first_name.trim()} ${newOnlineGuestForm.last_name.trim()}' already exists. Please select from existing guests.`, 'error');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate email only if provided
        if (newOnlineGuestForm.email && newOnlineGuestForm.email.trim()) {
          const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newOnlineGuestForm.email.toLowerCase());
          if (existingGuest) {
            showSnackbar(`A guest with email ${newOnlineGuestForm.email} already exists. Please select from existing guests.`, 'error');
            setCreatingBooking(false);
            return;
          }
        }

        // Create the new guest
        const newGuest = await HotelAPIService.createGuest({
          first_name: newOnlineGuestForm.first_name,
          last_name: newOnlineGuestForm.last_name,
          email: newOnlineGuestForm.email || undefined,
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
      const today = formatLocalDate();
      const tomorrow = formatLocalDate(addLocalDays(today, 1));

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

      // Create reservation (NOT immediate check-in) for online booking
      const bookingData = {
        guest_id: guestToUse.id,
        room_id: String(selectedRoom.id),
        check_in_date: checkInDateToUse,
        check_out_date: checkOutDateToUse,
        number_of_guests: 1,
        post_type: 'normal_stay' as const,
        source: 'online' as const,
        booking_remarks: onlineReference
          ? `${onlineCheckInBookingChannel} - Ref: ${onlineReference}`
          : `${onlineCheckInBookingChannel} Booking`,
      };

      console.log('Creating reservation with data:', bookingData);

      await HotelAPIService.createBooking(bookingData);

      showSnackbar(`Reservation created for ${guestToUse.full_name} in Room ${selectedRoom.room_number}`, 'success');
      setOnlineCheckInDialogOpen(false);

      // Reset form state
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
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create guest', 'error');
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

  // Handle opening booking notes edit dialog
  const handleEditBookingNotes = (booking: BookingWithDetails, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setBookingNotesEditBooking(booking);
    setEditedBookingNotes(booking.remarks || booking.special_requests || '');
    setBookingNotesDialogOpen(true);
  };

  // Handle saving booking notes
  const handleSaveBookingNotes = async () => {
    if (!bookingNotesEditBooking) return;

    setSavingBookingNotes(true);
    try {
      await HotelAPIService.updateBooking(bookingNotesEditBooking.id, {
        remarks: editedBookingNotes,
      });
      showSnackbar('Notes updated successfully', 'success');
      setBookingNotesDialogOpen(false);
      setBookingNotesEditBooking(null);
      setEditedBookingNotes('');
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update notes', 'error');
    } finally {
      setSavingBookingNotes(false);
    }
  };

  const handleConfirmCheckout = async (lateCheckoutData?: { penalty: number; notes: string }, checkoutPaymentMethod?: string) => {
    if (!selectedBooking) return;

    try {
      // Build update payload
      const updatePayload: any = { status: 'checked_out' };

      // Save payment method from checkout invoice to booking
      if (checkoutPaymentMethod) {
        updatePayload.payment_method = checkoutPaymentMethod;
      }

      // Add late checkout data if provided
      if (lateCheckoutData) {
        updatePayload.late_checkout_penalty = lateCheckoutData.penalty;
        updatePayload.late_checkout_notes = lateCheckoutData.notes;
      }

      // Update booking status to checked_out with optional late checkout info
      await HotelAPIService.updateBooking(selectedBooking.id, updatePayload);

      // After checkout: always set to 'dirty' - room must be cleaned before next guest
      const checkoutNotes = lateCheckoutData
        ? `Room requires cleaning after late checkout. Late checkout penalty: ${lateCheckoutData.penalty}. Notes: ${lateCheckoutData.notes || 'None'}`
        : 'Room requires cleaning after checkout';

      await HotelAPIService.updateRoomStatus(selectedBooking.room_id, {
        status: 'dirty',
        notes: checkoutNotes,
      });

      // Company room charges are auto-posted to customer_ledgers by the
      // backend's update_booking_handler on the checked_out transition.

      const successMessage = lateCheckoutData
        ? `Room ${selectedRoom?.room_number} checked out (late checkout penalty: RM ${lateCheckoutData.penalty})`
        : `Room ${selectedRoom?.room_number} checked out successfully`;

      showSnackbar(successMessage, 'success');
      await loadData(); // Reload all data
      setCheckOutDialogOpen(false);
      setSelectedBooking(null);
    } catch (error: any) {
      throw new Error(error.message || 'Failed to process checkout');
    }
  };

  const handleMakeDirty = async (room: Room) => {
    try {
      // Update room status to dirty (needs cleaning)
      await HotelAPIService.updateRoomStatus(room.id, {
        status: 'dirty',
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
      // Set to 'reserved' if upcoming booking exists, else 'available'
      const upcomingBooking = Array.from(reservedBookings.values()).find(
        b => String(b.room_id) === String(room.id)
      );
      await HotelAPIService.updateRoomStatus(room.id, {
        status: upcomingBooking ? 'reserved' : 'available',
        notes: 'Room cleaned and ready for guests',
        ...(upcomingBooking ? { booking_id: upcomingBooking.id } : {}),
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

  // Show upcoming bookings dialog for a room - uses existing bookings state
  const handleViewUpcomingBookings = (room: Room) => {
    handleMenuClose();
    setSelectedRoom(room);
    setUpcomingBookingsDialogOpen(true);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filter bookings for this room from allBookingsData
    const roomUpcomingBookings = allBookingsData.filter(booking => {
      const isThisRoom = booking.room_id?.toString() === room.id.toString();
      const checkInDate = new Date(booking.check_in_date);
      checkInDate.setHours(0, 0, 0, 0);
      const isUpcoming = checkInDate >= today;
      const isActive = ['pending', 'confirmed', 'checked_in', 'auto_checked_in'].includes(booking.status);
      return isThisRoom && (isUpcoming || booking.status === 'checked_in') && isActive;
    });

    // Sort by check-in date
    roomUpcomingBookings.sort((a, b) =>
      new Date(a.check_in_date).getTime() - new Date(b.check_in_date).getTime()
    );

    setUpcomingBookingsForRoom(roomUpcomingBookings);
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

  const handleViewGuestDetails = (guestId: string | number) => {
    // Use guests from state instead of fetching again
    const guest = guests.find(g => g.id.toString() === guestId.toString());

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

  const handleStartEditGuest = () => {
    if (!selectedGuestDetails) return;
    const nameParts = selectedGuestDetails.full_name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    setGuestEditForm({
      first_name: firstName,
      last_name: lastName,
      email: selectedGuestDetails.email || '',
      phone: selectedGuestDetails.phone || '',
      ic_number: selectedGuestDetails.ic_number || '',
      nationality: selectedGuestDetails.nationality || '',
      company_name: selectedGuestDetails.company_name || '',
      address_line1: selectedGuestDetails.address_line1 || '',
      city: selectedGuestDetails.city || '',
      state_province: selectedGuestDetails.state_province || '',
      postal_code: selectedGuestDetails.postal_code || '',
      country: selectedGuestDetails.country || '',
    });
    setIsEditingGuest(true);
  };

  const handleCancelEditGuest = () => {
    setIsEditingGuest(false);
  };

  const handleSaveGuestEdit = async () => {
    if (!selectedGuestDetails) return;
    try {
      setSavingGuestEdit(true);
      await HotelAPIService.updateGuest(selectedGuestDetails.id, guestEditForm);
      // Update the guest in local state
      const updatedGuest = {
        ...selectedGuestDetails,
        full_name: `${guestEditForm.first_name} ${guestEditForm.last_name}`.trim(),
        email: guestEditForm.email,
        phone: guestEditForm.phone,
        ic_number: guestEditForm.ic_number,
        nationality: guestEditForm.nationality,
        company_name: guestEditForm.company_name || undefined,
        address_line1: guestEditForm.address_line1,
        city: guestEditForm.city,
        state_province: guestEditForm.state_province,
        postal_code: guestEditForm.postal_code,
        country: guestEditForm.country,
      };
      setSelectedGuestDetails(updatedGuest);
      setGuests(prev => prev.map(g => g.id === selectedGuestDetails.id ? updatedGuest : g));
      setIsEditingGuest(false);
      showSnackbar('Guest updated successfully', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update guest', 'error');
    } finally {
      setSavingGuestEdit(false);
    }
  };

  const loadAvailableRoomsForCredits = () => {
    // Use rooms from state instead of fetching again
    setAvailableRoomsForCredits(rooms);
  };

  const loadRoomBlockedDates = (roomId: string) => {
    // Use allBookingsData from state instead of fetching again
    const roomBookingsFiltered = allBookingsData.filter(b =>
      b.room_id?.toString() === roomId &&
      !['checked_out', 'voided'].includes(b.status)
    );

    const blocked = roomBookingsFiltered.map(b => ({
      start: b.check_in_date,
      end: b.check_out_date,
      status: b.status
    }));

    setRoomBlockedDates(blocked);
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
    return formatLocalDate();
  };

  const getNextAvailableDate = (fromDate: string): string => {
    let date = parseLocalDate(fromDate);
    date.setHours(0, 0, 0, 0);

    // Find the next available date
    while (isDateBlocked(formatLocalDate(date))) {
      date.setDate(date.getDate() + 1);
    }
    return formatLocalDate(date);
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
      if (isDateBlocked(formatLocalDate(d))) {
        return { valid: false, message: `Date ${d.toLocaleDateString()} is already reserved` };
      }
    }

    return { valid: true, message: '' };
  };

  const getCreditsBookingDates = (): string[] => {
    const dates: string[] = [];
    const start = parseLocalDate(creditsBookingForm.check_in_date);
    const end = parseLocalDate(creditsBookingForm.check_out_date);
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      dates.push(formatLocalDate(d));
    }
    return dates;
  };

  const getTotalCreditsForRoom = (roomId: string): number => {
    if (!guestCredits || !roomId) return 0;
    const room = availableRoomsForCredits.find(r => r.id.toString() === roomId);
    if (!room) return 0;

    // Find credits for this room type
    const roomTypeCredits = guestCredits.credits_by_room_type.find(c =>
      room.room_type?.toLowerCase().includes(c.room_type_name.toLowerCase())
    );

    return roomTypeCredits?.nights_available || 0;
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

  const handleEditNotes = (room: Room) => {
    console.log('Opening notes dialog for room:', { roomId: room.id, roomNumber: room.room_number, existingNotes: room.notes });
    setSelectedRoom(room);
    setEditingNotes(room.notes || '');
    setNotesDialogOpen(true);
    handleMenuClose();
  };

  const handleSaveNotes = async () => {
    if (!selectedRoom) return;
    setSavingNotes(true);
    try {
      console.log('Saving notes:', { roomId: selectedRoom.id, notes: editingNotes });
      const updatedRoom = await HotelAPIService.updateRoom(selectedRoom.id, { notes: editingNotes || '' } as Partial<Room>);
      console.log('Updated room response:', updatedRoom);
      showSnackbar('Room notes updated', 'success');
      setNotesDialogOpen(false);
      loadData();
    } catch (error: any) {
      console.error('Failed to save notes:', error);
      showSnackbar(error.message || 'Failed to update notes', 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleChangeRoom = (room: Room) => {
    setSelectedRoom(room);
    setNewSelectedRoom(null);
    setChangeRoomCustomRate('');
    // Get the active booking for this room
    const booking = roomBookings.get(room.id);
    setSelectedBooking(booking || null);
    setChangeRoomDialogOpen(true);
    handleMenuClose();
  };

  const handleUpdateCheckoutDate = (room: Room) => {
    const booking = roomBookings.get(room.id);
    if (booking) {
      setUpdateCheckoutBooking(booking);
      setUpdateCheckoutDialogOpen(true);
    }
    handleMenuClose();
  };

  const handleConfirmRoomChange = async () => {
    if (!selectedRoom || !newSelectedRoom || !selectedBooking) {
      showSnackbar('Please select a new room', 'error');
      return;
    }

    try {
      setChangingRoom(true);

      // Determine the effective rate
      const customRate = changeRoomCustomRate ? parseFloat(changeRoomCustomRate) : null;
      const effectiveRate = customRate && !isNaN(customRate) ? customRate
        : typeof newSelectedRoom.price_per_night === 'string'
          ? parseFloat(newSelectedRoom.price_per_night)
          : newSelectedRoom.price_per_night;
      const oldPrice = typeof selectedRoom.price_per_night === 'string'
        ? parseFloat(selectedRoom.price_per_night)
        : selectedRoom.price_per_night;
      const priceDifference = effectiveRate - oldPrice;

      // Update booking with new room and rate
      await HotelAPIService.updateBooking(selectedBooking.id, {
        room_id: String(newSelectedRoom.id),
        room_rate_override: effectiveRate,
      });

      // Update old room status to dirty (needs cleaning after guest moved)
      await HotelAPIService.updateRoomStatus(selectedRoom.id, {
        status: 'dirty',
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

  const getMenuLayout = (room: Room | null): MenuLayout => {
    if (!room) return { sections: [] };

    const { computedStatus, booking, reservedBooking, isOccupied, isReserved, isComplimentary } = getRoomStatusInfo(room);
    const isMaintenance = computedStatus === 'maintenance';
    const layout: MenuLayout = { sections: [] };

    // Primary action — anchors the menu with the most likely next step for this room state
    if (isOccupied) {
      layout.primary = { label: 'Check out', icon: <LogoutIcon />, onClick: handleCheckOut, color: 'error' };
    } else if (isReserved && reservedBooking) {
      layout.primary = { label: 'Check-in guest', icon: <LoginIcon />, onClick: handleCheckIn, color: 'primary', dark: true };
    } else if (!isMaintenance) {
      layout.primary = { label: 'New booking', icon: <PersonAddIcon />, onClick: openUnifiedBooking, dark: true };
    }

    // BOOKING section
    const bookingActions: RoomAction[] = [];
    if (!isMaintenance) {
      bookingActions.push({
        id: 'upcoming',
        label: 'Upcoming bookings',
        icon: <CalendarIcon />,
        onClick: handleViewUpcomingBookings,
      });
    }
    if (isOccupied && booking) {
      bookingActions.push({ id: 'change-room', label: 'Change room', icon: <SwapIcon />, onClick: handleChangeRoom });
      bookingActions.push({ id: 'update-checkout', label: 'Update checkout', icon: <ExtendIcon />, onClick: handleUpdateCheckoutDate });
    }
    if (isOccupied && booking?.guest_id) {
      bookingActions.push({ id: 'guest-details', label: 'Guest details', icon: <PersonIcon />, onClick: () => handleViewGuestDetails(booking.guest_id) });
    }
    if (isComplimentary) {
      bookingActions.push({
        id: 'complimentary-info',
        label: 'Free gift booking',
        icon: <GiftIcon />,
        color: '#7b1fa2',
        secondary: 'No cancellation',
        onClick: () => {
          showSnackbar('This is a complimentary (Free Gift) booking. Cancellation is not recommended as the guest has used their free credits.', 'success');
        },
      });
    }
    if (isReserved && reservedBooking && !reservedBooking.is_complimentary) {
      bookingActions.push({ id: 'mark-complimentary', label: 'Mark as complimentary', icon: <GiftIcon />, color: '#7b1fa2', onClick: handleMarkComplimentary });
    }
    if (bookingActions.length > 0) {
      layout.sections.push({ title: 'Booking', actions: bookingActions });
    }

    // HOUSEKEEPING section
    const hkActions: RoomAction[] = [];
    if (!isOccupied && computedStatus !== 'available') {
      hkActions.push({ id: 'clean', label: 'Mark as clean', icon: <CheckCircleIcon />, color: '#43A047', onClick: handleMakeClean });
    }
    hkActions.push({ id: 'dirty', label: 'Mark as dirty', icon: <CleaningIcon />, onClick: handleMakeDirty });
    if (!isMaintenance) {
      hkActions.push({ id: 'maintenance', label: 'Set maintenance', icon: <MaintenanceIcon />, onClick: handleMaintenance });
    } else {
      hkActions.push({ id: 'clear-maintenance', label: 'Clear maintenance', icon: <CheckCircleIcon />, color: '#43A047', onClick: handleMakeClean });
    }
    layout.sections.push({ title: 'Housekeeping', actions: hkActions });

    // ROOM section
    layout.sections.push({
      title: 'Room',
      actions: [
        { id: 'history', label: 'Room history', icon: <HistoryIcon />, onClick: handleShowHistory },
        { id: 'edit-notes', label: 'Edit notes', icon: <NotesIcon />, onClick: handleEditNotes },
        { id: 'properties', label: 'Properties...', icon: <SettingsIcon />, onClick: handleRoomProperties },
      ],
    });

    return layout;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  // Single source of truth for computing room status from bookings
  const getRoomStatusInfo = (room: Room) => {
    const booking = roomBookings.get(room.id);
    const reservedBooking = reservedBookings.get(room.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const hasCheckedInBooking = booking?.status === 'checked_in' || booking?.status === 'auto_checked_in';
    const hasReservationForToday = reservedBooking && (() => {
      const checkInDate = new Date(reservedBooking.check_in_date);
      checkInDate.setHours(0, 0, 0, 0);
      const isConfirmed = reservedBooking.status === 'confirmed' || reservedBooking.status === 'pending';
      return isConfirmed && checkInDate <= today;
    })();
    const hasFutureReservation = reservedBooking && !hasReservationForToday;
    const futureCheckInDate = hasFutureReservation ? new Date(reservedBooking.check_in_date) : null;

    const computedStatus = hasCheckedInBooking
      ? 'occupied'
      : ['maintenance', 'dirty'].includes(room.status || '')
        ? room.status!
        : hasReservationForToday
          ? 'reserved'
          : 'available';

    const isOccupied = computedStatus === 'occupied';
    const isReserved = computedStatus === 'reserved';
    const isReservedToday = isReserved && !!hasReservationForToday;
    const isComplimentary = (isOccupied && booking?.is_complimentary === true) ||
                             (isReserved && reservedBooking?.is_complimentary === true);

    return {
      computedStatus,
      booking,
      reservedBooking,
      hasCheckedInBooking,
      hasReservationForToday,
      hasFutureReservation,
      futureCheckInDate,
      isOccupied,
      isReserved,
      isReservedToday,
      isComplimentary,
    };
  };

  const availableCount = rooms.filter(r => getRoomStatusInfo(r).computedStatus === 'available').length;
  const occupiedCount = rooms.filter(r => getRoomStatusInfo(r).computedStatus === 'occupied').length;
  const reservedCount = rooms.filter(r => getRoomStatusInfo(r).computedStatus === 'reserved').length;
  const dirtyCount = rooms.filter(r => getRoomStatusInfo(r).computedStatus === 'dirty').length;
  const maintenanceCount = rooms.filter(r => getRoomStatusInfo(r).computedStatus === 'maintenance').length;
  const occupancyRate = rooms.length > 0 ? Math.round((occupiedCount / rooms.length) * 100) : 0;
  const filteredRooms = roomStatusFilter === 'all'
    ? rooms
    : rooms.filter(r => getRoomStatusInfo(r).computedStatus === roomStatusFilter);
  const filterOptions: Array<{ value: RoomStatusType | 'all'; label: string; count: number; color: string; textColor?: string }> = [
    { value: 'all', label: 'All', count: rooms.length, color: 'transparent' },
    { value: 'occupied', label: 'Occupied', count: occupiedCount, color: '#ec7c32' },
    { value: 'available', label: 'Vacant', count: availableCount, color: '#3f8f5b' },
    { value: 'reserved', label: 'Reserved', count: reservedCount, color: '#3f7fbd' },
    { value: 'dirty', label: 'Dirty', count: dirtyCount, color: '#b8942f' },
    { value: 'maintenance', label: 'Maintenance', count: maintenanceCount, color: '#8d9691' },
  ];

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          mb: 0,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {/* Title and Stats Row */}
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
          px: 2.5,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}>
          {/* Title Section with icon badge */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 1.5,
                bgcolor: alpha('#c69a5b', 0.18),
                color: '#a06a2c',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <HotelIcon sx={{ fontSize: 24 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', lineHeight: 1.15, letterSpacing: '-0.01em' }}>
                Hotel Manager — Rooms
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                {filteredRooms.length} rooms
                {(() => {
                  const floors = Array.from(
                    new Set(filteredRooms.map((r) => r.floor).filter((f): f is number => f != null))
                  ).sort((a, b) => a - b);
                  if (floors.length === 0) return '';
                  if (floors.length === 1) return ` · floor ${floors[0]}`;
                  return ` · floors ${floors[0]}–${floors[floors.length - 1]}`;
                })()}
                {' · '}
                {occupancyRate}% occupied
              </Typography>
            </Box>
          </Box>

          {/* Center: today's date */}
          <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
              {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
            </Typography>
          </Box>

          {/* Quick Stats - soft tinted tiles */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {[
              { count: availableCount, label: 'Available', color: '#43A047', show: true },
              { count: occupiedCount, label: 'Occupied', color: '#FB8C00', show: true },
              { count: reservedCount, label: 'Reserved', color: '#1E88E5', show: true },
              { count: dirtyCount, label: 'Dirty', color: '#C9A227', show: dirtyCount > 0 },
              { count: maintenanceCount, label: 'Maintenance', color: '#616161', show: maintenanceCount > 0 },
            ]
              .filter((s) => s.show)
              .map((s) => (
                <Box
                  key={s.label}
                  sx={{
                    px: 1.75,
                    py: 0.85,
                    minWidth: 64,
                    borderRadius: 1.5,
                    textAlign: 'center',
                    bgcolor: alpha(s.color, 0.12),
                    border: '1px solid',
                    borderColor: alpha(s.color, 0.4),
                    color: s.color,
                  }}
                >
                  <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1 }}>
                    {s.count}
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', letterSpacing: 0.3 }}>
                    {s.label}
                  </Typography>
                </Box>
              ))}
          </Box>
        </Box>

        {/* Status Filters */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', px: 2.5, py: 1.25 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.5 }}>
            Filter:
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={roomStatusFilter}
            onChange={(_, value) => {
              if (value) setRoomStatusFilter(value);
            }}
            sx={{ gap: 0.75, flexWrap: 'wrap' }}
          >
            {filterOptions.map((item) => {
              const selected = roomStatusFilter === item.value;
              return (
                <ToggleButton
                  key={item.value}
                  value={item.value}
                  sx={{
                    border: '1px solid !important',
                    borderColor: selected ? `${alpha(item.color === 'transparent' ? '#000' : item.color, 0.55)} !important` : 'divider',
                    borderRadius: '999px !important',
                    px: 1.5,
                    py: 0.4,
                    gap: 0.75,
                    color: 'text.primary',
                    bgcolor: selected
                      ? (item.color === 'transparent' ? 'action.selected' : alpha(item.color, 0.12))
                      : 'background.paper',
                    textTransform: 'none',
                    '&:hover': { bgcolor: item.color === 'transparent' ? 'action.hover' : alpha(item.color, 0.08) },
                  }}
                >
                  <Box
                    sx={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      bgcolor: item.color,
                      border: item.value === 'all' ? '1px solid' : 0,
                      borderColor: 'divider',
                    }}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{item.label}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                    {item.count}
                  </Typography>
                </ToggleButton>
              );
            })}
          </ToggleButtonGroup>
        </Box>
      </Paper>

      {/* Room Grid */}
      <Paper
        elevation={0}
        sx={{
          bgcolor: 'background.default',
          border: '1px solid',
          borderTop: 0,
          borderColor: 'divider',
          borderRadius: '0 0 12px 12px',
          p: { xs: 1.25, md: 2 },
        }}
      >
      <Box 
        sx={{ 
          display: 'grid', 
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(3, minmax(0, 1fr))',
            md: 'repeat(5, minmax(0, 1fr))',
            lg: 'repeat(7, minmax(0, 1fr))',
            xl: 'repeat(7, minmax(0, 1fr))',
          }, 
          gap: 1.5 
        }}
      >
        {filteredRooms.map((room) => {
          const { computedStatus, booking, reservedBooking, hasReservationForToday, hasFutureReservation, futureCheckInDate, isOccupied, isReserved, isReservedToday, isComplimentary } = getRoomStatusInfo(room);
          const compCancelledBooking = compCancelledBookings.get(room.id);

          // Create a room object with computed status for display
          const displayRoom = { ...room, status: computedStatus };

          // Get colors based on status
          const statusColor = getRoomStatusColor(displayRoom);
          return (
            <Box key={room.id} sx={{ minWidth: 0 }}>
              <Card
                elevation={0}
                sx={{
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  cursor: 'pointer',
                  position: 'relative',
                  height: 250,
                  maxWidth: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  transition: 'box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease',
                  '&:hover': {
                    boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
                    borderColor: alpha(statusColor, 0.55),
                    transform: 'translateY(-1px)',
                  },
                  overflow: 'hidden',
                }}
                onClick={(e) => {
                  e.preventDefault();
                  handleMenuOpen(e, room);
                }}
              >
                {/* Top status accent bar */}
                <Box sx={{ height: 3, bgcolor: statusColor, opacity: 0.85 }} />

                <CardContent
                  sx={{
                    p: 1.5,
                    pt: 1.25,
                    // Reserve bottom space (~36px) so the absolutely-positioned
                    // action row pinned at bottom: 12 doesn't overlap inline content.
                    pb: '44px',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    '&:last-child': { pb: '44px' },
                  }}
                >
                  {/* Header row: room number + type code on the left, status pill on the right */}
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: '1.75rem',
                          fontWeight: 900,
                          lineHeight: 1,
                          letterSpacing: '-0.02em',
                        }}
                      >
                        {room.room_number}
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 800,
                            color: 'text.secondary',
                            letterSpacing: 0.6,
                            fontSize: '0.7rem',
                            lineHeight: 1,
                          }}
                        >
                          {getRoomTypeCode(room.room_type)}
                        </Typography>
                        <Box
                          component="svg"
                          viewBox="0 0 36 6"
                          sx={{ width: 36, height: 6, display: 'block', overflow: 'visible' }}
                          aria-hidden
                        >
                          <path
                            d="M1 4 Q5 1 9 3 T17 3 T25 3 T35 3"
                            fill="none"
                            stroke={statusColor}
                            strokeWidth={1.6}
                            strokeLinecap="round"
                          />
                        </Box>
                      </Box>
                    </Box>

                    {(() => {
                      const dirtyPillBg = '#a89436';
                      const pillBg = computedStatus === 'dirty' ? dirtyPillBg : statusColor;
                      return (
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            px: 1.1,
                            py: 0.35,
                            borderRadius: 1,
                            bgcolor: pillBg,
                            color: '#fff',
                            fontSize: '0.62rem',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: 0.8,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            boxShadow: `0 1px 0 ${alpha(pillBg, 0.35)}`,
                          }}
                        >
                          {getRoomStatusLabel(displayRoom)}
                        </Box>
                      );
                    })()}
                  </Box>

                  {/* Empty-state placeholder for dirty / maintenance rooms with no booking */}
                  {!isOccupied && !isReservedToday && (computedStatus === 'dirty' || computedStatus === 'maintenance') && (
                    <Typography
                      sx={{
                        mt: 1.25,
                        fontStyle: 'italic',
                        color: 'text.secondary',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                      }}
                    >
                      {computedStatus === 'dirty' ? 'Awaiting cleaning' : 'Under maintenance'}
                    </Typography>
                  )}

                  {isComplimentary && (
                    <Box
                      sx={{
                        display: 'inline-flex',
                        alignSelf: 'flex-start',
                        alignItems: 'center',
                        gap: 0.4,
                        mt: 0.75,
                        px: 0.75,
                        py: 0.15,
                        borderRadius: 999,
                        bgcolor: alpha('#9c27b0', 0.12),
                        color: '#7b1fa2',
                      }}
                    >
                      <GiftIcon sx={{ fontSize: 12 }} />
                      <Typography variant="caption" sx={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.5 }}>
                        FREE GIFT
                      </Typography>
                    </Box>
                  )}

                  <Divider sx={{ my: 1, borderStyle: 'dashed' }} />

                  {/* Room Notes */}
                  {!isOccupied && !isReservedToday && (
                    <Typography
                      variant="caption"
                      display="block"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditNotes(room);
                      }}
                      sx={{
                        fontSize: '0.6rem',
                        fontStyle: 'italic',
                        opacity: (room.notes || room.status_notes) ? 0.8 : 0.4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        mb: 0.5,
                        cursor: 'pointer',
                        '&:hover': { opacity: 1 },
                      }}
                    >
                      {room.notes || room.status_notes || '+ Add notes'}
                    </Typography>
                  )}

                  {/* Guest Details for Occupied Rooms */}
                  {booking?.guest_name && isOccupied ? (
                    <Box sx={{ mt: 1 }}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 800,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '0.95rem',
                          lineHeight: 1.2,
                        }}
                      >
                        {booking.guest_name}
                      </Typography>
                      <Typography
                        sx={{
                          mt: 0.4,
                          color: 'text.secondary',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                        }}
                      >
                        {new Date(booking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(booking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.4 }}>
                        {booking.guest_phone && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <PhoneIcon sx={{ fontSize: 12, opacity: 0.8 }} />
                            <Typography
                              variant="caption"
                              sx={{
                                fontSize: '0.65rem',
                                opacity: 0.9,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {booking.guest_phone}
                            </Typography>
                          </Box>
                        )}
                      </Box>

                      {/* Booking Notes - Clickable to edit */}
                      <Tooltip title={booking.remarks || booking.special_requests ? "Click to edit notes" : "Click to add notes"} arrow>
                        <Box
                          onClick={(e) => handleEditBookingNotes(booking, e)}
                          sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 0.5,
                            mt: 0.5,
                            p: 0.5,
                            bgcolor: 'action.hover',
                            borderRadius: 0.5,
                            cursor: 'pointer',
                            '&:hover': {
                              bgcolor: 'action.selected',
                            },
                            minHeight: 24,
                          }}
                        >
                          <NotesIcon sx={{ fontSize: 12, opacity: 0.8, mt: 0.25 }} />
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: '0.6rem',
                              opacity: 0.9,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              flex: 1,
                              fontStyle: (booking.remarks || booking.special_requests) ? 'normal' : 'italic',
                            }}
                          >
                            {booking.remarks || booking.special_requests || 'Add notes...'}
                          </Typography>
                          <EditIcon sx={{ fontSize: 10, opacity: 0.6 }} />
                        </Box>
                      </Tooltip>

                      {/* Action row: Check out, Move, More — pinned to card bottom for cross-card alignment */}
                      <Box sx={{ position: 'absolute', bottom: 12, left: 12, right: 12, display: 'flex', gap: 0.4, alignItems: 'center', minWidth: 0 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCheckOut(room);
                          }}
                          sx={{
                            flex: 1,
                            color: 'text.primary',
                            bgcolor: 'background.paper',
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            textTransform: 'none',
                            whiteSpace: 'nowrap',
                            '&.MuiButton-root': {
                              minWidth: 0,
                              py: 0.35,
                              px: 0.5,
                              borderRadius: 999,
                              borderColor: 'divider',
                              borderWidth: 1,
                            },
                            '&:hover': { borderColor: 'text.primary', bgcolor: 'action.hover' },
                          }}
                        >
                          Check out
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleChangeRoom(room);
                          }}
                          sx={{
                            flex: 1,
                            color: 'text.primary',
                            bgcolor: 'background.paper',
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            textTransform: 'none',
                            whiteSpace: 'nowrap',
                            '&.MuiButton-root': {
                              minWidth: 0,
                              py: 0.35,
                              px: 0.5,
                              borderRadius: 999,
                              borderColor: 'divider',
                              borderWidth: 1,
                            },
                            '&:hover': { borderColor: 'text.primary', bgcolor: 'action.hover' },
                          }}
                        >
                          Move
                        </Button>
                        <Tooltip title="More actions" arrow>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMenuOpen(e, room);
                            }}
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 999,
                              width: 22,
                              height: 22,
                              flexShrink: 0,
                              color: 'text.secondary',
                              '&:hover': { borderColor: 'text.primary', color: 'text.primary' },
                            }}
                          >
                            <MoreHorizIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  ) : null}

                  {/* Reserved Room Guest Details - styled like Occupied room */}
                  {isReservedToday && reservedBooking && (
                    <>
                      <Box sx={{ mt: 1 }}>
                        {reservedBooking.guest_name && (
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 800,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '0.95rem',
                              lineHeight: 1.2,
                            }}
                          >
                            {reservedBooking.guest_name}
                          </Typography>
                        )}
                        <Typography
                          sx={{
                            mt: 0.4,
                            color: 'text.secondary',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                          }}
                        >
                          {new Date(reservedBooking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(reservedBooking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Typography>
                      </Box>

                      {/* Action row: Check in (primary), Edit, More — pinned to card bottom */}
                      <Box sx={{ position: 'absolute', bottom: 12, left: 12, right: 12, display: 'flex', gap: 0.4, alignItems: 'center', minWidth: 0 }}>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCheckIn(room);
                          }}
                          sx={{
                            flex: 1,
                            color: 'background.paper',
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            textTransform: 'none',
                            whiteSpace: 'nowrap',
                            boxShadow: 'none',
                            '&.MuiButton-root': {
                              minWidth: 0,
                              py: 0.35,
                              px: 0.5,
                              borderRadius: 999,
                              bgcolor: 'text.primary',
                              borderWidth: 0,
                            },
                            '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
                          }}
                        >
                          Check in
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditBookingNotes(reservedBooking);
                          }}
                          sx={{
                            flex: 1,
                            color: 'text.primary',
                            bgcolor: 'background.paper',
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            textTransform: 'none',
                            whiteSpace: 'nowrap',
                            '&.MuiButton-root': {
                              minWidth: 0,
                              py: 0.35,
                              px: 0.5,
                              borderRadius: 999,
                              borderColor: 'divider',
                              borderWidth: 1,
                            },
                            '&:hover': { borderColor: 'text.primary', bgcolor: 'action.hover' },
                          }}
                        >
                          Edit
                        </Button>
                        <Tooltip title="More actions" arrow>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMenuOpen(e, room);
                            }}
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 999,
                              width: 22,
                              height: 22,
                              flexShrink: 0,
                              color: 'text.secondary',
                              '&:hover': { borderColor: 'text.primary', color: 'text.primary' },
                            }}
                          >
                            <MoreHorizIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </>
                  )}

                  {/* Upcoming Same-Day Reservation for Dirty Rooms */}
                  {computedStatus === 'dirty' && reservedBooking && hasReservationForToday && (
                    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(0,0,0,0.15)' }}>
                      <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 0.5,
                        py: 0.25,
                        bgcolor: 'rgba(66, 165, 245, 0.2)',
                        borderRadius: 1,
                      }}>
                        <CalendarIcon sx={{ fontSize: 14, color: '#1565C0' }} />
                        <Typography variant="caption" sx={{ color: '#1565C0', fontWeight: 600, fontSize: '0.65rem' }}>
                          Reserved: {new Date(reservedBooking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Typography>
                      </Box>
                      {reservedBooking.guest_name && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                          <PersonIcon sx={{ fontSize: 12, color: '#1565C0' }} />
                          <Typography variant="caption" sx={{
                            color: '#1565C0',
                            fontWeight: 500,
                            fontSize: '0.6rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {reservedBooking.guest_name}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  )}

                  {/* Action row for Available Rooms: + New booking (primary) + More — pinned to card bottom */}
                  {computedStatus === 'available' && (
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 12,
                        left: 12,
                        right: 12,
                        display: 'flex',
                        gap: 0.4,
                        alignItems: 'center',
                        minWidth: 0,
                      }}
                    >
                      <Button
                        size="small"
                        variant="contained"
                        onClick={(e) => {
                          e.stopPropagation();
                          openUnifiedBooking(room);
                        }}
                        sx={{
                          flex: 1,
                          color: 'background.paper',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          textTransform: 'none',
                          whiteSpace: 'nowrap',
                          boxShadow: 'none',
                          '&.MuiButton-root': {
                            minWidth: 0,
                            py: 0.5,
                            px: 0.75,
                            borderRadius: 999,
                            bgcolor: 'text.primary',
                            borderWidth: 0,
                          },
                          '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
                        }}
                      >
                        + New booking
                      </Button>
                      <Tooltip title="More actions" arrow>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMenuOpen(e, room);
                          }}
                          sx={{
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 999,
                            width: 24,
                            height: 24,
                            flexShrink: 0,
                            color: 'text.secondary',
                            bgcolor: 'background.paper',
                            '&:hover': { borderColor: 'text.primary', color: 'text.primary' },
                          }}
                        >
                          <MoreHorizIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}

                </CardContent>
              </Card>
            </Box>
          );
        })}
      </Box>
      </Paper>

      {/* Context Menu */}
      <Menu
        open={Boolean(menuPosition)}
        onClose={handleMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={menuPosition ? { top: menuPosition.top, left: menuPosition.left } : undefined}
        slotProps={{
          paper: {
            sx: {
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
              border: '1px solid',
              borderColor: 'divider',
            },
          },
        }}
        MenuListProps={{ sx: { py: 0 } }}
      >
        {selectedRoom && (() => {
          const info = getRoomStatusInfo(selectedRoom);
          const layout = getMenuLayout(selectedRoom);
          const displayRoom = { ...selectedRoom, status: info.computedStatus };
          const statusColor = getRoomStatusColor(displayRoom);
          const activeBooking = info.booking || info.reservedBooking || null;
          const showAside = info.isOccupied || info.isReservedToday;

          const formatDate = (d: string) =>
            new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          const ratePerNight = (() => {
            const n = Number((activeBooking as any)?.price_per_night ?? (activeBooking as any)?.room_rate);
            return Number.isFinite(n) && n > 0 ? n : null;
          })();

          return (
            <Box sx={{ display: 'flex', minWidth: showAside ? 460 : 280, maxWidth: 520 }}>
              <Box sx={{ flex: 1, py: 1, minWidth: 260 }}>
                {/* Header */}
                <Box sx={{ px: 2, pt: 0.5, pb: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '1.05rem' }}>
                      Room {selectedRoom.room_number}
                    </Typography>
                    <Box
                      sx={{
                        px: 0.85,
                        py: 0.2,
                        borderRadius: 999,
                        bgcolor: alpha(statusColor, 0.14),
                        color: info.computedStatus === 'dirty' ? '#8a6d00' : statusColor,
                        border: '1px solid',
                        borderColor: alpha(statusColor, 0.35),
                        fontSize: '0.6rem',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        letterSpacing: 0.6,
                      }}
                    >
                      {getRoomStatusLabel(displayRoom)}
                    </Box>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                    {selectedRoom.room_type}
                    {info.isOccupied && info.booking?.guest_name && ` · ${info.booking.guest_name}`}
                  </Typography>
                </Box>

                {/* Primary action */}
                {layout.primary && (
                  <Box sx={{ px: 2, pb: 1.25 }}>
                    <Button
                      fullWidth
                      variant="contained"
                      color={layout.primary.dark ? 'inherit' : layout.primary.color || 'primary'}
                      startIcon={layout.primary.icon}
                      onClick={() => selectedRoom && layout.primary!.onClick(selectedRoom)}
                      sx={{
                        borderRadius: 1.5,
                        py: 1,
                        fontWeight: 700,
                        textTransform: 'none',
                        fontSize: '0.85rem',
                        boxShadow: 'none',
                        ...(layout.primary.dark && {
                          bgcolor: 'text.primary',
                          color: 'background.paper',
                          '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
                        }),
                      }}
                    >
                      {layout.primary.label}
                    </Button>
                  </Box>
                )}

                {/* Sectioned actions */}
                {layout.sections.map((section, sIdx) => (
                  <Box key={section.title}>
                    {sIdx > 0 && <Divider sx={{ my: 0.5 }} />}
                    <Typography
                      variant="overline"
                      sx={{
                        display: 'block',
                        px: 2,
                        pt: 0.75,
                        pb: 0.25,
                        color: 'text.secondary',
                        fontWeight: 700,
                        fontSize: '0.62rem',
                        letterSpacing: 1.2,
                        lineHeight: 1.4,
                      }}
                    >
                      {section.title}
                    </Typography>
                    {section.actions.map((action) => (
                      <MenuItem
                        key={action.id}
                        onClick={() => selectedRoom && action.onClick(selectedRoom)}
                        sx={{ py: 0.75, px: 2 }}
                      >
                        <ListItemIcon sx={{ color: action.color || 'text.secondary', minWidth: 32 }}>
                          {action.icon}
                        </ListItemIcon>
                        <ListItemText
                          primary={action.label}
                          secondary={action.secondary}
                          slotProps={{
                            primary: { sx: { color: action.color || 'inherit', fontSize: '0.875rem' } },
                            secondary: { sx: { fontSize: '0.7rem' } },
                          }}
                        />
                        {action.badge != null && (
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, ml: 1 }}>
                            {action.badge}
                          </Typography>
                        )}
                      </MenuItem>
                    ))}
                  </Box>
                ))}
              </Box>

              {/* At-a-glance side panel for occupied / arriving rooms */}
              {showAside && activeBooking && (
                <Box
                  sx={{
                    width: 180,
                    flexShrink: 0,
                    bgcolor: 'action.hover',
                    borderLeft: '1px solid',
                    borderColor: 'divider',
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.5,
                  }}
                >
                  {ratePerNight != null && (
                    <Box>
                      <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.6rem', letterSpacing: 1.2, lineHeight: 1.4 }}>
                        Rate
                      </Typography>
                      <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.2 }}>
                        {formatCurrency(ratePerNight)}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                        per night
                      </Typography>
                    </Box>
                  )}

                  <Box>
                    <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.6rem', letterSpacing: 1.2, lineHeight: 1.4 }}>
                      {info.isOccupied ? 'Current Booking' : 'Next Booking'}
                    </Typography>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', lineHeight: 1.3 }}>
                      {formatDate(activeBooking.check_in_date)} – {formatDate(activeBooking.check_out_date)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[activeBooking.source, activeBooking.guest_name].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.6rem', letterSpacing: 1.2, lineHeight: 1.4 }}>
                      Housekeeping
                    </Typography>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: statusColor, lineHeight: 1.3 }}>
                      {getRoomStatusLabel(displayRoom)}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>
          );
        })()}
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
              Walk-in Check-in - Room {selectedRoom?.room_number || 'N/A'}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          <Grid container spacing={3}>
            {/* Toggle between existing guest and new guest */}
            <Grid size={12}>
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
              <Grid size={12}>
                <Autocomplete
                  value={walkInGuest}
                  onChange={(_, newValue) => {
                    setWalkInGuest(newValue);
                    // Reset room card deposit to 0 for members (waived)
                    if (newValue?.guest_type === 'member') {
                      setWalkInRoomCardDeposit(0);
                    }
                  }}
                  options={guests}
                  getOptionLabel={(option) =>
                    option.email ? `${option.full_name} - ${option.email}` : option.full_name
                  }
                  renderOption={(props, option) => {
                    const { key, ...otherProps } = props;
                    return (
                      <Box component="li" key={key} {...otherProps} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2">{option.full_name}</Typography>
                          {option.email && <Typography variant="caption" color="text.secondary">{option.email}</Typography>}
                        </Box>
                        {option.guest_type === 'member' && (
                          <Chip
                            label="Member"
                            size="small"
                            color="success"
                            sx={{ fontSize: '0.65rem', height: 20 }}
                          />
                        )}
                      </Box>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Select Guest *"
                      placeholder="Search by name or email"
                    />
                  )}
                />
                {/* Member indicator */}
                {walkInGuest?.guest_type === 'member' && (
                  <Alert severity="success" sx={{ mt: 1 }} icon={<GiftIcon />}>
                    <Typography variant="body2">
                      <strong>{walkInGuest.full_name}</strong> is a Member — Room card deposit is <strong>waived</strong>
                    </Typography>
                  </Alert>
                )}
              </Grid>
            )}

            {/* New Guest Registration Form */}
            {isCreatingNewGuest && (
              <>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    required
                    label="First Name"
                    value={newGuestForm.first_name}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, first_name: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    required
                    label="Last Name"
                    value={newGuestForm.last_name}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, last_name: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Email"
                    type="email"
                    value={newGuestForm.email}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, email: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Phone"
                    value={newGuestForm.phone}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, phone: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="IC/Passport Number"
                    value={newGuestForm.ic_number}
                    onChange={(e) => setNewGuestForm({ ...newGuestForm, ic_number: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Booking Summary
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Number of Nights:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {walkInNumberOfNights}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Rate:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {currencySymbol}{selectedRoom?.price_per_night || 0} / night
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Charges:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
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
              (isCreatingNewGuest && (!newGuestForm.first_name || !newGuestForm.last_name))
            }
            startIcon={creatingBooking ? <CircularProgress size={20} /> : null}
            size="large"
          >
            {creatingBooking ? 'Processing...' : 'Check In & Collect Deposit'}
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
              Online Booking - Room {selectedRoom?.room_number || 'N/A'}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          <Grid container spacing={3}>
            {/* Toggle between existing guest and new guest */}
            <Grid size={12}>
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
              <Grid size={12}>
                <Autocomplete
                  value={onlineCheckInGuest}
                  onChange={(_, newValue) => setOnlineCheckInGuest(newValue)}
                  options={guests}
                  getOptionLabel={(option) =>
                    option.email ? `${option.full_name} - ${option.email}` : option.full_name
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
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    required
                    label="First Name"
                    value={newOnlineGuestForm.first_name}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, first_name: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    required
                    label="Last Name"
                    value={newOnlineGuestForm.last_name}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, last_name: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Email"
                    type="email"
                    value={newOnlineGuestForm.email}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, email: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Phone"
                    value={newOnlineGuestForm.phone}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, phone: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="IC/Passport Number"
                    value={newOnlineGuestForm.ic_number}
                    onChange={(e) => setNewOnlineGuestForm({ ...newOnlineGuestForm, ic_number: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth required>
                <InputLabel>Booking Channel</InputLabel>
                <Select
                  value={onlineCheckInBookingChannel}
                  onChange={(e) => setOnlineCheckInBookingChannel(e.target.value)}
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

            {/* Booking Reference */}
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Booking Reference"
                value={onlineReference}
                onChange={(e) => setOnlineReference(e.target.value)}
                placeholder="e.g., OL-123456"
              />
            </Grid>

            {/* Check-in Date */}
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Booking Summary
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Number of Nights:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {onlineNumberOfNights}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Rate:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {currencySymbol}{selectedRoom?.price_per_night || 0} / night
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Total Amount:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
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
              (isCreatingNewOnlineGuest && (!newOnlineGuestForm.first_name || !newOnlineGuestForm.last_name))
            }
            startIcon={creatingBooking ? <CircularProgress size={20} /> : null}
            size="large"
          >
            {creatingBooking ? 'Processing...' : 'Create Reservation'}
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
              Complimentary Booking - Room {selectedRoom?.room_number || 'N/A'}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          <Grid container spacing={3}>
            {/* Info Banner */}
            <Grid size={12}>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  This booking uses the guest's <strong>Free Room Credits</strong>. Only guests with available credits are shown below.
                </Typography>
              </Alert>
            </Grid>

            {/* Guest Selection (Only guests with credits) */}
            <Grid size={12}>
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
                    return option.email
                      ? `${option.full_name} - ${option.email} (${option.total_complimentary_credits} credits)`
                      : `${option.full_name} (${option.total_complimentary_credits} credits)`;
                  }}
                  renderOption={(props, option) => {
                    const { key, ...otherProps } = props;
                    return (
                      <Box component="li" key={key} {...otherProps}>
                        <Box sx={{ width: '100%' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box>
                              <Typography variant="body1">{option.full_name}</Typography>
                              {option.email && <Typography variant="caption" color="text.secondary">{option.email}</Typography>}
                            </Box>
                            <Chip
                              icon={<GiftIcon sx={{ fontSize: 14 }} />}
                              label={`${option.total_complimentary_credits} night${option.total_complimentary_credits !== 1 ? 's' : ''}`}
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={12}>
              <Paper sx={{ p: 2, bgcolor: 'secondary.light' }}>
                <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <GiftIcon /> Booking Summary
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">Number of Nights:</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">{complimentaryNumberOfNights}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">Room Rate:</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'text.disabled' }}>
                      {currencySymbol}{selectedRoom?.price_per_night || 0} / night
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">Total Amount:</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" fontWeight="bold" color="success.main">
                      FREE (Complimentary)
                    </Typography>
                  </Grid>
                  {complimentaryCheckInGuest && (
                    <>
                      <Grid size={6}>
                        <Typography variant="body2" color="text.secondary">Credits Available:</Typography>
                      </Grid>
                      <Grid size={6}>
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
            onClick={handleComplimentaryBookingSubmit}
            disabled={creatingBooking || !complimentaryCheckInGuest}
            startIcon={creatingBooking ? <CircularProgress size={20} /> : <GiftIcon />}
            size="large"
          >
            {creatingBooking ? 'Processing...' : 'Create Reservation'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Update Checkout Date Dialog */}
      <UpdateCheckoutDateDialog
        open={updateCheckoutDialogOpen}
        onClose={() => setUpdateCheckoutDialogOpen(false)}
        booking={updateCheckoutBooking}
        onSuccess={() => {
          showSnackbar('Checkout date updated successfully', 'success');
          loadData();
        }}
      />

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
            <Grid size={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Current Room
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Number:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" fontWeight="bold">
                      {selectedRoom?.room_number}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room Type:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {selectedRoom?.room_type}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Current Rate:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {currencySymbol}{selectedRoom?.price_per_night} / night
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {/* New Room Selection */}
            <Grid size={12}>
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
                    .sort((a, b) => {
                      const numA = parseInt(a.room_number, 10);
                      const numB = parseInt(b.room_number, 10);
                      if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                      }
                      return a.room_number.localeCompare(b.room_number);
                    })
                    .map((room) => (
                      <MenuItem key={room.id} value={room.id}>
                        Room {room.room_number} - {room.room_type} ({currencySymbol}{room.price_per_night}/night)
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Custom Rate */}
            <Grid size={12}>
              <TextField
                fullWidth
                label="Custom Rate (per night)"
                type="number"
                value={changeRoomCustomRate}
                onChange={(e) => setChangeRoomCustomRate(e.target.value)}
                placeholder={newSelectedRoom ? String(newSelectedRoom.price_per_night) : ''}
                helperText={newSelectedRoom ? `Default room rate: ${currencySymbol}${newSelectedRoom.price_per_night}/night. Leave empty to use default.` : 'Select a room first, or enter a custom rate.'}
                InputProps={{
                  startAdornment: <Typography sx={{ mr: 0.5, color: 'text.secondary' }}>{currencySymbol}</Typography>,
                }}
                inputProps={{ min: 0, step: '0.01' }}
              />
            </Grid>

            {/* Price Difference */}
            {newSelectedRoom && selectedRoom && (
              <>
                <Grid size={12}>
                  <Paper sx={{ p: 2, bgcolor: 'info.lighter' }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Price Summary
                    </Typography>
                    <Grid container spacing={1}>
                      <Grid size={6}>
                        <Typography variant="body2" color="text.secondary">
                          New Rate:
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="body2" fontWeight="bold">
                          {currencySymbol}{changeRoomCustomRate && !isNaN(parseFloat(changeRoomCustomRate)) ? parseFloat(changeRoomCustomRate).toFixed(2) : newSelectedRoom.price_per_night} / night
                          {changeRoomCustomRate && !isNaN(parseFloat(changeRoomCustomRate)) && (
                            <Typography component="span" variant="caption" color="text.secondary"> (custom)</Typography>
                          )}
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="body2" color="text.secondary">
                          Difference per Night:
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography
                          variant="body2"
                          fontWeight="bold"
                          color={(() => {
                            const oldPrice = typeof selectedRoom.price_per_night === 'string'
                              ? parseFloat(selectedRoom.price_per_night)
                              : selectedRoom.price_per_night;
                            const effectiveRate = changeRoomCustomRate && !isNaN(parseFloat(changeRoomCustomRate))
                              ? parseFloat(changeRoomCustomRate)
                              : typeof newSelectedRoom.price_per_night === 'string'
                                ? parseFloat(newSelectedRoom.price_per_night)
                                : newSelectedRoom.price_per_night;
                            const diff = effectiveRate - oldPrice;
                            return diff > 0 ? 'error.main' : diff < 0 ? 'success.main' : 'text.primary';
                          })()}
                        >
                          {(() => {
                            const oldPrice = typeof selectedRoom.price_per_night === 'string'
                              ? parseFloat(selectedRoom.price_per_night)
                              : selectedRoom.price_per_night;
                            const effectiveRate = changeRoomCustomRate && !isNaN(parseFloat(changeRoomCustomRate))
                              ? parseFloat(changeRoomCustomRate)
                              : typeof newSelectedRoom.price_per_night === 'string'
                                ? parseFloat(newSelectedRoom.price_per_night)
                                : newSelectedRoom.price_per_night;
                            const diff = effectiveRate - oldPrice;
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
              </>
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

      {/* Unified Booking Modal */}
      <UnifiedBookingModal
        open={unifiedBookingOpen}
        onClose={handleUnifiedBookingClose}
        room={selectedRoom}
        guests={guests}
        initialBookingType={unifiedBookingType}
        onSuccess={handleUnifiedBookingSuccess}
        onError={handleUnifiedBookingError}
        onBookingCreated={handleUnifiedBookingCreated}
        onRefreshData={loadData}
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
                    <Grid size={6}>
                      <Typography variant="caption" color="text.secondary">Status</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {selectedRoom.status?.toUpperCase() || 'UNKNOWN'}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="caption" color="text.secondary">Available</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {selectedRoom.available ? 'Yes' : 'No'}
                      </Typography>
                    </Grid>
                    {selectedRoom.status_notes && (
                      <Grid size={12}>
                        <Typography variant="caption" color="text.secondary">Notes</Typography>
                        <Typography variant="body2">{selectedRoom.status_notes}</Typography>
                      </Grid>
                    )}
                    {roomBookings.get(selectedRoom.id) && (
                      <>
                        <Grid size={12}>
                          <Divider sx={{ my: 1 }} />
                        </Grid>
                        <Grid size={6}>
                          <Typography variant="caption" color="text.secondary">Guest</Typography>
                          <Typography variant="body2" fontWeight={600}>
                            {roomBookings.get(selectedRoom.id)?.guest_name}
                          </Typography>
                        </Grid>
                        <Grid size={6}>
                          <Typography variant="caption" color="text.secondary">Booking Period</Typography>
                          <Typography variant="body2">
                            {new Date(roomBookings.get(selectedRoom.id)!.check_in_date).toLocaleDateString()} - {new Date(roomBookings.get(selectedRoom.id)!.check_out_date).toLocaleDateString()}
                          </Typography>
                        </Grid>
                        <Grid size={12}>
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
                        <Grid>
                          <Box
                            sx={{
                              width: 40,
                              height: 40,
                              borderRadius: '50%',
                              bgcolor: statusColor,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white',
                            }}
                          >
                            {statusIcon}
                          </Box>
                        </Grid>
                        <Grid size="grow">
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
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Room Number</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedRoom.room_number}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Room Type</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedRoom.room_type}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Price per Night</Typography>
                  <Typography variant="body1" fontWeight={600}>{formatCurrency(Number(selectedRoom.price_per_night))}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Max Occupancy</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedRoom.max_occupancy} guests</Typography>
                </Grid>
                <Grid size={12}>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Typography variant="body1" fontWeight={600}>{selectedRoom.status}</Typography>
                </Grid>
                {selectedRoom.description && (
                  <Grid size={12}>
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

      {/* Edit Room Notes Dialog */}
      <Dialog open={notesDialogOpen} onClose={() => setNotesDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <EditIcon sx={{ fontSize: 24 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Room Notes - {selectedRoom?.room_number}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            maxRows={6}
            label="Notes"
            value={editingNotes}
            onChange={(e) => setEditingNotes(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="Enter room notes..."
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => setNotesDialogOpen(false)} variant="outlined">Cancel</Button>
          <Button onClick={handleSaveNotes} variant="contained" disabled={savingNotes}>
            {savingNotes ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Booking Notes Edit Dialog */}
      <Dialog
        open={bookingNotesDialogOpen}
        onClose={() => {
          setBookingNotesDialogOpen(false);
          setBookingNotesEditBooking(null);
          setEditedBookingNotes('');
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <NotesIcon sx={{ fontSize: 24 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Edit Booking Notes
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {bookingNotesEditBooking && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>Guest:</strong> {bookingNotesEditBooking.guest_name}<br />
                  <strong>Room:</strong> {bookingNotesEditBooking.room_number}<br />
                  <strong>Stay:</strong> {new Date(bookingNotesEditBooking.check_in_date).toLocaleDateString()} - {new Date(bookingNotesEditBooking.check_out_date).toLocaleDateString()}
                </Typography>
              </Alert>
              <TextField
                fullWidth
                multiline
                rows={4}
                label="Notes"
                placeholder="Enter booking notes, special requests, or remarks..."
                value={editedBookingNotes}
                onChange={(e) => setEditedBookingNotes(e.target.value)}
                variant="outlined"
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button
            onClick={() => {
              setBookingNotesDialogOpen(false);
              setBookingNotesEditBooking(null);
              setEditedBookingNotes('');
            }}
            variant="outlined"
            disabled={savingBookingNotes}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveBookingNotes}
            variant="contained"
            disabled={savingBookingNotes}
            startIcon={savingBookingNotes ? <CircularProgress size={16} /> : <SaveIcon />}
          >
            {savingBookingNotes ? 'Saving...' : 'Save Notes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upcoming Bookings Dialog */}
      <Dialog
        open={upcomingBookingsDialogOpen}
        onClose={() => setUpcomingBookingsDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'info.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CalendarIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Upcoming Bookings - Room {selectedRoom?.room_number}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {loadingUpcomingBookings ? (
            <Box display="flex" justifyContent="center" alignItems="center" py={4}>
              <CircularProgress />
            </Box>
          ) : upcomingBookingsForRoom.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              No upcoming bookings for this room.
            </Alert>
          ) : (
            <Box sx={{ mt: 1 }}>
              {upcomingBookingsForRoom.map((booking, index) => (
                <Paper
                  key={booking.id}
                  elevation={1}
                  sx={{
                    p: 2,
                    mb: 2,
                    borderLeft: 4,
                    borderColor: booking.status === 'checked_in' ? 'warning.main' : 'info.main',
                  }}
                >
                  <Grid container spacing={2} alignItems="center">
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {booking.guest_name || 'Unknown Guest'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {booking.guest_email || ''} {booking.guest_phone ? `• ${booking.guest_phone}` : ''}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 3 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Check-in
                      </Typography>
                      <Typography variant="body2" fontWeight={500}>
                        {new Date(booking.check_in_date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 3 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Check-out
                      </Typography>
                      <Typography variant="body2" fontWeight={500}>
                        {new Date(booking.check_out_date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Typography>
                    </Grid>
                    <Grid size={12}>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                        {(() => {
                          const checkInDate = new Date(booking.check_in_date);
                          checkInDate.setHours(0, 0, 0, 0);
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const isToday = checkInDate.getTime() === today.getTime();
                          const canCheckIn = isToday && (booking.status === 'confirmed' || booking.status === 'pending');

                          if (booking.status === 'checked_in' || booking.status === 'auto_checked_in') {
                            return (
                              <Chip
                                label="Currently Occupied"
                                size="small"
                                color="warning"
                              />
                            );
                          } else if (canCheckIn) {
                            return (
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                startIcon={<LoginIcon />}
                                onClick={() => {
                                  setUpcomingBookingsDialogOpen(false);
                                  // Directly open the check-in dialog with this booking
                                  setReservedCheckInBooking(booking);
                                  setDepositPaymentMethod('');
                                  setCollectingDeposit(false);
                                  const amt = Number(booking.total_amount || 0);
                                  const sDeposit = getHotelSettings().deposit_amount;
                                  setRcPaymentChoice(booking.payment_status === 'paid' ? 'pay_now' : 'pay_later');
                                  setRcPaymentMethod(booking.payment_method || 'Cash');
                                  setRcAmountPaid(amt);
                                  setRcDepositChoice('receive');
                                  setRcDepositAmount(sDeposit);
                                  setRcDepositMethod('Cash');
                                  setRcWaiveReason('');
                                  setReservedCheckInDialogOpen(true);
                                }}
                                sx={{ fontWeight: 600 }}
                              >
                                Check-In Now
                              </Button>
                            );
                          } else {
                            return (
                              <Chip
                                label={booking.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                                size="small"
                                color={booking.status === 'confirmed' ? 'info' : 'default'}
                              />
                            );
                          }
                        })()}
                        {booking.is_complimentary && (
                          <Chip
                            icon={<GiftIcon />}
                            label="Free Gift"
                            size="small"
                            color="secondary"
                          />
                        )}
                        <Chip
                          label={formatCurrency(Number(booking.total_amount || 0))}
                          size="small"
                          variant="outlined"
                        />
                      </Stack>
                    </Grid>
                    {booking.special_requests && (
                      <Grid size={12}>
                        <Typography variant="caption" color="text.secondary">
                          <strong>Notes:</strong> {booking.special_requests}
                        </Typography>
                      </Grid>
                    )}
                  </Grid>
                </Paper>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button
            onClick={() => navigate(`/bookings?room=${selectedRoom?.room_number}`)}
            variant="outlined"
            color="primary"
          >
            View All in Bookings Page
          </Button>
          <Button onClick={() => setUpcomingBookingsDialogOpen(false)} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reserved Check-In Dialog - Streamlined check-in for reserved rooms */}
      <Dialog
        open={reservedCheckInDialogOpen}
        onClose={() => {
          if (!processingReservedCheckIn) {
            setReservedCheckInDialogOpen(false);
            setReservedCheckInBooking(null);
            setCollectingDeposit(false);
            setDepositPaymentMethod('');
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'success.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <LoginIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Check-In - Room {reservedCheckInBooking?.room_number}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {reservedCheckInBooking && (
            <Box>
              {/* Booking Summary */}
              <Paper elevation={0} sx={{ p: 2, mb: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Booking #{reservedCheckInBooking.booking_number}
                </Typography>

                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid size={12}>
                    <Typography variant="h6" fontWeight={600}>
                      {reservedCheckInBooking.guest_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {reservedCheckInBooking.guest_email}
                      {reservedCheckInBooking.guest_phone && ` • ${reservedCheckInBooking.guest_phone}`}
                    </Typography>
                  </Grid>

                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Check-in</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {new Date(reservedCheckInBooking.check_in_date).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric'
                      })}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Check-out</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {new Date(reservedCheckInBooking.check_out_date).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric'
                      })}
                    </Typography>
                  </Grid>

                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Room Type</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {reservedCheckInBooking.room_type}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {formatCurrency(Number(reservedCheckInBooking.total_amount || 0))}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>

              {/* Payment Section */}
              <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Payment</Typography>
              <ToggleButtonGroup
                value={rcPaymentChoice}
                exclusive
                onChange={(_, val) => { if (val) setRcPaymentChoice(val); }}
                fullWidth
                size="small"
                sx={{ mb: 1.5 }}
              >
                <ToggleButton value="pay_now" color="success" sx={{ py: 1, fontWeight: 600 }}>
                  <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} />
                  Make Payment Now
                </ToggleButton>
                <ToggleButton value="pay_later" color="warning" sx={{ py: 1, fontWeight: 600 }}>
                  <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} />
                  Pay Later
                </ToggleButton>
              </ToggleButtonGroup>

              {rcPaymentChoice === 'pay_now' && (
                <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                  <Grid size={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Payment Method</InputLabel>
                      <Select
                        value={rcPaymentMethod}
                        onChange={(e) => setRcPaymentMethod(e.target.value)}
                        label="Payment Method"
                      >
                        {PAYMENT_METHODS.map(method => (
                          <MenuItem key={method} value={method}>{method}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={6}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Amount Paid"
                      type="number"
                      value={rcAmountPaid}
                      onChange={(e) => setRcAmountPaid(parseFloat(e.target.value) || 0)}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                        inputProps: { min: 0, step: 0.01 },
                      }}
                    />
                  </Grid>
                </Grid>
              )}

              {rcPaymentChoice === 'pay_later' && (
                <Alert severity="info" sx={{ mb: 1.5, py: 0 }}>
                  Payment will be collected later. Guest checks in with unpaid status.
                </Alert>
              )}

              {/* Deposit Section */}
              <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Deposit</Typography>
              <ToggleButtonGroup
                value={rcDepositChoice}
                exclusive
                onChange={(_, val) => { if (val) setRcDepositChoice(val); }}
                fullWidth
                size="small"
                sx={{ mb: 1.5 }}
              >
                <ToggleButton value="receive" color="success" sx={{ py: 1, fontWeight: 600 }}>
                  <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} />
                  Receive Deposit
                </ToggleButton>
                <ToggleButton value="waive" color="error" sx={{ py: 1, fontWeight: 600 }}>
                  <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} />
                  Waive Deposit
                </ToggleButton>
              </ToggleButtonGroup>

              {rcDepositChoice === 'receive' && (
                <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                  <Grid size={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Deposit Method</InputLabel>
                      <Select
                        value={rcDepositMethod}
                        onChange={(e) => setRcDepositMethod(e.target.value)}
                        label="Deposit Method"
                      >
                        {PAYMENT_METHODS.map(method => (
                          <MenuItem key={method} value={method}>{method}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={6}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Deposit Amount"
                      type="number"
                      value={rcDepositAmount}
                      onChange={(e) => setRcDepositAmount(parseFloat(e.target.value) || 0)}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                        inputProps: { min: 0, step: 0.01 },
                      }}
                    />
                  </Grid>
                </Grid>
              )}

              {rcDepositChoice === 'waive' && (
                <TextField
                  fullWidth
                  size="small"
                  label="Reason for Waiving Deposit"
                  value={rcWaiveReason}
                  onChange={(e) => setRcWaiveReason(e.target.value)}
                  multiline
                  rows={2}
                  placeholder="e.g., Returning guest, Company account, Manager approval..."
                  helperText="Optional: provide a reason for waiving the deposit"
                  sx={{ mb: 1.5 }}
                />
              )}

              {/* Complimentary Badge if applicable */}
              {reservedCheckInBooking.is_complimentary && (
                <Alert severity="info" icon={<GiftIcon />} sx={{ mb: 2 }}>
                  <strong>Complimentary Stay</strong>
                  {reservedCheckInBooking.complimentary_reason && (
                    <Typography variant="body2">
                      Reason: {reservedCheckInBooking.complimentary_reason}
                    </Typography>
                  )}
                </Alert>
              )}

              {/* Special Requests */}
              {reservedCheckInBooking.special_requests && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <strong>Special Requests:</strong> {reservedCheckInBooking.special_requests}
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button
            onClick={() => {
              setReservedCheckInDialogOpen(false);
              setReservedCheckInBooking(null);
            }}
            disabled={processingReservedCheckIn}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => handleReservedCheckIn(false)}
            disabled={processingReservedCheckIn}
            startIcon={processingReservedCheckIn ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}
          >
            {processingReservedCheckIn ? 'Processing...' : 'Check-In Now'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Payment Collection Dialog */}
      <Dialog
        open={paymentDialogOpen}
        onClose={() => {
          if (!processingPayment) {
            setPaymentDialogOpen(false);
            setPaymentBooking(null);
            setPaymentMethod('');
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'warning.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <ReceiptIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Collect Deposit - Room {paymentBooking?.room_number}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {paymentBooking && (
            <Box>
              {/* Booking Summary */}
              <Paper elevation={0} sx={{ p: 2, mb: 3, bgcolor: 'grey.50', borderRadius: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Booking #{paymentBooking.booking_number}
                </Typography>

                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid size={12}>
                    <Typography variant="h6" fontWeight={600}>
                      {paymentBooking.guest_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {paymentBooking.guest_email}
                    </Typography>
                  </Grid>

                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Check-in</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {new Date(paymentBooking.check_in_date).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric'
                      })}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Check-out</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {new Date(paymentBooking.check_out_date).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric'
                      })}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>

              {/* Deposit Amount */}
              {/* Payment Method Selection */}
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Payment Method *</InputLabel>
                <Select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  label="Payment Method *"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <MenuItem key={method} value={method}>
                      {method}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Alert severity="info" sx={{ mt: 2 }}>
                After deposit is collected, the guest can be checked in.
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button
            onClick={() => {
              setPaymentDialogOpen(false);
              setPaymentBooking(null);
              setPaymentMethod('');
            }}
            disabled={processingPayment}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleCollectPayment}
            disabled={processingPayment || !paymentMethod}
            startIcon={processingPayment ? <CircularProgress size={20} color="inherit" /> : <ReceiptIcon />}
          >
            {processingPayment ? 'Processing...' : 'Collect Deposit'}
          </Button>
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
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            px: 3,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontSize: '0.95rem',
              fontWeight: 500,
              minHeight: 56,
              px: 3,
            }
          }}
        >
          <Tab label="Guest Info" icon={<PersonIcon />} iconPosition="start" />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <span>Free Gift Credits</span>
                {guestCredits && guestCredits.total_nights > 0 && (
                  <Chip
                    label={guestCredits.total_nights}
                    size="small"
                    color="secondary"
                  />
                )}
              </Box>
            }
            icon={<GiftIcon />}
            iconPosition="start"
          />
        </Tabs>

        <DialogContent sx={{ pt: 3, pb: 3, minHeight: 400 }}>
          {/* Tab 0: Guest Info */}
          {guestDetailsTab === 0 && selectedGuestDetails && (
            <Grid container spacing={2}>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Email</Typography>
                <Typography variant="body2">{selectedGuestDetails.email}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Phone</Typography>
                <Typography variant="body2">{selectedGuestDetails.phone || 'N/A'}</Typography>
              </Grid>
              {selectedGuestDetails.address_line1 && (
                <Grid size={12}>
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
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Country</Typography>
                  <Typography variant="body2">{selectedGuestDetails.country}</Typography>
                </Grid>
              )}
              {selectedGuestDetails.nationality && (
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Nationality</Typography>
                  <Typography variant="body2">{selectedGuestDetails.nationality}</Typography>
                </Grid>
              )}
              {selectedGuestDetails.ic_number && (
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">IC Number</Typography>
                  <Typography variant="body2">{selectedGuestDetails.ic_number}</Typography>
                </Grid>
              )}
              {selectedGuestDetails.company_name && (
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Company</Typography>
                  <Typography variant="body2">{selectedGuestDetails.company_name}</Typography>
                </Grid>
              )}
              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
              </Grid>
              <Grid size={12}>
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
                  <Grid size={12}>
                    <Paper sx={{ p: 2, bgcolor: 'secondary.light' }}>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <GiftIcon /> Available Free Gift Credits
                      </Typography>
                      {guestCredits && guestCredits.total_nights > 0 ? (
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
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No complimentary credits available
                        </Typography>
                      )}
                    </Paper>
                  </Grid>

                  {/* Booking Form */}
                  {guestCredits && guestCredits.total_nights > 0 && (
                    <>
                      <Grid size={12}>
                        <Typography variant="subtitle1" fontWeight={600}>
                          Book a Room with Free Gift Credits
                        </Typography>
                      </Grid>

                      <Grid size={6}>
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
                      <Grid size={6}>
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

                      <Grid size={12}>
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
                            {[...availableRoomsForCredits]
                              .sort((a, b) => {
                                const numA = parseInt(a.room_number, 10);
                                const numB = parseInt(b.room_number, 10);
                                if (!isNaN(numA) && !isNaN(numB)) {
                                  return numA - numB;
                                }
                                return a.room_number.localeCompare(b.room_number);
                              })
                              .map((room) => (
                                <MenuItem key={room.id} value={room.id.toString()}>
                                  Room {room.room_number} - {room.room_type}
                                </MenuItem>
                              ))}
                          </Select>
                        </FormControl>
                      </Grid>

                      {/* Date Selection for Complimentary Nights */}
                      {creditsBookingForm.room_id && getCreditsBookingDates().length > 0 && (
                        <Grid size={12}>
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

                      <Grid size={6}>
                        <TextField
                          label="Adults"
                          type="number"
                          fullWidth
                          value={creditsBookingForm.adults}
                          onChange={(e) => setCreditsBookingForm({ ...creditsBookingForm, adults: parseInt(e.target.value) || 1 })}
                          inputProps={{ min: 1, max: 10 }}
                        />
                      </Grid>
                      <Grid size={6}>
                        <TextField
                          label="Children"
                          type="number"
                          fullWidth
                          value={creditsBookingForm.children}
                          onChange={(e) => setCreditsBookingForm({ ...creditsBookingForm, children: parseInt(e.target.value) || 0 })}
                          inputProps={{ min: 0, max: 10 }}
                        />
                      </Grid>

                      <Grid size={12}>
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
              <Grid size={12}>
                <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Booking Details
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">
                        Room:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" fontWeight="bold">
                        {selectedRoom?.room_number} - {selectedRoom?.room_type}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">
                        Guest:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" fontWeight="bold">
                        {selectedBooking.guest_name}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">
                        Check-in Date:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2">
                        {new Date(selectedBooking.check_in_date).toLocaleDateString()}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">
                        Check-out Date:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2">
                        {new Date(selectedBooking.check_out_date).toLocaleDateString()}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">
                        Original Amount:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'error.main' }}>
                        {currencySymbol}{Number(selectedBooking.total_amount).toFixed(2)}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">
                        New Amount:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" fontWeight="bold" color="success.main">
                        {currencySymbol}0.00 (Complimentary)
                      </Typography>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>

              {/* Reason Input */}
              <Grid size={12}>
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
              <Grid size={12}>
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
