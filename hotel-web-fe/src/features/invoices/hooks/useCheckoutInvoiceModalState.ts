/**
 * Custom hook encapsulating all state management and handlers for the
 * Checkout Invoice Modal. Extracted to reduce the component from
 * ~2,058 lines to a more manageable size.
 */
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookingWithDetails } from '../../../types';
import { queryKeys } from '../../../api/queryKeys';
import { InvoicesService } from '../../../api/invoices.service';
import { formatLocalDate } from '../../../utils/date';

interface UseCheckoutInvoiceModalStateProps {
  booking: BookingWithDetails | null;
  open: boolean;
  onConfirmCheckout: (data?: any, paymentMethod?: string) => Promise<void>;
  payments: any[];
  setPayments: React.Dispatch<React.SetStateAction<any[]>>;
  depositRefunded: boolean;
  setDepositRefunded: (v: boolean) => void;
  editableDailyRates: Record<string, number>;
  setEditableDailyRates: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  reloadPayments: () => Promise<void>;
}

export interface CheckoutInvoiceModalState {
  // UI state
  loading: boolean;
  error: string | null;
  checkoutStep: 'preview' | 'confirm';

  // Payment form
  showPaymentForm: boolean;
  paymentAmount: number;
  paymentMethod: string;
  paymentReference: string;
  paymentNotes: string;
  paymentDate: string;
  recordingPayment: boolean;

  // Payment editing
  editingPayment: any | null;
  editAmount: number;
  editMethod: string;
  editReference: string;
  editNotes: string;
  editDate: string;
  updatingPayment: boolean;
  deletingPaymentId: number | null;

  // Deposit refund
  refundingDeposit: boolean;
  refundPaymentMethod: string;

  // Deposit waive
  depositWaived: boolean;
  depositWaiveReason: string;

  // Rates editing
  editingRates: boolean;
  savingRates: boolean;

  // Computed
  totalPayments: number;
  balanceDue: number;

  // Setters
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setCheckoutStep: (v: 'preview' | 'confirm') => void;
  setShowPaymentForm: (v: boolean) => void;
  setPaymentAmount: (v: number) => void;
  setPaymentMethod: (v: string) => void;
  setPaymentReference: (v: string) => void;
  setPaymentNotes: (v: string) => void;
  setPaymentDate: (v: string) => void;
  setEditingPayment: (v: any | null) => void;
  setEditAmount: (v: number) => void;
  setEditMethod: (v: string) => void;
  setEditReference: (v: string) => void;
  setEditNotes: (v: string) => void;
  setEditDate: (v: string) => void;
  setRefundingDeposit: (v: boolean) => void;
  setRefundPaymentMethod: (v: string) => void;
  setDepositWaived: (v: boolean) => void;
  setDepositWaiveReason: (v: string) => void;
  setEditingRates: (v: boolean) => void;
  setSavingRates: (v: boolean) => void;

  // Handlers
  handleRecordPayment: () => Promise<void>;
  handleStartEdit: (payment: any) => void;
  handleCancelEdit: () => void;
  handleUpdatePayment: () => Promise<void>;
  handleDeletePayment: (paymentId: number) => Promise<void>;
  handleRefundDeposit: () => Promise<void>;
  handleConfirmCheckout: () => Promise<void>;
  handleSaveDailyRates: () => Promise<void>;
  handleProceedToConfirm: () => void;
  handleBackToPreview: () => void;
}

