/**
 * Custom hook encapsulating all state management and handlers for the
 * Bookings page. Extracted to reduce the main component from
 * ~2,200 lines to a more manageable size.
 */
import { useState, useCallback } from 'react';
import { HotelAPIService } from '../../../api';
import { Room, BookingWithDetails } from '../../../types';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';

export interface BookingsPageState {
  // Dialog states
  showCheckoutModal: boolean;
  showCheckinModal: boolean;
  invoiceBooking: BookingWithDetails | null;
  showInvoiceModal: boolean;
  workflowDialogOpen: boolean;
  workflowBooking: BookingWithDetails | null;
  createDialogOpen: boolean;
  editDialogOpen: boolean;
  voidDialogOpen: boolean;
  reactivateDialogOpen: boolean;
  complimentaryDialogOpen: boolean;
  paymentDialogOpen: boolean;

  // Booking detail view state
  selectedBookingId: string | number | null;
  bookingDetailsOpen: boolean;
  bookingView: 'all' | 'arriving' | 'in_house' | 'departing' | 'upcoming' | 'balance';

  // Checkout state
  checkoutBooking: BookingWithDetails | null;
  showCheckoutModalValue: boolean;

  // Check-in state
  checkinBooking: BookingWithDetails | null;
  processingCheckIn: boolean;
  ciPaymentChoice: 'pay_now' | 'pay_later';
  ciPaymentMethod: string;
  ciAmountPaid: number;
  ciDepositChoice: 'receive' | 'waive';
  ciDepositAmount: number;
  ciDepositMethod: string;
  ciWaiveReason: string;

  // Workflow state
  workflowSummary: any;
  workflowTimeline: any[];
  workflowLoading: boolean;

  // Edit state
  editingBooking: BookingWithDetails | null;
  editFormData: any;
  editRoomTypeConfig: any;
  availableRooms: Room[];
  updating: boolean;

  // Void state
  voidingBooking: BookingWithDetails | null;
  voidReason: string;
  voiding: boolean;

  // Reactivate state
  reactivatingBooking: BookingWithDetails | null;
  reactivating: boolean;

  // Complimentary state
  complimentaryBooking: BookingWithDetails | null;
  complimentaryReason: string;
  complimentaryStartDate: string;
  complimentaryEndDate: string;
  markingComplimentary: boolean;

  // Payment state
  paymentBooking: BookingWithDetails | null;
  paymentAmount: number;
  paymentMethod: string;
  paymentNote: string;
  updatingPayment: boolean;

  // Setters
  setShowCheckoutModal: (v: boolean) => void;
  setShowCheckinModal: (v: boolean) => void;
  setInvoiceBooking: (v: BookingWithDetails | null) => void;
  setShowInvoiceModal: (v: boolean) => void;
  setWorkflowDialogOpen: (v: boolean) => void;
  setWorkflowBooking: (v: BookingWithDetails | null) => void;
  setCreateDialogOpen: (v: boolean) => void;
  setEditDialogOpen: (v: boolean) => void;
  setVoidDialogOpen: (v: boolean) => void;
  setReactivateDialogOpen: (v: boolean) => void;
  setComplimentaryDialogOpen: (v: boolean) => void;
  setPaymentDialogOpen: (v: boolean) => void;
  setSelectedBookingId: (v: string | number | null) => void;
  setBookingDetailsOpen: (v: boolean) => void;
  setBookingView: (v: 'all' | 'arriving' | 'in_house' | 'departing' | 'upcoming' | 'balance') => void;
  setCheckoutBooking: (v: BookingWithDetails | null) => void;
  setCheckinBooking: (v: BookingWithDetails | null) => void;
  setProcessingCheckIn: (v: boolean) => void;
  setCiPaymentChoice: (v: 'pay_now' | 'pay_later') => void;
  setCiPaymentMethod: (v: string) => void;
  setCiAmountPaid: (v: number) => void;
  setCiDepositChoice: (v: 'receive' | 'waive') => void;
  setCiDepositAmount: (v: number) => void;
  setCiDepositMethod: (v: string) => void;
  setCiWaiveReason: (v: string) => void;
  setEditingBooking: (v: BookingWithDetails | null) => void;
  setEditFormData: (v: any) => void;
  setAvailableRooms: (v: Room[]) => void;
  setVoidingBooking: (v: BookingWithDetails | null) => void;
  setVoidReason: (v: string) => void;
  setReactivatingBooking: (v: BookingWithDetails | null) => void;
  setComplimentaryBooking: (v: BookingWithDetails | null) => void;
  setComplimentaryReason: (v: string) => void;
  setComplimentaryStartDate: (v: string) => void;
  setComplimentaryEndDate: (v: string) => void;
  setPaymentBooking: (v: BookingWithDetails | null) => void;
  setPaymentAmount: (v: number) => void;
  setPaymentMethod: (v: string) => void;
  setPaymentNote: (v: string) => void;

