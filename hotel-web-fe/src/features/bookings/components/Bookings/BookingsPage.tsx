import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  MoreTime as EarlyCheckInIcon,
  Restore as RestoreIcon,
  History as HistoryIcon,
  Edit as EditIcon,
  Close as CloseIcon,
  Bed as BedIcon,
  MeetingRoom as RoomIcon,
  Add as AddIcon,
  Public as PublicIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import { BookingsService, GuestsService, RoomsService } from '../../../../api';
import { ReportsService, type BookingChannel } from '../../../../api/reports.service';
import { queryStaleTime } from '../../../../api/queryConfig';
import { queryKeys } from '../../../../api/queryKeys';

import {
  BookingTimelineEntry,
  BookingWithDetails,
  BookingUpdateRequest,
  BookingEditFormData,
  CheckInRequest,
  PaymentWorkflowSummary,
  Room,
  Guest,
  RoomType,
} from '../../../../types';
import { getBookingStatusColor, getBookingStatusText, getPaymentStatusColor, getPaymentStatusText } from '../../../../utils/bookingUtils';
import { useAuth } from '../../../../auth/AuthContext';
import { useCurrency } from '../../../../hooks/useCurrency';
import { useSearchParams } from '../../../../router';
import CheckoutInvoiceModals from '../../../invoices/components/CheckoutInvoiceModals';
import { useCheckoutFlow } from '../../../invoices/hooks/useCheckoutFlow';
import { LedgerService } from '../../../../api/ledger.service';
import UnifiedBookingModal from '../../../rooms/components/UnifiedBooking';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { getBookedViaText, getBookingChannelInfo } from '../../utils/bookingChannel';
import { useBookings, PAGE_SIZE, SortField, DateFilter } from '../../hooks/useBookings';
import {
  useBookingWorkflowFetcher,
  useActiveCompanies,
  useBookingsWithDetails,
  useCheckInGuestMutation,
  useMarkBookingComplimentaryMutation,
  useReactivateBookingMutation,
  useRecordPaymentMutation,
  useUpdateBooking,
} from '../../hooks/useBookingQueries';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { getPaginationState } from '../../../../utils/pagination';
import { formatHotelDate, formatLocalDate, parseLocalDate } from '../../../../utils/date';
import { addMoney, compareMoney, divideMoney, isGreaterMoney, isLessMoney, isPositiveMoney, multiplyMoney, subtractMoney, sumMoney, toMoneyNumber } from '../../../../utils/money';
import type { Company } from '../../../../types';

type BookingView = 'all' | 'arriving' | 'in_house' | 'departing' | 'upcoming' | 'balance' | 'normal_balance' | 'company_balance';
type BookingCompanyOption = Partial<Company> & { company_name: string; id?: number };
type SummaryStatCard = {
  title: string;
  value: string | number;
  detail: string;
  subValue?: number;
  color: string;
  icon: React.ReactNode;
  view: BookingView;
  alert?: boolean;
};
const COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT = 1;

function getErrorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

const addMonthsToDateOnly = (dateOnly: string, months: number) => {
  const base = parseLocalDate(dateOnly);
  const targetMonthIndex = base.getMonth() + months;
  const targetMonthStart = new Date(base.getFullYear(), targetMonthIndex, 1);
  const targetMonthDays = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();

  return formatLocalDate(new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(base.getDate(), targetMonthDays),
  ));
};

