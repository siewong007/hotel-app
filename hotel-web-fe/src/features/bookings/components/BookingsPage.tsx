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
  alpha,
  Pagination,
  Stack,
  Autocomplete,
  Divider,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  EventAvailable as BookIcon,
  Hotel as HotelIcon,
  CheckCircle as CheckCircleIcon,
  ExitToApp as CheckOutIcon,
  ArrowForward as ArrowForwardIcon,
  ArrowBack as ArrowBackIcon,
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
  History as HistoryIcon,
  Edit as EditIcon,
  Close as CloseIcon,
  Bed as BedIcon,
  MeetingRoom as RoomIcon,
  Add as AddIcon,
  Public as PublicIcon,
} from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { HotelAPIService } from '../../../api';

import { BookingTimelineEntry, BookingWithDetails, PaymentWorkflowSummary, Room, Guest, RoomType } from '../../../types';
import { getBookingStatusColor, getBookingStatusText, getPaymentStatusColor, getPaymentStatusText } from '../../../utils/bookingUtils';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import CheckoutInvoiceModal from '../../invoices/components/CheckoutInvoiceModal';
import UnifiedBookingModal from '../../rooms/components/UnifiedBookingModal';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { useBookings, PAGE_SIZE, SortField, DateFilter } from '../hooks/useBookings';

type BookingChannelInfo = {
  name: string;
  abbreviation: string;
  background: string;
  color: string;
};

type BookingChannelStyle = Pick<BookingChannelInfo, 'background' | 'color'> & { patterns: RegExp[] };

const KNOWN_ONLINE_CHANNEL_STYLES: BookingChannelStyle[] = [
  { background: '#e81f45', color: '#fff', patterns: [/agoda/i] },
  { background: '#003b95', color: '#fff', patterns: [/booking\.com/i] },
  { background: '#087ce4', color: '#fff', patterns: [/traveloka/i] },
  { background: '#ffc72c', color: '#172033', patterns: [/expedia/i] },
  { background: '#ff5a5f', color: '#fff', patterns: [/airbnb/i] },
  { background: '#1976d2', color: '#fff', patterns: [/\bwebsite\b/i, /\bweb\b/i] },
  { background: '#00796b', color: '#fff', patterns: [/\bota\b/i, /\bonline\b/i] },
];

const toChannelAbbreviation = (name: string) => {
  const compact = name.replace(/\.com/gi, '').trim();
  const words = compact.match(/[A-Za-z0-9]+/g) || [];

  if (words.length > 1) {
    return words.map((word) => word[0]).join('').slice(0, 3).toUpperCase();
  }

  return (compact.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'WEB').toUpperCase();
};

const cleanChannelName = (value: string) => value
  .replace(/\s*-\s*Ref:.*$/i, '')
  .replace(/\s*Reference:.*$/i, '')
  .replace(/\s*Booking$/i, '')
  .trim();

const normalizeChannelToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const getChannelStyle = (name: string): Pick<BookingChannelInfo, 'background' | 'color'> => {
  const style = KNOWN_ONLINE_CHANNEL_STYLES.find((channel) => channel.patterns.some((pattern) => pattern.test(name)));
  return style ? { background: style.background, color: style.color } : { background: '#455a64', color: '#fff' };
};

const buildChannelInfo = (name: string, abbreviation?: string): BookingChannelInfo => ({
  name,
  abbreviation: abbreviation?.trim() || toChannelAbbreviation(name),
  ...getChannelStyle(name),
});

const findConfiguredChannel = (sourceKey: string, haystack: string, parsedName: string) => {
  const configuredChannels = getHotelSettings().booking_channels.filter((channel) => channel.name.trim());
  const normalizedHaystack = normalizeChannelToken(haystack);
  const normalizedParsed = normalizeChannelToken(parsedName);

  const exactMatch = configuredChannels.find((channel) => {
    const normalizedName = normalizeChannelToken(channel.name);
    return normalizedName && (normalizedParsed === normalizedName || normalizedHaystack.includes(normalizedName));
  });
  if (exactMatch) return exactMatch;

  if (sourceKey.includes('website') || sourceKey.includes('web')) {
    return configuredChannels.find((channel) => /\b(web|website)\b/i.test(channel.name));
  }

  if (sourceKey.includes('ota')) {
    return configuredChannels.find((channel) => /\b(ota|online)\b/i.test(channel.name));
  }

  return undefined;
};

const getBookingChannelInfo = (booking: Pick<BookingWithDetails, 'source' | 'remarks' | 'booking_remarks'>): BookingChannelInfo | null => {
  const source = String(booking.source || '').trim();
  const sourceKey = source.toLowerCase();
  const remarks = [booking.booking_remarks, booking.remarks]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' | ');
  const haystack = `${source} ${remarks}`.trim();
  const firstRemark = remarks.split('|')[0]?.trim() || '';
  const parsedName = /-\s*Ref:|Reference:|\sBooking$/i.test(firstRemark) ? cleanChannelName(firstRemark) : '';
  const configuredChannel = findConfiguredChannel(sourceKey, haystack, parsedName);
  const styleMatch = KNOWN_ONLINE_CHANNEL_STYLES.find((channel) => channel.patterns.some((pattern) => pattern.test(parsedName || haystack)));
  const looksOnline = ['online', 'ota', 'website', 'web', 'channel_manager'].some((key) => sourceKey.includes(key)) || Boolean(configuredChannel || styleMatch);

  if (!looksOnline) {
    return null;
  }

  if (configuredChannel) {
    return buildChannelInfo(configuredChannel.name, configuredChannel.abbreviation);
  }

  const fallbackName = parsedName || (sourceKey.includes('website') || sourceKey.includes('web') ? 'Website' : 'Online');
  return buildChannelInfo(fallbackName);
};

