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
} from '@mui/material';
import {
  Receipt as ReceiptIcon,
  CheckCircle as CheckIcon,
  Print as PrintIcon,
  WarningAmber as WarningIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { BookingWithDetails } from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings, HotelSettings } from '../../../utils/hotelSettings';
import { HotelAPIService } from '../../../api';

interface LateCheckoutData {
  penalty: number;
  notes: string;
}

interface CheckoutInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  booking: BookingWithDetails | null;
  onConfirmCheckout: (lateCheckoutData?: LateCheckoutData) => Promise<void>;
}

interface ChargesBreakdown {
  roomCharges: number;
  roomCardDeposit: number;
  serviceTax: number;
  tourismTax: number;
  extraBedCharge: number;
  lateCheckoutPenalty: number;
  subtotal: number;
  depositRefund: number;
  grandTotal: number;
}

const CheckoutInvoiceModal: React.FC<CheckoutInvoiceModalProps> = ({
  open,
  onClose,
  booking,
  onConfirmCheckout,
}) => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<'preview' | 'lateCheckout' | 'confirm'>('preview');
  const [hotelSettings, setHotelSettings] = useState<HotelSettings>(getHotelSettings());
  const [isLateCheckout, setIsLateCheckout] = useState(false);
  const [lateCheckoutPenalty, setLateCheckoutPenalty] = useState(0);
  const [lateCheckoutNotes, setLateCheckoutNotes] = useState('');
  const [roomPrice, setRoomPrice] = useState<number>(0);
  const [charges, setCharges] = useState<ChargesBreakdown>({
    roomCharges: 0,
    roomCardDeposit: 50,
    serviceTax: 0,
    tourismTax: 0,
    extraBedCharge: 0,
    lateCheckoutPenalty: 0,
    subtotal: 0,
    depositRefund: 0,
    grandTotal: 0,
  });

  // Check if late checkout applies:
  // 1. Booking checkout date must be TODAY
  // 2. Current time must be past the configured checkout time
  const checkIfLateCheckout = (): boolean => {
    if (!booking) return false;

    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Get booking's check_out_date in YYYY-MM-DD format
    const bookingCheckoutDate = typeof booking.check_out_date === 'string'
      ? booking.check_out_date.split('T')[0]
      : new Date(booking.check_out_date).toISOString().split('T')[0];

    // Late checkout only applies if checkout date is TODAY
    if (bookingCheckoutDate !== today) {
      return false;
    }

    // Check if current time is past the configured checkout time
    const [checkoutHours, checkoutMinutes] = hotelSettings.check_out_time.split(':').map(Number);
    const todayCheckoutTime = new Date();
    todayCheckoutTime.setHours(checkoutHours, checkoutMinutes, 0, 0);

    return now > todayCheckoutTime;
  };

  useEffect(() => {
    if (open && booking) {
      // Load latest hotel settings
      const settings = getHotelSettings();
      setHotelSettings(settings);

      // Check if it's a late checkout
      const lateCheckout = checkIfLateCheckout();
      setIsLateCheckout(lateCheckout);

      // Default late checkout penalty to 0 - user will enter manually
      setLateCheckoutPenalty(0);
      setLateCheckoutNotes('');

      // Fetch room price directly from API
      const fetchRoomPrice = async () => {
        try {
          const rooms = await HotelAPIService.getAllRooms();
          const room = rooms.find(r => r.id.toString() === booking.room_id.toString());
          if (room) {
            const price = typeof room.price_per_night === 'string'
              ? parseFloat(room.price_per_night)
              : room.price_per_night || 0;
            console.log('Fetched room price from API:', price, 'for room:', room.room_number);
            setRoomPrice(price);
          } else {
            console.error('Room not found in API response');
            setRoomPrice(0);
          }
        } catch (err) {
          console.error('Failed to fetch room price:', err);
          setRoomPrice(0);
        }
      };
      fetchRoomPrice();

      // Reset to preview step when modal opens
      setCheckoutStep('preview');
    }
  }, [open, booking]);

  // Recalculate charges when room price is loaded
  useEffect(() => {
    if (open && booking && roomPrice > 0) {
      calculateCharges(0);
    }
  }, [roomPrice]);

  // Listen for hotel settings changes
  useEffect(() => {
    const handleSettingsChange = (event: CustomEvent) => {
      setHotelSettings(event.detail);
    };

    window.addEventListener('hotelSettingsChange', handleSettingsChange as EventListener);
    return () => {
      window.removeEventListener('hotelSettingsChange', handleSettingsChange as EventListener);
    };
  }, []);

  const calculateCharges = (penalty: number = lateCheckoutPenalty) => {
    if (!booking) return;

    // Calculate nights first
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

    // Debug: log booking price info
    console.log('Checkout calculation - booking:', {
      price_per_night: booking.price_per_night,
      total_amount: booking.total_amount,
      room_number: booking.room_number,
      roomPrice_from_API: roomPrice,
      nights
    });

    // Get the booking's price per night
    let bookingPricePerNight = typeof booking.price_per_night === 'string'
      ? parseFloat(booking.price_per_night)
      : booking.price_per_night || 0;

    // Tax rate for calculations
    const taxRate = hotelSettings.service_tax_rate / 100;
    const taxMultiplier = 1 + taxRate;

    // Check if rate override fields are explicitly set AND have a non-zero value
    const weekdayOverride = booking.rate_override_weekday !== undefined && booking.rate_override_weekday !== null
      ? (typeof booking.rate_override_weekday === 'string' ? parseFloat(booking.rate_override_weekday) : booking.rate_override_weekday)
      : 0;
    const weekendOverride = booking.rate_override_weekend !== undefined && booking.rate_override_weekend !== null
      ? (typeof booking.rate_override_weekend === 'string' ? parseFloat(booking.rate_override_weekend) : booking.rate_override_weekend)
      : 0;

    // Override is only active if the value is greater than 0
    const hasActiveOverride = weekdayOverride > 0 || weekendOverride > 0;

    // If override is 0 or not set → use room price as AFTER tax (tax-inclusive)
    // If override is set (non-zero) → use override price as BEFORE tax (add tax on top)
    const isOverrideRate = hasActiveOverride;

    console.log('Override rate detection:', { isOverrideRate, hasActiveOverride, weekdayOverride, weekendOverride, bookingPricePerNight, roomPrice });

    let roomCharges: number;
    let serviceTax: number;

    if (isOverrideRate) {
      // Override price is BEFORE tax - add tax on top
      // Use the booking's price_per_night which contains the override rate
      const overridePrice = bookingPricePerNight;
      roomCharges = overridePrice * nights;
      serviceTax = roomCharges * taxRate;
      console.log('Using override rate (before tax):', { overridePrice, roomCharges, serviceTax });
    } else {
      // No override - use room price as TAX-INCLUSIVE (after tax)
      // The room price from API is the final price including tax
      let taxInclusivePrice = roomPrice;

      // Fallback: if room price not available, use booking's price_per_night
      if (!taxInclusivePrice || taxInclusivePrice === 0) {
        taxInclusivePrice = bookingPricePerNight;
        console.log('Using booking price_per_night as fallback:', bookingPricePerNight);
      }

      // Fallback 2: if still not available, derive from total_amount
      if (!taxInclusivePrice || taxInclusivePrice === 0) {
        const totalAmount = typeof booking.total_amount === 'string'
          ? parseFloat(booking.total_amount)
          : booking.total_amount || 0;
        taxInclusivePrice = nights > 0 ? totalAmount / nights : 0;
        console.log('Using fallback from total_amount:', taxInclusivePrice);
      }

      // The room price IS the final price (tax-inclusive)
      const roomSubtotal = taxInclusivePrice * nights;
      // Room Charges (before tax) = Subtotal / (1 + tax_rate)
      roomCharges = roomSubtotal / taxMultiplier;
      // Service Tax is the difference
      serviceTax = roomSubtotal - roomCharges;
      console.log('Using room price (tax-inclusive):', { taxInclusivePrice, roomCharges, serviceTax });
    }

    // Get deposit from booking - use 0 if explicitly set (member waiver), otherwise fallback to settings
    const roomCardDeposit = booking.room_card_deposit !== undefined && booking.room_card_deposit !== null
      ? (typeof booking.room_card_deposit === 'string' ? parseFloat(booking.room_card_deposit) : booking.room_card_deposit)
      : hotelSettings.room_card_deposit;

    // Get tourism tax from booking
    const tourismTax = booking.tourism_tax_amount
      ? (typeof booking.tourism_tax_amount === 'string' ? parseFloat(booking.tourism_tax_amount) : booking.tourism_tax_amount)
      : 0;

    // Get extra bed charge from booking
    const extraBedCharge = booking.extra_bed_charge
      ? (typeof booking.extra_bed_charge === 'string' ? parseFloat(booking.extra_bed_charge) : booking.extra_bed_charge)
      : 0;

    // Use the passed penalty (from late checkout form or default)
    const lateCheckoutPenaltyAmount = penalty;

    // Subtotal = Room Charges + Service Tax + other charges
    // This equals configured_price × nights + other charges
    const subtotal = roomCharges + serviceTax + tourismTax + extraBedCharge + lateCheckoutPenaltyAmount;

    // Deposit is always refunded - late checkout penalty is separate
    const depositRefund = roomCardDeposit;

    const grandTotal = subtotal - depositRefund;

    setCharges({
      roomCharges,
      roomCardDeposit,
      serviceTax,
      tourismTax,
      extraBedCharge,
      lateCheckoutPenalty: lateCheckoutPenaltyAmount,
      subtotal,
      depositRefund,
      grandTotal,
    });
  };

  // Update charges when penalty changes
  const handlePenaltyChange = (value: number) => {
    setLateCheckoutPenalty(value);
    calculateCharges(value);
  };

  const handleConfirmCheckout = async () => {
    try {
      setLoading(true);
      setError(null);

      // Pass late checkout data if applicable
      const lateCheckoutData = isLateCheckout && lateCheckoutPenalty > 0
        ? { penalty: lateCheckoutPenalty, notes: lateCheckoutNotes }
        : undefined;

      await onConfirmCheckout(lateCheckoutData);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to process checkout');
    } finally {
      setLoading(false);
    }
  };

  const handleProceedToConfirm = () => {
    // If late checkout, show the late checkout form first
    if (isLateCheckout) {
      setCheckoutStep('lateCheckout');
    } else {
      setCheckoutStep('confirm');
    }
  };

  const handleProceedFromLateCheckout = () => {
    setCheckoutStep('confirm');
  };

  const handleBackToPreview = () => {
    setCheckoutStep('preview');
  };

  const handleBackToLateCheckout = () => {
    setCheckoutStep('lateCheckout');
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
          <title>Invoice - ${booking?.folio_number || `#${booking?.id}`}</title>
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

  const calculateNights = () => {
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    return Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  };

  // Get actual checkout date (today for early/normal checkout)
  const getActualCheckoutDate = () => {
    return new Date();
  };

  // Check if this is an early checkout (today is before scheduled checkout)
  const isEarlyCheckout = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scheduledCheckout = new Date(booking.check_out_date);
    scheduledCheckout.setHours(0, 0, 0, 0);
    return today < scheduledCheckout;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center">
            {checkoutStep === 'lateCheckout' ? (
              <WarningIcon sx={{ mr: 1, color: 'warning.main' }} />
            ) : (
              <ReceiptIcon sx={{ mr: 1, color: 'primary.main' }} />
            )}
            <Typography variant="h6">
              {checkoutStep === 'preview'
                ? 'Invoice Preview - Review Before Checkout'
                : checkoutStep === 'lateCheckout'
                  ? 'Late Checkout - Enter Penalty Details'
                  : 'Confirm Checkout'}
            </Typography>
          </Box>
          <Chip
            label={booking.folio_number || `#${booking.id}`}
            color={checkoutStep === 'lateCheckout' ? 'warning' : 'primary'}
            size="small"
            variant="outlined"
          />
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {checkoutStep === 'preview' ? (
          // STEP 1: Invoice Preview (Default View)
          <Box sx={{ fontFamily: 'Arial, sans-serif', color: '#333' }}>
            <Alert severity="info" sx={{ mb: 3 }}>
              <Typography variant="body2" fontWeight={600}>Please review the invoice carefully before proceeding with checkout.</Typography>
              <Typography variant="caption">Verify all charges, taxes, and refunds are correct.</Typography>
            </Alert>

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
              <Grid item xs={12} md={4}>
                <Typography variant="subtitle2" sx={{ color: '#1976d2', mb: 1, textTransform: 'uppercase' }}>
                  Invoice Details
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '120px' }}>
                    Invoice Number:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {booking?.folio_number || `#${booking?.id}`}
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
                    Pending Checkout
                  </Box>
                </Typography>
              </Grid>

              <Grid item xs={12} md={4}>
                <Typography variant="subtitle2" sx={{ color: '#1976d2', mb: 1, textTransform: 'uppercase' }}>
                  Guest Information
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '80px' }}>
                    Name:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {booking?.guest_name}
                  </Box>
                </Typography>
                <Typography variant="body2">
                  <Box component="span" sx={{ color: '#666', display: 'inline-block', minWidth: '80px' }}>
                    Room:
                  </Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {booking?.room_number} - {booking?.room_type}
                  </Box>
                </Typography>
              </Grid>

              <Grid item xs={12} md={4}>
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
                <Typography variant="body2" sx={{ mb: 0.5 }}>
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
                    {calculateNights()} night(s)
                  </Box>
                </Typography>
              </Grid>
            </Grid>

            {/* Charges Table */}
            <Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden', mb: 3 }}>
              <Box sx={{ bgcolor: '#1976d2', color: 'white', p: 1.5 }}>
                <Grid container>
                  <Grid item xs={8}>
                    <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                      Description
                    </Typography>
                  </Grid>
                  <Grid item xs={4} sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                      Amount
                    </Typography>
                  </Grid>
                </Grid>
              </Box>

              <Box sx={{ p: 0 }}>
                {/* Room Charges */}
                <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd' }}>
                  <Grid container>
                    <Grid item xs={8}>
                      <Typography variant="body2">
                        Room Charges ({calculateNights()} nights)
                      </Typography>
                    </Grid>
                    <Grid item xs={4} sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatCurrency(charges.roomCharges)}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>

                {/* Service Tax */}
                {charges.serviceTax > 0 && (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd' }}>
                    <Grid container>
                      <Grid item xs={8}>
                        <Typography variant="body2">
                          Service Tax ({hotelSettings.service_tax_rate}%)
                        </Typography>
                      </Grid>
                      <Grid item xs={4} sx={{ textAlign: 'right' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatCurrency(charges.serviceTax)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {/* Tourism Tax */}
                {charges.tourismTax > 0 && (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd' }}>
                    <Grid container>
                      <Grid item xs={8}>
                        <Typography variant="body2">Tourism Tax</Typography>
                      </Grid>
                      <Grid item xs={4} sx={{ textAlign: 'right' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatCurrency(charges.tourismTax)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {/* Extra Bed */}
                {charges.extraBedCharge > 0 && (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd' }}>
                    <Grid container>
                      <Grid item xs={8}>
                        <Typography variant="body2">Extra Bed Charge</Typography>
                      </Grid>
                      <Grid item xs={4} sx={{ textAlign: 'right' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatCurrency(charges.extraBedCharge)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {/* Late Checkout Penalty */}
                {charges.lateCheckoutPenalty > 0 && (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd', bgcolor: '#ffebee' }}>
                    <Grid container>
                      <Grid item xs={8}>
                        <Typography variant="body2" sx={{ color: '#d32f2f' }}>
                          Late Checkout Penalty
                        </Typography>
                      </Grid>
                      <Grid item xs={4} sx={{ textAlign: 'right' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: '#d32f2f' }}>
                          {formatCurrency(charges.lateCheckoutPenalty)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {/* Subtotal */}
                <Box sx={{ p: 1.5, borderBottom: '2px solid #ddd', borderTop: '2px solid #ddd' }}>
                  <Grid container>
                    <Grid item xs={8}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Subtotal
                      </Typography>
                    </Grid>
                    <Grid item xs={4} sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatCurrency(charges.subtotal)}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>

                {/* Deposit Refund or Waived */}
                {charges.depositRefund > 0 ? (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd', bgcolor: '#e8f5e9' }}>
                    <Grid container>
                      <Grid item xs={8}>
                        <Typography variant="body2" sx={{ color: '#2e7d32' }}>
                          Room Card Deposit Refund
                        </Typography>
                      </Grid>
                      <Grid item xs={4} sx={{ textAlign: 'right' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: '#2e7d32' }}>
                          -{formatCurrency(charges.depositRefund)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                ) : (
                  <Box sx={{ p: 1.5, borderBottom: '1px solid #ddd', bgcolor: '#e3f2fd' }}>
                    <Grid container>
                      <Grid item xs={8}>
                        <Typography variant="body2" sx={{ color: '#1565c0' }}>
                          Room Card Deposit
                        </Typography>
                      </Grid>
                      <Grid item xs={4} sx={{ textAlign: 'right' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: '#1565c0' }}>
                          Waived
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {/* Grand Total */}
                <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderTop: '3px double #1976d2' }}>
                  <Grid container>
                    <Grid item xs={8}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {charges.grandTotal >= 0 ? 'Total Amount Due' : 'Total Refund'}
                      </Typography>
                    </Grid>
                    <Grid item xs={4} sx={{ textAlign: 'right' }}>
                      <Typography variant="h5" sx={{ fontWeight: 700, color: '#1976d2' }}>
                        {formatCurrency(Math.abs(charges.grandTotal))}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Box>
            </Box>

            {/* Notes */}
            {charges.lateCheckoutPenalty > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Late Checkout Notice
                </Typography>
                <Typography variant="caption">
                  Guest checked out after the standard checkout time. A penalty of {formatCurrency(charges.lateCheckoutPenalty)} has been applied, and the room card deposit has been forfeited.
                </Typography>
              </Alert>
            )}

            {charges.depositRefund > 0 && (
              <Alert severity="success" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  Room card deposit of {formatCurrency(charges.depositRefund)} will be refunded to the guest.
                </Typography>
              </Alert>
            )}
          </Box>
        ) : checkoutStep === 'lateCheckout' ? (
          // STEP 2: Late Checkout Penalty Form
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Alert severity="warning" icon={<WarningIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Late Checkout Detected
              </Typography>
              <Typography variant="body2">
                Current time is past the configured checkout time ({hotelSettings.check_out_time}).
                Please enter the late checkout penalty and any additional notes.
              </Typography>
            </Alert>

            {/* Company Billing Indicator */}
            {booking.company_id && booking.company_name && (
              <Alert severity="info" icon={<BusinessIcon />}>
                <Typography variant="body2" fontWeight={600}>
                  Company Billing: {booking.company_name}
                </Typography>
                <Typography variant="caption">
                  Late checkout penalty will be included in the company ledger posting.
                </Typography>
              </Alert>
            )}

            {/* Guest & Room Info Summary */}
            <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Guest</Typography>
                  <Typography variant="body1" fontWeight={600}>{booking.guest_name}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Room</Typography>
                  <Typography variant="body1" fontWeight={600}>{booking.room_number} - {booking.room_type}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Check-out Date</Typography>
                  <Typography variant="body1" fontWeight={600}>{getActualCheckoutDate().toLocaleDateString()}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Current Time</Typography>
                  <Typography variant="body1" fontWeight={600} color="warning.main">
                    {new Date().toLocaleTimeString()} (Late)
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            {/* Late Checkout Penalty Input */}
            <Paper elevation={0} sx={{ p: 3, bgcolor: 'warning.50', borderRadius: 2, border: '1px solid', borderColor: 'warning.main' }}>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ color: 'warning.dark' }}>
                Late Checkout Penalty
              </Typography>

              <TextField
                fullWidth
                label="Penalty Amount"
                type="number"
                value={lateCheckoutPenalty}
                onChange={(e) => handlePenaltyChange(parseFloat(e.target.value) || 0)}
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
                helperText="Enter the late checkout penalty amount (set to 0 if no penalty)"
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="Additional Notes (Optional)"
                multiline
                rows={3}
                value={lateCheckoutNotes}
                onChange={(e) => setLateCheckoutNotes(e.target.value)}
                placeholder="Enter any additional notes about the late checkout (e.g., reason for delay, special circumstances, etc.)"
                helperText="These notes will be saved with the booking record"
              />
            </Paper>

            {/* Updated Charges Preview */}
            <Paper elevation={0} sx={{ p: 2, bgcolor: 'primary.50', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Updated Charges Summary
              </Typography>
              <Grid container spacing={1}>
                <Grid item xs={8}>
                  <Typography variant="body2" color="text.secondary">Room Charges</Typography>
                </Grid>
                <Grid item xs={4} sx={{ textAlign: 'right' }}>
                  <Typography variant="body2">{formatCurrency(charges.roomCharges)}</Typography>
                </Grid>

                {charges.serviceTax > 0 && (
                  <>
                    <Grid item xs={8}>
                      <Typography variant="body2" color="text.secondary">Service Tax</Typography>
                    </Grid>
                    <Grid item xs={4} sx={{ textAlign: 'right' }}>
                      <Typography variant="body2">{formatCurrency(charges.serviceTax)}</Typography>
                    </Grid>
                  </>
                )}

                <Grid item xs={8}>
                  <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 600 }}>
                    Late Checkout Penalty
                  </Typography>
                </Grid>
                <Grid item xs={4} sx={{ textAlign: 'right' }}>
                  <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 600 }}>
                    {formatCurrency(lateCheckoutPenalty)}
                  </Typography>
                </Grid>

                <Grid item xs={12}><Divider sx={{ my: 1 }} /></Grid>

                {charges.roomCardDeposit > 0 ? (
                  <>
                    <Grid item xs={8}>
                      <Typography variant="body2" sx={{ color: 'success.main' }}>
                        Room Card Deposit Refund
                      </Typography>
                    </Grid>
                    <Grid item xs={4} sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" sx={{ color: 'success.main' }}>
                        -{formatCurrency(charges.roomCardDeposit)}
                      </Typography>
                    </Grid>
                  </>
                ) : (
                  <>
                    <Grid item xs={8}>
                      <Typography variant="body2" sx={{ color: 'info.main' }}>
                        Room Card Deposit
                      </Typography>
                    </Grid>
                    <Grid item xs={4} sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" sx={{ color: 'info.main' }}>
                        Waived
                      </Typography>
                    </Grid>
                  </>
                )}

                <Grid item xs={12}><Divider sx={{ my: 1 }} /></Grid>

                <Grid item xs={8}>
                  <Typography variant="h6" fontWeight={700}>Total Amount Due</Typography>
                </Grid>
                <Grid item xs={4} sx={{ textAlign: 'right' }}>
                  <Typography variant="h6" fontWeight={700} color="primary">
                    {formatCurrency(charges.grandTotal)}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            <Alert severity="info">
              <Typography variant="body2">
                The late checkout penalty will be added to the final bill. Room card deposit will still be refunded.
              </Typography>
            </Alert>
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
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">
                  Guest Name:
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {booking.guest_name}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">
                  Room:
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {booking.room_number} - {booking.room_type}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">
                  Check-in:
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {new Date(booking.check_in_date).toLocaleString()}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">
                  Check-out:
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {getActualCheckoutDate().toLocaleString()}
                  {isEarlyCheckout() && (
                    <Chip label="Early" size="small" color="info" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
                  )}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">
                  Duration:
                </Typography>
              </Grid>
              <Grid item xs={6}>
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
              <Grid item xs={8}>
                <Typography variant="body2" color="text.secondary">
                  Room Charges ({calculateNights()} nights)
                </Typography>
              </Grid>
              <Grid item xs={4} sx={{ textAlign: 'right' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatCurrency(charges.roomCharges)}
                </Typography>
              </Grid>

              {/* Service Tax */}
              {charges.serviceTax > 0 && (
                <>
                  <Grid item xs={8}>
                    <Typography variant="body2" color="text.secondary">
                      Service Tax ({hotelSettings.service_tax_rate}%)
                    </Typography>
                  </Grid>
                  <Grid item xs={4} sx={{ textAlign: 'right' }}>
                    <Typography variant="body2">
                      {formatCurrency(charges.serviceTax)}
                    </Typography>
                  </Grid>
                </>
              )}

              {/* Tourism Tax */}
              {charges.tourismTax > 0 && (
                <>
                  <Grid item xs={8}>
                    <Typography variant="body2" color="text.secondary">
                      Tourism Tax
                    </Typography>
                  </Grid>
                  <Grid item xs={4} sx={{ textAlign: 'right' }}>
                    <Typography variant="body2">
                      {formatCurrency(charges.tourismTax)}
                    </Typography>
                  </Grid>
                </>
              )}

              {/* Extra Bed */}
              {charges.extraBedCharge > 0 && (
                <>
                  <Grid item xs={8}>
                    <Typography variant="body2" color="text.secondary">
                      Extra Bed Charge
                    </Typography>
                  </Grid>
                  <Grid item xs={4} sx={{ textAlign: 'right' }}>
                    <Typography variant="body2">
                      {formatCurrency(charges.extraBedCharge)}
                    </Typography>
                  </Grid>
                </>
              )}

              {/* Late Checkout Penalty */}
              {charges.lateCheckoutPenalty > 0 && (
                <>
                  <Grid item xs={8}>
                    <Typography variant="body2" sx={{ color: 'warning.main' }}>
                      Late Checkout Penalty
                    </Typography>
                  </Grid>
                  <Grid item xs={4} sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 600 }}>
                      {formatCurrency(charges.lateCheckoutPenalty)}
                    </Typography>
                  </Grid>
                </>
              )}

              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
              </Grid>

              {/* Subtotal */}
              <Grid item xs={8}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Subtotal
                </Typography>
              </Grid>
              <Grid item xs={4} sx={{ textAlign: 'right' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatCurrency(charges.subtotal)}
                </Typography>
              </Grid>

              {/* Deposit Refund */}
              {charges.depositRefund > 0 && (
                <>
                  <Grid item xs={8}>
                    <Typography variant="body2" sx={{ color: 'success.main' }}>
                      Room Card Deposit Refund
                    </Typography>
                  </Grid>
                  <Grid item xs={4} sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>
                      -{formatCurrency(charges.depositRefund)}
                    </Typography>
                  </Grid>
                </>
              )}

              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
              </Grid>

              {/* Grand Total */}
              <Grid item xs={8}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {charges.grandTotal >= 0 ? 'Total to Collect' : 'Total to Refund'}
                </Typography>
              </Grid>
              <Grid item xs={4} sx={{ textAlign: 'right' }}>
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
          {charges.lateCheckoutPenalty > 0 && (
            <Alert severity="warning">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Late Checkout Detected
              </Typography>
              <Typography variant="caption">
                Guest checked out after the standard checkout time. A penalty of {formatCurrency(charges.lateCheckoutPenalty)} has been applied,
                and the room card deposit will not be refunded.
              </Typography>
            </Alert>
          )}

          {charges.depositRefund > 0 && (
            <Alert severity="success">
              <Typography variant="body2">
                Room card deposit of {formatCurrency(charges.depositRefund)} will be refunded to the guest.
              </Typography>
            </Alert>
          )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {checkoutStep === 'preview' ? (
          <>
            <Button onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="outlined"
              onClick={handlePrint}
              startIcon={<PrintIcon />}
            >
              Print Preview
            </Button>
            <Button
              variant="contained"
              onClick={handleProceedToConfirm}
              startIcon={isLateCheckout ? <WarningIcon /> : <CheckIcon />}
              color={isLateCheckout ? 'warning' : 'primary'}
            >
              {isLateCheckout ? 'Proceed (Late Checkout)' : 'Proceed to Checkout'}
            </Button>
          </>
        ) : checkoutStep === 'lateCheckout' ? (
          <>
            <Button onClick={handleBackToPreview}>
              Back to Invoice
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={handleProceedFromLateCheckout}
              startIcon={<CheckIcon />}
            >
              Continue to Confirmation
            </Button>
          </>
        ) : (
          <>
            <Button onClick={isLateCheckout ? handleBackToLateCheckout : handleBackToPreview}>
              {isLateCheckout ? 'Back to Penalty' : 'Back to Invoice'}
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
              <span className="value">{booking?.folio_number || `#${booking?.id}`}</span>
            </p>
            <p>
              <span className="label">Date:</span>
              <span className="value">{new Date().toLocaleDateString()}</span>
            </p>
            <p>
              <span className="label">Status:</span>
              <span className="value">Checked Out</span>
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
              <span className="value">{calculateNights()} night(s)</span>
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
            <tr>
              <td>Room Charges ({calculateNights()} nights)</td>
              <td className="amount">{formatCurrency(charges.roomCharges)}</td>
            </tr>

            {charges.serviceTax > 0 && (
              <tr>
                <td>Service Tax ({hotelSettings.service_tax_rate}%)</td>
                <td className="amount">{formatCurrency(charges.serviceTax)}</td>
              </tr>
            )}

            {charges.tourismTax > 0 && (
              <tr>
                <td>Tourism Tax</td>
                <td className="amount">{formatCurrency(charges.tourismTax)}</td>
              </tr>
            )}

            {charges.extraBedCharge > 0 && (
              <tr>
                <td>Extra Bed Charge</td>
                <td className="amount">{formatCurrency(charges.extraBedCharge)}</td>
              </tr>
            )}

            {charges.lateCheckoutPenalty > 0 && (
              <tr className="penalty-row">
                <td>Late Checkout Penalty</td>
                <td className="amount">{formatCurrency(charges.lateCheckoutPenalty)}</td>
              </tr>
            )}

            <tr className="subtotal-row">
              <td>Subtotal</td>
              <td className="amount">{formatCurrency(charges.subtotal)}</td>
            </tr>

            {charges.depositRefund > 0 ? (
              <tr className="refund-row">
                <td>Room Card Deposit Refund</td>
                <td className="amount">-{formatCurrency(charges.depositRefund)}</td>
              </tr>
            ) : (
              <tr style={{ color: '#1565c0' }}>
                <td>Room Card Deposit</td>
                <td className="amount">Waived</td>
              </tr>
            )}

            <tr className="total-row">
              <td>{charges.grandTotal >= 0 ? 'Total Amount Due' : 'Total Refund'}</td>
              <td className="amount">{formatCurrency(Math.abs(charges.grandTotal))}</td>
            </tr>
          </tbody>
        </table>

        {charges.lateCheckoutPenalty > 0 && (
          <div className="notes">
            <strong>Late Checkout Notice</strong>
            Guest checked out after the standard checkout time. A penalty of {formatCurrency(charges.lateCheckoutPenalty)} has been applied, and the room card deposit has been forfeited.
          </div>
        )}

        {charges.depositRefund > 0 ? (
          <div className="notes success-note">
            <strong>Deposit Refund</strong>
            Room card deposit of {formatCurrency(charges.depositRefund)} will be refunded to the guest.
          </div>
        ) : (
          <div className="notes" style={{ backgroundColor: '#e3f2fd', borderLeftColor: '#1565c0' }}>
            <strong style={{ color: '#1565c0' }}>Room Card Deposit</strong>
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
