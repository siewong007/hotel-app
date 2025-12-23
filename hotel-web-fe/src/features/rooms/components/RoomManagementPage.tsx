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
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room, Guest, BookingWithDetails, BookingCreateRequest, RoomHistory, Booking } from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { isValidEmail } from '../../../utils/validation';
import CheckoutInvoiceModal from '../../invoices/components/CheckoutInvoiceModal';
import EnhancedCheckInModal from '../../bookings/components/EnhancedCheckInModal';

interface RoomAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  color?: string;
  onClick: (room: Room) => void;
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
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);

  // Dialogs
  const [walkInDialogOpen, setWalkInDialogOpen] = useState(false);
  const [onlineCheckInDialogOpen, setOnlineCheckInDialogOpen] = useState(false);
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [roomDetailsDialogOpen, setRoomDetailsDialogOpen] = useState(false);
  const [changeRoomDialogOpen, setChangeRoomDialogOpen] = useState(false);

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

  // Room history state
  const [roomHistory, setRoomHistory] = useState<RoomHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedGuestDetails, setSelectedGuestDetails] = useState<Guest | null>(null);
  const [guestDetailsDialogOpen, setGuestDetailsDialogOpen] = useState(false);

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

      bookingsData.forEach((booking: BookingWithDetails) => {
        // Only consider checked_in bookings
        if (booking.status === 'checked_in') {
          bookingsMap.set(booking.room_id, booking);
        }
      });

      setRoomBookings(bookingsMap);
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
    // Occupied (checked-in guest) → Orange (ALWAYS)
    if (room.status === 'occupied') {
      return '#FFA726'; // Orange
    }

    // Cleaning → Orange
    if (room.status === 'cleaning') {
      return '#FFA726'; // Orange
    }

    // Reserved → Blue
    if (room.status === 'reserved') {
      return '#42A5F5'; // Blue
    }

    // Maintenance → Red
    if (room.status === 'maintenance') {
      return '#EF5350'; // Red
    }

    // Out of Order (Unavailable) → Grey
    if (room.status === 'out_of_order') {
      return '#BDBDBD'; // Grey
    }

    // Dirty → Orange
    if (room.status === 'dirty') {
      return '#FFA726'; // Orange
    }

    // Available → Green
    if (room.status === 'available') {
      return '#66BB6A'; // Green
    }

    return '#BDBDBD'; // Default grey
  };

  const getRoomStatusLabel = (room: Room): string => {
    if (!room.available) {
      if (room.status === 'maintenance') return 'MAINT';
      if (room.status === 'cleaning') return 'CLEAN';
      if (room.status === 'occupied') return 'OCC';
      if (room.status === 'reserved') return 'RES';
      return 'N/A';
    }
    return 'VAC';
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
        setGuestDetailsDialogOpen(true);
        handleMenuClose();
      } else {
        showSnackbar(`Guest not found (ID: ${guestId})`, 'error');
      }
    } catch (error: any) {
      console.error('Error loading guest details:', error);
      showSnackbar(error.message || 'Failed to load guest details', 'error');
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

  const getMenuActions = (room: Room | null): RoomAction[] => {
    if (!room) return [];

    const isOccupied = room.status === 'occupied';
    const isReserved = room.status === 'reserved';
    const booking = roomBookings.get(room.id);
    const actions: RoomAction[] = [];

    // Check-in options (only if room is not occupied)
    if (!isOccupied) {
      actions.push(
        { id: 'walkin', label: 'Walk-in Guest Check-in', icon: <PersonAddIcon />, onClick: handleWalkInGuest },
        { id: 'online-checkin', label: 'Online Guest Check-in', icon: <BookingIcon />, onClick: handleOnlineCheckIn }
      );

      // Enhanced check-in for reserved rooms with existing booking
      if (isReserved && booking) {
        actions.push(
          { id: 'reserved-checkin', label: 'Check-in Reserved Booking', icon: <LoginIcon />, color: 'primary', onClick: handleCheckIn }
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
          const isOccupied = room.status === 'occupied' || room.status === 'cleaning';
          const isReservedToday = room.status === 'reserved' && room.reserved_start_date &&
            new Date(room.reserved_start_date).toDateString() === new Date().toDateString();

          return (
            <Grid item xs={6} sm={4} md={3} lg={2} key={room.id}>
              <Card
                sx={{
                  bgcolor: getRoomStatusColor(room),
                  color: room.status === 'cleaning' ? '#333' : 'white',
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

                  {/* Room Number */}
                  <Typography variant="h5" fontWeight={700} gutterBottom sx={{ mt: isReservedToday ? 3 : 0 }}>
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
                    {getRoomStatusLabel(room)}
                  </Typography>

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
                  {isReservedToday && booking && (
                    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{
                          fontSize: '0.6rem',
                          mb: 0.5,
                          opacity: 0.9,
                        }}
                      >
                        Guest: {booking.guest_name}
                      </Typography>
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

      {/* Guest Details Dialog */}
      <Dialog open={guestDetailsDialogOpen} onClose={() => setGuestDetailsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <PersonIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Guest Details
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {selectedGuestDetails && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>
                  {selectedGuestDetails.full_name}
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <Divider />
              </Grid>
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
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => setGuestDetailsDialogOpen(false)} variant="outlined">Close</Button>
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
