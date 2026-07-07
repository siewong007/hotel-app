import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

import { Room, Guest, BookingWithDetails, BookingCreateRequest, RoomHistory, TourismType } from '../../../../types';
import { useCurrency } from '../../../../hooks/useCurrency';
import {
  useBookingNotes,
  useGuestCreditsWorkflow,
  useReservedCheckInWorkflow,
  useRoomData,
  useRoomManagementFilters,
  useRoomNotes,
  useUpcomingBookingsDialog,
} from '../../hooks';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { addLocalDays, formatLocalDate, parseLocalDate } from '../../../../utils/date';
import { isGreaterMoney, isLessMoney, subtractMoney, toMoneyNumber } from '../../../../utils/money';
import { isValidEmail } from '../../../../utils/validation';
import {
  getUnifiedStatusColor,
  getUnifiedStatusLabel,
} from '../../config';
import {
  calculateNightCount,
  getCreditBookingDates as getCreditBookingDateRange,
} from '../../utils/roomManagementUtils';
import CheckoutInvoiceModals from '../../../invoices/components/CheckoutInvoiceModals';
import { useCheckoutFlow } from '../../../invoices/hooks/useCheckoutFlow';
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

const DAY_MS = 24 * 60 * 60 * 1000;

const getDateOnly = (value?: string) => (value || '').split('T')[0];

