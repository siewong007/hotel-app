import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tabs,
  Tab,
  Box,
  TextField,
  Grid,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Typography,
  CircularProgress,
  Alert,
  AlertTitle,
  Checkbox,
  FormControlLabel,
  Divider,
  Paper,
  InputAdornment,
  IconButton,
  FormHelperText,
  Autocomplete,
  Chip,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Search as SearchIcon,
  PersonAdd as PersonAddIcon,
  Business as BusinessIcon,
  Hotel as HotelIcon,
  Payment as PaymentIcon,
  MoneyOff as MoneyOffIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { BookingsService, CompaniesService, LedgerService } from '../../../api';
import { InvoicesService } from '../../../api/invoices.service';
import { getIdempotencyAttempt, type IdempotencyAttempt } from '../../../utils/idempotency';
import {
  Booking,
  Guest,
  CheckInRequest,
  CheckInAdvisory,
  GuestUpdateRequest,
  BookingUpdateRequest,
  RateCodesResponse,
  MarketCodesResponse,
  CustomerLedgerCreateRequest,
  RoomType,
  BookingWithDetails,
} from '../../../types';
import { errorMessage } from '../../../utils';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { useCheckInFormData } from '../hooks/useCheckInFormData';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { divideMoney, isPositiveMoney, multiplyMoney, toMoneyNumber } from '../../../utils/money';
import { getBookingChannelInfo } from '../utils/bookingChannel';
import type { ValidationErrors, CompanyOption } from './checkIn/checkInTypes';
import { PersonalInfoTab } from './checkIn/PersonalInfoTab';
import { StayInfoTab } from './checkIn/StayInfoTab';
import { PaymentInfoTab } from './checkIn/PaymentInfoTab';
import { CustomFieldsTab } from './checkIn/CustomFieldsTab';
import { NotesTab } from './checkIn/NotesTab';

// Validation helper functions
// Note: Email and phone are intentionally not format-validated at check-in —
// online bookings may arrive without (or with imperfect) contact details, and
// staff should not be blocked from checking the guest in.
const validateICNumber = (ic: string): boolean => {
  if (!ic) return true; // Optional field
  // Malaysian IC format: YYMMDD-SS-NNNN or YYMMDDSSNNNN (12 digits)
  const icClean = ic.replace(/-/g, '');
  if (icClean.length === 12 && /^\d{12}$/.test(icClean)) {
    return true;
  }
  // Allow passport numbers (alphanumeric, 6-20 chars)
  if (/^[A-Za-z0-9]{6,20}$/.test(ic)) {
    return true;
  }
  return false;
};

const validateCardNumber = (cardNumber: string): boolean => {
  if (!cardNumber) return true;
  const cleanNumber = cardNumber.replace(/[\s-]/g, '');
  return /^\d{13,19}$/.test(cleanNumber);
};

