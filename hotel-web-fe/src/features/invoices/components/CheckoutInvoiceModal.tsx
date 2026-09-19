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
import { formatHotelDate, formatHotelDateTime, formatLocalDate, parseLocalDate, addLocalDays, toHotelDateString } from '../../../utils/date';
import { divideMoney, isGreaterMoney, isPositiveMoney, subtractMoney, toMoneyNumber } from '../../../utils/money';
import { formatStatusLabel } from '../../../utils/formatters';
import { getIdempotencyAttempt, type IdempotencyAttempt } from '../../../utils/idempotency';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useTranslation, statusLabel } from '../../../i18n';
import CollapsibleSection, { type CollapsibleSectionProps } from '../../../components/common/CollapsibleSection';
import PaperIsland from '../../../components/common/PaperIsland';
import { paperTokens } from '../../../theme';
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
  const { t, tOr } = useTranslation('finance');
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
    completedDepositCount,
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

  // Resolution permission gates — `cancel` mirrors the hook's auto-route on
  // the same completed-row count: rows → per-row void (`payments:delete`);
  // no rows → the booking-mirror waive (`bookings:update`).
  const canRefundOrForfeitDeposit = hasPermission('payments:refund');
  const canCancelDeposit = completedDepositCount > 0
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
      setError(err instanceof Error && err.message ? err.message : t('checkout.errors.recordPayment'));
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
      setError(err instanceof Error && err.message ? err.message : t('checkout.errors.updatePayment'));
    } finally {
      setUpdatingPayment(false);
    }
  };

  const handleDeletePayment = async (paymentId: number) => {
    const accepted = await confirm({
      title: t('checkout.confirm.deletePayment.title'),
      message: t('checkout.confirm.deletePayment.message'),
      confirmText: t('checkout.confirm.deletePayment.confirmText'),
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
      setError(err instanceof Error && err.message ? err.message : t('checkout.errors.deletePayment'));
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
    const hadCompletedDepositRows = completedDepositCount > 0;
    const accepted = await confirm({
      title: t('checkout.confirm.cancelDeposit.title'),
      message: hadCompletedDepositRows
        ? t('checkout.confirm.cancelDeposit.messageCollected')
        : t('checkout.confirm.cancelDeposit.messageUncollected'),
      confirmText: t('checkout.confirm.cancelDeposit.confirmText'),
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
      title: t('checkout.confirm.revertRefund.title'),
      message: t('checkout.confirm.revertRefund.message'),
      confirmText: t('checkout.confirm.revertRefund.confirmText'),
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
        setError(t('checkout.errors.settleFirst'));
        return;
      }

      await onConfirmCheckout?.(undefined, paymentMethod);
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('checkout.errors.processCheckout'));
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
      setError(err instanceof Error && err.message ? err.message : t('checkout.errors.saveDailyRates'));
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
              color: ${paperTokens.text};
            }
            .invoice-header {
              text-align: center;
              margin-bottom: 30px;
              border-bottom: 2px solid ${paperTokens.accent};
              padding-bottom: 20px;
            }
            .invoice-header h1 {
              color: ${paperTokens.accentText};
              font-size: 28px;
              margin-bottom: 5px;
            }
            .invoice-header p {
              color: ${paperTokens.textSecondary};
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
              color: ${paperTokens.accentText};
              margin-bottom: 10px;
              text-transform: uppercase;
            }
            .invoice-meta p {
              font-size: 13px;
              margin: 5px 0;
              line-height: 1.6;
            }
            .invoice-meta .label {
              color: ${paperTokens.textSecondary};
              display: inline-block;
              min-width: 120px;
            }
            .invoice-meta .value {
              font-weight: 600;
              color: ${paperTokens.text};
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }
            th {
              background-color: ${paperTokens.accent};
              color: ${paperTokens.onAccent};
              padding: 12px;
              text-align: left;
              font-size: 13px;
              text-transform: uppercase;
            }
            td {
              padding: 12px;
              border-bottom: 1px solid ${paperTokens.border};
              font-size: 13px;
            }
            .amount {
              text-align: right;
              font-weight: 600;
            }
            .subtotal-row td {
              border-top: 2px solid ${paperTokens.border};
              font-weight: 600;
              padding-top: 15px;
            }
            .refund-row td {
              color: ${paperTokens.success};
            }
            .penalty-row td {
              color: ${paperTokens.danger};
            }
            .total-row {
              background-color: ${paperTokens.surfaceSunken};
            }
            .total-row td {
              border-top: 3px double ${paperTokens.accent};
              font-size: 16px;
              font-weight: 700;
              padding: 15px 12px;
              color: ${paperTokens.accentText};
            }
            .notes {
              margin-top: 30px;
              padding: 15px;
              background-color: ${paperTokens.warningBg};
              border-left: 4px solid ${paperTokens.warning};
              font-size: 12px;
              line-height: 1.6;
            }
            .notes strong {
              display: block;
              margin-bottom: 5px;
              color: ${paperTokens.warning};
            }
            .success-note {
              background-color: ${paperTokens.successBg};
              border-left-color: ${paperTokens.success};
            }
            .success-note strong {
              color: ${paperTokens.success};
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              padding-top: 20px;
              border-top: 1px solid ${paperTokens.border};
              font-size: 12px;
              color: ${paperTokens.textSecondary};
            }
            .footer strong {
              display: block;
              font-size: 14px;
              color: ${paperTokens.accentText};
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

  const formatBookingStatus = (status?: string) => statusLabel(t, 'booking', status);

  // Bill balance strip — explicit wording instead of the bare "Fully Paid"/
  // "Balance Due" labels: a held deposit is collateral owed to the guest,
  // so the bill's own state must read unambiguously next to it.
  const billBalanceLabel = !hasBalanceDue
    ? t('status:ledger.paid')
    : isPositiveMoney(paymentRowsTotal)
      ? t('status:ledger.partially_paid')
      : t('status:ledger.outstanding');

  // Checkout readiness — one strip states every unmet condition, replacing
  // the old scattered deposit alerts (and the confirm step's duplicate).
  // The same derived values drive the action buttons' disabled state; the
  // backend checkout gate stays authoritative.
  const depositHeld = isPositiveMoney(depositResolution.remaining)
    ? depositResolution.remaining
    : depositResolution.mirrorDue;
  const blockers: string[] = [];
  if (depositResolution.status === 'pending') {
    blockers.push(t('checkout.blocker.resolveDeposit', { amount: formatCurrency(depositHeld) }));
  }
  if (requiresFullPaymentBeforeCheckout) {
    blockers.push(t('checkout.blocker.settleBalance', { amount: formatCurrency(balanceDue) }));
  }
  // Resolved-state wording shared by the readiness strip and the confirm
  // step's deposit row. 'none' returns '' (no deposit line at all).
  const depositResolutionWording = (() => {
    switch (depositResolution.status) {
      case 'refunded':
        return depositResolution.refundMethod
          ? t('deposit.wording.refundedVia', { amount: formatCurrency(depositResolution.refunded), method: depositResolution.refundMethod })
          : t('deposit.wording.refunded', { amount: formatCurrency(depositResolution.refunded) });
      case 'forfeited':
        return t('deposit.wording.forfeited', { amount: formatCurrency(depositResolution.forfeited) });
      case 'partially_forfeited':
        return isPositiveMoney(depositResolution.refunded)
          ? t('deposit.wording.partiallyForfeitedRefund', { forfeited: formatCurrency(depositResolution.forfeited), refunded: formatCurrency(depositResolution.refunded) })
          : t('deposit.wording.partiallyForfeited', { amount: formatCurrency(depositResolution.forfeited) });
      case 'cancelled':
      case 'waived':
        return t('deposit.wording.cancelled');
      case 'pending':
        return t('deposit.wording.pending', { amount: formatCurrency(depositHeld) });
      default:
        return '';
    }
  })();
  // A positive balance is only compatible with readiness under company
  // billing, where the bill posts to the company ledger instead.
  const billWording = hasBalanceDue ? t('checkout.billToLedger') : t('checkout.billPaid');
  const readinessMessage = blockers.length
    ? t('checkout.notReady', { reasons: blockers.join(' · ') })
    : t('checkout.ready', {
        summary: billWording + (depositResolutionWording ? ` · ${t('deposit.summary', { status: depositResolutionWording })}` : ''),
      });
  // Suppressed in readOnly — a read-only receipt isn't a checkout, so it
  // shouldn't carry "Checkout is not ready"/"Ready for checkout" framing.
  const readinessStrip = readOnly ? null : (
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
                ? t('checkout.titleInvoice')
                : checkoutStep === 'preview'
                  ? t('checkout.titlePreview')
                  : t('checkout.titleConfirm')}
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
          // PaperIsland re-themes everything inside to the warm-paper palette.
          (<PaperIsland sx={{ fontFamily: 'Arial, sans-serif', color: 'var(--hotel-text)', bgcolor: 'var(--hotel-surface)', p: 3, borderRadius: 1 }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
                {error}
              </Alert>
            )}
            {!readOnly && (
              <Alert severity="info" sx={{ mb: 3 }}>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{t('checkout.reviewTitle')}</Typography>
                <Typography variant="caption">{t('checkout.reviewSubtitle')}</Typography>
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
                  {t('checkout.companyBilling', { name: booking.company_name })}
                </Typography>
                <Typography variant="caption">
                  {t('checkout.companyBillingNoteCheckout')}
                </Typography>
              </Alert>
            )}
            {/* Invoice Header */}
            <Box sx={{ textAlign: 'center', mb: 4, borderBottom: '2px solid var(--hotel-primary)', pb: 2 }}>
              <Typography variant="h4" sx={{ color: 'var(--hotel-primary-text)', fontWeight: 700, mb: 0.5 }}>
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
                {t('checkout.phoneEmail', { phone: hotelSettings.hotel_phone, email: hotelSettings.hotel_email })}
              </Typography>
            </Box>
            {/* Invoice Meta */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" sx={{ color: 'var(--hotel-primary-text)', mb: 1, textTransform: 'uppercase' }}>{t('checkout.invoiceDetails')}</Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: 'var(--hotel-text-secondary)', display: 'inline-block', minWidth: '120px' }}>{t('checkout.field.invoiceNumber')}:</Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {booking?.invoice_number || booking?.folio_number || `#${booking?.id}`}
                  </Box>
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: 'var(--hotel-text-secondary)', display: 'inline-block', minWidth: '120px' }}>
                    {t('common:field.date')}:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {formatHotelDate(new Date())}
                  </Box>
                </Typography>
                <Typography variant="body2">
                  <Box component="span" sx={{ color: 'var(--hotel-text-secondary)', display: 'inline-block', minWidth: '120px' }}>
                    {t('common:field.status')}:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {formatBookingStatus(booking.status)}
                  </Box>
                </Typography>
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" sx={{ color: 'var(--hotel-primary-text)', mb: 1.5, textTransform: 'uppercase' }}>
                  {t('checkout.guestInfo')}
                </Typography>
                {([
                  { label: t('common:field.name'), value: booking?.guest_name },
                  { label: t('ledger.field.room'), value: `${booking?.room_number} - ${booking?.room_type}` },
                  guestCompanyName ? { label: t('ledger.field.company'), value: guestCompanyName } : null,
                  guestPhone ? { label: t('common:field.phone'), value: guestPhone } : null,
                  guestIcNumber ? { label: t('checkout.field.idIc'), value: guestIcNumber } : null,
                  guestAddress ? { label: t('common:field.address'), value: guestAddress } : null,
                ] as Array<{ label: string; value: React.ReactNode } | null>)
                  .filter((item): item is { label: string; value: React.ReactNode } => item !== null)
                  .map((item) => (
                  <Box key={item.label} sx={{ display: 'flex', gap: 1, mb: 0.75 }}>
                    <Typography variant="body2" sx={{ color: 'var(--hotel-text-secondary)', minWidth: '72px', flexShrink: 0 }}>
                      {item.label}:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                      {item.value}
                    </Typography>
                  </Box>
                ))}
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" sx={{ color: 'var(--hotel-primary-text)', mb: 1, textTransform: 'uppercase' }}>{t('checkout.stayDetails')}</Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: 'var(--hotel-text-secondary)', display: 'inline-block', minWidth: '80px' }}>
                    {t('checkout.checkIn')}:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {formatHotelDate(booking?.check_in_date)}
                  </Box>
                </Typography>
                <Typography variant="body2" component="div" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: 'var(--hotel-text-secondary)', display: 'inline-block', minWidth: '80px' }}>
                    {t('checkout.checkOut')}:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {formatHotelDate(getActualCheckoutDate())}
                    {isEarlyCheckout() && (
                      <Chip label={t('checkout.early')} size="small" color="info" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                    )}
                    {isLateCheckout() && (
                      <Chip label={t('checkout.late')} size="small" color="warning" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                    )}
                  </Box>
                </Typography>
                {getCheckoutVariance() && (
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    <Box component="span" sx={{ color: 'var(--hotel-text-secondary)', display: 'inline-block', minWidth: '80px' }}>
                      {t('checkout.scheduled')}:
                    </Box>
                    <Box component="span" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                      {formatHotelDate(booking?.check_out_date)}
                    </Box>
                  </Typography>
                )}
                <Typography variant="body2">
                  <Box component="span" sx={{ color: 'var(--hotel-text-secondary)', display: 'inline-block', minWidth: '80px' }}>
                    {t('checkout.duration')}:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {isHourlyBooking ? t('checkout.hourlyStay') : t('checkout.nights', { count: calculateNights() })}
                  </Box>
                </Typography>
              </Grid>
            </Grid>
            {/* Charges Table */}
            <PhoneCollapsibleSection isPhone={isPhone} title={t('checkout.sections.charges')}>
            <Box sx={{ border: '1px solid var(--hotel-border)', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
              <Box sx={{ bgcolor: 'var(--hotel-primary)', color: 'var(--hotel-on-primary)', p: 1.5 }}>
                <Grid container>
                  <Grid size={8}>
                    <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                      {t('common:field.description')}
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>{t('common:field.amount')}</Typography>
                  </Grid>
                </Grid>
              </Box>

              <Box sx={{ p: 0 }}>
                {/* Room Charges - Day by Day */}
                {isHourlyBooking ? (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid var(--hotel-border)' }}>
                    <Grid container>
                      <Grid size={8}>
                        <Typography variant="body2">{t('checkout.roomChargesHourly')}</Typography>
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
                      <Box sx={{ p: 1, px: 1.5, display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid var(--hotel-border-subtle)' }}>
                        {editingRates ? (
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            startIcon={<CheckIcon />}
                            onClick={handleSaveDailyRates}
                            disabled={savingRates}
                          >
                            {savingRates ? t('common:state.saving') : t('checkout.saveRates')}
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<EditIcon />}
                            onClick={() => setEditingRates(true)}
                          >{t('checkout.editRates')}</Button>
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
                        const dateStr = formatHotelDate(date);
                        const dateKey = formatLocalDate(date);
                        const taxInclusiveRate = editableDailyRates[dateKey] || 0;
                        const dayRate = divideMoney(taxInclusiveRate, taxMultiplier);
                        const dayTax = subtractMoney(taxInclusiveRate, dayRate);
                        return (
                          <React.Fragment key={i}>
                            <Box sx={{ p: 1.5, borderBottom: isPositiveMoney(dayTax) ? 'none' : '1px solid var(--hotel-border)' }}>
                              <Grid container sx={{
                                alignItems: "center"
                              }}>
                                <Grid size={editingRates ? { xs: 12, sm: 5 } : 8}>
                                  <Typography variant="body2">
                                    {t('checkout.roomChargeDay', { date: dateStr })}
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
                              <Box sx={{ p: 1.5, pl: 3, borderBottom: '1px solid var(--hotel-border)', bgcolor: 'var(--hotel-surface-sunken)' }}>
                                <Grid container>
                                  <Grid size={8}>
                                    <Typography variant="body2" sx={{
                                      color: "text.secondary"
                                    }}>
                                      {t('checkout.serviceTaxPct', { rate: hotelSettings.service_tax_rate })}
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
                      <Box sx={{ p: 1.5, borderBottom: '1px solid var(--hotel-border)' }}>
                        <Grid container>
                          <Grid size={8}>
                            <Typography variant="body2">{t('checkout.tourismTax')}</Typography>
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
                      <Box key={`tt-${i}`} sx={{ p: 1.5, borderBottom: '1px solid var(--hotel-border)' }}>
                        <Grid container>
                          <Grid size={8}>
                            <Typography variant="body2">
                              {t('checkout.tourismTaxDay', { date: formatHotelDate(date) })}
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
                  <Box sx={{ p: 1.5, borderBottom: '1px solid var(--hotel-border)' }}>
                    <Grid container>
                      <Grid size={8}>
                        <Typography variant="body2">{t('checkout.extraBedCharge')}</Typography>
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
                              {t('checkout.serviceTaxPct', { rate: hotelSettings.service_tax_rate })}
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
                <Box sx={{ p: 2, bgcolor: 'var(--hotel-surface-sunken)', borderTop: '3px double var(--hotel-primary)' }}>
                  <Grid container>
                    <Grid size={8}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {displayTotal >= 0 ? t('ledger.invoice.totalDue') : t('checkout.totalRefund')}
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={4}>
                      <Typography variant="h5" sx={{ fontWeight: 700, color: 'var(--hotel-primary-text)' }}>
                        {formatCurrency(Math.abs(displayTotal))}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Box>
            </Box>
            </PhoneCollapsibleSection>
            {/* Deposit status card — guided refund/forfeit/cancel workflow. */}
            <PhoneCollapsibleSection isPhone={isPhone} title={t('checkout.sections.depositAdjustments')} collapseOnPhone>
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
                noDepositLabel={booking?.company_id ? t('deposit.cityLedgerNa') : undefined}
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
              title={t('checkout.sections.payments')}
              actions={hasBalanceDue && !editingPayment ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setShowPaymentForm(!showPaymentForm)}
                  startIcon={showPaymentForm ? <CloseIcon /> : <AddIcon />}
                >
                  {showPaymentForm ? t('common:actions.cancel') : t('ledger.payment.record')}
                </Button>
              ) : undefined}
            >
            <Box sx={{ border: '1px solid var(--hotel-border)', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
              {/* Green banner is the desktop section header; on phone the
                  CollapsibleSection header (with the same Record Payment
                  button in `actions`) replaces it. */}
              <Box sx={{ bgcolor: 'var(--hotel-success)', color: 'var(--hotel-on-primary)', p: 1.5, display: { xs: 'none', sm: 'flex' }, alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                  <PaymentIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />{t('checkout.sections.payments')}</Typography>
                {!readOnly && hasBalanceDue && !editingPayment && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setShowPaymentForm(!showPaymentForm)}
                    startIcon={showPaymentForm ? <CloseIcon /> : <AddIcon />}
                    sx={{ color: 'var(--hotel-on-primary)', borderColor: 'var(--hotel-on-primary)', fontSize: '0.75rem', py: 0.25, '&:hover': { borderColor: 'var(--hotel-on-primary)', bgcolor: 'color-mix(in srgb, var(--hotel-on-primary) 12%, transparent)' } }}
                  >
                    {showPaymentForm ? t('common:actions.cancel') : t('ledger.payment.record')}
                  </Button>
                )}
              </Box>

              {/* Existing Payments List */}
              {completedPayments.length > 0 && (
                <Box sx={{ p: 0 }}>
                  {completedPayments.map((p, idx) => (
                    <Box key={p.id || idx} sx={{ p: 1.5, borderBottom: '1px solid var(--hotel-border-subtle)' }}>
                      {editingPayment?.id === p.id ? (
                        // Edit form inline
                        (<Box>
                          <Grid container spacing={1} sx={{ mb: 1 }}>
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label={t('common:field.amount')}
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
                                <InputLabel>{t('checkout.field.method')}</InputLabel>
                                <Select
                                  value={editMethod}
                                  label={t('checkout.field.method')}
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
                                label={t('ledger.payment.date')}
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
                                label={t('checkout.field.reference')}
                                size="small"
                                fullWidth
                                value={editReference}
                                onChange={(e) => setEditReference(e.target.value)}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label={t('common:field.notes')}
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
                            >{t('common:actions.cancel')}</Button>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={handleUpdatePayment}
                              disabled={updatingPayment || !isPositiveMoney(editAmount)}
                            >
                              {updatingPayment ? t('common:state.saving') : t('common:actions.save')}
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
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--hotel-success)' }}>
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
                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'var(--hotel-surface-sunken)', borderBottom: '1px solid var(--hotel-border-subtle)' }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('deposit.collateralNote')}</Typography>
                  </Box>
                  {depositPayments.map((p, idx) => {
                    const forfeited = (p.payment_type || '').toLowerCase() === 'deposit_forfeited';
                    return (
                      <Box key={p.id || idx} sx={{ p: 1.5, borderBottom: '1px solid var(--hotel-border-subtle)', bgcolor: 'var(--hotel-surface-sunken)' }}>
                        {editingPayment?.id === p.id ? (
                          // Method-only edit form — amount/date/reference are
                          // immutable on a posted deposit row (the backend
                          // rejects them), so the row swaps to just the tender
                          // Select plus Save/Cancel.
                          (<Box>
                            <Grid container spacing={1} sx={{ mb: 1 }}>
                              <Grid size={4}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>{t('checkout.field.method')}</InputLabel>
                                  <Select
                                    value={editMethod}
                                    label={t('checkout.field.method')}
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
                              >{t('common:actions.cancel')}</Button>
                              <Button
                                size="small"
                                variant="contained"
                                onClick={handleUpdatePayment}
                                disabled={updatingPayment}
                              >
                                {updatingPayment ? t('common:state.saving') : t('common:actions.save')}
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
                                label={forfeited ? t('deposit.chipForfeited') : t('deposit.chipHeld')}
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
                              <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--hotel-orange)' }}>
                                {formatCurrency(toMoneyNumber(p.total_amount))}
                              </Typography>
                            </Grid>
                            <Grid sx={{ textAlign: 'right' }} size={1}>
                              {!readOnly && (<Button
                                size="small"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleStartEdit(p)}
                                disabled={deletingPaymentId === p.id || (!!editingPayment && editingPayment.id !== p.id)}
                                aria-label={t('deposit.editMethod')}
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
                    <Box key={p.id || idx} sx={{ p: 1.5, borderBottom: '1px solid var(--hotel-border-subtle)', bgcolor: 'var(--hotel-success-bg)' }}>
                      {editingPayment?.id === p.id ? (
                        <Box>
                          <Grid container spacing={1} sx={{ mb: 1 }}>
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label={t('common:field.amount')}
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
                                <InputLabel>{t('checkout.field.method')}</InputLabel>
                                <Select
                                  value={editMethod}
                                  label={t('checkout.field.method')}
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
                                label={t('checkout.field.refundDate')}
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
                                label={t('checkout.field.reference')}
                                size="small"
                                fullWidth
                                value={editReference}
                                onChange={(e) => setEditReference(e.target.value)}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label={t('common:field.notes')}
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
                            >{t('common:actions.cancel')}</Button>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={handleUpdatePayment}
                              disabled={updatingPayment || !isPositiveMoney(editAmount)}
                            >
                              {updatingPayment ? t('common:state.saving') : t('common:actions.save')}
                            </Button>
                          </Box>
                        </Box>
                      ) : (
                        <Grid container sx={{
                          alignItems: "center"
                        }}>
                          <Grid size={5}>
                            <Typography variant="body2" sx={{ color: 'var(--hotel-success)' }}>
                              {t('deposit.refundLine', { method: formatStatusLabel(p.payment_method, '') })}
                            </Typography>
                            <Typography variant="caption" sx={{
                              color: "text.secondary"
                            }}>
                              {formatPaymentDateTime(p)}
                            </Typography>
                          </Grid>
                          <Grid size={2}>
                            <Chip label={t('deposit.chipRefunded')} size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={3}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--hotel-success)' }}>
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
                  }}>{t('checkout.paymentsEmpty')}</Typography>
                </Box>
              )}

              {/* Record Payment Form — locked once fully paid (no outstanding
                  balance) and while a payment row is being edited. */}
              <Collapse in={showPaymentForm && hasBalanceDue && !editingPayment}>
                <Box sx={{ p: 2, bgcolor: 'var(--hotel-surface-sunken)', borderTop: '1px solid var(--hotel-border)' }}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        label={t('common:field.amount')}
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
                        <InputLabel>{t('checkout.field.method')}</InputLabel>
                        <Select
                          value={paymentMethod}
                          label={t('checkout.field.method')}
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
                        label={t('ledger.payment.date')}
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
                        label={t('checkout.field.referenceOptional')}
                        size="small"
                        fullWidth
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label={t('checkout.field.notesOptional')}
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
                        {recordingPayment ? t('common:state.recording') : t('ledger.payment.record')}
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </Collapse>

              {/* Bill balance — explicit state wording; a held deposit owed
                  back to the guest is not "overpayment". */}
              <Box sx={{ p: 1.5, bgcolor: hasBalanceDue ? 'var(--hotel-warning-bg)' : 'var(--hotel-success-bg)', borderTop: '2px solid var(--hotel-border)' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: hasBalanceDue ? 'var(--hotel-orange)' : 'var(--hotel-success)' }}>
                  {t('checkout.billBalance', { amount: formatCurrency(Math.abs(balanceDue)), state: billBalanceLabel })}
                </Typography>
              </Box>
            </Box>
            </PhoneCollapsibleSection>
            {/* Checkout readiness — the single strip that replaced the old
                scattered deposit/payment alerts. */}
            {readinessStrip}
          </PaperIsland>)
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
                  {t('checkout.companyBilling', { name: booking.company_name })}
                </Typography>
                <Typography variant="caption">
                  {t('checkout.companyBillingNote')}
                </Typography>
              </Alert>
            )}
            {/* Guest Information */}
            <Paper elevation={0} sx={{ p: 2, bgcolor: 'var(--hotel-surface-sunken)', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>{t('checkout.guestInfo')}</Typography>
              <Grid container spacing={1}>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t('checkout.field.guestName')}:
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
                    {t('ledger.field.room')}:
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
                    {t('checkout.checkIn')}:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {formatHotelDateTime(booking.check_in_date)}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t('checkout.checkOut')}:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
                    {formatHotelDateTime(getActualCheckoutDate())}
                    {isEarlyCheckout() && (
                      <Chip label={t('checkout.early')} size="small" color="info" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                    )}
                    {isLateCheckout() && (
                      <Chip label={t('checkout.late')} size="small" color="warning" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                    )}
                  </Typography>
                </Grid>
                {getCheckoutVariance() && (
                  <>
                    <Grid size={6}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        {t('checkout.scheduled')}:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                        {formatHotelDate(booking.check_out_date)}
                      </Typography>
                    </Grid>
                  </>
                )}
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t('checkout.duration')}:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('checkout.nights', { count: calculateNights() })}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
            {/* Charges Breakdown */}
            <Paper elevation={0} sx={{ p: 2, bgcolor: 'primary.50', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>{t('checkout.chargesBreakdown')}</Typography>
              <Grid container spacing={1}>
                {/* Room Charges */}
                <Grid size={8}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t('checkout.roomChargesNights', { count: calculateNights() })}
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
                        {t('checkout.serviceTaxPct', { rate: hotelSettings.service_tax_rate })}
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
                            {t('checkout.tourismTax')}
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
                            {t('checkout.tourismTaxDay', { date: formatHotelDate(date) })}
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
                        {t('checkout.extraBedCharge')}
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
                            {t('checkout.serviceTaxPct', { rate: hotelSettings.service_tax_rate })}
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
                    {t('ledger.invoice.subtotal')}
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
                        {t('deposit.securityDeposit')}
                      </Typography>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        {depositResolution.status === 'waived' && depositWaiveReason
                          ? depositWaiveReason
                          : t('deposit.summary', { status: depositResolutionWording })}
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={4}>
                      <StatusChip
                        status={depositResolution.status}
                        label={t(DEPOSIT_STATUS_CHIP[depositResolution.status].labelKey)}
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
                    {charges.grandTotal >= 0 ? t('checkout.totalCollect') : t('checkout.totalRefund')}
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
      {/* Three actions render per step; ms labels run ~25% longer than en, so
          let the row wrap instead of overflowing a narrow viewport. */}
      <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', rowGap: 1 }}>
        {readOnly ? (
          <>
            <Button onClick={onClose}>{t('common:actions.close')}</Button>
            <Button
              variant="outlined"
              onClick={handlePrint}
              startIcon={<PrintIcon />}
            >{t('checkout.printInvoice')}</Button>
          </>
        ) : checkoutStep === 'preview' ? (
          <>
            <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button
              variant="outlined"
              onClick={handlePrint}
              startIcon={<PrintIcon />}
              disabled={blockers.length > 0}
            >{t('checkout.printPreview')}</Button>
            <Button
              variant="contained"
              onClick={handleProceedToConfirm}
              startIcon={<CheckIcon />}
              disabled={blockers.length > 0}
            >{t('checkout.proceedCheckout')}</Button>
          </>
        ) : (
          <>
            <Button onClick={handleBackToPreview}>{t('checkout.backToInvoice')}</Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={onClose} disabled={loading}>{t('common:actions.cancel')}</Button>
            <Button
              variant="contained"
              onClick={handleConfirmCheckout}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : <CheckIcon />}
            >
              {loading ? t('common:state.processing') : t('checkout.titleConfirm')}
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
