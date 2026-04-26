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
  Paper,
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
  IconButton,
  Grid,
  FormControl,
  InputLabel,
  Select,
  InputAdornment,
  TableSortLabel,
  Tabs,
  Tab,
  Divider,
  List,
  ListItem,
  ListItemText,
  Autocomplete,
  Checkbox,
  FormControlLabel,
  Pagination,
  Stack,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
  Payment as PaymentIcon,
  Receipt as ReceiptIcon,
  Business as BusinessIcon,
  AttachMoney as MoneyIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Print as PrintIcon,
  PersonAdd as PersonAddIcon,
  Login as CheckInIcon,
  Logout as CheckOutIcon,
  Hotel as HotelIcon,
  Person as PersonIcon,
  Download as DownloadIcon,
  Description as InvoiceIcon,
  NavigateBefore as PrevIcon,
  NavigateNext as NextIcon,
  Visibility as ViewIcon,
  Save as SaveIcon,
  Close as CloseIcon,
  Block as VoidIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { api } from '../../../api/client';
import {
  CustomerLedger,
  CustomerLedgerCreateRequest,
  CustomerLedgerUpdateRequest,
  CustomerLedgerPayment,
  CustomerLedgerPaymentRequest,
  CustomerLedgerSummary,
  Room,
  Guest,
  BookingWithDetails,
} from '../../../types';
import { Company } from '../../../api/companies.service';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings, HotelSettings } from '../../../utils/hotelSettings';
import CheckoutInvoiceModal from '../../invoices/components/CheckoutInvoiceModal';
import { enhanceBookingDetails } from '../../../utils/bookingUtils';
import { useLedgers, SortField, SortOrder, PAGE_SIZE } from '../hooks/useLedgers';

// Company option for autocomplete
interface CompanyOption {
  inputValue?: string;
  company_name: string;
  company_registration_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address_line1?: string;
  isNew?: boolean;
}

const EXPENSE_TYPES = [
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'food_beverage', label: 'Food & Beverage' },
  { value: 'conference', label: 'Conference' },
  { value: 'service', label: 'Service' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Credit/Debit Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'duitnow', label: 'DuitNow' },
  { value: 'online_banking', label: 'Online Banking' },
  { value: 'cheque', label: 'Cheque' },
];

// Date-only ISO 8601 (YYYY-MM-DD): date columns from the backend arrive
// without a time/offset. Plain `new Date("YYYY-MM-DD")` parses as UTC midnight,
// which shifts the date by one day in UTC-negative timezones; build the Date
// in local time instead.
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatDateForInput = (dateString: string | null | undefined): string => {
  if (!dateString) return '';
  if (DATE_ONLY_RE.test(dateString)) return dateString;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
};

const formatDateForDisplay = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const m = DATE_ONLY_RE.exec(dateString);
    const date = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '-';
  }
};

const getStatusColor = (status: string): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
  switch (status) {
    case 'paid':
      return 'success';
    case 'partial':
      return 'warning';
    case 'pending':
      return 'info';
    case 'overdue':
      return 'error';
    default:
      return 'default';
  }
};

const getStatusText = (status: string): string => {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'partial':
      return 'Partial';
    case 'pending':
      return 'Pending';
    case 'overdue':
      return 'Overdue';
    default:
      return status;
  }
};