const getBookedViaText = (booking: Pick<BookingWithDetails, 'source' | 'remarks' | 'booking_remarks'>) => {
  const channel = getBookingChannelInfo(booking);
  if (channel) {
    return `${channel.name} (${channel.abbreviation})`;
  }

  return booking.source?.replace(/_/g, ' ') || 'Direct';
};

const BookingsPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const PAYMENT_METHODS = getHotelSettings().payment_methods;
  const isAdmin = hasRole('admin') || hasRole('receptionist') || hasRole('manager') || hasPermission('bookings:update');

  const {
    bookings,
    rooms,
    setRooms,
    guests,
    loading,
    error,
    setError,
    totalBookings,
    statsData,
    sortField,
    sortOrder,
    searchQuery,
    setSearchQuery,
    roomNumberFilter,
    setRoomNumberFilter,
    statusFilter,
    setStatusFilter,
    dateFilter,
    setDateFilter,
    customStartDate,
    setCustomStartDate,
    customEndDate,
    setCustomEndDate,
    searchDate,
    setSearchDate,
    currentPage,
    setCurrentPage,
    loadRooms,
    loadStats,
    loadGuests,
    loadBookings,
    reload: loadData,
    handleSort,
    clearFilters,
  } = useBookings();

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
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [workflowBooking, setWorkflowBooking] = useState<BookingWithDetails | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<PaymentWorkflowSummary | null>(null);
  const [workflowTimeline, setWorkflowTimeline] = useState<BookingTimelineEntry[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | number | null>(null);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(true);
  const [bookingView, setBookingView] = useState<'all' | 'arriving' | 'in_house' | 'departing' | 'upcoming' | 'balance'>('all');
  const [summaryBookings, setSummaryBookings] = useState<BookingWithDetails[]>([]);
  const [summaryLoaded, setSummaryLoaded] = useState(false);

  // Create booking dialog (using UnifiedBookingModal)
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Edit booking dialog (admin only)
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  const [editRoomTypeConfig, setEditRoomTypeConfig] = useState<RoomType | null>(null);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [updating, setUpdating] = useState(false);



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
  // Payment dialog records a real payments row instead of toggling
  // bookings.payment_status (which is derived from recorded payments).
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');
  const [paymentNote, setPaymentNote] = useState<string>('');
  const [updatingPayment, setUpdatingPayment] = useState(false);

  // Notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const sortRoomsByNumber = (roomList: Room[]) => {
    return [...roomList].sort((a, b) => {
      const numA = parseInt(a.room_number, 10);
      const numB = parseInt(b.room_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.room_number.localeCompare(b.room_number);
    });
  };

  const loadBookingSummary = async () => {
    try {
      const data = await HotelAPIService.getBookingsWithDetails();
      setSummaryBookings(data);
      setSummaryLoaded(true);
    } catch (err: any) {
      console.error('Failed to load booking summary:', err);
      setSummaryLoaded(false);
    }
  };

  const reloadBookingData = async () => {
    await Promise.all([loadData(), loadBookingSummary()]);
  };

  useEffect(() => {
    loadBookingSummary();
  }, []);

  // Server handles all filtering and sorting — bookings is already the correct page
  const filteredAndSortedBookings = bookings;

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
      const bookingId = typeof booking.id === 'string' ? parseInt(booking.id, 10) : booking.id;
      HotelAPIService.getAvailableRoomsForDates(checkIn, checkOut, bookingId).then(available => {
        setAvailableRooms(sortRoomsByNumber(available));
      }).catch(() => {
        // Fallback: show all rooms
        setAvailableRooms(sortRoomsByNumber(rooms));
      });
    }

    setEditDialogOpen(true);
  };

  // Re-fetch available rooms when dates change in the edit dialog
  useEffect(() => {
    if (!editDialogOpen || !editingBooking) return;
    if (!editFormData.check_in_date || !editFormData.check_out_date) return;
    const isNotCheckedIn = !['checked_in', 'auto_checked_in', 'checked_out', 'completed'].includes(editingBooking.status);
    if (!isNotCheckedIn) return;

    const bookingId = typeof editingBooking.id === 'string' ? parseInt(editingBooking.id, 10) : editingBooking.id;
    HotelAPIService.getAvailableRoomsForDates(editFormData.check_in_date, editFormData.check_out_date, bookingId).then(available => {
      setAvailableRooms(sortRoomsByNumber(available));
    }).catch(() => {
      setAvailableRooms(sortRoomsByNumber(rooms));
    });
  }, [editFormData.check_in_date, editFormData.check_out_date]);

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
      await reloadBookingData();
    } catch (err: any) {
      setError(err.message || 'Failed to update booking');
    } finally {
      setUpdating(false);
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
      await reloadBookingData();
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
      await reloadBookingData();
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
      await reloadBookingData();
    } catch (err: any) {
      setError(err.message || 'Failed to mark booking as complimentary');
    } finally {
      setMarkingComplimentary(false);
    }
  };

  // Payment status handlers
  const handleUpdatePaymentStatus = (booking: BookingWithDetails) => {
    setPaymentBooking(booking);
    const balanceDue = Number(booking.balance_due || 0);
    const totalAmount = Number(booking.total_amount || 0);
    setPaymentAmount(balanceDue > 0 ? balanceDue : totalAmount);
    setPaymentMethod(booking.payment_method || 'Cash');
    setPaymentNote('');
    setPaymentDialogOpen(true);
  };

  const handleConfirmPaymentUpdate = async () => {
    if (!paymentBooking) return;
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setError('Payment amount must be greater than 0.');
      return;
    }

    try {
      setUpdatingPayment(true);
      // Insert a real `payments` row (payment_type='booking'). The backend
      // recompute_payment_status helper will flip the chip automatically.
      await HotelAPIService.recordPayment({
        booking_id: Number(paymentBooking.id),
        amount: paymentAmount,
        payment_method: paymentMethod,
        payment_type: 'booking',
        notes: paymentNote.trim() || `Payment accepted (${paymentMethod})`,
      });

      setSnackbarMessage(`Payment of ${formatCurrency(paymentAmount)} accepted via ${paymentMethod}`);
      setSnackbarOpen(true);
      setPaymentDialogOpen(false);
      setPaymentBooking(null);
      setPaymentAmount(0);
      setPaymentMethod('Cash');
      setPaymentNote('');
      await reloadBookingData();
    } catch (err: any) {
      setError(err.message || 'Failed to accept payment');
    } finally {
      setUpdatingPayment(false);
    }
  };

  // Check-in functions
  const handleCheckIn = async (bookingId: string) => {
    try {
      const booking = bookings.find(b => String(b.id) === String(bookingId)) ||
        summaryBookings.find(b => String(b.id) === String(bookingId));
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
    if (ciDepositChoice === 'receive' && Number(ciDepositAmount) <= 0) {
      setError('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.');
      return;
    }
    try {
      setProcessingCheckIn(true);
      // Don't push payment_status here — recording the payments row below is
      // what flips the derived status. Sending an override would just be
      // overwritten by recompute_payment_status on the backend.
      const updateData: any = {};
      if (ciPaymentChoice === 'pay_now') {
        updateData.amount_paid = ciAmountPaid;
        updateData.payment_method = ciPaymentMethod;
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
      await reloadBookingData();
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

  const handleViewWorkflow = async (booking: BookingWithDetails) => {
    setWorkflowBooking(booking);
    setWorkflowDialogOpen(true);
    setWorkflowLoading(true);
    setWorkflowSummary(null);
    setWorkflowTimeline([]);

    try {
      const [summary, timeline] = await Promise.all([
        HotelAPIService.getPaymentWorkflowSummary(booking.id),
        HotelAPIService.getBookingTimeline(booking.id),
      ]);
      setWorkflowSummary(summary);
      setWorkflowTimeline(timeline);
    } catch (err: any) {
      setError(err.message || 'Failed to load booking workflow');
    } finally {
      setWorkflowLoading(false);
    }
  };

  const getWorkflowEventIndicator = (event: BookingTimelineEntry) => {
    const source = (event.source || '').toLowerCase();
    const eventType = (event.event_type || '').toLowerCase();
    const statusTo = (event.status_to || '').toLowerCase();
    const title = (event.title || '').toLowerCase();

    if (
      eventType.includes('void') ||
      eventType.includes('checkout') ||
      statusTo === 'voided' ||
      statusTo === 'checked_out' ||
      statusTo === 'completed' ||
      title.includes('void') ||
      title.includes('checked out')
    ) {
      return {
        label: statusTo === 'voided' || eventType.includes('void') || title.includes('void') ? 'Void' : 'Checkout',
        color: '#d32f2f',
        backgroundColor: 'rgba(211, 47, 47, 0.12)',
        borderColor: 'rgba(211, 47, 47, 0.35)',
        icon: eventType.includes('void') || statusTo === 'voided' ? <VoidIcon fontSize="small" /> : <CheckOutIcon fontSize="small" />,
      };
    }

    if (
      eventType.includes('check_in') ||
      eventType.includes('check-in') ||
      statusTo === 'checked_in' ||
      title.includes('checked in')
    ) {
      return {
        label: 'Check-in',
        color: '#ed6c02',
        backgroundColor: 'rgba(237, 108, 2, 0.12)',
        borderColor: 'rgba(237, 108, 2, 0.35)',
        icon: <LoginIcon fontSize="small" />,
      };
    }

    if (source === 'payments') {
      return {
        label: 'Payment',
        color: '#2e7d32',
        backgroundColor: 'rgba(46, 125, 50, 0.12)',
        borderColor: 'rgba(46, 125, 50, 0.35)',
        icon: <PaymentIcon fontSize="small" />,
      };
    }

    return {
      label: 'Update',
      color: '#1976d2',
      backgroundColor: 'rgba(25, 118, 210, 0.12)',
      borderColor: 'rgba(25, 118, 210, 0.35)',
      icon: <EditIcon fontSize="small" />,
    };
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
      await reloadBookingData();
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

  // Statistics — use server-side stats for global accuracy
  const stats = useMemo(() => ({
    total: statsData.total,
    checkedIn: statsData.checked_in,
    todayCheckIns: statsData.today_check_ins,
    availableRooms: rooms.filter(r => r.available).length,
  }), [statsData, rooms]);

  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);

  const getDateOnly = (value?: string) => (value || '').split('T')[0];

  const getNights = (booking: BookingWithDetails | null) => {
    if (!booking?.check_in_date || !booking?.check_out_date) return 0;
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    return Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
  };

  const formatShortDate = (value?: string) => {
    if (!value) return '-';
    return new Date(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatOperationalDate = () => {
    return new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).toUpperCase();
  };

  const getGuestInitials = (name?: string) => {
    if (!name) return 'G';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  };

  const getBookingBalance = (booking: BookingWithDetails | null) => Number(booking?.balance_due ?? 0);
  const getBookingTotal = (booking: BookingWithDetails | null) => Number(booking?.total_amount ?? 0);
  const operationsBookings = summaryLoaded ? summaryBookings : bookings;

  const dueBookings = useMemo(
    () => operationsBookings.filter((booking) => booking.status !== 'voided' && getBookingBalance(booking) > 0),
    [operationsBookings]
  );
  const arrivingBookings = useMemo(
    () => operationsBookings.filter((booking) => getDateOnly(booking.check_in_date) === todayIso && !['checked_in', 'checked_out', 'completed', 'voided'].includes(booking.status)),
    [operationsBookings, todayIso]
  );
  const departingBookings = useMemo(
    () => operationsBookings.filter((booking) => getDateOnly(booking.check_out_date) === todayIso && canCheckOut(booking)),
    [operationsBookings, todayIso]
  );
  const inHouseBookings = useMemo(
    () => operationsBookings.filter((booking) => booking.status === 'checked_in'),
    [operationsBookings]
  );
  const upcomingBookings = useMemo(
    () => operationsBookings.filter((booking) =>
      ['pending', 'confirmed'].includes(booking.status) &&
      getDateOnly(booking.check_in_date) > todayIso
    ),
    [operationsBookings, todayIso]
  );
  const visibleBookings = useMemo(() => {
    if (bookingView === 'arriving') return arrivingBookings;
    if (bookingView === 'in_house') return inHouseBookings;
    if (bookingView === 'departing') return departingBookings;
    if (bookingView === 'upcoming') return upcomingBookings;
    if (bookingView === 'balance') return dueBookings;
    return filteredAndSortedBookings;
  }, [arrivingBookings, bookingView, departingBookings, dueBookings, filteredAndSortedBookings, inHouseBookings, upcomingBookings]);

  const selectedBooking = useMemo(() => {
    if (!bookingDetailsOpen) return null;
    if (selectedBookingId == null) return visibleBookings[0] || null;
    return visibleBookings.find((booking) => String(booking.id) === String(selectedBookingId)) || visibleBookings[0] || null;
  }, [bookingDetailsOpen, selectedBookingId, visibleBookings]);

  useEffect(() => {
    if (!bookingDetailsOpen) return;
    if (visibleBookings.length === 0) {
      setSelectedBookingId(null);
      return;
    }
    if (!selectedBookingId || !visibleBookings.some((booking) => String(booking.id) === String(selectedBookingId))) {
      setSelectedBookingId(visibleBookings[0].id);
    }
  }, [bookingDetailsOpen, selectedBookingId, visibleBookings]);

  const totalGuestsInHouse = inHouseBookings.reduce((sum, booking) => sum + Number((booking as any).adults || 1) + Number((booking as any).children || 0), 0);
  const roomCount = rooms.length || 0;
  const outstandingDue = dueBookings.reduce((sum, booking) => sum + getBookingBalance(booking), 0);
  const paymentActionDetail = summaryLoaded ? `${dueBookings.length} with balance` : `${dueBookings.length} with balance on this page`;

  const selectBookingView = (view: typeof bookingView) => {
    setBookingView(view);
    setCurrentPage(1);
    if (view === 'all') {
      clearFilters();
    } else if (view === 'arriving') {
      setDateFilter('today');
      setStatusFilter('all');
      setSearchDate('');
    } else if (view === 'in_house') {
      setStatusFilter('checked_in');
      setDateFilter('all');
      setSearchDate('');
    } else if (view === 'departing') {
      setStatusFilter('checked_in');
      setDateFilter('date_search');
      setSearchDate(todayIso);
    } else if (view === 'upcoming') {
      setStatusFilter('confirmed');
      setDateFilter('month');
      setSearchDate('');
    } else if (view === 'balance') {
      setStatusFilter('all');
      setDateFilter('all');
      setSearchDate('');
    }
  };

  const handleTakePaymentAction = () => {
    selectBookingView('balance');
    if (dueBookings.length > 0) {
      setSelectedBookingId(dueBookings[0].id);
      setBookingDetailsOpen(true);
    }
  };

  const statusDotColor = (status?: string) => {
    if (status === 'checked_in') return '#2f64b3';
    if (status === 'pending') return '#c47b1e';
    if (status === 'voided') return '#c43d32';
    if (status === 'checked_out' || status === 'completed') return '#6b7280';
    return '#3d8f6b';
  };

  if (loading) {
    return (
      <MuiBox sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </MuiBox>
    );
  }

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2, mb: 3, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900, letterSpacing: 2 }}>
            Front Desk · {formatOperationalDate()}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, color: 'text.primary', lineHeight: 1.05 }}>
            Bookings
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={reloadBookingData}
            sx={{ minHeight: 44 }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
            disabled={rooms.length === 0}
            sx={{ minHeight: 44, px: 2.5, bgcolor: '#2f6f52', '&:hover': { bgcolor: '#255a42' } }}
          >
            New booking
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={reloadBookingData}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <Grid container spacing={2} mb={2.5}>
        {[
          { title: 'Arrivals / Check-in', value: arrivingBookings.length, detail: `${arrivingBookings.filter(canCheckIn).length} ready to check in`, subValue: arrivingBookings.length || stats.todayCheckIns || 1, color: '#2f6f52', icon: <ArrowForwardIcon fontSize="small" />, view: 'arriving' as const },
          { title: 'In-house guests', value: totalGuestsInHouse, detail: `across ${inHouseBookings.length} rooms`, subValue: Math.max(totalGuestsInHouse, roomCount || 1), color: '#2f64b3', icon: <BedIcon fontSize="small" />, view: 'in_house' as const },
          { title: 'Departures / Check-out', value: departingBookings.length, detail: `${departingBookings.length} ready to check out`, subValue: departingBookings.length || 1, color: '#c47b1e', icon: <ArrowBackIcon fontSize="small" />, view: 'departing' as const },
          { title: 'Upcoming bookings', value: upcomingBookings.length, detail: `${upcomingBookings.length} future reservations`, subValue: upcomingBookings.length || 1, color: '#7c4dff', icon: <BookIcon fontSize="small" />, view: 'upcoming' as const },
          { title: 'Outstanding due', value: formatCurrency(outstandingDue), detail: `${dueBookings.length} bookings`, color: '#c43d32', icon: <PaymentIcon fontSize="small" />, view: 'balance' as const, alert: true },
        ].map((stat) => (
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2.4 }} key={stat.title}>
            <Card
              elevation={0}
              onClick={() => selectBookingView(stat.view)}
              sx={{
                height: '100%',
                cursor: 'pointer',
                borderLeft: stat.alert ? `4px solid ${stat.color}` : '1px solid',
                borderColor: stat.alert ? stat.color : 'divider',
                bgcolor: bookingView === stat.view ? alpha(stat.color, 0.08) : 'background.paper',
              }}
            >
              <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: 'text.secondary' }}>{stat.title}</Typography>
                  <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: alpha(stat.color, 0.12), color: stat.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {stat.icon}
                  </Box>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 900, color: 'text.primary', lineHeight: 1 }}>
                  {stat.value}
                  {'subValue' in stat && typeof stat.value === 'number' && (
                    <Typography component="span" variant="h6" color="text.secondary">/{stat.subValue}</Typography>
                  )}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{stat.detail}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2} mb={2.5}>
        {[
          { title: 'Take payment', detail: paymentActionDetail, color: '#c43d32', icon: <PaymentIcon />, action: handleTakePaymentAction, primary: dueBookings.length > 0 },
        ].map((action) => (
          <Grid size={{ xs: 12 }} key={action.title}>
            <Card
              elevation={0}
              onClick={action.action}
              // Use `&.MuiCard-root` to match the specificity of the global
              // `.hotel-board-skin .MuiCard-root` theme rule; without this the
              // primary background gets overridden back to plain paper white.
              sx={{
                cursor: 'pointer',
                color: action.primary ? 'white' : 'text.primary',
                '&.MuiCard-root': {
                  bgcolor: action.primary ? action.color : 'background.paper',
                  borderColor: action.primary ? action.color : 'divider',
                },
              }}
            >
              <CardContent sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: action.primary ? 'rgba(255,255,255,0.18)' : alpha(action.color, 0.12), color: action.primary ? 'white' : action.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {action.icon}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, lineHeight: 1.1, color: 'inherit' }}>{action.title}</Typography>
                  <Typography variant="body2" sx={{ color: action.primary ? 'rgba(255,255,255,0.85)' : 'text.secondary' }}>{action.detail}</Typography>
                </Box>
                <ArrowForwardIcon sx={{ color: action.primary ? 'white' : 'text.secondary' }} />
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2.5} alignItems="stretch">
        <Grid size={{ xs: 12, lg: selectedBooking ? 8 : 12 }}>
          <Card elevation={0} sx={{ overflow: 'hidden', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 220px' }, gap: 1.25 }}>
                <TextField
                  fullWidth
                  size="medium"
                  placeholder="Search guest, invoice, or room number..."
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
                <TextField
                  fullWidth
                  size="medium"
                  label="Search date"
                  type="date"
                  value={searchDate}
                  onChange={(e) => {
                    setSearchDate(e.target.value);
                    setDateFilter(e.target.value ? 'date_search' : 'all');
                    setBookingView('all');
                    setCurrentPage(1);
                  }}
                  InputLabelProps={{ shrink: true }}
                />
              </Box>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
                {[
                  { key: 'all', label: 'All', count: totalBookings || bookings.length },
                  { key: 'arriving', label: 'Arriving', count: arrivingBookings.length },
                  { key: 'in_house', label: 'In House', count: inHouseBookings.length },
                  { key: 'upcoming', label: 'Upcoming', count: upcomingBookings.length },
                  { key: 'balance', label: 'With Balance', count: dueBookings.length },
                ].map((filter) => (
                  <Chip
                    key={filter.key}
                    label={`${filter.label}  ${filter.count}`}
                    onClick={() => selectBookingView(filter.key as typeof bookingView)}
                    sx={{
                      height: 34,
                      px: 0.5,
                      fontWeight: 900,
                      bgcolor: bookingView === filter.key ? 'text.primary' : 'background.paper',
                      color: bookingView === filter.key ? 'background.paper' : 'text.primary',
                    }}
                  />
                ))}
                {(searchQuery || roomNumberFilter || statusFilter !== 'all' || dateFilter !== 'all') && (
                  <Chip
                    icon={<ClearIcon />}
                    label="Clear"
                    variant="outlined"
                    onClick={() => {
                      setBookingView('all');
                      clearFilters();
                    }}
                    sx={{ height: 34, fontWeight: 800 }}
                  />
                )}
                {searchDate && (
                  <Chip
                    label={`Date ${formatShortDate(searchDate)}`}
                    onDelete={() => {
                      setSearchDate('');
                      setDateFilter('all');
                      setCurrentPage(1);
                    }}
                    sx={{ height: 34, fontWeight: 800 }}
                  />
                )}
              </Stack>
            </Box>

            <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 800 }}>
                {visibleBookings.length} bookings
              </Typography>
              <Button size="small" endIcon={<FilterIcon />} onClick={() => handleSort(sortField === 'check_in_date' ? 'guest_name' : 'check_in_date')} sx={{ color: 'text.primary' }}>
                Sort: {sortField === 'guest_name' ? 'Guest' : 'Priority'}
              </Button>
            </Box>

            {visibleBookings.length === 0 && !loading ? (
              <Box textAlign="center" py={6}>
                <Typography variant="h6" color="text.secondary">
                  {totalBookings === 0 ? 'No bookings yet' : 'No bookings match your filters'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {totalBookings === 0 ? 'Create your first booking using the New booking button above' : 'Try adjusting your search or filter criteria'}
                </Typography>
              </Box>
            ) : (
              <Stack divider={<Divider />} sx={{ maxHeight: { lg: 'calc(100vh - 430px)' }, minHeight: 420, overflow: 'auto' }}>
                {visibleBookings.map((booking) => {
                  const isSelected = selectedBooking && String(selectedBooking.id) === String(booking.id);
                  const balance = getBookingBalance(booking);
                  const isPaid = balance <= 0 && ['paid', 'paid_rate'].includes(String(booking.payment_status || '').toLowerCase());
                  const channelInfo = getBookingChannelInfo(booking);

                  return (
                    <Box
                      key={booking.id}
                      onClick={() => {
                        setSelectedBookingId(booking.id);
                        setBookingDetailsOpen(true);
                      }}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '44px 1fr', md: '54px 1fr auto auto' },
                        gap: 1.75,
                        alignItems: 'center',
                        px: 2,
                        py: 1.75,
                        cursor: 'pointer',
                        bgcolor: isSelected ? alpha('#2f6f52', 0.1) : 'background.paper',
                        borderLeft: isSelected ? '4px solid #2f6f52' : '4px solid transparent',
                        opacity: booking.status === 'voided' ? 0.55 : 1,
                      }}
                    >
                      <Box sx={{ width: 46, height: 46, borderRadius: '50%', bgcolor: alpha('#2f6f52', 0.12), color: '#245a42', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
                        {getGuestInitials(booking.guest_name)}
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="subtitle1" sx={{ fontWeight: 900, lineHeight: 1.15 }}>{booking.guest_name}</Typography>
                          {channelInfo && (
                            <Tooltip title={`Online booking via ${channelInfo.name}`} arrow>
                              <Chip
                                size="small"
                                icon={<PublicIcon />}
                                label={channelInfo.abbreviation}
                                sx={{
                                  height: 22,
                                  minWidth: 60,
                                  maxWidth: 'none',
                                  flexShrink: 0,
                                  fontWeight: 900,
                                  bgcolor: channelInfo.background,
                                  color: channelInfo.color,
                                  border: `1px solid ${alpha(channelInfo.color, 0.2)}`,
                                  '& .MuiChip-icon': {
                                    color: channelInfo.color,
                                    fontSize: 14,
                                    ml: 0.65,
                                    mr: -0.35,
                                  },
                                  '& .MuiChip-label': {
                                    px: 0.8,
                                    overflow: 'visible',
                                  },
                                }}
                              />
                            </Tooltip>
                          )}
                          {booking.guest_type && <Chip size="small" label={booking.guest_type.replace(/_/g, ' ').slice(0, 8)} sx={{ height: 22, fontWeight: 800 }} />}
                          <Typography variant="body2" sx={{ color: statusDotColor(booking.status), fontWeight: 800 }}>
                            • {getBookingStatusText(booking.status)}
                          </Typography>
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                          <BedIcon sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.5 }} />
                          Rm {booking.room_number || '-'} · {booking.room_type || 'Room'} · {formatShortDate(booking.check_in_date)} {'->'} {formatShortDate(booking.check_out_date)} · {getNights(booking)}N
                        </Typography>
                      </Box>
                      <Box sx={{ textAlign: { xs: 'left', md: 'right' }, gridColumn: { xs: '2 / span 1', md: 'auto' } }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatCurrency(getBookingTotal(booking))}</Typography>
                        {balance > 0 ? (
                          <Typography variant="body2" color="error.main" sx={{ fontWeight: 800 }}>Due {formatCurrency(balance)}</Typography>
                        ) : (
                          <Typography variant="body2" color="success.main" sx={{ fontWeight: 800 }}>✓ {isPaid ? 'Paid' : getPaymentStatusText(booking.payment_status)}</Typography>
                        )}
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', textAlign: { xs: 'left', md: 'right' }, gridColumn: { xs: '2 / span 1', md: 'auto' } }}>
                        {booking.invoice_number || booking.folio_number || `#${booking.id}`}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}

            {bookingView === 'all' && totalBookings > PAGE_SIZE && (
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">
                  Showing {((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, totalBookings)} of {totalBookings}
                </Typography>
                <Pagination
                  count={Math.ceil(totalBookings / PAGE_SIZE)}
                  page={currentPage}
                  onChange={(_, page) => setCurrentPage(page)}
                  color="primary"
                  size="small"
                  showFirstButton
                  showLastButton
                />
              </Stack>
            )}
          </Card>
        </Grid>

        {selectedBooking && (
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card elevation={0} sx={{ height: '100%', minHeight: 520, overflow: 'hidden' }}>
            <>
              <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Chip
                    size="small"
                    label={getBookingStatusText(selectedBooking.status)}
                    sx={{ bgcolor: alpha(statusDotColor(selectedBooking.status), 0.12), color: statusDotColor(selectedBooking.status), fontWeight: 900 }}
                  />
                  <Tooltip title="Close details" arrow>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setSelectedBookingId(null);
                        setBookingDetailsOpen(false);
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 3 }}>
                  <Box sx={{ width: 58, height: 58, borderRadius: '50%', bgcolor: alpha('#2f6f52', 0.14), color: '#245a42', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1.1rem' }}>
                    {getGuestInitials(selectedBooking.guest_name)}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.1 }}>{selectedBooking.guest_name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      {selectedBooking.invoice_number || selectedBooking.folio_number || selectedBooking.booking_number || `#${selectedBooking.id}`}
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              <>
                <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>Stay</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 2, alignItems: 'center', mt: 1 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">Check-in</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatShortDate(selectedBooking.check_in_date)}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{getNights(selectedBooking)}N</Typography>
                      <ArrowForwardIcon fontSize="small" />
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="caption" color="text.secondary">Check-out</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatShortDate(selectedBooking.check_out_date)}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ width: 38, height: 38, borderRadius: 1.5, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <RoomIcon fontSize="small" />
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{selectedBooking.room_type || 'Room'}</Typography>
                      <Typography variant="body2" color="text.secondary">Room {selectedBooking.room_number || '-'}</Typography>
                    </Box>
                  </Box>
                </Box>

                <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>Charges</Typography>
                  <Stack spacing={1.2} sx={{ mt: 1 }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Room · {getNights(selectedBooking)} x {formatCurrency(Number(selectedBooking.price_per_night || 0))}</Typography>
                      <Typography sx={{ fontWeight: 800 }}>{formatCurrency(getBookingTotal(selectedBooking))}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Tax & fees</Typography>
                      <Typography color="text.secondary">Included</Typography>
                    </Stack>
                    <Divider />
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="subtitle1">Total</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatCurrency(getBookingTotal(selectedBooking))}</Typography>
                    </Stack>
                    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: getBookingBalance(selectedBooking) > 0 ? alpha('#c43d32', 0.08) : alpha('#2f6f52', 0.1), color: getBookingBalance(selectedBooking) > 0 ? '#c43d32' : '#2f6f52', fontWeight: 900 }}>
                      {getBookingBalance(selectedBooking) > 0
                        ? `Due ${formatCurrency(getBookingBalance(selectedBooking))}`
                        : `✓ Fully paid${selectedBooking.payment_method ? ` via ${selectedBooking.payment_method.replace(/_/g, ' ')}` : ''}`}
                    </Box>
                  </Stack>
                </Box>

                <Box sx={{ p: 2.5 }}>
                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>Actions</Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                    {canCheckIn(selectedBooking) && (
                      <Button variant="contained" color="success" startIcon={<LoginIcon />} onClick={() => handleCheckIn(String(selectedBooking.id))}>Check in</Button>
                    )}
                    {canCheckOut(selectedBooking) && (
                      <Button variant="contained" color="warning" startIcon={<CheckOutIcon />} onClick={() => handleCheckOut(selectedBooking)}>Check out</Button>
                    )}
                    {!selectedBooking.is_complimentary && (
                      <Button variant="outlined" color="success" startIcon={<PaymentIcon />} onClick={() => handleUpdatePaymentStatus(selectedBooking)}>Payment</Button>
                    )}
                    <Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => handleViewWorkflow(selectedBooking)}>Workflow</Button>
                    {isAdmin && <Button variant="outlined" startIcon={<EditIcon />} onClick={() => handleEditBooking(selectedBooking)}>Edit</Button>}
                    {['checked_out', 'completed'].includes(selectedBooking.status) && (
                      <Button variant="outlined" startIcon={<ReceiptIcon />} onClick={() => handleViewInvoice(selectedBooking)}>Invoice</Button>
                    )}
                    {canVoid(selectedBooking) && (
                      <Button variant="outlined" color="error" startIcon={<VoidIcon />} onClick={() => handleVoidBooking(selectedBooking)}>Void</Button>
                    )}
                    {canReactivate(selectedBooking) && (
                      <Button variant="outlined" color="success" startIcon={<RestoreIcon />} onClick={() => handleReactivateBooking(selectedBooking)}>Reactivate</Button>
                    )}
                  </Stack>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 2.5 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">Booked via</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 800, textTransform: 'capitalize' }}>{getBookedViaText(selectedBooking)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">Payment</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>{getPaymentStatusText(selectedBooking.payment_status)}</Typography>
                    </Box>
                  </Box>
                </Box>
              </>
            </>
          </Card>
        </Grid>
        )}
      </Grid>

      {/* Booking Workflow Dialog */}
      <Dialog
        open={workflowDialogOpen}
        onClose={() => setWorkflowDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Workflow - {workflowBooking?.booking_number || workflowBooking?.folio_number || `#${workflowBooking?.id}`}
        </DialogTitle>
        <DialogContent dividers>
          {workflowLoading ? (
            <Box sx={{ py: 5, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={2.5}>
              {workflowSummary && (
                <Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">Total</Typography>
                      <Typography variant="subtitle2">{formatCurrency(Number(workflowSummary.total_amount || 0))}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">Paid</Typography>
                      <Typography variant="subtitle2" color="success.main">{formatCurrency(Number(workflowSummary.total_paid || 0))}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">Balance</Typography>
                      <Typography variant="subtitle2" color={Number(workflowSummary.balance_due || 0) > 0 ? 'warning.main' : 'success.main'}>
                        {formatCurrency(Number(workflowSummary.balance_due || 0))}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">Refunded</Typography>
                      <Typography variant="subtitle2" color="info.main">{formatCurrency(Number(workflowSummary.total_refunded || 0))}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip size="small" color="primary" label={workflowSummary.next_action} />
                    <Chip size="small" variant="outlined" label={getPaymentStatusText(workflowSummary.payment_status)} />
                  </Box>
                  {workflowSummary.warnings.length > 0 && (
                    <Alert severity="warning" sx={{ mt: 1.5 }}>
                      {workflowSummary.warnings.join(' / ')}
                    </Alert>
                  )}
                </Box>
              )}

              <Divider />

              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1, flexDirection: { xs: 'column', sm: 'row' }, mb: 1 }}>
                  <Typography variant="subtitle2">Timeline</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {[
                      { label: 'Update', color: '#1976d2' },
                      { label: 'Payment', color: '#2e7d32' },
                      { label: 'Check-in', color: '#ed6c02' },
                      { label: 'Checkout / Void', color: '#d32f2f' },
                    ].map((item) => (
                      <Chip
                        key={item.label}
                        size="small"
                        variant="outlined"
                        label={item.label}
                        sx={{
                          height: 24,
                          fontWeight: 700,
                          borderColor: item.color,
                          color: item.color,
                          bgcolor: `${item.color}14`,
                          '& .MuiChip-label': { px: 1 },
                        }}
                      />
                    ))}
                  </Stack>
                </Box>
                {workflowTimeline.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No workflow events recorded yet.</Typography>
                ) : (
                  <Stack spacing={1.25}>
                    {workflowTimeline.map((event) => {
                      const indicator = getWorkflowEventIndicator(event);

                      return (
                        <Box
                          key={`${event.source}-${event.id}`}
                          sx={{
                            display: 'flex',
                            gap: 1.5,
                            p: 1.25,
                            border: '1px solid',
                            borderColor: indicator.borderColor,
                            borderRadius: 1.5,
                            bgcolor: indicator.backgroundColor,
                          }}
                        >
                          <Box
                            sx={{
                              width: 30,
                              height: 30,
                              borderRadius: '50%',
                              bgcolor: indicator.color,
                              color: 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flex: '0 0 auto',
                            }}
                          >
                            {indicator.icon}
                          </Box>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                              <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                                {event.title}
                                {event.amount && Number(event.amount) !== 0 && (
                                  <Typography component="span" variant="body2" color="text.secondary">
                                    {' '}({formatCurrency(Number(event.amount))})
                                  </Typography>
                                )}
                              </Typography>
                              <Chip
                                size="small"
                                label={indicator.label}
                                sx={{
                                  height: 22,
                                  bgcolor: indicator.color,
                                  color: 'white',
                                  fontWeight: 800,
                                  '& .MuiChip-label': { px: 0.9 },
                                }}
                              />
                            </Box>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(event.created_at).toLocaleString()}
                              {event.status_from && event.status_to ? ` / ${event.status_from} -> ${event.status_to}` : ''}
                            </Typography>
                            {event.description && (
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                                {event.description}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWorkflowDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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
        onRefreshData={reloadBookingData}
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
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Check-In Date"
                type="date"
                value={editFormData.check_in_date || ''}
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, check_in_date: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Check-Out Date"
                type="date"
                value={editFormData.check_out_date || ''}
                onChange={(e) => setEditFormData((prev: any) => ({ ...prev, check_out_date: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
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
                <MenuItem value="voided">Voided</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
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
            {/* Payment Status is intentionally read-only here. It's derived
                live from the payments table on every list query, and any
                override the user types in this form is wiped on the next
                payment touch (record/refund/void/total change). Use the
                "Accept Payment" or "Take Payment" actions to record real
                payment rows — those flip the chip automatically. */}
            <Grid size={{ xs: 12, sm: 6 }}>
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
                <Grid size={{ xs: 12, sm: 6 }}>
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
                <Grid size={{ xs: 12, sm: 6 }}>
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
            <Grid size={12}>
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
            <Grid size={12}>
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
                <Grid size={{ xs: 12, sm: 6 }}>
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
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Alert severity="info" sx={{ height: '100%', display: 'flex', alignItems: 'center' }}>
                    Guest: <strong>{editingBooking?.guest_name}</strong>
                  </Alert>
                </Grid>
              </>
            ) : (
              <Grid size={12}>
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

      {/* Accept Payment Dialog — records a real payments row; the backend
          recompute then flips bookings.payment_status automatically. */}
      <Dialog
        open={paymentDialogOpen}
        onClose={() => {
          setPaymentDialogOpen(false);
          setPaymentBooking(null);
          setPaymentAmount(0);
          setPaymentMethod('Cash');
          setPaymentNote('');
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ p: 0 }}>
          <Box sx={{ px: 3, py: 2.5, display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: alpha('#2aa198', 0.12), color: '#16877f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <PaymentIcon />
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.15 }}>
                Accept Payment
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Record a room charge payment and update the booking balance automatically.
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ px: 3, py: 2.5 }}>
          {paymentBooking && (
            <Stack spacing={2.25}>
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="flex-start">
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900 }}>
                      Booking
                    </Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900, fontFamily: 'monospace', lineHeight: 1.25 }}>
                      {paymentBooking.booking_number || paymentBooking.folio_number || `#${paymentBooking.id}`}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {paymentBooking.guest_name} · Room {paymentBooking.room_number}
                    </Typography>
                  </Box>
                  <Chip
                    label={getPaymentStatusText(paymentBooking.payment_status)}
                    color={getPaymentStatusColor(paymentBooking.payment_status)}
                    size="small"
                    sx={{ fontWeight: 800 }}
                  />
                </Stack>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.25 }}>
                {[
                  { label: 'Total', value: formatCurrency(Number(paymentBooking.total_amount || 0)), color: 'text.primary' },
                  { label: 'Paid', value: formatCurrency(Number(paymentBooking.total_paid || 0)), color: 'success.main' },
                  { label: 'Balance', value: formatCurrency(Number(paymentBooking.balance_due || 0)), color: Number(paymentBooking.balance_due || 0) > 0 ? 'error.main' : 'success.main' },
                ].map((item) => (
                  <Box key={item.label} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                      {item.label}
                    </Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900, color: item.color }}>
                      {item.value}
                    </Typography>
                  </Box>
                ))}
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <TextField
                  fullWidth
                  type="number"
                  label="Payment Amount"
                  value={paymentAmount || ''}
                  onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }}
                  inputProps={{ min: 0, step: 0.01 }}
                  required
                />
                <FormControl fullWidth>
                  <InputLabel>Payment Method</InputLabel>
                  <Select
                    value={paymentMethod}
                    label="Payment Method"
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <MenuItem key={m} value={m}>{m}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <TextField
                fullWidth
                multiline
                rows={3}
                label="Payment Note (Optional)"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder="e.g., Receipt #12345, card terminal approval, bank transfer reference..."
                helperText="Recorded as a booking payment. Status and balance update automatically."
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'background.paper' }}>
          <Button onClick={() => {
            setPaymentDialogOpen(false);
            setPaymentBooking(null);
            setPaymentAmount(0);
            setPaymentMethod('Cash');
            setPaymentNote('');
          }}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmPaymentUpdate}
            variant="contained"
            color="primary"
            disabled={paymentAmount <= 0 || updatingPayment}
          >
            {updatingPayment ? 'Processing...' : 'Accept Payment'}
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
              <Box sx={{ p: 2, mb: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Booking #{checkinBooking.booking_number}
                </Typography>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid size={12}>
                    <Typography variant="h6" fontWeight={600}>{checkinBooking.guest_name}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Check-in</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {new Date(checkinBooking.check_in_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Check-out</Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {new Date(checkinBooking.check_out_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Room Type</Typography>
                    <Typography variant="body2" fontWeight={500}>{checkinBooking.room_type}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                    <Typography variant="body2" fontWeight={500}>{formatCurrency(Number(checkinBooking.total_amount || 0))}</Typography>
                  </Grid>
                </Grid>
              </Box>

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
                  <Grid size={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Payment Method</InputLabel>
                      <Select value={ciPaymentMethod} onChange={(e) => setCiPaymentMethod(e.target.value)} label="Payment Method">
                        {PAYMENT_METHODS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={6}>
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
                  <Grid size={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Deposit Method</InputLabel>
                      <Select value={ciDepositMethod} onChange={(e) => setCiDepositMethod(e.target.value)} label="Deposit Method">
                        {PAYMENT_METHODS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={6}>
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
