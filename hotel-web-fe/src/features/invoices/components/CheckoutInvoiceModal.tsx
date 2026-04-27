import React, { useState, useEffect } from 'react';
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
import { BookingWithDetails } from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';
import { HotelAPIService } from '../../../api';
import { InvoicesService } from '../../../api/invoices.service';
import { useCheckoutInvoiceData } from '../hooks/useCheckoutInvoiceData';
import { calculateChargesFromInputs, emptyCharges, ChargesBreakdown } from '../utils/chargesCalculation';

interface CheckoutInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  booking: BookingWithDetails | null;
  onConfirmCheckout?: (lateCheckoutData?: { penalty: number; notes: string }, paymentMethod?: string) => Promise<void>;
  readOnly?: boolean;
}

const CheckoutInvoiceModal: React.FC<CheckoutInvoiceModalProps> = ({
  open,
  onClose,
  booking,
  onConfirmCheckout,
  readOnly = false,
}) => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
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
  } = useCheckoutInvoiceData(booking, open);

  // Payment recording state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [recordingPayment, setRecordingPayment] = useState(false);

  // Payment editing state
  const [editingPayment, setEditingPayment] = useState<any | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editMethod, setEditMethod] = useState('Cash');
  const [editReference, setEditReference] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');
  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<number | null>(null);

  // Deposit refund state
  const [refundingDeposit, setRefundingDeposit] = useState(false);
  const [refundPaymentMethod, setRefundPaymentMethod] = useState('cash');

  // Deposit waive state
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
        ? booking.payment_method.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
        : 'Cash';
      setPaymentMethod(bookingPaymentMethod);
      setPaymentReference('');
      setPaymentNotes('');
      setDepositWaived(false);
      setDepositWaiveReason('');
    }
  }, [open, booking]);

  // Pre-fill payment amount when charges or payments update
  useEffect(() => {
    if (open && booking && charges.grandTotal > 0) {
      const totalPaid = payments
        .filter((p: any) => p.payment_status === 'completed')
        .reduce((sum: number, p: any) => sum + parseFloat(p.total_amount || '0'), 0);
      const balance = charges.grandTotal - totalPaid;
      if (balance > 0) {
        setPaymentAmount(parseFloat(balance.toFixed(2)));
      }
    }
  }, [open, booking, charges.grandTotal, payments]);

  const totalPayments = payments
    .filter((p: any) => p.payment_status === 'completed')
    .reduce((sum: number, p: any) => sum + parseFloat(p.total_amount || '0'), 0);
  const balanceDue = charges.grandTotal - totalPayments;

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
      setShowPaymentForm(false);
      setPaymentAmount(0);
      setPaymentReference('');
      setPaymentNotes('');
      setPaymentDate(new Date().toISOString().split('T')[0]);
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
    // Extract date from created_at (ISO string or timestamp)
    const paymentDate = payment.created_at ? new Date(payment.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
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
      // Check if this is a refund payment before deleting
      const deletedPayment = payments.find(p => p.id === paymentId);
      await InvoicesService.deletePayment(paymentId);
      setPayments(prev => prev.filter(p => p.id !== paymentId));
      // Reset depositRefunded if a refund payment was deleted
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
      const refundPayment = await InvoicesService.refundDeposit(booking.id, refundPaymentMethod, charges.depositRefund);
      setPayments(prev => [...prev, refundPayment]);
      setDepositRefunded(true);
    } catch (err: any) {
      setError(err.message || 'Failed to refund deposit');
    } finally {
      setRefundingDeposit(false);
    }
  };

  const handleConfirmCheckout = async () => {
    try {
      setLoading(true);
      setError(null);

      // Save daily rates if edited but not yet saved
      if (booking && editingRates && Object.keys(editableDailyRates).length > 0) {
        await handleSaveDailyRates();
      }

      await onConfirmCheckout?.(undefined, paymentMethod);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to process checkout');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDailyRates = async () => {
    if (!booking) return;
    try {
      setSavingRates(true);
      const totalFromRates = Object.values(editableDailyRates).reduce((sum, r) => sum + (r || 0), 0);
      await HotelAPIService.updateBooking(booking.id, {
        daily_rates: editableDailyRates,
        room_rate_override: totalFromRates / Object.keys(editableDailyRates).length,
      });
      setEditingRates(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save daily rates');
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

  // Check if this is an early checkout (today is before scheduled checkout)
  const isEarlyCheckout = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scheduledCheckout = new Date(booking.check_out_date);
    scheduledCheckout.setHours(0, 0, 0, 0);
    return today < scheduledCheckout;
  };

  const formatBookingStatus = (status?: string) => {
    if (!status) return 'Unknown';
    return status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center">
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
          // STEP 1: Invoice Preview (Default View)
          <Box sx={{ fontFamily: 'Arial, sans-serif', color: '#333' }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
                {error}
              </Alert>
            )}
            {!readOnly && (
              <Alert severity="info" sx={{ mb: 3 }}>
                <Typography variant="body2" fontWeight={600}>Please review the invoice carefully before proceeding with checkout.</Typography>
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
                <Typography variant="body2" fontWeight={600}>
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
              <Typography variant="body2" color="text.secondary">
                {hotelSettings.hotel_address}
              </Typography>
              <Typography variant="body2" color="text.secondary">
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
                {[
                  { label: 'Name', value: booking?.guest_name },
                  { label: 'Room', value: `${booking?.room_number} - ${booking?.room_type}` },
                  guestCompanyName ? { label: 'Company', value: guestCompanyName } : null,
                  guestPhone ? { label: 'Phone', value: guestPhone } : null,
                  guestIcNumber ? { label: 'ID / IC', value: guestIcNumber } : null,
                  guestAddress ? { label: 'Address', value: guestAddress } : null,
                ].filter(Boolean).map((item: any) => (
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
                  </Box>
                </Typography>
                {isEarlyCheckout() && (
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
                      const checkIn = new Date(booking.check_in_date);
                      return Array.from({ length: nights }, (_, i) => {
                        const date = new Date(checkIn);
                        date.setDate(date.getDate() + i);
                        const dateStr = date.toLocaleDateString();
                        const dateKey = date.toISOString().split('T')[0];
                        const taxInclusiveRate = editableDailyRates[dateKey] || 0;
                        const dayRate = taxInclusiveRate / taxMultiplier;
                        const dayTax = taxInclusiveRate - dayRate;
                        return (
                          <React.Fragment key={i}>
                            <Box sx={{ p: 1.5, borderBottom: dayTax > 0 ? 'none' : '1px solid #ddd' }}>
                              <Grid container alignItems="center">
                                <Grid size={editingRates ? 5 : 8}>
                                  <Typography variant="body2">
                                    Room Charge — {dateStr}
                                  </Typography>
                                </Grid>
                                <Grid sx={{ textAlign: 'right' }} size={editingRates ? 7 : 4}>
                                  {editingRates ? (
                                    <TextField
                                      size="small"
                                      type="number"
                                      value={taxInclusiveRate || ''}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        setEditableDailyRates(prev => ({ ...prev, [dateKey]: val }));
                                      }}
                                      InputProps={{
                                        startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                                      }}
                                      inputProps={{ min: 0, step: 0.01 }}
                                      sx={{ width: 160, '& .MuiInputBase-input': { textAlign: 'right', py: 0.5 } }}
                                    />
                                  ) : (
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {formatCurrency(dayRate)}
                                    </Typography>
                                  )}
                                </Grid>
                              </Grid>
                            </Box>
                            {dayTax > 0 && (
                              <Box sx={{ p: 1.5, pl: 3, borderBottom: '1px solid #ddd', bgcolor: '#fafafa' }}>
                                <Grid container>
                                  <Grid size={8}>
                                    <Typography variant="body2" color="text.secondary">
                                      Service Tax ({hotelSettings.service_tax_rate}%)
                                    </Typography>
                                  </Grid>
                                  <Grid sx={{ textAlign: 'right' }} size={4}>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }} color="text.secondary">
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
                {charges.tourismTax > 0 && (() => {
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
                  const perNight = charges.tourismTax / nights;
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
                {charges.extraBedCharge > 0 && (
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
                      {charges.extraBedServiceTax > 0 && (
                        <>
                          <Grid size={8}>
                            <Typography variant="body2" color="text.secondary" sx={{ pl: 2, fontSize: '0.8rem' }}>
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
                        {charges.grandTotal >= 0 ? 'Total Amount Due' : 'Total Refund'}
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={4}>
                      <Typography variant="h5" sx={{ fontWeight: 700, color: '#1976d2' }}>
                        {formatCurrency(Math.abs(charges.grandTotal))}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Box>
            </Box>

            {/* Deposit Refund Section */}
            {charges.depositRefund > 0 && !depositWaived ? (
              <Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
                <Box sx={{ p: 1.5, bgcolor: depositRefunded ? '#e8f5e9' : '#fff3e0' }}>
                  <Grid container alignItems="center">
                    <Grid size={5}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: depositRefunded ? '#2e7d32' : '#e65100' }}>
                        Deposit Refund
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {depositRefunded ? 'Refunded separately to guest' : 'Must be refunded or waived before checkout'}
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }} size={7}>
                      {depositRefunded ? (
                        <>
                          <Chip label="Refunded" size="small" color="success" />
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#2e7d32' }}>
                            {formatCurrency(charges.depositRefund)}
                          </Typography>
                        </>
                      ) : (
                        <>
                          <FormControl size="small" sx={{ minWidth: 100 }}>
                            <Select
                              value={refundPaymentMethod}
                              onChange={(e) => setRefundPaymentMethod(e.target.value)}
                              size="small"
                              sx={{ fontSize: '0.8rem' }}
                            >
                              <MenuItem value="cash">Cash</MenuItem>
                              <MenuItem value="card">Card</MenuItem>
                              <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                              <MenuItem value="duitnow">DuitNow</MenuItem>
                            </Select>
                          </FormControl>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={handleRefundDeposit}
                            disabled={refundingDeposit}
                            startIcon={refundingDeposit ? <CircularProgress size={14} /> : <PaymentIcon />}
                            sx={{ fontSize: '0.75rem', py: 0.5 }}
                          >
                            Refund {formatCurrency(charges.depositRefund)}
                          </Button>
                        </>
                      )}
                    </Grid>
                  </Grid>
                </Box>
                {/* Waive Deposit Option */}
                {!depositRefunded && (
                  <Box sx={{ p: 1.5, borderTop: '1px solid #ddd', bgcolor: '#fafafa' }}>
                    <Grid container alignItems="center" spacing={1}>
                      <Grid size={12}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                          Or waive the deposit (e.g., lost keycard, special arrangement):
                        </Typography>
                      </Grid>
                      <Grid size={8}>
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="Reason for waiving deposit (e.g., lost keycard)"
                          value={depositWaiveReason}
                          onChange={(e) => setDepositWaiveReason(e.target.value)}
                          sx={{ fontSize: '0.8rem' }}
                        />
                      </Grid>
                      <Grid size={4}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          fullWidth
                          onClick={() => {
                            if (depositWaiveReason.trim()) {
                              setDepositWaived(true);
                            }
                          }}
                          disabled={!depositWaiveReason.trim()}
                          sx={{ fontSize: '0.75rem', py: 0.5 }}
                        >
                          Waive Deposit
                        </Button>
                      </Grid>
                    </Grid>
                  </Box>
                )}
              </Box>
            ) : depositWaived ? (
              <Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
                <Box sx={{ p: 1.5, bgcolor: '#fff3e0' }}>
                  <Grid container alignItems="center">
                    <Grid size={8}>
                      <Typography variant="body2" sx={{ color: '#e65100', fontWeight: 600 }}>
                        Deposit
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Waived: {depositWaiveReason}
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }} size={4}>
                      <Chip label="Waived" size="small" color="warning" />
                      <Button
                        size="small"
                        variant="text"
                        color="primary"
                        onClick={() => {
                          setDepositWaived(false);
                          setDepositWaiveReason('');
                        }}
                        sx={{ fontSize: '0.7rem', minWidth: 'auto' }}
                      >
                        Undo
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </Box>
            ) : (
              <Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
                <Box sx={{ p: 1.5, bgcolor: '#e3f2fd' }}>
                  <Grid container alignItems="center">
                    <Grid size={8}>
                      <Typography variant="body2" sx={{ color: '#1565c0' }}>
                        Deposit
                      </Typography>
                    </Grid>
                    <Grid sx={{ textAlign: 'right' }} size={4}>
                      <Chip
                        label={booking?.company_id ? 'City Ledger - N/A' : booking?.payment_note?.includes('waived') ? 'Waived' : 'No Deposit Collected'}
                        size="small"
                        color={booking?.payment_note?.includes('waived') ? 'warning' : 'info'}
                      />
                    </Grid>
                  </Grid>
                </Box>
              </Box>
            )}

            {/* Member Payment Required Alert */}
            {booking?.guest_type === 'member' && balanceDue > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Member Payment Required — Please settle the full balance before proceeding to checkout.
                </Typography>
              </Alert>
            )}

            {/* Payments Section */}
            <Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
              <Box sx={{ bgcolor: '#2e7d32', color: 'white', p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                  <PaymentIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />
                  Payments
                </Typography>
                {balanceDue > 0 && (
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
              {payments.filter((p: any) => p.payment_status === 'completed').length > 0 && (
                <Box sx={{ p: 0 }}>
                  {payments.filter((p: any) => p.payment_status === 'completed').map((p: any, idx: number) => (
                    <Box key={p.id || idx} sx={{ p: 1.5, borderBottom: '1px solid #eee' }}>
                      {editingPayment?.id === p.id ? (
                        // Edit form inline
                        <Box>
                          <Grid container spacing={1} sx={{ mb: 1 }}>
                            <Grid size={4}>
                              <TextField
                                label="Amount"
                                type="number"
                                size="small"
                                fullWidth
                                value={editAmount || ''}
                                onChange={(e) => setEditAmount(parseFloat(e.target.value) || 0)}
                                InputProps={{
                                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                                }}
                              />
                            </Grid>
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
                            <Grid size={4}>
                              <TextField
                                label="Payment Date"
                                type="date"
                                size="small"
                                fullWidth
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                InputLabelProps={{ shrink: true }}
                              />
                            </Grid>
                            <Grid size={6}>
                              <TextField
                                label="Reference"
                                size="small"
                                fullWidth
                                value={editReference}
                                onChange={(e) => setEditReference(e.target.value)}
                              />
                            </Grid>
                            <Grid size={6}>
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
                              disabled={updatingPayment || editAmount <= 0}
                            >
                              {updatingPayment ? 'Saving...' : 'Save'}
                            </Button>
                          </Box>
                        </Box>
                      ) : (
                        // Normal display
                        <Grid container alignItems="center">
                          <Grid size={4}>
                            <Typography variant="body2">
                              {p.payment_method?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(p.created_at).toLocaleString()}
                            </Typography>
                          </Grid>
                          <Grid size={3}>
                            <Typography variant="caption" color="text.secondary">
                              {p.transaction_reference || p.notes || ''}
                            </Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={3}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#2e7d32' }}>
                              {formatCurrency(parseFloat(p.total_amount || '0'))}
                            </Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={2}>
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                              <Button
                                size="small"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleStartEdit(p)}
                                disabled={deletingPaymentId === p.id}
                              >
                                <EditIcon fontSize="small" />
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleDeletePayment(p.id)}
                                disabled={deletingPaymentId === p.id}
                              >
                                {deletingPaymentId === p.id ? (
                                  <CircularProgress size={16} />
                                ) : (
                                  <DeleteIcon fontSize="small" />
                                )}
                              </Button>
                            </Box>
                          </Grid>
                        </Grid>
                      )}
                    </Box>
                  ))}
                </Box>
              )}

              {/* Refund records */}
              {payments.filter((p: any) => p.payment_status === 'refunded').length > 0 && (
                <Box sx={{ p: 0 }}>
                  {payments.filter((p: any) => p.payment_status === 'refunded').map((p: any, idx: number) => (
                    <Box key={p.id || idx} sx={{ p: 1.5, borderBottom: '1px solid #eee', bgcolor: '#f1f8e9' }}>
                      {editingPayment?.id === p.id ? (
                        <Box>
                          <Grid container spacing={1} sx={{ mb: 1 }}>
                            <Grid size={4}>
                              <TextField
                                label="Amount"
                                type="number"
                                size="small"
                                fullWidth
                                value={editAmount || ''}
                                onChange={(e) => setEditAmount(parseFloat(e.target.value) || 0)}
                                InputProps={{
                                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                                }}
                              />
                            </Grid>
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
                            <Grid size={4}>
                              <TextField
                                label="Refund Date"
                                type="date"
                                size="small"
                                fullWidth
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                InputLabelProps={{ shrink: true }}
                              />
                            </Grid>
                            <Grid size={6}>
                              <TextField
                                label="Reference"
                                size="small"
                                fullWidth
                                value={editReference}
                                onChange={(e) => setEditReference(e.target.value)}
                              />
                            </Grid>
                            <Grid size={6}>
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
                              disabled={updatingPayment || editAmount <= 0}
                            >
                              {updatingPayment ? 'Saving...' : 'Save'}
                            </Button>
                          </Box>
                        </Box>
                      ) : (
                        <Grid container alignItems="center">
                          <Grid size={5}>
                            <Typography variant="body2" sx={{ color: '#2e7d32' }}>
                              Deposit Refund ({p.payment_method?.replace('_', ' ')})
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(p.created_at).toLocaleString()}
                            </Typography>
                          </Grid>
                          <Grid size={2}>
                            <Chip label="Refunded" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={3}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#2e7d32' }}>
                              -{formatCurrency(parseFloat(p.total_amount || '0'))}
                            </Typography>
                          </Grid>
                          <Grid sx={{ textAlign: 'right' }} size={2}>
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                              <Button
                                size="small"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleStartEdit(p)}
                                disabled={deletingPaymentId === p.id}
                              >
                                <EditIcon fontSize="small" />
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                sx={{ minWidth: 'auto', p: 0.5 }}
                                onClick={() => handleDeletePayment(p.id)}
                                disabled={deletingPaymentId === p.id}
                              >
                                {deletingPaymentId === p.id ? (
                                  <CircularProgress size={16} />
                                ) : (
                                  <DeleteIcon fontSize="small" />
                                )}
                              </Button>
                            </Box>
                          </Grid>
                        </Grid>
                      )}
                    </Box>
                  ))}
                </Box>
              )}

              {payments.length === 0 && (
                <Box sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">No payments recorded yet</Typography>
                </Box>
              )}

              {/* Record Payment Form */}
              <Collapse in={showPaymentForm}>
                <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderTop: '1px solid #ddd' }}>
                  <Grid container spacing={2}>
                    <Grid size={4}>
                      <TextField
                        label="Amount"
                        type="number"
                        size="small"
                        fullWidth
                        value={paymentAmount || ''}
                        onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                        }}
                      />
                    </Grid>
                    <Grid size={4}>
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
                    <Grid size={4}>
                      <TextField
                        label="Payment Date"
                        type="date"
                        size="small"
                        fullWidth
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>
                    <Grid size={6}>
                      <TextField
                        label="Reference (Optional)"
                        size="small"
                        fullWidth
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                      />
                    </Grid>
                    <Grid size={6}>
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
                        disabled={recordingPayment || paymentAmount <= 0}
                        startIcon={recordingPayment ? <CircularProgress size={14} /> : <PaymentIcon />}
                      >
                        {recordingPayment ? 'Recording...' : 'Record Payment'}
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </Collapse>

              {/* Balance Due */}
              <Box sx={{ p: 1.5, bgcolor: balanceDue > 0 ? '#fff3e0' : '#e8f5e9', borderTop: '2px solid #ddd' }}>
                <Grid container>
                  <Grid size={8}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: balanceDue > 0 ? '#e65100' : '#2e7d32' }}>
                      {balanceDue > 0 ? 'Balance Due' : balanceDue < 0 ? 'Overpayment' : 'Fully Paid'}
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: balanceDue > 0 ? '#e65100' : '#2e7d32' }}>
                      {formatCurrency(Math.abs(balanceDue))}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>
            </Box>

            {/* Notes */}
            {charges.depositRefund > 0 && !depositRefunded && !depositWaived && !readOnly && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="body2" fontWeight={600}>
                  Deposit refund required
                </Typography>
                <Typography variant="caption">
                  Please refund or waive the room card deposit of {formatCurrency(charges.depositRefund)} above before printing or proceeding to checkout.
                </Typography>
              </Alert>
            )}

            {depositRefunded && (
              <Alert severity="success" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  Room card deposit of {formatCurrency(charges.depositRefund)} has been refunded.
                </Typography>
              </Alert>
            )}
          </Box>
        ) : (
          // STEP 3: Confirmation Summary (After Review)
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
              <Typography variant="body2" fontWeight={600}>
                Company Billing: {booking.company_name}
              </Typography>
              <Typography variant="caption">
                Room charges will be automatically posted to the company ledger.
              </Typography>
            </Alert>
          )}

          {/* Guest Information */}
          <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
              Guest Information
            </Typography>
            <Grid container spacing={1}>
              <Grid size={6}>
                <Typography variant="body2" color="text.secondary">
                  Guest Name:
                </Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {booking.guest_name}
                </Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" color="text.secondary">
                  Room:
                </Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {booking.room_number} - {booking.room_type}
                </Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" color="text.secondary">
                  Check-in:
                </Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {new Date(booking.check_in_date).toLocaleString()}
                </Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" color="text.secondary">
                  Check-out:
                </Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
                  {getActualCheckoutDate().toLocaleString()}
                  {isEarlyCheckout() && (
                    <Chip label="Early" size="small" color="info" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                  )}
                </Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" color="text.secondary">
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
                <Typography variant="body2" color="text.secondary">
                  Room Charges ({calculateNights()} nights)
                </Typography>
              </Grid>
              <Grid sx={{ textAlign: 'right' }} size={4}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatCurrency(charges.roomCharges)}
                </Typography>
              </Grid>

              {/* Service Tax */}
              {charges.serviceTax > 0 && (
                <>
                  <Grid size={8}>
                    <Typography variant="body2" color="text.secondary">
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
              {charges.tourismTax > 0 && (() => {
                const nights = calculateNights();
                if (isHourlyBooking || nights <= 0) {
                  return (
                    <React.Fragment key="tt-single">
                      <Grid size={8}>
                        <Typography variant="body2" color="text.secondary">
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
                const perNight = charges.tourismTax / nights;
                const checkIn = new Date(booking.check_in_date);
                return Array.from({ length: nights }, (_, i) => {
                  const date = new Date(checkIn);
                  date.setDate(date.getDate() + i);
                  return (
                    <React.Fragment key={`tt-${i}`}>
                      <Grid size={8}>
                        <Typography variant="body2" color="text.secondary">
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
              {charges.extraBedCharge > 0 && (
                <>
                  <Grid size={8}>
                    <Typography variant="body2" color="text.secondary">
                      Extra Bed Charge
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Typography variant="body2">
                      {formatCurrency(charges.extraBedCharge)}
                    </Typography>
                  </Grid>
                  {charges.extraBedServiceTax > 0 && (
                    <>
                      <Grid size={8}>
                        <Typography variant="body2" color="text.secondary" sx={{ pl: 2 }}>
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

              {/* Deposit Refund Status */}
              {depositWaived ? (
                <>
                  <Grid size={8}>
                    <Typography variant="body2" sx={{ color: 'warning.main' }}>
                      Deposit
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {depositWaiveReason}
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Chip label="Waived" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
                  </Grid>
                </>
              ) : charges.depositRefund > 0 && (
                <>
                  <Grid size={8}>
                    <Typography variant="body2" sx={{ color: 'success.main' }}>
                      Deposit
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Chip label="Refunded" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
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

          {/* Additional Info */}
          {depositWaived ? (
            <Alert severity="warning">
              <Typography variant="body2">
                Room card deposit has been waived. Reason: {depositWaiveReason}
              </Typography>
            </Alert>
          ) : charges.depositRefund > 0 && (
            <Alert severity="success">
              <Typography variant="body2">
                Room card deposit of {formatCurrency(charges.depositRefund)} has been refunded to the guest.
              </Typography>
            </Alert>
          )}
          </Box>
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
              disabled={(charges.depositRefund > 0 && !depositRefunded && !depositWaived) || (booking?.guest_type === 'member' && balanceDue > 0)}
            >
              Print Preview
            </Button>
            <Button
              variant="contained"
              onClick={handleProceedToConfirm}
              startIcon={<CheckIcon />}
              disabled={(charges.depositRefund > 0 && !depositRefunded && !depositWaived) || (booking?.guest_type === 'member' && balanceDue > 0)}
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

      {/* Hidden printable invoice */}
      <Box id="printable-invoice" sx={{ display: 'none' }}>
        <div className="invoice-header">
          <h1>{hotelSettings.hotel_name}</h1>
          <p>{hotelSettings.hotel_address}</p>
          <p>Phone: {hotelSettings.hotel_phone} | Email: {hotelSettings.hotel_email}</p>
        </div>

        <div className="invoice-meta">
          <div>
            <h3>Invoice Details</h3>
            <p>
              <span className="label">Invoice Number:</span>
              <span className="value">{booking?.invoice_number || booking?.folio_number || `#${booking?.id}`}</span>
            </p>
            <p>
              <span className="label">Date:</span>
              <span className="value">{new Date().toLocaleDateString()}</span>
            </p>
            <p>
              <span className="label">Status:</span>
              <span className="value">{formatBookingStatus(booking.status)}</span>
            </p>
          </div>

          <div>
            <h3>Guest Information</h3>
            <p>
              <span className="label">Name:</span>
              <span className="value">{booking?.guest_name}</span>
            </p>
            <p>
              <span className="label">Room:</span>
              <span className="value">{booking?.room_number} - {booking?.room_type}</span>
            </p>
            {guestCompanyName && (
              <p>
                <span className="label">Company:</span>
                <span className="value">{guestCompanyName}</span>
              </p>
            )}
            {guestPhone && (
              <p>
                <span className="label">Phone:</span>
                <span className="value">{guestPhone}</span>
              </p>
            )}
            {guestIcNumber && (
              <p>
                <span className="label">ID / IC:</span>
                <span className="value">{guestIcNumber}</span>
              </p>
            )}
            {guestAddress && (
              <p>
                <span className="label">Address:</span>
                <span className="value">{guestAddress}</span>
              </p>
            )}
          </div>

          <div>
            <h3>Stay Details</h3>
            <p>
              <span className="label">Check-in:</span>
              <span className="value">{new Date(booking?.check_in_date || '').toLocaleDateString()}</span>
            </p>
            <p>
              <span className="label">Check-out:</span>
              <span className="value">
                {getActualCheckoutDate().toLocaleDateString()}
                {isEarlyCheckout() && ' (Early Checkout)'}
              </span>
            </p>
            {isEarlyCheckout() && (
              <p>
                <span className="label">Scheduled:</span>
                <span className="value">{new Date(booking?.check_out_date || '').toLocaleDateString()}</span>
              </p>
            )}
            <p>
              <span className="label">Duration:</span>
              <span className="value">{isHourlyBooking ? 'Hourly Stay' : `${calculateNights()} night(s)`}</span>
            </p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="amount">Amount</th>
            </tr>
          </thead>
          <tbody>
            {isHourlyBooking ? (
              <tr>
                <td>Room Charges (Hourly Stay)</td>
                <td className="amount">{formatCurrency(charges.roomCharges)}</td>
              </tr>
            ) : (
              (() => {
                const nights = calculateNights();
                const taxRate2 = hotelSettings.service_tax_rate / 100;
                const taxMultiplier2 = 1 + taxRate2;
                const checkIn = new Date(booking.check_in_date);
                return Array.from({ length: nights }, (_, i) => {
                  const date = new Date(checkIn);
                  date.setDate(date.getDate() + i);
                  const dateKey = date.toISOString().split('T')[0];
                  const taxInclusiveRate = editableDailyRates[dateKey] || 0;
                  const dayRate = taxInclusiveRate / taxMultiplier2;
                  const dayTax = taxInclusiveRate - dayRate;
                  return (
                    <React.Fragment key={i}>
                      <tr>
                        <td>Room Charge — {date.toLocaleDateString()}</td>
                        <td className="amount">{formatCurrency(dayRate)}</td>
                      </tr>
                      {dayTax > 0 && (
                        <tr style={{ color: '#666' }}>
                          <td style={{ paddingLeft: '24px' }}>Service Tax ({hotelSettings.service_tax_rate}%)</td>
                          <td className="amount">{formatCurrency(dayTax)}</td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                });
              })()
            )}

            {charges.tourismTax > 0 && (() => {
              const ttNights = calculateNights();
              if (isHourlyBooking || ttNights <= 0) {
                return (
                  <tr>
                    <td>Tourism Tax</td>
                    <td className="amount">{formatCurrency(charges.tourismTax)}</td>
                  </tr>
                );
              }
              const perNight = charges.tourismTax / ttNights;
              const ttCheckIn = new Date(booking.check_in_date);
              return Array.from({ length: ttNights }, (_, i) => {
                const date = new Date(ttCheckIn);
                date.setDate(date.getDate() + i);
                return (
                  <tr key={`tt-print-${i}`}>
                    <td>Tourism Tax — {date.toLocaleDateString()}</td>
                    <td className="amount">{formatCurrency(perNight)}</td>
                  </tr>
                );
              });
            })()}

            {charges.extraBedCharge > 0 && (
              <>
                <tr>
                  <td>Extra Bed Charge</td>
                  <td className="amount">{formatCurrency(charges.extraBedCharge)}</td>
                </tr>
                {charges.extraBedServiceTax > 0 && (
                  <tr>
                    <td style={{ paddingLeft: '24px' }}>Service Tax ({hotelSettings.service_tax_rate}%)</td>
                    <td className="amount">{formatCurrency(charges.extraBedServiceTax)}</td>
                  </tr>
                )}
              </>
            )}

            {charges.depositRefund > 0 ? (
              <tr className="refund-row">
                <td>Deposit {depositRefunded ? '(Refunded)' : '(Pending Refund)'}</td>
                <td className="amount">{formatCurrency(charges.depositRefund)}</td>
              </tr>
            ) : null}

            <tr className="total-row">
              <td>{charges.grandTotal >= 0 ? 'Total Amount Due' : 'Total Refund'}</td>
              <td className="amount">{formatCurrency(Math.abs(charges.grandTotal))}</td>
            </tr>
          </tbody>
        </table>

        {/* Payments */}
        {payments.filter((p: any) => p.payment_status === 'completed').length > 0 && (
          <table style={{ marginTop: '15px' }}>
            <thead>
              <tr>
                <th>Payment Method</th>
                <th className="amount">Amount Paid</th>
              </tr>
            </thead>
            <tbody>
              {payments.filter((p: any) => p.payment_status === 'completed').map((p: any, idx: number) => (
                <tr key={p.id || idx}>
                  <td>
                    {p.payment_method?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                  </td>
                  <td className="amount">{formatCurrency(parseFloat(p.total_amount || '0'))}</td>
                </tr>
              ))}
              {balanceDue > 0 && (
                <tr style={{ color: '#e65100', fontWeight: 700 }}>
                  <td>Balance Due</td>
                  <td className="amount">{formatCurrency(balanceDue)}</td>
                </tr>
              )}
              {balanceDue <= 0 && (
                <tr style={{ color: '#2e7d32', fontWeight: 700 }}>
                  <td>{balanceDue < 0 ? 'Overpayment' : 'Fully Paid'}</td>
                  <td className="amount">{balanceDue < 0 ? formatCurrency(Math.abs(balanceDue)) : '-'}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {depositWaived ? (
          <div className="notes" style={{ backgroundColor: '#fff3e0', borderLeftColor: '#e65100' }}>
            <strong style={{ color: '#e65100' }}>Deposit - Waived</strong>
            Reason: {depositWaiveReason}
          </div>
        ) : charges.depositRefund > 0 ? (
          <div className="notes success-note">
            <strong>Deposit</strong>
            Deposit of {formatCurrency(charges.depositRefund)} has been refunded separately to the guest.
          </div>
        ) : (
          <div className="notes" style={{ backgroundColor: '#e3f2fd', borderLeftColor: '#1565c0' }}>
            <strong style={{ color: '#1565c0' }}>Deposit</strong>
            Waived (Member benefit)
          </div>
        )}

        <div className="footer">
          <strong>Thank you for choosing {hotelSettings.hotel_name}!</strong>
          <p>We hope to see you again soon.</p>
          <p style={{ marginTop: '10px' }}>This is a computer-generated invoice and does not require a signature.</p>
        </div>
      </Box>
    </Dialog>
  );
};

export default CheckoutInvoiceModal;