const formatReviewDate = (value?: string) => {
  const dateOnly = getDateOnly(value);
  if (!dateOnly) return '-';
  return parseLocalDate(dateOnly).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const getOverdueDays = (checkOutDate: string, todayIso: string) => {
  const checkOut = parseLocalDate(getDateOnly(checkOutDate));
  const today = parseLocalDate(todayIso);
  return Math.max(1, Math.ceil((today.getTime() - checkOut.getTime()) / DAY_MS));
};

type GuestInformationDraft = {
  email: string;
  phone: string;
  ic_number: string;
  tourism_type?: string;
};

const validateGuestInformationDraft = (guest: GuestInformationDraft): string | null => {
  if (!guest.ic_number.trim()) {
    return 'Please enter IC/Passport number';
  }

  // Email and phone are optional — online bookings often arrive without either,
  // and contact details are collected at check-in. Do not block booking creation.
  return null;
};

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

  // Shared checkout flow (no read-only receipt view on this page).
  const checkoutFlow = useCheckoutFlow({
    onAfterCheckout: () => loadData(),
    successMessage: (b, late) =>
      late
        ? `Room ${b.room_number} checked out (late checkout penalty: RM ${late.penalty})`
        : `Room ${b.room_number} checked out successfully`,
    notify: (message, severity) => showSnackbar(message, (severity ?? 'success') as ApiNotificationSeverity),
  });
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
  const handleMenuClose = useCallback(() => {
    setMenuPosition(null);
  }, []);
  const reservedCheckIn = useReservedCheckInWorkflow({
    reload: loadData,
    showSnackbar,
  });
  const guestCreditsWorkflow = useGuestCreditsWorkflow({
    guests,
    rooms,
    allBookings: allBookingsData,
    reloadRooms: loadRooms,
    reloadBookings: loadBookings,
    showSnackbar,
    onCloseMenu: handleMenuClose,
  });
  const upcomingBookings = useUpcomingBookingsDialog({
    allBookings: allBookingsData,
    onSelectRoom: setSelectedRoom,
    onCloseMenu: handleMenuClose,
  });

  // Dialogs
  const [walkInDialogOpen, setWalkInDialogOpen] = useState(false);
  const [onlineCheckInDialogOpen, setOnlineCheckInDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [roomDetailsDialogOpen, setRoomDetailsDialogOpen] = useState(false);
  const [changeRoomDialogOpen, setChangeRoomDialogOpen] = useState(false);
  const [updateCheckoutDialogOpen, setUpdateCheckoutDialogOpen] = useState(false);
  const [updateCheckoutBooking, setUpdateCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const [overdueCheckoutDialogOpen, setOverdueCheckoutDialogOpen] = useState(false);
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
    ic_number: '',
    tourism_type: 'local'
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
    ic_number: '',
    tourism_type: 'local'
  });

  // Complimentary check-in state
  const [complimentaryCheckInDialogOpen, setComplimentaryCheckInDialogOpen] = useState(false);
  const [complimentaryCheckInGuest, setComplimentaryCheckInGuest] = useState<GuestWithCredits | null>(null);
  const [complimentaryCheckInDate, setComplimentaryCheckInDate] = useState('');
  const [complimentaryCheckOutDate, setComplimentaryCheckOutDate] = useState('');
  const [complimentaryNumberOfNights, setComplimentaryNumberOfNights] = useState(1);

  // Room history state
  const [roomHistory, setRoomHistory] = useState<RoomHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Enhanced check-in modal state

  // Unified booking modal state
  const [unifiedBookingOpen, setUnifiedBookingOpen] = useState(false);
  const [unifiedBookingType, setUnifiedBookingType] = useState<BookingType | undefined>(undefined);

  // Payment collection dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState<BookingWithDetails | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);

  // Get configurable booking channels and payment methods from hotel settings
  // Can be modified in Settings page or by editing hotelSettings.ts
  const BOOKING_CHANNELS = getHotelSettings().booking_channels;
  const PAYMENT_METHODS = getHotelSettings().payment_methods;
  const todayIso = formatLocalDate();

  const roomById = useMemo(() => {
    return new Map(rooms.map((room) => [String(room.id), room]));
  }, [rooms]);

  const overdueCheckoutBookings = useMemo(() => {
    return allBookingsData
      .filter((booking) => {
        const status = String(booking.status || '');
        return (
          (status === 'checked_in' || status === 'auto_checked_in') &&
          Boolean(booking.check_out_date) &&
          getDateOnly(booking.check_out_date) < todayIso
        );
      })
      .sort((a, b) => {
        const dateSort = getDateOnly(a.check_out_date).localeCompare(getDateOnly(b.check_out_date));
        if (dateSort !== 0) return dateSort;
        return String(a.room_number || '').localeCompare(String(b.room_number || ''), undefined, { numeric: true });
      });
  }, [allBookingsData, todayIso]);

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
    reservedCheckIn.openWithBooking(bwd, booking.payment_method || 'Cash');
  }, [reservedCheckIn.openWithBooking]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, room: Room) => {
    event.preventDefault();
    setMenuPosition({ top: event.clientY, left: event.clientX });
    setSelectedRoom(room);
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
      ic_number: '',
      tourism_type: 'local'
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
      ic_number: '',
      tourism_type: 'local'
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

        const guestInformationError = validateGuestInformationDraft(newGuestForm);
        if (guestInformationError) {
          showSnackbar(guestInformationError, 'warning');
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
          tourism_type: (newGuestForm.tourism_type || 'local') as TourismType,
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
          ic_number: '',
          tourism_type: 'local'
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
      setWalkInDialogOpen(false);
      reservedCheckIn.openWithBooking(bwd, walkInPaymentMethod || 'Cash');
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
      reservedCheckIn.openWithBooking(reservedBooking);
      return;
    }

    // For non-reserved rooms, use the online check-in dialog
    setOnlineCheckInDialogOpen(true);
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

        const guestInformationError = validateGuestInformationDraft(newOnlineGuestForm);
        if (guestInformationError) {
          showSnackbar(guestInformationError, 'warning');
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
          tourism_type: (newOnlineGuestForm.tourism_type || 'local') as TourismType,
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
          ic_number: '',
          tourism_type: 'local'
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
        ic_number: '',
        tourism_type: 'local'
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
      checkoutFlow.openCheckout(booking);
    } else {
      showSnackbar('No active booking found for this room', 'warning');
    }
    handleMenuClose();
  };

  const handleUpdateStatus = (room: Room) => {
    setSelectedRoom(room);
    setRoomStatusDialogOpen(true);
    handleMenuClose();
  };

  const handleSaveRoomStatus = async (status: string, notes: string) => {
    if (!selectedRoom) return;

    // Send the requested status as-is. The backend decides whether to flip an
    // "available" request to "reserved" — but only for a reservation arriving
    // today after the configured check-in time. Pre-empting that here (forcing
    // "reserved" for any upcoming booking, with no booking_id) made the backend
    // reject the request, so rooms with a future booking could never be set
    // available.
    const updated = await HotelAPIService.updateRoomStatus(selectedRoom.id, {
      status: status as 'maintenance' | 'reserved' | 'reserved_dirty' | 'available' | 'occupied' | 'dirty',
      notes,
    });

    showSnackbar(`Room status updated to ${updated?.status ?? status}`, 'success');
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

  const handleMarkAvailable = async (room: Room) => {
    try {
      // Request "available"; the backend keeps reserved-dirty rooms reserved
      // when an active reservation still exists.
      const updated = await HotelAPIService.updateRoomStatus(room.id, {
        status: 'available',
        notes: 'Room marked as available',
      });

      showSnackbar(`Room ${room.room_number} updated to ${updated?.status ?? 'available'}`, 'success');
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

  const handleViewUpcomingBookings = upcomingBookings.openForRoom;

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

  const handleViewGuestDetails = guestCreditsWorkflow.openGuestDetails;

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

  const handleReviewCheckout = (booking: BookingWithDetails) => {
    const room = roomById.get(String(booking.room_id)) ?? null;
    setSelectedRoom(room);
    setSelectedBooking(booking);
    setOverdueCheckoutDialogOpen(false);
    checkoutFlow.openCheckout(booking);
  };

  const handleReviewUpdateCheckout = (booking: BookingWithDetails) => {
    const room = roomById.get(String(booking.room_id)) ?? null;
    setSelectedRoom(room);
    setUpdateCheckoutBooking(booking);
    setOverdueCheckoutDialogOpen(false);
    setUpdateCheckoutDialogOpen(true);
  };

  const handleConfirmRoomChange = async () => {
    if (!selectedRoom || !newSelectedRoom || !selectedBooking) {
      showSnackbar('Please select a new room', 'warning');
      return;
    }

    try {
      setChangingRoom(true);

      // Determine the effective rate
      const customRate = toMoneyNumber(changeRoomCustomRate);
      const effectiveRate = changeRoomCustomRate.trim() && isGreaterMoney(customRate, 0)
        ? customRate
        : toMoneyNumber(newSelectedRoom.price_per_night);
      const priceDifference = subtractMoney(effectiveRate, selectedRoom.price_per_night);

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

      const changeMessage = isGreaterMoney(priceDifference, 0)
        ? `Room changed successfully. Additional charge: ${currencySymbol}${Math.abs(priceDifference).toFixed(2)}/night`
        : isLessMoney(priceDifference, 0)
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
    const isReservedDirty = computedStatus === 'reserved_dirty';
    const layout: MenuLayout = { sections: [] };

    // Primary action — anchors the menu with the most likely next step for this room state
    if (isOccupied) {
      layout.primary = { label: 'Check out', icon: <LogoutIcon />, onClick: handleCheckOut, color: 'error' };
    } else if (isReserved && reservedBooking) {
      layout.primary = { label: 'Check-in guest', icon: <LoginIcon />, onClick: handleCheckIn, color: 'primary', dark: true };
    } else if (isReservedDirty) {
      layout.primary = { label: 'Mark clean', icon: <SparkleIcon />, onClick: handleMarkAvailable, color: 'success', dark: true };
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
      bookingActions.push({ id: 'update-checkout', label: 'Extend checkout date', icon: <ExtendIcon />, onClick: handleUpdateCheckoutDate });
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

      {overdueCheckoutBookings.length > 0 && (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setOverdueCheckoutDialogOpen(true)}
              sx={{ fontWeight: 800 }}
            >
              Review
            </Button>
          }
          sx={{
            mt: 1.5,
            border: '1px solid',
            borderColor: 'warning.light',
            alignItems: 'center',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            {overdueCheckoutBookings.length} room{overdueCheckoutBookings.length === 1 ? '' : 's'} past scheduled checkout
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Review checked-in bookings whose checkout date has already passed.
          </Typography>
        </Alert>
      )}

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
              onMarkAvailable={handleMarkAvailable}
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

      <Dialog
        open={overdueCheckoutDialogOpen}
        onClose={() => setOverdueCheckoutDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Overdue Checkouts</DialogTitle>
        <DialogContent dividers>
          {overdueCheckoutBookings.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <CheckCircleIcon color="success" sx={{ fontSize: 36, mb: 1 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                No overdue checkouts
              </Typography>
              <Typography variant="body2" color="text.secondary">
                All checked-in rooms are within their scheduled checkout dates.
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1.25}>
              {overdueCheckoutBookings.map((booking) => {
                const room = roomById.get(String(booking.room_id));
                const overdueDays = getOverdueDays(booking.check_out_date, todayIso);
                const bookingRef = booking.invoice_number || booking.folio_number || booking.booking_number || `#${booking.id}`;

                return (
                  <Paper
                    key={booking.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) auto' },
                      gap: 1.25,
                      alignItems: 'center',
                      borderColor: 'warning.light',
                      bgcolor: alpha(theme.palette.warning.main, 0.05),
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 0.75 }}>
                        <Chip
                          size="small"
                          color="warning"
                          label={`${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`}
                          sx={{ fontWeight: 800 }}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={bookingRef}
                          sx={{ fontWeight: 700 }}
                        />
                      </Stack>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                        Room {booking.room_number || room?.room_number || booking.room_id} · {booking.guest_name || 'Unknown guest'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Stay {formatReviewDate(booking.check_in_date)} - {formatReviewDate(booking.check_out_date)}
                      </Typography>
                    </Box>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={<ExtendIcon />}
                        onClick={() => handleReviewUpdateCheckout(booking)}
                      >
                        Extend checkout date
                      </Button>
                      <Button
                        variant="contained"
                        color="error"
                        startIcon={<LogoutIcon />}
                        onClick={() => handleReviewCheckout(booking)}
                      >
                        Check out
                      </Button>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOverdueCheckoutDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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
        loadingGuests={guestCreditsWorkflow.loadingGuestsWithCredits}
        guestsWithCredits={guestCreditsWorkflow.guestsWithCredits}
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

      {/* Extend Checkout Date Dialog */}
      <UpdateCheckoutDateDialog
        open={updateCheckoutDialogOpen}
        onClose={() => setUpdateCheckoutDialogOpen(false)}
        booking={updateCheckoutBooking}
        onSuccess={() => {
          showSnackbar('Checkout date extended successfully', 'success');
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

      {/* Check Out Dialog with Invoice (shared flow; no read-only receipt here) */}
      <CheckoutInvoiceModals flow={checkoutFlow} withReceipt={false} />

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
        open={upcomingBookings.open}
        onClose={upcomingBookings.close}
        roomNumber={selectedRoom?.room_number}
        loading={upcomingBookings.loading}
        bookings={upcomingBookings.bookings}
        formatCurrency={formatCurrency}
        onViewAllInBookings={() => navigate(`/bookings?room=${selectedRoom?.room_number}`)}
        onCheckInBooking={(booking) => {
          upcomingBookings.close();
          reservedCheckIn.openWithBooking(booking);
        }}
      />

      {/* Reserved Check-In Dialog - Streamlined check-in for reserved rooms */}
      <ReservedCheckInDialog
        open={reservedCheckIn.dialogOpen}
        onClose={reservedCheckIn.close}
        onCancel={reservedCheckIn.cancel}
        booking={reservedCheckIn.booking}
        formatCurrency={formatCurrency}
        currencySymbol={currencySymbol}
        paymentMethods={PAYMENT_METHODS}
        paymentChoice={reservedCheckIn.paymentChoice}
        onPaymentChoiceChange={reservedCheckIn.setPaymentChoice}
        paymentMethod={reservedCheckIn.paymentMethod}
        onPaymentMethodChange={reservedCheckIn.setPaymentMethod}
        amountPaid={reservedCheckIn.amountPaid}
        onAmountPaidChange={reservedCheckIn.setAmountPaid}
        depositChoice={reservedCheckIn.depositChoice}
        onDepositChoiceChange={reservedCheckIn.setDepositChoice}
        depositMethod={reservedCheckIn.depositMethod}
        onDepositMethodChange={reservedCheckIn.setDepositMethod}
        depositAmount={reservedCheckIn.depositAmount}
        onDepositAmountChange={reservedCheckIn.setDepositAmount}
        waiveReason={reservedCheckIn.waiveReason}
        onWaiveReasonChange={reservedCheckIn.setWaiveReason}
        icNumber={reservedCheckIn.icNumber}
        onIcNumberChange={reservedCheckIn.setIcNumber}
        phone={reservedCheckIn.phone}
        onPhoneChange={reservedCheckIn.setPhone}
        processing={reservedCheckIn.processing}
        onCheckIn={reservedCheckIn.checkIn}
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
        open={guestCreditsWorkflow.dialogOpen}
        onClose={guestCreditsWorkflow.close}
        guest={guestCreditsWorkflow.selectedGuest}
        tab={guestCreditsWorkflow.tab}
        onTabChange={guestCreditsWorkflow.changeTab}
        guestCredits={guestCreditsWorkflow.guestCredits}
        loadingCredits={guestCreditsWorkflow.loadingCredits}
        creditsBookingSuccess={guestCreditsWorkflow.creditsBookingSuccess}
        creditsBookingForm={guestCreditsWorkflow.creditsBookingForm}
        availableRoomsForCredits={guestCreditsWorkflow.availableRoomsForCredits}
        roomBlockedDates={guestCreditsWorkflow.roomBlockedDates}
        selectedComplimentaryDates={guestCreditsWorkflow.selectedComplimentaryDates}
        bookingWithCredits={guestCreditsWorkflow.bookingWithCredits}
        getCreditsBookingDates={guestCreditsWorkflow.getCreditsBookingDates}
        getTotalCreditsForRoom={guestCreditsWorkflow.getTotalCreditsForRoom}
        isDateBlocked={guestCreditsWorkflow.isDateBlocked}
        onCheckInFromCreditsBooking={guestCreditsWorkflow.checkInFromCreditsBooking}
        onBookAnother={guestCreditsWorkflow.bookAnother}
        onCheckInDateChange={guestCreditsWorkflow.changeCheckInDate}
        onCheckOutDateChange={guestCreditsWorkflow.changeCheckOutDate}
        onRoomChange={guestCreditsWorkflow.changeRoom}
        onAdultsChange={guestCreditsWorkflow.changeAdults}
        onChildrenChange={guestCreditsWorkflow.changeChildren}
        onSelectAllAvailable={guestCreditsWorkflow.selectAllAvailable}
        onToggleDate={guestCreditsWorkflow.toggleDate}
        onBookWithCredits={guestCreditsWorkflow.bookWithCreditsAndCheckIn}
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