export function useCheckoutInvoiceModalState(
  props: UseCheckoutInvoiceModalStateProps,
): CheckoutInvoiceModalState {
  const { booking, open, onConfirmCheckout, payments, setPayments, depositRefunded, setDepositRefunded, editableDailyRates, setEditableDailyRates, reloadPayments } = props;
  const queryClient = useQueryClient();

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<'preview' | 'confirm'>('preview');

  // Payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentDate, setPaymentDate] = useState(formatLocalDate());
  const [recordingPayment, setRecordingPayment] = useState(false);

  // Payment editing
  const [editingPayment, setEditingPayment] = useState<any | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editMethod, setEditMethod] = useState('Cash');
  const [editReference, setEditReference] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');
  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<number | null>(null);

  // Deposit refund
  const [refundingDeposit, setRefundingDeposit] = useState(false);
  const [refundPaymentMethod, setRefundPaymentMethod] = useState('cash');

  // Deposit waive
  const [depositWaived, setDepositWaived] = useState(false);
  const [depositWaiveReason, setDepositWaiveReason] = useState('');

  // Rates editing
  const [editingRates, setEditingRates] = useState(false);
  const [savingRates, setSavingRates] = useState(false);

  // Computed
  const totalPayments: number = payments.filter((p: any) => p.payment_status === 'completed').reduce((sum: number, p: any) => sum + parseFloat(p.total_amount || '0'), 0);

  const invalidateInvoiceState = () => {
    if (!booking) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.preview(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.payments(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.paymentWorkflow(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
  };

  // Reset UI state when booking/open changes
  useEffect(() => {
    if (open && booking) {
      setCheckoutStep('preview');
      setShowPaymentForm(true);
      setPaymentAmount(0);
      const bookingPaymentMethod = booking.payment_method
        ? booking.payment_method.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
        : 'Cash';
      setPaymentMethod(bookingPaymentMethod);
      setPaymentReference('');
      setPaymentNotes('');
      setDepositWaived(false);
      setDepositWaiveReason('');
    }
  }, [open, booking]);

  // Pre-fill payment amount when charges update
  useEffect(() => {
    if (open && booking) {
      const balance = Number(booking.total_amount) - totalPayments;
      if (balance > 0) {
        setPaymentAmount(parseFloat(balance.toFixed(2)));
      }
    }
  }, [open, booking, totalPayments]);

  // Handlers
  const handleRecordPayment = async () => {
    if (!booking || paymentAmount <= 0) return;
    try {
      setRecordingPayment(true);
      const newPayment = await InvoicesService.recordPayment({
        booking_id: Number(booking.id),
        amount: paymentAmount,
        payment_method: paymentMethod,
        transaction_reference: paymentReference || undefined,
        notes: paymentNotes || undefined,
        payment_date: paymentDate || undefined,
      });
      setPayments(prev => [...prev, newPayment]);
      invalidateInvoiceState();
      setShowPaymentForm(false);
      setPaymentAmount(0);
      setPaymentReference('');
      setPaymentNotes('');
      setPaymentDate(formatLocalDate());
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleStartEdit = (payment: any) => {
    setEditingPayment(payment);
    setEditAmount(parseFloat(payment.total_amount || '0'));
    setEditMethod(payment.payment_method?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Cash');
    setEditReference(payment.transaction_reference || '');
    setEditNotes(payment.notes || '');
    const rawPaymentDate = payment.payment_date || payment.created_at;
    const parsedPaymentDate = rawPaymentDate ? new Date(rawPaymentDate) : null;
    const paymentDate = parsedPaymentDate && !isNaN(parsedPaymentDate.getTime())
      ? formatLocalDate(parsedPaymentDate)
      : formatLocalDate();
    setEditDate(paymentDate);
  };

  const handleCancelEdit = () => {
    setEditingPayment(null);
    setEditAmount(0);
    setEditMethod('Cash');
    setEditReference('');
    setEditNotes('');
    setEditDate('');
  };

  const handleUpdatePayment = async () => {
    if (!editingPayment || editAmount <= 0) return;
    try {
      setUpdatingPayment(true);
      const updatedPayment = await InvoicesService.updatePayment(editingPayment.id, {
        amount: editAmount,
        payment_method: editMethod,
        transaction_reference: editReference || undefined,
        notes: editNotes || undefined,
        payment_date: editDate || undefined,
      });
      setPayments(prev => prev.map(p => p.id === editingPayment.id ? updatedPayment : p));
      invalidateInvoiceState();
      handleCancelEdit();
    } catch (err: any) {
      setError(err.message || 'Failed to update payment');
    } finally {
      setUpdatingPayment(false);
    }
  };

  const handleDeletePayment = async (paymentId: number) => {
    if (!window.confirm('Are you sure you want to delete this payment record?')) return;
    try {
      setDeletingPaymentId(paymentId);
      const deletedPayment = payments.find(p => p.id === paymentId);
      await InvoicesService.deletePayment(paymentId);
      setPayments(prev => prev.filter(p => p.id !== paymentId));
      invalidateInvoiceState();
      if (deletedPayment?.payment_status === 'refunded') {
        setDepositRefunded(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete payment');
    } finally {
      setDeletingPaymentId(null);
    }
  };

  const handleRefundDeposit = async () => {
    if (!booking) return;
    try {
      setRefundingDeposit(true);
      const refundPayment = await (InvoicesService as any).refundDeposit({
        booking_id: Number(booking.id),
        payment_method: refundPaymentMethod,
      });
      setPayments(prev => [...prev, refundPayment]);
      setDepositRefunded(true);
      invalidateInvoiceState();
    } catch (err: any) {
      setError(err.message || 'Failed to refund deposit');
    } finally {
      setRefundingDeposit(false);
    }
  };

  const handleConfirmCheckout = async () => {
    if (!booking) return;
    try {
      setLoading(true);
      await onConfirmCheckout();
      invalidateInvoiceState();
    } catch (err: any) {
      setError(err.message || 'Failed to checkout');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDailyRates = async () => {
    if (!booking) return;
    try {
      setSavingRates(true);
      await (InvoicesService as any).updateDailyRates({
        booking_id: Number(booking.id),
        daily_rates: editableDailyRates,
      });
      invalidateInvoiceState();
      setEditingRates(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save rates');
    } finally {
      setSavingRates(false);
    }
  };

  const handleProceedToConfirm = () => setCheckoutStep('confirm');
  const handleBackToPreview = () => setCheckoutStep('preview');

  return {
    loading, error, checkoutStep,
    showPaymentForm, paymentAmount, paymentMethod, paymentReference, paymentNotes, paymentDate, recordingPayment,
    editingPayment, editAmount, editMethod, editReference, editNotes, editDate, updatingPayment, deletingPaymentId,
    refundingDeposit, refundPaymentMethod,
    depositWaived, depositWaiveReason,
    editingRates, savingRates,
    totalPayments, balanceDue: Number(booking?.total_amount || 0) - totalPayments,
    setLoading, setError, setCheckoutStep,
    setShowPaymentForm, setPaymentAmount, setPaymentMethod, setPaymentReference, setPaymentNotes, setPaymentDate,
    setEditingPayment, setEditAmount, setEditMethod, setEditReference, setEditNotes, setEditDate,
    setRefundingDeposit, setRefundPaymentMethod,
    setDepositWaived, setDepositWaiveReason,
    setEditingRates, setSavingRates,
    handleRecordPayment, handleStartEdit, handleCancelEdit, handleUpdatePayment,
    handleDeletePayment, handleRefundDeposit, handleConfirmCheckout,
    handleSaveDailyRates, handleProceedToConfirm, handleBackToPreview,
  };
}