const validateCardExpiry = (expiry: string): boolean => {
  if (!expiry) return true;
  const expiryRegex = /^(0[1-9]|1[0-2])\/([0-9]{2})$/;
  if (!expiryRegex.test(expiry)) return false;

  const [month, year] = expiry.split('/');
  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  const expiryYear = parseInt(year, 10);
  const expiryMonth = parseInt(month, 10);

  if (expiryYear < currentYear) return false;
  if (expiryYear === currentYear && expiryMonth < currentMonth) return false;

  return true;
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`checkin-tabpanel-${index}`}
      aria-labelledby={`checkin-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

interface EnhancedCheckInModalProps {
  open: boolean;
  onClose: () => void;
  booking: Booking | BookingWithDetails | null;
  guest: Guest | null;
  onCheckInSuccess: () => void;
}

export default function EnhancedCheckInModal({
  open,
  onClose,
  booking,
  guest,
  onCheckInSuccess,
}: EnhancedCheckInModalProps) {
  const { symbol: currencySymbol, format: formatCurrency } = useCurrency();

  const {
    rateCodes,
    marketCodes,
    companyOptions,
    setCompanyOptions,
    loadingCompanies,
    roomTypeConfig,
    setRoomTypeConfig,
    loadDropdownData,
    loadCompanies,
    loadRoomTypeConfig,
  } = useCheckInFormData();
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pre-check-in advisory: warns when a normally company/ledger-billed guest is
  // being checked in without a company attached (see checkin_advisory backend).
  const [advisory, setAdvisory] = useState<CheckInAdvisory | null>(null);

  // Track if form has been initialized to prevent re-initialization
  const initializedRef = useRef<{ bookingId: string | null; guestId: number | null }>({ bookingId: null, guestId: null });
  // Track previous open state to detect true open/close transitions
  const wasOpenRef = useRef(false);
  const paymentAttemptRef = useRef<IdempotencyAttempt | null>(null);
  const [checkedInBookingPendingPayment, setCheckedInBookingPendingPayment] = useState<string | number | null>(null);

  // Guest data state
  const [guestData, setGuestData] = useState<GuestUpdateRequest>({});

  // Booking data state
  const [bookingData, setBookingData] = useState<BookingUpdateRequest>({});

  // Validation errors state
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Additional booking fields
  const [chargeIncidentals, setChargeIncidentals] = useState(true);
  const [vipGuest, setVipGuest] = useState(false);
  const [overrideRate, setOverrideRate] = useState(false);
  const [weekdayRate, setWeekdayRate] = useState('90.00');
  const [weekendRate, setWeekendRate] = useState('90.00');
  const [epiRate, setEpiRate] = useState(1);
  const [nextPosting, setNextPosting] = useState('');

  // Payment information
  const [paymentChoice, setPaymentChoice] = useState<'pay_now' | 'pay_later'>('pay_later');
  const [paymentType, setPaymentType] = useState('Cash');
  const [amountPaid, setAmountPaid] = useState(0);
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardName, setCardName] = useState('');
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [directBillCompany, setDirectBillCompany] = useState('');
  const [driversInfo, setDriversInfo] = useState('');

  // Deposit information
  const [depositChoice, setDepositChoice] = useState<'receive' | 'waive'>('receive');
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositMethod, setDepositMethod] = useState('Cash');
  const [waiveReason, setWaiveReason] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [language, setLanguage] = useState('Default Language (English)');
  const [travelAgent1, setTravelAgent1] = useState('');
  const [travelAgent2, setTravelAgent2] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [carPlateNo, setCarPlateNo] = useState('');
  const [eta, setEta] = useState('');

  // Company autocomplete state
  const [selectedCompany, setSelectedCompany] = useState<CompanyOption | null>(null);

  // New company registration dialog
  const [newCompanyDialogOpen, setNewCompanyDialogOpen] = useState(false);
  const [newCompanyData, setNewCompanyData] = useState<CompanyOption>({
    company_name: '',
    company_registration_number: '',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    billing_address: '',
  });

  // Company Ledger state (ledger creation moved to backend/admin UI)

  // Extra bed state (UI form state, not loaded data)
  const [extraBedCount, setExtraBedCount] = useState(0);
  const [extraBedCharge, setExtraBedCharge] = useState(0);

  const [titleOptions] = useState(['Mr', 'Mrs', 'Ms', 'Dr', 'Prof']);
  const [paymentMethods] = useState(() => {
    const settings = getHotelSettings();
    return settings.payment_methods && settings.payment_methods.length > 0
      ? settings.payment_methods
      : ['Cash', 'Credit Card', 'Debit Card', 'DuitNow', 'Online Banking', 'E-Wallet', 'Direct Billing'];
  });
  const [contactTypes] = useState(['Mobile', 'Home', 'Work', 'Fax']);

  // Derived extra bed config from room type
  const allowsExtraBed = roomTypeConfig?.allows_extra_bed ?? false;
  const maxExtraBeds = roomTypeConfig?.max_extra_beds ?? 0;
  const extraBedChargePerBed = roomTypeConfig ? toMoneyNumber(roomTypeConfig.extra_bed_charge) : 0;

  const initializeFormData = useCallback(() => {
    if (!guest || !booking) return;

    // The nickname is NOT a name to split. An anonymous booker's `first_name`
    // just mirrors the nickname and `last_name` is empty, so splitting it would
    // invent a legal name like "CoolAlex" / "" and check-in would stop asking.
    // Prefill only when a real legal name is already on file (both halves).
    const hasLegalName = Boolean(guest.first_name?.trim() && guest.last_name?.trim());

    setGuestData({
      first_name: hasLegalName ? (guest.first_name ?? '') : '',
      last_name: hasLegalName ? (guest.last_name ?? '') : '',
      email: guest.email,
      phone: guest.phone,
      ic_number: guest.ic_number,
      nationality: guest.nationality,
      address_line1: guest.address_line1,
      city: guest.city,
      state_province: guest.state_province,
      postal_code: guest.postal_code,
      country: guest.country,
      title: guest.title,
      alt_phone: guest.alt_phone,
    });

    const initialPaymentMethod = booking.payment_method || 'Cash';
    setBookingData({
      market_code: booking.market_code || 'WKII',
      rate_code: booking.rate_code || 'RACK',
      payment_method: initialPaymentMethod,
      check_in_time: booking.check_in_time || '15:00',
      check_out_time: booking.check_out_time || '11:00',
    });
    setPaymentType(initialPaymentMethod);

    setSpecialRequests(booking.special_requests || '');

    // Initialize payment and deposit from booking
    const totalAmt = toMoneyNumber(booking.total_amount);
    const settingsDeposit = getHotelSettings().deposit_amount;
    setAmountPaid(totalAmt);
    if (booking.payment_status === 'paid') {
      setPaymentChoice('pay_now');
    } else {
      setPaymentChoice('pay_later');
    }
    if (booking.deposit_paid) {
      setDepositChoice('receive');
      const existingDeposit = toMoneyNumber(booking.deposit_amount);
      setDepositAmount(isPositiveMoney(existingDeposit) ? existingDeposit : settingsDeposit);
    } else {
      setDepositChoice('receive');
      setDepositAmount(settingsDeposit);
    }

    // Initialize extra bed from booking
    setExtraBedCount(booking.extra_bed_count || 0);
    setExtraBedCharge(toMoneyNumber(booking.extra_bed_charge));
  }, [guest, booking]);

  // Reset form when modal closes - use proper transition detection
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    // Only reset when transitioning from open to closed
    if (!open && wasOpen) {
      initializedRef.current = { bookingId: null, guestId: null };
      setValidationErrors({});
      setTouched({});
      setActiveTab(0);
      setError(null);
      setAdvisory(null);
    }
  }, [open]);

  // Load rate and market codes and initialize form data
  // Only reinitialize if booking/guest IDs change (not on every re-render)
  useEffect(() => {
    if (open && booking && guest) {
      const needsInit =
        initializedRef.current.bookingId !== booking.id ||
        initializedRef.current.guestId !== guest.id;

      if (needsInit) {
        loadDropdownData();
        loadCompanies();
        initializeFormData();
        // Load room type config for extra bed settings
        loadRoomTypeConfig(booking);
        // Fetch the pre-check-in advisory (non-blocking; failures are silent).
        setAdvisory(null);
        BookingsService.getCheckInAdvisory(String(booking.id))
          .then(setAdvisory)
          .catch(() => setAdvisory(null));
        initializedRef.current = { bookingId: booking.id, guestId: guest.id };
      }
    }
  }, [open, booking, guest, loadDropdownData, loadCompanies, initializeFormData, loadRoomTypeConfig]);

  // Handle registering a new company
  const handleRegisterNewCompany = async () => {
    try {
      // Save to database
      const createdCompany = await CompaniesService.createCompany({
        company_name: newCompanyData.company_name,
        registration_number: newCompanyData.company_registration_number,
        contact_person: newCompanyData.contact_person,
        contact_email: newCompanyData.contact_email,
        contact_phone: newCompanyData.contact_phone,
        billing_address: newCompanyData.billing_address,
      });

      const newCompany: CompanyOption = {
        company_name: createdCompany.company_name,
        company_registration_number: createdCompany.registration_number,
        contact_person: createdCompany.contact_person,
        contact_email: createdCompany.contact_email,
        contact_phone: createdCompany.contact_phone,
        billing_address: createdCompany.billing_address,
      };

      // Add to company options
      setCompanyOptions([...companyOptions, newCompany]);
      setSelectedCompany(newCompany);
      setDirectBillCompany(newCompany.company_name);

      setNewCompanyDialogOpen(false);
      emitApiNotification({
        message: `Company "${newCompany.company_name}" registered successfully!`,
        severity: 'success',
      });

      // Reset new company form
      setNewCompanyData({
        company_name: '',
        company_registration_number: '',
        contact_person: '',
        contact_email: '',
        contact_phone: '',
        billing_address: '',
      });
    } catch (err) {
      console.error('Failed to register company:', err);
      emitApiNotification({
        message: errorMessage(err, 'Failed to register company'),
        severity: 'error',
      });
    }
  };

  // Validate a single field
  const validateField = useCallback((field: string, value: string): string | undefined => {
    switch (field) {
      case 'first_name':
        if (!value || !value.trim()) return 'First name is required';
        if (value.trim().length < 2) return 'First name must be at least 2 characters';
        return undefined;
      case 'last_name':
        if (!value || !value.trim()) return 'Last name is required';
        return undefined;
      case 'email':
        return undefined;
      case 'phone':
        return undefined;
      case 'alt_phone':
        return undefined;
      case 'ic_number':
        if (!value || !value.trim()) return 'IC/Passport number is required to complete check-in';
        if (!validateICNumber(value)) return 'Please enter a valid IC/Passport number';
        return undefined;
      case 'cardNumber':
        if (value && !validateCardNumber(value)) return 'Please enter a valid card number (13-19 digits)';
        return undefined;
      case 'cardExpiry':
        if (value && !validateCardExpiry(value)) return 'Please enter a valid expiry date (MM/YY)';
        return undefined;
      default:
        return undefined;
    }
  }, []);

  // Validate all fields and return errors
  const validateForm = useCallback((): ValidationErrors => {
    const errors: ValidationErrors = {};

    // Check-in is where the legal name is collected, so both halves are required.
    const firstNameError = validateField('first_name', guestData.first_name || '');
    if (firstNameError) errors.first_name = firstNameError;
    const lastNameError = validateField('last_name', guestData.last_name || '');
    if (lastNameError) errors.last_name = lastNameError;

    // Optional field validations
    const emailError = validateField('email', guestData.email || '');
    if (emailError) errors.email = emailError;

    const phoneError = validateField('phone', guestData.phone || '');
    if (phoneError) errors.phone = phoneError;

    const altPhoneError = validateField('alt_phone', guestData.alt_phone || '');
    if (altPhoneError) errors.alt_phone = altPhoneError;

    const icError = validateField('ic_number', guestData.ic_number || '');
    if (icError) errors.ic_number = icError;

    // Card validation if payment type is card
    if (paymentChoice === 'pay_now' && (paymentType === 'Credit Card' || paymentType === 'Debit Card' || paymentType === 'Visa Card' || paymentType === 'Master Card' || paymentType === 'American Express')) {
      const cardNumError = validateField('cardNumber', cardNumber);
      if (cardNumError) errors.cardNumber = cardNumError;

      const cardExpError = validateField('cardExpiry', cardExpiry);
      if (cardExpError) errors.cardExpiry = cardExpError;
    }

    return errors;
  }, [guestData, paymentType, cardNumber, cardExpiry, validateField, paymentChoice]);

  const handleGuestChange = (field: keyof GuestUpdateRequest, value: string) => {
    setGuestData(prev => ({ ...prev, [field]: value }));

    // Validate field on change if already touched
    if (touched[field]) {
      const error = validateField(field, value);
      setValidationErrors(prev => ({
        ...prev,
        [field]: error
      }));
    }
  };

  const handleBlur = (field: string, value: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    const error = validateField(field, value);
    setValidationErrors(prev => ({
      ...prev,
      [field]: error
    }));
  };

  const handleBookingChange = (field: keyof BookingUpdateRequest, value: string | number) => {
    setBookingData(prev => ({ ...prev, [field]: value }));
  };

  const recordCheckInPayment = async () => {
    if (!booking) return;
    const paymentAmount = toMoneyNumber(amountPaid);
    const attempt = getIdempotencyAttempt(paymentAttemptRef.current, JSON.stringify({
      booking_id: typeof booking.id === 'string' ? parseInt(booking.id) : booking.id,
      amount: paymentAmount.toFixed(2),
      payment_method: paymentType,
      payment_type: 'booking',
      transaction_reference: undefined,
      notes: 'Payment collected at check-in',
      payment_date: undefined,
    }));
    paymentAttemptRef.current = attempt;
    await InvoicesService.recordPayment({
      booking_id: typeof booking.id === 'string' ? parseInt(booking.id) : booking.id,
      amount: paymentAmount,
      payment_method: paymentType,
      payment_type: 'booking',
      notes: 'Payment collected at check-in',
      idempotency_key: attempt.key,
    });
    paymentAttemptRef.current = null;
  };

  const finishCheckIn = () => {
    if (!guestData.phone?.trim() && !guestData.alt_phone?.trim()) {
      emitApiNotification({
        message: 'No phone number on file for this guest — please ask for a contact number when convenient.',
        severity: 'info',
      });
    }

    onCheckInSuccess();
    onClose();
  };

  const handleCheckIn = async () => {
    if (!booking) return;

    if (checkedInBookingPendingPayment === booking.id) {
      if (!isPositiveMoney(amountPaid)) {
        setError('Check-in is complete. Enter a valid payment amount to retry recording it.');
        setActiveTab(2);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        await recordCheckInPayment();
        setCheckedInBookingPendingPayment(null);
        finishCheckIn();
      } catch (payErr) {
        console.error('Failed to record check-in payment:', payErr);
        setError('Guest is checked in, but payment could not be recorded. Please retry.');
        setActiveTab(2);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Validate all fields
    const errors = validateForm();
    setValidationErrors(errors);

    // Mark all fields as touched
    setTouched({
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
      alt_phone: true,
      ic_number: true,
      cardNumber: true,
      cardExpiry: true,
    });

    // If there are validation errors, don't proceed
    if (Object.keys(errors).length > 0) {
      setError('Please fix the validation errors before proceeding');
      // Switch to the tab with the first error
      if (errors.first_name || errors.last_name || errors.email || errors.phone || errors.alt_phone || errors.ic_number) {
        setActiveTab(0); // General Information tab
      } else if (errors.cardNumber || errors.cardExpiry) {
        setActiveTab(2); // Payment tab
      }
      return;
    }

    if (depositChoice === 'receive' && !isPositiveMoney(depositAmount)) {
      setError('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.');
      setActiveTab(2);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Build payment/deposit fields. Don't send payment_status — the backend
      // derives it from the payments table on every read and recomputes after
      // each payment row mutation, so any value sent here would be overridden.
      const paymentFields: Record<string, any> = {};
      if (paymentChoice === 'pay_now') {
        paymentFields.amount_paid = toMoneyNumber(amountPaid);
        paymentFields.payment_method = paymentType;
      }
      if (depositChoice === 'receive') {
        paymentFields.deposit_paid = true;
        paymentFields.deposit_amount = toMoneyNumber(depositAmount);
        paymentFields.payment_note = `Deposit received (${depositMethod})`;
      } else {
        paymentFields.deposit_paid = false;
        paymentFields.deposit_amount = 0;
        paymentFields.payment_note = `Deposit waived: ${waiveReason || 'No reason provided'}`;
      }

      // Include company info if Direct Billing is selected
      const bookingUpdateWithCompany = {
        ...bookingData,
        ...paymentFields,
        special_requests: specialRequests || undefined,
        extra_bed_count: extraBedCount,
        extra_bed_charge: toMoneyNumber(extraBedCharge),
        ...(paymentType === 'Direct Billing' && selectedCompany ? {
          company_id: selectedCompany.id,
          company_name: selectedCompany.company_name,
        } : {}),
      };

      const checkinRequest: CheckInRequest = {
        guest_update: guestData,
        booking_update: bookingUpdateWithCompany,
      };

      // Online reservations auto-record a payment for the outstanding balance on
      // the backend (source === 'online'). If staff instead collect at the desk
      // ("Make Payment Now"), pass the amount as a check-in payment_record so the
      // backend records exactly that and skips its auto-settlement — preventing a
      // double charge from the separate recordPayment call below.
      const collectingOnlineAtDesk =
        isOnlineReservation && paymentChoice === 'pay_now' && isPositiveMoney(amountPaid);
      if (collectingOnlineAtDesk) {
        checkinRequest.payment_record = {
          amount: toMoneyNumber(amountPaid),
          payment_method: paymentType,
          payment_type: 'booking',
          notes: 'Payment collected at check-in',
        };
      }

      await BookingsService.checkInGuest(booking.id, checkinRequest);

      // Record payment if paying now (online desk-collection is already handled
      // above via payment_record, so skip the duplicate posting here).
      if (paymentChoice === 'pay_now' && isPositiveMoney(amountPaid) && !collectingOnlineAtDesk) {
        try {
          await recordCheckInPayment();
        } catch (payErr) {
          console.error('Failed to record check-in payment:', payErr);
          setCheckedInBookingPendingPayment(booking.id);
          setError('Guest is checked in, but payment could not be recorded. Please retry.');
          setActiveTab(2);
          return;
        }
      }

      // Company-ledger creation is now handled server-side during checkout.
      // Frontend must not create company ledger entries here to avoid duplicate
      // postings or race conditions. Leave any admin-ledger creation to the
      // dedicated ledger UI.

      finishCheckIn();
    } catch (err) {
      setError(errorMessage(err, 'Failed to check in guest'));
    } finally {
      setLoading(false);
    }
  };

  // Manual company-ledger creation from the booking UI has been removed.

  const calculateNights = () => {
    if (!booking) return 0;
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    const diffTime = Math.abs(checkOut.getTime() - checkIn.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  if (!booking || !guest) return null;

  // Online reservations are settled on the booking platform; the backend
  // auto-records a payment for the outstanding balance when `source === 'online'`.
  // Gate the messaging on that exact source so the prompt matches backend behavior.
  const isOnlineReservation = (booking.source || '').trim().toLowerCase() === 'online';
  const onlinePlatformName = getBookingChannelInfo(booking)?.name || 'the online platform';

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', pb: 2 }}>
          <Box>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              Walk-in Guest - Folio: {booking.folio_number || booking.id}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
              Room Number: {('room_number' in booking && booking.room_number) || booking.room_id} | Room Type: {booking.room_type || 'STDQ - Standard Queen'}
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {advisory?.needs_attention && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              onClose={() => setAdvisory(null)}
              action={
                advisory.suggested_company_name ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => {
                      setPaymentType('Direct Billing');
                      setDirectBillCompany(advisory.suggested_company_name as string);
                      setSelectedCompany({
                        id: advisory.suggested_company_id ?? undefined,
                        company_name: advisory.suggested_company_name as string,
                      });
                      setAdvisory(null);
                    }}
                  >
                    Bill to {advisory.suggested_company_name}
                  </Button>
                ) : undefined
              }
            >
              <AlertTitle>Use company check-in?</AlertTitle>
              {advisory.message}
            </Alert>
          )}

          {/* Booking Summary */}
          <Paper sx={{ p: 2, mb: 2, bgcolor: 'grey.50', border: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <HotelIcon color="primary" fontSize="small" />
              <Typography variant="subtitle2" sx={{
                fontWeight: 600
              }}>Booking Summary</Typography>
              <Box sx={{ flex: 1 }} />
              <Chip
                label={booking.source === 'walk_in' ? 'Walk-In' : booking.source === 'online' ? 'Online' : booking.source || 'Direct'}
                size="small"
                color={booking.source === 'walk_in' ? 'primary' : booking.source === 'online' ? 'success' : 'default'}
                sx={{ fontWeight: 600 }}
              />
            </Box>
            <Grid container spacing={1}>
              <Grid size={4}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Room</Typography>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>
                  {('room_number' in booking && booking.room_number) || booking.room_id} ({booking.room_type || 'N/A'})
                </Typography>
              </Grid>
              <Grid size={4}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Guest</Typography>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{guest.nick_name}</Typography>
                {!guest.last_name?.trim() && (
                  <Typography variant="caption" sx={{ color: "text.secondary", display: 'block' }}>
                    Booked as: {guest.nick_name}
                  </Typography>
                )}
              </Grid>
              <Grid size={4}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Folio</Typography>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{booking.folio_number || 'N/A'}</Typography>
              </Grid>
              <Grid size={12}>
                <Divider sx={{ my: 0.5 }} />
              </Grid>
              <Grid size={4}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Check-in</Typography>
                <Typography variant="body2">{booking.check_in_date}</Typography>
              </Grid>
              <Grid size={4}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Check-out</Typography>
                <Typography variant="body2">{booking.check_out_date}</Typography>
              </Grid>
              <Grid size={4}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Nights</Typography>
                <Typography variant="body2">{calculateNights()}</Typography>
              </Grid>
              <Grid size={12}>
                <Divider sx={{ my: 0.5 }} />
              </Grid>
              <Grid size={4}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Room Rate</Typography>
                <Typography variant="body2">
                  {isPositiveMoney(booking.rate_override_weekday)
                    ? `${formatCurrency(toMoneyNumber(booking.rate_override_weekday))}/night (Custom)`
                    : `${formatCurrency(divideMoney(booking.total_amount, Math.max(calculateNights(), 1)))}/night`
                  }
                </Typography>
              </Grid>
              {booking.is_tourist && isPositiveMoney(booking.tourism_tax_amount) && (
                <Grid size={4}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Tourism Tax</Typography>
                  <Typography variant="body2">{formatCurrency(toMoneyNumber(booking.tourism_tax_amount))}</Typography>
                </Grid>
              )}
              {extraBedCount > 0 && (
                <Grid size={4}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Extra Bed ({extraBedCount})</Typography>
                  <Typography variant="body2">{formatCurrency(extraBedCharge)}</Typography>
                </Grid>
              )}
              <Grid size={4}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Total Amount</Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    color: "primary.main"
                  }}>
                  {formatCurrency(toMoneyNumber(booking.total_amount))}
                </Typography>
              </Grid>
              {isPositiveMoney(booking.deposit_amount) && (
                <Grid size={4}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Deposit Paid</Typography>
                  <Typography variant="body2" sx={{
                    color: "success.main"
                  }}>{formatCurrency(toMoneyNumber(booking.deposit_amount))}</Typography>
                </Grid>
              )}
            </Grid>
          </Paper>

          <Tabs
            value={activeTab}
            onChange={(_, newValue) => {
              // Guard against tab changes during loading
              if (loading) return;
              // Ensure tab index is valid (0-4 for 5 tabs)
              if (newValue >= 0 && newValue <= 4) {
                setActiveTab(newValue);
              }
            }}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab label="General Information" />
            <Tab label="Stay Information" />
            <Tab label="Payment" />
            <Tab label="Custom Fields" />
            <Tab label="Notes" />
          </Tabs>

          {/* Tab 1: Personal Information (View Only) */}
          <TabPanel value={activeTab} index={0}>
          <PersonalInfoTab
            booking={booking}
            error={error}
            guestData={guestData}
            handleBlur={handleBlur}
            handleGuestChange={handleGuestChange}
            touched={touched}
            validationErrors={validationErrors}
          />
          </TabPanel>

          {/* Tab 2: Stay Information */}
          <TabPanel value={activeTab} index={1}>
          <StayInfoTab
            booking={booking}
            calculateNights={calculateNights}
            bookingData={bookingData}
            chargeIncidentals={chargeIncidentals}
            currencySymbol={currencySymbol}
            epiRate={epiRate}
            extraBedCount={extraBedCount}
            formatCurrency={formatCurrency}
            handleBookingChange={handleBookingChange}
            marketCodes={marketCodes}
            nextPosting={nextPosting}
            overrideRate={overrideRate}
            rateCodes={rateCodes}
            setChargeIncidentals={setChargeIncidentals}
            setEpiRate={setEpiRate}
            setNextPosting={setNextPosting}
            setOverrideRate={setOverrideRate}
            setVipGuest={setVipGuest}
            setWeekdayRate={setWeekdayRate}
            setWeekendRate={setWeekendRate}
            vipGuest={vipGuest}
            weekdayRate={weekdayRate}
            weekendRate={weekendRate}
          />
          </TabPanel>

          {/* Tab 3: Payment Information */}
          <TabPanel value={activeTab} index={2}>
          <PaymentInfoTab
            amountPaid={amountPaid}
            booking={booking}
            isOnlineReservation={isOnlineReservation}
            onlinePlatformName={onlinePlatformName}
            paymentMethods={paymentMethods}
            cardExpiry={cardExpiry}
            cardName={cardName}
            cardNumber={cardNumber}
            companyOptions={companyOptions}
            currencySymbol={currencySymbol}
            depositAmount={depositAmount}
            depositChoice={depositChoice}
            depositMethod={depositMethod}
            error={error}
            formatCurrency={formatCurrency}
            guest={guest}
            handleBlur={handleBlur}
            handleBookingChange={handleBookingChange}
            loading={loading}
            loadingCompanies={loadingCompanies}
            newCompanyData={newCompanyData}
            paymentChoice={paymentChoice}
            paymentType={paymentType}
            selectedCompany={selectedCompany}
            setAmountPaid={setAmountPaid}
            setCardExpiry={setCardExpiry}
            setCardName={setCardName}
            setCardNumber={setCardNumber}
            setDepositAmount={setDepositAmount}
            setDepositChoice={setDepositChoice}
            setDepositMethod={setDepositMethod}
            setDirectBillCompany={setDirectBillCompany}
            setNewCompanyData={setNewCompanyData}
            setNewCompanyDialogOpen={setNewCompanyDialogOpen}
            setPaymentChoice={setPaymentChoice}
            setPaymentType={setPaymentType}
            setSelectedCompany={setSelectedCompany}
            setShowCardNumber={setShowCardNumber}
            setValidationErrors={setValidationErrors}
            setWaiveReason={setWaiveReason}
            showCardNumber={showCardNumber}
            touched={touched}
            validateField={validateField}
            validationErrors={validationErrors}
            waiveReason={waiveReason}
          />
          </TabPanel>

          {/* Tab 4: Custom Fields */}
          <TabPanel value={activeTab} index={3}>
          <CustomFieldsTab
            allowsExtraBed={allowsExtraBed}
            maxExtraBeds={maxExtraBeds}
            extraBedChargePerBed={extraBedChargePerBed}
            booking={booking}
            carPlateNo={carPlateNo}
            currencySymbol={currencySymbol}
            driversInfo={driversInfo}
            eta={eta}
            extraBedCharge={extraBedCharge}
            extraBedCount={extraBedCount}
            formatCurrency={formatCurrency}
            groupCode={groupCode}
            language={language}
            setCarPlateNo={setCarPlateNo}
            setDriversInfo={setDriversInfo}
            setEta={setEta}
            setExtraBedCharge={setExtraBedCharge}
            setExtraBedCount={setExtraBedCount}
            setGroupCode={setGroupCode}
            setLanguage={setLanguage}
            setTravelAgent1={setTravelAgent1}
            setTravelAgent2={setTravelAgent2}
            travelAgent1={travelAgent1}
            travelAgent2={travelAgent2}
          />
          </TabPanel>

          {/* Tab 5: Notes */}
          <TabPanel value={activeTab} index={4}>
          <NotesTab
            booking={booking}
            setSpecialRequests={setSpecialRequests}
            specialRequests={specialRequests}
          />
          </TabPanel>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', justifyContent: 'space-between' }}>
          <Box>
            <Button onClick={onClose} disabled={loading} sx={{ mr: 1 }}>
              Cancel
            </Button>
          </Box>
          <Box>
            {/* Company Ledger creation removed — handled by backend or admin UI */}
            <Button
              variant="contained"
              onClick={handleCheckIn}
              disabled={loading}
              startIcon={loading && <CircularProgress size={20} />}
              size="large"
              sx={{ minWidth: 120 }}
            >
              {loading ? 'Processing...' : 'Check In'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
      {/* New Company Registration Dialog */}
      <Dialog open={newCompanyDialogOpen} onClose={() => setNewCompanyDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1
            }}>
            <PersonAddIcon color="primary" />
            Register New Company
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            This company is not in our system. Please provide the company details below.
          </Alert>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={12}>
              <TextField
                fullWidth
                required
                label="Company Name"
                value={newCompanyData.company_name}
                onChange={(e) => setNewCompanyData({ ...newCompanyData, company_name: e.target.value })}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Registration Number"
                value={newCompanyData.company_registration_number || ''}
                onChange={(e) => setNewCompanyData({ ...newCompanyData, company_registration_number: e.target.value })}
                placeholder="e.g., 123456-A"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Contact Person"
                value={newCompanyData.contact_person || ''}
                onChange={(e) => setNewCompanyData({ ...newCompanyData, contact_person: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Contact Email"
                type="email"
                value={newCompanyData.contact_email || ''}
                onChange={(e) => setNewCompanyData({ ...newCompanyData, contact_email: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Contact Phone"
                value={newCompanyData.contact_phone || ''}
                onChange={(e) => setNewCompanyData({ ...newCompanyData, contact_phone: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Billing Address"
                value={newCompanyData.billing_address || ''}
                onChange={(e) => setNewCompanyData({ ...newCompanyData, billing_address: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewCompanyDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleRegisterNewCompany}
            variant="contained"
            startIcon={<PersonAddIcon />}
            disabled={!newCompanyData.company_name}
          >
            Register Company
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
