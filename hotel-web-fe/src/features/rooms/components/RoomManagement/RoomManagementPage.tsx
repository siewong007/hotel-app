import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '../../../../router';
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
import { alpha, useTheme } from '@mui/material/styles';
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
  SmokingRooms as SmokingIcon,
  AutoAwesome as SparkleIcon,
  Build as BuildIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../../api';

import { Room, Guest, BookingWithDetails, BookingCreateRequest, RoomHistory } from '../../../../types';
import { useCurrency } from '../../../../hooks/useCurrency';
import {
  useBookingNotes,
  useRoomData,
  useRoomManagementFilters,
  useRoomNotes,
} from '../../hooks';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { addLocalDays, formatLocalDate } from '../../../../utils/date';
import { isValidEmail } from '../../../../utils/validation';
import {
  getUnifiedStatusColor,
  getUnifiedStatusLabel,
} from '../../config';
import {
  buildBlockedDateRangesForRoom,
  type BlockedDateRange,
  calculateNightCount,
  getCreditBookingDates as getCreditBookingDateRange,
  getPositiveRatePerNight,
  getRoomTypeCode,
  getTotalCreditsForRoom as getCreditsForRoomType,
  isDateBlockedByRanges,
  formatMenuBookingDate,
} from '../../utils/roomManagementUtils';
import CheckoutInvoiceModal from '../../../invoices/components/CheckoutInvoiceModal';
import UnifiedBookingModal, { BookingType } from '../UnifiedBooking/UnifiedBookingModal';
import UpdateCheckoutDateDialog from '../UpdateCheckoutDateDialog';
import RoomStatusDialog from './RoomStatusDialog';
import { ApiNotificationSeverity, emitApiNotification } from '../../../../utils/apiNotifications';
import { RoomAction, MenuLayout, GuestWithCredits } from './types';
import RoomNotesDialog from './components/RoomNotesDialog';
import RoomDetailsDialog from './components/RoomDetailsDialog';
import RoomHistoryDialog from './components/RoomHistoryDialog';
import BookingNotesDialog from './components/BookingNotesDialog';
import CollectDepositDialog from './components/CollectDepositDialog';
import MarkComplimentaryDialog from './components/MarkComplimentaryDialog';
import UpcomingBookingsDialog from './components/UpcomingBookingsDialog';
import ChangeRoomDialog from './components/ChangeRoomDialog';
import ComplimentaryCheckInDialog from './components/ComplimentaryCheckInDialog';
import ReservedCheckInDialog from './components/ReservedCheckInDialog';
import WalkInCheckInDialog from './components/WalkInCheckInDialog';
import OnlineCheckInDialog from './components/OnlineCheckInDialog';
import {
  getRoomCardFill,
  getRoomStatusColor,
  getRoomStatusLabel,
} from './roomCardPresentation';
import GuestDetailsDialog from './components/GuestDetailsDialog';
import RoomManagementHeader from './components/RoomManagementHeader';
import RoomCard from './components/RoomCard';
import RoomContextMenu from './components/RoomContextMenu';

const RoomManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isDarkMode = theme.palette.mode !== 'light';
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const {
    rooms,
    guests,
    loading,
    error: dataError,
    roomBookings,
    reservedBookings,
    compVoidBookings,
    allBookingsData,
    reload: loadData,
    reloadRooms: loadRooms,
    reloadGuests: loadGuests,
    reloadBookings: loadBookings,
  } = useRoomData();
  const showSnackbar = useCallback((message: string, severity: ApiNotificationSeverity) => {
    emitApiNotification({ message, severity });
  }, []);
  const {
    notesDialogOpen,
    notesRoom,
    editingNotes,
    setEditingNotes,
    savingNotes,
    openRoomNotes,
    closeRoomNotes,
    saveRoomNotes,
  } = useRoomNotes({ reload: loadData, showSnackbar });
  const {
    bookingNotesDialogOpen,
    bookingNotesEditBooking,
    editedBookingNotes,
    setEditedBookingNotes,
    editedCleaningPreference,
    setEditedCleaningPreference,
    savingBookingNotes,
    openBookingNotes: handleEditBookingNotes,
    closeBookingNotes,
    saveBookingNotes: handleSaveBookingNotes,
  } = useBookingNotes({ reload: loadData, showSnackbar });
  const {
    roomStatusFilter,
    setRoomStatusFilter,
    attrFilters,
    toggleAttrFilter,
    getRoomStatusInfo,
    availableCount,
    occupiedCount,
    reservedCount,
    dirtyCount,
    maintenanceCount,
    occupancyRate,
    smokingCount,
    dailyCleaningCount,
    noCleaningCount,
    filteredRooms,
    filterOptions,
  } = useRoomManagementFilters({ rooms, roomBookings, reservedBookings });
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
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

  // Notes and status editing state
  const [roomStatusDialogOpen, setRoomStatusDialogOpen] = useState(false);
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [markingComplimentary, setMarkingComplimentary] = useState(false);

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
  const [roomBlockedDates, setRoomBlockedDates] = useState<BlockedDateRange[]>([]);

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
      showSnackbar('Please select a guest with free room credits', 'warning');
      return;
    }

    if (!complimentaryCheckInDate || !complimentaryCheckOutDate) {
      showSnackbar('Please select check-in and check-out dates', 'warning');
      return;
    }

    try {
      setCreatingBooking(true);

      const complimentaryDates = getCreditBookingDateRange(
        complimentaryCheckInDate,
        complimentaryCheckOutDate,
      );

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
      showSnackbar('Please select a room', 'warning');
      return;
    }

    let guestToUse: Guest | null = null;

    try {
      setCreatingBooking(true);

      // If creating a new guest, create them first
      if (isCreatingNewGuest) {
        // Validate required fields
        if (!newGuestForm.first_name || !newGuestForm.last_name) {
          showSnackbar('Please fill in all required fields (First Name, Last Name)', 'warning');
          setCreatingBooking(false);
          return;
        }

        // Validate email format only if provided
        if (newGuestForm.email && newGuestForm.email.trim() && !isValidEmail(newGuestForm.email)) {
          showSnackbar('Please enter a valid email address', 'warning');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate guest name
        const fullName = `${newGuestForm.first_name.trim()} ${newGuestForm.last_name.trim()}`.toLowerCase();
        const existingGuestByName = guests.find(g => g.full_name.toLowerCase().trim() === fullName);
        if (existingGuestByName) {
          showSnackbar(`A guest with the name '${newGuestForm.first_name.trim()} ${newGuestForm.last_name.trim()}' already exists. Please select from existing guests.`, 'warning');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate email only if provided
        if (newGuestForm.email && newGuestForm.email.trim()) {
          const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newGuestForm.email.toLowerCase());
          if (existingGuest) {
            showSnackbar(`A guest with email ${newGuestForm.email} already exists. Please select from existing guests.`, 'warning');
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
          showSnackbar('Please select a guest', 'warning');
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
        showSnackbar('Invalid room selection. Please try again.', 'warning');
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
      showSnackbar('Please select a guest and booking channel', 'warning');
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
      showSnackbar('No booking selected', 'warning');
      return;
    }

    if (rcDepositChoice === 'receive' && Number(rcDepositAmount) <= 0) {
      showSnackbar('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.', 'warning');
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
      showSnackbar('No booking selected', 'warning');
      return;
    }

    if (!paymentMethod) {
      showSnackbar('Please select a payment method', 'warning');
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
      showSnackbar('Please select a room', 'warning');
      return;
    }

    if (!onlineCheckInBookingChannel) {
      showSnackbar('Please select a booking channel', 'warning');
      return;
    }

    let guestToUse: Guest | null = null;

    try {
      setCreatingBooking(true);

      // If creating a new guest, create them first
      if (isCreatingNewOnlineGuest) {
        // Validate required fields
        if (!newOnlineGuestForm.first_name || !newOnlineGuestForm.last_name) {
          showSnackbar('Please fill in all required fields (First Name, Last Name)', 'warning');
          setCreatingBooking(false);
          return;
        }

        // Validate email format only if provided
        if (newOnlineGuestForm.email && newOnlineGuestForm.email.trim() && !isValidEmail(newOnlineGuestForm.email)) {
          showSnackbar('Please enter a valid email address', 'warning');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate guest name
        const onlineFullName = `${newOnlineGuestForm.first_name.trim()} ${newOnlineGuestForm.last_name.trim()}`.toLowerCase();
        const existingGuestByName = guests.find(g => g.full_name.toLowerCase().trim() === onlineFullName);
        if (existingGuestByName) {
          showSnackbar(`A guest with the name '${newOnlineGuestForm.first_name.trim()} ${newOnlineGuestForm.last_name.trim()}' already exists. Please select from existing guests.`, 'warning');
          setCreatingBooking(false);
          return;
        }

        // Check for duplicate email only if provided
        if (newOnlineGuestForm.email && newOnlineGuestForm.email.trim()) {
          const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newOnlineGuestForm.email.toLowerCase());
          if (existingGuest) {
            showSnackbar(`A guest with email ${newOnlineGuestForm.email} already exists. Please select from existing guests.`, 'warning');
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
          showSnackbar('Please select a guest', 'warning');
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
        showSnackbar('Invalid room selection. Please try again.', 'warning');
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
        showSnackbar('Check-in and check-out dates are required', 'warning');
        setCreatingBooking(false);
        return;
      }

      // Validate that check-out is after check-in
      const checkInTest = new Date(checkInDateToUse);
      const checkOutTest = new Date(checkOutDateToUse);
      if (checkOutTest <= checkInTest) {
        showSnackbar('Check-out date must be after check-in date', 'warning');
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
      showSnackbar('No active booking found for this room', 'warning');
    }
    handleMenuClose();
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

  const handleUpdateStatus = (room: Room) => {
    setSelectedRoom(room);
    setRoomStatusDialogOpen(true);
    handleMenuClose();
  };

  const handleSaveRoomStatus = async (status: string, notes: string) => {
    if (!selectedRoom) return;
    
    // If setting to available but there's an upcoming booking, it should be 'reserved'
    let finalStatus = status;
    if (status === 'available') {
      const upcomingBooking = Array.from(reservedBookings.values()).find(
        b => String(b.room_id) === String(selectedRoom.id)
      );
      if (upcomingBooking) {
        finalStatus = 'reserved';
      }
    }
    
    await HotelAPIService.updateRoomStatus(selectedRoom.id, {
      status: finalStatus as 'maintenance' | 'reserved' | 'available' | 'occupied' | 'dirty',
      notes,
    });

    showSnackbar(`Room status updated to ${finalStatus}`, 'success');
    loadData();
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
      showSnackbar(`Guest not found (ID: ${guestId})`, 'warning');
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

  const loadAvailableRoomsForCredits = () => {
    // Use rooms from state instead of fetching again
    setAvailableRoomsForCredits(rooms);
  };

  const loadRoomBlockedDates = (roomId: string) => {
    setRoomBlockedDates(buildBlockedDateRangesForRoom(allBookingsData, roomId));
  };

  const isDateBlocked = (dateStr: string): boolean => {
    return isDateBlockedByRanges(dateStr, roomBlockedDates);
  };

  const getCreditsBookingDates = (): string[] => {
    return getCreditBookingDateRange(
      creditsBookingForm.check_in_date,
      creditsBookingForm.check_out_date,
    );
  };

  const getTotalCreditsForRoom = (roomId: string): number => {
    return getCreditsForRoomType(guestCredits, availableRoomsForCredits, roomId);
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
      showSnackbar('Please select a room and at least one complimentary date', 'warning');
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
    setSelectedRoom(room);
    openRoomNotes(room);
    handleMenuClose();
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
      showSnackbar('Please select a new room', 'warning');
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
      showSnackbar('No pending booking found for this room', 'warning');
    }
    handleMenuClose();
  };

  const handleConfirmMarkComplimentary = async () => {
    if (!selectedBooking) {
      showSnackbar('No booking selected', 'warning');
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
          showSnackbar('This is a complimentary (Free Gift) booking. Cancellation is not recommended as the guest has used their free credits.', 'warning');
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
    hkActions.push({ id: 'update-status', label: 'Update status / block', icon: <BuildIcon />, onClick: handleUpdateStatus });
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

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
      {/* Header */}
      <RoomManagementHeader
        rooms={filteredRooms}
        occupancyRate={occupancyRate}
        availableCount={availableCount}
        occupiedCount={occupiedCount}
        reservedCount={reservedCount}
        dirtyCount={dirtyCount}
        maintenanceCount={maintenanceCount}
        statusFilter={roomStatusFilter}
        onStatusFilterChange={setRoomStatusFilter}
        filterOptions={filterOptions}
        attrFilters={attrFilters}
        onToggleAttr={toggleAttrFilter}
        smokingCount={smokingCount}
        dailyCleaningCount={dailyCleaningCount}
        noCleaningCount={noCleaningCount}
      />

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
          const info = getRoomStatusInfo(room);
          const displayRoom = { ...room, status: info.computedStatus };
          const statusColor = getRoomStatusColor(displayRoom);
          const cardFill = getRoomCardFill(info.computedStatus, statusColor, isDarkMode);
          return (
            <RoomCard
              key={room.id}
              room={room}
              computedStatus={info.computedStatus}
              booking={info.booking}
              reservedBooking={info.reservedBooking}
              hasReservationForToday={info.hasReservationForToday}
              isOccupied={info.isOccupied}
              isReservedToday={info.isReservedToday}
              isComplimentary={info.isComplimentary}
              cardFill={cardFill}
              isDarkMode={isDarkMode}
              onMenuOpen={handleMenuOpen}
              onEditNotes={handleEditNotes}
              onEditBookingNotes={handleEditBookingNotes}
              onCheckOut={handleCheckOut}
              onChangeRoom={handleChangeRoom}
              onCheckIn={handleCheckIn}
              onNewBooking={openUnifiedBooking}
            />
          );
        })}
      </Box>
      </Paper>

      {/* Context Menu */}
      <RoomContextMenu
        menuPosition={menuPosition}
        onClose={handleMenuClose}
        room={selectedRoom}
        getStatusInfo={getRoomStatusInfo}
        getMenuLayout={getMenuLayout}
        formatCurrency={formatCurrency}
      />

      {/* Walk-in Guest Dialog */}
      <WalkInCheckInDialog
        open={walkInDialogOpen}
        onClose={handleCloseWalkInDialog}
        roomNumber={selectedRoom?.room_number}
        roomPricePerNight={selectedRoom?.price_per_night}
        isCreatingNewGuest={isCreatingNewGuest}
        onModeChange={setIsCreatingNewGuest}
        guests={guests}
        selectedGuest={walkInGuest}
        onSelectGuest={(guest) => {
          setWalkInGuest(guest);
          // Reset room card deposit to 0 for members (waived)
          if (guest?.guest_type === 'member') {
            setWalkInRoomCardDeposit(0);
          }
        }}
        newGuestForm={newGuestForm}
        onNewGuestFieldChange={(field, value) => setNewGuestForm(prev => ({ ...prev, [field]: value }))}
        checkInDate={walkInCheckInDate}
        onCheckInDateChange={(value) => {
          setWalkInCheckInDate(value);
          if (walkInCheckOutDate) {
            setWalkInNumberOfNights(calculateNightCount(value, walkInCheckOutDate));
          }
        }}
        checkOutDate={walkInCheckOutDate}
        onCheckOutDateChange={(value) => {
          setWalkInCheckOutDate(value);
          if (walkInCheckInDate) {
            setWalkInNumberOfNights(calculateNightCount(walkInCheckInDate, value));
          }
        }}
        numberOfNights={walkInNumberOfNights}
        currencySymbol={currencySymbol}
        creating={creatingBooking}
        onSubmit={handleWalkInGuestSelected}
      />

      {/* Online Check-in Dialog */}
      <OnlineCheckInDialog
        open={onlineCheckInDialogOpen}
        onClose={handleCloseOnlineCheckInDialog}
        roomNumber={selectedRoom?.room_number}
        roomPricePerNight={selectedRoom?.price_per_night}
        isCreatingNewGuest={isCreatingNewOnlineGuest}
        onModeChange={setIsCreatingNewOnlineGuest}
        guests={guests}
        selectedGuest={onlineCheckInGuest}
        onSelectGuest={setOnlineCheckInGuest}
        newGuestForm={newOnlineGuestForm}
        onNewGuestFieldChange={(field, value) => setNewOnlineGuestForm(prev => ({ ...prev, [field]: value }))}
        bookingChannels={BOOKING_CHANNELS}
        bookingChannel={onlineCheckInBookingChannel}
        onBookingChannelChange={setOnlineCheckInBookingChannel}
        reference={onlineReference}
        onReferenceChange={setOnlineReference}
        checkInDate={onlineCheckInDate}
        onCheckInDateChange={(value) => {
          setOnlineCheckInDate(value);
          if (onlineCheckOutDate) {
            setOnlineNumberOfNights(calculateNightCount(value, onlineCheckOutDate));
          }
        }}
        checkOutDate={onlineCheckOutDate}
        onCheckOutDateChange={(value) => {
          setOnlineCheckOutDate(value);
          if (onlineCheckInDate) {
            setOnlineNumberOfNights(calculateNightCount(onlineCheckInDate, value));
          }
        }}
        numberOfNights={onlineNumberOfNights}
        currencySymbol={currencySymbol}
        creating={creatingBooking}
        onSubmit={handleOnlineGuestSelected}
      />

      {/* Complimentary Check-in Dialog */}
      <ComplimentaryCheckInDialog
        open={complimentaryCheckInDialogOpen}
        onClose={handleCloseComplimentaryCheckInDialog}
        roomNumber={selectedRoom?.room_number}
        roomPricePerNight={selectedRoom?.price_per_night}
        loadingGuests={loadingGuestsWithCredits}
        guestsWithCredits={guestsWithCredits}
        selectedGuest={complimentaryCheckInGuest}
        onSelectGuest={setComplimentaryCheckInGuest}
        checkInDate={complimentaryCheckInDate}
        onCheckInDateChange={(value) => {
          setComplimentaryCheckInDate(value);
          if (complimentaryCheckOutDate) {
            setComplimentaryNumberOfNights(calculateNightCount(value, complimentaryCheckOutDate));
          }
        }}
        checkOutDate={complimentaryCheckOutDate}
        onCheckOutDateChange={(value) => {
          setComplimentaryCheckOutDate(value);
          if (complimentaryCheckInDate) {
            setComplimentaryNumberOfNights(calculateNightCount(complimentaryCheckInDate, value));
          }
        }}
        numberOfNights={complimentaryNumberOfNights}
        currencySymbol={currencySymbol}
        creating={creatingBooking}
        onSubmit={handleComplimentaryBookingSubmit}
      />

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
      <ChangeRoomDialog
        open={changeRoomDialogOpen}
        onClose={() => !changingRoom && setChangeRoomDialogOpen(false)}
        onCancel={() => setChangeRoomDialogOpen(false)}
        currentRoom={selectedRoom}
        rooms={rooms}
        selectedNewRoom={newSelectedRoom}
        onSelectNewRoom={setNewSelectedRoom}
        customRate={changeRoomCustomRate}
        onCustomRateChange={setChangeRoomCustomRate}
        currencySymbol={currencySymbol}
        changing={changingRoom}
        onConfirm={handleConfirmRoomChange}
      />

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
      <RoomHistoryDialog
        open={historyDialogOpen}
        onClose={() => setHistoryDialogOpen(false)}
        room={selectedRoom}
        loading={loadingHistory}
        history={roomHistory}
        currentBooking={selectedRoom ? roomBookings.get(selectedRoom.id) : undefined}
        onViewGuestDetails={handleViewGuestDetails}
      />

      {/* Room Properties Dialog - Placeholder */}
      <RoomDetailsDialog
        open={roomDetailsDialogOpen}
        onClose={() => setRoomDetailsDialogOpen(false)}
        room={selectedRoom}
        formatCurrency={formatCurrency}
      />

      {/* Edit Room Notes Dialog */}
      <RoomNotesDialog
        open={notesDialogOpen}
        onClose={closeRoomNotes}
        roomNumber={notesRoom?.room_number}
        notes={editingNotes}
        onNotesChange={setEditingNotes}
        onSave={saveRoomNotes}
        saving={savingNotes}
      />

      <RoomStatusDialog
        open={roomStatusDialogOpen}
        room={selectedRoom}
        onClose={() => setRoomStatusDialogOpen(false)}
        onSubmit={handleSaveRoomStatus}
      />

      {/* Booking Notes Edit Dialog */}
      <BookingNotesDialog
        open={bookingNotesDialogOpen}
        onClose={closeBookingNotes}
        booking={bookingNotesEditBooking}
        notes={editedBookingNotes}
        onNotesChange={setEditedBookingNotes}
        cleaningPreference={editedCleaningPreference}
        onCleaningPreferenceChange={setEditedCleaningPreference}
        onSave={handleSaveBookingNotes}
        saving={savingBookingNotes}
      />

      {/* Upcoming Bookings Dialog */}
      <UpcomingBookingsDialog
        open={upcomingBookingsDialogOpen}
        onClose={() => setUpcomingBookingsDialogOpen(false)}
        roomNumber={selectedRoom?.room_number}
        loading={loadingUpcomingBookings}
        bookings={upcomingBookingsForRoom}
        formatCurrency={formatCurrency}
        onViewAllInBookings={() => navigate(`/bookings?room=${selectedRoom?.room_number}`)}
        onCheckInBooking={(booking) => {
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
      />

      {/* Reserved Check-In Dialog - Streamlined check-in for reserved rooms */}
      <ReservedCheckInDialog
        open={reservedCheckInDialogOpen}
        onClose={() => {
          if (!processingReservedCheckIn) {
            setReservedCheckInDialogOpen(false);
            setReservedCheckInBooking(null);
            setCollectingDeposit(false);
            setDepositPaymentMethod('');
          }
        }}
        onCancel={() => {
          setReservedCheckInDialogOpen(false);
          setReservedCheckInBooking(null);
        }}
        booking={reservedCheckInBooking}
        formatCurrency={formatCurrency}
        currencySymbol={currencySymbol}
        paymentMethods={PAYMENT_METHODS}
        paymentChoice={rcPaymentChoice}
        onPaymentChoiceChange={setRcPaymentChoice}
        paymentMethod={rcPaymentMethod}
        onPaymentMethodChange={setRcPaymentMethod}
        amountPaid={rcAmountPaid}
        onAmountPaidChange={setRcAmountPaid}
        depositChoice={rcDepositChoice}
        onDepositChoiceChange={setRcDepositChoice}
        depositMethod={rcDepositMethod}
        onDepositMethodChange={setRcDepositMethod}
        depositAmount={rcDepositAmount}
        onDepositAmountChange={setRcDepositAmount}
        waiveReason={rcWaiveReason}
        onWaiveReasonChange={setRcWaiveReason}
        processing={processingReservedCheckIn}
        onCheckIn={() => handleReservedCheckIn(false)}
      />

      {/* Payment Collection Dialog */}
      <CollectDepositDialog
        open={paymentDialogOpen}
        onClose={() => {
          if (!processingPayment) {
            setPaymentDialogOpen(false);
            setPaymentBooking(null);
            setPaymentMethod('');
          }
        }}
        onCancel={() => {
          setPaymentDialogOpen(false);
          setPaymentBooking(null);
          setPaymentMethod('');
        }}
        booking={paymentBooking}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        paymentMethods={PAYMENT_METHODS}
        processing={processingPayment}
        onCollect={handleCollectPayment}
      />

      {/* Guest Details Dialog with Tabs */}
      <GuestDetailsDialog
        open={guestDetailsDialogOpen}
        onClose={() => setGuestDetailsDialogOpen(false)}
        guest={selectedGuestDetails}
        tab={guestDetailsTab}
        onTabChange={(v) => {
          setGuestDetailsTab(v);
          if (v === 1) {
            loadAvailableRoomsForCredits();
          }
        }}
        guestCredits={guestCredits}
        loadingCredits={loadingCredits}
        creditsBookingSuccess={creditsBookingSuccess}
        creditsBookingForm={creditsBookingForm}
        availableRoomsForCredits={availableRoomsForCredits}
        roomBlockedDates={roomBlockedDates}
        selectedComplimentaryDates={selectedComplimentaryDates}
        bookingWithCredits={bookingWithCredits}
        getCreditsBookingDates={getCreditsBookingDates}
        getTotalCreditsForRoom={getTotalCreditsForRoom}
        isDateBlocked={isDateBlocked}
        onCheckInFromCreditsBooking={handleCheckInFromCreditsBooking}
        onBookAnother={() => {
          setCreditsBookingSuccess(null);
          setSelectedComplimentaryDates([]);
        }}
        onCheckInDateChange={(value) => {
          setCreditsBookingForm({ ...creditsBookingForm, check_in_date: value });
          setSelectedComplimentaryDates([]);
        }}
        onCheckOutDateChange={(value) => {
          setCreditsBookingForm({ ...creditsBookingForm, check_out_date: value });
          setSelectedComplimentaryDates([]);
        }}
        onRoomChange={(value) => {
          setCreditsBookingForm({ ...creditsBookingForm, room_id: value });
          setSelectedComplimentaryDates([]);
          setRoomBlockedDates([]);
          if (value) {
            loadRoomBlockedDates(value);
          }
        }}
        onAdultsChange={(value) => setCreditsBookingForm({ ...creditsBookingForm, adults: value })}
        onChildrenChange={(value) => setCreditsBookingForm({ ...creditsBookingForm, children: value })}
        onSelectAllAvailable={selectAllCreditsAvailable}
        onToggleDate={handleCreditsDateToggle}
        onBookWithCredits={handleBookWithCreditsAndCheckIn}
      />

      {/* Mark as Complimentary Dialog */}
      <MarkComplimentaryDialog
        open={complimentaryDialogOpen}
        onClose={() => !markingComplimentary && setComplimentaryDialogOpen(false)}
        onCancel={() => setComplimentaryDialogOpen(false)}
        booking={selectedBooking}
        room={selectedRoom}
        currencySymbol={currencySymbol}
        reason={complimentaryReason}
        onReasonChange={setComplimentaryReason}
        processing={markingComplimentary}
        onConfirm={handleConfirmMarkComplimentary}
      />

    </Box>
  );
};

export default RoomManagementPage;
