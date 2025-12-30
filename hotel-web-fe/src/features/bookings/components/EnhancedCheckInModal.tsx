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
  Checkbox,
  FormControlLabel,
  Divider,
  Paper,
  InputAdornment,
  IconButton,
  FormHelperText,
  Autocomplete,
  Snackbar,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Search as SearchIcon,
  PersonAdd as PersonAddIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { HotelAPIService, LedgerService } from '../../../api';
import {
  Booking,
  Guest,
  CheckInRequest,
  GuestUpdateRequest,
  BookingUpdateRequest,
  RateCodesResponse,
  MarketCodesResponse,
  CustomerLedgerCreateRequest
} from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';

// Validation helper functions
const validateEmail = (email: string): boolean => {
  if (!email) return true; // Optional field
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePhone = (phone: string): boolean => {
  if (!phone) return true; // Optional field
  // Malaysian phone format: +60XXXXXXXXX, 60XXXXXXXXX, 0XXXXXXXXX, or just digits
  const phoneRegex = /^(\+?60|0)?[0-9]{8,11}$/;
  return phoneRegex.test(phone.replace(/[\s-]/g, ''));
};

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

interface ValidationErrors {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  alt_phone?: string;
  ic_number?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardName?: string;
}

// Company option for autocomplete
interface CompanyOption {
  id?: number;
  inputValue?: string;
  company_name: string;
  registration_number?: string;
  company_registration_number?: string; // Alias for backwards compatibility
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  payment_terms_days?: number;
  isNew?: boolean;
}

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
  booking: Booking | null;
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
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if form has been initialized to prevent re-initialization
  const initializedRef = useRef<{ bookingId: string | null; guestId: number | null }>({ bookingId: null, guestId: null });

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
  const [paymentType, setPaymentType] = useState('Cash');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardName, setCardName] = useState('');
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [directBillCompany, setDirectBillCompany] = useState('');
  const [driversInfo, setDriversInfo] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [language, setLanguage] = useState('Default Language (English)');
  const [travelAgent1, setTravelAgent1] = useState('');
  const [travelAgent2, setTravelAgent2] = useState('');
  const [carPlateNo, setCarPlateNo] = useState('');
  const [eta, setEta] = useState('');

  // Company autocomplete state
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyOption | null>(null);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

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

  // Snackbar for notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  // Company Ledger state
  const [creatingLedger, setCreatingLedger] = useState(false);

  // Dropdowns data
  const [rateCodes, setRateCodes] = useState<string[]>([]);
  const [marketCodes, setMarketCodes] = useState<string[]>([]);
  const [titleOptions] = useState(['Mr', 'Mrs', 'Ms', 'Dr', 'Prof']);
  const [paymentMethods] = useState(['Cash', 'Credit Card', 'Debit Card', 'DuitNow', 'Online Banking', 'E-Wallet', 'Direct Billing']);
  const [contactTypes] = useState(['Mobile', 'Home', 'Work', 'Fax']);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      initializedRef.current = { bookingId: null, guestId: null };
      setValidationErrors({});
      setTouched({});
      setActiveTab(0);
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
        initializedRef.current = { bookingId: booking.id, guestId: guest.id };
      }
    }
  }, [open, booking?.id, guest?.id]);

  const loadDropdownData = async () => {
    try {
      const [ratesResp, marketsResp] = await Promise.all([
        HotelAPIService.getRateCodes(),
        HotelAPIService.getMarketCodes(),
      ]);
      setRateCodes(ratesResp.rate_codes);
      setMarketCodes(marketsResp.market_codes);
    } catch (err) {
      console.error('Failed to load dropdown data:', err);
    }
  };

  // Load companies from database for autocomplete
  const loadCompanies = async () => {
    try {
      setLoadingCompanies(true);
      const companies = await HotelAPIService.getCompanies({ is_active: true });
      const companyOptions: CompanyOption[] = companies.map((company: any) => ({
        company_name: company.company_name,
        company_registration_number: company.registration_number,
        contact_person: company.contact_person,
        contact_email: company.contact_email,
        contact_phone: company.contact_phone,
        billing_address: company.billing_address,
      }));
      setCompanyOptions(companyOptions);
    } catch (err) {
      console.error('Failed to load companies:', err);
    } finally {
      setLoadingCompanies(false);
    }
  };

  // Handle registering a new company
  const handleRegisterNewCompany = async () => {
    try {
      // Save to database
      const createdCompany = await HotelAPIService.createCompany({
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
      setSnackbarMessage(`Company "${newCompany.company_name}" registered successfully!`);
      setSnackbarOpen(true);

      // Reset new company form
      setNewCompanyData({
        company_name: '',
        company_registration_number: '',
        contact_person: '',
        contact_email: '',
        contact_phone: '',
        billing_address: '',
      });
    } catch (err: any) {
      console.error('Failed to register company:', err);
      setSnackbarMessage(err?.message || 'Failed to register company');
      setSnackbarOpen(true);
    }
  };

  const initializeFormData = () => {
    if (!guest || !booking) return;

    // Parse full_name into first and last name
    const nameParts = guest.full_name?.split(' ') || [];
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    setGuestData({
      first_name: firstName,
      last_name: lastName,
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

    setBookingData({
      market_code: booking.market_code || 'WKII',
      rate_code: booking.rate_code || 'RACK',
      payment_method: booking.payment_method || 'Cash',
      check_in_time: booking.check_in_time || '15:00',
      check_out_time: booking.check_out_time || '11:00',
    });
  };

  // Validate a single field
  const validateField = useCallback((field: string, value: string): string | undefined => {
    switch (field) {
      case 'first_name':
        if (!value || !value.trim()) return 'First name is required';
        if (value.trim().length < 2) return 'First name must be at least 2 characters';
        return undefined;
      case 'email':
        if (value && !validateEmail(value)) return 'Please enter a valid email address';
        return undefined;
      case 'phone':
        if (value && !validatePhone(value)) return 'Please enter a valid phone number';
        return undefined;
      case 'alt_phone':
        if (value && !validatePhone(value)) return 'Please enter a valid phone number';
        return undefined;
      case 'ic_number':
        if (value && !validateICNumber(value)) return 'Please enter a valid IC/Passport number';
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

    // Required field: first_name
    const firstNameError = validateField('first_name', guestData.first_name || '');
    if (firstNameError) errors.first_name = firstNameError;

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
    if (paymentType === 'Credit Card' || paymentType === 'Debit Card') {
      const cardNumError = validateField('cardNumber', cardNumber);
      if (cardNumError) errors.cardNumber = cardNumError;

      const cardExpError = validateField('cardExpiry', cardExpiry);
      if (cardExpError) errors.cardExpiry = cardExpError;
    }

    return errors;
  }, [guestData, paymentType, cardNumber, cardExpiry, validateField]);

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

  const handleCheckIn = async () => {
    if (!booking) return;

    // Validate all fields
    const errors = validateForm();
    setValidationErrors(errors);

    // Mark all fields as touched
    setTouched({
      first_name: true,
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
      if (errors.first_name || errors.email || errors.phone || errors.alt_phone || errors.ic_number) {
        setActiveTab(0); // General Information tab
      } else if (errors.cardNumber || errors.cardExpiry) {
        setActiveTab(2); // Payment tab
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Include company info if Direct Billing is selected
      const bookingUpdateWithCompany = {
        ...bookingData,
        ...(paymentType === 'Direct Billing' && selectedCompany ? {
          company_id: selectedCompany.id,
          company_name: selectedCompany.company_name,
        } : {}),
      };

      const checkinRequest: CheckInRequest = {
        guest_update: guestData,
        booking_update: bookingUpdateWithCompany,
      };

      await HotelAPIService.checkInGuest(booking.id, checkinRequest);
      onCheckInSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to check in guest');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCompanyLedger = async () => {
    if (!booking || !selectedCompany) {
      setError('Please select a company for Direct Billing first');
      return;
    }

    setCreatingLedger(true);
    setError(null);

    try {
      const totalAmount = typeof booking.total_amount === 'string'
        ? parseFloat(booking.total_amount)
        : booking.total_amount;

      const ledgerData: CustomerLedgerCreateRequest = {
        company_name: selectedCompany.company_name,
        company_registration_number: selectedCompany.registration_number,
        contact_person: selectedCompany.contact_person,
        contact_email: selectedCompany.contact_email,
        contact_phone: selectedCompany.contact_phone,
        billing_address_line1: selectedCompany.billing_address,
        billing_city: selectedCompany.billing_city,
        billing_state: selectedCompany.billing_state,
        billing_postal_code: selectedCompany.billing_postal_code,
        billing_country: selectedCompany.billing_country,
        description: `Room charge for booking ${booking.booking_number || booking.id} - ${guest?.full_name || 'Guest'}`,
        expense_type: 'accommodation',
        amount: totalAmount || 0,
        booking_id: typeof booking.id === 'string' ? parseInt(booking.id) : booking.id,
        guest_id: typeof booking.guest_id === 'string' ? parseInt(booking.guest_id) : booking.guest_id,
        due_date: format(new Date(new Date().getTime() + (selectedCompany.payment_terms_days || 30) * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
        folio_type: 'city_ledger',
        transaction_type: 'debit',
        post_type: 'room_charge',
        room_number: (booking as any).room_number || String(booking.room_id),
      };

      await LedgerService.createCustomerLedger(ledgerData);
      setSnackbarMessage(`Company ledger created for ${selectedCompany.company_name}`);
      setSnackbarOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to create company ledger');
    } finally {
      setCreatingLedger(false);
    }
  };

  const calculateNights = () => {
    if (!booking) return 0;
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    const diffTime = Math.abs(checkOut.getTime() - checkIn.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getDayOfWeek = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'EEEE');
    } catch {
      return '';
    }
  };

  if (!booking || !guest) return null;

  return (
    <>
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', pb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            Walk-in Guest - Folio: {booking.folio_number || booking.id}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
            Room Number: {booking.room_id} | Room Type: {booking.room_type || 'STDQ - Standard Queen'}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)} variant="scrollable" scrollButtons="auto">
          <Tab label="General Information" />
          <Tab label="Stay Information" />
          <Tab label="Payment" />
          <Tab label="Custom Fields" />
          <Tab label="Notes" />
        </Tabs>

        {/* Tab 1: Personal Information */}
        <TabPanel value={activeTab} index={0}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth>
                <InputLabel>Title</InputLabel>
                <Select
                  value={guestData.title || ''}
                  onChange={(e) => handleGuestChange('title', e.target.value)}
                  label="Title"
                >
                  {titleOptions.map(title => (
                    <MenuItem key={title} value={title}>{title}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4.5}>
              <TextField
                fullWidth
                label="First Name"
                value={guestData.first_name || ''}
                onChange={(e) => handleGuestChange('first_name', e.target.value)}
                onBlur={(e) => handleBlur('first_name', e.target.value)}
                error={touched.first_name && !!validationErrors.first_name}
                helperText={touched.first_name && validationErrors.first_name}
                required
              />
            </Grid>
            <Grid item xs={12} sm={4.5}>
              <TextField
                fullWidth
                label="Last Name"
                value={guestData.last_name || ''}
                onChange={(e) => handleGuestChange('last_name', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={guestData.email || ''}
                onChange={(e) => handleGuestChange('email', e.target.value)}
                onBlur={(e) => handleBlur('email', e.target.value)}
                error={touched.email && !!validationErrors.email}
                helperText={touched.email && validationErrors.email}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Phone 1"
                value={guestData.phone || ''}
                onChange={(e) => handleGuestChange('phone', e.target.value)}
                onBlur={(e) => handleBlur('phone', e.target.value)}
                error={touched.phone && !!validationErrors.phone}
                helperText={(touched.phone && validationErrors.phone) || 'Format: +60XXXXXXXXX or 0XXXXXXXXX'}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Phone 2"
                value={guestData.alt_phone || ''}
                onChange={(e) => handleGuestChange('alt_phone', e.target.value)}
                onBlur={(e) => handleBlur('alt_phone', e.target.value)}
                error={touched.alt_phone && !!validationErrors.alt_phone}
                helperText={touched.alt_phone && validationErrors.alt_phone}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Reference/IC Number"
                value={guestData.ic_number || ''}
                onChange={(e) => handleGuestChange('ic_number', e.target.value)}
                onBlur={(e) => handleBlur('ic_number', e.target.value)}
                error={touched.ic_number && !!validationErrors.ic_number}
                helperText={(touched.ic_number && validationErrors.ic_number) || 'IC: YYMMDD-SS-NNNN or Passport'}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Street Address"
                value={guestData.address_line1 || ''}
                onChange={(e) => handleGuestChange('address_line1', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="City"
                value={guestData.city || ''}
                onChange={(e) => handleGuestChange('city', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="State/Province"
                value={guestData.state_province || ''}
                onChange={(e) => handleGuestChange('state_province', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Zip Code"
                value={guestData.postal_code || ''}
                onChange={(e) => handleGuestChange('postal_code', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Country"
                value={guestData.country || ''}
                onChange={(e) => handleGuestChange('country', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Nationality"
                value={guestData.nationality || ''}
                onChange={(e) => handleGuestChange('nationality', e.target.value)}
              />
            </Grid>
          </Grid>
        </TabPanel>

        {/* Tab 2: Stay Information */}
        <TabPanel value={activeTab} index={1}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Check-in/Check-out
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Check-in Date"
                type="date"
                value={booking.check_in_date}
                disabled
                InputLabelProps={{ shrink: true }}
                helperText={getDayOfWeek(booking.check_in_date)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Check-in Time"
                type="time"
                value={bookingData.check_in_time || '15:00'}
                onChange={(e) => handleBookingChange('check_in_time', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Nights"
                value={calculateNights()}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Check-out Date"
                type="date"
                value={booking.check_out_date}
                disabled
                InputLabelProps={{ shrink: true }}
                helperText={getDayOfWeek(booking.check_out_date)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Check-out Time"
                type="time"
                value={bookingData.check_out_time || '11:00'}
                onChange={(e) => handleBookingChange('check_out_time', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Adults"
                type="number"
                value={booking.number_of_guests || 1}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Children"
                type="number"
                value={booking.extra_bed_count || 0}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Room Number"
                value={booking.room_id}
                disabled
              />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
                Rate & Charges
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Rate Code</InputLabel>
                <Select
                  value={bookingData.rate_code || 'RACK'}
                  onChange={(e) => handleBookingChange('rate_code', e.target.value)}
                  label="Rate Code"
                >
                  {rateCodes.map(code => (
                    <MenuItem key={code} value={code}>{code} - Standard Rack Rate</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Discount %"
                type="number"
                value={bookingData.discount_percentage || 0}
                onChange={(e) => handleBookingChange('discount_percentage', parseFloat(e.target.value))}
                InputProps={{ inputProps: { min: 0, max: 100, step: 0.01 } }}
              />
            </Grid>

            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Weekday Rate"
                type="number"
                value={weekdayRate}
                onChange={(e) => setWeekdayRate(e.target.value)}
                disabled={!overrideRate}
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Weekend Rate"
                type="number"
                value={weekendRate}
                onChange={(e) => setWeekendRate(e.target.value)}
                disabled={!overrideRate}
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={overrideRate}
                    onChange={(e) => setOverrideRate(e.target.checked)}
                  />
                }
                label="Override Rate"
              />
            </Grid>

            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Room Charge Summary
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Total Amount:</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" fontWeight="bold">{formatCurrency(Number(booking.total_amount))}</Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
                Special Posting
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>

            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="EPI Rate"
                type="number"
                value={epiRate}
                onChange={(e) => setEpiRate(Number(e.target.value))}
                InputProps={{ inputProps: { min: 1, step: 1 } }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Next Posting"
                value={nextPosting}
                onChange={(e) => setNextPosting(e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={4} sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={chargeIncidentals}
                    onChange={(e) => setChargeIncidentals(e.target.checked)}
                  />
                }
                label="Charge Incidentals"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={vipGuest}
                    onChange={(e) => setVipGuest(e.target.checked)}
                  />
                }
                label="VIP Guest"
              />
            </Grid>
          </Grid>
        </TabPanel>

        {/* Tab 3: Payment Information */}
        <TabPanel value={activeTab} index={2}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Payment Method
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Payment Type</InputLabel>
                <Select
                  value={paymentType}
                  onChange={(e) => {
                    setPaymentType(e.target.value);
                    handleBookingChange('payment_method', e.target.value);
                  }}
                  label="Payment Type"
                >
                  {paymentMethods.map(method => (
                    <MenuItem key={method} value={method}>{method}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {(paymentType === 'Credit Card' || paymentType === 'Debit Card') && (
              <>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
                    Card Information
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Card Number"
                    type={showCardNumber ? 'text' : 'password'}
                    value={cardNumber}
                    onChange={(e) => {
                      setCardNumber(e.target.value);
                      if (touched.cardNumber) {
                        const error = validateField('cardNumber', e.target.value);
                        setValidationErrors(prev => ({ ...prev, cardNumber: error }));
                      }
                    }}
                    onBlur={(e) => handleBlur('cardNumber', e.target.value)}
                    error={touched.cardNumber && !!validationErrors.cardNumber}
                    helperText={touched.cardNumber && validationErrors.cardNumber}
                    placeholder="•••••"
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowCardNumber(!showCardNumber)}
                            edge="end"
                          >
                            {showCardNumber ? <VisibilityOffIcon /> : <VisibilityIcon />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Expire Date"
                    placeholder="MM/YY"
                    value={cardExpiry}
                    onChange={(e) => {
                      setCardExpiry(e.target.value);
                      if (touched.cardExpiry) {
                        const error = validateField('cardExpiry', e.target.value);
                        setValidationErrors(prev => ({ ...prev, cardExpiry: error }));
                      }
                    }}
                    onBlur={(e) => handleBlur('cardExpiry', e.target.value)}
                    error={touched.cardExpiry && !!validationErrors.cardExpiry}
                    helperText={(touched.cardExpiry && validationErrors.cardExpiry) || 'Format: MM/YY'}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Name on Card"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                  />
                </Grid>
              </>
            )}

            {paymentType === 'Direct Billing' && (
              <>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
                    Direct Billing Information
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                </Grid>
                <Grid item xs={12}>
                  <Autocomplete
                    value={selectedCompany}
                    onChange={(event, newValue) => {
                      if (newValue) {
                        if (newValue.isNew) {
                          // User selected "Add new company" option
                          setNewCompanyData({ ...newCompanyData, company_name: newValue.inputValue || '' });
                          setNewCompanyDialogOpen(true);
                        } else {
                          // User selected an existing company
                          setSelectedCompany(newValue);
                          setDirectBillCompany(newValue.company_name);
                        }
                      } else {
                        setSelectedCompany(null);
                        setDirectBillCompany('');
                      }
                    }}
                    filterOptions={(options, state) => {
                      const inputValue = state.inputValue.toLowerCase();
                      const filtered = options.filter(option =>
                        option.company_name.toLowerCase().includes(inputValue)
                      );
                      // Suggest creating a new company if no exact match
                      const isExisting = options.some(option =>
                        option.company_name.toLowerCase() === inputValue
                      );
                      if (inputValue !== '' && !isExisting) {
                        filtered.push({
                          inputValue: state.inputValue,
                          company_name: `Add "${state.inputValue}" as new company`,
                          isNew: true,
                        });
                      }
                      return filtered;
                    }}
                    selectOnFocus
                    clearOnBlur
                    handleHomeEndKeys
                    options={companyOptions}
                    loading={loadingCompanies}
                    getOptionLabel={(option) => option.isNew ? option.inputValue || '' : option.company_name}
                    isOptionEqualToValue={(option, value) => option.company_name === value.company_name}
                    renderOption={(props, option) => {
                      const { key, ...otherProps } = props;
                      return (
                        <li key={key} {...otherProps}>
                          {option.isNew ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <PersonAddIcon color="primary" fontSize="small" />
                              <Typography color="primary">{option.company_name}</Typography>
                            </Box>
                          ) : (
                            <Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <BusinessIcon color="action" fontSize="small" />
                                <Typography>{option.company_name}</Typography>
                              </Box>
                              {option.contact_person && (
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 3.5 }}>
                                  Contact: {option.contact_person}
                                </Typography>
                              )}
                            </Box>
                          )}
                        </li>
                      );
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Company"
                        placeholder="Type to search or add new company"
                        helperText="Select existing company or type new name to register"
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {loadingCompanies ? <CircularProgress color="inherit" size={20} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                  />
                </Grid>
                {selectedCompany && !selectedCompany.isNew && (
                  <Grid item xs={12}>
                    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                      <Typography variant="subtitle2" gutterBottom>
                        Company Details
                      </Typography>
                      <Grid container spacing={1}>
                        {selectedCompany.company_registration_number && (
                          <>
                            <Grid item xs={4}>
                              <Typography variant="caption" color="text.secondary">Reg. No:</Typography>
                            </Grid>
                            <Grid item xs={8}>
                              <Typography variant="body2">{selectedCompany.company_registration_number}</Typography>
                            </Grid>
                          </>
                        )}
                        {selectedCompany.contact_person && (
                          <>
                            <Grid item xs={4}>
                              <Typography variant="caption" color="text.secondary">Contact:</Typography>
                            </Grid>
                            <Grid item xs={8}>
                              <Typography variant="body2">{selectedCompany.contact_person}</Typography>
                            </Grid>
                          </>
                        )}
                        {selectedCompany.contact_email && (
                          <>
                            <Grid item xs={4}>
                              <Typography variant="caption" color="text.secondary">Email:</Typography>
                            </Grid>
                            <Grid item xs={8}>
                              <Typography variant="body2">{selectedCompany.contact_email}</Typography>
                            </Grid>
                          </>
                        )}
                        {selectedCompany.contact_phone && (
                          <>
                            <Grid item xs={4}>
                              <Typography variant="caption" color="text.secondary">Phone:</Typography>
                            </Grid>
                            <Grid item xs={8}>
                              <Typography variant="body2">{selectedCompany.contact_phone}</Typography>
                            </Grid>
                          </>
                        )}
                      </Grid>
                    </Paper>
                  </Grid>
                )}
              </>
            )}

            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
                Guest Identification
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Nationality"
                value={guestData.nationality || ''}
                onChange={(e) => handleGuestChange('nationality', e.target.value)}
                placeholder="@SAR - Sarawak"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small">
                        <SearchIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Passport or IC #"
                value={guestData.ic_number || ''}
                onChange={(e) => handleGuestChange('ic_number', e.target.value)}
                placeholder="1234"
              />
            </Grid>
          </Grid>
        </TabPanel>

        {/* Tab 4: Custom Fields */}
        <TabPanel value={activeTab} index={3}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Guest Vehicles
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Car Plate No."
                value={carPlateNo}
                onChange={(e) => setCarPlateNo(e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="ETA"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                placeholder="Estimated Time of Arrival"
              />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
                Travel Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Group Code"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small">
                        <SearchIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Language</InputLabel>
                <Select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  label="Language"
                >
                  <MenuItem value="Default Language (English)">Default Language (English)</MenuItem>
                  <MenuItem value="Bahasa Malaysia">Bahasa Malaysia</MenuItem>
                  <MenuItem value="Mandarin">Mandarin</MenuItem>
                  <MenuItem value="Tamil">Tamil</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Travel Agent 1"
                value={travelAgent1}
                onChange={(e) => setTravelAgent1(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small">
                        <SearchIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Travel Agent 2"
                value={travelAgent2}
                onChange={(e) => setTravelAgent2(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small">
                        <SearchIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Drivers Info"
                value={driversInfo}
                onChange={(e) => setDriversInfo(e.target.value)}
                multiline
                rows={2}
              />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
                Special Charges
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Tourism Tax"
                value={booking.tourism_tax_amount || 0}
                disabled
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Room Card Deposit"
                value={booking.room_card_deposit || 0}
                disabled
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Extra Bed Count"
                type="number"
                value={booking.extra_bed_count || 0}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Extra Bed Charge"
                value={booking.extra_bed_charge || 0}
                disabled
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
              />
            </Grid>
          </Grid>
        </TabPanel>

        {/* Tab 5: Notes */}
        <TabPanel value={activeTab} index={4}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Special Requests
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Special Requests"
                multiline
                rows={4}
                value={booking.special_requests || ''}
                disabled
                helperText="Special requests from booking"
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
                Check-in Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>
            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: 'info.50', borderLeft: 4, borderColor: 'info.main' }}>
                <Typography variant="body2">
                  <strong>Confirmation Number:</strong> {booking.folio_number || 'N/A'}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>Status:</strong> {booking.status.toUpperCase()}
                </Typography>
                {booking.pre_checkin_completed && (
                  <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                    ✓ Pre-check-in completed
                  </Typography>
                )}
              </Paper>
            </Grid>
          </Grid>
        </TabPanel>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', justifyContent: 'space-between' }}>
        <Box>
          <Button onClick={onClose} disabled={loading} sx={{ mr: 1 }}>
            Cancel
          </Button>
        </Box>
        <Box>
          <Button
            variant="outlined"
            disabled={loading || creatingLedger || paymentType !== 'Direct Billing' || !selectedCompany}
            onClick={handleCreateCompanyLedger}
            sx={{ mr: 1 }}
            startIcon={creatingLedger ? <CircularProgress size={16} /> : <BusinessIcon />}
          >
            {creatingLedger ? 'Creating...' : 'Company Ledger'}
          </Button>
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
        <Box display="flex" alignItems="center" gap={1}>
          <PersonAddIcon color="primary" />
          Register New Company
        </Box>
      </DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          This company is not in our system. Please provide the company details below.
        </Alert>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              required
              label="Company Name"
              value={newCompanyData.company_name}
              onChange={(e) => setNewCompanyData({ ...newCompanyData, company_name: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Registration Number"
              value={newCompanyData.company_registration_number || ''}
              onChange={(e) => setNewCompanyData({ ...newCompanyData, company_registration_number: e.target.value })}
              placeholder="e.g., 123456-A"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Contact Person"
              value={newCompanyData.contact_person || ''}
              onChange={(e) => setNewCompanyData({ ...newCompanyData, contact_person: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Contact Email"
              type="email"
              value={newCompanyData.contact_email || ''}
              onChange={(e) => setNewCompanyData({ ...newCompanyData, contact_email: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Contact Phone"
              value={newCompanyData.contact_phone || ''}
              onChange={(e) => setNewCompanyData({ ...newCompanyData, contact_phone: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
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
    </>
  );
}
