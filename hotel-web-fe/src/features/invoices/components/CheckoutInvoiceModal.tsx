import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Grid,
  Divider,
  Paper,
  Chip,
  Alert,
  CircularProgress,
  TextField,
  InputAdornment,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Collapse,
} from '@mui/material';
import {
  Receipt as ReceiptIcon,
  CheckCircle as CheckIcon,
  Print as PrintIcon,

  Business as BusinessIcon,
  Payment as PaymentIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { BookingWithDetails, CustomerLedger } from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';
import { BookingsService } from '../../../api';
import { InvoicesService } from '../../../api/invoices.service';
import { LedgerService } from '../../../api/ledger.service';
import { queryKeys } from '../../../api/queryKeys';
import { useCheckoutInvoiceData } from '../hooks/useCheckoutInvoiceData';
import { useDepositResolution } from '../hooks/useDepositResolution';
import { calculateChargesFromInputs, emptyCharges, ChargesBreakdown } from '../utils/chargesCalculation';
import { isDepositLikePayment, settledPaymentsTotal } from '../utils/payments';
import type { CheckoutPaymentRecord } from '../types';
import CheckoutInvoicePrintView from './CheckoutInvoicePrintView';
import DepositSection, { DEPOSIT_STATUS_CHIP } from './DepositSection';
import type { DepositForfeitInput, DepositRefundInput } from './DepositSection';
import { formatHotelDateTime, formatLocalDate, parseLocalDate, addLocalDays, toHotelDateString } from '../../../utils/date';
import { divideMoney, isGreaterMoney, isPositiveMoney, subtractMoney, toMoneyNumber } from '../../../utils/money';
import { formatStatusLabel } from '../../../utils/formatters';
import { getIdempotencyAttempt, type IdempotencyAttempt } from '../../../utils/idempotency';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import CollapsibleSection, { type CollapsibleSectionProps } from '../../../components/common/CollapsibleSection';
import StatusChip from '../../../components/common/StatusChip';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { useAuth } from '../../../auth/AuthContext';

interface CheckoutInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  booking: BookingWithDetails | null;
  onConfirmCheckout?: (lateCheckoutData?: { penalty: number; notes: string }, paymentMethod?: string) => Promise<void>;
  readOnly?: boolean;
  /**
   * When viewing a company city-ledger invoice, the customer ledger whose
   * payments back this booking. Payments and balance are then sourced from the
   * ledger (`customer_ledger_payments`) instead of the booking payments table,
   * and the inline record/edit/delete payment controls are hidden — company
   * payments are managed on the ledger itself.
   */
  ledger?: CustomerLedger | null;
  /**
   * Called after a city-ledger payment is recorded/edited/deleted from this
   * modal, so the parent (e.g. the Customer Ledger page) can refresh its
   * balances/collection totals.
   */
  onLedgerPaymentsChanged?: () => void;
}

const normalizeLedgerPaymentText = (value: string): string | undefined => {
  const normalized = value.trim();
  return normalized || undefined;
};

const getPaymentTimestamp = (payment: CheckoutPaymentRecord): string => (
  payment.payment_date || payment.created_at || ''
);

// Payment timestamps are instants (timestamptz); derive their calendar date /
// wall time in the hotel timezone so every viewer sees the same business date.
const formatPaymentDateForInput = (payment: CheckoutPaymentRecord): string =>
  toHotelDateString(getPaymentTimestamp(payment)) || formatLocalDate();

const formatPaymentDateTime = (payment: CheckoutPaymentRecord): string =>
  formatHotelDateTime(getPaymentTimestamp(payment));

/**
 * Phone-only collapsible wrapper for the step-1 money sections. On a phone
 * the section renders behind a CollapsibleSection header; on larger
 * viewports the children render unchanged so this shared modal keeps its
 * desktop invoice layout exactly. All wrapped inputs are controlled from
 * modal-level state, so the collapse's unmountOnExit drops no user input.
 */
const PhoneCollapsibleSection: React.FC<CollapsibleSectionProps & { isPhone: boolean }> = ({
  isPhone,
  children,
  ...sectionProps
}) => (isPhone ? <CollapsibleSection {...sectionProps}>{children}</CollapsibleSection> : <>{children}</>);