const BookingsPage: React.FC = () => {
  const [pageSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const PAYMENT_METHODS = getHotelSettings().payment_methods;
  const ONLINE_CHANNELS = getHotelSettings()
    .booking_channels.map((channel) => channel.name?.trim())
    .filter((name): name is string => Boolean(name));
  const isAdmin = hasPermission('bookings:update') || hasPermission('bookings:manage');
  const updateBookingMutation = useUpdateBooking();
  const reactivateBookingMutation = useReactivateBookingMutation();
  const markComplimentaryMutation = useMarkBookingComplimentaryMutation();
  const recordPaymentMutation = useRecordPaymentMutation();
  const checkInGuestMutation = useCheckInGuestMutation();

  // Shared checkout + read-only receipt flow. Bookings keeps its react-query
  // mutation (cache invalidation) and lets the backend mark the room dirty.
  const checkoutFlow = useCheckoutFlow({
    updateBooking: (bookingId, data) => updateBookingMutation.mutateAsync({ bookingId: String(bookingId), data }),
    setRoomDirty: false,
    onAfterCheckout: () => reloadBookingData(),
    successMessage: () => 'Guest checked out successfully!',
    notify: (message) => showSnackbar(message),
  });

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
    paymentMethodFilter,
    setPaymentMethodFilter,
    onlineChannelFilter,
    setOnlineChannelFilter,
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
    monthSearch,
    setMonthSearch,
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
  // IC is collected at check-in (optional at booking creation); phone optional.
  const [ciIcNumber, setCiIcNumber] = useState('');
  const [ciPhone, setCiPhone] = useState('');
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [workflowBooking, setWorkflowBooking] = useState<BookingWithDetails | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<PaymentWorkflowSummary | null>(null);
  const [workflowTimeline, setWorkflowTimeline] = useState<BookingTimelineEntry[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | number | null>(null);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(true);
  const [bookingView, setBookingView] = useState<BookingView>('all');
  const routedBookingSearch = pageSearchParams.get('search') || '';
  const routedBookingId = pageSearchParams.get('booking_id') || '';
  const summaryBookingsQuery = useBookingsWithDetails();
  const fetchBookingWorkflow = useBookingWorkflowFetcher();
  const summaryBookings = summaryBookingsQuery.data ?? [];
  const summaryLoaded = summaryBookingsQuery.isSuccess;

  useEffect(() => {
    if (!routedBookingSearch && !routedBookingId) return;

    const nextSearch = routedBookingSearch || routedBookingId;
    setBookingView('all');
    setSearchQuery(nextSearch);
    setRoomNumberFilter('');
    setPaymentMethodFilter('');
    setStatusFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSearchDate('');
    setCurrentPage(1);
    if (routedBookingId) {
      setSelectedBookingId(routedBookingId);
      setBookingDetailsOpen(true);
    }
  }, [
    routedBookingSearch,
    routedBookingId,
    setSearchQuery,
    setRoomNumberFilter,
    setPaymentMethodFilter,
    setStatusFilter,
    setDateFilter,
    setCustomStartDate,
    setCustomEndDate,
    setSearchDate,
    setCurrentPage,
  ]);

  // Create booking dialog (using UnifiedBookingModal)
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Edit booking dialog (admin only)
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);
  const [editFormData, setEditFormData] = useState<BookingEditFormData>({});
  const [editRoomTypeConfig, setEditRoomTypeConfig] = useState<RoomType | null>(null);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [bookingChannels, setBookingChannels] = useState<BookingChannel[]>([]);
  const [updating, setUpdating] = useState(false);
  const activeCompaniesQuery = useActiveCompanies(isAdmin && editDialogOpen);
  const activeCompanies: BookingCompanyOption[] = useMemo(
    () => activeCompaniesQuery.data ?? [],
    [activeCompaniesQuery.data]
  );
  const selectedEditCompany = useMemo<BookingCompanyOption | null>(() => {
    const companyName = String(editFormData.company_name || '').trim();
    const companyId = editFormData.company_id == null || editFormData.company_id === ''
      ? null
      : Number(editFormData.company_id);

    if (!companyId && !companyName) return null;

    const matchedCompany = activeCompanies.find((company) => (
      (companyId != null && company.id === companyId)
      || (companyName !== '' && company.company_name.toLowerCase() === companyName.toLowerCase())
    ));

    return matchedCompany || { id: companyId ?? undefined, company_name: companyName };
  }, [activeCompanies, editFormData.company_id, editFormData.company_name]);

  useEffect(() => {
    if (!isAdmin) return;
    ReportsService.listBookingChannels()
      .then((channels) => setBookingChannels(channels.filter((channel) => channel.is_active)))
      .catch(() => setBookingChannels([]));
  }, [isAdmin]);

  const selectedEditBookingChannel = useMemo(() => {
    const channelId = editFormData.booking_channel_id == null || editFormData.booking_channel_id === ''
      ? null
      : Number(editFormData.booking_channel_id);
    return bookingChannels.find((channel) => channel.id === channelId) || null;
  }, [bookingChannels, editFormData.booking_channel_id]);

  const editBookingUsesOta = selectedEditBookingChannel?.channel_type === 'ota'
    || String(editFormData.source || '').toLowerCase() === 'online';



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
  const [paymentDialogContext, setPaymentDialogContext] = useState<'manual' | 'checkout_required'>('manual');
  const [updatingPayment, setUpdatingPayment] = useState(false);

  const showSnackbar = (message: string) => {
    emitApiNotification({ message, severity: 'success' });
  };

  const sortRoomsByNumber = (roomList: Room[]) => {
    return [...roomList].sort((a, b) => {
      const numA = parseInt(a.room_number, 10);
      const numB = parseInt(b.room_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.room_number.localeCompare(b.room_number);
    });
  };

  const reloadBookingData = async () => {
    await Promise.all([loadData(), summaryBookingsQuery.refetch()]);
  };

  // Server handles all filtering and sorting — bookings is already the correct page
  const filteredAndSortedBookings = bookings;

  const handleEditBooking = (booking: BookingWithDetails) => {
    setEditingBooking(booking);

    // Get the booking's room rate (price_per_night) - this contains the override if one was set
    const bookingRate = toMoneyNumber(booking.price_per_night);

    const extraBedCount = booking.extra_bed_count || 0;
    const extraBedCharge = toMoneyNumber(booking.extra_bed_charge);

    const formData = {
      status: booking.status,
      payment_status: booking.payment_status || 'unpaid',
      payment_method: booking.payment_method
        ? booking.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : '',
      source: booking.source || 'walk_in',
      booking_channel_id: booking.booking_channel_id ?? '',
      ota_reference: booking.ota_reference || '',
      check_in_date: booking.check_in_date.split('T')[0],
      check_out_date: booking.check_out_date.split('T')[0],
      // Actual checkout date (date portion only) — editable so staff can correct
      // a backdated / mis-recorded stay. Empty until the booking is checked out.
      actual_check_out: booking.actual_check_out ? booking.actual_check_out.split('T')[0] : '',
      post_type: booking.post_type || 'normal_stay',
      rate_code: booking.rate_code || 'RACK',
      deposit_paid: booking.deposit_paid || false,
      remarks: booking.remarks || '',
      special_requests: booking.special_requests || '',
      // Use the booking's room rate directly (this is the override rate if one was set)
      price_per_night: bookingRate,
      has_override: isPositiveMoney(bookingRate),
      extra_bed_count: extraBedCount,
      extra_bed_charge: extraBedCharge,
      room_id: booking.room_id,
      company_id: booking.company_id ?? null,
      company_name: booking.company_name || '',
    };
    setEditFormData(formData);

    // Load room type config for extra bed settings
    queryClient.ensureQueryData({
      queryKey: queryKeys.roomTypes.list(),
      queryFn: () => RoomsService.getAllRoomTypes(),
      staleTime: queryStaleTime.long,
    }).then(roomTypes => {
      const matched = roomTypes.find(rt => rt.name === booking.room_type);
      setEditRoomTypeConfig(matched || null);
    }).catch(() => setEditRoomTypeConfig(null));

    // Fetch available rooms for the booking dates (for room change dropdown)
    const isNotCheckedIn = !['checked_in', 'auto_checked_in', 'checked_out', 'completed'].includes(booking.status);
    if (isNotCheckedIn) {
      const checkIn = booking.check_in_date.split('T')[0];
      const checkOut = booking.check_out_date.split('T')[0];
      const bookingId = typeof booking.id === 'string' ? parseInt(booking.id, 10) : booking.id;
      queryClient.ensureQueryData({
        queryKey: queryKeys.rooms.available(checkIn, checkOut, bookingId),
        queryFn: () => RoomsService.getAvailableRoomsForDates(checkIn, checkOut, bookingId),
        staleTime: queryStaleTime.short,
      }).then(available => {
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
    const checkInDate = editFormData.check_in_date;
    const checkOutDate = editFormData.check_out_date;
    if (!checkInDate || !checkOutDate) return;
    const isNotCheckedIn = !['checked_in', 'auto_checked_in', 'checked_out', 'completed'].includes(editingBooking.status);
    if (!isNotCheckedIn) return;

    const bookingId = typeof editingBooking.id === 'string' ? parseInt(editingBooking.id, 10) : editingBooking.id;
    queryClient.ensureQueryData({
      queryKey: queryKeys.rooms.available(checkInDate, checkOutDate, bookingId),
      queryFn: () => RoomsService.getAvailableRoomsForDates(checkInDate, checkOutDate, bookingId),
      staleTime: queryStaleTime.short,
    }).then(available => {
      setAvailableRooms(sortRoomsByNumber(available));
    }).catch(() => {
      setAvailableRooms(sortRoomsByNumber(rooms));
    });
  }, [editDialogOpen, editingBooking, editFormData.check_in_date, editFormData.check_out_date, queryClient, rooms]);

  const handleUpdateBooking = async () => {
    if (!editingBooking) return;

    try {
      setUpdating(true);

      // Get the original booking rate
      const originalPrice = toMoneyNumber(editingBooking.price_per_night);

      const newPrice = toMoneyNumber(editFormData.price_per_night);
      const priceChanged = isPositiveMoney(Math.abs(subtractMoney(newPrice, originalPrice)));

      // Include room_id only if it changed (compare as strings to avoid type mismatch)
      const roomChanged = editFormData.room_id && String(editFormData.room_id) !== String(editingBooking.room_id);
      const companyCleared = Boolean(editingBooking.company_id || editingBooking.company_name) &&
        !editFormData.company_id &&
        !String(editFormData.company_name || '').trim();

      const updateData = {
        ...editFormData,
        payment_method: editFormData.payment_method || null,
        // Always send room_rate_override if there's a price value
        room_rate_override: isPositiveMoney(newPrice) ? newPrice : undefined,
        extra_bed_count: editFormData.extra_bed_count || 0,
        extra_bed_charge: editFormData.extra_bed_charge || 0,
        company_id: editFormData.company_id || undefined,
        company_name: String(editFormData.company_name || '').trim() || undefined,
        clear_company: companyCleared || undefined,
      };
      // Remove fields that are not valid backend fields
      delete updateData.price_per_night;
      delete updateData.has_override;
      if (!editFormData.booking_channel_id) {
        delete updateData.booking_channel_id;
      }
      if (!String(editFormData.ota_reference || '').trim()) {
        delete updateData.ota_reference;
      }
      // Only send actual_check_out when a value is set; an empty string would
      // fail backend date parsing and must not clobber the stored timestamp.
      if (!editFormData.actual_check_out) {
        delete updateData.actual_check_out;
      }
      // Only include room_id if room was changed, and send as string for backend compatibility
      if (roomChanged) {
        updateData.room_id = String(editFormData.room_id);
      } else {
        delete updateData.room_id;
      }

      await updateBookingMutation.mutateAsync({ bookingId: editingBooking.id, data: updateData });
      showSnackbar('Booking updated successfully!');
      setEditDialogOpen(false);
      await reloadBookingData();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to update booking');
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
      const result = await BookingsService.voidBooking({
        booking_id: voidingBooking.id,
        reason: voidReason.trim() || 'Voided by admin',
      });
      const affectedDates = result.affected_night_audit_dates || [];
      showSnackbar(
        affectedDates.length > 0
          ? `Booking voided successfully. Rerun night audit for ${affectedDates.join(', ')} to refresh reports.`
          : 'Booking voided successfully'
      );
      setVoidDialogOpen(false);
      setVoidingBooking(null);
      setVoidReason('');
      await reloadBookingData();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to void booking');
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
      await reactivateBookingMutation.mutateAsync(reactivatingBooking.id);
      showSnackbar('Booking reactivated successfully!');
      setReactivateDialogOpen(false);
      setReactivatingBooking(null);
      await reloadBookingData();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to reactivate booking');
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
    const pricePerNight = divideMoney(complimentaryBooking.total_amount, totalNights);
    return multiplyMoney(pricePerNight, paidNights).toFixed(2);
  };

  const handleConfirmComplimentary = async () => {
    if (!complimentaryBooking || !complimentaryStartDate || !complimentaryEndDate) return;

    try {
      setMarkingComplimentary(true);
      const result = await markComplimentaryMutation.mutateAsync({
        bookingId: complimentaryBooking.id,
        reason: complimentaryReason || 'Marked as complimentary',
        startDate: complimentaryStartDate,
        endDate: complimentaryEndDate,
      });

      const statusText = result.status === 'fully_complimentary'
        ? 'fully complimentary'
        : 'partially complimentary';

      showSnackbar(
        `Booking marked as ${statusText}! ${result.complimentary_nights} of ${result.total_nights} nights are complimentary. ` +
        `New total: ${formatCurrency(toMoneyNumber(result.new_total))}`
      );
      setComplimentaryDialogOpen(false);
      setComplimentaryBooking(null);
      setComplimentaryReason('');
      setComplimentaryStartDate('');
      setComplimentaryEndDate('');
      await reloadBookingData();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to mark booking as complimentary');
    } finally {
      setMarkingComplimentary(false);
    }
  };

  // Payment status handlers
  const handleUpdatePaymentStatus = (booking: BookingWithDetails) => {
    setPaymentBooking(booking);
    const balanceDue = toMoneyNumber(booking.balance_due);
    const totalAmount = toMoneyNumber(booking.total_amount);
    setPaymentAmount(isPositiveMoney(balanceDue) ? balanceDue : totalAmount);
    setPaymentMethod(booking.payment_method || 'Cash');
    setPaymentNote('');
    setPaymentDialogContext('manual');
    setPaymentDialogOpen(true);
  };

  const handleConfirmPaymentUpdate = async () => {
    if (!paymentBooking) return;
    if (!Number.isFinite(paymentAmount) || !isPositiveMoney(paymentAmount)) {
      setError('Payment amount must be greater than 0.');
      return;
    }
    const requiredCheckoutBalance = getBookingBalance(paymentBooking);
    if (paymentDialogContext === 'checkout_required' && isLessMoney(paymentAmount, requiredCheckoutBalance)) {
      setError('Payment amount must cover the full outstanding balance before checkout.');
      return;
    }
    // Block overpayment — a payment can never exceed the outstanding balance.
    if (isGreaterMoney(paymentAmount, requiredCheckoutBalance)) {
      setError(`Payment amount cannot exceed the outstanding balance of ${formatCurrency(requiredCheckoutBalance)}.`);
      return;
    }

    try {
      setUpdatingPayment(true);
      // Insert a real `payments` row (payment_type='booking'). The backend
      // recompute_payment_status helper will flip the chip automatically.
      await recordPaymentMutation.mutateAsync({
        booking_id: Number(paymentBooking.id),
        amount: paymentAmount,
        payment_method: paymentMethod,
        payment_type: 'booking',
        transaction_reference: paymentDialogContext === 'checkout_required'
          ? `checkout-${paymentBooking.id}-${paymentAmount.toFixed(2)}`
          : undefined,
        notes: paymentNote.trim() || `Payment accepted (${paymentMethod})`,
      });

      // Work out what's still owed after this payment.
      const prevBalance = getBookingBalance(paymentBooking);
      const prevPaid = toMoneyNumber(paymentBooking.total_paid);
      const nextBalance = subtractMoney(prevBalance, paymentAmount);
      const remainingBalance = isPositiveMoney(nextBalance) ? nextBalance : 0;
      const fullySettled = !isPositiveMoney(remainingBalance);

      await reloadBookingData();

      // Checkout-required payments always cover the full balance, so they close.
      if (paymentDialogContext === 'checkout_required' || fullySettled) {
        showSnackbar(
          paymentDialogContext === 'checkout_required'
            ? `Payment of ${formatCurrency(paymentAmount)} accepted via ${paymentMethod}. Continue checkout when ready.`
            : `Payment of ${formatCurrency(paymentAmount)} accepted via ${paymentMethod}`
        );
        setPaymentDialogOpen(false);
        setPaymentBooking(null);
        setPaymentAmount(0);
        setPaymentMethod('Cash');
        setPaymentNote('');
        setPaymentDialogContext('manual');
      } else {
        // Balance still outstanding — keep the window open and re-arm the form
        // for the next payment.
        showSnackbar(`Payment of ${formatCurrency(paymentAmount)} accepted via ${paymentMethod}. Balance still outstanding.`);
        setPaymentBooking({
          ...paymentBooking,
          total_paid: addMoney(prevPaid, paymentAmount),
          balance_due: remainingBalance,
          payment_status: 'partial',
        });
        setPaymentAmount(remainingBalance);
        setPaymentNote('');
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to accept payment');
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
      const totalAmt = toMoneyNumber(booking.total_amount);
      const settingsDeposit = getHotelSettings().deposit_amount;
      setCheckinBooking(booking);
      setCiPaymentChoice(booking.payment_status === 'paid' ? 'pay_now' : 'pay_later');
      setCiPaymentMethod(booking.payment_method || 'Cash');
      setCiAmountPaid(totalAmt);
      setCiDepositChoice('receive');
      setCiDepositAmount(settingsDeposit);
      setCiDepositMethod('Cash');
      setCiWaiveReason('');
      setCiIcNumber('');
      setCiPhone(booking.guest_phone || '');
      setShowCheckinModal(true);

      // Back-fill IC / phone from the guest profile (booking summary omits IC).
      if (booking.guest_id !== undefined && booking.guest_id !== null) {
        GuestsService.getGuest(booking.guest_id)
          .then((guest) => {
            setCiIcNumber((current) => (current.trim() ? current : guest.ic_number || ''));
            setCiPhone((current) => (current.trim() ? current : guest.phone || ''));
          })
          .catch(() => { /* leave for manual entry */ });
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to load check-in data');
    }
  };

  const handleConfirmCheckIn = async () => {
    if (!checkinBooking) return;
    if (!ciIcNumber.trim()) {
      setError('IC / passport number is required to complete check-in.');
      return;
    }
    if (ciDepositChoice === 'receive' && !isPositiveMoney(ciDepositAmount)) {
      setError('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.');
      return;
    }
    try {
      setProcessingCheckIn(true);
      // Single atomic request: deposit fields + payment + the status flip all go
      // through the check-in endpoint, which commits them in one transaction.
      // (Don't push payment_status — recording the payments row is what flips the
      // derived status; an override would be overwritten by the backend anyway.)
      const bookingUpdate: BookingUpdateRequest = {};
      if (ciPaymentChoice === 'pay_now') {
        bookingUpdate.payment_method = ciPaymentMethod;
      }
      if (ciDepositChoice === 'receive') {
        bookingUpdate.deposit_paid = true;
        bookingUpdate.deposit_amount = toMoneyNumber(ciDepositAmount);
        bookingUpdate.payment_note = `Deposit received (${ciDepositMethod})`;
      } else {
        bookingUpdate.deposit_paid = false;
        bookingUpdate.deposit_amount = 0;
        bookingUpdate.payment_note = `Deposit waived: ${ciWaiveReason}`;
      }
      const checkinPayload: CheckInRequest = {
        booking_update: bookingUpdate,
        guest_update: {
          ic_number: ciIcNumber.trim(),
          ...(ciPhone.trim() ? { phone: ciPhone.trim() } : {}),
        },
      };
      if (ciPaymentChoice === 'pay_now' && isPositiveMoney(ciAmountPaid)) {
        checkinPayload.payment_record = {
          amount: toMoneyNumber(ciAmountPaid),
          payment_method: ciPaymentMethod,
          payment_type: 'booking',
          notes: 'Payment collected at check-in',
        };
      }
      await checkInGuestMutation.mutateAsync({ bookingId: checkinBooking.id, data: checkinPayload });
      setShowCheckinModal(false);
      setCheckinBooking(null);
      showSnackbar('Guest checked in successfully!');
      await reloadBookingData();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to check in guest');
    } finally {
      setProcessingCheckIn(false);
    }
  };

  // View invoice for checked-out bookings. For company city-ledger bookings the
  // payments live on the customer ledger (not the booking `payments` table), so
  // look up the backing room-charge ledger and pass it through — the invoice
  // then renders the ledger's payment history, same as the ledger page.
  const handleViewInvoice = async (booking: BookingWithDetails) => {
    const isCompanyBilling = Boolean(booking.company_id || booking.company_name?.trim());
    if (!isCompanyBilling) {
      checkoutFlow.openReceipt(booking);
      return;
    }
    try {
      const ledger = await LedgerService.getRoomChargeLedgerForBooking(
        Number(booking.id),
        booking.room_number,
      );
      checkoutFlow.openReceipt(booking, ledger);
    } catch {
      // Fall back to the booking-sourced receipt if the ledger lookup fails.
      checkoutFlow.openReceipt(booking);
    }
  };

  const handleViewWorkflow = async (booking: BookingWithDetails) => {
    setWorkflowBooking(booking);
    setWorkflowDialogOpen(true);
    setWorkflowLoading(true);
    setWorkflowSummary(null);
    setWorkflowTimeline([]);

    try {
      const [summary, timeline] = await fetchBookingWorkflow(booking.id);
      setWorkflowSummary(summary);
      setWorkflowTimeline(timeline);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to load booking workflow');
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
    const balanceDue = getBookingBalance(booking);
    if (isPositiveMoney(balanceDue) && !isCompanyBooking(booking)) {
      setPaymentBooking(booking);
      setPaymentAmount(balanceDue);
      setPaymentMethod(booking.payment_method || 'Cash');
      setPaymentNote('Required before checkout');
      setPaymentDialogContext('checkout_required');
      setPaymentDialogOpen(true);
      return;
    }

    checkoutFlow.openCheckout(booking);
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

  // True when checking in before the hotel's configured check-in time, i.e. the
  // guest's scheduled check-in moment (arrival date at the configured time) has
  // not yet passed. Used to surface an "early check-in" affordance.
  const isEarlyCheckIn = (booking: BookingWithDetails) => {
    const configuredTime = getHotelSettings().check_in_time || '15:00';
    const [hours, minutes] = configuredTime.split(':').map(Number);
    const scheduledCheckIn = parseLocalDate(getDateOnly(booking.check_in_date));
    if (Number.isNaN(scheduledCheckIn.getTime())) return false;
    scheduledCheckIn.setHours(hours || 0, minutes || 0, 0, 0);
    return new Date() < scheduledCheckIn;
  };

  const canCheckOut = (booking: BookingWithDetails) => {
    const status = booking.status;
    return status === 'checked_in';
  };

  const canVoid = (booking: BookingWithDetails) => {
    return booking.status !== 'voided';
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

  const todayIso = useMemo(() => formatLocalDate(), []);

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

  const formatShortMonth = (value?: string) => {
    if (!value) return '-';
    const [year, month] = value.split('-').map(Number);
    if (!year || !month) return '-';
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };

  const monthOptions = useMemo(() => {
    const now = new Date();
    const options: { value: string; label: string }[] = [];
    for (let offset = -12; offset <= 12; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      options.push({ value, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) });
    }
    return options;
  }, []);

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

  const getBookingBalance = (booking: BookingWithDetails | null) => toMoneyNumber(booking?.balance_due);
  const getBookingTotal = (booking: BookingWithDetails | null) => toMoneyNumber(booking?.total_amount);
  const isCompanyBooking = (booking: BookingWithDetails) => Boolean(booking.company_id || booking.company_name?.trim());
  const getBillingChipLabel = (booking: BookingWithDetails) => {
    if (isCompanyBooking(booking)) return 'Company Billing';
    if (!booking.guest_type) return null;
    return booking.guest_type === 'non_member' ? 'Non-member' : 'Member';
  };
  const hasOutstandingBalance = useCallback(
    (booking: BookingWithDetails) => booking.status !== 'voided' && isPositiveMoney(getBookingBalance(booking)),
    []
  );
  const getKnownNightAuditDates = (booking: BookingWithDetails | null) => {
    if (!booking) return [];
    const dates = new Set<string>();
    if (booking.posted_date) dates.add(getDateOnly(booking.posted_date));
    return Array.from(dates).filter(Boolean).sort();
  };
  const isNightAuditInvolved = (booking: BookingWithDetails | null) =>
    Boolean(booking?.is_posted || getKnownNightAuditDates(booking).length > 0);
  const isPastCheckoutWithBalance = useCallback((booking: BookingWithDetails) => {
    const checkOutDate = getDateOnly(booking.check_out_date);
    return Boolean(checkOutDate) && checkOutDate < todayIso && hasOutstandingBalance(booking);
  }, [todayIso, hasOutstandingBalance]);
  const isCompanyPastTermsWithBalance = useCallback((booking: BookingWithDetails) => {
    const checkOutDate = getDateOnly(booking.check_out_date);
    if (!checkOutDate || !hasOutstandingBalance(booking)) return false;

    return addMonthsToDateOnly(checkOutDate, COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT) <= todayIso;
  }, [todayIso, hasOutstandingBalance]);
  const operationsBookings = summaryLoaded ? summaryBookings : bookings;
  const bookingPagination = useMemo(
    () => getPaginationState({ page: currentPage, pageSize: PAGE_SIZE, totalItems: totalBookings }),
    [currentPage, totalBookings]
  );

  const normalDueBookings = useMemo(
    () => operationsBookings.filter((booking) => !isCompanyBooking(booking) && isPastCheckoutWithBalance(booking)),
    [operationsBookings, isPastCheckoutWithBalance]
  );
  const companyDueBookings = useMemo(
    () => operationsBookings.filter((booking) => isCompanyBooking(booking) && isCompanyPastTermsWithBalance(booking)),
    [operationsBookings, isCompanyPastTermsWithBalance]
  );
  const dueBookings = useMemo(
    () => operationsBookings.filter((booking) =>
      isCompanyBooking(booking)
        ? isCompanyPastTermsWithBalance(booking)
        : isPastCheckoutWithBalance(booking)
    ),
    [operationsBookings, isCompanyPastTermsWithBalance, isPastCheckoutWithBalance]
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
    if (bookingView === 'normal_balance') return normalDueBookings;
    if (bookingView === 'company_balance') return companyDueBookings;
    return filteredAndSortedBookings;
  }, [arrivingBookings, bookingView, companyDueBookings, departingBookings, dueBookings, filteredAndSortedBookings, inHouseBookings, normalDueBookings, upcomingBookings]);

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

  const totalGuestsInHouse = inHouseBookings.reduce((sum, booking) => sum + Number(booking.adults || 1) + Number(booking.children || 0), 0);
  const roomCount = rooms.length || 0;
  const normalOutstandingDue = normalDueBookings.reduce((sum, booking) => sumMoney([sum, getBookingBalance(booking)]), 0);
  const companyOutstandingDue = companyDueBookings.reduce((sum, booking) => sumMoney([sum, getBookingBalance(booking)]), 0);
  const normalBalanceScope = summaryLoaded ? 'past checkout date' : 'past checkout date on this page';
  const companyBalanceScope = summaryLoaded ? `past ${COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT} month from checkout` : `past ${COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT} month from checkout on this page`;
  const paymentActionDetail = `${formatCurrency(normalOutstandingDue)} normal outstanding`;

  const selectBookingView = (view: BookingView) => {
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
    } else if (view === 'balance' || view === 'normal_balance' || view === 'company_balance') {
      setStatusFilter('all');
      setDateFilter('all');
      setSearchDate('');
    }
  };

  const handleTakePaymentAction = () => {
    selectBookingView('normal_balance');
    if (normalDueBookings.length > 0) {
      setSelectedBookingId(normalDueBookings[0].id);
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

  const voidingAuditDates = getKnownNightAuditDates(voidingBooking);
  const voidingNeedsAuditReview = isNightAuditInvolved(voidingBooking);
  const summaryStatCards: SummaryStatCard[] = [
    {
      title: 'Arrivals / Check-in',
      value: arrivingBookings.length,
      detail: `${arrivingBookings.filter(canCheckIn).length} ready to check in`,
      subValue: arrivingBookings.length || stats.todayCheckIns || 1,
      color: '#2f6f52',
      icon: <ArrowForwardIcon fontSize="small" />,
      view: 'arriving',
    },
    {
      title: 'In-house guests',
      value: totalGuestsInHouse,
      detail: `across ${inHouseBookings.length} rooms`,
      subValue: Math.max(totalGuestsInHouse, roomCount || 1),
      color: '#2f64b3',
      icon: <BedIcon fontSize="small" />,
      view: 'in_house',
    },
    {
      title: 'Departures / Check-out',
      value: departingBookings.length,
      detail: `${departingBookings.length} ready to check out`,
      subValue: departingBookings.length || 1,
      color: '#c47b1e',
      icon: <ArrowBackIcon fontSize="small" />,
      view: 'departing',
    },
    {
      title: 'Upcoming bookings',
      value: upcomingBookings.length,
      detail: `${upcomingBookings.length} future reservations`,
      subValue: upcomingBookings.length || 1,
      color: '#7c4dff',
      icon: <BookIcon fontSize="small" />,
      view: 'upcoming',
    },
    ...(isPositiveMoney(normalOutstandingDue)
      ? [{
        title: 'Normal outstanding',
        value: formatCurrency(normalOutstandingDue),
        detail: `${normalDueBookings.length} ${normalBalanceScope}`,
        color: '#c43d32',
        icon: <PaymentIcon fontSize="small" />,
        view: 'normal_balance' as BookingView,
        alert: true,
      }]
      : []),
    ...(isPositiveMoney(companyOutstandingDue)
      ? [{
        title: 'Company outstanding',
        value: formatCurrency(companyOutstandingDue),
        detail: `${companyDueBookings.length} ${companyBalanceScope}`,
        color: '#8f3d5f',
        icon: <ReceiptIcon fontSize="small" />,
        view: 'company_balance' as BookingView,
        alert: true,
      }]
      : []),
  ];
  const summaryGridColumns = Math.max(1, Math.min(summaryStatCards.length, 6));

  if (loading) {
    return (
      <MuiBox sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </MuiBox>
    );
  }

  // Online reservations are settled on the booking platform; the backend
  // auto-records a payment for the outstanding balance when `source === 'online'`,
  // so the check-in dialog surfaces that instead of the generic "unpaid" message.
  const ciIsOnlineReservation = (checkinBooking?.source || '').trim().toLowerCase() === 'online';
  const ciOnlinePlatformName =
    (checkinBooking ? getBookingChannelInfo(checkinBooking)?.name : null) || 'the online platform';

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
            onClick={() => {
              setCreateDialogOpen(true);
              // Refresh the guest list so recently-added guests are searchable
              // in the modal (the cached list may predate them otherwise).
              loadGuests();
            }}
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
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 2.5,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
            lg: `repeat(${summaryGridColumns}, minmax(0, 1fr))`,
          },
        }}
      >
        {summaryStatCards.map((stat) => (
          <Card
            key={stat.title}
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
                {stat.subValue != null && typeof stat.value === 'number' && (
                  <Typography component="span" variant="h6" sx={{
                    color: "text.secondary"
                  }}>/{stat.subValue}</Typography>
                )}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{stat.detail}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
      {isPositiveMoney(normalOutstandingDue) && (
        <Grid container spacing={2} sx={{
          mb: 2.5
        }}>
          <Grid size={{ xs: 12 }}>
            <Card
              elevation={0}
              onClick={handleTakePaymentAction}
              // Use `&.MuiCard-root` to match the specificity of the global
              // `.hotel-board-skin .MuiCard-root` theme rule; without this the
              // primary background gets overridden back to plain paper white.
              sx={{
                cursor: 'pointer',
                color: 'white',
                '&.MuiCard-root': {
                  bgcolor: '#c43d32',
                  borderColor: '#c43d32',
                },
              }}
            >
              <CardContent sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.18)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PaymentIcon />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, lineHeight: 1.1, color: 'inherit' }}>Take payment</Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.85)' }}>{paymentActionDetail}</Typography>
                </Box>
                <ArrowForwardIcon sx={{ color: 'white' }} />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
      <Grid container spacing={2.5} sx={{
        alignItems: "stretch"
      }}>
        <Grid size={{ xs: 12, lg: selectedBooking ? 8 : 12 }}>
          <Card elevation={0} sx={{ overflow: 'hidden', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.4fr) repeat(4, minmax(0, 1fr))' }, gap: 1.25 }}>
                <TextField
                  fullWidth
                  size="medium"
                  placeholder="Search booking, guest, invoice, or room number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon />
                        </InputAdornment>
                      ),
                    }
                  }}
                />
                <Autocomplete<string, false, false, true>
                  freeSolo
                  fullWidth
                  size="medium"
                  options={PAYMENT_METHODS}
                  value={paymentMethodFilter || null}
                  onChange={(_, value) => {
                    setPaymentMethodFilter(value ?? '');
                    setBookingView('all');
                  }}
                  renderInput={(params) => (
                    <TextField {...params} label="Payment method" placeholder="Any" />
                  )}
                />
                <Autocomplete<string, false, false, true>
                  freeSolo
                  fullWidth
                  size="medium"
                  options={ONLINE_CHANNELS}
                  value={onlineChannelFilter || null}
                  onChange={(_, value) => {
                    setOnlineChannelFilter(value ?? '');
                    setBookingView('all');
                  }}
                  renderInput={(params) => (
                    <TextField {...params} label="Online channel" placeholder="Any" />
                  )}
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
                  slotProps={{
                    inputLabel: { shrink: true }
                  }}
                />
                <FormControl fullWidth size="medium">
                  <Select
                    aria-label="Search month"
                    value={monthSearch}
                    displayEmpty
                    onChange={(e) => {
                      const value = e.target.value as string;
                      setMonthSearch(value);
                      setDateFilter(value ? 'calendar_month' : 'all');
                      setBookingView('all');
                      setCurrentPage(1);
                    }}
                  >
                    <MenuItem value="">Any month</MenuItem>
                    {monthOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  flexWrap: "wrap",
                  mt: 1.5
                }}>
                {[
                  { key: 'all', label: 'All', count: totalBookings || bookings.length },
                  { key: 'arriving', label: 'Arriving', count: arrivingBookings.length },
                  { key: 'in_house', label: 'In House', count: inHouseBookings.length },
                  { key: 'upcoming', label: 'Upcoming', count: upcomingBookings.length },
                  { key: 'balance', label: 'Overdue Balance', count: dueBookings.length },
                  { key: 'normal_balance', label: 'Normal', count: normalDueBookings.length },
                  { key: 'company_balance', label: 'Company', count: companyDueBookings.length },
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
                {(searchQuery || roomNumberFilter || paymentMethodFilter || onlineChannelFilter || statusFilter !== 'all' || dateFilter !== 'all') && (
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
                {monthSearch && (
                  <Chip
                    label={`Month ${formatShortMonth(monthSearch)}`}
                    onDelete={() => {
                      setMonthSearch('');
                      setDateFilter('all');
                      setCurrentPage(1);
                    }}
                    sx={{ height: 34, fontWeight: 800 }}
                  />
                )}
              </Stack>
            </Box>

            <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  fontWeight: 800
                }}>
                {visibleBookings.length} bookings
              </Typography>
              <Button size="small" endIcon={<FilterIcon />} onClick={() => handleSort(sortField === 'check_in_date' ? 'guest_name' : 'check_in_date')} sx={{ color: 'text.primary' }}>
                Sort: {sortField === 'guest_name' ? 'Guest' : 'Priority'}
              </Button>
            </Box>

            {visibleBookings.length === 0 && !loading ? (
              <Box
                sx={{
                  textAlign: "center",
                  py: 6
                }}>
                <Typography variant="h6" sx={{
                  color: "text.secondary"
                }}>
                  {totalBookings === 0 ? 'No bookings yet' : 'No bookings match your filters'}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    mt: 1
                  }}>
                  {totalBookings === 0 ? 'Create your first booking using the New booking button above' : 'Try adjusting your search or filter criteria'}
                </Typography>
              </Box>
            ) : (
              <Stack divider={<Divider />} sx={{ maxHeight: { lg: 'calc(100vh - 430px)' }, minHeight: 420, overflow: 'auto' }}>
                {visibleBookings.map((booking) => {
                  const isSelected = selectedBooking && String(selectedBooking.id) === String(booking.id);
                  const balance = getBookingBalance(booking);
                  const isPaid = !isPositiveMoney(balance) && ['paid', 'paid_rate'].includes(String(booking.payment_status || '').toLowerCase());
                  const channelInfo = getBookingChannelInfo(booking);
                  const billingChipLabel = getBillingChipLabel(booking);

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
                        <Stack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          sx={{
                            alignItems: "center",
                            flexWrap: "wrap"
                          }}>
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
                          {billingChipLabel && (
                            <Chip
                              size="small"
                              label={billingChipLabel}
                              sx={{ height: 22, fontWeight: 800 }}
                            />
                          )}
                          <Typography variant="body2" sx={{ color: statusDotColor(booking.status), fontWeight: 800 }}>
                            • {getBookingStatusText(booking.status)}
                          </Typography>
                          {isNightAuditInvolved(booking) && (
                            <Chip size="small" label="Night audit" variant="outlined" sx={{ height: 22, fontWeight: 900 }} />
                          )}
                        </Stack>
                        <Typography
                          variant="body2"
                          sx={{
                            color: "text.secondary",
                            mt: 0.35
                          }}>
                          <BedIcon sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.5 }} />
                          Rm {booking.room_number || '-'} · {booking.room_type || 'Room'} · {formatShortDate(booking.check_in_date)} {'->'} {formatShortDate(booking.check_out_date)} · {getNights(booking)}N
                        </Typography>
                      </Box>
                      <Box sx={{ textAlign: { xs: 'left', md: 'right' }, gridColumn: { xs: '2 / span 1', md: 'auto' } }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatCurrency(getBookingTotal(booking))}</Typography>
	                        {isPositiveMoney(balance) ? (
                          <Typography
                            variant="body2"
                            sx={{
                              color: "error.main",
                              fontWeight: 800
                            }}>Due {formatCurrency(balance)}</Typography>
                        ) : (
                          <Typography
                            variant="body2"
                            sx={{
                              color: "success.main",
                              fontWeight: 800
                            }}>✓ {isPaid ? 'Paid' : getPaymentStatusText(booking.payment_status)}</Typography>
                        )}
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{
                          color: "text.secondary",
                          fontFamily: 'monospace',
                          textAlign: { xs: 'left', md: 'right' },
                          gridColumn: { xs: '2 / span 1', md: 'auto' }
                        }}>
                        {booking.invoice_number || booking.folio_number || `#${booking.id}`}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}

            {bookingView === 'all' && bookingPagination.hasMultiplePages && (
              <Stack
                direction="row"
                sx={{
                  justifyContent: "space-between",
                  alignItems: "center",
                  px: 2,
                  py: 1.5,
                  borderTop: '1px solid',
                  borderColor: 'divider'
                }}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  Showing {bookingPagination.startItem}-{bookingPagination.endItem} of {bookingPagination.totalItems}
                </Typography>
                <Pagination
                  count={bookingPagination.totalPages}
                  page={bookingPagination.currentPage}
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
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "flex-start"
                  }}>
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
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{
                    alignItems: "center",
                    mt: 3
                  }}>
                  <Box sx={{ width: 58, height: 58, borderRadius: '50%', bgcolor: alpha('#2f6f52', 0.14), color: '#245a42', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1.1rem' }}>
                    {getGuestInitials(selectedBooking.guest_name)}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.1 }}>{selectedBooking.guest_name}</Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        fontFamily: 'monospace'
                      }}>
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
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Check-in</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatShortDate(selectedBooking.check_in_date)}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{getNights(selectedBooking)}N</Typography>
                      <ArrowForwardIcon fontSize="small" />
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Check-out</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatShortDate(selectedBooking.check_out_date)}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ width: 38, height: 38, borderRadius: 1.5, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <RoomIcon fontSize="small" />
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{selectedBooking.room_type || 'Room'}</Typography>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>Room {selectedBooking.room_number || '-'}</Typography>
                    </Box>
                  </Box>
                </Box>

                <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>Charges</Typography>
                  <Stack spacing={1.2} sx={{ mt: 1 }}>
                    <Stack direction="row" sx={{
                      justifyContent: "space-between"
                    }}>
                      <Typography sx={{
                        color: "text.secondary"
                      }}>Room · {getNights(selectedBooking)} x {formatCurrency(toMoneyNumber(selectedBooking.price_per_night))}</Typography>
                      <Typography sx={{ fontWeight: 800 }}>{formatCurrency(getBookingTotal(selectedBooking))}</Typography>
                    </Stack>
                    <Stack direction="row" sx={{
                      justifyContent: "space-between"
                    }}>
                      <Typography sx={{
                        color: "text.secondary"
                      }}>Tax & fees</Typography>
                      <Typography sx={{
                        color: "text.secondary"
                      }}>Included</Typography>
                    </Stack>
                    <Divider />
                    <Stack direction="row" sx={{
                      justifyContent: "space-between"
                    }}>
                      <Typography variant="subtitle1">Total</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatCurrency(getBookingTotal(selectedBooking))}</Typography>
                    </Stack>
	                    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: isPositiveMoney(getBookingBalance(selectedBooking)) ? alpha('#c43d32', 0.08) : alpha('#2f6f52', 0.1), color: isPositiveMoney(getBookingBalance(selectedBooking)) ? '#c43d32' : '#2f6f52', fontWeight: 900 }}>
	                      {isPositiveMoney(getBookingBalance(selectedBooking))
                        ? `Due ${formatCurrency(getBookingBalance(selectedBooking))}`
                        : `✓ Fully paid${selectedBooking.payment_method ? ` via ${selectedBooking.payment_method.replace(/_/g, ' ')}` : ''}`}
                    </Box>
                  </Stack>
                </Box>

                <Box sx={{ p: 2.5 }}>
                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>Actions</Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{
                      flexWrap: "wrap",
                      mt: 1
                    }}>
                    {canCheckIn(selectedBooking) && (
                      isEarlyCheckIn(selectedBooking) ? (
                        <Tooltip title={`Early check-in — before the configured ${getHotelSettings().check_in_time || '15:00'} check-in time`} arrow>
                          <Button variant="contained" color="success" startIcon={<EarlyCheckInIcon />} onClick={() => handleCheckIn(String(selectedBooking.id))}>Early check-in</Button>
                        </Tooltip>
                      ) : (
                        <Button variant="contained" color="success" startIcon={<LoginIcon />} onClick={() => handleCheckIn(String(selectedBooking.id))}>Check in</Button>
                      )
                    )}
                    {canCheckOut(selectedBooking) && (
                      <Button variant="contained" color="warning" startIcon={<CheckOutIcon />} onClick={() => handleCheckOut(selectedBooking)}>Check out</Button>
                    )}
                    {/* Standalone payment entry is only for pre-arrival bookings
                        (confirmed/pending) that have no invoice yet. Once checked in,
                        out, or completed, payments are recorded inside the invoice
                        (checkout preview / receipt). Locked once fully settled. */}
                    {!selectedBooking.is_complimentary
                      && isPositiveMoney(getBookingBalance(selectedBooking))
                      && !['checked_in', 'checked_out', 'completed'].includes(selectedBooking.status) && (
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
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Booked via</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 800, textTransform: 'capitalize' }}>{getBookedViaText(selectedBooking)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Payment</Typography>
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
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Total</Typography>
                      <Typography variant="subtitle2">{formatCurrency(toMoneyNumber(workflowSummary.total_amount))}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Paid</Typography>
                      <Typography variant="subtitle2" sx={{
                        color: "success.main"
                      }}>{formatCurrency(toMoneyNumber(workflowSummary.total_paid))}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Balance</Typography>
                      <Typography variant="subtitle2" color={isPositiveMoney(workflowSummary.balance_due) ? 'warning.main' : 'success.main'}>
                        {formatCurrency(toMoneyNumber(workflowSummary.balance_due))}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Refunded</Typography>
                      <Typography variant="subtitle2" sx={{
                        color: "info.main"
                      }}>{formatCurrency(toMoneyNumber(workflowSummary.total_refunded))}</Typography>
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
                  <Stack direction="row" spacing={0.75} useFlexGap sx={{
                    flexWrap: "wrap"
                  }}>
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
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>No workflow events recorded yet.</Typography>
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
                                {event.amount && compareMoney(event.amount, 0) !== 0 && (
                                  <Typography component="span" variant="body2" sx={{
                                    color: "text.secondary"
                                  }}>
                                    {' '}({formatCurrency(toMoneyNumber(event.amount))})
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
                            <Typography variant="caption" sx={{
                              color: "text.secondary"
                            }}>
                              {new Date(event.created_at).toLocaleString()}
                              {event.status_from && event.status_to ? ` / ${event.status_from} -> ${event.status_to}` : ''}
                            </Typography>
                            {event.description && (
                              <Typography
                                variant="body2"
                                sx={{
                                  color: "text.secondary",
                                  mt: 0.25
                                }}>
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
          showSnackbar(message);
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
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, check_in_date: e.target.value }))}
                slotProps={{
                  inputLabel: { shrink: true }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Scheduled Check-Out Date"
                type="date"
                value={editFormData.check_out_date || ''}
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, check_out_date: e.target.value }))}
                slotProps={{
                  inputLabel: { shrink: true }
                }}
              />
            </Grid>
            {(['checked_out', 'late_checkout', 'completed'].includes(editFormData.status || '') || editingBooking?.actual_check_out) && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Actual Check-Out Date"
                  type="date"
                  value={editFormData.actual_check_out || ''}
                  onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, actual_check_out: e.target.value }))}
                  helperText="The date the guest actually checked out (shown on the invoice)"
                  slotProps={{
                    inputLabel: { shrink: true }
                  }}
                />
              </Grid>
            )}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                fullWidth
                label="Status"
                value={editFormData.status || 'pending'}
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, status: e.target.value }))}

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
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, source: e.target.value }))}
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
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                fullWidth
                label="Booking Platform"
                value={editFormData.booking_channel_id || ''}
                onChange={(e) => {
                  const channel = bookingChannels.find((item) => String(item.id) === e.target.value);
                  setEditFormData((prev: BookingEditFormData) => ({
                    ...prev,
                    booking_channel_id: e.target.value ? Number(e.target.value) : '',
                    source: channel?.channel_type === 'ota' ? 'online' : prev.source,
                  }));
                }}
              >
                <MenuItem value="">None</MenuItem>
                {bookingChannels.map((channel) => (
                  <MenuItem key={channel.id} value={channel.id}>
                    {channel.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            {editBookingUsesOta && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="OTA Ref No"
                  value={editFormData.ota_reference || ''}
                  onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, ota_reference: e.target.value }))}
                />
              </Grid>
            )}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete<BookingCompanyOption>
                options={activeCompanies}
                value={selectedEditCompany}
                loading={activeCompaniesQuery.isLoading || activeCompaniesQuery.isFetching}
                onChange={(_, company) => setEditFormData((prev: BookingEditFormData) => ({
                  ...prev,
                  company_id: company?.id ?? null,
                  company_name: company?.company_name || '',
                }))}
                getOptionLabel={(option) => option.company_name}
                isOptionEqualToValue={(option, value) => {
                  if (option.id != null && value.id != null) return option.id === value.id;
                  return option.company_name.toLowerCase() === value.company_name.toLowerCase();
                }}
                renderOption={(props, option) => {
                  const { key, ...otherProps } = props;
                  return (
                    <li key={key} {...otherProps}>
                      <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <BusinessIcon color="action" fontSize="small" />
                          <Typography>{option.company_name}</Typography>
                        </Box>
                        {option.contact_person && (
                          <Typography
                            variant="caption"
                            sx={{
                              color: "text.secondary",
                              ml: 3.5
                            }}>
                            Contact: {option.contact_person}
                          </Typography>
                        )}
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Company (optional)"
                    placeholder="Search company (optional)"
                    helperText="Leave empty for normal guest billing."
                    slotProps={{
                      ...params.slotProps,

                      input: {
                        ...params.slotProps.input,
                        startAdornment: (
                          <>
                            <BusinessIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                            {params.slotProps.input.startAdornment}
                          </>
                        ),
                        endAdornment: (
                          <>
                            {(activeCompaniesQuery.isLoading || activeCompaniesQuery.isFetching) ? (
                              <CircularProgress color="inherit" size={18} />
                            ) : null}
                            {params.slotProps.input.endAdornment}
                          </>
                        ),
                      }
                    }}
                  />
                )}
              />
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
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({
                  ...prev,
                  price_per_night: toMoneyNumber(e.target.value),
                }))}
                helperText="Rate per night (before tax) - modifying will recalculate total"
                slotProps={{
                  input: {
                    startAdornment: <span style={{ marginRight: 4 }}>RM</span>,
                  }
                }}
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
                      const chargePerBed = editRoomTypeConfig ? toMoneyNumber(editRoomTypeConfig.extra_bed_charge) : 0;
                      const count = Math.min(Math.max(parseInt(e.target.value) || 0, 0), maxBeds);
                      setEditFormData((prev: BookingEditFormData) => ({
                        ...prev,
                        extra_bed_count: count,
                        extra_bed_charge: multiplyMoney(chargePerBed, count),
                      }));
                    }}
                    helperText={`${formatCurrency(
                      toMoneyNumber(editRoomTypeConfig?.extra_bed_charge)
                    )} per extra bed (max ${editRoomTypeConfig?.max_extra_beds || 0})`}
                    slotProps={{
                      htmlInput: { min: 0, max: editRoomTypeConfig?.max_extra_beds || 0 }
                    }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Extra Bed Charge"
                    type="number"
                    value={editFormData.extra_bed_charge || 0}
                    onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({
                      ...prev,
                      extra_bed_charge: toMoneyNumber(e.target.value),
                    }))}
                    helperText="Auto-calculated or manually adjust"
                    slotProps={{
                      input: {
                        startAdornment: <span style={{ marginRight: 4 }}>RM</span>,
                      }
                    }}
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
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, remarks: e.target.value }))}
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
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, special_requests: e.target.value }))}
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
                        ? toMoneyNumber(selectedRoom.price_per_night)
                        : editFormData.price_per_night;
                      setEditFormData((prev: BookingEditFormData) => ({
                        ...prev,
                        room_id: e.target.value,
                        price_per_night: newRate,
                      }));
                    }}
                  >
                    {availableRooms.map((room) => (
                      <MenuItem key={room.id} value={room.id}>
                        Room {room.room_number} - {room.room_type} ({formatCurrency(toMoneyNumber(room.price_per_night))}/night)
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
          {voidingNeedsAuditReview && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {voidingAuditDates.length > 0
                ? `This booking was included in night audit for ${voidingAuditDates.join(', ')}. Rerun night audit for those date(s) after voiding to refresh the report.`
                : 'This booking is marked as posted in night audit. After voiding, rerun the affected night audit date returned by the system to refresh the report.'}
            </Alert>
          )}
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
          setPaymentDialogContext('manual');
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 3,
              overflow: 'hidden',
            },
          }
        }}
      >
        <DialogTitle sx={{ p: 0 }}>
          <Box sx={{ px: 3, py: 2.5, display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: alpha('#2aa198', 0.12), color: '#16877f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <PaymentIcon />
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.15 }}>
                {paymentDialogContext === 'checkout_required' ? 'Payment Required' : 'Accept Payment'}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  mt: 0.5
                }}>
                {paymentDialogContext === 'checkout_required'
                  ? 'Collect the outstanding balance before continuing checkout.'
                  : 'Record a room charge payment and update the booking balance automatically.'}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ px: 3, py: 2.5 }}>
          {paymentBooking && (
            <Stack spacing={2.25}>
              {paymentDialogContext === 'checkout_required' && (
                <Alert severity="warning">
                  Checkout is blocked until this balance is fully settled.
                </Alert>
              )}
              {/* This dialog has no date field, so the payments row is stamped
                  with the server timestamp — i.e. the moment the status is
                  flipped here. Back-dating is only possible from the checkout
                  invoice screen, which does send an explicit payment_date.

                  The instant (not `todayIso`) is what gets formatted: the server
                  stamps the row in the hotel timezone, and formatHotelDate passes
                  date-only strings through untouched, so feeding it a machine-local
                  'YYYY-MM-DD' would name the viewer's day instead of the hotel's. */}
              <Alert severity="info">
                This payment will be dated <strong>today ({formatHotelDate(new Date())})</strong> — the day
                the payment status is changed here, not the day the guest actually paid. To record a
                payment on an earlier date, use <strong>Record Payment</strong> in the checkout invoice
                instead.
              </Alert>
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "flex-start"
                  }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="overline"
                      sx={{
                        color: "text.secondary",
                        fontWeight: 900
                      }}>
                      Booking
                    </Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900, fontFamily: 'monospace', lineHeight: 1.25 }}>
                      {paymentBooking.booking_number || paymentBooking.folio_number || `#${paymentBooking.id}`}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        mt: 0.5
                      }}>
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
                  { label: 'Total', value: formatCurrency(toMoneyNumber(paymentBooking.total_amount)), color: 'text.primary' },
                  { label: 'Paid', value: formatCurrency(toMoneyNumber(paymentBooking.total_paid)), color: 'success.main' },
                  { label: 'Balance', value: formatCurrency(getBookingBalance(paymentBooking)), color: isPositiveMoney(getBookingBalance(paymentBooking)) ? 'error.main' : 'success.main' },
                ].map((item) => (
                  <Box key={item.label} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        fontWeight: 800
                      }}>
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
                  onChange={(e) => setPaymentAmount(toMoneyNumber(e.target.value))}
                  error={
                    (paymentDialogContext === 'checkout_required' && isLessMoney(paymentAmount, getBookingBalance(paymentBooking))) ||
                    isGreaterMoney(paymentAmount, getBookingBalance(paymentBooking))
                  }
                  helperText={
                    isGreaterMoney(paymentAmount, getBookingBalance(paymentBooking))
                      ? `Cannot exceed outstanding balance of ${formatCurrency(getBookingBalance(paymentBooking))}`
                      : paymentDialogContext === 'checkout_required'
                        ? `Full balance required: ${formatCurrency(getBookingBalance(paymentBooking))}`
                        : `Outstanding balance: ${formatCurrency(getBookingBalance(paymentBooking))}`
                  }
                  required
                  slotProps={{
                    input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> },
                    htmlInput: { min: 0, max: getBookingBalance(paymentBooking), step: 0.01 }
                  }} />
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
            setPaymentDialogContext('manual');
          }}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmPaymentUpdate}
            variant="contained"
            color="primary"
            disabled={
              !isPositiveMoney(paymentAmount) ||
              updatingPayment ||
              (paymentDialogContext === 'checkout_required' && isLessMoney(paymentAmount, getBookingBalance(paymentBooking))) ||
              isGreaterMoney(paymentAmount, getBookingBalance(paymentBooking))
            }
          >
            {updatingPayment ? 'Processing...' : 'Accept Payment'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Checkout Invoice Modal */}
      {/* Shared checkout + read-only receipt modals */}
      <CheckoutInvoiceModals
        flow={checkoutFlow}
        onReceiptPaymentsChanged={() => { void reloadBookingData(); }}
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
                <Typography variant="subtitle2" gutterBottom sx={{
                  color: "text.secondary"
                }}>
                  Booking #{checkinBooking.booking_number}
                </Typography>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid size={12}>
                    <Typography variant="h6" sx={{
                      fontWeight: 600
                    }}>{checkinBooking.guest_name}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Check-in</Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 500
                    }}>
                      {new Date(checkinBooking.check_in_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Check-out</Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 500
                    }}>
                      {new Date(checkinBooking.check_out_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Room Type</Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 500
                    }}>{checkinBooking.room_type}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Total Amount</Typography>
	                    <Typography variant="body2" sx={{
                          fontWeight: 500
                        }}>{formatCurrency(toMoneyNumber(checkinBooking.total_amount))}</Typography>
                  </Grid>
                </Grid>
              </Box>

              <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Guest Information</Typography>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Grid size={6}>
                  <TextField fullWidth size="small" required label="IC / Passport Number" value={ciIcNumber}
                    onChange={(e) => setCiIcNumber(e.target.value)}
                    error={!ciIcNumber.trim()}
                    helperText={!ciIcNumber.trim() ? 'Required to complete check-in' : ' '} />
                </Grid>
                <Grid size={6}>
                  <TextField fullWidth size="small" label="Phone Number" value={ciPhone}
                    onChange={(e) => setCiPhone(e.target.value)} helperText="Optional" />
                </Grid>
              </Grid>

              <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Payment</Typography>
              {ciIsOnlineReservation && (
                <Alert severity="success" sx={{ mb: 1.5, py: 0 }}>
                  Payment was settled on {ciOnlinePlatformName}. The full amount
                  {' '}({formatCurrency(toMoneyNumber(checkinBooking.total_amount))}) is recorded
                  automatically on check-in — keep this on “Settled Online”. Switch to “Make Payment Now”
                  only if you are collecting at the desk instead.
                </Alert>
              )}
              <ToggleButtonGroup value={ciPaymentChoice} exclusive onChange={(_, val) => { if (val) setCiPaymentChoice(val); }} fullWidth size="small" sx={{ mb: 1.5 }}>
                <ToggleButton value="pay_now" color="success" sx={{ py: 1, fontWeight: 600 }}>
                  <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} /> Make Payment Now
                </ToggleButton>
                <ToggleButton value="pay_later" color="warning" sx={{ py: 1, fontWeight: 600 }}>
                  <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} /> {ciIsOnlineReservation ? 'Settled Online' : 'Pay Later'}
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
                    <TextField fullWidth size="small" label="Amount Paid" type="number" value={ciAmountPaid} onChange={(e) => setCiAmountPaid(toMoneyNumber(e.target.value))}
                      slotProps={{
                        input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>, inputProps: { min: 0, step: 0.01 } }
                      }} />
                  </Grid>
                </Grid>
              )}
              {ciPaymentChoice === 'pay_later' && !ciIsOnlineReservation && (
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
                    <TextField fullWidth size="small" label="Deposit Amount" type="number" value={ciDepositAmount} onChange={(e) => setCiDepositAmount(toMoneyNumber(e.target.value))}
                      slotProps={{
                        input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>, inputProps: { min: 0, step: 0.01 } }
                      }} />
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
          <Button variant="contained" color="success" onClick={handleConfirmCheckIn} disabled={processingCheckIn || !ciIcNumber.trim()}
            startIcon={processingCheckIn ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}>
            {processingCheckIn ? 'Processing...' : 'Check-In Now'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BookingsPage;
