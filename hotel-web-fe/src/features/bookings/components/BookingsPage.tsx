import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Card,
  CardContent,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Snackbar,
  Box as MuiBox,
  Autocomplete,
  IconButton,
  Grid,
  FormControl,
  FormControlLabel,
  Checkbox,
  InputLabel,
  Select,
  InputAdornment,
  TableSortLabel,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  EventAvailable as BookIcon,
  Person as PersonIcon,
  Hotel as HotelIcon,
  Edit as EditIcon,
  CheckCircle as CheckCircleIcon,
  ExitToApp as CheckOutIcon,
  Delete as DeleteIcon,
  Cancel as CancelIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Today as TodayIcon,
  Clear as ClearIcon,
  CardGiftcard as ComplimentaryIcon,
  Payment as PaymentIcon,
} from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { HotelAPIService } from '../../../api';
import { BookingWithDetails, Room, Guest } from '../../../types';
import { getBookingStatusColor, getBookingStatusText, getPaymentStatusColor, getPaymentStatusText } from '../../../utils/bookingUtils';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import CheckoutInvoiceModal from '../../invoices/components/CheckoutInvoiceModal';
import EnhancedCheckInModal from '../../bookings/components/EnhancedCheckInModal';
import { getHotelSettings } from '../../../utils/hotelSettings';

type SortField = 'check_in_date' | 'check_out_date' | 'guest_name' | 'room_number' | 'status' | 'folio_number';
type SortOrder = 'asc' | 'desc';
type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom';

const BookingsPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { symbol: currencySymbol, format: formatCurrency } = useCurrency();
  const isAdmin = hasRole('admin') || hasRole('receptionist') || hasRole('manager') || hasPermission('bookings:update');

  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [checkoutBooking, setCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkinBooking, setCheckinBooking] = useState<BookingWithDetails | null>(null);
  const [checkinGuest, setCheckinGuest] = useState<Guest | null>(null);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sorting and filtering state
  const [sortField, setSortField] = useState<SortField>('check_in_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Create booking dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [postType, setPostType] = useState<'normal_stay' | 'same_day'>('normal_stay');
  const [rateCode, setRateCode] = useState('RACK');
  const [bookingSource, setBookingSource] = useState<'walk_in' | 'online'>('walk_in');
  const [folioNumber, setFolioNumber] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit booking dialog (admin only)
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  const [updating, setUpdating] = useState(false);

  // Delete booking dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingBooking, setDeletingBooking] = useState<BookingWithDetails | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Complimentary dialog
  const [complimentaryDialogOpen, setComplimentaryDialogOpen] = useState(false);
  const [complimentaryBooking, setComplimentaryBooking] = useState<BookingWithDetails | null>(null);
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [complimentaryStartDate, setComplimentaryStartDate] = useState('');
  const [complimentaryEndDate, setComplimentaryEndDate] = useState('');
  const [markingComplimentary, setMarkingComplimentary] = useState(false);

  // Payment status update dialog
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState<BookingWithDetails | null>(null);
  const [newPaymentStatus, setNewPaymentStatus] = useState<string>('');
  const [paymentNote, setPaymentNote] = useState<string>('');
  const [updatingPayment, setUpdatingPayment] = useState(false);

  // Notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [bookingsData, roomsData, guestsData] = await Promise.all([
        HotelAPIService.getBookingsWithDetails(),
        HotelAPIService.getAllRooms(),
        HotelAPIService.getAllGuests()
      ]);

      setBookings(bookingsData);
      setRooms(roomsData);
      setGuests(guestsData);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load bookings data:', err);
      setError(err.message || 'Failed to load bookings data. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort bookings
  const filteredAndSortedBookings = useMemo(() => {
    let filtered = [...bookings];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(booking =>
        booking.guest_name.toLowerCase().includes(query) ||
        booking.room_number.toLowerCase().includes(query) ||
        booking.folio_number?.toLowerCase().includes(query) ||
        booking.id.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(booking => booking.status === statusFilter);
    }

    // Date filter
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dateFilter === 'today') {
      filtered = filtered.filter(booking => {
        const checkIn = new Date(booking.check_in_date);
        checkIn.setHours(0, 0, 0, 0);
        return checkIn.getTime() === today.getTime();
      });
    } else if (dateFilter === 'week') {
      const weekFromNow = new Date(today);
      weekFromNow.setDate(weekFromNow.getDate() + 7);
      filtered = filtered.filter(booking => {
        const checkIn = new Date(booking.check_in_date);
        return checkIn >= today && checkIn <= weekFromNow;
      });
    } else if (dateFilter === 'month') {
      const monthFromNow = new Date(today);
      monthFromNow.setMonth(monthFromNow.getMonth() + 1);
      filtered = filtered.filter(booking => {
        const checkIn = new Date(booking.check_in_date);
        return checkIn >= today && checkIn <= monthFromNow;
      });
    } else if (dateFilter === 'custom' && customStartDate && customEndDate) {
      const start = new Date(customStartDate);
      const end = new Date(customEndDate);
      filtered = filtered.filter(booking => {
        const checkIn = new Date(booking.check_in_date);
        return checkIn >= start && checkIn <= end;
      });
    }

    // Sorting - cancelled bookings always go to the bottom
    filtered.sort((a, b) => {
      // First, push cancelled bookings to the bottom
      const aCancelled = a.status === 'cancelled';
      const bCancelled = b.status === 'cancelled';
      if (aCancelled !== bCancelled) {
        return aCancelled ? 1 : -1;
      }

      // Then apply normal sorting
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'check_in_date':
          aValue = new Date(a.check_in_date).getTime();
          bValue = new Date(b.check_in_date).getTime();
          break;
        case 'check_out_date':
          aValue = new Date(a.check_out_date).getTime();
          bValue = new Date(b.check_out_date).getTime();
          break;
        case 'guest_name':
          aValue = a.guest_name.toLowerCase();
          bValue = b.guest_name.toLowerCase();
          break;
        case 'room_number':
          aValue = a.room_number.toLowerCase();
          bValue = b.room_number.toLowerCase();
          break;
        case 'status':
          aValue = a.status.toLowerCase();
          bValue = b.status.toLowerCase();
          break;
        case 'folio_number':
          aValue = a.folio_number?.toLowerCase() || '';
          bValue = b.folio_number?.toLowerCase() || '';
          break;
        default:
          aValue = a.check_in_date;
          bValue = b.check_in_date;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [bookings, searchQuery, statusFilter, dateFilter, customStartDate, customEndDate, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSortField('check_in_date');
    setSortOrder('desc');
  };

  // State for rooms available for selected dates
  const [availableRoomsForDates, setAvailableRoomsForDates] = useState<Room[]>([]);
  const [loadingAvailableRooms, setLoadingAvailableRooms] = useState(false);

  // Fetch available rooms when dates change
  useEffect(() => {
    const fetchAvailableRooms = async () => {
      if (checkInDate && checkOutDate && createDialogOpen) {
        try {
          setLoadingAvailableRooms(true);
          const availableRooms = await HotelAPIService.getAvailableRoomsForDates(checkInDate, checkOutDate);
          setAvailableRoomsForDates(availableRooms);
          // Clear selected room if it's no longer available
          if (selectedRoomId && !availableRooms.find(r => String(r.id) === selectedRoomId)) {
            setSelectedRoomId('');
          }
        } catch (err) {
          console.error('Failed to fetch available rooms:', err);
          // Fall back to showing all available rooms
          setAvailableRoomsForDates(rooms.filter(room => room.available));
        } finally {
          setLoadingAvailableRooms(false);
        }
      } else if (!checkInDate || !checkOutDate) {
        // Reset to all available rooms when dates are cleared
        setAvailableRoomsForDates(rooms.filter(room => room.available));
      }
    };

    fetchAvailableRooms();
  }, [checkInDate, checkOutDate, createDialogOpen, rooms]);

  // Use date-filtered rooms if dates are set, otherwise use all available rooms
  const availableRooms = (checkInDate && checkOutDate) ? availableRoomsForDates : rooms.filter(room => room.available);

  const handleEditBooking = (booking: BookingWithDetails) => {
    setEditingBooking(booking);
    setEditFormData({
      status: booking.status,
      payment_status: booking.payment_status || 'unpaid',
      check_in_date: booking.check_in_date.split('T')[0],
      check_out_date: booking.check_out_date.split('T')[0],
      post_type: booking.post_type || 'normal_stay',
      rate_code: booking.rate_code || 'RACK',
      deposit_paid: booking.deposit_paid || false,
    });
    setEditDialogOpen(true);
  };

  const handleUpdateBooking = async () => {
    if (!editingBooking) return;

    try {
      setUpdating(true);
      await HotelAPIService.updateBooking(editingBooking.id, editFormData);
      setSnackbarMessage('Booking updated successfully!');
      setSnackbarOpen(true);
      setEditDialogOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update booking');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteBooking = (booking: BookingWithDetails) => {
    setDeletingBooking(booking);
    setCancellationReason('');
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingBooking) return;

    try {
      setDeleting(true);
      await HotelAPIService.cancelBooking({
        booking_id: deletingBooking.id,
        reason: cancellationReason || 'Cancelled by admin'
      });
      setSnackbarMessage('Booking cancelled successfully!');
      setSnackbarOpen(true);
      setDeleteDialogOpen(false);
      setDeletingBooking(null);
      setCancellationReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel booking');
    } finally {
      setDeleting(false);
    }
  };

  // Complimentary handlers
  const handleMarkComplimentary = (booking: BookingWithDetails) => {
    setComplimentaryBooking(booking);
    setComplimentaryReason('');
    // Initialize dates to the full booking range
    const checkIn = booking.check_in_date.split('T')[0];
    const checkOut = booking.check_out_date.split('T')[0];
    setComplimentaryStartDate(checkIn);
    setComplimentaryEndDate(checkOut);
    setComplimentaryDialogOpen(true);
  };

  // Helper functions for complimentary preview calculations
  const calculateTotalNights = () => {
    if (!complimentaryBooking) return 0;
    const checkIn = new Date(complimentaryBooking.check_in_date);
    const checkOut = new Date(complimentaryBooking.check_out_date);
    return Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  };

  const calculateComplimentaryNights = () => {
    if (!complimentaryStartDate || !complimentaryEndDate) return 0;
    const start = new Date(complimentaryStartDate);
    const end = new Date(complimentaryEndDate);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  };

  const calculatePaidNights = () => {
    return calculateTotalNights() - calculateComplimentaryNights();
  };

  const calculateNewTotal = () => {
    if (!complimentaryBooking) return '0.00';
    const totalNights = calculateTotalNights();
    if (totalNights === 0) return '0.00';
    const paidNights = calculatePaidNights();
    const pricePerNight = Number(complimentaryBooking.total_amount) / totalNights;
    return (paidNights * pricePerNight).toFixed(2);
  };

  const handleConfirmComplimentary = async () => {
    if (!complimentaryBooking || !complimentaryStartDate || !complimentaryEndDate) return;

    try {
      setMarkingComplimentary(true);
      const result = await HotelAPIService.markBookingComplimentary(
        complimentaryBooking.id,
        complimentaryReason || 'Marked as complimentary',
        complimentaryStartDate,
        complimentaryEndDate
      );

      const statusText = result.status === 'fully_complimentary'
        ? 'fully complimentary'
        : 'partially complimentary';

      setSnackbarMessage(
        `Booking marked as ${statusText}! ${result.complimentary_nights} of ${result.total_nights} nights are complimentary. ` +
        `New total: ${formatCurrency(Number(result.new_total))}`
      );
      setSnackbarOpen(true);
      setComplimentaryDialogOpen(false);
      setComplimentaryBooking(null);
      setComplimentaryReason('');
      setComplimentaryStartDate('');
      setComplimentaryEndDate('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to mark booking as complimentary');
    } finally {
      setMarkingComplimentary(false);
    }
  };

  // Payment status handlers
  const handleUpdatePaymentStatus = (booking: BookingWithDetails) => {
    setPaymentBooking(booking);
    setNewPaymentStatus(booking.payment_status || 'unpaid');
    setPaymentNote('');
    setPaymentDialogOpen(true);
  };

  const handleConfirmPaymentUpdate = async () => {
    if (!paymentBooking || !newPaymentStatus) return;

    try {
      setUpdatingPayment(true);
      const roomCardDeposit = getHotelSettings().room_card_deposit;
      await HotelAPIService.updateBooking(paymentBooking.id, {
        payment_status: newPaymentStatus,
        payment_note: paymentNote.trim() || undefined,
        deposit_paid: newPaymentStatus === 'paid',
        deposit_amount: newPaymentStatus === 'paid' ? roomCardDeposit : undefined,
      });

      setSnackbarMessage(`Deposit collected. Status updated to "${getPaymentStatusText(newPaymentStatus)}"`);
      setSnackbarOpen(true);
      setPaymentDialogOpen(false);
      setPaymentBooking(null);
      setNewPaymentStatus('');
      setPaymentNote('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to collect deposit');
    } finally {
      setUpdatingPayment(false);
    }
  };

  const handleCreateBooking = async () => {
    if (!selectedGuestId || !selectedRoomId || !checkInDate || !checkOutDate) return;

    // Validate dates
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    checkIn.setHours(0, 0, 0, 0);
    checkOut.setHours(0, 0, 0, 0);

    if (checkOut <= checkIn) {
      setError('Check-out date must be after check-in date. Please select a check-out date that is at least 1 day after check-in.');
      return;
    }

    // For online bookings, folio number is required
    if (bookingSource === 'online' && !folioNumber.trim()) {
      setError('Booking/Folio number is required for online bookings');
      return;
    }

    try {
      setCreating(true);
      await HotelAPIService.createBooking({
        guest_id: selectedGuestId,
        room_id: selectedRoomId,
        check_in_date: new Date(checkInDate).toISOString(),
        check_out_date: new Date(checkOutDate).toISOString(),
        post_type: postType,
        rate_code: rateCode,
        source: bookingSource,
        booking_number: bookingSource === 'online' ? folioNumber.trim() : undefined
      });

      setSnackbarMessage('Booking created successfully!');
      setSnackbarOpen(true);

      // Reset form and close dialog
      resetBookingForm();
      setCreateDialogOpen(false);

      // Reload data
      await loadData();

    } catch (err: any) {
      // Show the actual API error message if available
      const errorMessage = err?.message || err?.error || 'Failed to create booking';
      setError(errorMessage);
    } finally {
      setCreating(false);
    }
  };

  const resetBookingForm = () => {
    setSelectedGuestId(null);
    setSelectedRoomId('');
    setCheckInDate('');
    setCheckOutDate('');
    setPostType('normal_stay');
    setRateCode('RACK');
    setBookingSource('walk_in');
    setFolioNumber('');
  };

  const isFormValid = selectedGuestId && selectedRoomId && checkInDate && checkOutDate;

  // Check-in functions
  const handleCheckIn = async (bookingId: string) => {
    try {
      // Find the booking
      const booking = bookings.find(b => b.id === bookingId);
      if (!booking) {
        setError('Booking not found');
        return;
      }

      // Load guest data
      const guest = await HotelAPIService.getGuest(booking.guest_id);

      // Convert BookingWithDetails to Booking format
      const bookingData: any = {
        ...booking,
        room_type: booking.room_type || '',
      };

      setCheckinBooking(bookingData);
      setCheckinGuest(guest);
      setShowCheckinModal(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load check-in data');
    }
  };

  // Check-out functions
  const handleCheckOut = (booking: BookingWithDetails) => {
    setCheckoutBooking(booking);
    setShowCheckoutModal(true);
  };

  const handleConfirmCheckout = async () => {
    if (!checkoutBooking) return;

    try {
      await HotelAPIService.updateBooking(checkoutBooking.id, { status: 'checked_out' });
      setSnackbarMessage('Guest checked out successfully!');
      setSnackbarOpen(true);
      setShowCheckoutModal(false);
      setCheckoutBooking(null);
      await loadData();
    } catch (err: any) {
      throw err; // Let the modal handle the error display
    }
  };

  // Helper function to determine if a booking can be checked in/out
  const canCheckIn = (booking: BookingWithDetails) => {
    const status = booking.status;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkInDate = new Date(booking.check_in_date);
    checkInDate.setHours(0, 0, 0, 0);

    // Allow check-in for confirmed/pending bookings on or after check-in date
    return (status === 'confirmed' || status === 'pending') && today >= checkInDate;
  };

  const canCheckOut = (booking: BookingWithDetails) => {
    const status = booking.status;
    return status === 'checked_in';
  };

  // Can delete/cancel booking only if not checked in, checked out, or already cancelled
  const canDelete = (booking: BookingWithDetails) => {
    const status = booking.status;
    return status === 'confirmed' || status === 'pending';
  };

  // Can mark as complimentary only if confirmed/pending (not checked in yet)
  const canMarkComplimentary = (booking: BookingWithDetails) => {
    const status = booking.status;
    return (status === 'confirmed' || status === 'pending') && !booking.is_complimentary;
  };

  // Statistics
  const stats = useMemo(() => {
    const confirmedBookings = bookings.filter(b => b.status === 'confirmed' || b.status === 'pending').length;
    const checkedInBookings = bookings.filter(b => b.status === 'checked_in').length;
    const todayCheckIns = bookings.filter(b => {
      const checkIn = new Date(b.check_in_date);
      const today = new Date();
      return checkIn.toDateString() === today.toDateString();
    }).length;

    return {
      total: bookings.length,
      confirmed: confirmedBookings,
      checkedIn: checkedInBookings,
      todayCheckIns,
      availableRooms: availableRooms.length,
      totalGuests: guests.length,
    };
  }, [bookings, availableRooms, guests]);

  if (loading) {
    return (
      <MuiBox sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </MuiBox>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Booking Management
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadData}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<BookIcon />}
            onClick={() => setCreateDialogOpen(true)}
            disabled={availableRooms.length === 0 || guests.length === 0}
          >
            New Booking
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={loadData}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Statistics Cards */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <BookIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">Total Bookings</Typography>
              </Box>
              <Typography variant="h4" color="primary">
                {stats.total}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <CheckCircleIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">Checked In</Typography>
              </Box>
              <Typography variant="h4" color="success.main">
                {stats.checkedIn}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <TodayIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">Today Check-ins</Typography>
              </Box>
              <Typography variant="h4" color="warning.main">
                {stats.todayCheckIns}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <HotelIcon color="info" sx={{ mr: 1 }} />
                <Typography variant="h6">Available Rooms</Typography>
              </Box>
              <Typography variant="h4" color="info.main">
                {stats.availableRooms}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters and Search */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <FilterIcon color="action" />
          <Typography variant="h6">Filters & Search</Typography>
        </Box>

        <Grid container spacing={2}>
          {/* Search */}
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search by guest, room, folio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>

          {/* Status Filter */}
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="all">All Status</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="confirmed">Confirmed</MenuItem>
                <MenuItem value="checked_in">Checked In</MenuItem>
                <MenuItem value="checked_out">Checked Out</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
                <MenuItem value="no_show">No Show</MenuItem>
                <MenuItem value="released">Released</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Date Filter Buttons */}
          <Grid item xs={12} sm={6} md={4}>
            <ToggleButtonGroup
              value={dateFilter}
              exclusive
              onChange={(e, newValue) => newValue && setDateFilter(newValue)}
              size="small"
              fullWidth
            >
              <ToggleButton value="all">All</ToggleButton>
              <ToggleButton value="today">Today</ToggleButton>
              <ToggleButton value="week">Week</ToggleButton>
              <ToggleButton value="month">Month</ToggleButton>
              <ToggleButton value="custom">Custom</ToggleButton>
            </ToggleButtonGroup>
          </Grid>

          {/* Clear Filters */}
          <Grid item xs={12} md={2}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<ClearIcon />}
              onClick={clearFilters}
              size="small"
            >
              Clear Filters
            </Button>
          </Grid>

          {/* Custom Date Range */}
          {dateFilter === 'custom' && (
            <>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="Start Date"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="End Date"
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </>
          )}
        </Grid>

        {/* Active Filters Info */}
        <Box mt={2} display="flex" gap={1} flexWrap="wrap">
          {searchQuery && (
            <Chip
              size="small"
              label={`Search: ${searchQuery}`}
              onDelete={() => setSearchQuery('')}
            />
          )}
          {statusFilter !== 'all' && (
            <Chip
              size="small"
              label={`Status: ${statusFilter}`}
              onDelete={() => setStatusFilter('all')}
            />
          )}
          {dateFilter !== 'all' && (
            <Chip
              size="small"
              label={`Date: ${dateFilter}`}
              onDelete={() => setDateFilter('all')}
            />
          )}
          {filteredAndSortedBookings.length !== bookings.length && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto', alignSelf: 'center' }}>
              Showing {filteredAndSortedBookings.length} of {bookings.length} bookings
            </Typography>
          )}
        </Box>
      </Card>

      {/* Bookings Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'folio_number'}
                  direction={sortField === 'folio_number' ? sortOrder : 'asc'}
                  onClick={() => handleSort('folio_number')}
                >
                  <strong>Folio #</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'guest_name'}
                  direction={sortField === 'guest_name' ? sortOrder : 'asc'}
                  onClick={() => handleSort('guest_name')}
                >
                  <strong>Guest Name</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'room_number'}
                  direction={sortField === 'room_number' ? sortOrder : 'asc'}
                  onClick={() => handleSort('room_number')}
                >
                  <strong>Room</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'check_in_date'}
                  direction={sortField === 'check_in_date' ? sortOrder : 'asc'}
                  onClick={() => handleSort('check_in_date')}
                >
                  <strong>Check-in</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'check_out_date'}
                  direction={sortField === 'check_out_date' ? sortOrder : 'asc'}
                  onClick={() => handleSort('check_out_date')}
                >
                  <strong>Check-out</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell><strong>Post Type</strong></TableCell>
              <TableCell><strong>Rate</strong></TableCell>
              <TableCell><strong>Complimentary</strong></TableCell>
              <TableCell><strong>Payment</strong></TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'status'}
                  direction={sortField === 'status' ? sortOrder : 'asc'}
                  onClick={() => handleSort('status')}
                >
                  <strong>Status</strong>
                </TableSortLabel>
              </TableCell>
              {isAdmin && <TableCell><strong>Actions</strong></TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredAndSortedBookings.map((booking) => (
              <TableRow
                key={booking.id}
                hover
                sx={{
                  opacity: booking.status === 'cancelled' ? 0.6 : 1,
                  bgcolor: booking.status === 'cancelled' ? 'action.hover' : 'inherit',
                  textDecoration: booking.status === 'cancelled' ? 'line-through' : 'none',
                  '& td': {
                    textDecoration: booking.status === 'cancelled' ? 'line-through' : 'none',
                  }
                }}
              >
                <TableCell>{booking.folio_number || '-'}</TableCell>
                <TableCell>{booking.guest_name}</TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2">{booking.room_type}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Room {booking.room_number}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>{booking.formatted_check_in || booking.check_in_date.split('T')[0]}</TableCell>
                <TableCell>{booking.formatted_check_out || booking.check_out_date.split('T')[0]}</TableCell>
                <TableCell>
                  {booking.post_type === 'same_day' ? (
                    <Chip label="Same Day" size="small" color="warning" />
                  ) : (
                    <Chip label="Normal Stay" size="small" color="default" />
                  )}
                </TableCell>
                <TableCell>{booking.rate_code || 'RACK'}</TableCell>
                <TableCell>
                  {booking.is_complimentary ? (
                    <Tooltip
                      title={
                        <Box>
                          <Typography variant="caption" display="block">
                            <strong>Reason:</strong> {booking.complimentary_reason || 'N/A'}
                          </Typography>
                          {booking.complimentary_start_date && booking.complimentary_end_date && (
                            <Typography variant="caption" display="block">
                              <strong>Dates:</strong> {booking.complimentary_start_date.split('T')[0]} to {booking.complimentary_end_date.split('T')[0]}
                            </Typography>
                          )}
                          {booking.original_total_amount && (
                            <Typography variant="caption" display="block">
                              <strong>Original:</strong> {formatCurrency(Number(booking.original_total_amount))}
                            </Typography>
                          )}
                        </Box>
                      }
                    >
                      <Chip
                        icon={<ComplimentaryIcon />}
                        label={`${booking.complimentary_nights || 0} nights`}
                        color="secondary"
                        size="small"
                      />
                    </Tooltip>
                  ) : (
                    <Typography variant="caption" color="text.secondary">-</Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    label={getPaymentStatusText(booking.payment_status)}
                    color={getPaymentStatusColor(booking.payment_status)}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={getBookingStatusText(booking.status)}
                    color={getBookingStatusColor(booking.status)}
                    size="small"
                  />
                </TableCell>
                {isAdmin && (
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      {canCheckIn(booking) && (
                        <Tooltip title="Check In">
                          <IconButton
                            size="small"
                            onClick={() => handleCheckIn(booking.id)}
                            color="success"
                          >
                            <CheckCircleIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {canCheckOut(booking) && (
                        <Tooltip title="Check Out">
                          <IconButton
                            size="small"
                            onClick={() => handleCheckOut(booking)}
                            color="warning"
                          >
                            <CheckOutIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Edit Booking">
                        <IconButton
                          size="small"
                          onClick={() => handleEditBooking(booking)}
                          color="primary"
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Collect Room Payment">
                        <IconButton
                          size="small"
                          onClick={() => handleUpdatePaymentStatus(booking)}
                          color="info"
                        >
                          <PaymentIcon />
                        </IconButton>
                      </Tooltip>
                      {canDelete(booking) && (
                        <Tooltip title="Cancel Booking">
                          <IconButton
                            size="small"
                            onClick={() => handleDeleteBooking(booking)}
                            color="error"
                          >
                            <CancelIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {canMarkComplimentary(booking) && (
                        <Tooltip title="Mark as Complimentary">
                          <IconButton
                            size="small"
                            onClick={() => handleMarkComplimentary(booking)}
                            color="secondary"
                          >
                            <ComplimentaryIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {filteredAndSortedBookings.length === 0 && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            {bookings.length === 0 ? 'No bookings yet' : 'No bookings match your filters'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {bookings.length === 0
              ? 'Create your first booking using the "New Booking" button above'
              : 'Try adjusting your search or filter criteria'
            }
          </Typography>
        </Box>
      )}

      {/* Create Booking Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Booking</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Booking Source Toggle */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Booking Type</Typography>
              <ToggleButtonGroup
                value={bookingSource}
                exclusive
                onChange={(e, value) => {
                  if (value) {
                    setBookingSource(value);
                    if (value === 'walk_in') {
                      setFolioNumber(''); // Clear folio for walk-in
                    }
                  }
                }}
                fullWidth
                size="small"
              >
                <ToggleButton value="walk_in" sx={{ flex: 1 }}>
                  Walk-in (Auto Folio)
                </ToggleButton>
                <ToggleButton value="online" sx={{ flex: 1 }}>
                  Online Booking (Manual Folio)
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {/* Folio/Booking Number - only for online bookings */}
            {bookingSource === 'online' && (
              <TextField
                fullWidth
                label="Booking/Folio Number"
                value={folioNumber}
                onChange={(e) => setFolioNumber(e.target.value)}
                placeholder="Enter booking reference from OTA..."
                required
                helperText="Enter the booking reference number from the online travel agent (e.g., Booking.com, Agoda)"
              />
            )}

            <Autocomplete
              fullWidth
              options={guests}
              getOptionLabel={(option) => `${option.full_name} (${option.email})`}
              value={guests.find(g => g.id === selectedGuestId) || null}
              onChange={(event, newValue) => {
                setSelectedGuestId(newValue?.id || null);
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Select Guest"
                  placeholder="Search guests..."
                />
              )}
              isOptionEqualToValue={(option, value) => option.id === value.id}
            />

            <Box display="flex" gap={2}>
              <TextField
                fullWidth
                label="Check-in Date"
                type="date"
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                required
              />
              <TextField
                fullWidth
                label="Check-out Date"
                type="date"
                value={checkOutDate}
                onChange={(e) => setCheckOutDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: checkInDate }}
                required
              />
            </Box>

            <Autocomplete
              fullWidth
              options={availableRooms}
              loading={loadingAvailableRooms}
              getOptionLabel={(option) => `Room ${option.room_number} - ${option.room_type} (${formatCurrency(Number(option.price_per_night))}/night)`}
              value={availableRooms.find(r => String(r.id) === selectedRoomId) || null}
              onChange={(event, newValue) => {
                setSelectedRoomId(newValue ? String(newValue.id) : '');
              }}
              noOptionsText={
                !checkInDate || !checkOutDate
                  ? "Select dates first to see available rooms"
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

            <Box display="flex" gap={2}>
              <TextField
                select
                fullWidth
                label="Post Type"
                value={postType}
                onChange={(e) => setPostType(e.target.value as 'normal_stay' | 'same_day')}
              >
                <MenuItem value="normal_stay">Normal Stay</MenuItem>
                <MenuItem value="same_day">Same Day</MenuItem>
              </TextField>

              <TextField
                select
                fullWidth
                label="Rate Code"
                value={rateCode}
                onChange={(e) => setRateCode(e.target.value)}
              >
                <MenuItem value="RACK">RACK (Standard Rate)</MenuItem>
                <MenuItem value="OVR">OVR (Override Rate)</MenuItem>
              </TextField>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateBooking}
            variant="contained"
            disabled={creating || !isFormValid}
          >
            {creating ? 'Creating...' : 'Create Booking'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Booking Dialog (Admin Only) */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Booking #{editingBooking?.folio_number || editingBooking?.id.toString().substring(0, 8)}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Check-In Date"
                type="date"
                value={editFormData.check_in_date || ''}
                onChange={(e) => setEditFormData({ ...editFormData, check_in_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Check-Out Date"
                type="date"
                value={editFormData.check_out_date || ''}
                onChange={(e) => setEditFormData({ ...editFormData, check_out_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Status"
                value={editFormData.status || 'pending'}
                onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}

              >
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="confirmed">Confirmed</MenuItem>
                <MenuItem value="checked_in">Checked In</MenuItem>
                <MenuItem value="auto_checked_in">Auto Checked In</MenuItem>
                <MenuItem value="checked_out">Checked Out</MenuItem>
                <MenuItem value="late_checkout">Late Checkout</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
                <MenuItem value="no_show">No Show</MenuItem>
                <MenuItem value="released">Released</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Post Type"
                value={editFormData.post_type || 'normal_stay'}
                onChange={(e) => setEditFormData({ ...editFormData, post_type: e.target.value })}
              >
                <MenuItem value="normal_stay">Normal Stay</MenuItem>
                <MenuItem value="same_day">Same Day</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Payment Status"
                value={editFormData.payment_status || 'unpaid'}
                onChange={(e) => setEditFormData({ ...editFormData, payment_status: e.target.value })}
              >
                <MenuItem value="unpaid">Unpaid</MenuItem>
                <MenuItem value="unpaid_deposit">Unpaid Deposit</MenuItem>
                <MenuItem value="paid_rate">Paid Rate</MenuItem>
                <MenuItem value="partial">Partial</MenuItem>
                <MenuItem value="paid">Paid</MenuItem>
                <MenuItem value="refunded">Refunded</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Rate Code"
                value={editFormData.rate_code || 'RACK'}
                onChange={(e) => setEditFormData({ ...editFormData, rate_code: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info">
                Guest: <strong>{editingBooking?.guest_name}</strong><br />
                Room: <strong>{editingBooking?.room_type} - Room {editingBooking?.room_number}</strong>
              </Alert>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateBooking} variant="contained" disabled={updating}>
            {updating ? 'Updating...' : 'Update Booking'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete/Cancel Booking Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cancel Booking</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to cancel this booking?
          </Alert>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2"><strong>Guest:</strong> {deletingBooking?.guest_name}</Typography>
            <Typography variant="body2"><strong>Room:</strong> {deletingBooking?.room_type} - Room {deletingBooking?.room_number}</Typography>
            <Typography variant="body2"><strong>Check-in:</strong> {deletingBooking?.formatted_check_in || deletingBooking?.check_in_date}</Typography>
            <Typography variant="body2"><strong>Check-out:</strong> {deletingBooking?.formatted_check_out || deletingBooking?.check_out_date}</Typography>
          </Box>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Cancellation Reason (Optional)"
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
            placeholder="Enter reason for cancellation..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Keep Booking</Button>
          <Button onClick={handleConfirmDelete} variant="contained" color="error" disabled={deleting}>
            {deleting ? 'Cancelling...' : 'Cancel Booking'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Mark as Complimentary Dialog */}
      <Dialog open={complimentaryDialogOpen} onClose={() => setComplimentaryDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Mark Booking as Complimentary</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Specify the date range for complimentary nights. The guest will not be charged for these dates.
          </Alert>

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2"><strong>Guest:</strong> {complimentaryBooking?.guest_name}</Typography>
            <Typography variant="body2"><strong>Room:</strong> {complimentaryBooking?.room_type} - Room {complimentaryBooking?.room_number}</Typography>
            <Typography variant="body2"><strong>Booking Period:</strong> {complimentaryBooking?.check_in_date?.split('T')[0]} to {complimentaryBooking?.check_out_date?.split('T')[0]}</Typography>
            <Typography variant="body2"><strong>Original Total:</strong> {formatCurrency(Number(complimentaryBooking?.total_amount || 0))}</Typography>
          </Box>

          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Complimentary Start Date"
                type="date"
                value={complimentaryStartDate}
                onChange={(e) => setComplimentaryStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{
                  min: complimentaryBooking?.check_in_date?.split('T')[0],
                  max: complimentaryBooking?.check_out_date?.split('T')[0]
                }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                label="Complimentary End Date"
                type="date"
                value={complimentaryEndDate}
                onChange={(e) => setComplimentaryEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{
                  min: complimentaryStartDate || complimentaryBooking?.check_in_date?.split('T')[0],
                  max: complimentaryBooking?.check_out_date?.split('T')[0]
                }}
              />
            </Grid>
          </Grid>

          {/* Preview calculation */}
          {complimentaryStartDate && complimentaryEndDate && complimentaryBooking && calculateComplimentaryNights() > 0 && (
            <Alert severity="success" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Preview:</strong> {calculateComplimentaryNights()} of {calculateTotalNights()} nights will be complimentary.
                {calculatePaidNights() > 0 ? (
                  <> New total will be approximately {formatCurrency(Number(calculateNewTotal()))}.</>
                ) : (
                  <> This will be fully complimentary (no charge).</>
                )}
              </Typography>
            </Alert>
          )}

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Reason for Complimentary Stay"
            value={complimentaryReason}
            onChange={(e) => setComplimentaryReason(e.target.value)}
            placeholder="e.g., VIP guest, service recovery, management approval..."
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComplimentaryDialogOpen(false)} disabled={markingComplimentary}>Cancel</Button>
          <Button
            onClick={handleConfirmComplimentary}
            variant="contained"
            color="primary"
            disabled={!complimentaryReason.trim() || !complimentaryStartDate || !complimentaryEndDate || calculateComplimentaryNights() <= 0 || markingComplimentary}
          >
            {markingComplimentary ? 'Processing...' : 'Mark as Complimentary'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Collect Deposit Dialog */}
      <Dialog
        open={paymentDialogOpen}
        onClose={() => {
          setPaymentDialogOpen(false);
          setPaymentBooking(null);
          setNewPaymentStatus('');
          setPaymentNote('');
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Collect Deposit</DialogTitle>
        <DialogContent>
          {paymentBooking && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Booking: {paymentBooking.booking_number || paymentBooking.folio_number || `#${paymentBooking.id}`}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Guest: {paymentBooking.guest_name}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Room: {paymentBooking.room_number}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }} gutterBottom>
                Room Card Deposit: {formatCurrency(getHotelSettings().room_card_deposit)}
              </Typography>
              {paymentBooking.deposit_amount && Number(paymentBooking.deposit_amount) > 0 && (
                <Typography variant="body2" color="success.main" gutterBottom>
                  Deposit Already Paid: {formatCurrency(Number(paymentBooking.deposit_amount))}
                </Typography>
              )}
              <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Current Status:
                </Typography>
                <Chip
                  label={getPaymentStatusText(paymentBooking.payment_status)}
                  color={getPaymentStatusColor(paymentBooking.payment_status)}
                  size="small"
                />
              </Box>

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Payment Status</InputLabel>
                <Select
                  value={newPaymentStatus}
                  label="Payment Status"
                  onChange={(e) => setNewPaymentStatus(e.target.value)}
                >
                  <MenuItem value="unpaid">Unpaid</MenuItem>
                  <MenuItem value="partial">Partial Payment</MenuItem>
                  <MenuItem value="paid">Fully Paid</MenuItem>
                  <MenuItem value="refunded">Refunded</MenuItem>
                </Select>
              </FormControl>

              <TextField
                fullWidth
                multiline
                rows={3}
                label="Payment Note (Optional)"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder="e.g., Paid via cash/card, Receipt #12345, Remaining balance RM100..."
                helperText="Add a note about this payment"
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setPaymentDialogOpen(false);
            setPaymentBooking(null);
            setNewPaymentStatus('');
            setPaymentNote('');
          }}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmPaymentUpdate}
            variant="contained"
            color="primary"
            disabled={!newPaymentStatus || updatingPayment}
          >
            {updatingPayment ? 'Processing...' : 'Collect Deposit'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity="success">
          {snackbarMessage}
        </Alert>
      </Snackbar>

      {/* Checkout Invoice Modal */}
      <CheckoutInvoiceModal
        open={showCheckoutModal}
        onClose={() => {
          setShowCheckoutModal(false);
          setCheckoutBooking(null);
        }}
        booking={checkoutBooking}
        onConfirmCheckout={handleConfirmCheckout}
      />

      {/* Enhanced Check-In Modal */}
      <EnhancedCheckInModal
        open={showCheckinModal}
        onClose={() => {
          setShowCheckinModal(false);
          setCheckinBooking(null);
          setCheckinGuest(null);
        }}
        booking={checkinBooking}
        guest={checkinGuest}
        onCheckInSuccess={() => {
          setShowCheckinModal(false);
          setCheckinBooking(null);
          setCheckinGuest(null);
          setSnackbarMessage('Guest checked in successfully!');
          setSnackbarOpen(true);
          loadData();
        }}
      />
    </Box>
  );
};

export default BookingsPage;
