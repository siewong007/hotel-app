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
  IconButton,
  Grid,
  FormControl,
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
  Hotel as HotelIcon,
  Edit as EditIcon,
  CheckCircle as CheckCircleIcon,
  ExitToApp as CheckOutIcon,
  Cancel as CancelIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Today as TodayIcon,
  Clear as ClearIcon,
  CardGiftcard as ComplimentaryIcon,
  Payment as PaymentIcon,
  Receipt as ReceiptIcon,
  Block as VoidIcon,
  MoneyOff as MoneyOffIcon,
  Login as LoginIcon,
  Restore as RestoreIcon,
} from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { HotelAPIService } from '../../../api';

import { BookingWithDetails, Room, Guest, RoomType } from '../../../types';
import { getBookingStatusColor, getBookingStatusText, getPaymentStatusColor, getPaymentStatusText } from '../../../utils/bookingUtils';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import CheckoutInvoiceModal from '../../invoices/components/CheckoutInvoiceModal';
import UnifiedBookingModal from '../../rooms/components/UnifiedBookingModal';
import { getHotelSettings } from '../../../utils/hotelSettings';

type SortField = 'check_in_date' | 'check_out_date' | 'guest_name' | 'room_number' | 'status' | 'folio_number';
type SortOrder = 'asc' | 'desc';
type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom' | 'date_search';

const BookingsPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const PAYMENT_METHODS = getHotelSettings().payment_methods;
  const isAdmin = hasRole('admin') || hasRole('receptionist') || hasRole('manager') || hasPermission('bookings:update');

  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [checkoutBooking, setCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkinBooking, setCheckinBooking] = useState<BookingWithDetails | null>(null);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [processingCheckIn, setProcessingCheckIn] = useState(false);
  const [ciPaymentChoice, setCiPaymentChoice] = useState<'pay_now' | 'pay_later'>('pay_later');
  const [ciPaymentMethod, setCiPaymentMethod] = useState('Cash');
  const [ciAmountPaid, setCiAmountPaid] = useState(0);
  const [ciDepositChoice, setCiDepositChoice] = useState<'receive' | 'waive'>('receive');
  const [ciDepositAmount, setCiDepositAmount] = useState(0);
  const [ciDepositMethod, setCiDepositMethod] = useState('Cash');
  const [ciWaiveReason, setCiWaiveReason] = useState('');
  const [invoiceBooking, setInvoiceBooking] = useState<BookingWithDetails | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
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
  const [searchDate, setSearchDate] = useState('');

  // Create booking dialog (using UnifiedBookingModal)
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Edit booking dialog (admin only)
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  const [editRoomTypeConfig, setEditRoomTypeConfig] = useState<RoomType | null>(null);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [updating, setUpdating] = useState(false);

  // Delete booking dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingBooking, setDeletingBooking] = useState<BookingWithDetails | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Void booking dialog
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingBooking, setVoidingBooking] = useState<BookingWithDetails | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Reactivate booking dialog
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [reactivatingBooking, setReactivatingBooking] = useState<BookingWithDetails | null>(null);
  const [reactivating, setReactivating] = useState(false);

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
        booking.booking_number?.toLowerCase().includes(query) ||
        booking.folio_number?.toLowerCase().includes(query) ||
        String(booking.id).toLowerCase().includes(query)
      );
    }

    // Status filter - hide voided by default unless explicitly selected
    if (statusFilter === 'voided') {
      filtered = filtered.filter(booking => booking.status === 'voided');
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter(booking => booking.status === statusFilter);
    } else {
      // 'all' filter still excludes voided bookings
      filtered = filtered.filter(booking => booking.status !== 'voided');
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
    } else if (dateFilter === 'date_search' && searchDate) {
      const target = searchDate; // YYYY-MM-DD
      filtered = filtered.filter(booking => {
        const checkIn = booking.check_in_date.split('T')[0];
        const checkOut = booking.check_out_date.split('T')[0];
        return checkIn === target || checkOut === target;
      });
    }

    // Sorting - voided bookings always go to the bottom
    filtered.sort((a, b) => {
      // First, push voided bookings to the bottom
      const aCancelled = a.status === 'voided';
      const bCancelled = b.status === 'voided';
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
          aValue = (a.booking_number || a.folio_number || '').toLowerCase();
          bValue = (b.booking_number || b.folio_number || '').toLowerCase();
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
  }, [bookings, searchQuery, statusFilter, dateFilter, customStartDate, customEndDate, searchDate, sortField, sortOrder]);

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
    setSearchDate('');
    setSortField('check_in_date');
    setSortOrder('desc');
  };

  const handleEditBooking = (booking: BookingWithDetails) => {
    setEditingBooking(booking);

    // Get the booking's room rate (price_per_night) - this contains the override if one was set
    const bookingRate = typeof booking.price_per_night === 'string'
      ? parseFloat(booking.price_per_night) || 0
      : booking.price_per_night || 0;

    const extraBedCount = booking.extra_bed_count || 0;
    const extraBedCharge = typeof booking.extra_bed_charge === 'string'
      ? parseFloat(booking.extra_bed_charge) || 0
      : booking.extra_bed_charge || 0;

    const formData = {
      status: booking.status,
      payment_status: booking.payment_status || 'unpaid',
      payment_method: booking.payment_method
        ? booking.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : '',
      source: booking.source || 'walk_in',
      check_in_date: booking.check_in_date.split('T')[0],
      check_out_date: booking.check_out_date.split('T')[0],
      post_type: booking.post_type || 'normal_stay',
      rate_code: booking.rate_code || 'RACK',
      deposit_paid: booking.deposit_paid || false,
      remarks: booking.remarks || '',
      special_requests: booking.special_requests || '',
      // Use the booking's room rate directly (this is the override rate if one was set)
      price_per_night: bookingRate,
      has_override: bookingRate > 0,
      extra_bed_count: extraBedCount,
      extra_bed_charge: extraBedCharge,
      room_id: booking.room_id,
    };
    console.log('Opening edit with payment_method:', formData.payment_method, 'rate:', bookingRate);
    setEditFormData(formData);

    // Load room type config for extra bed settings
    HotelAPIService.getAllRoomTypes().then(roomTypes => {
      const matched = roomTypes.find(rt => rt.name === booking.room_type);
      setEditRoomTypeConfig(matched || null);
    }).catch(() => setEditRoomTypeConfig(null));

    // Fetch available rooms for the booking dates (for room change dropdown)
    const isNotCheckedIn = !['checked_in', 'auto_checked_in', 'checked_out', 'completed'].includes(booking.status);
    if (isNotCheckedIn) {
      const checkIn = booking.check_in_date.split('T')[0];
      const checkOut = booking.check_out_date.split('T')[0];
      HotelAPIService.getAvailableRoomsForDates(checkIn, checkOut).then(available => {
        // Include the currently assigned room since it won't show as "available"
        const currentRoom = rooms.find(r => r.id === booking.room_id);
        if (currentRoom && !available.find(r => r.id === currentRoom.id)) {
          setAvailableRooms(sortRoomsByNumber([currentRoom, ...available]));
        } else {
          setAvailableRooms(sortRoomsByNumber(available));
        }
      }).catch(() => {
        // Fallback: show all rooms
        setAvailableRooms(sortRoomsByNumber(rooms));
      });
    }

    setEditDialogOpen(true);
  };

  const handleUpdateBooking = async () => {
    if (!editingBooking) return;

    try {
      setUpdating(true);

      // Get the original booking rate
      const originalPrice = typeof editingBooking.price_per_night === 'string'
        ? parseFloat(editingBooking.price_per_night) || 0
        : editingBooking.price_per_night || 0;

      const newPrice = editFormData.price_per_night || 0;
      const priceChanged = Math.abs(newPrice - originalPrice) > 0.01;

      // Include room_id only if it changed (compare as strings to avoid type mismatch)
      const roomChanged = editFormData.room_id && String(editFormData.room_id) !== String(editingBooking.room_id);

      const updateData = {
        ...editFormData,
        payment_method: editFormData.payment_method || null,
        // Always send room_rate_override if there's a price value
        room_rate_override: newPrice > 0 ? newPrice : undefined,
        extra_bed_count: editFormData.extra_bed_count || 0,
        extra_bed_charge: editFormData.extra_bed_charge || 0,
      };
      // Remove fields that are not valid backend fields
      delete updateData.price_per_night;
      delete updateData.has_override;
      // Only include room_id if room was changed, and send as string for backend compatibility
      if (roomChanged) {
        updateData.room_id = String(editFormData.room_id);
      } else {
        delete updateData.room_id;
      }

      await HotelAPIService.updateBooking(editingBooking.id, updateData);
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
        reason: cancellationReason || 'Voided by admin'
      });
      setSnackbarMessage('Booking voided successfully!');
      setSnackbarOpen(true);
      setDeleteDialogOpen(false);
      setDeletingBooking(null);
      setCancellationReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to void booking');
    } finally {
      setDeleting(false);
    }
  };

  const handleVoidBooking = (booking: BookingWithDetails) => {
    setVoidingBooking(booking);
    setVoidReason('');
    setVoidDialogOpen(true);
  };

  const handleConfirmVoid = async () => {
    if (!voidingBooking) return;
    try {
      setVoiding(true);
      await HotelAPIService.updateBooking(voidingBooking.id, {
        status: 'voided',
        remarks: voidReason || 'Voided by admin',
      });
      setSnackbarMessage('Booking voided successfully');
      setSnackbarOpen(true);
      setVoidDialogOpen(false);
      setVoidingBooking(null);
      setVoidReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to void booking');
    } finally {
      setVoiding(false);
    }
  };

  // Reactivate handlers
  const handleReactivateBooking = (booking: BookingWithDetails) => {
    setReactivatingBooking(booking);
    setReactivateDialogOpen(true);
  };

  const handleConfirmReactivate = async () => {
    if (!reactivatingBooking) return;
    try {
      setReactivating(true);
      await HotelAPIService.reactivateBooking(reactivatingBooking.id);
      setSnackbarMessage('Booking reactivated successfully!');
      setSnackbarOpen(true);
      setReactivateDialogOpen(false);
      setReactivatingBooking(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to reactivate booking');
    } finally {
      setReactivating(false);
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
      await HotelAPIService.updateBooking(paymentBooking.id, {
        payment_status: newPaymentStatus,
        payment_note: paymentNote.trim() || undefined,
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

  // Check-in functions
  const handleCheckIn = async (bookingId: string) => {
    try {
      const booking = bookings.find(b => b.id === bookingId);
      if (!booking) {
        setError('Booking not found');
        return;
      }
      const totalAmt = Number(booking.total_amount || 0);
      const settingsDeposit = getHotelSettings().deposit_amount;
      setCheckinBooking(booking);
      setCiPaymentChoice(booking.payment_status === 'paid' ? 'pay_now' : 'pay_later');
      setCiPaymentMethod(booking.payment_method || 'Cash');
      setCiAmountPaid(totalAmt);
      setCiDepositChoice('receive');
      setCiDepositAmount(settingsDeposit);
      setCiDepositMethod('Cash');
      setCiWaiveReason('');
      setShowCheckinModal(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load check-in data');
    }
  };

  const handleConfirmCheckIn = async () => {
    if (!checkinBooking) return;
    try {
      setProcessingCheckIn(true);
      const updateData: any = {};
      if (ciPaymentChoice === 'pay_now') {
        updateData.payment_status = 'paid';
        updateData.amount_paid = ciAmountPaid;
        updateData.payment_method = ciPaymentMethod;
      } else {
        updateData.payment_status = 'unpaid';
      }
      if (ciDepositChoice === 'receive') {
        updateData.deposit_paid = true;
        updateData.deposit_amount = ciDepositAmount;
        updateData.payment_note = `Deposit received (${ciDepositMethod})`;
      } else {
        updateData.deposit_paid = false;
        updateData.deposit_amount = 0;
        updateData.payment_note = `Deposit waived: ${ciWaiveReason}`;
      }
      await HotelAPIService.updateBooking(checkinBooking.id, updateData);
      const checkinPayload = (ciPaymentChoice === 'pay_now' && ciAmountPaid > 0)
        ? {
            payment_record: {
              amount: ciAmountPaid,
              payment_method: ciPaymentMethod,
              payment_type: 'booking',
              notes: 'Payment collected at check-in',
            },
          }
        : undefined;
      await HotelAPIService.checkInGuest(String(checkinBooking.id), checkinPayload);
      setShowCheckinModal(false);
      setCheckinBooking(null);
      setSnackbarMessage('Guest checked in successfully!');
      setSnackbarOpen(true);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to check in guest');
    } finally {
      setProcessingCheckIn(false);
    }
  };

  // View invoice for checked-out bookings
  const handleViewInvoice = (booking: BookingWithDetails) => {
    setInvoiceBooking(booking);
    setShowInvoiceModal(true);
  };

  // Check-out functions
  const handleCheckOut = (booking: BookingWithDetails) => {
    setCheckoutBooking(booking);
    setShowCheckoutModal(true);
  };

  const handleConfirmCheckout = async (_lateCheckoutData?: any, checkoutPaymentMethod?: string) => {
    if (!checkoutBooking) return;

    try {
      const updatePayload: any = { status: 'checked_out' };
      if (checkoutPaymentMethod) {
        updatePayload.payment_method = checkoutPaymentMethod;
      }
      await HotelAPIService.updateBooking(checkoutBooking.id, updatePayload);
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

  // Can delete/void booking in any state except already voided
  const canDelete = (booking: BookingWithDetails) => {
    return booking.status !== 'voided';
  };

  // Can void booking only if not already voided or checked_out/completed
  const canVoid = (booking: BookingWithDetails) => {
    return !['voided', 'checked_out', 'completed'].includes(booking.status);
  };

  // Can mark as complimentary only if confirmed/pending (not checked in yet)
  const canMarkComplimentary = (booking: BookingWithDetails) => {
    const status = booking.status;
    return (status === 'confirmed' || status === 'pending') && !booking.is_complimentary;
  };

  // Can reactivate only voided bookings
  const canReactivate = (booking: BookingWithDetails) => {
    return booking.status === 'voided';
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
      availableRooms: rooms.filter(r => r.available).length,
      totalGuests: guests.length,
    };
  }, [bookings, rooms, guests]);

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
            disabled={rooms.length === 0 || guests.length === 0}
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
          <Grid item xs={12} sm={6} md={3}>
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

          {/* Date Search */}
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              fullWidth
              size="small"
              label="Search Date"
              type="date"
              value={searchDate}
              onChange={(e) => {
                setSearchDate(e.target.value);
                if (e.target.value) {
                  setDateFilter('date_search');
                } else {
                  setDateFilter('all');
                }
              }}
              InputLabelProps={{ shrink: true }}
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
                <MenuItem value="no_show">No Show</MenuItem>
                <MenuItem value="voided">Voided</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Date Filter Buttons */}
          <Grid item xs={12} sm={6} md={3}>
            <ToggleButtonGroup
              value={dateFilter === 'date_search' ? null : dateFilter}
              exclusive
              onChange={(e, newValue) => {
                if (newValue) {
                  setDateFilter(newValue);
                  setSearchDate('');
                }
              }}
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
                  <strong>Booking #</strong>
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
              <TableCell><strong>Room Rate</strong></TableCell>
              <TableCell><strong>Channel</strong></TableCell>
              <TableCell><strong>Payment Method</strong></TableCell>
              <TableCell><strong>Payment Status</strong></TableCell>
              <TableCell><strong>Notes</strong></TableCell>
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
                  opacity: booking.status === 'voided' ? 0.6 : 1,
                  bgcolor: booking.status === 'voided' ? 'grey.100' : 'inherit',
                  textDecoration: booking.status === 'voided' ? 'line-through' : 'none',
                  '& td': {
                    textDecoration: booking.status === 'voided' ? 'line-through' : 'none',
                  }
                }}
              >
                <TableCell>{booking.booking_number || booking.folio_number || '-'}</TableCell>
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
                <TableCell>
                  {(() => {
                    const scheduledCheckout = booking.formatted_check_out || booking.check_out_date.split('T')[0];
                    const actualCheckout = booking.actual_check_out ? booking.actual_check_out.split('T')[0] : null;
                    const isEarlyCheckout = actualCheckout && actualCheckout < booking.check_out_date.split('T')[0];

                    if (isEarlyCheckout) {
                      return (
                        <Tooltip title={`Originally scheduled: ${scheduledCheckout}`}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="body2">{actualCheckout}</Typography>
                            <Chip label="Early" size="small" color="info" sx={{ height: 18, fontSize: '0.65rem' }} />
                          </Box>
                        </Tooltip>
                      );
                    }
                    return scheduledCheckout;
                  })()}
                </TableCell>
                <TableCell>{formatCurrency(Number(booking.price_per_night) || 0)}</TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                    {booking.source?.replace(/_/g, ' ') || '-'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                    {booking.payment_method?.replace(/_/g, ' ') || '-'}
                  </Typography>
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
                  <Typography variant="body2" sx={{
                    maxWidth: 150,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {[booking.remarks, booking.special_requests].filter(Boolean).join(' | ') || '-'}
                  </Typography>
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
                      {!booking.is_complimentary && (
                        <Tooltip title="Collect Room Payment">
                          <IconButton
                            size="small"
                            onClick={() => handleUpdatePaymentStatus(booking)}
                            color="info"
                          >
                            <PaymentIcon />
                          </IconButton>
                        </Tooltip>
                      )}
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
                      {canVoid(booking) && (
                        <Tooltip title="Void Booking">
                          <IconButton
                            size="small"
                            onClick={() => handleVoidBooking(booking)}
                            color="default"
                          >
                            <VoidIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {canReactivate(booking) && (
                        <Tooltip title="Reactivate Booking">
                          <IconButton
                            size="small"
                            onClick={() => handleReactivateBooking(booking)}
                            color="success"
                          >
                            <RestoreIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {booking.status === 'checked_out' && (
                        <Tooltip title="View Invoice">
                          <IconButton
                            size="small"
                            onClick={() => handleViewInvoice(booking)}
                            color="primary"
                          >
                            <ReceiptIcon />
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

      {/* Create Booking Modal (Unified) */}
      <UnifiedBookingModal
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        room={null}
        rooms={rooms}
        guests={guests}
        onSuccess={(message) => {
          setSnackbarMessage(message);
          setSnackbarOpen(true);
        }}
        onError={(message) => {
          setError(message);
        }}
        onRefreshData={loadData}
        onBookingCreated={(booking, guest) => {
          // Direct booking: open Enhanced Check-In modal
          const selectedRoom = rooms.find(r => r.id === booking.room_id);
          const bookingWithDetails: BookingWithDetails = {
            id: booking.id,
            booking_number: booking.folio_number || '',
            folio_number: booking.folio_number,
            guest_id: String(guest.id),
            guest_name: guest.full_name,
            guest_email: guest.email || '',
            guest_type: guest.guest_type,
            room_id: booking.room_id,
            room_number: selectedRoom?.room_number || '',
            room_type: selectedRoom?.room_type || booking.room_type || '',
            room_type_code: '',
            check_in_date: booking.check_in_date,
            check_out_date: booking.check_out_date,
            price_per_night: selectedRoom?.price_per_night || 0,
            total_amount: booking.total_amount,
            status: booking.status,
            payment_status: 'unpaid',
            payment_method: booking.payment_method,
            source: 'walk_in',
            remarks: '',
            is_complimentary: false,
            deposit_paid: false,
            deposit_amount: 0,
            room_card_deposit: 0, // deprecated but kept for type compatibility
            created_at: booking.created_at,
            is_posted: false,
          };
          setCheckinBooking(bookingWithDetails);
          setShowCheckinModal(true);
        }}
      />

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
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, check_in_date: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Check-Out Date"
                type="date"
                value={editFormData.check_out_date || ''}
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, check_out_date: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Status"
                value={editFormData.status || 'pending'}
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, status: e.target.value }))}

              >
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="confirmed">Confirmed</MenuItem>
                <MenuItem value="checked_in">Checked In</MenuItem>
                <MenuItem value="auto_checked_in">Auto Checked In</MenuItem>
                <MenuItem value="checked_out">Checked Out</MenuItem>
                <MenuItem value="late_checkout">Late Checkout</MenuItem>
                <MenuItem value="no_show">No Show</MenuItem>
                <MenuItem value="voided">Voided</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Channel"
                value={editFormData.source || 'walk_in'}
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, source: e.target.value }))}
              >
                <MenuItem value="walk_in">Walk-in</MenuItem>
                <MenuItem value="phone">Phone Reservation</MenuItem>
                <MenuItem value="direct">Direct Booking</MenuItem>
                <MenuItem value="online">Online (OTA)</MenuItem>
                <MenuItem value="website">Website</MenuItem>
                <MenuItem value="mobile">Mobile App</MenuItem>
                <MenuItem value="agent">Travel Agent</MenuItem>
                <MenuItem value="corporate">Corporate</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Payment Status"
                value={editFormData.payment_status || 'unpaid'}
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, payment_status: e.target.value }))}
              >
                <MenuItem value="unpaid">Unpaid</MenuItem>
                <MenuItem value="paid">Paid</MenuItem>
                <MenuItem value="partial">Partial</MenuItem>
                <MenuItem value="unpaid_deposit">Unpaid (Deposit)</MenuItem>
                <MenuItem value="paid_rate">Paid (Rate Only)</MenuItem>
                <MenuItem value="refunded">Refunded</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Room Rate (Before Tax)"
                type="number"
                value={editFormData.price_per_night || 0}
                onChange={(e) => setEditFormData((prev: any) => ({
                  ...prev,
                  price_per_night: parseFloat(e.target.value) || 0,
                }))}
                InputProps={{
                  startAdornment: <span style={{ marginRight: 4 }}>RM</span>,
                }}
                helperText="Rate per night (before tax) - modifying will recalculate total"
              />
            </Grid>
            {editRoomTypeConfig?.allows_extra_bed && (editRoomTypeConfig?.max_extra_beds || 0) > 0 && (
              <>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Number of Extra Beds"
                    type="number"
                    value={editFormData.extra_bed_count || 0}
                    onChange={(e) => {
                      const maxBeds = editRoomTypeConfig?.max_extra_beds || 0;
                      const chargePerBed = editRoomTypeConfig
                        ? (typeof editRoomTypeConfig.extra_bed_charge === 'string'
                            ? parseFloat(editRoomTypeConfig.extra_bed_charge)
                            : editRoomTypeConfig.extra_bed_charge) || 0
                        : 0;
                      const count = Math.min(Math.max(parseInt(e.target.value) || 0, 0), maxBeds);
                      setEditFormData((prev: any) => ({
                        ...prev,
                        extra_bed_count: count,
                        extra_bed_charge: count * chargePerBed,
                      }));
                    }}
                    inputProps={{ min: 0, max: editRoomTypeConfig?.max_extra_beds || 0 }}
                    helperText={`${formatCurrency(
                      (typeof editRoomTypeConfig?.extra_bed_charge === 'string'
                        ? parseFloat(editRoomTypeConfig.extra_bed_charge)
                        : editRoomTypeConfig?.extra_bed_charge) || 0
                    )} per extra bed (max ${editRoomTypeConfig?.max_extra_beds || 0})`}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Extra Bed Charge"
                    type="number"
                    value={editFormData.extra_bed_charge || 0}
                    onChange={(e) => setEditFormData((prev: any) => ({
                      ...prev,
                      extra_bed_charge: parseFloat(e.target.value) || 0,
                    }))}
                    InputProps={{
                      startAdornment: <span style={{ marginRight: 4 }}>RM</span>,
                    }}
                    helperText="Auto-calculated or manually adjust"
                  />
                </Grid>
              </>
            )}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes / Remarks"
                multiline
                rows={2}
                value={editFormData.remarks || ''}
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, remarks: e.target.value }))}
                placeholder="Enter any notes or remarks for this booking..."
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Special Requests"
                multiline
                rows={2}
                value={editFormData.special_requests || ''}
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, special_requests: e.target.value }))}
                placeholder="Enter any special requests..."
              />
            </Grid>
            {editingBooking && !['checked_in', 'auto_checked_in', 'checked_out', 'completed'].includes(editingBooking.status) ? (
              <>
                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    label="Assigned Room"
                    value={editFormData.room_id || ''}
                    onChange={(e) => {
                      const selectedRoom = availableRooms.find(r => r.id === e.target.value);
                      const newRate = selectedRoom
                        ? (typeof selectedRoom.price_per_night === 'string' ? parseFloat(selectedRoom.price_per_night) : selectedRoom.price_per_night) || 0
                        : editFormData.price_per_night;
                      setEditFormData((prev: any) => ({
                        ...prev,
                        room_id: e.target.value,
                        price_per_night: newRate,
                      }));
                    }}
                  >
                    {availableRooms.map((room) => (
                      <MenuItem key={room.id} value={room.id}>
                        Room {room.room_number} - {room.room_type} ({formatCurrency(typeof room.price_per_night === 'string' ? parseFloat(room.price_per_night) : room.price_per_night)}/night)
                        {room.id === editingBooking.room_id ? ' (current)' : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Alert severity="info" sx={{ height: '100%', display: 'flex', alignItems: 'center' }}>
                    Guest: <strong>{editingBooking?.guest_name}</strong>
                  </Alert>
                </Grid>
              </>
            ) : (
              <Grid item xs={12}>
                <Alert severity="info">
                  Guest: <strong>{editingBooking?.guest_name}</strong><br />
                  Room: <strong>{editingBooking?.room_type} - Room {editingBooking?.room_number}</strong>
                </Alert>
              </Grid>
            )}
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


      {/* Void Booking Dialog */}
      <Dialog open={voidDialogOpen} onClose={() => setVoidDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Void Booking</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            Voiding a booking will permanently remove it from all reports including night audit. This cannot be undone.
          </Alert>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2"><strong>Guest:</strong> {voidingBooking?.guest_name}</Typography>
            <Typography variant="body2"><strong>Room:</strong> {voidingBooking?.room_type} - Room {voidingBooking?.room_number}</Typography>
            <Typography variant="body2"><strong>Check-in:</strong> {voidingBooking?.formatted_check_in || voidingBooking?.check_in_date}</Typography>
            <Typography variant="body2"><strong>Check-out:</strong> {voidingBooking?.formatted_check_out || voidingBooking?.check_out_date}</Typography>
          </Box>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Void Reason (Optional)"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Enter reason for voiding..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmVoid} variant="contained" color="error" disabled={voiding}>
            {voiding ? 'Voiding...' : 'Void Booking'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reactivate Booking Dialog */}
      <Dialog open={reactivateDialogOpen} onClose={() => setReactivateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reactivate Booking</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will reactivate the voided booking and reserve the room. Make sure the room is available for the booking dates.
          </Alert>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2"><strong>Guest:</strong> {reactivatingBooking?.guest_name}</Typography>
            <Typography variant="body2"><strong>Room:</strong> {reactivatingBooking?.room_type} - Room {reactivatingBooking?.room_number}</Typography>
            <Typography variant="body2"><strong>Check-in:</strong> {reactivatingBooking?.formatted_check_in || reactivatingBooking?.check_in_date}</Typography>
            <Typography variant="body2"><strong>Check-out:</strong> {reactivatingBooking?.formatted_check_out || reactivatingBooking?.check_out_date}</Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReactivateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmReactivate} variant="contained" color="success" disabled={reactivating}>
            {reactivating ? 'Reactivating...' : 'Reactivate Booking'}
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

      {/* Read-Only Invoice Modal */}
      <CheckoutInvoiceModal
        open={showInvoiceModal}
        onClose={() => {
          setShowInvoiceModal(false);
          setInvoiceBooking(null);
        }}
        booking={invoiceBooking}
        readOnly
      />

      {/* Check-In Dialog */}
      <Dialog
        open={showCheckinModal}
        onClose={() => { if (!processingCheckIn) { setShowCheckinModal(false); setCheckinBooking(null); } }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'success.main', color: 'white', py: 2, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <LoginIcon sx={{ fontSize: 28 }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Check-In - Room {checkinBooking?.room_number}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {checkinBooking && (
            <Box>
              <Paper elevation={0} sx={{ p: 2, mb: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Booking #{checkinBooking.booking_number}
                </Typography>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={12}>
                    <Typography variant="h6" fontWeight={600}>{checkinBooking.guest_name}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Check-in</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {new Date(checkinBooking.check_in_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Check-out</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {new Date(checkinBooking.check_out_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Room Type</Typography>
                    <Typography variant="body2" fontWeight={500}>{checkinBooking.room_type}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                    <Typography variant="body2" fontWeight={500}>{formatCurrency(Number(checkinBooking.total_amount || 0))}</Typography>
                  </Grid>
                </Grid>
              </Paper>

              <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Payment</Typography>
              <ToggleButtonGroup value={ciPaymentChoice} exclusive onChange={(_, val) => { if (val) setCiPaymentChoice(val); }} fullWidth size="small" sx={{ mb: 1.5 }}>
                <ToggleButton value="pay_now" color="success" sx={{ py: 1, fontWeight: 600 }}>
                  <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} /> Make Payment Now
                </ToggleButton>
                <ToggleButton value="pay_later" color="warning" sx={{ py: 1, fontWeight: 600 }}>
                  <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} /> Pay Later
                </ToggleButton>
              </ToggleButtonGroup>
              {ciPaymentChoice === 'pay_now' && (
                <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                  <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Payment Method</InputLabel>
                      <Select value={ciPaymentMethod} onChange={(e) => setCiPaymentMethod(e.target.value)} label="Payment Method">
                        {PAYMENT_METHODS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField fullWidth size="small" label="Amount Paid" type="number" value={ciAmountPaid} onChange={(e) => setCiAmountPaid(parseFloat(e.target.value) || 0)}
                      InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>, inputProps: { min: 0, step: 0.01 } }} />
                  </Grid>
                </Grid>
              )}
              {ciPaymentChoice === 'pay_later' && (
                <Alert severity="info" sx={{ mb: 1.5, py: 0 }}>Payment will be collected later.</Alert>
              )}

              <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Deposit</Typography>
              <ToggleButtonGroup value={ciDepositChoice} exclusive onChange={(_, val) => { if (val) setCiDepositChoice(val); }} fullWidth size="small" sx={{ mb: 1.5 }}>
                <ToggleButton value="receive" color="success" sx={{ py: 1, fontWeight: 600 }}>
                  <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} /> Receive Deposit
                </ToggleButton>
                <ToggleButton value="waive" color="error" sx={{ py: 1, fontWeight: 600 }}>
                  <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} /> Waive Deposit
                </ToggleButton>
              </ToggleButtonGroup>
              {ciDepositChoice === 'receive' && (
                <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                  <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Deposit Method</InputLabel>
                      <Select value={ciDepositMethod} onChange={(e) => setCiDepositMethod(e.target.value)} label="Deposit Method">
                        {PAYMENT_METHODS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField fullWidth size="small" label="Deposit Amount" type="number" value={ciDepositAmount} onChange={(e) => setCiDepositAmount(parseFloat(e.target.value) || 0)}
                      InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>, inputProps: { min: 0, step: 0.01 } }} />
                  </Grid>
                </Grid>
              )}
              {ciDepositChoice === 'waive' && (
                <TextField fullWidth size="small" label="Reason for Waiving Deposit" value={ciWaiveReason} onChange={(e) => setCiWaiveReason(e.target.value)}
                  multiline rows={2} placeholder="e.g., Returning guest, Company account..." helperText="Optional: provide a reason for waiving the deposit" sx={{ mb: 1.5 }} />
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={() => { setShowCheckinModal(false); setCheckinBooking(null); }} disabled={processingCheckIn}>Cancel</Button>
          <Button variant="contained" color="success" onClick={handleConfirmCheckIn} disabled={processingCheckIn}
            startIcon={processingCheckIn ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}>
            {processingCheckIn ? 'Processing...' : 'Check-In Now'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BookingsPage;