  // Handlers
  handleCheckIn: (bookingId: string) => Promise<void>;
  handleConfirmCheckIn: () => Promise<void>;
  handleCheckOut: (booking: BookingWithDetails) => void;
  handleConfirmCheckout: (lateCheckoutData?: any, paymentMethod?: string) => Promise<void>;
  handleVoidBooking: (booking: BookingWithDetails) => void;
  handleConfirmVoid: () => Promise<void>;
  handleReactivateBooking: (booking: BookingWithDetails) => void;
  handleConfirmReactivate: () => Promise<void>;
  handleMarkComplimentary: (booking: BookingWithDetails) => void;
  handleConfirmComplimentary: () => Promise<void>;
  handleUpdatePaymentStatus: (booking: BookingWithDetails) => void;
  handleConfirmPaymentUpdate: () => Promise<void>;
  handleEditBooking: (booking: BookingWithDetails) => void;
  handleUpdateBooking: () => Promise<void>;
  handleTakePaymentAction: () => void;
  handleViewInvoice: (booking: BookingWithDetails) => void;
  handleViewWorkflow: (booking: BookingWithDetails) => void;
}

export function useBookingsPageState(): BookingsPageState {
  const queryClient = useQueryClient();
  const showSnackbar = (message: string) => emitApiNotification({ message, severity: 'success' });
  const showSnackbarError = (message: string) => emitApiNotification({ message, severity: 'error' });

  // Dialog states
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [invoiceBooking, setInvoiceBooking] = useState<BookingWithDetails | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [workflowBooking, setWorkflowBooking] = useState<BookingWithDetails | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [complimentaryDialogOpen, setComplimentaryDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Detail view state
  const [selectedBookingId, setSelectedBookingId] = useState<string | number | null>(null);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(true);
  const [bookingView, setBookingView] = useState<'all' | 'arriving' | 'in_house' | 'departing' | 'upcoming' | 'balance'>('all');

  // Checkout state
  const [checkoutBooking, setCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const showCheckoutModalValue = showCheckoutModal;

  // Check-in state
  const [checkinBooking, setCheckinBooking] = useState<BookingWithDetails | null>(null);
  const [processingCheckIn, setProcessingCheckIn] = useState(false);
  const [ciPaymentChoice, setCiPaymentChoice] = useState<'pay_now' | 'pay_later'>('pay_later');
  const [ciPaymentMethod, setCiPaymentMethod] = useState('Cash');
  const [ciAmountPaid, setCiAmountPaid] = useState(0);
  const [ciDepositChoice, setCiDepositChoice] = useState<'receive' | 'waive'>('receive');
  const [ciDepositAmount, setCiDepositAmount] = useState(0);
  const [ciDepositMethod, setCiDepositMethod] = useState('Cash');
  const [ciWaiveReason, setCiWaiveReason] = useState('');

  // Workflow state
  const [workflowSummary, setWorkflowSummary] = useState<any>(null);
  const [workflowTimeline, setWorkflowTimeline] = useState<any[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);

  // Edit state
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  const [editRoomTypeConfig, setEditRoomTypeConfig] = useState<any>(null);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [updating, setUpdating] = useState(false);

  // Void state
  const [voidingBooking, setVoidingBooking] = useState<BookingWithDetails | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Reactivate state
  const [reactivatingBooking, setReactivatingBooking] = useState<BookingWithDetails | null>(null);
  const [reactivating, setReactivating] = useState(false);

  // Complimentary state
  const [complimentaryBooking, setComplimentaryBooking] = useState<BookingWithDetails | null>(null);
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [complimentaryStartDate, setComplimentaryStartDate] = useState('');
  const [complimentaryEndDate, setComplimentaryEndDate] = useState('');
  const [markingComplimentary, setMarkingComplimentary] = useState(false);

  // Payment state
  const [paymentBooking, setPaymentBooking] = useState<BookingWithDetails | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');
  const [paymentNote, setPaymentNote] = useState<string>('');
  const [updatingPayment, setUpdatingPayment] = useState(false);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  const handleCheckIn = useCallback(async (bookingId: string) => {
    setShowCheckinModal(true);
  }, []);

  const handleConfirmCheckIn = useCallback(async () => {
    if (!checkinBooking) return;
    try {
      setProcessingCheckIn(true);
      const updateData: any = { status: 'checked_in', actual_check_in: new Date().toISOString() };
      await HotelAPIService.updateBooking(checkinBooking.id, updateData);
      showSnackbar(`Booking checked in successfully`);
      setShowCheckinModal(false);
      setCheckinBooking(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list(), exact: false });
    } catch (err: any) {
      showSnackbarError(err.message || 'Failed to check in');
    } finally {
      setProcessingCheckIn(false);
    }
  }, [checkinBooking, queryClient]);

  const handleCheckOut = useCallback((booking: BookingWithDetails) => {
    setCheckoutBooking(booking);
    setShowCheckoutModal(true);
  }, []);

  const handleConfirmCheckout = useCallback(async (_lateCheckoutData?: any, checkoutPaymentMethod?: string) => {
    if (!checkoutBooking) return;
    try {
      const updatePayload: any = { status: 'checked_out' };
      await HotelAPIService.updateBooking(checkoutBooking.id, updatePayload);
      showSnackbar(`Booking checked out successfully`);
      setShowCheckoutModal(false);
      setCheckoutBooking(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list(), exact: false });
    } catch (err: any) {
      showSnackbarError(err.message || 'Failed to check out');
    }
  }, [checkoutBooking, queryClient]);

  const handleVoidBooking = useCallback((booking: BookingWithDetails) => {
    setVoidingBooking(booking);
    setVoidReason('');
    setVoidDialogOpen(true);
  }, []);

  const handleConfirmVoid = useCallback(async () => {
    if (!voidingBooking) return;
    try {
      setVoiding(true);
      await (HotelAPIService as any).voidBooking(voidingBooking.id, voidReason);
      showSnackbar(`Booking voided successfully`);
      setVoidDialogOpen(false);
      setVoidingBooking(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list(), exact: false });
    } catch (err: any) {
      showSnackbarError(err.message || 'Failed to void booking');
    } finally {
      setVoiding(false);
    }
  }, [voidingBooking, voidReason, queryClient]);

  const handleReactivateBooking = useCallback((booking: BookingWithDetails) => {
    setReactivatingBooking(booking);
    setReactivateDialogOpen(true);
  }, []);

  const handleConfirmReactivate = useCallback(async () => {
    if (!reactivatingBooking) return;
    try {
      setReactivating(true);
      await HotelAPIService.reactivateBooking(reactivatingBooking.id);
      showSnackbar(`Booking reactivated successfully`);
      setReactivateDialogOpen(false);
      setReactivatingBooking(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list(), exact: false });
    } catch (err: any) {
      showSnackbarError(err.message || 'Failed to reactivate booking');
    } finally {
      setReactivating(false);
    }
  }, [reactivatingBooking, queryClient]);

  const handleMarkComplimentary = useCallback((booking: BookingWithDetails) => {
    setComplimentaryBooking(booking);
    setComplimentaryReason('');
    setComplimentaryStartDate('');
    setComplimentaryEndDate('');
    setComplimentaryDialogOpen(true);
  }, []);

  const handleConfirmComplimentary = useCallback(async () => {
    if (!complimentaryBooking) return;
    try {
      setMarkingComplimentary(true);
      await (HotelAPIService as any).markComplimentary(complimentaryBooking.id, complimentaryReason);
      showSnackbar(`Booking marked as complimentary`);
      setComplimentaryDialogOpen(false);
      setComplimentaryBooking(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list(), exact: false });
    } catch (err: any) {
      showSnackbarError(err.message || 'Failed to mark as complimentary');
    } finally {
      setMarkingComplimentary(false);
    }
  }, [complimentaryBooking, complimentaryReason, queryClient]);

  const handleUpdatePaymentStatus = useCallback((booking: BookingWithDetails) => {
    setPaymentBooking(booking);
    setPaymentAmount(0);
    setPaymentMethod('Cash');
    setPaymentNote('');
    setPaymentDialogOpen(true);
  }, []);

  const handleConfirmPaymentUpdate = useCallback(async () => {
    if (!paymentBooking || paymentAmount <= 0) {
      showSnackbarError('Please enter a valid payment amount');
      return;
    }
    try {
      setUpdatingPayment(true);
      await HotelAPIService.recordPayment({
        booking_id: paymentBooking.id,
        amount: paymentAmount,
        payment_method: paymentMethod,
        notes: paymentNote,
      } as any);
      showSnackbar(`Payment recorded: ${paymentAmount}`);
      setPaymentDialogOpen(false);
      setPaymentBooking(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list(), exact: false });
    } catch (err: any) {
      showSnackbarError(err.message || 'Failed to record payment');
    } finally {
      setUpdatingPayment(false);
    }
  }, [paymentBooking, paymentAmount, paymentMethod, paymentNote, queryClient]);

  const handleEditBooking = useCallback((booking: BookingWithDetails) => {
    setEditingBooking(booking);
    const bookingRate = typeof booking.price_per_night === 'string'
      ? parseFloat(booking.price_per_night) || 0
      : booking.price_per_night || 0;

    const extraBedCount = booking.extra_bed_count || 0;
    const extraBedCharge = typeof booking.extra_bed_charge === 'string'
      ? parseFloat(booking.extra_bed_charge) || 0
      : booking.extra_bed_charge || 0;

    setEditFormData({
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
      price_per_night: bookingRate,
      has_override: bookingRate > 0,
      extra_bed_count: extraBedCount,
      extra_bed_charge: extraBedCharge,
      room_id: booking.room_id,
    });
    setEditDialogOpen(true);
  }, []);

  const handleUpdateBooking = useCallback(async () => {
    if (!editingBooking) return;
    try {
      setUpdating(true);
      await HotelAPIService.updateBooking(editingBooking.id, editFormData);
      showSnackbar(`Booking updated successfully`);
      setEditDialogOpen(false);
      setEditingBooking(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.list(), exact: false });
    } catch (err: any) {
      showSnackbarError(err.message || 'Failed to update booking');
    } finally {
      setUpdating(false);
    }
  }, [editingBooking, editFormData, queryClient]);

  const handleTakePaymentAction = useCallback(() => {
    // This delegates to the payment dialog
    setPaymentDialogOpen(true);
  }, []);

  const handleViewInvoice = useCallback((booking: BookingWithDetails) => {
    setInvoiceBooking(booking);
    setShowInvoiceModal(true);
  }, []);

  const handleViewWorkflow = useCallback(async (booking: BookingWithDetails) => {
    setWorkflowBooking(booking);
    setWorkflowDialogOpen(true);
    try {
      setWorkflowLoading(true);
      // Workflow data loading would go here
      setWorkflowLoading(false);
    } catch {
      setWorkflowLoading(false);
    }
  }, []);

  return {
    showCheckoutModal,
    showCheckinModal,
    invoiceBooking,
    showInvoiceModal,
    workflowDialogOpen,
    workflowBooking,
    createDialogOpen,
    editDialogOpen,
    voidDialogOpen,
    reactivateDialogOpen,
    complimentaryDialogOpen,
    paymentDialogOpen,
    selectedBookingId,
    bookingDetailsOpen,
    bookingView,
    checkoutBooking,
    showCheckoutModalValue,
    checkinBooking,
    processingCheckIn,
    ciPaymentChoice,
    ciPaymentMethod,
    ciAmountPaid,
    ciDepositChoice,
    ciDepositAmount,
    ciDepositMethod,
    ciWaiveReason,
    workflowSummary,
    workflowTimeline,
    workflowLoading,
    editingBooking,
    editFormData,
    editRoomTypeConfig,
    availableRooms,
    updating,
    voidingBooking,
    voidReason,
    voiding,
    reactivatingBooking,
    reactivating,
    complimentaryBooking,
    complimentaryReason,
    complimentaryStartDate,
    complimentaryEndDate,
    markingComplimentary,
    paymentBooking,
    paymentAmount,
    paymentMethod,
    paymentNote,
    updatingPayment,
    setShowCheckoutModal,
    setShowCheckinModal,
    setInvoiceBooking,
    setShowInvoiceModal,
    setWorkflowDialogOpen,
    setWorkflowBooking,
    setCreateDialogOpen,
    setEditDialogOpen,
    setVoidDialogOpen,
    setReactivateDialogOpen,
    setComplimentaryDialogOpen,
    setPaymentDialogOpen,
    setSelectedBookingId,
    setBookingDetailsOpen,
    setBookingView,
    setCheckoutBooking,
    setCheckinBooking,
    setProcessingCheckIn,
    setCiPaymentChoice,
    setCiPaymentMethod,
    setCiAmountPaid,
    setCiDepositChoice,
    setCiDepositAmount,
    setCiDepositMethod,
    setCiWaiveReason,
    setEditingBooking,
    setEditFormData,
    setAvailableRooms,
    setVoidingBooking,
    setVoidReason,
    setReactivatingBooking,
    setComplimentaryBooking,
    setComplimentaryReason,
    setComplimentaryStartDate,
    setComplimentaryEndDate,
    setPaymentBooking,
    setPaymentAmount,
    setPaymentMethod,
    setPaymentNote,
    handleCheckIn,
    handleConfirmCheckIn,
    handleCheckOut,
    handleConfirmCheckout,
    handleVoidBooking,
    handleConfirmVoid,
    handleReactivateBooking,
    handleConfirmReactivate,
    handleMarkComplimentary,
    handleConfirmComplimentary,
    handleUpdatePaymentStatus,
    handleConfirmPaymentUpdate,
    handleEditBooking,
    handleUpdateBooking,
    handleTakePaymentAction,
    handleViewInvoice,
    handleViewWorkflow,
  };
}