const CustomerLedgerPage: React.FC = () => {
  const { symbol: currencySymbol, format: formatCurrency } = useCurrency();
  const [hotelSettings, setHotelSettings] = useState<HotelSettings>(getHotelSettings());
  const {
    ledgers,
    summary,
    loading,
    error,
    setError,
    reload: loadData,
    totalLedgers,
    currentPage,
    setCurrentPage,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    expenseTypeFilter,
    setExpenseTypeFilter,
    sortField,
    sortOrder,
    handleSort,
    clearFilters,
  } = useLedgers();

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFormData, setCreateFormData] = useState<CustomerLedgerCreateRequest>({
    company_name: '',
    description: '',
    expense_type: 'accommodation',
    amount: 0,
  });

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingLedger, setEditingLedger] = useState<CustomerLedger | null>(null);
  const [editFormData, setEditFormData] = useState<CustomerLedgerUpdateRequest>({});
  const [updating, setUpdating] = useState(false);

  // Void dialog state (mirrors normal booking void flow)
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingLedger, setVoidingLedger] = useState<CustomerLedger | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Read-only invoice modal state (for ledger entries linked to a checked-out booking)
  const [ledgerInvoiceOpen, setLedgerInvoiceOpen] = useState(false);
  const [ledgerInvoiceBooking, setLedgerInvoiceBooking] = useState<BookingWithDetails | null>(null);
  const [loadingLedgerInvoice, setLoadingLedgerInvoice] = useState(false);

  // Payment dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentLedger, setPaymentLedger] = useState<CustomerLedger | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<CustomerLedgerPayment[]>([]);
  const [paymentTab, setPaymentTab] = useState(0);
  const [paymentFormData, setPaymentFormData] = useState<CustomerLedgerPaymentRequest>({
    payment_amount: 0,
    payment_method: 'cash',
    payment_date: new Date().toISOString().split('T')[0],
  });
  const [processingPayment, setProcessingPayment] = useState(false);

  // Company autocomplete state
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyOption | null>(null);

  // New company registration dialog
  const [newCompanyDialogOpen, setNewCompanyDialogOpen] = useState(false);
  const [newCompanyData, setNewCompanyData] = useState<CompanyOption>({
    company_name: '',
    company_registration_number: '',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    billing_address_line1: '',
  });

  // Print statement dialog
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printingCompany, setPrintingCompany] = useState<string | null>(null);
  const [companyLedgerEntries, setCompanyLedgerEntries] = useState<CustomerLedger[]>([]);

  // Receipt review state (one-by-one navigation)
  const [currentReceiptIndex, setCurrentReceiptIndex] = useState(0);

  // Notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  // Payment date edit state
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [editingPaymentDate, setEditingPaymentDate] = useState<string>('');
  const [savingPaymentDate, setSavingPaymentDate] = useState(false);

  // Company Check-In state
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [companyBookings, setCompanyBookings] = useState<BookingWithDetails[]>([]);
  const [allCompanyBookings, setAllCompanyBookings] = useState<BookingWithDetails[]>([]);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [checkoutBooking, setCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const [checkInCompany, setCheckInCompany] = useState<Company | null>(null);
  const [checkInGuest, setCheckInGuest] = useState<Guest | null>(null);
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [checkInDate, setCheckInDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [checkOutDate, setCheckOutDate] = useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [processingCheckIn, setProcessingCheckIn] = useState(false);
  const [isCreatingNewCheckInGuest, setIsCreatingNewCheckInGuest] = useState(false);
  const [newCheckInGuestForm, setNewCheckInGuestForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    ic_number: '',
    nationality: '',
    address_line1: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: '',
  });

  // Company Registration state
  const [companyRegDialogOpen, setCompanyRegDialogOpen] = useState(false);
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [companyRegForm, setCompanyRegForm] = useState({
    company_name: '',
    registration_number: '',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    billing_address: '',
    billing_city: '',
    billing_state: '',
    billing_postal_code: '',
    credit_limit: '',
    payment_terms_days: '30',
    notes: '',
  });

  // Company Edit state
  const [companyEditDialogOpen, setCompanyEditDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [updatingCompany, setUpdatingCompany] = useState(false);
  const [companyEditForm, setCompanyEditForm] = useState({
    company_name: '',
    registration_number: '',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    billing_address: '',
    billing_city: '',
    billing_state: '',
    billing_postal_code: '',
    credit_limit: '',
    payment_terms_days: '30',
    notes: '',
  });

  // Company Delete state
  const [companyDeleteDialogOpen, setCompanyDeleteDialogOpen] = useState(false);
  const [deletingCompanyData, setDeletingCompanyData] = useState<Company | null>(null);
  const [deletingCompany, setDeletingCompany] = useState(false);

  // Company Payment state
  const [companyPaymentDialogOpen, setCompanyPaymentDialogOpen] = useState(false);
  const [paymentCompany, setPaymentCompany] = useState<Company | null>(null);
  const [paymentCompanyLedgers, setPaymentCompanyLedgers] = useState<CustomerLedger[]>([]);
  const [selectedLedgersForPayment, setSelectedLedgersForPayment] = useState<CustomerLedger[]>([]);
  const [processingCompanyPayment, setProcessingCompanyPayment] = useState(false);
  const [companyPaymentForm, setCompanyPaymentForm] = useState({
    payment_amount: '',
    payment_method: 'bank_transfer',
    payment_reference: '',
    receipt_number: '',
    notes: '',
    payment_date: new Date().toISOString().split('T')[0],
  });

  // Company Invoice state
  const [companyInvoiceDialogOpen, setCompanyInvoiceDialogOpen] = useState(false);
  const [invoiceCompany, setInvoiceCompany] = useState<Company | null>(null);
  const [invoiceLedgerEntries, setInvoiceLedgerEntries] = useState<CustomerLedger[]>([]);
  const [selectedInvoiceLedgers, setSelectedInvoiceLedgers] = useState<number[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [invoiceDueDate, setInvoiceDueDate] = useState<string>(() => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    return dueDate.toISOString().split('T')[0];
  });
  const [invoiceNotes, setInvoiceNotes] = useState<string>('');
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);

  useEffect(() => {
    loadData();
    loadCompanies();
    loadGuests();
    loadAllCompanyBookings();

    const handleSettingsChange = () => setHotelSettings(getHotelSettings());
    window.addEventListener('hotelSettingsChange', handleSettingsChange);
    return () => window.removeEventListener('hotelSettingsChange', handleSettingsChange);
  }, []);

  // Load all bookings that have company billing
  const loadAllCompanyBookings = async () => {
    try {
      const allBookings = await HotelAPIService.getBookingsWithDetails();
      // Filter bookings with company_id that are active (checked_in or auto_checked_in)
      const companyActiveBookings = allBookings.filter(
        b => b.company_id && (b.status === 'checked_in' || b.status === 'auto_checked_in')
      );
      setAllCompanyBookings(companyActiveBookings);
    } catch (err) {
      console.error('Failed to load company bookings:', err);
    }
  };

  // Load companies from database (single call for both dropdown options and check-in data)
  const loadCompanies = async () => {
    try {
      const companiesData = await HotelAPIService.getCompanies({ is_active: true });
      setCompanies(companiesData);
      const options: CompanyOption[] = companiesData.map((company: any) => ({
        company_name: company.company_name,
        company_registration_number: company.registration_number,
        contact_person: company.contact_person,
        contact_email: company.contact_email,
        contact_phone: company.contact_phone,
        billing_address_line1: company.billing_address,
      }));
      setCompanyOptions(options);
    } catch (err) {
      console.error('Failed to load companies:', err);
    }
  };

  // Load guests for check-in
  const loadGuests = async () => {
    try {
      const guestsData = await HotelAPIService.getAllGuests();
      setGuests(guestsData.sort((a: any, b: any) => a.full_name.localeCompare(b.full_name)));
    } catch (err) {
      console.error('Failed to load guests:', err);
    }
  };

  // Sort rooms by room number ascending
  const sortRoomsByNumber = (roomList: Room[]) => {
    return [...roomList].sort((a, b) => {
      const numA = parseInt(a.room_number, 10);
      const numB = parseInt(b.room_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.room_number.localeCompare(b.room_number);
    });
  };

  // Load available rooms for given dates
  const loadAvailableRooms = async (checkIn: string, checkOut: string) => {
    try {
      const rooms = await HotelAPIService.getAvailableRoomsForDates(checkIn, checkOut);
      setAvailableRooms(sortRoomsByNumber(rooms));
    } catch (err) {
      console.error('Failed to load available rooms:', err);
      setAvailableRooms([]);
    }
  };

  // Load bookings for a specific company
  const loadCompanyBookings = async (companyId: number) => {
    try {
      const allBookings = await HotelAPIService.getBookingsWithDetails();
      const filtered = allBookings.filter(b => b.company_id === companyId);
      setCompanyBookings(filtered);
    } catch (err) {
      console.error('Failed to load company bookings:', err);
      setCompanyBookings([]);
    }
  };

  // Handle opening company check-in dialog
  const handleOpenCheckInDialog = async (company?: Company) => {
    setCheckInDialogOpen(true);
    if (company) {
      setCheckInCompany(company);
      await loadCompanyBookings(company.id);
    }
    await loadAvailableRooms(checkInDate, checkOutDate);
  };

  // Handle company check-in
  const handleCompanyCheckIn = async () => {
    if (!checkInCompany || !checkInRoom) {
      setSnackbarMessage('Please select a company and room');
      setSnackbarOpen(true);
      return;
    }

    try {
      setProcessingCheckIn(true);

      let guestToUse = checkInGuest;

      // Create new guest if needed
      if (isCreatingNewCheckInGuest) {
        if (!newCheckInGuestForm.first_name || !newCheckInGuestForm.last_name) {
          setSnackbarMessage('Please enter guest first and last name');
          setSnackbarOpen(true);
          setProcessingCheckIn(false);
          return;
        }

        // Validate email format only if provided
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (newCheckInGuestForm.email && newCheckInGuestForm.email.trim() && !emailRegex.test(newCheckInGuestForm.email)) {
          setSnackbarMessage('Please enter a valid email address for the guest');
          setSnackbarOpen(true);
          setProcessingCheckIn(false);
          return;
        }

        const newGuest = await HotelAPIService.createGuest({
          first_name: newCheckInGuestForm.first_name,
          last_name: newCheckInGuestForm.last_name,
          email: newCheckInGuestForm.email || undefined,
          phone: newCheckInGuestForm.phone || undefined,
          ic_number: newCheckInGuestForm.ic_number || undefined,
          nationality: newCheckInGuestForm.nationality || undefined,
          address_line1: newCheckInGuestForm.address_line1 || undefined,
          city: newCheckInGuestForm.city || undefined,
          state_province: newCheckInGuestForm.state_province || undefined,
          postal_code: newCheckInGuestForm.postal_code || undefined,
          country: newCheckInGuestForm.country || undefined,
        });
        guestToUse = newGuest;
      }

      if (!guestToUse) {
        setSnackbarMessage('Please select or create a guest');
        setSnackbarOpen(true);
        setProcessingCheckIn(false);
        return;
      }

      // Get room_id - handle both 'id' and potential 'room_id' field names
      const roomId = checkInRoom.id || (checkInRoom as any).room_id;
      if (!roomId) {
        setSnackbarMessage('Room ID not found. Please select a different room.');
        setSnackbarOpen(true);
        setProcessingCheckIn(false);
        return;
      }

      // Create booking with company billing (bypass frontend date validation for back-dated entries)
      const guestId = typeof guestToUse.id === 'string' ? parseInt(guestToUse.id, 10) : guestToUse.id;
      const booking = await api.post('bookings', {
        json: {
          guest_id: guestId,
          room_id: roomId,
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          post_type: 'normal_stay',
          payment_status: 'unpaid',
          booking_remarks: `Company Billing: ${checkInCompany.company_name}`,
        },
      }).json<any>();

      // Update booking with company info
      await HotelAPIService.updateBooking(booking.id, {
        company_id: checkInCompany.id,
        company_name: checkInCompany.company_name,
      });

      // Check in the guest
      await HotelAPIService.checkInGuest(booking.id, {});

      // For back-dated bookings: auto-checkout if check-out date is today or in the past
      const today = new Date().toISOString().split('T')[0];
      if (checkOutDate <= today) {
        await HotelAPIService.updateBooking(booking.id, { status: 'checked_out' });

        // Post room charges to company ledger for auto-checked-out backdated bookings
        try {
          const roomAmount = typeof booking.total_amount === 'string'
            ? parseFloat(booking.total_amount)
            : (booking.total_amount || 0);
          const checkInDateObj = new Date(checkInDate);
          const checkOutDateObj = new Date(checkOutDate);
          const nights = Math.max(1, Math.ceil((checkOutDateObj.getTime() - checkInDateObj.getTime()) / (1000 * 60 * 60 * 24)));
          let description = `Room ${checkInRoom.room_number} - ${guestToUse.full_name}`;
          description += ` (${nights} night${nights > 1 ? 's' : ''}: ${checkInDate} to ${checkOutDate})`;
          await HotelAPIService.createCustomerLedger({
            company_name: checkInCompany.company_name,
            description: description,
            expense_type: 'accommodation',
            amount: roomAmount,
            booking_id: parseInt(String(booking.id)),
            room_number: checkInRoom.room_number,
            posting_date: today,
            transaction_date: today,
            post_type: 'room_charge',
          });
        } catch (ledgerError) {
          console.error('Failed to post room charges to company ledger:', ledgerError);
        }
      }

      setSnackbarMessage(`Guest ${guestToUse.full_name} checked in to Room ${checkInRoom.room_number} (Company: ${checkInCompany.company_name})`);
      setSnackbarOpen(true);

      // Reset and close dialog
      setCheckInDialogOpen(false);
      resetCheckInForm();
      await loadData();
      await loadCompanies();
      await loadAllCompanyBookings();
    } catch (err: any) {
      console.error('Failed to perform company check-in:', err);
      setSnackbarMessage(err.message || 'Failed to perform company check-in');
      setSnackbarOpen(true);
    } finally {
      setProcessingCheckIn(false);
    }
  };

  // Reset check-in form
  const resetCheckInForm = () => {
    setCheckInCompany(null);
    setCheckInGuest(null);
    setCheckInRoom(null);
    setCheckInDate(new Date().toISOString().split('T')[0]);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setCheckOutDate(tomorrow.toISOString().split('T')[0]);
    setIsCreatingNewCheckInGuest(false);
    setNewCheckInGuestForm({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      ic_number: '',
      nationality: '',
      address_line1: '',
      city: '',
      state_province: '',
      postal_code: '',
      country: '',
    });
    setCompanyBookings([]);
  };

  // Handle opening checkout dialog for a company booking
  const handleOpenCheckoutDialog = (booking: BookingWithDetails) => {
    setCheckoutBooking(booking);
    setCheckoutDialogOpen(true);
  };

  // Handle confirming checkout
  const handleConfirmCompanyCheckout = async (_lateCheckoutData?: { penalty: number; notes: string }, checkoutPaymentMethod?: string) => {
    if (!checkoutBooking) return;

    try {
      // Build update payload
      const updatePayload: any = { status: 'checked_out' };

      // Save payment method from checkout invoice to booking
      if (checkoutPaymentMethod) {
        updatePayload.payment_method = checkoutPaymentMethod;
      }

      // Update booking status to checked_out
      await HotelAPIService.updateBooking(checkoutBooking.id, updatePayload);

      // Mark room as dirty
      const dirtyNotes = 'Room requires cleaning after checkout';

      await HotelAPIService.updateRoomStatus(checkoutBooking.room_id, {
        status: 'dirty',
        notes: dirtyNotes,
      });

      // Auto-post room charges to company ledger
      if (checkoutBooking.company_id && checkoutBooking.company_name) {
        try {
          const roomAmount = typeof checkoutBooking.total_amount === 'string'
            ? parseFloat(checkoutBooking.total_amount)
            : (checkoutBooking.total_amount || 0);
          const checkIn = new Date(checkoutBooking.check_in_date);
          const checkOut = new Date(checkoutBooking.check_out_date);
          const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

          let description = `Room ${checkoutBooking.room_number} - ${checkoutBooking.guest_name}`;
          description += ` (${nights} night${nights > 1 ? 's' : ''}: ${checkoutBooking.check_in_date} to ${checkoutBooking.check_out_date})`;

          await HotelAPIService.createCustomerLedger({
            company_name: checkoutBooking.company_name,
            description: description,
            expense_type: 'accommodation',
            amount: roomAmount,
            booking_id: parseInt(checkoutBooking.id),
            room_number: checkoutBooking.room_number,
            posting_date: new Date().toISOString().split('T')[0],
            transaction_date: new Date().toISOString().split('T')[0],
            post_type: 'room_charge',
          });
        } catch (ledgerError) {
          console.error('Failed to post room charges to company ledger:', ledgerError);
        }
      }

      setSnackbarMessage(`${checkoutBooking.guest_name} checked out from Room ${checkoutBooking.room_number}`);
      setSnackbarOpen(true);
      setCheckoutDialogOpen(false);
      setCheckoutBooking(null);

      // Reload data
      await loadData();
      await loadAllCompanyBookings();
    } catch (error: any) {
      throw new Error(error.message || 'Failed to process checkout');
    }
  };

  // Handle date change and reload rooms
  const handleCheckInDateChange = async (newDate: string) => {
    setCheckInDate(newDate);
    await loadAvailableRooms(newDate, checkOutDate);
  };

  const handleCheckOutDateChange = async (newDate: string) => {
    setCheckOutDate(newDate);
    await loadAvailableRooms(checkInDate, newDate);
  };

  // Reset company registration form
  const resetCompanyRegForm = () => {
    setCompanyRegForm({
      company_name: '',
      registration_number: '',
      contact_person: '',
      contact_email: '',
      contact_phone: '',
      billing_address: '',
      billing_city: '',
      billing_state: '',
      billing_postal_code: '',
      credit_limit: '',
      payment_terms_days: '30',
      notes: '',
    });
  };

  // Handle company registration
  const handleRegisterCompany = async () => {
    if (!companyRegForm.company_name.trim()) {
      setSnackbarMessage('Company name is required');
      setSnackbarOpen(true);
      return;
    }

    try {
      setCreatingCompany(true);

      await HotelAPIService.createCompany({
        company_name: companyRegForm.company_name.trim(),
        registration_number: companyRegForm.registration_number.trim() || undefined,
        contact_person: companyRegForm.contact_person.trim() || undefined,
        contact_email: companyRegForm.contact_email.trim() || undefined,
        contact_phone: companyRegForm.contact_phone.trim() || undefined,
        billing_address: companyRegForm.billing_address.trim() || undefined,
        billing_city: companyRegForm.billing_city.trim() || undefined,
        billing_state: companyRegForm.billing_state.trim() || undefined,
        billing_postal_code: companyRegForm.billing_postal_code.trim() || undefined,
        credit_limit: companyRegForm.credit_limit ? parseFloat(companyRegForm.credit_limit) : undefined,
        payment_terms_days: companyRegForm.payment_terms_days ? parseInt(companyRegForm.payment_terms_days) : 30,
        notes: companyRegForm.notes.trim() || undefined,
      });

      setSnackbarMessage(`Company "${companyRegForm.company_name}" registered successfully`);
      setSnackbarOpen(true);
      setCompanyRegDialogOpen(false);
      resetCompanyRegForm();

      // Reload companies
      await loadCompanies();
    } catch (error: any) {
      console.error('Failed to register company:', error);
      setSnackbarMessage(error.message || 'Failed to register company');
      setSnackbarOpen(true);
    } finally {
      setCreatingCompany(false);
    }
  };

  // Open edit company dialog
  const handleOpenEditCompany = (company: Company) => {
    setEditingCompany(company);
    setCompanyEditForm({
      company_name: company.company_name || '',
      registration_number: company.registration_number || '',
      contact_person: company.contact_person || '',
      contact_email: company.contact_email || '',
      contact_phone: company.contact_phone || '',
      billing_address: company.billing_address || '',
      billing_city: company.billing_city || '',
      billing_state: company.billing_state || '',
      billing_postal_code: company.billing_postal_code || '',
      credit_limit: company.credit_limit?.toString() || '',
      payment_terms_days: company.payment_terms_days?.toString() || '30',
      notes: company.notes || '',
    });
    setCompanyEditDialogOpen(true);
  };

  // Reset edit form
  const resetCompanyEditForm = () => {
    setCompanyEditForm({
      company_name: '',
      registration_number: '',
      contact_person: '',
      contact_email: '',
      contact_phone: '',
      billing_address: '',
      billing_city: '',
      billing_state: '',
      billing_postal_code: '',
      credit_limit: '',
      payment_terms_days: '30',
      notes: '',
    });
    setEditingCompany(null);
  };

  // Handle update company
  const handleUpdateCompany = async () => {
    if (!editingCompany || !companyEditForm.company_name.trim()) {
      setSnackbarMessage('Company name is required');
      setSnackbarOpen(true);
      return;
    }

    try {
      setUpdatingCompany(true);

      await HotelAPIService.updateCompany(editingCompany.id, {
        company_name: companyEditForm.company_name.trim(),
        registration_number: companyEditForm.registration_number.trim() || undefined,
        contact_person: companyEditForm.contact_person.trim() || undefined,
        contact_email: companyEditForm.contact_email.trim() || undefined,
        contact_phone: companyEditForm.contact_phone.trim() || undefined,
        billing_address: companyEditForm.billing_address.trim() || undefined,
        billing_city: companyEditForm.billing_city.trim() || undefined,
        billing_state: companyEditForm.billing_state.trim() || undefined,
        billing_postal_code: companyEditForm.billing_postal_code.trim() || undefined,
        credit_limit: companyEditForm.credit_limit ? parseFloat(companyEditForm.credit_limit) : undefined,
        payment_terms_days: companyEditForm.payment_terms_days ? parseInt(companyEditForm.payment_terms_days) : 30,
        notes: companyEditForm.notes.trim() || undefined,
      });

      setSnackbarMessage(`Company "${companyEditForm.company_name}" updated successfully`);
      setSnackbarOpen(true);
      setCompanyEditDialogOpen(false);
      resetCompanyEditForm();

      // Reload companies
      await loadCompanies();
    } catch (error: any) {
      console.error('Failed to update company:', error);
      setSnackbarMessage(error.message || 'Failed to update company');
      setSnackbarOpen(true);
    } finally {
      setUpdatingCompany(false);
    }
  };

  // Open delete company confirmation
  const handleOpenDeleteCompany = (company: Company) => {
    setDeletingCompanyData(company);
    setCompanyDeleteDialogOpen(true);
  };

  // Handle delete company
  const handleDeleteCompany = async () => {
    if (!deletingCompanyData) return;

    try {
      setDeletingCompany(true);

      await HotelAPIService.deleteCompany(deletingCompanyData.id);

      setSnackbarMessage(`Company "${deletingCompanyData.company_name}" deleted successfully`);
      setSnackbarOpen(true);
      setCompanyDeleteDialogOpen(false);
      setDeletingCompanyData(null);

      // Reload companies
      await loadCompanies();
    } catch (error: any) {
      console.error('Failed to delete company:', error);
      setSnackbarMessage(error.message || 'Failed to delete company');
      setSnackbarOpen(true);
    } finally {
      setDeletingCompany(false);
    }
  };

  // Open payment dialog for a company
  const handleOpenCompanyPaymentDialog = async (company: Company) => {
    setPaymentCompany(company);
    // Load unpaid/partial ledger entries for this company
    const companyLedgersFiltered = ledgers.filter(
      l => l.company_name === company.company_name &&
           (l.status === 'pending' || l.status === 'partial')
    );
    setPaymentCompanyLedgers(companyLedgersFiltered);
    setSelectedLedgersForPayment(companyLedgersFiltered);
    setCompanyPaymentDialogOpen(true);
  };

  // Reset company payment form
  const resetCompanyPaymentForm = () => {
    setCompanyPaymentForm({
      payment_amount: '',
      payment_method: 'bank_transfer',
      payment_reference: '',
      receipt_number: '',
      payment_date: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setPaymentCompany(null);
    setPaymentCompanyLedgers([]);
    setSelectedLedgersForPayment([]);
  };

  // Handle recording company payment (distributes across selected ledgers)
  const handleRecordCompanyPayment = async () => {
    if (selectedLedgersForPayment.length === 0 || !companyPaymentForm.payment_amount) {
      setSnackbarMessage('Please select at least one ledger entry and enter payment amount');
      setSnackbarOpen(true);
      return;
    }

    const paymentAmount = parseFloat(companyPaymentForm.payment_amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      setSnackbarMessage('Please enter a valid payment amount');
      setSnackbarOpen(true);
      return;
    }

    try {
      setProcessingCompanyPayment(true);

      // Distribute payment across selected ledgers in order
      let remaining = paymentAmount;
      for (const ledger of selectedLedgersForPayment) {
        if (remaining <= 0) break;
        const balance = typeof ledger.balance_due === 'string'
          ? parseFloat(ledger.balance_due)
          : (ledger.balance_due || (typeof ledger.amount === 'string' ? parseFloat(ledger.amount) : ledger.amount));
        const allocate = Math.min(remaining, balance);
        if (allocate <= 0) continue;

        await HotelAPIService.createLedgerPayment(ledger.id, {
          payment_amount: parseFloat(allocate.toFixed(2)),
          payment_method: companyPaymentForm.payment_method,
          payment_reference: companyPaymentForm.payment_reference || undefined,
          receipt_number: companyPaymentForm.receipt_number || undefined,
          notes: companyPaymentForm.notes || undefined,
          payment_date: companyPaymentForm.payment_date || undefined,
        });
        remaining -= allocate;
      }

      setSnackbarMessage(`Payment of ${formatCurrency(paymentAmount)} recorded successfully`);
      setSnackbarOpen(true);
      setCompanyPaymentDialogOpen(false);
      resetCompanyPaymentForm();

      // Reload data
      await loadData();
    } catch (error: any) {
      console.error('Failed to record payment:', error);
      setSnackbarMessage(error.message || 'Failed to record payment');
      setSnackbarOpen(true);
    } finally {
      setProcessingCompanyPayment(false);
    }
  };

  // Company Invoice handlers
  const handleOpenCompanyInvoiceDialog = (company: Company) => {
    setInvoiceCompany(company);
    // Get all ledger entries for this company
    const companyLedgersFiltered = ledgers.filter(
      l => l.company_name === company.company_name
    );
    setInvoiceLedgerEntries(companyLedgersFiltered);
    // Pre-select entries that don't have invoice numbers yet
    const uninvoicedIds = companyLedgersFiltered
      .filter(l => !l.invoice_number && (l.status === 'pending' || l.status === 'partial'))
      .map(l => l.id);
    setSelectedInvoiceLedgers(uninvoicedIds);
    // Generate invoice number
    const timestamp = Date.now();
    setInvoiceNumber(`INV-${company.company_name.substring(0, 3).toUpperCase()}-${timestamp.toString().slice(-6)}`);
    // Set due date based on company payment terms
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (company.payment_terms_days || 30));
    setInvoiceDueDate(dueDate.toISOString().split('T')[0]);
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setInvoiceNotes('');
    setShowInvoicePreview(false);
    setCompanyInvoiceDialogOpen(true);
  };

  const resetCompanyInvoiceForm = () => {
    setInvoiceCompany(null);
    setInvoiceLedgerEntries([]);
    setSelectedInvoiceLedgers([]);
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    setInvoiceDueDate(dueDate.toISOString().split('T')[0]);
    setInvoiceNotes('');
    setShowInvoicePreview(false);
  };

  const handleToggleLedgerSelection = (ledgerId: number) => {
    setSelectedInvoiceLedgers(prev =>
      prev.includes(ledgerId)
        ? prev.filter(id => id !== ledgerId)
        : [...prev, ledgerId]
    );
  };

  const handleSelectAllLedgers = () => {
    if (selectedInvoiceLedgers.length === invoiceLedgerEntries.length) {
      setSelectedInvoiceLedgers([]);
    } else {
      setSelectedInvoiceLedgers(invoiceLedgerEntries.map(l => l.id));
    }
  };

  const getSelectedLedgerTotal = () => {
    return invoiceLedgerEntries
      .filter(l => selectedInvoiceLedgers.includes(l.id))
      .reduce((sum, l) => {
        const amount = typeof l.amount === 'string' ? parseFloat(l.amount) : l.amount;
        return sum + amount;
      }, 0);
  };

  const getSelectedLedgerBalanceDue = () => {
    return invoiceLedgerEntries
      .filter(l => selectedInvoiceLedgers.includes(l.id))
      .reduce((sum, l) => {
        const balanceDue = typeof l.balance_due === 'string' ? parseFloat(l.balance_due) : (l.balance_due || 0);
        return sum + balanceDue;
      }, 0);
  };

  const handlePrintCompanyInvoice = () => {
    const invoiceContent = document.getElementById('company-invoice-content');
    if (!invoiceContent) return;

    // Use iframe for printing (works in Tauri desktop apps)
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

    printDoc.open();
    printDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice - ${invoiceNumber}</title>
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
            .invoice-header, [class*="header"] {
              text-align: center;
              margin-bottom: 30px;
              border-bottom: 2px solid #1976d2 !important;
              padding-bottom: 20px;
            }
            .invoice-header h1, [class*="header"] h4, [class*="header"] h5 {
              color: #1976d2;
              font-size: 28px;
              margin-bottom: 5px;
            }
            .invoice-header p, [class*="header"] p {
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
            /* MUI overrides for print */
            .MuiGrid-container {
              display: flex !important;
              flex-wrap: wrap !important;
              width: 100% !important;
              margin-bottom: 20px !important;
            }
            .MuiGrid-item {
              padding: 8px !important;
            }
            [class*="MuiGrid-grid-xs-6"] {
              flex: 0 0 50% !important;
              max-width: 50% !important;
            }
            [class*="MuiTypography-overline"] {
              font-size: 11px !important;
              text-transform: uppercase !important;
              letter-spacing: 1px !important;
              color: #1976d2 !important;
              font-weight: 600 !important;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }
            th {
              background-color: #1976d2 !important;
              color: white !important;
              padding: 12px;
              text-align: left;
              font-size: 13px;
              text-transform: uppercase;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            td {
              padding: 12px;
              border-bottom: 1px solid #ddd;
              font-size: 13px;
            }
            .amount, [class*="amount"] {
              text-align: right;
              font-weight: 600;
            }
            .total-row, tr:last-child {
              background-color: #f5f5f5 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .total-row td {
              border-top: 3px double #1976d2;
              font-size: 16px;
              font-weight: 700;
              padding: 15px 12px;
              color: #1976d2;
            }
            /* MUI Paper/Table overrides */
            .MuiPaper-root, .MuiTableContainer-root {
              box-shadow: none !important;
              border: 1px solid #ddd !important;
              border-radius: 0 !important;
            }
            .MuiTableHead-root .MuiTableRow-root {
              background-color: #1976d2 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .MuiTableHead-root .MuiTableCell-root {
              background-color: #1976d2 !important;
              color: white !important;
              font-weight: 700 !important;
              text-transform: uppercase !important;
              font-size: 13px !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .MuiTableBody-root .MuiTableCell-root {
              padding: 12px !important;
              border-bottom: 1px solid #ddd !important;
              font-size: 13px !important;
            }
            .MuiDivider-root {
              border-color: #ddd !important;
              margin: 15px 0 !important;
            }
            .footer, [class*="footer"] {
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
            /* Hide MUI visual-only elements */
            .MuiChip-root { display: none !important; }
            hr { border: none; border-top: 1px solid #ddd; margin: 15px 0; }
            @media print {
              body { padding: 0; }
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

  const handleDownloadCompanyInvoice = () => {
    const invoiceContent = document.getElementById('company-invoice-content');
    if (!invoiceContent) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Invoice - ${invoiceNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 30px; color: #333; max-width: 800px; margin: 0 auto; }
            .invoice-header { text-align: center; margin-bottom: 25px; padding-bottom: 15px; border-bottom: 3px solid #1976d2; }
            .invoice-header h1 { color: #1976d2; font-size: 28px; margin-bottom: 4px; }
            .invoice-header p { color: #666; font-size: 13px; margin: 2px 0; }
            .title-bar { background-color: #1976d2; color: white; padding: 8px 16px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; }
            .title-bar h2 { font-size: 18px; letter-spacing: 2px; text-transform: uppercase; margin: 0; }
            .title-bar span { font-size: 15px; font-weight: 600; }
            .meta { display: flex; justify-content: space-between; margin-bottom: 25px; }
            .meta-left { flex: 1; }
            .meta-right { min-width: 220px; text-align: right; }
            .meta h3 { font-size: 11px; color: #1976d2; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
            .meta p { font-size: 13px; margin: 4px 0; line-height: 1.5; }
            .meta .label { color: #666; display: inline-block; min-width: 70px; }
            .meta .value { font-weight: 600; }
            .detail-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
            .detail-row .dlabel { color: #666; }
            .detail-row .dvalue { font-weight: 600; margin-left: 12px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 0; border: 1px solid #ddd; }
            th { background-color: #1976d2; color: white; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; font-weight: 700; }
            th.right { text-align: right; }
            td { padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
            td.right { text-align: right; font-weight: 600; }
            tr.alt { background-color: #fafafa; }
            tr.subtotal td { border-top: 2px solid #ddd; padding-top: 14px; font-weight: 600; }
            tr.total { background-color: #f5f5f5; }
            tr.total td { border-top: 3px double #1976d2; font-size: 16px; font-weight: 700; color: #1976d2; padding: 14px 12px; }
            .notes { margin-top: 25px; padding: 12px 16px; background: #fff3cd; border-left: 4px solid #ffc107; }
            .notes strong { display: block; color: #856404; margin-bottom: 4px; font-size: 13px; }
            .notes p { color: #856404; font-size: 13px; white-space: pre-wrap; }
            .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #ddd; text-align: center; }
            .footer .thanks { font-weight: 600; color: #1976d2; font-size: 14px; margin-bottom: 4px; }
            .footer p { color: #666; font-size: 12px; margin: 3px 0; }
            .green { color: #2e7d32; }
            .red { color: #d32f2f; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="invoice-header">
            <h1>${hotelSettings.hotel_name}</h1>
            <p>${hotelSettings.hotel_address}</p>
            <p>Phone: ${hotelSettings.hotel_phone} | Email: ${hotelSettings.hotel_email}</p>
          </div>

          <div class="title-bar">
            <h2>Invoice</h2>
            <span>#${invoiceNumber}</span>
          </div>

          <div class="meta">
            <div class="meta-left">
              <h3>Bill To</h3>
              <p><strong>${invoiceCompany?.company_name || ''}</strong></p>
              ${invoiceCompany?.registration_number ? `<p>Reg No: ${invoiceCompany.registration_number}</p>` : ''}
              ${invoiceCompany?.billing_address ? `<p>${invoiceCompany.billing_address}</p>` : ''}
              ${[invoiceCompany?.billing_city, invoiceCompany?.billing_state, invoiceCompany?.billing_postal_code].filter(Boolean).length > 0
                ? `<p>${[invoiceCompany?.billing_city, invoiceCompany?.billing_state, invoiceCompany?.billing_postal_code].filter(Boolean).join(', ')}</p>` : ''}
              ${invoiceCompany?.contact_person ? `<p><span class="label">Attn:</span> <span class="value">${invoiceCompany.contact_person}</span></p>` : ''}
              ${invoiceCompany?.contact_email ? `<p><span class="label">Email:</span> ${invoiceCompany.contact_email}</p>` : ''}
              ${invoiceCompany?.contact_phone ? `<p><span class="label">Phone:</span> ${invoiceCompany.contact_phone}</p>` : ''}
            </div>
            <div class="meta-right">
              <h3>Invoice Details</h3>
              <div class="detail-row"><span class="dlabel">Invoice Date:</span><span class="dvalue">${formatDateForDisplay(invoiceDate)}</span></div>
              <div class="detail-row"><span class="dlabel">Due Date:</span><span class="dvalue">${formatDateForDisplay(invoiceDueDate)}</span></div>
              <div class="detail-row"><span class="dlabel">Terms:</span><span class="dvalue">${invoiceCompany?.payment_terms_days || 30} days</span></div>
              <div class="detail-row"><span class="dlabel">Status:</span><span class="dvalue ${getSelectedLedgerBalanceDue() > 0 ? 'red' : 'green'}">${getSelectedLedgerBalanceDue() > 0 ? 'Outstanding' : 'Settled'}</span></div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Room</th>
                <th class="right">Amount</th>
                <th class="right">Paid</th>
                <th class="right">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${invoiceLedgerEntries
                .filter(l => selectedInvoiceLedgers.includes(l.id))
                .map((ledger, idx) => {
                  const amount = typeof ledger.amount === 'string' ? parseFloat(ledger.amount) : ledger.amount;
                  const paidAmount = typeof ledger.paid_amount === 'string' ? parseFloat(ledger.paid_amount) : (ledger.paid_amount || 0);
                  const balanceDue = typeof ledger.balance_due === 'string' ? parseFloat(ledger.balance_due) : (ledger.balance_due || 0);
                  return `<tr class="${idx % 2 !== 0 ? 'alt' : ''}">
                    <td>${ledger.description}</td>
                    <td>${formatDateForDisplay(ledger.created_at)}</td>
                    <td>${ledger.room_number || '-'}</td>
                    <td class="right">${formatCurrency(amount)}</td>
                    <td class="right green">${paidAmount > 0 ? formatCurrency(paidAmount) : '-'}</td>
                    <td class="right ${balanceDue > 0 ? 'red' : 'green'}">${formatCurrency(balanceDue)}</td>
                  </tr>`;
                }).join('')}
              <tr class="subtotal">
                <td colspan="3" style="text-align:right">Subtotal:</td>
                <td class="right">${formatCurrency(getSelectedLedgerTotal())}</td>
                <td colspan="2"></td>
              </tr>
              <tr class="total">
                <td colspan="5" style="text-align:right">Total Amount Due:</td>
                <td class="right">${formatCurrency(getSelectedLedgerBalanceDue())}</td>
              </tr>
            </tbody>
          </table>

          ${invoiceNotes ? `<div class="notes"><strong>Notes:</strong><p>${invoiceNotes}</p></div>` : ''}

          <div class="footer">
            <p class="thanks">Thank you for your business!</p>
            <p>Please make payment within ${invoiceCompany?.payment_terms_days || 30} days of invoice date.</p>
            <p>This is a computer-generated invoice. | ${hotelSettings.hotel_name}</p>
          </div>
        </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice-${invoiceNumber}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Create ledger handlers
  const handleCreateLedger = async () => {
    try {
      setCreating(true);
      await HotelAPIService.createCustomerLedger(createFormData);
      setSnackbarMessage('Ledger entry created successfully!');
      setSnackbarOpen(true);
      setCreateDialogOpen(false);
      resetCreateForm();
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create ledger entry');
    } finally {
      setCreating(false);
    }
  };

  const resetCreateForm = () => {
    setCreateFormData({
      company_name: '',
      description: '',
      expense_type: 'accommodation',
      amount: 0,
    });
    setSelectedCompany(null);
  };

  // Edit ledger handlers
  const handleEditLedger = (ledger: CustomerLedger) => {
    setEditingLedger(ledger);
    setEditFormData({
      company_name: ledger.company_name,
      company_registration_number: ledger.company_registration_number,
      contact_person: ledger.contact_person,
      contact_email: ledger.contact_email,
      contact_phone: ledger.contact_phone,
      billing_address_line1: ledger.billing_address_line1,
      billing_city: ledger.billing_city,
      billing_state: ledger.billing_state,
      billing_postal_code: ledger.billing_postal_code,
      billing_country: ledger.billing_country,
      description: ledger.description,
      expense_type: ledger.expense_type,
      amount: parseFloat(String(ledger.amount)),
      status: ledger.status,
      due_date: formatDateForInput(ledger.due_date),
      notes: ledger.notes,
      internal_notes: ledger.internal_notes,
    });
    setEditDialogOpen(true);
  };

  const handleUpdateLedger = async () => {
    if (!editingLedger) return;

    try {
      setUpdating(true);
      await HotelAPIService.updateCustomerLedger(editingLedger.id, editFormData);
      setSnackbarMessage('Ledger entry updated successfully!');
      setSnackbarOpen(true);
      setEditDialogOpen(false);
      setEditingLedger(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update ledger entry');
    } finally {
      setUpdating(false);
    }
  };

  // Payment handlers
  const handleOpenPaymentDialog = async (ledger: CustomerLedger) => {
    setPaymentLedger(ledger);
    setPaymentFormData({
      payment_amount: parseFloat(String(ledger.balance_due)),
      payment_method: 'cash',
    });
    setPaymentTab(0);
    setPaymentDialogOpen(true);

    // Load payment history
    try {
      const payments = await HotelAPIService.getLedgerPayments(ledger.id);
      setPaymentHistory(payments);
    } catch (err) {
      console.error('Failed to load payment history:', err);
      setPaymentHistory([]);
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentLedger) return;

    try {
      setProcessingPayment(true);
      await HotelAPIService.createLedgerPayment(paymentLedger.id, paymentFormData);
      setSnackbarMessage('Payment recorded successfully!');
      setSnackbarOpen(true);
      setPaymentDialogOpen(false);
      setPaymentLedger(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleSavePaymentDate = async (payment: CustomerLedgerPayment) => {
    if (!editingPaymentDate || !paymentLedger) return;
    try {
      setSavingPaymentDate(true);
      await HotelAPIService.updateLedgerPaymentDate(payment.ledger_id, payment.id, editingPaymentDate);
      // Refresh payment history
      const payments = await HotelAPIService.getLedgerPayments(payment.ledger_id);
      setPaymentHistory(payments);
      setEditingPaymentId(null);
      setSnackbarMessage('Payment date updated successfully');
      setSnackbarOpen(true);
      await loadData();
    } catch (err: any) {
      setSnackbarMessage(err.message || 'Failed to update payment date');
      setSnackbarOpen(true);
    } finally {
      setSavingPaymentDate(false);
    }
  };

  const isVoidedLedger = (ledger: CustomerLedger) => {
    return Boolean(ledger.void_at) || ledger.status === 'cancelled';
  };

  const getLedgerBalanceDue = (ledger: CustomerLedger) => {
    return isVoidedLedger(ledger) ? 0 : parseFloat(String(ledger.balance_due || 0));
  };

  const canRecordPayment = (ledger: CustomerLedger) => {
    return ledger.status !== 'paid' && !isVoidedLedger(ledger);
  };

  // Mirrors booking canVoid: cannot void what is already voided/cancelled
  const canVoid = (ledger: CustomerLedger) => {
    return !isVoidedLedger(ledger);
  };

  const canViewInvoice = (ledger: CustomerLedger) => {
    return !!ledger.booking_id;
  };

  const handleVoidLedger = (ledger: CustomerLedger) => {
    setVoidingLedger(ledger);
    setVoidReason('');
    setVoidDialogOpen(true);
  };

  const handleConfirmVoidLedger = async () => {
    if (!voidingLedger) return;
    try {
      setVoiding(true);
      await HotelAPIService.voidLedger(voidingLedger.id, {
        reason: voidReason || 'Voided by admin',
      });
      setSnackbarMessage('Ledger entry voided successfully');
      setSnackbarOpen(true);
      setVoidDialogOpen(false);
      setVoidingLedger(null);
      setVoidReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to void ledger entry');
    } finally {
      setVoiding(false);
    }
  };

  const handleViewLedgerInvoice = async (ledger: CustomerLedger) => {
    if (!ledger.booking_id) return;
    try {
      setLoadingLedgerInvoice(true);
      const booking = await api.get(`bookings/${ledger.booking_id}`).json<BookingWithDetails>();
      setLedgerInvoiceBooking(enhanceBookingDetails(booking));
      setLedgerInvoiceOpen(true);
    } catch (err: any) {
      setSnackbarMessage(err.message || 'Failed to load invoice');
      setSnackbarOpen(true);
    } finally {
      setLoadingLedgerInvoice(false);
    }
  };

  // Register new company
  const handleRegisterNewCompany = async () => {
    try {
      // Save to database
      const createdCompany = await HotelAPIService.createCompany({
        company_name: newCompanyData.company_name,
        registration_number: newCompanyData.company_registration_number,
        contact_person: newCompanyData.contact_person,
        contact_email: newCompanyData.contact_email,
        contact_phone: newCompanyData.contact_phone,
        billing_address: newCompanyData.billing_address_line1,
      });

      const newCompany: CompanyOption = {
        company_name: createdCompany.company_name,
        company_registration_number: createdCompany.registration_number,
        contact_person: createdCompany.contact_person,
        contact_email: createdCompany.contact_email,
        contact_phone: createdCompany.contact_phone,
        billing_address_line1: createdCompany.billing_address,
      };

      // Add to company options
      setCompanyOptions([...companyOptions, newCompany]);
      setSelectedCompany(newCompany);

      // Fill the create form with new company data
      setCreateFormData({
        ...createFormData,
        company_name: newCompany.company_name,
        company_registration_number: newCompany.company_registration_number,
        contact_person: newCompany.contact_person,
        contact_email: newCompany.contact_email,
        contact_phone: newCompany.contact_phone,
        billing_address_line1: newCompany.billing_address_line1,
      });

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
        billing_address_line1: '',
      });
    } catch (err: any) {
      console.error('Failed to register company:', err);
      setSnackbarMessage(err?.message || 'Failed to register company');
      setSnackbarOpen(true);
    }
  };

  // Print company ledger statement
  const handlePrintCompanyStatement = (companyName: string) => {
    setPrintingCompany(companyName);
    const entries = ledgers.filter(l => l.company_name === companyName);
    setCompanyLedgerEntries(entries);
    setCurrentReceiptIndex(0);
    setPrintDialogOpen(true);
  };

  const handlePrint = () => {
    const totalAmount = companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.amount)), 0);
    const totalPaid = companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.paid_amount)), 0);
    const totalBalance = companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.balance_due)), 0);

    const htmlContent = `
      <html>
        <head>
          <title>Company Ledger Statement - ${printingCompany}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            .header h1 { margin: 0; color: #333; }
            .header h2 { margin: 10px 0 0; color: #666; font-weight: normal; }
            .company-info { margin-bottom: 20px; }
            .summary { display: flex; justify-content: space-between; margin-bottom: 20px; background: #f5f5f5; padding: 15px; border-radius: 4px; }
            .summary-item { text-align: center; }
            .summary-item .label { font-size: 12px; color: #666; }
            .summary-item .value { font-size: 18px; font-weight: bold; }
            table { border-collapse: collapse; width: 100%; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
            th { background-color: #26a69a; color: white; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            .text-right { text-align: right; }
            .status-paid { color: green; }
            .status-pending { color: orange; }
            .status-overdue { color: red; }
            .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${hotelSettings.hotel_name}</h1>
            <h2>Company Ledger Statement</h2>
          </div>
          <div class="company-info">
            <h3>${printingCompany}</h3>
            <p>Statement Date: ${new Date().toLocaleDateString()}</p>
          </div>
          <div class="summary">
            <div class="summary-item">
              <div class="label">Total Entries</div>
              <div class="value">${companyLedgerEntries.length}</div>
            </div>
            <div class="summary-item">
              <div class="label">Total Amount</div>
              <div class="value">${formatCurrency(totalAmount)}</div>
            </div>
            <div class="summary-item">
              <div class="label">Total Paid</div>
              <div class="value" style="color: green;">${formatCurrency(totalPaid)}</div>
            </div>
            <div class="summary-item">
              <div class="label">Balance Due</div>
              <div class="value" style="color: ${totalBalance > 0 ? 'red' : 'green'};">${formatCurrency(totalBalance)}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Description</th>
                <th>Type</th>
                <th class="text-right">Amount</th>
                <th class="text-right">Paid</th>
                <th class="text-right">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${companyLedgerEntries.map(entry => `
                <tr>
                  <td>${entry.invoice_number || '-'}</td>
                  <td>${new Date(entry.created_at).toLocaleDateString()}</td>
                  <td>${entry.description}</td>
                  <td>${entry.expense_type}</td>
                  <td class="text-right">${formatCurrency(parseFloat(String(entry.amount)))}</td>
                  <td class="text-right">${formatCurrency(parseFloat(String(entry.paid_amount)))}</td>
                  <td class="text-right">${formatCurrency(parseFloat(String(entry.balance_due)))}</td>
                  <td class="status-${entry.status}">${entry.status.toUpperCase()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="footer">
            <p>Generated on ${new Date().toLocaleString()}</p>
            <p>${hotelSettings.hotel_name} - Hotel Management System</p>
          </div>
        </body>
      </html>
    `;

    // Use iframe for printing (works in Tauri desktop apps)
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'absolute';
    printFrame.style.top = '-10000px';
    printFrame.style.left = '-10000px';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(htmlContent);
      frameDoc.close();

      setTimeout(() => {
        printFrame.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(printFrame);
        }, 1000);
      }, 250);
    }
  };

  // Print a single receipt
  const handlePrintSingleReceipt = (entry: CustomerLedger) => {
    const htmlContent = `
      <html>
        <head>
          <title>Receipt - ${entry.invoice_number || `#${entry.id}`}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 15px; }
            .header h1 { margin: 0; color: #333; font-size: 24px; }
            .header h2 { margin: 5px 0 0; color: #666; font-weight: normal; font-size: 16px; }
            .receipt-info { margin-bottom: 20px; }
            .receipt-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
            .receipt-row .label { color: #666; font-weight: 500; }
            .receipt-row .value { font-weight: 600; }
            .amount-section { background: #f5f5f5; padding: 15px; border-radius: 4px; margin-top: 20px; }
            .amount-row { display: flex; justify-content: space-between; padding: 5px 0; }
            .amount-row.total { font-size: 18px; font-weight: bold; border-top: 2px solid #333; margin-top: 10px; padding-top: 10px; }
            .status { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
            .status-paid { background: #e8f5e9; color: #2e7d32; }
            .status-pending { background: #e3f2fd; color: #1565c0; }
            .status-partial { background: #fff3e0; color: #e65100; }
            .status-overdue { background: #ffebee; color: #c62828; }
            .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 15px; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${hotelSettings.hotel_name}</h1>
            <h2>Payment Receipt</h2>
          </div>
          <div class="receipt-info">
            <div class="receipt-row">
              <span class="label">Receipt / Invoice #</span>
              <span class="value">${entry.invoice_number || `LED-${entry.id}`}</span>
            </div>
            <div class="receipt-row">
              <span class="label">Company</span>
              <span class="value">${entry.company_name}</span>
            </div>
            <div class="receipt-row">
              <span class="label">Description</span>
              <span class="value">${entry.description}</span>
            </div>
            <div class="receipt-row">
              <span class="label">Expense Type</span>
              <span class="value">${entry.expense_type}</span>
            </div>
            <div class="receipt-row">
              <span class="label">Date Created</span>
              <span class="value">${new Date(entry.created_at).toLocaleDateString()}</span>
            </div>
            ${entry.payment_date ? `
            <div class="receipt-row">
              <span class="label">Payment Date</span>
              <span class="value">${new Date(entry.payment_date).toLocaleDateString()}</span>
            </div>` : ''}
            ${entry.payment_method ? `
            <div class="receipt-row">
              <span class="label">Payment Method</span>
              <span class="value">${entry.payment_method}</span>
            </div>` : ''}
            ${entry.payment_reference ? `
            <div class="receipt-row">
              <span class="label">Payment Reference</span>
              <span class="value">${entry.payment_reference}</span>
            </div>` : ''}
            <div class="receipt-row">
              <span class="label">Status</span>
              <span class="value"><span class="status status-${entry.status}">${entry.status}</span></span>
            </div>
          </div>
          <div class="amount-section">
            <div class="amount-row">
              <span>Total Amount</span>
              <span>${formatCurrency(parseFloat(String(entry.amount)))}</span>
            </div>
            <div class="amount-row">
              <span>Paid Amount</span>
              <span style="color: green;">${formatCurrency(parseFloat(String(entry.paid_amount)))}</span>
            </div>
            <div class="amount-row total">
              <span>Balance Due</span>
              <span style="color: ${parseFloat(String(entry.balance_due)) > 0 ? 'red' : 'green'};">${formatCurrency(parseFloat(String(entry.balance_due)))}</span>
            </div>
          </div>
          ${entry.notes ? `<div style="margin-top: 15px;"><strong>Notes:</strong> ${entry.notes}</div>` : ''}
          <div class="footer">
            <p>Generated on ${new Date().toLocaleString()}</p>
            <p>${hotelSettings.hotel_name} - Hotel Management System</p>
          </div>
        </body>
      </html>
    `;

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'absolute';
    printFrame.style.top = '-10000px';
    printFrame.style.left = '-10000px';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(htmlContent);
      frameDoc.close();

      setTimeout(() => {
        printFrame.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(printFrame);
        }, 1000);
      }, 250);
    }
  };

  // Get unique companies for print button
  const uniqueCompanies = useMemo(() => {
    const companies = new Map<string, { total: number; balance: number; entries: number }>();
    ledgers.forEach(ledger => {
      const existing = companies.get(ledger.company_name) || { total: 0, balance: 0, entries: 0 };
      companies.set(ledger.company_name, {
        total: existing.total + parseFloat(String(ledger.amount)),
        balance: existing.balance + parseFloat(String(ledger.balance_due)),
        entries: existing.entries + 1,
      });
    });
    return Array.from(companies.entries()).map(([name, data]) => ({
      name,
      ...data,
    }));
  }, [ledgers]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Company Ledger
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadData}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<CheckInIcon />}
            onClick={() => handleOpenCheckInDialog()}
          >
            Company Check-In
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            New Entry
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={loadData}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Statistics Cards */}
      {summary && (
        <Grid container spacing={2} mb={3}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <ReceiptIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h6">Total Entries</Typography>
                </Box>
                <Typography variant="h4" color="primary">
                  {summary.total_entries}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <MoneyIcon color="info" sx={{ mr: 1 }} />
                  <Typography variant="h6">Total Amount</Typography>
                </Box>
                <Typography variant="h4" color="info.main">
                  {formatCurrency(parseFloat(String(summary.total_amount)))}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <CheckCircleIcon color="success" sx={{ mr: 1 }} />
                  <Typography variant="h6">Total Paid</Typography>
                </Box>
                <Typography variant="h4" color="success.main">
                  {formatCurrency(parseFloat(String(summary.total_paid)))}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <WarningIcon color="warning" sx={{ mr: 1 }} />
                  <Typography variant="h6">Outstanding</Typography>
                </Box>
                <Typography variant="h4" color="warning.main">
                  {formatCurrency(parseFloat(String(summary.total_outstanding)))}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Registered Companies with Check-In */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={1}>
            <BusinessIcon color="primary" />
            <Typography variant="h6">Registered Companies</Typography>
            <Chip label={companies.length} size="small" color="primary" />
          </Box>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setCompanyRegDialogOpen(true)}
          >
            Register Company
          </Button>
        </Box>
        {companies.length === 0 ? (
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={() => setCompanyRegDialogOpen(true)}>
                Register Now
              </Button>
            }
          >
            No companies registered yet. Click "Register Company" to add your first company.
          </Alert>
        ) : (
          <Grid container spacing={2}>
            {companies.map((company) => {
              const ledgerData = uniqueCompanies.find(u => u.name === company.company_name);
              const activeBookings = allCompanyBookings.filter(b => b.company_id === company.id);
              return (
                <Grid key={company.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%',
                      '&:hover': { boxShadow: 3 },
                      transition: 'box-shadow 0.2s',
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle1" fontWeight="bold" noWrap>
                          {company.company_name}
                        </Typography>
                        {company.contact_person && (
                          <Typography variant="caption" color="text.secondary" noWrap display="block">
                            {company.contact_person}
                          </Typography>
                        )}
                      </Box>
                      {activeBookings.length > 0 && (
                        <Chip
                          label={`${activeBookings.length} Active`}
                          size="small"
                          color="success"
                          variant="filled"
                        />
                      )}
                    </Box>

                    {/* Active Bookings */}
                    {activeBookings.length > 0 && (
                      <Box sx={{ mb: 1.5, p: 1, bgcolor: 'success.50', borderRadius: 1 }}>
                        <Typography variant="caption" color="success.dark" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
                          Active Guests:
                        </Typography>
                        {activeBookings.slice(0, 3).map((booking) => (
                          <Box key={booking.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, gap: 1 }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" noWrap display="block">
                                {booking.guest_name}
                              </Typography>
                              <Chip
                                label={`Room ${booking.room_number}`}
                                size="small"
                                variant="outlined"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                              />
                            </Box>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => handleOpenCheckoutDialog(booking)}
                              sx={{
                                minWidth: 'auto',
                                px: 1,
                                py: 0.25,
                                fontSize: '0.7rem',
                              }}
                            >
                              <CheckOutIcon sx={{ fontSize: 14, mr: 0.5 }} />
                              Out
                            </Button>
                          </Box>
                        ))}
                        {activeBookings.length > 3 && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            +{activeBookings.length - 3} more guest(s)
                          </Typography>
                        )}
                      </Box>
                    )}

                    {ledgerData && (
                      <Box sx={{ mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          {ledgerData.entries} ledger entries
                        </Typography>
                        <Box display="flex" justifyContent="space-between">
                          <Typography variant="body2">
                            Total: {formatCurrency(ledgerData.total)}
                          </Typography>
                          <Typography
                            variant="body2"
                            color={ledgerData.balance > 0 ? 'error.main' : 'success.main'}
                            fontWeight="medium"
                          >
                            Due: {formatCurrency(ledgerData.balance)}
                          </Typography>
                        </Box>
                      </Box>
                    )}

                    {/* Action Buttons Row 1: Check-In and Payment */}
                    <Box display="flex" gap={1} mt="auto" pt={1}>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        startIcon={<CheckInIcon />}
                        onClick={() => handleOpenCheckInDialog(company)}
                        sx={{ flex: 1 }}
                      >
                        Check-In
                      </Button>
                      {ledgerData && ledgerData.balance > 0 && (
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={<PaymentIcon />}
                          onClick={() => handleOpenCompanyPaymentDialog(company)}
                          sx={{ flex: 1 }}
                        >
                          Payment
                        </Button>
                      )}
                    </Box>
                    {/* Action Buttons Row 2: Edit, Invoice, Print, Delete */}
                    <Box display="flex" gap={1} pt={0.5}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => handleOpenEditCompany(company)}
                        title="Edit Company"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      {ledgerData && (
                        <>
                          <IconButton
                            size="small"
                            color="secondary"
                            onClick={() => handleOpenCompanyInvoiceDialog(company)}
                            title="Generate Invoice"
                          >
                            <InvoiceIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handlePrintCompanyStatement(company.company_name)}
                            title="Print Statement"
                          >
                            <PrintIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleOpenDeleteCompany(company)}
                        title="Delete Company"
                        disabled={activeBookings.length > 0}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Card>

      {/* Filters and Search */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <FilterIcon color="action" />
          <Typography variant="h6">Filters & Search</Typography>
        </Box>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search by company, description, invoice..."
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
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="all">All Status</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="partial">Partial</MenuItem>
                <MenuItem value="paid">Paid</MenuItem>
                <MenuItem value="overdue">Overdue</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Expense Type</InputLabel>
              <Select
                value={expenseTypeFilter}
                label="Expense Type"
                onChange={(e) => setExpenseTypeFilter(e.target.value)}
              >
                <MenuItem value="all">All Types</MenuItem>
                {EXPENSE_TYPES.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12, md: 2 }}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<ClearIcon />}
              onClick={clearFilters}
              size="small"
            >
              Clear Filters
            </Button>
          </Grid>
        </Grid>

        {/* Active Filters Info */}
        <Box mt={2} display="flex" gap={1} flexWrap="wrap">
          {searchQuery && (
            <Chip
              size="small"
              label={`Search: ${searchQuery}`}
              onDelete={() => setSearchQuery('')}
            />
          )}
          {statusFilter !== 'all' && (
            <Chip
              size="small"
              label={`Status: ${statusFilter}`}
              onDelete={() => setStatusFilter('all')}
            />
          )}
          {expenseTypeFilter !== 'all' && (
            <Chip
              size="small"
              label={`Type: ${expenseTypeFilter}`}
              onDelete={() => setExpenseTypeFilter('all')}
            />
          )}
          {totalLedgers > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto', alignSelf: 'center' }}>
              Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalLedgers)} of {totalLedgers} entries
            </Typography>
          )}
        </Box>
      </Card>

      {/* Ledger Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
              <TableCell>
                <strong>Invoice #</strong>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'company_name'}
                  direction={sortField === 'company_name' ? sortOrder : 'asc'}
                  onClick={() => handleSort('company_name')}
                >
                  <strong>Company</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell><strong>Description</strong></TableCell>
              <TableCell><strong>Type</strong></TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'amount'}
                  direction={sortField === 'amount' ? sortOrder : 'asc'}
                  onClick={() => handleSort('amount')}
                >
                  <strong>Amount</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'balance_due'}
                  direction={sortField === 'balance_due' ? sortOrder : 'asc'}
                  onClick={() => handleSort('balance_due')}
                >
                  <strong>Balance Due</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'due_date'}
                  direction={sortField === 'due_date' ? sortOrder : 'asc'}
                  onClick={() => handleSort('due_date')}
                >
                  <strong>Due Date</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'status'}
                  direction={sortField === 'status' ? sortOrder : 'asc'}
                  onClick={() => handleSort('status')}
                >
                  <strong>Status</strong>
                </TableSortLabel>
              </TableCell>
              <TableCell><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ledgers.map((ledger) => (
              <TableRow
                key={ledger.id}
                hover
                onClick={() => handleEditLedger(ledger)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{ledger.invoice_number || '-'}</TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2">{ledger.company_name}</Typography>
                    {ledger.contact_person && (
                      <Typography variant="caption" color="text.secondary">
                        {ledger.contact_person}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ledger.description}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={EXPENSE_TYPES.find(t => t.value === ledger.expense_type)?.label || ledger.expense_type}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>{formatCurrency(parseFloat(String(ledger.amount)))}</TableCell>
                <TableCell>
                  <Typography
                    color={getLedgerBalanceDue(ledger) > 0 ? 'error.main' : 'success.main'}
                    fontWeight="medium"
                  >
                    {formatCurrency(getLedgerBalanceDue(ledger))}
                  </Typography>
                </TableCell>
                <TableCell>
                  {formatDateForDisplay(ledger.due_date)}
                </TableCell>
                <TableCell>
                  <Chip
                    label={getStatusText(ledger.status)}
                    color={getStatusColor(ledger.status)}
                    size="small"
                  />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {canRecordPayment(ledger) && (
                      <IconButton
                        size="small"
                        onClick={() => handleOpenPaymentDialog(ledger)}
                        color="success"
                        title="Record Payment"
                      >
                        <PaymentIcon />
                      </IconButton>
                    )}
                    {canViewInvoice(ledger) && (
                      <IconButton
                        size="small"
                        onClick={() => handleViewLedgerInvoice(ledger)}
                        color="primary"
                        title="View Invoice"
                        disabled={loadingLedgerInvoice}
                      >
                        <ReceiptIcon />
                      </IconButton>
                    )}
                    {canVoid(ledger) && (
                      <IconButton
                        size="small"
                        onClick={() => handleVoidLedger(ledger)}
                        sx={{ color: 'text.secondary' }}
                        title="Void Entry"
                      >
                        <VoidIcon />
                      </IconButton>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {totalLedgers > PAGE_SIZE && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, px: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalLedgers)} of {totalLedgers} entries
          </Typography>
          <Pagination
            count={Math.ceil(totalLedgers / PAGE_SIZE)}
            page={currentPage}
            onChange={(_, page) => setCurrentPage(page)}
            color="primary"
            size="small"
            showFirstButton
            showLastButton
          />
        </Stack>
      )}

      {ledgers.length === 0 && !loading && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            {totalLedgers === 0 ? 'No ledger entries yet' : 'No entries match your filters'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {totalLedgers === 0
              ? 'Create your first ledger entry using the "New Entry" button above'
              : 'Try adjusting your search or filter criteria'
            }
          </Typography>
        </Box>
      )}

      {/* Create Ledger Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Ledger Entry</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
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
                      setCreateFormData({
                        ...createFormData,
                        company_name: newValue.company_name,
                        company_registration_number: newValue.company_registration_number,
                        contact_person: newValue.contact_person,
                        contact_email: newValue.contact_email,
                        contact_phone: newValue.contact_phone,
                        billing_address_line1: newValue.billing_address_line1,
                      });
                    }
                  } else {
                    setSelectedCompany(null);
                    setCreateFormData({
                      ...createFormData,
                      company_name: '',
                    });
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
                          <Typography>{option.company_name}</Typography>
                          {option.contact_person && (
                            <Typography variant="caption" color="text.secondary">
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
                    required
                    label="Company Name"
                    placeholder="Type to search or add new company"
                    helperText="Select existing company or type new name"
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Registration Number"
                value={createFormData.company_registration_number || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, company_registration_number: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Contact Person"
                value={createFormData.contact_person || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, contact_person: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Contact Email"
                type="email"
                value={createFormData.contact_email || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, contact_email: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Contact Phone"
                value={createFormData.contact_phone || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, contact_phone: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Billing Address"
                value={createFormData.billing_address_line1 || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, billing_address_line1: e.target.value })}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                required
                label="Description"
                multiline
                rows={2}
                value={createFormData.description}
                onChange={(e) => setCreateFormData({ ...createFormData, description: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth required>
                <InputLabel>Expense Type</InputLabel>
                <Select
                  value={createFormData.expense_type}
                  label="Expense Type"
                  onChange={(e) => setCreateFormData({ ...createFormData, expense_type: e.target.value })}
                >
                  {EXPENSE_TYPES.map((type) => (
                    <MenuItem key={type.value} value={type.value}>
                      {type.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                required
                label="Amount"
                type="number"
                value={createFormData.amount}
                onChange={(e) => setCreateFormData({ ...createFormData, amount: parseFloat(e.target.value) || 0 })}
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Invoice Date"
                type="date"
                value={createFormData.invoice_date || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, invoice_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Due Date"
                type="date"
                value={createFormData.due_date || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, due_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={2}
                value={createFormData.notes || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateDialogOpen(false); resetCreateForm(); }}>Cancel</Button>
          <Button
            onClick={handleCreateLedger}
            variant="contained"
            disabled={creating || !createFormData.company_name || !createFormData.description || createFormData.amount <= 0}
          >
            {creating ? 'Creating...' : 'Create Entry'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Ledger Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Ledger Entry - {editingLedger?.invoice_number || `#${editingLedger?.id}`}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Company Name"
                value={editFormData.company_name || ''}
                onChange={(e) => setEditFormData({ ...editFormData, company_name: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Registration Number"
                value={editFormData.company_registration_number || ''}
                onChange={(e) => setEditFormData({ ...editFormData, company_registration_number: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Contact Person"
                value={editFormData.contact_person || ''}
                onChange={(e) => setEditFormData({ ...editFormData, contact_person: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Contact Email"
                type="email"
                value={editFormData.contact_email || ''}
                onChange={(e) => setEditFormData({ ...editFormData, contact_email: e.target.value })}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={2}
                value={editFormData.description || ''}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth>
                <InputLabel>Expense Type</InputLabel>
                <Select
                  value={editFormData.expense_type || ''}
                  label="Expense Type"
                  onChange={(e) => setEditFormData({ ...editFormData, expense_type: e.target.value })}
                >
                  {EXPENSE_TYPES.map((type) => (
                    <MenuItem key={type.value} value={type.value}>
                      {type.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={editFormData.status || ''}
                  label="Status"
                  onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                >
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="partial">Partial</MenuItem>
                  <MenuItem value="paid">Paid</MenuItem>
                  <MenuItem value="overdue">Overdue</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Due Date"
                type="date"
                value={editFormData.due_date || ''}
                onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={2}
                value={editFormData.notes || ''}
                onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Internal Notes (Staff Only)"
                multiline
                rows={2}
                value={editFormData.internal_notes || ''}
                onChange={(e) => setEditFormData({ ...editFormData, internal_notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateLedger} variant="contained" disabled={updating}>
            {updating ? 'Updating...' : 'Update Entry'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Void Ledger Dialog */}
      <Dialog open={voidDialogOpen} onClose={() => setVoidDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Void Ledger Entry</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            Voiding a ledger entry marks it as cancelled and removes its outstanding balance. This is reversible only by reactivating from the database.
          </Alert>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2"><strong>Company:</strong> {voidingLedger?.company_name}</Typography>
            <Typography variant="body2"><strong>Amount:</strong> {formatCurrency(parseFloat(String(voidingLedger?.amount || 0)))}</Typography>
            <Typography variant="body2"><strong>Description:</strong> {voidingLedger?.description}</Typography>
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
          <Button onClick={handleConfirmVoidLedger} variant="contained" color="error" disabled={voiding}>
            {voiding ? 'Voiding...' : 'Void Entry'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onClose={() => setPaymentDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Payment - {paymentLedger?.company_name}
        </DialogTitle>
        <DialogContent>
          <Tabs value={paymentTab} onChange={(e, v) => setPaymentTab(v)} sx={{ mb: 2 }}>
            <Tab label="Record Payment" />
            <Tab label="Payment History" />
          </Tabs>

          {paymentTab === 0 && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>Total Amount:</strong> {formatCurrency(parseFloat(String(paymentLedger?.amount || 0)))}<br />
                  <strong>Already Paid:</strong> {formatCurrency(parseFloat(String(paymentLedger?.paid_amount || 0)))}<br />
                  <strong>Balance Due:</strong> {formatCurrency(parseFloat(String(paymentLedger?.balance_due || 0)))}
                </Typography>
              </Alert>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    required
                    label="Payment Amount"
                    type="number"
                    value={paymentFormData.payment_amount}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_amount: parseFloat(e.target.value) || 0 })}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                    }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth required>
                    <InputLabel>Payment Method</InputLabel>
                    <Select
                      value={paymentFormData.payment_method}
                      label="Payment Method"
                      onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_method: e.target.value })}
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <MenuItem key={method.value} value={method.value}>
                          {method.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Payment Reference"
                    value={paymentFormData.payment_reference || ''}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_reference: e.target.value })}
                    placeholder="Transaction ID, cheque number, etc."
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Receipt Number"
                    value={paymentFormData.receipt_number || ''}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, receipt_number: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Payment Date"
                    type="date"
                    value={paymentFormData.payment_date || ''}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_date: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid size={12}>
                  <TextField
                    fullWidth
                    label="Notes"
                    multiline
                    rows={2}
                    value={paymentFormData.notes || ''}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, notes: e.target.value })}
                  />
                </Grid>
              </Grid>
            </Box>
          )}

          {paymentTab === 1 && (
            <Box>
              {paymentHistory.length === 0 ? (
                <Typography color="text.secondary" textAlign="center" py={3}>
                  No payment history yet
                </Typography>
              ) : (
                <List>
                  {paymentHistory.map((payment, index) => (
                    <React.Fragment key={payment.id}>
                      <ListItem
                        secondaryAction={
                          editingPaymentId === payment.id ? (
                            <Box display="flex" gap={0.5}>
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => handleSavePaymentDate(payment)}
                                disabled={savingPaymentDate}
                              >
                                {savingPaymentDate ? <CircularProgress size={16} /> : <SaveIcon fontSize="small" />}
                              </IconButton>
                              <IconButton
                                size="small"
                                onClick={() => setEditingPaymentId(null)}
                              >
                                <CloseIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          ) : (
                            <Box display="flex" gap={0.5}>
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => {
                                  setEditingPaymentId(payment.id);
                                  setEditingPaymentDate(formatDateForInput(payment.payment_date));
                                }}
                                title="Edit payment date"
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={async () => {
                                  if (!paymentLedger) return;
                                  if (!window.confirm('Are you sure you want to delete this payment?')) return;
                                  try {
                                    await HotelAPIService.deleteLedgerPayment(paymentLedger.id, payment.id);
                                    setSnackbarMessage('Payment deleted successfully');
                                    setSnackbarOpen(true);
                                    // Refresh payment history
                                    const payments = await HotelAPIService.getLedgerPayments(paymentLedger.id);
                                    setPaymentHistory(payments);
                                    await loadData();
                                  } catch (error: any) {
                                    setSnackbarMessage(error.message || 'Failed to delete payment');
                                    setSnackbarOpen(true);
                                  }
                                }}
                                title="Delete payment"
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          )
                        }
                      >
                        <ListItemText
                          primary={
                            <Box display="flex" justifyContent="space-between" alignItems="center" pr={6}>
                              <Typography variant="body1" fontWeight="medium">
                                {formatCurrency(parseFloat(String(payment.payment_amount)))}
                              </Typography>
                              <Chip label={payment.payment_method} size="small" variant="outlined" />
                            </Box>
                          }
                          secondary={
                            <>
                              {editingPaymentId === payment.id ? (
                                <TextField
                                  size="small"
                                  type="date"
                                  label="Payment Date"
                                  value={editingPaymentDate}
                                  onChange={(e) => setEditingPaymentDate(e.target.value)}
                                  InputLabelProps={{ shrink: true }}
                                  sx={{ mt: 1 }}
                                />
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  {new Date(payment.payment_date).toLocaleString()}
                                </Typography>
                              )}
                              {payment.payment_reference && (
                                <Typography variant="caption" color="text.secondary">
                                  Ref: {payment.payment_reference}
                                </Typography>
                              )}
                              {payment.notes && (
                                <Typography variant="caption" display="block" color="text.secondary">
                                  {payment.notes}
                                </Typography>
                              )}
                            </>
                          }
                        />
                      </ListItem>
                      {index < paymentHistory.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                </List>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialogOpen(false)}>Close</Button>
          {paymentTab === 0 && (
            <Button
              onClick={handleRecordPayment}
              variant="contained"
              disabled={processingPayment || paymentFormData.payment_amount <= 0}
            >
              {processingPayment ? 'Processing...' : 'Record Payment'}
            </Button>
          )}
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
                value={newCompanyData.billing_address_line1 || ''}
                onChange={(e) => setNewCompanyData({ ...newCompanyData, billing_address_line1: e.target.value })}
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

      {/* Receipt Review & Print Dialog (one-by-one) */}
      <Dialog open={printDialogOpen} onClose={() => setPrintDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={1}>
              <ReceiptIcon color="primary" />
              <Typography variant="h6">
                {printingCompany} - Receipts
              </Typography>
            </Box>
            <Box display="flex" gap={1}>
              {companyLedgerEntries.length > 0 && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<PrintIcon />}
                  onClick={() => handlePrintSingleReceipt(companyLedgerEntries[currentReceiptIndex])}
                >
                  Print This Receipt
                </Button>
              )}
              <Button
                variant="outlined"
                size="small"
                startIcon={<PrintIcon />}
                onClick={handlePrint}
              >
                Print All
              </Button>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent>
          {companyLedgerEntries.length === 0 ? (
            <Alert severity="info">No ledger entries found for this company.</Alert>
          ) : (
            <>
              {/* Navigation Bar */}
              <Box display="flex" alignItems="center" justifyContent="center" gap={2} sx={{ mb: 2 }}>
                <IconButton
                  onClick={() => setCurrentReceiptIndex(Math.max(0, currentReceiptIndex - 1))}
                  disabled={currentReceiptIndex === 0}
                >
                  <PrevIcon />
                </IconButton>
                <Typography variant="body1" fontWeight="medium">
                  Receipt {currentReceiptIndex + 1} of {companyLedgerEntries.length}
                </Typography>
                <IconButton
                  onClick={() => setCurrentReceiptIndex(Math.min(companyLedgerEntries.length - 1, currentReceiptIndex + 1))}
                  disabled={currentReceiptIndex === companyLedgerEntries.length - 1}
                >
                  <NextIcon />
                </IconButton>
              </Box>

              {/* Thumbnail Strip */}
              <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 2, mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                {companyLedgerEntries.map((entry, idx) => (
                  <Paper
                    key={entry.id}
                    variant={idx === currentReceiptIndex ? 'elevation' : 'outlined'}
                    elevation={idx === currentReceiptIndex ? 4 : 0}
                    onClick={() => setCurrentReceiptIndex(idx)}
                    sx={{
                      p: 1,
                      minWidth: 120,
                      cursor: 'pointer',
                      bgcolor: idx === currentReceiptIndex ? 'primary.50' : 'background.paper',
                      border: idx === currentReceiptIndex ? '2px solid' : '1px solid',
                      borderColor: idx === currentReceiptIndex ? 'primary.main' : 'divider',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Typography variant="caption" fontWeight="bold" noWrap>
                      {entry.invoice_number || `#${entry.id}`}
                    </Typography>
                    <Typography variant="caption" display="block" color="text.secondary" noWrap>
                      {formatCurrency(parseFloat(String(entry.amount)))}
                    </Typography>
                    <Chip
                      label={getStatusText(entry.status)}
                      color={getStatusColor(entry.status)}
                      size="small"
                      sx={{ mt: 0.5, height: 18, fontSize: '0.65rem' }}
                    />
                  </Paper>
                ))}
              </Box>

              {/* Current Receipt Detail */}
              {(() => {
                const entry = companyLedgerEntries[currentReceiptIndex];
                if (!entry) return null;
                return (
                  <Box>
                    {/* Receipt Header */}
                    <Box sx={{ textAlign: 'center', mb: 3, borderBottom: '2px solid #333', pb: 2 }}>
                      <Typography variant="h5" fontWeight="bold">{hotelSettings.hotel_name}</Typography>
                      <Typography variant="subtitle1" color="text.secondary">Payment Receipt</Typography>
                    </Box>

                    {/* Receipt Details */}
                    <Grid container spacing={2}>
                      <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">Receipt / Invoice #</Typography>
                        <Typography variant="body1" fontWeight="bold">
                          {entry.invoice_number || `LED-${entry.id}`}
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">Company</Typography>
                        <Typography variant="body1" fontWeight="bold">{entry.company_name}</Typography>
                      </Grid>
                      <Grid size={12}>
                        <Typography variant="caption" color="text.secondary">Description</Typography>
                        <Typography variant="body1">{entry.description}</Typography>
                      </Grid>
                      <Grid size={4}>
                        <Typography variant="caption" color="text.secondary">Expense Type</Typography>
                        <Typography variant="body1">
                          {EXPENSE_TYPES.find(t => t.value === entry.expense_type)?.label || entry.expense_type}
                        </Typography>
                      </Grid>
                      <Grid size={4}>
                        <Typography variant="caption" color="text.secondary">Date Created</Typography>
                        <Typography variant="body1">{formatDateForDisplay(entry.created_at)}</Typography>
                      </Grid>
                      <Grid size={4}>
                        <Typography variant="caption" color="text.secondary">Status</Typography>
                        <Box>
                          <Chip
                            label={getStatusText(entry.status)}
                            color={getStatusColor(entry.status)}
                            size="small"
                          />
                        </Box>
                      </Grid>
                      {entry.payment_date && (
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Payment Date</Typography>
                          <Typography variant="body1">{formatDateForDisplay(entry.payment_date)}</Typography>
                        </Grid>
                      )}
                      {entry.payment_method && (
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Payment Method</Typography>
                          <Typography variant="body1">
                            {PAYMENT_METHODS.find(m => m.value === entry.payment_method)?.label || entry.payment_method}
                          </Typography>
                        </Grid>
                      )}
                      {entry.payment_reference && (
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Payment Reference</Typography>
                          <Typography variant="body1">{entry.payment_reference}</Typography>
                        </Grid>
                      )}
                    </Grid>

                    {/* Amount Section */}
                    <Paper sx={{ mt: 3, p: 2, bgcolor: 'grey.50' }}>
                      <Grid container spacing={1}>
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                          <Typography variant="h6" fontWeight="bold">
                            {formatCurrency(parseFloat(String(entry.amount)))}
                          </Typography>
                        </Grid>
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Paid Amount</Typography>
                          <Typography variant="h6" fontWeight="bold" color="success.main">
                            {formatCurrency(parseFloat(String(entry.paid_amount)))}
                          </Typography>
                        </Grid>
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Balance Due</Typography>
                          <Typography
                            variant="h6"
                            fontWeight="bold"
                            color={parseFloat(String(entry.balance_due)) > 0 ? 'error.main' : 'success.main'}
                          >
                            {formatCurrency(parseFloat(String(entry.balance_due)))}
                          </Typography>
                        </Grid>
                      </Grid>
                    </Paper>

                    {entry.notes && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">Notes</Typography>
                        <Typography variant="body2">{entry.notes}</Typography>
                      </Box>
                    )}

                    <Box sx={{ mt: 3, textAlign: 'center', color: 'text.secondary' }}>
                      <Typography variant="caption">
                        Generated on {new Date().toLocaleString()} | {hotelSettings.hotel_name} - Hotel Management System
                      </Typography>
                    </Box>
                  </Box>
                );
              })()}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrintDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Company Check-In Dialog */}
      <Dialog
        open={checkInDialogOpen}
        onClose={() => { setCheckInDialogOpen(false); resetCheckInForm(); }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <CheckInIcon color="success" />
            Company Check-In
          </Box>
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 0.5 }}>
            {/* Company Selection */}
            <Grid size={12}>
              <Autocomplete
                value={checkInCompany}
                onChange={(event, newValue) => {
                  setCheckInCompany(newValue);
                  if (newValue) {
                    loadCompanyBookings(newValue.id);
                  } else {
                    setCompanyBookings([]);
                  }
                }}
                options={companies}
                getOptionLabel={(option) => option.company_name}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderOption={(props, option) => {
                  const { key, ...otherProps } = props;
                  return (
                    <li key={key} {...otherProps}>
                      <Box>
                        <Typography fontWeight="medium">{option.company_name}</Typography>
                        {option.contact_person && (
                          <Typography variant="caption" color="text.secondary">
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
                    required
                    label="Select Company"
                    placeholder="Search for a company"
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <>
                          <BusinessIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                          {params.InputProps.startAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
            </Grid>

            {/* Company Info */}
            {checkInCompany && (
              <Grid size={12}>
                <Alert severity="info" icon={<BusinessIcon />}>
                  <Typography variant="subtitle2">{checkInCompany.company_name}</Typography>
                  {checkInCompany.contact_person && (
                    <Typography variant="body2">Contact: {checkInCompany.contact_person}</Typography>
                  )}
                  {checkInCompany.contact_email && (
                    <Typography variant="body2">Email: {checkInCompany.contact_email}</Typography>
                  )}
                  {companyBookings.length > 0 && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Active Bookings: {companyBookings.filter(b => b.status === 'checked_in').length}
                    </Typography>
                  )}
                </Alert>
              </Grid>
            )}

            <Grid size={12}>
              <Divider>
                <Chip label="Guest Details" size="small" />
              </Divider>
            </Grid>

            {/* Guest Selection */}
            <Grid size={12}>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <Button
                  variant={!isCreatingNewCheckInGuest ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => setIsCreatingNewCheckInGuest(false)}
                >
                  Select Existing Guest
                </Button>
                <Button
                  variant={isCreatingNewCheckInGuest ? 'contained' : 'outlined'}
                  size="small"
                  startIcon={<PersonAddIcon />}
                  onClick={() => setIsCreatingNewCheckInGuest(true)}
                >
                  New Guest
                </Button>
              </Box>

              {!isCreatingNewCheckInGuest ? (
                <Autocomplete
                  value={checkInGuest}
                  onChange={(event, newValue) => setCheckInGuest(newValue)}
                  options={guests}
                  getOptionLabel={(option) => option.full_name}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderOption={(props, option) => {
                    const { key, ...otherProps } = props;
                    return (
                      <li key={key} {...otherProps}>
                        <Box>
                          <Typography>{option.full_name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {option.email} {option.phone && `| ${option.phone}`}
                          </Typography>
                        </Box>
                      </li>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Select Guest"
                      placeholder="Search for a guest"
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: (
                          <>
                            <PersonIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                            {params.InputProps.startAdornment}
                          </>
                        ),
                      }}
                    />
                  )}
                />
              ) : (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      required
                      label="First Name"
                      value={newCheckInGuestForm.first_name}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, first_name: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      required
                      label="Last Name"
                      value={newCheckInGuestForm.last_name}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, last_name: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Email (Optional)"
                      type="email"
                      value={newCheckInGuestForm.email}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, email: e.target.value })}
                      helperText="Used for sending booking confirmations and invoices"
                      error={newCheckInGuestForm.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCheckInGuestForm.email)}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Phone"
                      value={newCheckInGuestForm.phone}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, phone: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="IC/Passport Number"
                      value={newCheckInGuestForm.ic_number}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, ic_number: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Nationality"
                      value={newCheckInGuestForm.nationality}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, nationality: e.target.value })}
                      placeholder="e.g. Malaysian"
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      fullWidth
                      label="Address"
                      value={newCheckInGuestForm.address_line1}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, address_line1: e.target.value })}
                      placeholder="Street address"
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="City"
                      value={newCheckInGuestForm.city}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, city: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="State/Province"
                      value={newCheckInGuestForm.state_province}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, state_province: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Postal Code"
                      value={newCheckInGuestForm.postal_code}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, postal_code: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Country"
                      value={newCheckInGuestForm.country}
                      onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, country: e.target.value })}
                    />
                  </Grid>
                </Grid>
              )}
            </Grid>

            <Grid size={12}>
              <Divider>
                <Chip label="Room & Dates" size="small" />
              </Divider>
            </Grid>

            {/* Dates */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                required
                label="Check-In Date"
                type="date"
                value={checkInDate}
                onChange={(e) => handleCheckInDateChange(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                required
                label="Check-Out Date"
                type="date"
                value={checkOutDate}
                onChange={(e) => handleCheckOutDateChange(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: checkInDate }}
              />
            </Grid>

            {/* Room Selection */}
            <Grid size={12}>
              <Autocomplete
                value={checkInRoom}
                onChange={(event, newValue) => setCheckInRoom(newValue)}
                options={availableRooms}
                getOptionLabel={(option) => `Room ${option.room_number} - ${option.room_type}`}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderOption={(props, option) => {
                  const { key, ...otherProps } = props;
                  const price = typeof option.price_per_night === 'string'
                    ? parseFloat(option.price_per_night)
                    : option.price_per_night;
                  return (
                    <li key={key} {...otherProps}>
                      <Box display="flex" justifyContent="space-between" width="100%">
                        <Box>
                          <Typography fontWeight="medium">Room {option.room_number}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {option.room_type} | Max: {option.max_occupancy} guests
                          </Typography>
                        </Box>
                        <Typography color="primary.main" fontWeight="medium">
                          {formatCurrency(price)}/night
                        </Typography>
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    required
                    label="Select Room"
                    placeholder="Choose an available room"
                    helperText={availableRooms.length === 0 ? 'No rooms available for selected dates' : `${availableRooms.length} room(s) available`}
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <>
                          <HotelIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                          {params.InputProps.startAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
            </Grid>

            {/* Summary */}
            {checkInCompany && checkInRoom && (checkInGuest || (isCreatingNewCheckInGuest && newCheckInGuestForm.first_name)) && (
              <Grid size={12}>
                <Alert severity="success">
                  <Typography variant="subtitle2">Ready to Check-In</Typography>
                  <Typography variant="body2">
                    Guest: {isCreatingNewCheckInGuest ? `${newCheckInGuestForm.first_name} ${newCheckInGuestForm.last_name}` : checkInGuest?.full_name}
                  </Typography>
                  <Typography variant="body2">
                    Email: {isCreatingNewCheckInGuest ? newCheckInGuestForm.email : checkInGuest?.email}
                  </Typography>
                  <Typography variant="body2">
                    Room: {checkInRoom.room_number} ({checkInRoom.room_type})
                  </Typography>
                  <Typography variant="body2">
                    Company: {checkInCompany.company_name}
                  </Typography>
                  <Typography variant="body2">
                    Dates: {formatDateForDisplay(checkInDate)} to {formatDateForDisplay(checkOutDate)}
                  </Typography>
                </Alert>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCheckInDialogOpen(false); resetCheckInForm(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleCompanyCheckIn}
            variant="contained"
            color="success"
            disabled={
              processingCheckIn ||
              !checkInCompany ||
              !checkInRoom ||
              (!checkInGuest && !isCreatingNewCheckInGuest) ||
              (isCreatingNewCheckInGuest && (
                !newCheckInGuestForm.first_name ||
                !newCheckInGuestForm.last_name ||
                (newCheckInGuestForm.email && newCheckInGuestForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCheckInGuestForm.email))
              ))
            }
            startIcon={processingCheckIn ? <CircularProgress size={20} /> : <CheckInIcon />}
          >
            {processingCheckIn ? 'Processing...' : 'Check-In Guest'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Checkout Invoice Modal */}
      <CheckoutInvoiceModal
        open={checkoutDialogOpen}
        onClose={() => {
          setCheckoutDialogOpen(false);
          setCheckoutBooking(null);
        }}
        booking={checkoutBooking}
        onConfirmCheckout={handleConfirmCompanyCheckout}
      />

      {/* Read-only invoice for ledger entries linked to a booking */}
      <CheckoutInvoiceModal
        open={ledgerInvoiceOpen}
        onClose={() => {
          setLedgerInvoiceOpen(false);
          setLedgerInvoiceBooking(null);
        }}
        booking={ledgerInvoiceBooking}
        readOnly
      />

      {/* Company Registration Dialog */}
      <Dialog
        open={companyRegDialogOpen}
        onClose={() => { setCompanyRegDialogOpen(false); resetCompanyRegForm(); }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <BusinessIcon color="primary" />
            Register New Company
          </Box>
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {/* Company Basic Info */}
            <Grid size={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Company Information
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                required
                label="Company Name"
                value={companyRegForm.company_name}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, company_name: e.target.value })}
                placeholder="Enter company name"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Registration Number"
                value={companyRegForm.registration_number}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, registration_number: e.target.value })}
                placeholder="Business registration number"
              />
            </Grid>

            {/* Contact Information */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Contact Information
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Contact Person"
                value={companyRegForm.contact_person}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, contact_person: e.target.value })}
                placeholder="Primary contact name"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Contact Email"
                type="email"
                value={companyRegForm.contact_email}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, contact_email: e.target.value })}
                placeholder="email@company.com"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Contact Phone"
                value={companyRegForm.contact_phone}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, contact_phone: e.target.value })}
                placeholder="+60 12-345 6789"
              />
            </Grid>

            {/* Billing Address */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Billing Address
              </Typography>
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Street Address"
                value={companyRegForm.billing_address}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, billing_address: e.target.value })}
                placeholder="Street address, building, floor"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="City"
                value={companyRegForm.billing_city}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, billing_city: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="State"
                value={companyRegForm.billing_state}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, billing_state: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Postal Code"
                value={companyRegForm.billing_postal_code}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, billing_postal_code: e.target.value })}
              />
            </Grid>

            {/* Billing Terms */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Billing Terms
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Credit Limit"
                type="number"
                value={companyRegForm.credit_limit}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, credit_limit: e.target.value })}
                placeholder="0.00"
                InputProps={{
                  startAdornment: <Typography sx={{ mr: 1 }}>{currencySymbol}</Typography>,
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Payment Terms (Days)"
                type="number"
                value={companyRegForm.payment_terms_days}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, payment_terms_days: e.target.value })}
                helperText="Number of days for payment after invoice"
              />
            </Grid>

            {/* Notes */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Notes"
                value={companyRegForm.notes}
                onChange={(e) => setCompanyRegForm({ ...companyRegForm, notes: e.target.value })}
                placeholder="Additional notes about this company..."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCompanyRegDialogOpen(false); resetCompanyRegForm(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleRegisterCompany}
            variant="contained"
            disabled={creatingCompany || !companyRegForm.company_name.trim()}
            startIcon={creatingCompany ? <CircularProgress size={20} /> : <AddIcon />}
          >
            {creatingCompany ? 'Registering...' : 'Register Company'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Company Dialog */}
      <Dialog
        open={companyEditDialogOpen}
        onClose={() => { setCompanyEditDialogOpen(false); resetCompanyEditForm(); }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <EditIcon color="primary" />
            Edit Company
          </Box>
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {/* Company Basic Info */}
            <Grid size={12}>
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Company Information
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                required
                label="Company Name"
                value={companyEditForm.company_name}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, company_name: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Registration Number"
                value={companyEditForm.registration_number}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, registration_number: e.target.value })}
              />
            </Grid>

            {/* Contact Information */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Contact Information
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Contact Person"
                value={companyEditForm.contact_person}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, contact_person: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Contact Email"
                type="email"
                value={companyEditForm.contact_email}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, contact_email: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Contact Phone"
                value={companyEditForm.contact_phone}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, contact_phone: e.target.value })}
              />
            </Grid>

            {/* Billing Address */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Billing Address
              </Typography>
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Street Address"
                value={companyEditForm.billing_address}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, billing_address: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="City"
                value={companyEditForm.billing_city}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, billing_city: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="State"
                value={companyEditForm.billing_state}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, billing_state: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Postal Code"
                value={companyEditForm.billing_postal_code}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, billing_postal_code: e.target.value })}
              />
            </Grid>

            {/* Billing Terms */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" color="primary" gutterBottom>
                Billing Terms
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Credit Limit"
                type="number"
                value={companyEditForm.credit_limit}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, credit_limit: e.target.value })}
                InputProps={{
                  startAdornment: <Typography sx={{ mr: 1 }}>{currencySymbol}</Typography>,
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Payment Terms (Days)"
                type="number"
                value={companyEditForm.payment_terms_days}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, payment_terms_days: e.target.value })}
              />
            </Grid>

            {/* Notes */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Notes"
                value={companyEditForm.notes}
                onChange={(e) => setCompanyEditForm({ ...companyEditForm, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCompanyEditDialogOpen(false); resetCompanyEditForm(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdateCompany}
            variant="contained"
            disabled={updatingCompany || !companyEditForm.company_name.trim()}
            startIcon={updatingCompany ? <CircularProgress size={20} /> : <EditIcon />}
          >
            {updatingCompany ? 'Updating...' : 'Update Company'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Company Confirmation Dialog */}
      <Dialog
        open={companyDeleteDialogOpen}
        onClose={() => { setCompanyDeleteDialogOpen(false); setDeletingCompanyData(null); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <DeleteIcon color="error" />
            Delete Company
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This action cannot be undone.
          </Alert>
          <Typography>
            Are you sure you want to delete the company <strong>"{deletingCompanyData?.company_name}"</strong>?
          </Typography>
          {deletingCompanyData && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                <strong>Contact:</strong> {deletingCompanyData.contact_person || 'N/A'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Email:</strong> {deletingCompanyData.contact_email || 'N/A'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Phone:</strong> {deletingCompanyData.contact_phone || 'N/A'}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCompanyDeleteDialogOpen(false); setDeletingCompanyData(null); }}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteCompany}
            variant="contained"
            color="error"
            disabled={deletingCompany}
            startIcon={deletingCompany ? <CircularProgress size={20} /> : <DeleteIcon />}
          >
            {deletingCompany ? 'Deleting...' : 'Delete Company'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog
        open={companyPaymentDialogOpen}
        onClose={() => { setCompanyPaymentDialogOpen(false); resetCompanyPaymentForm(); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <PaymentIcon color="primary" />
            Record Payment
          </Box>
        </DialogTitle>
        <DialogContent>
          {paymentCompany && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" fontWeight={600}>
                {paymentCompany.company_name}
              </Typography>
              {paymentCompany.contact_person && (
                <Typography variant="caption">Contact: {paymentCompany.contact_person}</Typography>
              )}
            </Alert>
          )}

          {paymentCompanyLedgers.length === 0 ? (
            <Alert severity="warning">
              No outstanding ledger entries found for this company.
            </Alert>
          ) : (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              {/* Select Ledger Entries */}
              <Grid size={12}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Select Ledger Entries</Typography>
                <Paper variant="outlined" sx={{ maxHeight: 220, overflow: 'auto' }}>
                  {/* Select All */}
                  <Box sx={{ px: 2, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={selectedLedgersForPayment.length === paymentCompanyLedgers.length}
                          indeterminate={selectedLedgersForPayment.length > 0 && selectedLedgersForPayment.length < paymentCompanyLedgers.length}
                          onChange={(e) => setSelectedLedgersForPayment(e.target.checked ? [...paymentCompanyLedgers] : [])}
                        />
                      }
                      label={<Typography variant="body2" fontWeight={600}>Select All</Typography>}
                    />
                  </Box>
                  {paymentCompanyLedgers.map((ledger) => {
                    const amount = typeof ledger.amount === 'string' ? parseFloat(ledger.amount) : ledger.amount;
                    const balanceDue = typeof ledger.balance_due === 'string' ? parseFloat(ledger.balance_due) : (ledger.balance_due || amount);
                    const isSelected = selectedLedgersForPayment.some(l => l.id === ledger.id);
                    return (
                      <Box
                        key={ledger.id}
                        sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', '&:hover': { bgcolor: 'grey.50' } }}
                      >
                        <FormControlLabel
                          sx={{ flex: 1, mr: 0 }}
                          control={
                            <Checkbox
                              size="small"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedLedgersForPayment(prev =>
                                  isSelected ? prev.filter(l => l.id !== ledger.id) : [...prev, ledger]
                                );
                              }}
                            />
                          }
                          label={
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                              <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                                {ledger.description}
                              </Typography>
                              <Typography variant="body2" color="error.main" fontWeight={600} sx={{ ml: 2, whiteSpace: 'nowrap' }}>
                                Due: {formatCurrency(balanceDue)}
                              </Typography>
                            </Box>
                          }
                        />
                      </Box>
                    );
                  })}
                </Paper>
              </Grid>

              {/* Selected Entries Summary */}
              {selectedLedgersForPayment.length > 0 && (
                <Grid size={12}>
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <Grid container spacing={1}>
                      <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">Selected Entries</Typography>
                        <Typography variant="body2">{selectedLedgersForPayment.length} of {paymentCompanyLedgers.length} entries</Typography>
                      </Grid>
                      <Grid size={3}>
                        <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                        <Typography variant="body2">
                          {formatCurrency(selectedLedgersForPayment.reduce((sum, l) => {
                            const amt = typeof l.amount === 'string' ? parseFloat(l.amount) : l.amount;
                            return sum + amt;
                          }, 0))}
                        </Typography>
                      </Grid>
                      <Grid size={3}>
                        <Typography variant="caption" color="text.secondary">Total Balance Due</Typography>
                        <Typography variant="body2" color="error.main" fontWeight={600}>
                          {formatCurrency(selectedLedgersForPayment.reduce((sum, l) => {
                            const amt = typeof l.amount === 'string' ? parseFloat(l.amount) : l.amount;
                            const bal = typeof l.balance_due === 'string' ? parseFloat(l.balance_due) : (l.balance_due || amt);
                            return sum + bal;
                          }, 0))}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Paper>
                </Grid>
              )}

              {/* Payment Amount */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="Payment Amount"
                  type="number"
                  value={companyPaymentForm.payment_amount}
                  onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, payment_amount: e.target.value })}
                  InputProps={{
                    startAdornment: <Typography sx={{ mr: 1 }}>{currencySymbol}</Typography>,
                  }}
                />
              </Grid>

              {/* Payment Method */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  fullWidth
                  label="Payment Method"
                  value={companyPaymentForm.payment_method}
                  onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, payment_method: e.target.value })}
                >
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="credit_card">Credit Card</MenuItem>
                  <MenuItem value="cheque">Cheque</MenuItem>
                  <MenuItem value="online">Online Payment</MenuItem>
                </TextField>
              </Grid>

              {/* Payment Reference */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Payment Reference"
                  value={companyPaymentForm.payment_reference}
                  onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, payment_reference: e.target.value })}
                  placeholder="Transaction ID, cheque number, etc."
                />
              </Grid>

              {/* Receipt Number */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Receipt Number"
                  value={companyPaymentForm.receipt_number}
                  onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, receipt_number: e.target.value })}
                />
              </Grid>

              {/* Payment Date */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Payment Date"
                  type="date"
                  value={companyPaymentForm.payment_date}
                  onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, payment_date: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>

              {/* Notes */}
              <Grid size={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="Notes"
                  value={companyPaymentForm.notes}
                  onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, notes: e.target.value })}
                  placeholder="Additional notes about this payment..."
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCompanyPaymentDialogOpen(false); resetCompanyPaymentForm(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleRecordCompanyPayment}
            variant="contained"
            disabled={processingCompanyPayment || selectedLedgersForPayment.length === 0 || !companyPaymentForm.payment_amount}
            startIcon={processingCompanyPayment ? <CircularProgress size={20} /> : <PaymentIcon />}
          >
            {processingCompanyPayment ? 'Processing...' : 'Record Payment'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Company Invoice Dialog */}
      <Dialog
        open={companyInvoiceDialogOpen}
        onClose={() => { setCompanyInvoiceDialogOpen(false); resetCompanyInvoiceForm(); }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <InvoiceIcon color="secondary" />
            {showInvoicePreview ? 'Invoice Preview' : 'Generate Company Invoice'}
          </Box>
        </DialogTitle>
        <DialogContent>
          {invoiceCompany && !showInvoicePreview && (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2" fontWeight={600}>
                  {invoiceCompany.company_name}
                </Typography>
                {invoiceCompany.contact_person && (
                  <Typography variant="caption">Contact: {invoiceCompany.contact_person}</Typography>
                )}
              </Alert>

              {/* Invoice Details */}
              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    fullWidth
                    required
                    label="Invoice Number"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    fullWidth
                    required
                    label="Invoice Date"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    fullWidth
                    required
                    label="Due Date"
                    type="date"
                    value={invoiceDueDate}
                    onChange={(e) => setInvoiceDueDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>

                {/* Select Ledger Entries */}
                <Grid size={12}>
                  <Divider sx={{ my: 1 }} />
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      Select Ledger Entries to Include
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={selectedInvoiceLedgers.length === invoiceLedgerEntries.length && invoiceLedgerEntries.length > 0}
                          indeterminate={selectedInvoiceLedgers.length > 0 && selectedInvoiceLedgers.length < invoiceLedgerEntries.length}
                          onChange={handleSelectAllLedgers}
                        />
                      }
                      label="Select All"
                    />
                  </Box>
                </Grid>

                {invoiceLedgerEntries.length === 0 ? (
                  <Grid size={12}>
                    <Alert severity="warning">
                      No ledger entries found for this company.
                    </Alert>
                  </Grid>
                ) : (
                  <Grid size={12}>
                    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">Select</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell align="right">Balance</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {invoiceLedgerEntries.map((ledger) => {
                            const amount = typeof ledger.amount === 'string' ? parseFloat(ledger.amount) : ledger.amount;
                            const balanceDue = typeof ledger.balance_due === 'string' ? parseFloat(ledger.balance_due) : (ledger.balance_due || 0);
                            return (
                              <TableRow
                                key={ledger.id}
                                hover
                                selected={selectedInvoiceLedgers.includes(ledger.id)}
                                onClick={() => handleToggleLedgerSelection(ledger.id)}
                                sx={{ cursor: 'pointer' }}
                              >
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    checked={selectedInvoiceLedgers.includes(ledger.id)}
                                    onChange={() => handleToggleLedgerSelection(ledger.id)}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                    {ledger.description}
                                  </Typography>
                                  {ledger.invoice_number && (
                                    <Typography variant="caption" color="text.secondary">
                                      Inv: {ledger.invoice_number}
                                    </Typography>
                                  )}
                                </TableCell>
                                <TableCell>{formatDateForDisplay(ledger.created_at)}</TableCell>
                                <TableCell>
                                  <Chip label={getStatusText(ledger.status)} color={getStatusColor(ledger.status)} size="small" />
                                </TableCell>
                                <TableCell align="right">{formatCurrency(amount)}</TableCell>
                                <TableCell align="right">
                                  <Typography color={balanceDue > 0 ? 'error.main' : 'success.main'} fontWeight={500}>
                                    {formatCurrency(balanceDue)}
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>

                    {/* Summary */}
                    <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'grey.50' }}>
                      <Grid container spacing={2}>
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Selected Items</Typography>
                          <Typography variant="h6">{selectedInvoiceLedgers.length}</Typography>
                        </Grid>
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                          <Typography variant="h6" color="primary.main">
                            {formatCurrency(getSelectedLedgerTotal())}
                          </Typography>
                        </Grid>
                        <Grid size={4}>
                          <Typography variant="caption" color="text.secondary">Balance Due</Typography>
                          <Typography variant="h6" color="error.main">
                            {formatCurrency(getSelectedLedgerBalanceDue())}
                          </Typography>
                        </Grid>
                      </Grid>
                    </Paper>
                  </Grid>
                )}

                {/* Notes */}
                <Grid size={12}>
                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    label="Invoice Notes"
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    placeholder="Additional notes to include on the invoice..."
                  />
                </Grid>
              </Grid>
            </>
          )}

          {/* Invoice Preview */}
          {invoiceCompany && showInvoicePreview && (
            <Box id="company-invoice-content">
              {/* Invoice Header */}
              <Box
                className="invoice-header"
                sx={{
                  textAlign: 'center',
                  mb: 3,
                  pb: 2,
                  borderBottom: '3px solid #1976d2',
                }}
              >
                <Typography variant="h4" sx={{ fontWeight: 700, color: '#1976d2', mb: 0.5 }}>
                  {hotelSettings.hotel_name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {hotelSettings.hotel_address}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Phone: {hotelSettings.hotel_phone} | Email: {hotelSettings.hotel_email}
                </Typography>
              </Box>

              {/* Invoice Title Bar */}
              <Box
                sx={{
                  bgcolor: '#1976d2',
                  color: 'white',
                  py: 1,
                  px: 2,
                  mb: 3,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>
                  Invoice
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  #{invoiceNumber}
                </Typography>
              </Box>

              {/* Two-column: Bill To + Invoice Details */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
                {/* Bill To */}
                <Box sx={{ flex: 1 }}>
                  <Typography variant="overline" sx={{ color: '#1976d2', fontWeight: 700, letterSpacing: 1.5, display: 'block', mb: 1 }}>
                    Bill To
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{invoiceCompany.company_name}</Typography>
                  {invoiceCompany.registration_number && (
                    <Typography variant="body2" color="text.secondary">Reg No: {invoiceCompany.registration_number}</Typography>
                  )}
                  {invoiceCompany.billing_address && (
                    <Typography variant="body2">{invoiceCompany.billing_address}</Typography>
                  )}
                  {(invoiceCompany.billing_city || invoiceCompany.billing_state || invoiceCompany.billing_postal_code) && (
                    <Typography variant="body2">
                      {[invoiceCompany.billing_city, invoiceCompany.billing_state, invoiceCompany.billing_postal_code].filter(Boolean).join(', ')}
                    </Typography>
                  )}
                  {invoiceCompany.contact_person && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>Attn:</Box>
                      <Box component="span" sx={{ fontWeight: 600 }}>{invoiceCompany.contact_person}</Box>
                    </Typography>
                  )}
                  {invoiceCompany.contact_email && (
                    <Typography variant="body2">
                      <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>Email:</Box>
                      <Box component="span">{invoiceCompany.contact_email}</Box>
                    </Typography>
                  )}
                  {invoiceCompany.contact_phone && (
                    <Typography variant="body2">
                      <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>Phone:</Box>
                      <Box component="span">{invoiceCompany.contact_phone}</Box>
                    </Typography>
                  )}
                </Box>

                {/* Invoice Details */}
                <Box sx={{ minWidth: 220, textAlign: 'right' }}>
                  <Typography variant="overline" sx={{ color: '#1976d2', fontWeight: 700, letterSpacing: 1.5, display: 'block', mb: 1 }}>
                    Invoice Details
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>Invoice Date:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{formatDateForDisplay(invoiceDate)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>Due Date:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{formatDateForDisplay(invoiceDueDate)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>Terms:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{invoiceCompany.payment_terms_days || 30} days</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" sx={{ color: '#666' }}>Status:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, ml: 2, color: getSelectedLedgerBalanceDue() > 0 ? '#d32f2f' : '#2e7d32' }}>
                      {getSelectedLedgerBalanceDue() > 0 ? 'Outstanding' : 'Settled'}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Line Items Table */}
              <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #ddd', borderRadius: 0, mb: 0 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                        Description
                      </TableCell>
                      <TableCell sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                        Date
                      </TableCell>
                      <TableCell sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                        Room
                      </TableCell>
                      <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                        Amount
                      </TableCell>
                      <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                        Paid
                      </TableCell>
                      <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                        Balance
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {invoiceLedgerEntries
                      .filter(l => selectedInvoiceLedgers.includes(l.id))
                      .map((ledger, idx) => {
                        const amount = typeof ledger.amount === 'string' ? parseFloat(ledger.amount) : ledger.amount;
                        const paidAmount = typeof ledger.paid_amount === 'string' ? parseFloat(ledger.paid_amount) : (ledger.paid_amount || 0);
                        const balanceDue = typeof ledger.balance_due === 'string' ? parseFloat(ledger.balance_due) : (ledger.balance_due || 0);
                        return (
                          <TableRow key={ledger.id} sx={{ bgcolor: idx % 2 === 0 ? 'white' : '#fafafa' }}>
                            <TableCell sx={{ py: 1.5, fontSize: 13 }}>{ledger.description}</TableCell>
                            <TableCell sx={{ py: 1.5, fontSize: 13 }}>{formatDateForDisplay(ledger.created_at)}</TableCell>
                            <TableCell sx={{ py: 1.5, fontSize: 13 }}>{ledger.room_number || '-'}</TableCell>
                            <TableCell align="right" sx={{ py: 1.5, fontSize: 13, fontWeight: 600 }}>
                              {formatCurrency(amount)}
                            </TableCell>
                            <TableCell align="right" sx={{ py: 1.5, fontSize: 13, fontWeight: 600, color: '#2e7d32' }}>
                              {paidAmount > 0 ? formatCurrency(paidAmount) : '-'}
                            </TableCell>
                            <TableCell align="right" sx={{ py: 1.5, fontSize: 13, fontWeight: 600, color: balanceDue > 0 ? '#d32f2f' : '#2e7d32' }}>
                              {formatCurrency(balanceDue)}
                            </TableCell>
                          </TableRow>
                        );
                      })}

                    {/* Subtotal */}
                    <TableRow>
                      <TableCell colSpan={3} align="right" sx={{ borderTop: '2px solid #ddd', pt: 2, fontWeight: 600, fontSize: 13 }}>
                        Subtotal:
                      </TableCell>
                      <TableCell align="right" sx={{ borderTop: '2px solid #ddd', pt: 2, fontWeight: 700, fontSize: 13 }}>
                        {formatCurrency(getSelectedLedgerTotal())}
                      </TableCell>
                      <TableCell colSpan={2} sx={{ borderTop: '2px solid #ddd' }} />
                    </TableRow>

                    {/* Total Amount Due */}
                    <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                      <TableCell colSpan={5} align="right" sx={{ borderTop: '3px double #1976d2', py: 2 }}>
                        <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#1976d2' }}>
                          Total Amount Due:
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ borderTop: '3px double #1976d2', py: 2 }}>
                        <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#1976d2' }}>
                          {formatCurrency(getSelectedLedgerBalanceDue())}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Notes */}
              {invoiceNotes && (
                <Box sx={{ mt: 3, p: 2, bgcolor: '#fff3cd', borderLeft: '4px solid #ffc107', borderRadius: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ color: '#856404', mb: 0.5 }}>Notes:</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: '#856404' }}>
                    {invoiceNotes}
                  </Typography>
                </Box>
              )}

              {/* Footer */}
              <Box sx={{ mt: 5, pt: 2, borderTop: '1px solid #ddd', textAlign: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#1976d2', mb: 0.5 }}>
                  Thank you for your business!
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Please make payment within {invoiceCompany.payment_terms_days || 30} days of invoice date.
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                  This is a computer-generated invoice. | {hotelSettings.hotel_name}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {!showInvoicePreview ? (
            <>
              <Button onClick={() => { setCompanyInvoiceDialogOpen(false); resetCompanyInvoiceForm(); }}>
                Cancel
              </Button>
              <Button
                onClick={() => setShowInvoicePreview(true)}
                variant="contained"
                disabled={selectedInvoiceLedgers.length === 0 || !invoiceNumber}
                startIcon={<InvoiceIcon />}
              >
                Preview Invoice
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setShowInvoicePreview(false)}>
                Back to Edit
              </Button>
              <Button
                onClick={handlePrintCompanyInvoice}
                variant="outlined"
                startIcon={<PrintIcon />}
              >
                Print
              </Button>
              <Button
                onClick={handleDownloadCompanyInvoice}
                variant="contained"
                startIcon={<DownloadIcon />}
              >
                Download
              </Button>
            </>
          )}
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
    </Box>
  );
};

export default CustomerLedgerPage;