const CheckoutInvoiceModal: React.FC<CheckoutInvoiceModalProps> = ({
  open,
  onClose,
  booking,
  onConfirmCheckout,
  readOnly = false,
  ledger = null,
  onLedgerPaymentsChanged,
}) => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const isPhone = useIsPhone();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<'preview' | 'confirm'>('preview');

  const {
    hotelSettings,
    roomPrice,
    guestCompanyName,
    guestAddress,
    guestPhone,
    guestIcNumber,
    payments,
    setPayments,
    depositRefunded,
    setDepositRefunded,
    editableDailyRates,
    setEditableDailyRates,
    reloadPayments,
  } = useCheckoutInvoiceData(booking, open, ledger);

  // Company city-ledger receipt: payments come from the ledger and are managed
  // there, so the inline record/edit/delete controls are hidden here.
  const isLedgerView = Boolean(ledger);

  const { hasPermission } = useAuth();

  const invalidateInvoiceState = () => {
    if (!booking) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.preview(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.payments(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.paymentWorkflow(booking.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
  };

  // Payment recording state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentDate, setPaymentDate] = useState(formatLocalDate());
  const [recordingPayment, setRecordingPayment] = useState(false);
  const paymentAttemptRef = useRef<IdempotencyAttempt | null>(null);

  // Payment editing state
  const [editingPayment, setEditingPayment] = useState<CheckoutPaymentRecord | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editMethod, setEditMethod] = useState('Cash');
  const [editReference, setEditReference] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');
  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<number | null>(null);

  // Deposit waive state — the local flag bridges the gap between a
  // successful waive-path cancel and the booking-mirror refetch (the hook
  // derives `mirrorDue` off the booking prop, which lags one invalidation).
  const [depositWaived, setDepositWaived] = useState(false);
  const [depositWaiveReason, setDepositWaiveReason] = useState('');

  // Editable daily rates UI state
  const [editingRates, setEditingRates] = useState(false);
  const [savingRates, setSavingRates] = useState(false);

  // Derived charges (pure calculation, no state mutation needed)
  const charges: ChargesBreakdown = booking
    ? calculateChargesFromInputs(booking, roomPrice, hotelSettings, editableDailyRates)
    : emptyCharges;



  // Reset UI state when booking/open changes
  useEffect(() => {
    if (open && booking) {
      setCheckoutStep('preview');
      setShowPaymentForm(true);
      setPaymentAmount(0);
      const bookingPaymentMethod = booking.payment_method
        ? formatStatusLabel(booking.payment_method)
        : 'Cash';
      setPaymentMethod(bookingPaymentMethod);
      setPaymentReference('');
      setPaymentNotes('');
      setDepositWaived(false);
      setDepositWaiveReason('');
    }
  }, [open, booking]);

  // Pre-fill payment amount with the outstanding balance. For a city-ledger
  // invoice that balance comes from the ledger (the receipt's authoritative
  // balance_due); otherwise it's the booking total minus payments collected.
  useEffect(() => {
    if (!open || !booking) return;
    const balance = isLedgerView && ledger
      ? toMoneyNumber(ledger.balance_due)
      : subtractMoney(charges.grandTotal, settledPaymentsTotal(payments));
    if (isPositiveMoney(balance)) {
      setPaymentAmount(balance);
    }
  }, [open, booking, charges.grandTotal, payments, isLedgerView, ledger]);

  // Only bill-settling payments reduce the balance. Deposit-type rows
  // (`deposit`, `deposit_forfeited`) are held/kept collateral, never bill
  // payment — counting them is what produced the false "Overpayment" incident.
  const paymentRowsTotal = settledPaymentsTotal(payments);
  // For a company city-ledger invoice the ledger is the source of truth for the
  // invoiced amount and outstanding balance (per CLAUDE.md the backend is the
  // sole authority for company ledger rows). The booking-derived charges are
  // only a line-item breakdown and can diverge after manual ledger adjustments,
  // so the header total and balance due mirror the ledger to match the receipt.
  const displayTotal = isLedgerView && ledger ? toMoneyNumber(ledger.amount) : charges.grandTotal;
  const balanceDue = isLedgerView && ledger
    ? toMoneyNumber(ledger.balance_due)
    : subtractMoney(charges.grandTotal, paymentRowsTotal);
  const hasBalanceDue = isPositiveMoney(balanceDue);
  const isCompanyBilling = Boolean(booking?.company_id || booking?.company_name?.trim());
  const requiresFullPaymentBeforeCheckout = !isCompanyBilling && hasBalanceDue;
  const completedPayments = payments.filter(
    (payment) => payment.payment_status === 'completed' && !isDepositLikePayment(payment),
  );
  const depositPayments = payments.filter(
    (payment) => payment.payment_status === 'completed' && isDepositLikePayment(payment),
  );
  const refundedPayments = payments.filter((payment) => payment.payment_status === 'refunded');

  // Deposit resolution — derivation (collected/refunded/forfeited/remaining,
  // status enum) and the mutations all live in the hook; the modal keeps the
  // confirm-dialog orchestration and the waive flag above. The booking
  // mirror's own waive detection keeps the legacy `payment_note` convention
  // ('Deposit waived: …' was written that way before resolution statuses).
  const {
    deposit: depositResolution,
    refunding: refundingDeposit,
    forfeiting: forfeitingDeposit,
    cancelling: cancellingDeposit,
    reverting: revertingRefund,
    restoring: restoringDeposit,
    refund: refundDeposit,
    forfeit: forfeitDeposit,
    cancelUncollected,
    revertRefund,
    restoreDeposit,
  } = useDepositResolution({
    booking,
    payments,
    depositWaived: depositWaived || Boolean(booking?.payment_note?.includes('waived')),
    reloadPayments,
    setError,
    invalidateInvoiceState,
  });

  // Resolution permission gates — `cancel` mirrors the hook's auto-route:
  // completed deposit rows → per-row void (`payments:delete`); no rows →
  // the booking-mirror waive (`bookings:update`).
  const hasCompletedDepositRows = payments.some(
    (payment) =>
      (payment.payment_type || '').toLowerCase() === 'deposit'
      && payment.payment_status === 'completed',
  );
  const canRefundOrForfeitDeposit = hasPermission('payments:refund');
  const canCancelDeposit = hasCompletedDepositRows
    ? hasPermission('payments:delete')
    : hasPermission('bookings:update');
  const canRevertDepositRefund = hasPermission('payments:manage');
  const canRestoreDeposit = hasPermission('payments:delete');

  const handleRecordPayment = async () => {
    if (!booking || !isPositiveMoney(paymentAmount)) return;
    const amount = toMoneyNumber(paymentAmount);
    const paymentMethodValue = isLedgerView ? paymentMethod.trim() : paymentMethod;
    const paymentReferenceValue = isLedgerView
      ? normalizeLedgerPaymentText(paymentReference)
      : paymentReference || undefined;
    const notes = isLedgerView ? normalizeLedgerPaymentText(paymentNotes) : paymentNotes || undefined;
    const paymentDateValue = isLedgerView ? normalizeLedgerPaymentText(paymentDate) : paymentDate || undefined;
    const attempt = getIdempotencyAttempt(paymentAttemptRef.current, JSON.stringify({
      kind: isLedgerView ? 'ledger-payment' : 'booking-payment',
      id: isLedgerView ? ledger?.id : Number(booking.id),
      amount: amount.toFixed(2),
      payment_method: paymentMethodValue,
      payment_type: undefined,
      payment_reference: paymentReferenceValue,
      receipt_number: undefined,
      notes,
      payment_date: paymentDateValue,
    }));
    paymentAttemptRef.current = attempt;
    try {
      setRecordingPayment(true);
      if (isLedgerView && ledger) {
        // City-ledger invoice: post against the customer ledger, not the booking.
        await LedgerService.createLedgerPayment(ledger.id, {
          payment_amount: amount,
          payment_method: paymentMethodValue,
          payment_reference: paymentReferenceValue,
          notes,
          payment_date: paymentDateValue,
          idempotency_key: attempt.key,
        });
        await reloadPayments();
        onLedgerPaymentsChanged?.();
      } else {
        const newPayment = await InvoicesService.recordPayment({
          booking_id: Number(booking.id),
          amount,
          payment_method: paymentMethodValue,
          transaction_reference: paymentReferenceValue,
          notes,
          payment_date: paymentDateValue,
          idempotency_key: attempt.key,
        });
        setPayments(prev => [...prev, newPayment]);
        invalidateInvoiceState();
      }
      // Review finding I2: the attempt is released only after every step that
      // can throw. Clearing it right after the POST meant a failing refetch
      // fell into the catch below, showed "Failed to record payment" for a
      // payment that had in fact committed, and left the retry to mint a NEW
      // key -- charging the guest twice. While it is retained, an identical
      // retry replays server-side instead.
      paymentAttemptRef.current = null;
      setShowPaymentForm(false);
      setPaymentAmount(0);
      setPaymentReference('');
      setPaymentNotes('');
      setPaymentDate(formatLocalDate());
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to record payment');
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleStartEdit = (payment: CheckoutPaymentRecord) => {
    setEditingPayment(payment);
    setEditAmount(toMoneyNumber(payment.total_amount));
    const storedMethod = payment.payment_method || '';
    const matchedMethod = hotelSettings.payment_methods.find(
      (method) => method.toLowerCase() === storedMethod.toLowerCase(),
    );
    setEditMethod(matchedMethod || storedMethod || 'Cash');
    setEditReference(payment.transaction_reference || '');
    setEditNotes(payment.notes || '');
    setEditDate(formatPaymentDateForInput(payment));
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
    if (!editingPayment) return;
    // Deposit-like rows admit only a method correction — their amount and
    // date are immutable once posted, so the positive-amount gate applies
    // just to the full edit form.
    const depositLike = isDepositLikePayment(editingPayment);
    if (!depositLike && !isPositiveMoney(editAmount)) return;
    try {
      setUpdatingPayment(true);
      if (isLedgerView && ledger) {
        await LedgerService.updateLedgerPayment(ledger.id, editingPayment.id, {
          payment_date: editDate || formatLocalDate(),
          payment_amount: editAmount,
          payment_method: editMethod,
          payment_reference: editReference || undefined,
          notes: editNotes || undefined,
        });
        await reloadPayments();
        onLedgerPaymentsChanged?.();
      } else if (depositLike) {
        // Method-only correction: PATCH /payments rejects amount/date edits
        // on posted deposit rows, so the request sends just the tender.
        const updatedPayment = await InvoicesService.updatePayment(editingPayment.id, {
          payment_method: editMethod,
        });
        setPayments(prev => prev.map(p => p.id === editingPayment.id ? updatedPayment : p));
        invalidateInvoiceState();
      } else {
        const updatedPayment = await InvoicesService.updatePayment(editingPayment.id, {
          amount: editAmount,
          payment_method: editMethod,
          transaction_reference: editReference || undefined,
          notes: editNotes || undefined,
          payment_date: editDate || undefined,
        });
        setPayments(prev => prev.map(p => p.id === editingPayment.id ? updatedPayment : p));
        invalidateInvoiceState();
      }
      handleCancelEdit();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to update payment');
    } finally {
      setUpdatingPayment(false);
    }
  };

  const handleDeletePayment = async (paymentId: number) => {
    const accepted = await confirm({
      title: 'Delete payment record',
      message: 'This removes the payment from the folio and restores the outstanding balance. This cannot be undone.',
      confirmText: 'Delete payment',
      severity: 'error',
    });
    if (!accepted) return;
    try {
      setDeletingPaymentId(paymentId);
      if (isLedgerView && ledger) {
        await LedgerService.deleteLedgerPayment(ledger.id, paymentId);
        await reloadPayments();
        onLedgerPaymentsChanged?.();
        return;
      }
      // Check if this is a refund payment before deleting
      const deletedPayment = payments.find(p => p.id === paymentId);
      await InvoicesService.deletePayment(paymentId);
      setPayments(prev => prev.filter(p => p.id !== paymentId));
      invalidateInvoiceState();
      // Reset depositRefunded if a refund payment was deleted — voided
      // refund rows no longer count, so detection is the row status alone.
      if (deletedPayment?.payment_status === 'refunded') {
        setDepositRefunded(false);
      }
      // Deleting a deposit_forfeited row (the un-forfeit escape hatch)
      // re-opens the deposit as refundable — no flag to clear here since
      // the resolution re-derives `pending` from the rows on the next render.
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to delete payment');
    } finally {
      setDeletingPaymentId(null);
    }
  };

  // The destructive confirms stay in the modal per the hook contract — the
  // section fires its callbacks directly (forfeit's review step is its own
  // confirmation inside the panel).
  const handleRefundDeposit = (input: DepositRefundInput) => {
    void refundDeposit(input);
  };

  const handleForfeitDeposit = (input: DepositForfeitInput) => {
    void forfeitDeposit(input);
  };

  // Cancelling marks the deposit "not collected": with completed deposit
  // rows the hook voids each (kept server-side as 'void', restorable via
  // Restore); with none it waives the booking mirror. The section collects
  // the required reason first.
  const handleCancelDeposit = async (reason: string) => {
    const hadCompletedDepositRows = hasCompletedDepositRows;
    const accepted = await confirm({
      title: 'Cancel deposit',
      message: hadCompletedDepositRows
        ? 'Marks the deposit as not collected. The payment record is kept as void and the cancellation can be reverted.'
        : 'Marks the deposit as not collected — no money was received. The booking deposit flag is cleared.',
      confirmText: 'Cancel deposit',
      severity: 'warning',
    });
    if (!accepted) return;
    const cancelled = await cancelUncollected(reason);
    if (cancelled && !hadCompletedDepositRows) {
      // Waive path: flag it locally until the booking refetch lands — the
      // mirror still asserts the deposit while the invalidation is in flight.
      setDepositWaived(true);
      setDepositWaiveReason(reason);
    }
  };

  const handleRevertDepositRefund = async () => {
    const accepted = await confirm({
      title: 'Revert deposit refund',
      message: 'This removes the refund record so the deposit can be refunded again.',
      confirmText: 'Revert refund',
      severity: 'warning',
    });
    if (!accepted) return;
    await revertRefund();
  };

  const handleRestoreDeposit = () => {
    void restoreDeposit();
  };

  const handleConfirmCheckout = async () => {
    try {
      setLoading(true);
      setError(null);

      // Save daily rates if edited but not yet saved
      if (booking && editingRates && Object.keys(editableDailyRates).length > 0) {
        await handleSaveDailyRates();
      }

      if (requiresFullPaymentBeforeCheckout) {
        setError('Please settle the full balance before proceeding to checkout.');
        return;
      }

      await onConfirmCheckout?.(undefined, paymentMethod);
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to process checkout');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDailyRates = async () => {
    if (!booking) return;
    try {
      setSavingRates(true);
      const totalFromRates = Object.values(editableDailyRates).reduce((sum, r) => sum + (r || 0), 0);
      await BookingsService.updateBooking(booking.id, {
        daily_rates: editableDailyRates,
        room_rate_override: totalFromRates / Object.keys(editableDailyRates).length,
      });
      invalidateInvoiceState();
      setEditingRates(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to save daily rates');
    } finally {
      setSavingRates(false);
    }
  };

  const handleProceedToConfirm = () => {
    setCheckoutStep('confirm');
  };

  const handleBackToPreview = () => {
    setCheckoutStep('preview');
  };

  const handlePrint = () => {
    // Get the invoice content
    const invoiceContent = document.getElementById('printable-invoice');
    if (!invoiceContent) return;

    // Create an iframe for printing (works better in Tauri desktop apps)
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'absolute';
    printFrame.style.top = '-10000px';
    printFrame.style.left = '-10000px';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    document.body.appendChild(printFrame);

    const printDoc = printFrame.contentDocument || printFrame.contentWindow?.document;
    if (!printDoc) {
      document.body.removeChild(printFrame);
      return;
    }

    // Write the invoice HTML with styles
    printDoc.open();
    printDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice - ${booking?.invoice_number || booking?.folio_number || `#${booking?.id}`}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
              color: #333;
            }
            .invoice-header {
              text-align: center;
              margin-bottom: 30px;
              border-bottom: 2px solid #1976d2;
              padding-bottom: 20px;
            }
            .invoice-header h1 {
              color: #1976d2;
              font-size: 28px;
              margin-bottom: 5px;
            }
            .invoice-header p {
              color: #666;
              font-size: 14px;
            }
            .invoice-meta {
              display: flex;
              justify-content: space-between;
              margin-bottom: 30px;
            }
            .invoice-meta div {
              flex: 1;
            }
            .invoice-meta h3 {
              font-size: 14px;
              color: #1976d2;
              margin-bottom: 10px;
              text-transform: uppercase;
            }
            .invoice-meta p {
              font-size: 13px;
              margin: 5px 0;
              line-height: 1.6;
            }
            .invoice-meta .label {
              color: #666;
              display: inline-block;
              min-width: 120px;
            }
            .invoice-meta .value {
              font-weight: 600;
              color: #333;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }
            th {
              background-color: #1976d2;
              color: white;
              padding: 12px;
              text-align: left;
              font-size: 13px;
              text-transform: uppercase;
            }
            td {
              padding: 12px;
              border-bottom: 1px solid #ddd;
              font-size: 13px;
            }
            .amount {
              text-align: right;
              font-weight: 600;
            }
            .subtotal-row td {
              border-top: 2px solid #ddd;
              font-weight: 600;
              padding-top: 15px;
            }
            .refund-row td {
              color: #2e7d32;
            }
            .penalty-row td {
              color: #d32f2f;
            }
            .total-row {
              background-color: #f5f5f5;
            }
            .total-row td {
              border-top: 3px double #1976d2;
              font-size: 16px;
              font-weight: 700;
              padding: 15px 12px;
              color: #1976d2;
            }
            .notes {
              margin-top: 30px;
              padding: 15px;
              background-color: #fff3cd;
              border-left: 4px solid #ffc107;
              font-size: 12px;
              line-height: 1.6;
            }
            .notes strong {
              display: block;
              margin-bottom: 5px;
              color: #856404;
            }
            .success-note {
              background-color: #d4edda;
              border-left-color: #28a745;
            }
            .success-note strong {
              color: #155724;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              padding-top: 20px;
              border-top: 1px solid #ddd;
              font-size: 12px;
              color: #666;
            }
            .footer strong {
              display: block;
              font-size: 14px;
              color: #1976d2;
              margin-bottom: 5px;
            }
            @media print {
              body {
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          ${invoiceContent.innerHTML}
        </body>
      </html>
    `);
    printDoc.close();

    // Wait for content to load, then print
    setTimeout(() => {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();

      // Clean up the iframe after printing
      setTimeout(() => {
        document.body.removeChild(printFrame);
      }, 1000);
    }, 250);
  };

  if (!booking) return null;

  const isHourlyBooking = booking.post_type === 'hourly' || booking.check_in_date === booking.check_out_date;

  const calculateNights = () => {
    if (isHourlyBooking) return 0;
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    return Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  };

  // Get actual checkout date from booking data
  const getActualCheckoutDate = () => {
    if (booking.actual_check_out) {
      return new Date(booking.actual_check_out);
    }
    return new Date(booking.check_out_date);
  };

  // Compare the actual checkout date against the scheduled checkout date
  // (date-only). Drives the "Early"/"Late" badge and the "Scheduled" line so
  // the invoice explains any divergence between the two dates instead of
  // silently showing a range that doesn't match the nights charged.
  const getCheckoutVariance = (): 'early' | 'late' | null => {
    const actual = getActualCheckoutDate();
    actual.setHours(0, 0, 0, 0);
    const scheduledCheckout = new Date(booking.check_out_date);
    scheduledCheckout.setHours(0, 0, 0, 0);
    if (actual.getTime() < scheduledCheckout.getTime()) return 'early';
    if (actual.getTime() > scheduledCheckout.getTime()) return 'late';
    return null;
  };
  const isEarlyCheckout = () => getCheckoutVariance() === 'early';
  const isLateCheckout = () => getCheckoutVariance() === 'late';

  const formatBookingStatus = (status?: string) => formatStatusLabel(status, 'Unknown');

  // Bill balance strip — explicit wording instead of the bare "Fully Paid"/
  // "Balance Due" labels: a held deposit is collateral owed to the guest,
  // so the bill's own state must read unambiguously next to it.
  const billBalanceLabel = !hasBalanceDue
    ? 'Paid'
    : isPositiveMoney(paymentRowsTotal)
      ? 'Partially paid'
      : 'Outstanding';

  // Checkout readiness — one strip states every unmet condition, replacing
  // the old scattered deposit alerts (and the confirm step's duplicate).
  // The same derived values drive the action buttons' disabled state; the
  // backend checkout gate stays authoritative.
  const depositHeld = isPositiveMoney(depositResolution.remaining)
    ? depositResolution.remaining
    : depositResolution.mirrorDue;
  const blockers: string[] = [];
  if (depositResolution.status === 'pending') {
    blockers.push(`Resolve the ${formatCurrency(depositHeld)} security deposit`);
  }
  if (requiresFullPaymentBeforeCheckout) {
    blockers.push(`Settle the outstanding bill balance of ${formatCurrency(balanceDue)}`);
  }
  // Resolved-state wording shared by the readiness strip and the confirm
  // step's deposit row. 'none' returns '' (no deposit line at all).
  const depositResolutionWording = (() => {
    switch (depositResolution.status) {
      case 'refunded':
        return `refunded ${formatCurrency(depositResolution.refunded)}${
          depositResolution.refundMethod ? ` via ${depositResolution.refundMethod}` : ''
        }`;
      case 'forfeited':
        return `forfeited ${formatCurrency(depositResolution.forfeited)}`;
      case 'partially_forfeited':
        return `partially forfeited ${formatCurrency(depositResolution.forfeited)}${
          isPositiveMoney(depositResolution.refunded)
            ? ` · remainder refunded ${formatCurrency(depositResolution.refunded)}`
            : ''
        }`;
      case 'cancelled':
      case 'waived':
        return 'cancelled — not collected';
      case 'pending':
        return `pending — ${formatCurrency(depositHeld)} still held`;
      default:
        return '';
    }
  })();
  // A positive balance is only compatible with readiness under company
  // billing, where the bill posts to the company ledger instead.
  const billWording = hasBalanceDue ? 'Bill to the company ledger' : 'Bill paid';
  const readinessMessage = blockers.length
    ? `Checkout is not ready — ${blockers.join(' · ')}`
    : `Ready for checkout — ${billWording}${
        depositResolutionWording ? ` · Deposit ${depositResolutionWording}` : ''
      }`;
  const readinessStrip = (
    <Alert severity={blockers.length ? 'warning' : 'success'} sx={{ mb: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {readinessMessage}
      </Typography>
    </Alert>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isPhone}>
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center"
            }}>
            <ReceiptIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">
              {readOnly
                ? 'Invoice'
                : checkoutStep === 'preview'
                  ? 'Invoice Preview - Review Before Checkout'
                  : 'Confirm Checkout'}
            </Typography>
          </Box>
          <Chip
            label={booking.folio_number || `#${booking.id}`}
            color="primary"
            size="small"
            variant="outlined"
          />
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {(readOnly || checkoutStep === 'preview') ? (
          // STEP 1: Invoice Preview — the paper document on a paper surface
          // (print identity is intentionally light; see docs/DESIGN_SYSTEM.md).
          (<Box sx={{ fontFamily: 'Arial, sans-serif', color: '#333', bgcolor: '#FFFFFF', p: 3, borderRadius: 1 }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
                {error}
              </Alert>
            )}
            {!readOnly && (
              <Alert severity="info" sx={{ mb: 3 }}>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>Please review the invoice carefully before proceeding with checkout.</Typography>
                <Typography variant="caption">Verify all charges, taxes, and refunds are correct.</Typography>
              </Alert>
            )}
            {/* Company Billing Indicator */}
            {booking.company_id && booking.company_name && (
              <Alert
                severity="warning"
                icon={<BusinessIcon />}
                sx={{ mb: 3 }}
              >
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>
                  Company Billing: {booking.company_name}
                </Typography>
                <Typography variant="caption">
                  Room charges will be automatically posted to the company ledger upon checkout.
                </Typography>
              </Alert>
            )}
            {/* Invoice Header */}
            <Box sx={{ textAlign: 'center', mb: 4, borderBottom: '2px solid #1976d2', pb: 2 }}>
              <Typography variant="h4" sx={{ color: '#1976d2', fontWeight: 700, mb: 0.5 }}>
                {hotelSettings.hotel_name}
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {hotelSettings.hotel_address}
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                Phone: {hotelSettings.hotel_phone} | Email: {hotelSettings.hotel_email}
              </Typography>
            </Box>
            {/* Invoice Meta */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" sx={{ color: '#1976d2', mb: 1, textTransform: 'uppercase' }}>
                  Invoice Details
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '120px' }}>
                    Invoice Number:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {booking?.invoice_number || booking?.folio_number || `#${booking?.id}`}
                  </Box>
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '120px' }}>
                    Date:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {new Date().toLocaleDateString()}
                  </Box>
                </Typography>
                <Typography variant="body2">
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '120px' }}>
                    Status:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {formatBookingStatus(booking.status)}
                  </Box>
                </Typography>
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" sx={{ color: '#1976d2', mb: 1.5, textTransform: 'uppercase' }}>
                  Guest Information
                </Typography>
                {([
                  { label: 'Name', value: booking?.guest_name },
                  { label: 'Room', value: `${booking?.room_number} - ${booking?.room_type}` },
                  guestCompanyName ? { label: 'Company', value: guestCompanyName } : null,
                  guestPhone ? { label: 'Phone', value: guestPhone } : null,
                  guestIcNumber ? { label: 'ID / IC', value: guestIcNumber } : null,
                  guestAddress ? { label: 'Address', value: guestAddress } : null,
                ] as Array<{ label: string; value: React.ReactNode } | null>)
                  .filter((item): item is { label: string; value: React.ReactNode } => item !== null)
                  .map((item) => (
                  <Box key={item.label} sx={{ display: 'flex', gap: 1, mb: 0.75 }}>
                    <Typography variant="body2" sx={{ color: '#666', minWidth: '72px', flexShrink: 0 }}>
                      {item.label}:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                      {item.value}
                    </Typography>
                  </Box>
                ))}
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" sx={{ color: '#1976d2', mb: 1, textTransform: 'uppercase' }}>
                  Stay Details
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '80px' }}>
                    Check-in:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {new Date(booking?.check_in_date || '').toLocaleDateString()}
                  </Box>
                </Typography>
                <Typography variant="body2" component="div" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '80px' }}>
                    Check-out:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {getActualCheckoutDate().toLocaleDateString()}
                    {isEarlyCheckout() && (
                      <Chip label="Early" size="small" color="info" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                    )}
                    {isLateCheckout() && (
                      <Chip label="Late" size="small" color="warning" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                    )}
                  </Box>
                </Typography>
                {getCheckoutVariance() && (
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '80px' }}>
                      Scheduled:
                    </Box>
                    <Box component="span" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                      {new Date(booking?.check_out_date || '').toLocaleDateString()}
                    </Box>
                  </Typography>
                )}
                <Typography variant="body2">
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '80px' }}>
                    Duration:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {isHourlyBooking ? 'Hourly Stay' : `${calculateNights()} night(s)`}
                  </Box>
                </Typography>
              </Grid>
            </Grid>
            {/* Charges Table */}
            <PhoneCollapsibleSection isPhone={isPhone} title="Charges">
            <Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
              <Box sx={{ bgcolor: '#1976d2', color: 'white', p: 1.5 }}>
                <Grid container>
                  <Grid size={8}>
                    <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                      Description
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                      Amount
                    </Typography>
                  </Grid>
                </Grid>
              </Box>

              <Box sx={{ p: 0 }}>
                {/* Room Charges - Day by Day */}
                {isHourlyBooking ? (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd' }}>
                    <Grid container>
                      <Grid size={8}>
                        <Typography variant="body2">Room Charges (Hourly Stay)</Typography>
                      </Grid>
                      <Grid sx={{ textAlign: 'right' }} size={4}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatCurrency(charges.roomCharges)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                ) : (
                  <>
                    {/* Edit / Save button row */}
                    {!readOnly && (
                      <Box sx={{ p: 1, px: 1.5, display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid #eee' }}>
                        {editingRates ? (
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            startIcon={<CheckIcon />}
                            onClick={handleSaveDailyRates}
                            disabled={savingRates}
                          >
                            {savingRates ? 'Saving...' : 'Save Rates'}
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<EditIcon />}
                            onClick={() => setEditingRates(true)}
                          >
                            Edit Rates
                          </Button>
                        )}
                      </Box>
                    )}
                    {(() => {
                      const nights = calculateNights();
                      const taxRate = hotelSettings.service_tax_rate / 100;
                      const taxMultiplier = 1 + taxRate;
                      const checkIn = parseLocalDate(booking.check_in_date);
                      return Array.from({ length: nights }, (_, i) => {
                        const date = addLocalDays(checkIn, i);
                        const dateStr = date.toLocaleDateString();
                        const dateKey = formatLocalDate(date);
                        const taxInclusiveRate = editableDailyRates[dateKey] || 0;
                        const dayRate = divideMoney(taxInclusiveRate, taxMultiplier);
                        const dayTax = subtractMoney(taxInclusiveRate, dayRate);
                        return (
                          <React.Fragment key={i}>
                            <Box sx={{ p: 1.5, borderBottom: isPositiveMoney(dayTax) ? 'none' : '1px solid #ddd' }}>
                              <Grid container sx={{
                                alignItems: "center"
                              }}>
                                <Grid size={editingRates ? { xs: 12, sm: 5 } : 8}>
                                  <Typography variant="body2">
                                    Room Charge — {dateStr}
                                  </Typography>
                                </Grid>
                                <Grid sx={{ textAlign: 'right' }} size={editingRates ? { xs: 12, sm: 7 } : 4}>
                                  {editingRates ? (
                                    <TextField
                                      size="small"
                                      type="number"
                                      value={taxInclusiveRate || ''}
                                      onChange={(e) => {
                                        const val = toMoneyNumber(e.target.value);
                                        setEditableDailyRates(prev => ({ ...prev, [dateKey]: val }));
                                      }}
                                      sx={{ width: { xs: '100%', sm: 160 }, '& .MuiInputBase-input': { textAlign: 'right', py: 0.5 } }}
                                      slotProps={{
                                        input: {
                                          startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                                        },

                                        htmlInput: { min: 0, step: 0.01 }
                                      }} />
                                  ) : (
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {formatCurrency(dayRate)}
                                    </Typography>
                                  )}
                                </Grid>
                              </Grid>
                            </Box>
                            {isPositiveMoney(dayTax) && (
                              <Box sx={{ p: 1.5, pl: 3, borderBottom: '1px solid #ddd', bgcolor: '#fafafa' }}>
                                <Grid container>
                                  <Grid size={8}>
                                    <Typography variant="body2" sx={{
                                      color: "text.secondary"
                                    }}>
                                      Service Tax ({hotelSettings.service_tax_rate}%)
                                    </Typography>
                                  </Grid>
                                  <Grid sx={{ textAlign: 'right' }} size={4}>
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        color: "text.secondary",
                                        fontWeight: 600
                                      }}>
                                      {formatCurrency(dayTax)}
                                    </Typography>
                                  </Grid>
                                </Grid>
                              </Box>
                            )}
                          </React.Fragment>
                        );
                      });
                    })()}
                  </>
                )}

                {/* Tourism Tax — billed per night */}
                {isPositiveMoney(charges.tourismTax) && (() => {
                  const nights = calculateNights();
                  if (isHourlyBooking || nights <= 0) {
                    return (
                      <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd' }}>
                        <Grid container>
                          <Grid size={8}>
                            <Typography variant="body2">Tourism Tax</Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={4}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {formatCurrency(charges.tourismTax)}
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    );
                  }
                  const perNight = divideMoney(charges.tourismTax, nights);
                  const checkIn = new Date(booking.check_in_date);
                  return Array.from({ length: nights }, (_, i) => {
                    const date = new Date(checkIn);
                    date.setDate(date.getDate() + i);
                    return (
                      <Box key={`tt-${i}`} sx={{ p: 1.5, borderBottom: '1px solid #ddd' }}>
                        <Grid container>
                          <Grid size={8}>
                            <Typography variant="body2">
                              Tourism Tax — {date.toLocaleDateString()}
                            </Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={4}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {formatCurrency(perNight)}
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    );
                  });
                })()}

                {/* Extra Bed */}
                {isPositiveMoney(charges.extraBedCharge) && (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd' }}>
                    <Grid container>
                      <Grid size={8}>
                        <Typography variant="body2">Extra Bed Charge</Typography>
                      </Grid>
                      <Grid sx={{ textAlign: 'right' }} size={4}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatCurrency(charges.extraBedCharge)}
                        </Typography>
                      </Grid>
                      {isPositiveMoney(charges.extraBedServiceTax) && (
                        <>
                          <Grid size={8}>
                            <Typography
                              variant="body2"
                              sx={{
                                color: "text.secondary",
                                pl: 2,
                                fontSize: '0.8rem'
                              }}>
                              Service Tax ({hotelSettings.service_tax_rate}%)
                            </Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={4}>
                            <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                              {formatCurrency(charges.extraBedServiceTax)}
                            </Typography>
                          </Grid>
                        </>
                      )}
                    </Grid>
                  </Box>
                )}



                {/* Grand Total */}
                <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderTop: '3px double #1976d2' }}>
                  <Grid container>
                    <Grid size={8}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {displayTotal >= 0 ? 'Total Amount Due' : 'Total Refund'}
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={4}>
                      <Typography variant="h5" sx={{ fontWeight: 700, color: '#1976d2' }}>
                        {formatCurrency(Math.abs(displayTotal))}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Box>
            </Box>
            </PhoneCollapsibleSection>
            {/* Deposit status card — guided refund/forfeit/cancel workflow. */}
            <PhoneCollapsibleSection isPhone={isPhone} title="Deposit adjustments" collapseOnPhone>
              <DepositSection
                resolution={depositResolution}
                busy={{
                  refunding: refundingDeposit,
                  forfeiting: forfeitingDeposit,
                  cancelling: cancellingDeposit,
                  reverting: revertingRefund,
                  restoring: restoringDeposit,
                }}
                can={{
                  refund: canRefundOrForfeitDeposit,
                  forfeit: canRefundOrForfeitDeposit,
                  cancel: canCancelDeposit,
                  revertRefund: canRevertDepositRefund,
                  restore: canRestoreDeposit,
                }}
                readOnly={readOnly}
                hotelSettings={hotelSettings}
                onRefund={handleRefundDeposit}
                onForfeit={handleForfeitDeposit}
                onCancel={handleCancelDeposit}
                onRevertRefund={handleRevertDepositRefund}
                onRestore={handleRestoreDeposit}
              />
            </PhoneCollapsibleSection>
            {/* The old "Payment Required" alert folded into the readiness
                strip at the end of the preview — it lists every blocker. */}
            {/* Payments Section */}
            <PhoneCollapsibleSection
              isPhone={isPhone}
              title="Payments"
              actions={hasBalanceDue && !editingPayment ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setShowPaymentForm(!showPaymentForm)}
                  startIcon={showPaymentForm ? <CloseIcon /> : <AddIcon />}
                >
                  {showPaymentForm ? 'Cancel' : 'Record Payment'}
                </Button>
              ) : undefined}
            >
            <Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
              {/* Green banner is the desktop section header; on phone the
                  CollapsibleSection header (with the same Record Payment
                  button in `actions`) replaces it. */}
              <Box sx={{ bgcolor: '#2e7d32', color: 'white', p: 1.5, display: { xs: 'none', sm: 'flex' }, alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                  <PaymentIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />
                  Payments
                </Typography>
                {!readOnly && hasBalanceDue && !editingPayment && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setShowPaymentForm(!showPaymentForm)}
                    startIcon={showPaymentForm ? <CloseIcon /> : <AddIcon />}
                    sx={{ color: 'white', borderColor: 'white', fontSize: '0.75rem', py: 0.25, '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' } }}
                  >
                    {showPaymentForm ? 'Cancel' : 'Record Payment'}
                  </Button>
                )}
              </Box>

              {/* Existing Payments List */}
              {completedPayments.length > 0 && (
                <Box sx={{ p: 0 }}>
                  {completedPayments.map((p, idx) => (
                    <Box key={p.id || idx} sx={{ p: 1.5, borderBottom: '1px solid #eee' }}>
                      {editingPayment?.id === p.id ? (
                        // Edit form inline
                        (<Box>
                          <Grid container spacing={1} sx={{ mb: 1 }}>
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label="Amount"
                                type="number"
                                size="small"
                                fullWidth
                                value={editAmount || ''}
                                onChange={(e) => setEditAmount(toMoneyNumber(e.target.value))}
                                slotProps={{
                                  input: {
                                    startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                                  }
                                }}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <FormControl fullWidth size="small">
                                <InputLabel>Method</InputLabel>
                                <Select
                                  value={editMethod}
                                  label="Method"
                                  onChange={(e) => setEditMethod(e.target.value)}
                                >
                                  {hotelSettings.payment_methods.map((method) => (
                                    <MenuItem key={method} value={method}>{method}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label="Payment Date"
                                type="date"
                                size="small"
                                fullWidth
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                slotProps={{
                                  inputLabel: { shrink: true }
                                }}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label="Reference"
                                size="small"
                                fullWidth
                                value={editReference}
                                onChange={(e) => setEditReference(e.target.value)}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label="Notes"
                                size="small"
                                fullWidth
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                              />
                            </Grid>
                          </Grid>
                          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button
                              size="small"
                              onClick={handleCancelEdit}
                              disabled={updatingPayment}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={handleUpdatePayment}
                              disabled={updatingPayment || !isPositiveMoney(editAmount)}
                            >
                              {updatingPayment ? 'Saving...' : 'Save'}
                            </Button>
                          </Box>
                        </Box>)
                      ) : (
                        // Normal display
                        (<Grid container sx={{
                        alignItems: "center"
                      }}>
                          <Grid size={4}>
                            <Typography variant="body2">
                              {formatStatusLabel(p.payment_method, '')}
                            </Typography>
                            <Typography variant="caption" sx={{
                              color: "text.secondary"
                            }}>
                              {formatPaymentDateTime(p)}
                            </Typography>
                          </Grid>
                          <Grid size={3}>
                            <Typography variant="caption" sx={{
                              color: "text.secondary"
                            }}>
                              {p.transaction_reference || p.notes || ''}
                            </Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={3}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#2e7d32' }}>
                              {formatCurrency(toMoneyNumber(p.total_amount))}
                            </Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={2}>
                            {!readOnly && (<Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                              <Button
                                size="small"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleStartEdit(p)}
                                disabled={deletingPaymentId === p.id || (!!editingPayment && editingPayment.id !== p.id)}
                              >
                                <EditIcon fontSize="small" />
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleDeletePayment(p.id)}
                                disabled={deletingPaymentId === p.id || (!!editingPayment && editingPayment.id !== p.id)}
                              >
                                {deletingPaymentId === p.id ? (
                                  <CircularProgress size={16} />
                                ) : (
                                  <DeleteIcon fontSize="small" />
                                )}
                              </Button>
                            </Box>)}
                          </Grid>
                        </Grid>)
                      )}
                    </Box>
                  ))}
                </Box>
              )}

              {/* Deposit-type rows are held collateral / forfeited income, not
                  bill settlement — grouped separately with a method-only Edit
                  (a wrong tender is the only honest correction now that
                  in-house deposit voids are guarded) and still no Delete:
                  they resolve via refund or forfeit, never by voiding the
                  row here. */}
              {depositPayments.length > 0 && (
                <Box sx={{ p: 0 }}>
                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: '#eceff1', borderBottom: '1px solid #eee' }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Deposits — collateral, not bill payments
                    </Typography>
                  </Box>
                  {depositPayments.map((p, idx) => {
                    const forfeited = (p.payment_type || '').toLowerCase() === 'deposit_forfeited';
                    return (
                      <Box key={p.id || idx} sx={{ p: 1.5, borderBottom: '1px solid #eee', bgcolor: '#fafafa' }}>
                        {editingPayment?.id === p.id ? (
                          // Method-only edit form — amount/date/reference are
                          // immutable on a posted deposit row (the backend
                          // rejects them), so the row swaps to just the tender
                          // Select plus Save/Cancel.
                          (<Box>
                            <Grid container spacing={1} sx={{ mb: 1 }}>
                              <Grid size={4}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Method</InputLabel>
                                  <Select
                                    value={editMethod}
                                    label="Method"
                                    onChange={(e) => setEditMethod(e.target.value)}
                                  >
                                    {hotelSettings.payment_methods.map((method) => (
                                      <MenuItem key={method} value={method}>{method}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>
                            </Grid>
                            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                              <Button
                                size="small"
                                onClick={handleCancelEdit}
                                disabled={updatingPayment}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="small"
                                variant="contained"
                                onClick={handleUpdatePayment}
                                disabled={updatingPayment}
                              >
                                {updatingPayment ? 'Saving...' : 'Save'}
                              </Button>
                            </Box>
                          </Box>)
                        ) : (
                          <Grid container sx={{
                            alignItems: "center"
                          }}>
                            <Grid size={4}>
                              <Typography variant="body2">
                                {formatStatusLabel(p.payment_method, '')}
                              </Typography>
                              <Typography variant="caption" sx={{
                                color: "text.secondary"
                              }}>
                                {formatPaymentDateTime(p)}
                              </Typography>
                            </Grid>
                            <Grid size={5}>
                              <Chip
                                label={forfeited ? 'Deposit forfeited' : 'Deposit held'}
                                size="small"
                                color={forfeited ? 'warning' : 'info'}
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                              {(p.transaction_reference || p.notes) && (
                                <Typography variant="caption" sx={{
                                  color: "text.secondary",
                                  display: 'block'
                                }}>
                                  {p.transaction_reference || p.notes}
                                </Typography>
                              )}
                            </Grid>
                            <Grid sx={{ textAlign: 'right' }} size={2}>
                              <Typography variant="body2" sx={{ fontWeight: 600, color: '#e65100' }}>
                                {formatCurrency(toMoneyNumber(p.total_amount))}
                              </Typography>
                            </Grid>
                            <Grid sx={{ textAlign: 'right' }} size={1}>
                              {!readOnly && (<Button
                                size="small"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleStartEdit(p)}
                                disabled={deletingPaymentId === p.id || (!!editingPayment && editingPayment.id !== p.id)}
                                aria-label="Edit deposit payment method"
                              >
                                <EditIcon fontSize="small" />
                              </Button>)}
                            </Grid>
                          </Grid>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              )}

              {/* Refund records */}
              {refundedPayments.length > 0 && (
                <Box sx={{ p: 0 }}>
                  {refundedPayments.map((p, idx) => (
                    <Box key={p.id || idx} sx={{ p: 1.5, borderBottom: '1px solid #eee', bgcolor: '#f1f8e9' }}>
                      {editingPayment?.id === p.id ? (
                        <Box>
                          <Grid container spacing={1} sx={{ mb: 1 }}>
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label="Amount"
                                type="number"
                                size="small"
                                fullWidth
                                value={editAmount || ''}
                                onChange={(e) => setEditAmount(toMoneyNumber(e.target.value))}
                                slotProps={{
                                  input: {
                                    startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                                  }
                                }}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <FormControl fullWidth size="small">
                                <InputLabel>Method</InputLabel>
                                <Select
                                  value={editMethod}
                                  label="Method"
                                  onChange={(e) => setEditMethod(e.target.value)}
                                >
                                  {hotelSettings.payment_methods.map((method) => (
                                    <MenuItem key={method} value={method}>{method}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label="Refund Date"
                                type="date"
                                size="small"
                                fullWidth
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                slotProps={{
                                  inputLabel: { shrink: true }
                                }}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label="Reference"
                                size="small"
                                fullWidth
                                value={editReference}
                                onChange={(e) => setEditReference(e.target.value)}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label="Notes"
                                size="small"
                                fullWidth
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                              />
                            </Grid>
                          </Grid>
                          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                            <Button
                              size="small"
                              onClick={handleCancelEdit}
                              disabled={updatingPayment}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={handleUpdatePayment}
                              disabled={updatingPayment || !isPositiveMoney(editAmount)}
                            >
                              {updatingPayment ? 'Saving...' : 'Save'}
                            </Button>
                          </Box>
                        </Box>
                      ) : (
                        <Grid container sx={{
                          alignItems: "center"
                        }}>
                          <Grid size={5}>
                            <Typography variant="body2" sx={{ color: '#2e7d32' }}>
                              Deposit Refund ({formatStatusLabel(p.payment_method, '')})
                            </Typography>
                            <Typography variant="caption" sx={{
                              color: "text.secondary"
                            }}>
                              {formatPaymentDateTime(p)}
                            </Typography>
                          </Grid>
                          <Grid size={2}>
                            <Chip label="Refunded" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={3}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#2e7d32' }}>
                              -{formatCurrency(toMoneyNumber(p.total_amount))}
                            </Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={2}>
                            {!readOnly && (<Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                              <Button
                                size="small"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleStartEdit(p)}
                                disabled={deletingPaymentId === p.id || (!!editingPayment && editingPayment.id !== p.id)}
                              >
                                <EditIcon fontSize="small" />
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleDeletePayment(p.id)}
                                disabled={deletingPaymentId === p.id || (!!editingPayment && editingPayment.id !== p.id)}
                              >
                                {deletingPaymentId === p.id ? (
                                  <CircularProgress size={16} />
                                ) : (
                                  <DeleteIcon fontSize="small" />
                                )}
                              </Button>
                            </Box>)}
                          </Grid>
                        </Grid>
                      )}
                    </Box>
                  ))}
                </Box>
              )}

              {/* `payments` retains void rows (restorable deposits count them),
                  so the empty state keys off the displayed groups instead. */}
              {completedPayments.length + refundedPayments.length === 0 && (
                <Box sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>No payments recorded yet</Typography>
                </Box>
              )}

              {/* Record Payment Form — locked once fully paid (no outstanding
                  balance) and while a payment row is being edited. */}
              <Collapse in={showPaymentForm && hasBalanceDue && !editingPayment}>
                <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderTop: '1px solid #ddd' }}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        label="Amount"
                        type="number"
                        size="small"
                        fullWidth
                        value={paymentAmount || ''}
                        onChange={(e) => setPaymentAmount(toMoneyNumber(e.target.value))}
                        slotProps={{
                          input: {
                            startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                          }
                        }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Method</InputLabel>
                        <Select
                          value={paymentMethod}
                          label="Method"
                          onChange={(e) => setPaymentMethod(e.target.value)}
                        >
                          {hotelSettings.payment_methods.map((method) => (
                            <MenuItem key={method} value={method}>{method}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        label="Payment Date"
                        type="date"
                        size="small"
                        fullWidth
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        slotProps={{
                          inputLabel: { shrink: true }
                        }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="Reference (Optional)"
                        size="small"
                        fullWidth
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="Notes (Optional)"
                        size="small"
                        fullWidth
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                      />
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={12}>
                      <Button
                        variant="contained"
                        size="small"
                        onClick={handleRecordPayment}
                        disabled={recordingPayment || !isPositiveMoney(paymentAmount) || isGreaterMoney(paymentAmount, balanceDue)}
                        startIcon={recordingPayment ? <CircularProgress size={14} /> : <PaymentIcon />}
                      >
                        {recordingPayment ? 'Recording...' : 'Record Payment'}
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </Collapse>

              {/* Bill balance — explicit state wording; a held deposit owed
                  back to the guest is not "overpayment". */}
              <Box sx={{ p: 1.5, bgcolor: hasBalanceDue ? '#fff3e0' : '#e8f5e9', borderTop: '2px solid #ddd' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: hasBalanceDue ? '#e65100' : '#2e7d32' }}>
                  Bill balance: {formatCurrency(Math.abs(balanceDue))} — {billBalanceLabel}
                </Typography>
              </Box>
            </Box>
            </PhoneCollapsibleSection>
            {/* Checkout readiness — the single strip that replaced the old
                scattered deposit/payment alerts. */}
            {readinessStrip}
          </Box>)
        ) : (
          // STEP 3: Confirmation Summary (After Review)
          (<Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            {/* Company Billing Indicator */}
            {booking.company_id && booking.company_name && (
              <Alert
                severity="warning"
                icon={<BusinessIcon />}
              >
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>
                  Company Billing: {booking.company_name}
                </Typography>
                <Typography variant="caption">
                  Room charges will be automatically posted to the company ledger.
                </Typography>
              </Alert>
            )}
            {/* Guest Information */}
            <Paper elevation={0} sx={{ p: 2, bgcolor: 'var(--hotel-surface-sunken)', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Guest Information
              </Typography>
              <Grid container spacing={1}>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Guest Name:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {booking.guest_name}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Room:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {booking.room_number} - {booking.room_type}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Check-in:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {new Date(booking.check_in_date).toLocaleString()}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Check-out:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
                    {getActualCheckoutDate().toLocaleString()}
                    {isEarlyCheckout() && (
                      <Chip label="Early" size="small" color="info" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                    )}
                    {isLateCheckout() && (
                      <Chip label="Late" size="small" color="warning" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                    )}
                  </Typography>
                </Grid>
                {getCheckoutVariance() && (
                  <>
                    <Grid size={6}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        Scheduled:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                        {new Date(booking.check_out_date).toLocaleDateString()}
                      </Typography>
                    </Grid>
                  </>
                )}
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Duration:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {calculateNights()} night(s)
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
            {/* Charges Breakdown */}
            <Paper elevation={0} sx={{ p: 2, bgcolor: 'primary.50', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Charges Breakdown
              </Typography>
              <Grid container spacing={1}>
                {/* Room Charges */}
                <Grid size={8}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Room Charges ({calculateNights()} nights)
                  </Typography>
                </Grid>
                <Grid sx={{ textAlign: 'right' }} size={4}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {formatCurrency(charges.roomCharges)}
                  </Typography>
                </Grid>

                {/* Service Tax */}
                {isPositiveMoney(charges.serviceTax) && (
                  <>
                    <Grid size={8}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        Service Tax ({hotelSettings.service_tax_rate}%)
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={4}>
                      <Typography variant="body2">
                        {formatCurrency(charges.serviceTax)}
                      </Typography>
                    </Grid>
                  </>
                )}

                {/* Tourism Tax — billed per night */}
                {isPositiveMoney(charges.tourismTax) && (() => {
                  const nights = calculateNights();
                  if (isHourlyBooking || nights <= 0) {
                    return (
                      <React.Fragment key="tt-single">
                        <Grid size={8}>
                          <Typography variant="body2" sx={{
                            color: "text.secondary"
                          }}>
                            Tourism Tax
                          </Typography>
                        </Grid>
                        <Grid sx={{ textAlign: 'right' }} size={4}>
                          <Typography variant="body2">
                            {formatCurrency(charges.tourismTax)}
                          </Typography>
                        </Grid>
                      </React.Fragment>
                    );
                  }
                    const perNight = divideMoney(charges.tourismTax, nights);
                  const checkIn = new Date(booking.check_in_date);
                  return Array.from({ length: nights }, (_, i) => {
                    const date = new Date(checkIn);
                    date.setDate(date.getDate() + i);
                    return (
                      <React.Fragment key={`tt-${i}`}>
                        <Grid size={8}>
                          <Typography variant="body2" sx={{
                            color: "text.secondary"
                          }}>
                            Tourism Tax — {date.toLocaleDateString()}
                          </Typography>
                        </Grid>
                        <Grid sx={{ textAlign: 'right' }} size={4}>
                          <Typography variant="body2">
                            {formatCurrency(perNight)}
                          </Typography>
                        </Grid>
                      </React.Fragment>
                    );
                  });
                })()}

                {/* Extra Bed */}
                {isPositiveMoney(charges.extraBedCharge) && (
                  <>
                    <Grid size={8}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        Extra Bed Charge
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={4}>
                      <Typography variant="body2">
                        {formatCurrency(charges.extraBedCharge)}
                      </Typography>
                    </Grid>
                    {isPositiveMoney(charges.extraBedServiceTax) && (
                      <>
                        <Grid size={8}>
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.secondary",
                              pl: 2
                            }}>
                            Service Tax ({hotelSettings.service_tax_rate}%)
                          </Typography>
                        </Grid>
                        <Grid sx={{ textAlign: 'right' }} size={4}>
                          <Typography variant="body2">
                            {formatCurrency(charges.extraBedServiceTax)}
                          </Typography>
                        </Grid>
                      </>
                    )}
                  </>
                )}



                <Grid size={12}>
                  <Divider sx={{ my: 1 }} />
                </Grid>

                {/* Subtotal */}
                <Grid size={8}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Subtotal
                  </Typography>
                </Grid>
                <Grid sx={{ textAlign: 'right' }} size={4}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {formatCurrency(charges.subtotal)}
                  </Typography>
                </Grid>

                {/* Deposit status — the same resolution wording the preview
                    step's readiness strip uses. */}
                {depositResolution.status !== 'none' && (
                  <>
                    <Grid size={8}>
                      <Typography variant="body2">
                        Security deposit
                      </Typography>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        {depositResolution.status === 'waived' && depositWaiveReason
                          ? depositWaiveReason
                          : `Deposit ${depositResolutionWording}`}
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={4}>
                      <StatusChip
                        status={depositResolution.status}
                        label={DEPOSIT_STATUS_CHIP[depositResolution.status].label}
                        tone={DEPOSIT_STATUS_CHIP[depositResolution.status].tone}
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    </Grid>
                  </>
                )}

                <Grid size={12}>
                  <Divider sx={{ my: 1 }} />
                </Grid>

                {/* Grand Total */}
                <Grid size={8}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {charges.grandTotal >= 0 ? 'Total to Collect' : 'Total to Refund'}
                  </Typography>
                </Grid>
                <Grid sx={{ textAlign: 'right' }} size={4}>
                  <Typography
                    variant="h5"
                    color={charges.grandTotal >= 0 ? 'primary' : 'success'}
                    sx={{ fontWeight: 700 }}
                  >
                    {formatCurrency(Math.abs(charges.grandTotal))}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
            {/* Readiness — the same strip the preview step shows, in place
                of the old duplicate deposit wording. */}
            {readinessStrip}
          </Box>)
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {readOnly ? (
          <>
            <Button onClick={onClose}>
              Close
            </Button>
            <Button
              variant="outlined"
              onClick={handlePrint}
              startIcon={<PrintIcon />}
            >
              Print Invoice
            </Button>
          </>
        ) : checkoutStep === 'preview' ? (
          <>
            <Button onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="outlined"
              onClick={handlePrint}
              startIcon={<PrintIcon />}
              disabled={blockers.length > 0}
            >
              Print Preview
            </Button>
            <Button
              variant="contained"
              onClick={handleProceedToConfirm}
              startIcon={<CheckIcon />}
              disabled={blockers.length > 0}
            >
              Proceed to Checkout
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleBackToPreview}>
              Back to Invoice
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleConfirmCheckout}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : <CheckIcon />}
            >
              {loading ? 'Processing...' : 'Confirm Checkout'}
            </Button>
          </>
        )}
      </DialogActions>
      <CheckoutInvoicePrintView
        booking={booking}
        hotelSettings={hotelSettings}
        guestCompanyName={guestCompanyName}
        guestAddress={guestAddress}
        guestPhone={guestPhone}
        guestIcNumber={guestIcNumber}
        payments={payments}
        charges={charges}
        editableDailyRates={editableDailyRates}
        depositRefunded={depositRefunded}
        depositWaived={depositWaived || depositResolution.status === 'waived'}
        depositWaiveReason={depositWaiveReason}
        depositForfeited={
          depositResolution.status === 'forfeited'
          || depositResolution.status === 'partially_forfeited'
        }
        balanceDue={balanceDue}
        isHourlyBooking={isHourlyBooking}
        calculateNights={calculateNights}
        getActualCheckoutDate={getActualCheckoutDate}
        isEarlyCheckout={isEarlyCheckout}
        isLateCheckout={isLateCheckout}
        formatBookingStatus={formatBookingStatus}
        formatCurrency={formatCurrency}
      />
    </Dialog>
  );
};

export default CheckoutInvoiceModal;
