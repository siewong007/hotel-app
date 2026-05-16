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
  IconButton,
  Grid,
  FormControl,
  InputLabel,
  Select,
  InputAdornment,
  Tabs,
  Tab,
  Divider,
  List,
  ListItem,
  ListItemText,
  Autocomplete,
  Checkbox,
  FormControlLabel,
  Menu,
  LinearProgress,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
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
  Search as SearchIcon,
  OpenInNew as OpenInNewIcon,
  ArrowDropDown as ArrowDropDownIcon,
  CreditScore as CreditNoteIcon,
  Replay as RegenerateIcon,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { HotelAPIService } from '../../../api';
import { api } from '../../../api/client';
import {
  CustomerLedger,
  CustomerLedgerCreateRequest,
  CustomerLedgerUpdateRequest,
  CustomerLedgerPayment,
  CustomerLedgerPaymentRequest,
  Room,
  Guest,
  BookingWithDetails,
} from '../../../types';
import type { Company } from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings, HotelSettings } from '../../../utils/hotelSettings';
import CheckoutInvoiceModal from '../../invoices/components/CheckoutInvoiceModal';
import { enhanceBookingDetails } from '../../../utils/bookingUtils';
import { useLedgers } from '../hooks/useLedgers';
import { ApiNotificationSeverity, emitApiNotification } from '../../../utils/apiNotifications';

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

type LedgerUiStatus =
  | 'draft'
  | 'ready_to_invoice'
  | 'invoiced'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'voided';

type EntryStatusFilter =
  | 'all'
  | 'uninvoiced'
  | 'outstanding'
  | 'invoiced'
  | 'paid'
  | 'overdue'
  | 'voided';

const asMoney = (value: number | string | null | undefined): number => {
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(parsed) ? Number(parsed) : 0;
};

const isLedgerVoided = (ledger: CustomerLedger) => Boolean(ledger.void_at) || ledger.status === 'cancelled';

const isDateOverdue = (dateString: string | null | undefined) => {
  if (!dateString) return false;
  const due = new Date(`${formatDateForInput(dateString)}T23:59:59`);
  return !isNaN(due.getTime()) && due.getTime() < Date.now();
};

const getLedgerUiStatus = (ledger: CustomerLedger): LedgerUiStatus => {
  const balance = asMoney(ledger.balance_due);
  const paid = asMoney(ledger.paid_amount);
  if (isLedgerVoided(ledger)) return 'voided';
  if (ledger.status === 'paid' || balance <= 0) return 'paid';
  if (ledger.status === 'overdue' || isDateOverdue(ledger.due_date)) return 'overdue';
  if (paid > 0) return 'partial';
  if (ledger.invoice_number) return 'invoiced';
  if (balance > 0) return 'ready_to_invoice';
  return 'draft';
};

type ToneName = 'neutral' | 'blue' | 'indigo' | 'amber' | 'green' | 'red' | 'muted';

const TONE: Record<ToneName, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: '#F0F3F7', fg: '#475569', dot: '#94A3B8' },
  blue:    { bg: '#E5F0FB', fg: '#1F66C9', dot: '#2F7DE1' },
  indigo:  { bg: '#ECEAFB', fg: '#5743C8', dot: '#7A6BE2' },
  amber:   { bg: '#FBF1DC', fg: '#9A6A0E', dot: '#C8941D' },
  green:   { bg: '#E1F4EA', fg: '#0E7A48', dot: '#16A364' },
  red:     { bg: '#FCE5E9', fg: '#B53047', dot: '#D14256' },
  muted:   { bg: '#EFF1F4', fg: '#94A3B8', dot: '#B0B8C2' },
};

const STATUS_TONE: Record<LedgerUiStatus, { label: string; tone: ToneName }> = {
  draft:            { label: 'Draft',          tone: 'neutral' },
  ready_to_invoice: { label: 'Ready',          tone: 'blue' },
  invoiced:         { label: 'Invoiced',       tone: 'indigo' },
  partial:          { label: 'Partially Paid', tone: 'amber' },
  paid:             { label: 'Paid',           tone: 'green' },
  overdue:          { label: 'Overdue',        tone: 'red' },
  voided:           { label: 'Voided',         tone: 'muted' },
};

const StatusPill: React.FC<{ tone: ToneName; children: React.ReactNode; sm?: boolean }> = ({ tone, children, sm }) => {
  const t = TONE[tone];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        bgcolor: t.bg,
        color: t.fg,
        px: sm ? '6px' : '8px',
        py: sm ? '1px' : '2px',
        fontSize: sm ? 10 : 10.5,
        fontWeight: 700,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}
    >
      <Box component="span" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: t.dot }} />
      {children}
    </Box>
  );
};

const LedgerStatusBadge: React.FC<{ status: LedgerUiStatus; sm?: boolean }> = ({ status, sm }) => {
  const meta = STATUS_TONE[status];
  return <StatusPill tone={meta.tone} sm={sm}>{meta.label}</StatusPill>;
};

const InfoField: React.FC<{ label: string; value: React.ReactNode; span?: 1 | 2 | 3 }> = ({
  label,
  value,
  span,
}) => (
  <Box sx={{ gridColumn: span ? `span ${span}` : 'auto' }}>
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        fontWeight: 600,
        color: 'text.secondary',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </Typography>
    <Typography sx={{ fontSize: 13.5, mt: 0.5, wordBreak: 'break-word' }}>{value}</Typography>
  </Box>
);

const CustomerLedgerPage: React.FC = () => {
  const { symbol: currencySymbol, format: formatCurrency } = useCurrency();
  const [hotelSettings, setHotelSettings] = useState<HotelSettings>(getHotelSettings());
  const {
    ledgers,
    loading,
    error,
    setError,
    reload: loadData,
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

  // Tracks whether the company registration dialog was opened from the
  // Create Ledger Entry autocomplete; if true, the newly-registered company
  // is auto-applied to the create form on success.
  const [companyRegPrefillCreate, setCompanyRegPrefillCreate] = useState(false);

  const showSnackbar = (
    message: string,
    severity: ApiNotificationSeverity = 'success'
  ) => {
    emitApiNotification({ message, severity });
  };

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
  // v2: tri-state filter — billable (default) / all / invoiced
  const [invoiceListFilter, setInvoiceListFilter] = useState<'billable' | 'all' | 'invoiced'>('billable');

  // Credit Note dialog — wires to backend POST /ledgers/:id/reverse
  const [creditNoteDialogOpen, setCreditNoteDialogOpen] = useState(false);
  const [creditNoteLedgerId, setCreditNoteLedgerId] = useState<number | ''>('');
  const [creditNoteReason, setCreditNoteReason] = useState<string>('');
  const [creditNoteNotes, setCreditNoteNotes] = useState('');
  const [processingCreditNote, setProcessingCreditNote] = useState(false);

  // Two-pane workspace state
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [companyListSearch, setCompanyListSearch] = useState('');
  const [companyListFilter, setCompanyListFilter] = useState<'all' | 'due' | 'clear'>('all');
  const [detailTab, setDetailTab] = useState<'entries' | 'info'>('entries');
  const [entriesSearch, setEntriesSearch] = useState('');
  const [entriesStatusFilter, setEntriesStatusFilter] = useState<EntryStatusFilter>('all');
  const [createMenuAnchor, setCreateMenuAnchor] = useState<null | HTMLElement>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [possibleDuplicateLedger, setPossibleDuplicateLedger] = useState<CustomerLedger | null>(null);
  const [activeCompanyPayments, setActiveCompanyPayments] = useState<Record<number, CustomerLedgerPayment[]>>({});
  const [loadingActiveCompanyPayments, setLoadingActiveCompanyPayments] = useState(false);
  const [expandedReceiptId, setExpandedReceiptId] = useState<number | null>(null);

  useEffect(() => {
    loadData();
    loadCompanies();
    loadGuests();
    loadAllCompanyBookings();

    const handleSettingsChange = () => setHotelSettings(getHotelSettings());
    window.addEventListener('hotelSettingsChange', handleSettingsChange);
    return () => window.removeEventListener('hotelSettingsChange', handleSettingsChange);
  }, []);

  // Load currently-active company-billed bookings.
  // Backend filters on company_id IS NOT NULL; we narrow to active statuses client-side.
  const loadAllCompanyBookings = async () => {
    try {
      const bookings = await HotelAPIService.getBookingsWithDetails({ company_billed: true });
      const active = bookings.filter(
        b => b.status === 'checked_in' || b.status === 'auto_checked_in',
      );
      setAllCompanyBookings(active);
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
      showSnackbar('Please select a company and room', 'warning');
      return;
    }

    try {
      setProcessingCheckIn(true);

      let guestToUse = checkInGuest;

      // Create new guest if needed
      if (isCreatingNewCheckInGuest) {
        if (!newCheckInGuestForm.first_name || !newCheckInGuestForm.last_name) {
          showSnackbar('Please enter guest first and last name', 'warning');
          setProcessingCheckIn(false);
          return;
        }

        // Validate email format only if provided
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (newCheckInGuestForm.email && newCheckInGuestForm.email.trim() && !emailRegex.test(newCheckInGuestForm.email)) {
          showSnackbar('Please enter a valid email address for the guest', 'warning');
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
        showSnackbar('Please select or create a guest', 'warning');
        setProcessingCheckIn(false);
        return;
      }

      // Get room_id - handle both 'id' and potential 'room_id' field names
      const roomId = checkInRoom.id || (checkInRoom as any).room_id;
      if (!roomId) {
        showSnackbar('Room ID not found. Please select a different room.', 'warning');
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

      // For back-dated bookings: auto-checkout if check-out date is today or in the past.
      // Backend's auto_post_company_ledger handles the room_charge ledger row on the
      // checked_out transition (and dedupes via an EXISTS check), so no client-side post here.
      const today = new Date().toISOString().split('T')[0];
      if (checkOutDate <= today) {
        await HotelAPIService.updateBooking(booking.id, { status: 'checked_out' });
      }

      showSnackbar(`Guest ${guestToUse.full_name} checked in to Room ${checkInRoom.room_number} (Company: ${checkInCompany.company_name})`);

      // Reset and close dialog
      setCheckInDialogOpen(false);
      resetCheckInForm();
      await loadData();
      await loadCompanies();
      await loadAllCompanyBookings();
    } catch (err: any) {
      console.error('Failed to perform company check-in:', err);
      showSnackbar(err.message || 'Failed to perform company check-in', 'error');
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

      // Backend's auto_post_company_ledger inserts the room_charge ledger row on
      // the checked_out transition (and dedupes via an EXISTS check), so no
      // client-side post is needed for company-billed bookings here.

      showSnackbar(`${checkoutBooking.guest_name} checked out from Room ${checkoutBooking.room_number}`);
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
      showSnackbar('Company name is required', 'warning');
      return;
    }

    try {
      setCreatingCompany(true);

      const created = await HotelAPIService.createCompany({
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

      // When opened from the Create Ledger autocomplete, auto-select the
      // freshly-registered company in the create form so the user doesn't
      // have to re-pick it.
      if (companyRegPrefillCreate) {
        const opt: CompanyOption = {
          company_name: created.company_name,
          company_registration_number: created.registration_number,
          contact_person: created.contact_person,
          contact_email: created.contact_email,
          contact_phone: created.contact_phone,
          billing_address_line1: created.billing_address,
        };
        setCompanyOptions(prev => [...prev, opt]);
        setSelectedCompany(opt);
        setCreateFormData(prev => ({
          ...prev,
          company_name: opt.company_name,
          company_registration_number: opt.company_registration_number,
          contact_person: opt.contact_person,
          contact_email: opt.contact_email,
          contact_phone: opt.contact_phone,
          billing_address_line1: opt.billing_address_line1,
        }));
        setCompanyRegPrefillCreate(false);
      }

      showSnackbar(`Company "${companyRegForm.company_name}" registered successfully`);
      setCompanyRegDialogOpen(false);
      resetCompanyRegForm();

      // Reload companies
      await loadCompanies();
    } catch (error: any) {
      console.error('Failed to register company:', error);
      showSnackbar(error.message || 'Failed to register company', 'error');
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
      showSnackbar('Company name is required', 'warning');
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

      showSnackbar(`Company "${companyEditForm.company_name}" updated successfully`);
      setCompanyEditDialogOpen(false);
      resetCompanyEditForm();

      // Reload companies
      await loadCompanies();
    } catch (error: any) {
      console.error('Failed to update company:', error);
      showSnackbar(error.message || 'Failed to update company', 'error');
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

      showSnackbar(`Company "${deletingCompanyData.company_name}" deleted successfully`);
      setCompanyDeleteDialogOpen(false);
      setDeletingCompanyData(null);

      // Reload companies
      await loadCompanies();
    } catch (error: any) {
      console.error('Failed to delete company:', error);
      showSnackbar(error.message || 'Failed to delete company', 'error');
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
           getLedgerBalanceDue(l) > 0 &&
           !isVoidedLedger(l)
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

  const isInvoiceEligible = (ledger: CustomerLedger) => {
    return !ledger.invoice_number && !isVoidedLedger(ledger) && getLedgerBalanceDue(ledger) > 0;
  };

  const getSelectedInvoiceLedgers = () =>
    invoiceLedgerEntries.filter(l => selectedInvoiceLedgers.includes(l.id) && (showInvoicePreview || isInvoiceEligible(l)));

  // Handle recording company payment (distributes across selected ledgers)
  const handleRecordCompanyPayment = async () => {
    if (selectedLedgersForPayment.length === 0 || !companyPaymentForm.payment_amount) {
      showSnackbar('Please select at least one ledger entry and enter payment amount', 'warning');
      return;
    }

    const paymentAmount = parseFloat(companyPaymentForm.payment_amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      showSnackbar('Please enter a valid payment amount', 'warning');
      return;
    }

    const selectedBalance = selectedLedgersForPayment.reduce((sum, ledger) => sum + getLedgerBalanceDue(ledger), 0);
    if (paymentAmount > selectedBalance) {
      showSnackbar('Payment amount cannot exceed the selected outstanding balance', 'warning');
      return;
    }

    const receiptNumber = companyPaymentForm.receipt_number.trim();
    if (receiptNumber) {
      const receiptExists = Object.values(activeCompanyPayments)
        .flat()
        .some(payment => payment.receipt_number?.trim().toLowerCase() === receiptNumber.toLowerCase());
      if (receiptExists) {
        showSnackbar('Receipt number already exists', 'warning');
        return;
      }
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

      showSnackbar(`Payment of ${formatCurrency(paymentAmount)} recorded successfully`);
      setCompanyPaymentDialogOpen(false);
      resetCompanyPaymentForm();

      // Reload data
      await loadData();
    } catch (error: any) {
      console.error('Failed to record payment:', error);
      showSnackbar(error.message || 'Failed to record payment', 'error');
    } finally {
      setProcessingCompanyPayment(false);
    }
  };

  // Company Invoice handlers
  const handleOpenCompanyInvoiceDialog = (company: Company) => {
    setInvoiceCompany(company);
    const companyLedgersFiltered = ledgers.filter(
      l => l.company_name === company.company_name
    );
    setInvoiceLedgerEntries(companyLedgersFiltered);
    const uninvoicedIds = companyLedgersFiltered
      .filter(l => isInvoiceEligible(l))
      .map(l => l.id);
    setSelectedInvoiceLedgers(uninvoicedIds);
    const timestamp = Date.now();
    setInvoiceNumber(`INV-${company.company_name.substring(0, 3).toUpperCase()}-${timestamp.toString().slice(-6)}`);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (company.payment_terms_days || 30));
    setInvoiceDueDate(dueDate.toISOString().split('T')[0]);
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setInvoiceNotes('');
    setShowInvoicePreview(false);
    setInvoiceListFilter('billable');
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
    setInvoiceListFilter('billable');
  };

  const handleToggleLedgerSelection = (ledgerId: number) => {
    const ledger = invoiceLedgerEntries.find(l => l.id === ledgerId);
    if (!ledger || !isInvoiceEligible(ledger)) return;
    setSelectedInvoiceLedgers(prev =>
      prev.includes(ledgerId)
        ? prev.filter(id => id !== ledgerId)
        : [...prev, ledgerId]
    );
  };

  const handleSelectAllEligibleLedgers = () => {
    const eligibleIds = invoiceLedgerEntries.filter(isInvoiceEligible).map(l => l.id);
    const allEligibleSelected = eligibleIds.length > 0 && eligibleIds.every(id => selectedInvoiceLedgers.includes(id));
    if (allEligibleSelected) {
      setSelectedInvoiceLedgers([]);
    } else {
      setSelectedInvoiceLedgers(eligibleIds);
    }
  };

  const getSelectedLedgerTotal = () => {
    return getSelectedInvoiceLedgers()
      .reduce((sum, l) => {
        const amount = typeof l.amount === 'string' ? parseFloat(l.amount) : l.amount;
        return sum + amount;
      }, 0);
  };

  const getSelectedLedgerPaidTotal = () => {
    return getSelectedInvoiceLedgers()
      .reduce((sum, l) => sum + asMoney(l.paid_amount), 0);
  };

  const getSelectedLedgerBalanceDue = () => {
    return getSelectedInvoiceLedgers()
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

  const findPossibleDuplicateLedger = () => {
    const company = createFormData.company_name.trim().toLowerCase();
    const room = (createFormData.room_number || '').trim().toLowerCase();
    const stayDate = createFormData.posting_date || createFormData.transaction_date || createFormData.invoice_date || '';
    const amount = Number(createFormData.amount || 0).toFixed(2);

    if (!company || !room || !stayDate || Number(amount) <= 0) return null;

    return ledgers.find((ledger) => {
      const ledgerDate = formatDateForInput(ledger.posting_date || ledger.transaction_date || ledger.invoice_date || ledger.created_at);
      return (
        ledger.company_name.trim().toLowerCase() === company &&
        (ledger.room_number || '').trim().toLowerCase() === room &&
        ledgerDate === stayDate &&
        asMoney(ledger.amount).toFixed(2) === amount &&
        !isLedgerVoided(ledger)
      );
    }) || null;
  };

  // Create ledger handlers
  const handleCreateLedger = async (skipDuplicateCheck = false) => {
    if (!skipDuplicateCheck) {
      const duplicate = findPossibleDuplicateLedger();
      if (duplicate) {
        setPossibleDuplicateLedger(duplicate);
        setDuplicateDialogOpen(true);
        return;
      }
    }

    try {
      setCreating(true);
      await HotelAPIService.createCustomerLedger(createFormData);
      showSnackbar('Ledger entry created successfully!');
      setCreateDialogOpen(false);
      setDuplicateDialogOpen(false);
      setPossibleDuplicateLedger(null);
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
      showSnackbar('Ledger entry updated successfully!');
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

    const balanceDue = getLedgerBalanceDue(paymentLedger);
    if (paymentFormData.payment_amount > balanceDue) {
      showSnackbar('Payment amount cannot exceed the outstanding balance', 'warning');
      return;
    }

    const receiptNumber = paymentFormData.receipt_number?.trim();
    if (receiptNumber) {
      const receiptExists = Object.values(activeCompanyPayments)
        .flat()
        .some(payment => payment.receipt_number?.trim().toLowerCase() === receiptNumber.toLowerCase());
      if (receiptExists) {
        showSnackbar('Receipt number already exists', 'warning');
        return;
      }
    }

    try {
      setProcessingPayment(true);
      await HotelAPIService.createLedgerPayment(paymentLedger.id, paymentFormData);
      showSnackbar('Payment recorded successfully!');
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
      showSnackbar('Payment date updated successfully');
      await loadData();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to update payment date', 'error');
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
      showSnackbar('Ledger entry voided successfully');
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
      showSnackbar(err.message || 'Failed to load invoice', 'error');
    } finally {
      setLoadingLedgerInvoice(false);
    }
  };

  // Print company ledger statement
  const handlePrintCompanyStatement = (companyName: string) => {
    const entries = ledgers.filter(l => l.company_name === companyName);
    if (entries.length === 0) {
      showSnackbar('No ledger entries to print for this company.', 'info');
      return;
    }
    const totalAmount = entries.reduce((sum, e) => sum + parseFloat(String(e.amount)), 0);
    const totalPaid = entries.reduce((sum, e) => sum + parseFloat(String(e.paid_amount)), 0);
    const totalBalance = entries.reduce((sum, e) => sum + parseFloat(String(e.balance_due)), 0);

    const htmlContent = `
      <html>
        <head>
          <title>Company Ledger Statement - ${companyName}</title>
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
            <h3>${companyName}</h3>
            <p>Statement Date: ${new Date().toLocaleDateString()}</p>
          </div>
          <div class="summary">
            <div class="summary-item">
              <div class="label">Total Entries</div>
              <div class="value">${entries.length}</div>
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
              ${entries.map(entry => `
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
          <title>Receipt - ${entry.invoice_number || entry.folio_number || `#${entry.id}`}</title>
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
              <span class="value">${entry.invoice_number || entry.folio_number || `#${entry.id}`}</span>
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

  // Ledger summary computed from the rows we already have; keeps the strip
  // numbers in sync with what's displayed and saves a separate API round-trip.
  const summary = useMemo(() => {
    let total_amount = 0;
    let total_paid = 0;
    let total_outstanding = 0;
    let pending_count = 0;
    let partial_count = 0;
    let overdue_count = 0;
    ledgers.forEach(l => {
      total_amount += parseFloat(String(l.amount || 0));
      total_paid += parseFloat(String(l.paid_amount || 0));
      total_outstanding += parseFloat(String(l.balance_due || 0));
      if (l.status === 'pending') pending_count += 1;
      else if (l.status === 'partial') partial_count += 1;
      else if (l.status === 'overdue') overdue_count += 1;
    });
    return {
      total_entries: ledgers.length,
      total_amount,
      total_paid,
      total_outstanding,
      pending_count,
      partial_count,
      overdue_count,
    };
  }, [ledgers]);

  // Per-company aggregates keyed by company name
  const companyAggregates = useMemo(() => {
    const m = new Map<string, { total: number; paid: number; due: number; pending: number; overdue: number; count: number }>();
    ledgers.forEach(l => {
      const cur = m.get(l.company_name) || { total: 0, paid: 0, due: 0, pending: 0, overdue: 0, count: 0 };
      const amount = parseFloat(String(l.amount || 0));
      const paid = parseFloat(String(l.paid_amount || 0));
      const balance = parseFloat(String(l.balance_due || 0));
      cur.total += amount;
      cur.paid += paid;
      cur.due += balance;
      cur.count += 1;
      if (balance > 0) cur.pending += 1;
      if (l.status === 'overdue') cur.overdue += balance;
      m.set(l.company_name, cur);
    });
    return m;
  }, [ledgers]);

  const emptyAgg = { total: 0, paid: 0, due: 0, pending: 0, overdue: 0, count: 0 };

  // Filtered + sorted company rows for the left list pane
  const companyListRows = useMemo(() => {
    const q = companyListSearch.trim().toLowerCase();
    return companies
      .map(c => ({ c, agg: companyAggregates.get(c.company_name) || emptyAgg }))
      .filter(({ c, agg }) => {
        if (companyListFilter === 'due' && agg.due <= 0) return false;
        if (companyListFilter === 'clear' && agg.due > 0) return false;
        if (!q) return true;
        return (
          c.company_name.toLowerCase().includes(q) ||
          (c.contact_phone || '').toLowerCase().includes(q) ||
          (c.contact_person || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.agg.due - a.agg.due);
  }, [companies, companyAggregates, companyListSearch, companyListFilter]);

  const dueCount = useMemo(
    () => companies.filter(c => (companyAggregates.get(c.company_name)?.due || 0) > 0).length,
    [companies, companyAggregates],
  );
  const clearCount = companies.length - dueCount;

  // Auto-select first company when companies load and nothing is selected yet
  useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) {
      const sorted = [...companies].sort((a, b) => {
        const aDue = companyAggregates.get(a.company_name)?.due || 0;
        const bDue = companyAggregates.get(b.company_name)?.due || 0;
        return bDue - aDue;
      });
      setSelectedCompanyId(sorted[0].id);
    }
  }, [companies, companyAggregates, selectedCompanyId]);

  const activeCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  );

  const activeAgg = activeCompany
    ? companyAggregates.get(activeCompany.company_name) || emptyAgg
    : emptyAgg;

  const activeBookingsForCompany = useMemo(
    () => (activeCompany ? allCompanyBookings.filter(b => b.company_id === activeCompany.id) : []),
    [allCompanyBookings, activeCompany],
  );

  const activeCompanyAllEntries = useMemo(() => {
    if (!activeCompany) return [] as CustomerLedger[];
    return ledgers.filter(l => l.company_name === activeCompany.company_name);
  }, [ledgers, activeCompany]);

  // Ledger entries for the selected company, filtered by search + status
  const activeCompanyEntries = useMemo(() => {
    if (!activeCompany) return [] as CustomerLedger[];
    const q = entriesSearch.trim().toLowerCase();
    return activeCompanyAllEntries
      .filter(l => {
        if (entriesStatusFilter === 'all') return true;
        const uiStatus = getLedgerUiStatus(l);
        const balance = asMoney(l.balance_due);
        if (entriesStatusFilter === 'uninvoiced') return !l.invoice_number && !isLedgerVoided(l);
        if (entriesStatusFilter === 'outstanding') return balance > 0 && !isLedgerVoided(l);
        if (entriesStatusFilter === 'invoiced') return Boolean(l.invoice_number) && !isLedgerVoided(l);
        if (entriesStatusFilter === 'paid') return uiStatus === 'paid';
        if (entriesStatusFilter === 'overdue') return uiStatus === 'overdue';
        if (entriesStatusFilter === 'voided') return uiStatus === 'voided';
        return true;
      })
      .filter(l => {
        if (!q) return true;
        return (
          l.description.toLowerCase().includes(q) ||
          (l.invoice_number || '').toLowerCase().includes(q) ||
          (l.folio_number || '').toLowerCase().includes(q)
        );
      });
  }, [activeCompany, activeCompanyAllEntries, entriesSearch, entriesStatusFilter]);

  const paidEntriesCount = useMemo(
    () =>
      activeCompany
        ? ledgers.filter(l => l.company_name === activeCompany.company_name && l.status === 'paid').length
        : 0,
    [ledgers, activeCompany],
  );

  useEffect(() => {
    let cancelled = false;
    const loadPaymentsForCompany = async () => {
      if (!activeCompany) {
        setActiveCompanyPayments({});
        return;
      }

      const companyLedgers = activeCompanyAllEntries;
      if (companyLedgers.length === 0) {
        setActiveCompanyPayments({});
        return;
      }

      setLoadingActiveCompanyPayments(true);
      try {
        const rows = await Promise.all(
          companyLedgers.map(async (ledger) => {
            try {
              const payments = await HotelAPIService.getLedgerPayments(ledger.id);
              return [ledger.id, payments] as const;
            } catch {
              return [ledger.id, []] as const;
            }
          }),
        );
        if (!cancelled) {
          setActiveCompanyPayments(Object.fromEntries(rows));
        }
      } finally {
        if (!cancelled) setLoadingActiveCompanyPayments(false);
      }
    };

    loadPaymentsForCompany();
    return () => {
      cancelled = true;
    };
  }, [activeCompany, activeCompanyAllEntries]);

  const visibleInvoiceLedgerEntries = useMemo(() => {
    return invoiceLedgerEntries.filter((ledger) => {
      if (isVoidedLedger(ledger)) return false; // voided always hidden
      if (invoiceListFilter === 'billable') return isInvoiceEligible(ledger);
      if (invoiceListFilter === 'invoiced') return Boolean(ledger.invoice_number);
      return true; // 'all' shows everything non-voided
    });
  }, [invoiceLedgerEntries, invoiceListFilter]);

  const invoiceFilterCounts = useMemo(() => {
    const nonVoid = invoiceLedgerEntries.filter(l => !isVoidedLedger(l));
    return {
      billable: nonVoid.filter(isInvoiceEligible).length,
      all: nonVoid.length,
      invoiced: nonVoid.filter(l => Boolean(l.invoice_number)).length,
    };
  }, [invoiceLedgerEntries]);

  const eligibleInvoiceCount = useMemo(
    () => invoiceLedgerEntries.filter(isInvoiceEligible).length,
    [invoiceLedgerEntries],
  );

  // Initials for company avatars (e.g. "Farley Sibu" -> "FS")
  const companyInitials = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  const prefillCreateForCompany = (company: Company, overrides: Partial<CustomerLedgerCreateRequest> = {}) => {
    setCreateFormData(prev => ({
      ...prev,
      company_name: company.company_name,
      company_registration_number: company.registration_number,
      contact_person: company.contact_person,
      contact_email: company.contact_email,
      contact_phone: company.contact_phone,
      billing_address_line1: company.billing_address,
      ...overrides,
    }));
    setSelectedCompany({
      company_name: company.company_name,
      company_registration_number: company.registration_number,
      contact_person: company.contact_person,
      contact_email: company.contact_email,
      contact_phone: company.contact_phone,
      billing_address_line1: company.billing_address,
    });
  };

  const openContextualCreate = (action: 'entry' | 'invoice' | 'payment' | 'checkin' | 'credit') => {
    setCreateMenuAnchor(null);
    if (action === 'checkin') {
      handleOpenCheckInDialog(activeCompany || undefined);
      return;
    }
    if (!activeCompany) {
      showSnackbar('Select a company first', 'warning');
      return;
    }
    if (action === 'entry') {
      prefillCreateForCompany(activeCompany);
      setCreateDialogOpen(true);
    } else if (action === 'invoice') {
      handleOpenCompanyInvoiceDialog(activeCompany);
    } else if (action === 'payment') {
      handleOpenCompanyPaymentDialog(activeCompany);
    } else if (action === 'credit') {
      // v2: open dedicated Credit Note dialog that posts to the backend
      // reversal endpoint (audit-safe), rather than creating an offsetting entry.
      setCreditNoteLedgerId('');
      setCreditNoteReason('');
      setCreditNoteNotes('');
      setCreditNoteDialogOpen(true);
    }
  };

  const handleSubmitCreditNote = async () => {
    if (!creditNoteLedgerId) {
      showSnackbar('Pick a ledger entry to credit', 'warning');
      return;
    }
    if (!creditNoteReason) {
      showSnackbar('Pick a credit reason', 'warning');
      return;
    }
    try {
      setProcessingCreditNote(true);
      const reasonText = creditNoteNotes.trim()
        ? `${creditNoteReason} — ${creditNoteNotes.trim()}`
        : creditNoteReason;
      await HotelAPIService.reverseLedger(Number(creditNoteLedgerId), {
        reason: reasonText,
        notes: creditNoteNotes.trim() || undefined,
      });
      showSnackbar('Credit note issued — reversal entry posted.');
      setCreditNoteDialogOpen(false);
      setCreditNoteLedgerId('');
      setCreditNoteReason('');
      setCreditNoteNotes('');
      await loadData();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to issue credit note', 'error');
    } finally {
      setProcessingCreditNote(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1480, mx: 'auto' }}>
      {/* Page header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2,
          mb: 2,
        }}
      >
        <Box>
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              letterSpacing: 0.4,
              fontWeight: 600,
              display: 'block',
              mb: 0.5,
            }}
          >
            LEDGER <Box component="span" sx={{ color: 'text.disabled', mx: 0.5 }}>/</Box> COMPANIES
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography
              variant="h4"
              component="h1"
              sx={{ fontWeight: 700, letterSpacing: '-0.4px', m: 0 }}
            >
              Company Ledger
            </Typography>
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={`${companies.length} ${companies.length === 1 ? 'account' : 'accounts'}`}
              sx={{ fontWeight: 700, height: 24 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Corporate accounts, balances and direct check-ins.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<AddIcon />}
            endIcon={<ArrowDropDownIcon />}
            onClick={(event) => setCreateMenuAnchor(event.currentTarget)}
          >
            Create
          </Button>
          <Menu
            anchorEl={createMenuAnchor}
            open={Boolean(createMenuAnchor)}
            onClose={() => setCreateMenuAnchor(null)}
          >
            <MenuItem onClick={() => openContextualCreate('entry')}>
              <AddIcon fontSize="small" sx={{ mr: 1 }} /> New Ledger Entry
            </MenuItem>
            <MenuItem onClick={() => openContextualCreate('invoice')}>
              <InvoiceIcon fontSize="small" sx={{ mr: 1 }} /> Generate Invoice
            </MenuItem>
            <MenuItem onClick={() => openContextualCreate('payment')} disabled={!activeCompany || activeAgg.due <= 0}>
              <PaymentIcon fontSize="small" sx={{ mr: 1 }} /> Record Payment
            </MenuItem>
            <MenuItem onClick={() => openContextualCreate('checkin')}>
              <CheckInIcon fontSize="small" sx={{ mr: 1 }} /> Company Check-In
            </MenuItem>
            <MenuItem onClick={() => openContextualCreate('credit')} disabled={!activeCompany}>
              <CreditNoteIcon fontSize="small" sx={{ mr: 1 }} /> Credit Note
            </MenuItem>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem
              onClick={() => {
                setCreateMenuAnchor(null);
                setCompanyRegDialogOpen(true);
              }}
            >
              <BusinessIcon fontSize="small" sx={{ mr: 1 }} /> Register Company
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={loadData}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Slim stats strip: Billed / Collected / Outstanding / Overdue */}
      {summary && (() => {
        const totalAmount = parseFloat(String(summary.total_amount || 0));
        const totalPaid = parseFloat(String(summary.total_paid || 0));
        const totalDue = parseFloat(String(summary.total_outstanding || 0));
        const overdueAmount = ledgers.reduce(
          (sum, l) => (getLedgerUiStatus(l) === 'overdue' ? sum + asMoney(l.balance_due) : sum),
          0,
        );
        const collectionPct = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;
        const readyToBillCount = ledgers.filter(l => getLedgerUiStatus(l) === 'ready_to_invoice').length;
        const openInvoiceCount = ledgers.filter(l => {
          const s = getLedgerUiStatus(l);
          return s === 'invoiced' || s === 'partial' || s === 'overdue';
        }).length;
        const stats = [
          {
            key: 'billed',
            icon: <MoneyIcon fontSize="small" />,
            iconBg: (theme: any) => alpha(theme.palette.info.main, 0.12),
            iconColor: 'info.main',
            label: 'Total Billed',
            value: formatCurrency(totalAmount).replace(currencySymbol, '').trim(),
            delta: `${summary.total_entries} entries / ${companies.length} ${companies.length === 1 ? 'company' : 'companies'}`,
            currency: currencySymbol,
          },
          {
            key: 'collected',
            icon: <CheckCircleIcon fontSize="small" />,
            iconBg: (theme: any) => alpha(theme.palette.success.main, 0.12),
            iconColor: 'success.main',
            label: 'Collected',
            value: formatCurrency(totalPaid).replace(currencySymbol, '').trim(),
            delta: `${collectionPct}% of billed`,
            currency: currencySymbol,
          },
          {
            key: 'outstanding',
            icon: <WarningIcon fontSize="small" />,
            iconBg: (theme: any) => alpha(theme.palette.warning.main, 0.14),
            iconColor: 'warning.main',
            label: 'Outstanding',
            value: formatCurrency(totalDue).replace(currencySymbol, '').trim(),
            delta: `${openInvoiceCount} open item${openInvoiceCount === 1 ? '' : 's'}`,
            currency: currencySymbol,
          },
          {
            key: 'overdue',
            icon: <WarningIcon fontSize="small" />,
            iconBg: (theme: any) => alpha(theme.palette.error.main, 0.12),
            iconColor: overdueAmount > 0 ? 'error.main' : 'text.secondary',
            label: 'Overdue',
            value: formatCurrency(overdueAmount).replace(currencySymbol, '').trim(),
            delta: `${readyToBillCount} ready to bill`,
            currency: currencySymbol,
          },
        ];
        return (
          <Card
            variant="outlined"
            sx={{
              mb: 2.5,
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, 1fr)',
                md: 'repeat(4, 1fr)',
              },
              overflow: 'hidden',
            }}
          >
            {stats.map((s, idx) => (
              <Box
                key={s.key}
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  borderLeft: {
                    xs: 'none',
                    md: idx === 0 ? 'none' : '1px solid',
                  },
                  borderTop: {
                    xs: idx === 0 ? 'none' : '1px solid',
                    sm: idx < 2 ? 'none' : '1px solid',
                    md: 'none',
                  },
                  borderColor: 'divider',
                }}
              >
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 1.5,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: s.iconBg as any,
                    color: s.iconColor,
                    flexShrink: 0,
                  }}
                >
                  {s.icon}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontWeight: 700,
                      color: 'text.secondary',
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                      lineHeight: 1.2,
                    }}
                  >
                    {s.label}
                  </Typography>
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 700,
                      letterSpacing: '-0.3px',
                      lineHeight: 1.2,
                      mt: 0.5,
                      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {s.currency && (
                      <Box
                        component="span"
                        sx={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'text.secondary',
                          mr: 0.5,
                          letterSpacing: 0.4,
                        }}
                      >
                        {s.currency}
                      </Box>
                    )}
                    {s.value}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}
                  >
                    {s.delta}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Card>
        );
      })()}

      {/* Two-pane workspace: company list (left) + detail pane (right) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '380px 1fr' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        {/* LEFT - COMPANY LIST PANE */}
        <Card variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <BusinessIcon fontSize="small" color="action" />
            <Typography sx={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>
              Companies
            </Typography>
            <Chip
              label={companies.length}
              size="small"
              sx={{ height: 20, fontSize: 11, fontWeight: 700, '& .MuiChip-label': { px: 1 } }}
            />
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              variant="text"
              startIcon={<AddIcon fontSize="small" />}
              onClick={() => setCompanyRegDialogOpen(true)}
              sx={{ minWidth: 0, px: 1, fontSize: 12 }}
            >
              Add
            </Button>
          </Box>

          <Box
            sx={{
              p: 1.25,
              bgcolor: 'action.hover',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <TextField
              size="small"
              fullWidth
              placeholder="Search by name, contact, phone..."
              value={companyListSearch}
              onChange={(e) => setCompanyListSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: companyListSearch ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => setCompanyListSearch('')}
                      sx={{ p: 0.25 }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
                sx: { bgcolor: 'background.paper', fontSize: 13 },
              }}
            />
            <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              {([
                { key: 'all', label: 'All', count: companies.length },
                { key: 'due', label: 'Has balance', count: dueCount },
                { key: 'clear', label: 'Settled', count: clearCount },
              ] as const).map(f => (
                <Chip
                  key={f.key}
                  size="small"
                  label={
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      <span>{f.label}</span>
                      <Box
                        component="span"
                        sx={{
                          fontSize: 10,
                          fontWeight: 700,
                          px: 0.6,
                          py: 0.05,
                          borderRadius: '999px',
                          bgcolor: companyListFilter === f.key ? 'rgba(255,255,255,0.25)' : 'action.selected',
                        }}
                      >
                        {f.count}
                      </Box>
                    </Box>
                  }
                  onClick={() => setCompanyListFilter(f.key as any)}
                  variant={companyListFilter === f.key ? 'filled' : 'outlined'}
                  color={companyListFilter === f.key ? 'default' : 'default'}
                  sx={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    height: 24,
                    bgcolor: companyListFilter === f.key ? 'text.primary' : 'background.paper',
                    color: companyListFilter === f.key ? 'background.paper' : 'text.secondary',
                    '&:hover': {
                      bgcolor: companyListFilter === f.key ? 'text.primary' : 'action.hover',
                    },
                  }}
                />
              ))}
            </Box>
          </Box>

          <Box
            sx={{
              maxHeight: { md: 'calc(100vh - 360px)' },
              overflowY: 'auto',
            }}
          >
            {companies.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  No companies registered yet.
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => setCompanyRegDialogOpen(true)}
                >
                  Register Company
                </Button>
              </Box>
            ) : companyListRows.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  No companies match.
                </Typography>
              </Box>
            ) : (
              companyListRows.map(({ c, agg }) => {
                const isOn = c.id === selectedCompanyId;
                const pct = agg.total > 0 ? (agg.paid / agg.total) * 100 : 0;
                return (
                  <Box
                    key={c.id}
                    onClick={() => setSelectedCompanyId(c.id)}
                    sx={{
                      p: 1.5,
                      cursor: 'pointer',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      position: 'relative',
                      transition: 'background 120ms',
                      bgcolor: isOn ? (theme) => alpha(theme.palette.success.main, 0.08) : 'transparent',
                      '&:hover': {
                        bgcolor: isOn
                          ? (theme) => alpha(theme.palette.success.main, 0.12)
                          : 'action.hover',
                      },
                      '&::before': isOn
                        ? {
                            content: '""',
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: 3,
                            bgcolor: 'success.main',
                          }
                        : undefined,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: 1,
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: 0.4,
                          flexShrink: 0,
                          bgcolor: isOn ? 'success.main' : 'action.selected',
                          color: isOn ? 'success.contrastText' : 'text.secondary',
                        }}
                      >
                        {companyInitials(c.company_name)}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          sx={{
                            fontSize: 13.5,
                            fontWeight: 700,
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {c.company_name}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: 11,
                            color: 'text.secondary',
                            mt: 0.25,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {c.contact_phone || '-'}
                          {c.contact_person ? ` / ${c.contact_person}` : ''}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 5.25, mt: 0.75 }}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                        <ReceiptIcon sx={{ fontSize: 11 }} />
                        <Typography sx={{ fontSize: 11, fontWeight: 500 }}>{agg.count}</Typography>
                      </Box>
                      <Box
                        sx={{
                          width: 4,
                          height: 4,
                          borderRadius: '50%',
                          bgcolor: 'text.disabled',
                        }}
                      />
                      <Typography
                        sx={{
                          fontSize: 11,
                          color: 'text.secondary',
                          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatCurrency(agg.total)}
                      </Typography>
                      <Typography
                        sx={{
                          ml: 'auto',
                          fontSize: 12,
                          fontWeight: 700,
                          color: agg.due > 0 ? 'error.main' : 'success.main',
                          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {agg.due > 0 ? formatCurrency(agg.due) : 'Settled'}
                      </Typography>
                    </Box>
                    {agg.total > 0 && (
                      <Box
                        sx={{
                          height: 3,
                          borderRadius: '999px',
                          bgcolor: 'action.selected',
                          overflow: 'hidden',
                          mt: 0.75,
                          ml: 5.25,
                        }}
                      >
                        <Box
                          sx={{
                            height: '100%',
                            width: `${pct}%`,
                            bgcolor: 'success.main',
                            borderRadius: '999px',
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                );
              })
            )}
          </Box>
        </Card>

        {/* RIGHT - DETAIL PANE */}
        <Card
          variant="outlined"
          sx={{
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            // Cap the pane height so the header/meter/tabs stay pinned and only
            // the per-tab body scrolls. Disabled below md where the layout stacks.
            maxHeight: { md: 'calc(100vh - 200px)' },
            minHeight: { md: 480 },
          }}
        >
          {!activeCompany ? (
            <Box sx={{ py: 10, px: 4, textAlign: 'center' }}>
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: 2,
                  bgcolor: 'action.hover',
                  color: 'text.secondary',
                  display: 'grid',
                  placeItems: 'center',
                  mx: 'auto',
                  mb: 1.5,
                }}
              >
                <BusinessIcon sx={{ fontSize: 26 }} />
              </Box>
              <Typography sx={{ fontWeight: 600, fontSize: 16, color: 'text.primary', mb: 0.5 }}>
                Pick a company on the left
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320, mx: 'auto' }}>
                Select a company to view its ledger entries, balance, and take actions like
                check-in, payment, or invoicing.
              </Typography>
            </Box>
          ) : (
            <>
              {/* Company header */}
              <Box
                sx={{
                  px: 2.5,
                  py: 2,
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '1fr auto' },
                  gap: 2,
                  alignItems: 'start',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 1.5,
                      bgcolor: 'success.main',
                      color: 'success.contrastText',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 15,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {companyInitials(activeCompany.company_name)}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="h6"
                      sx={{ fontWeight: 700, letterSpacing: '-0.3px', lineHeight: 1.2 }}
                      noWrap
                    >
                      {activeCompany.company_name}
                    </Typography>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        mt: 0.5,
                        flexWrap: 'wrap',
                        color: 'text.secondary',
                        fontSize: 12,
                      }}
                    >
                      <span>{activeCompany.contact_phone || '-'}</span>
                      <Box component="span" sx={{ color: 'text.disabled' }}>/</Box>
                      <span>{activeCompany.contact_person || '-'}</span>
                      <Box component="span" sx={{ color: 'text.disabled' }}>/</Box>
                      <Chip
                        size="small"
                        label={`Net ${activeCompany.payment_terms_days || 30}d`}
                        sx={{ height: 20, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3 }}
                      />
                      {activeCompany.credit_limit != null && (
                        <Chip
                          size="small"
                          label={`Limit ${formatCurrency(parseFloat(String(activeCompany.credit_limit)))}`}
                          sx={{ height: 20, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3 }}
                        />
                      )}
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                  <Tooltip title="Print statement">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => handlePrintCompanyStatement(activeCompany.company_name)}
                        disabled={activeAgg.count === 0}
                      >
                        <PrintIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Delete company">
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleOpenDeleteCompany(activeCompany)}
                        disabled={activeBookingsForCompany.length > 0}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>

              {/* Billed / Collected / Outstanding meter */}
              {(() => {
                const pct = activeAgg.total > 0 ? (activeAgg.paid / activeAgg.total) * 100 : 0;
                const cells: Array<{
                  key: string;
                  label: string;
                  value: number;
                  color?: 'success.main' | 'error.main';
                  barWidth: number;
                  barColor: string;
                  sub?: string;
                }> = [
                  {
                    key: 'billed',
                    label: 'Total Billed',
                    value: activeAgg.total,
                    barWidth: 100,
                    barColor: 'success.main',
                  },
                  {
                    key: 'collected',
                    label: 'Collected',
                    value: activeAgg.paid,
                    color: 'success.main',
                    barWidth: pct,
                    barColor: 'success.main',
                  },
                  {
                    key: 'outstanding',
                    label: 'Outstanding',
                    value: activeAgg.due,
                    color: 'error.main',
                    barWidth: Math.min(100, activeAgg.total > 0 ? (activeAgg.due / activeAgg.total) * 100 : 0),
                    barColor: 'error.main',
                    sub: `${activeAgg.pending} open item${activeAgg.pending === 1 ? '' : 's'}`,
                  },
                  {
                    key: 'overdue',
                    label: 'Overdue',
                    value: activeAgg.overdue,
                    color: activeAgg.overdue > 0 ? 'error.main' : 'success.main',
                    barWidth: Math.min(100, activeAgg.total > 0 ? (activeAgg.overdue / activeAgg.total) * 100 : 0),
                    barColor: 'error.main',
                    sub: activeAgg.overdue > 0 ? 'needs follow-up' : 'none overdue',
                  },
                  {
                    key: 'collection',
                    label: 'Collection',
                    value: pct,
                    color: 'success.main',
                    barWidth: pct,
                    barColor: 'success.main',
                    sub: `${Math.round(pct)}% collected`,
                  },
                ];
                return (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(5, 1fr)' },
                      bgcolor: 'action.hover',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    {cells.map((c, idx) => (
                      <Box
                        key={c.key}
                        sx={{
                          px: 2.5,
                          py: 1.5,
                          borderRight: {
                            xs: 'none',
                            lg: idx < cells.length - 1 ? '1px solid' : 'none',
                          },
                          borderBottom: {
                            xs: idx < cells.length - 1 ? '1px solid' : 'none',
                            sm: idx < cells.length - 2 ? '1px solid' : 'none',
                            lg: 'none',
                          },
                          borderColor: 'divider',
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 700,
                            color: 'text.secondary',
                            letterSpacing: 0.6,
                            textTransform: 'uppercase',
                            display: 'block',
                          }}
                        >
                          {c.label}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: 18,
                            fontWeight: 700,
                            letterSpacing: '-0.3px',
                            mt: 0.5,
                            color: c.color || 'text.primary',
                            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {c.key === 'collection' ? (
                            `${Math.round(c.value)}%`
                          ) : (
                            <>
                              <Box
                                component="span"
                                sx={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: 'text.secondary',
                                  mr: 0.5,
                                  letterSpacing: 0.4,
                                }}
                              >
                                {currencySymbol}
                              </Box>
                              {formatCurrency(c.value).replace(currencySymbol, '').trim()}
                            </>
                          )}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={Math.max(0, Math.min(100, c.barWidth))}
                          sx={{
                            height: 5,
                            borderRadius: 999,
                            bgcolor: 'action.selected',
                            mt: 1,
                            '& .MuiLinearProgress-bar': { bgcolor: c.barColor },
                          }}
                        />
                        <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
                          {c.sub}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                );
              })()}

              {/* Active guests row (if any) */}
              {activeBookingsForCompany.length > 0 && (
                <Box
                  sx={{
                    px: 2.5,
                    py: 1.5,
                    bgcolor: (theme) => alpha(theme.palette.success.main, 0.08),
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 1,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: 'success.dark',
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                    }}
                  >
                    {activeBookingsForCompany.length} active guest{activeBookingsForCompany.length > 1 ? 's' : ''}:
                  </Typography>
                  {activeBookingsForCompany.map((booking) => (
                    <Chip
                      key={booking.id}
                      size="small"
                      label={
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <span>Room {booking.room_number}</span>
                          <Box component="span" sx={{ color: 'text.disabled' }}>/</Box>
                          <span>{booking.guest_name}</span>
                        </Box>
                      }
                      onDelete={() => handleOpenCheckoutDialog(booking)}
                      deleteIcon={
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.25,
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'error.main',
                            px: 0.5,
                          }}
                        >
                          <CheckOutIcon sx={{ fontSize: 13 }} /> Out
                        </Box>
                      }
                      sx={{
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        '& .MuiChip-label': { fontSize: 12 },
                      }}
                    />
                  ))}
                </Box>
              )}

              {/* Tabs + per-tab primary action (v2) */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  pr: 2,
                }}
              >
              <Tabs
                value={detailTab}
                onChange={(_, v) => setDetailTab(v)}
                sx={{
                  flex: 1,
                  px: 2.5,
                  minHeight: 40,
                  '& .MuiTab-root': {
                    minHeight: 40,
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: 13,
                  },
                }}
              >
                <Tab
                  value="entries"
                  label={
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                      <span>Ledger entries</span>
                      <Box
                        component="span"
                        sx={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          px: 0.75,
                          py: 0.1,
                          borderRadius: '999px',
                          bgcolor: detailTab === 'entries'
                            ? (theme) => alpha(theme.palette.success.main, 0.18)
                            : 'action.selected',
                          color: detailTab === 'entries' ? 'success.main' : 'text.secondary',
                        }}
                      >
                        {activeAgg.count}
                      </Box>
                    </Box>
                  }
                />
                <Tab value="info" label="Company info" />
              </Tabs>
              {detailTab === 'entries' && (
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => {
                    if (!activeCompany) return;
                    prefillCreateForCompany(activeCompany);
                    setCreateDialogOpen(true);
                  }}
                  disabled={!activeCompany}
                >
                  New entry
                </Button>
              )}
              {detailTab === 'info' && (
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<EditIcon fontSize="small" />}
                  onClick={() => activeCompany && handleOpenEditCompany(activeCompany)}
                  disabled={!activeCompany}
                >
                  Edit company
                </Button>
              )}
              </Box>

              {/* Scrollable tab body keeps header/meter/tabs pinned above */}
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {detailTab === 'entries' && (
                <>
                  {/* Toolbar: search + status segment + new entry */}
                  <Box
                    sx={{
                      px: 2.5,
                      py: 1.25,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      flexWrap: 'wrap',
                      bgcolor: 'action.hover',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <TextField
                      size="small"
                      placeholder="Search description or invoice no..."
                      value={entriesSearch}
                      onChange={(e) => setEntriesSearch(e.target.value)}
                      sx={{ width: 240, bgcolor: 'background.paper' }}
                    />
                    <Box
                      sx={{
                        display: 'inline-flex',
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 0.25,
                      }}
                    >
                      {([
                        { key: 'all', label: 'All' },
                        { key: 'uninvoiced', label: 'Uninvoiced' },
                        { key: 'outstanding', label: 'Outstanding' },
                        { key: 'invoiced', label: 'Invoiced' },
                        { key: 'paid', label: 'Paid' },
                        { key: 'overdue', label: 'Overdue' },
                        { key: 'voided', label: 'Voided' },
                      ] as const).map(s => (
                        <Button
                          key={s.key}
                          size="small"
                          onClick={() => setEntriesStatusFilter(s.key as any)}
                          sx={{
                            minWidth: 0,
                            px: 1,
                            py: 0.25,
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: entriesStatusFilter === s.key ? 'background.paper' : 'text.secondary',
                            bgcolor: entriesStatusFilter === s.key ? 'text.primary' : 'transparent',
                            borderRadius: 0.75,
                            '&:hover': {
                              bgcolor:
                                entriesStatusFilter === s.key ? 'text.primary' : 'action.hover',
                            },
                          }}
                        >
                          {s.label}
                        </Button>
                      ))}
                    </Box>
                  </Box>

                  {activeCompanyEntries.length === 0 ? (
                    <Box sx={{ py: 8, px: 4, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        {activeAgg.count === 0
                          ? 'No ledger entries for this company yet.'
                          : 'No entries match this filter.'}
                      </Typography>
                    </Box>
                  ) : (
                    <TableContainer sx={{ overflowX: 'auto' }}>
                      <Table size="small" stickyHeader sx={{ minWidth: 980 }}>
                        <TableHead>
                          <TableRow
                            sx={{
                              '& .MuiTableCell-root': {
                                fontSize: 10.5,
                                fontWeight: 700,
                                color: 'text.secondary',
                                letterSpacing: 0.6,
                                textTransform: 'uppercase',
                                bgcolor: 'action.hover',
                                py: 1.25,
                              },
                            }}
                          >
                            <TableCell sx={{ pl: 2.5, width: '30%' }}>Description</TableCell>
                            <TableCell>Stay / Ledger Date</TableCell>
                            <TableCell>Invoice #</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell align="right">Paid</TableCell>
                            <TableCell align="right">Balance</TableCell>
                            <TableCell sx={{ width: 110 }} />
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {activeCompanyEntries.map((entry) => {
                            const amount = parseFloat(String(entry.amount || 0));
                            const paid = parseFloat(String(entry.paid_amount || 0));
                            const balance = parseFloat(String(entry.balance_due || 0));
                            const voided = isVoidedLedger(entry);
                            const uiStatus = getLedgerUiStatus(entry);
                            const receiptNumber = (activeCompanyPayments[entry.id] || [])
                              .map(payment => payment.receipt_number)
                              .filter(Boolean)[0];
                            return (
                              <TableRow
                                key={entry.id}
                                hover
                                sx={{
                                  '&:hover .ledger-row-actions': { opacity: 1 },
                                  opacity: voided ? 0.6 : 1,
                                }}
                              >
                                <TableCell sx={{ pl: 2.5, py: 1.25 }}>
                                  <Typography
                                    sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}
                                  >
                                    {entry.description}
                                  </Typography>
                                  <Typography
                                    sx={{
                                      fontSize: 11,
                                      color: 'text.secondary',
                                      mt: 0.25,
                                      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                    }}
                                  >
                                    {entry.folio_number || `#${entry.id}`}
                                    {entry.room_number ? ` / Room ${entry.room_number}` : ''}
                                    {entry.expense_type ? ` / ${entry.expense_type}` : ''}
                                    {receiptNumber ? ` / Receipt ${receiptNumber}` : ''}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                                  {formatDateForDisplay(entry.posting_date || entry.created_at)}
                                </TableCell>
                                <TableCell sx={{ color: entry.invoice_number ? 'text.primary' : 'text.disabled', fontSize: 12 }}>
                                  {entry.invoice_number || 'Not invoiced'}
                                </TableCell>
                                <TableCell>
                                  <LedgerStatusBadge status={uiStatus} />
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{
                                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                    fontVariantNumeric: 'tabular-nums',
                                    fontWeight: 700,
                                    fontSize: 13,
                                  }}
                                >
                                  {formatCurrency(amount)}
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{
                                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                    fontVariantNumeric: 'tabular-nums',
                                    fontWeight: 700,
                                    fontSize: 13,
                                    color: paid > 0 ? 'success.main' : 'text.secondary',
                                  }}
                                >
                                  {formatCurrency(paid)}
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{
                                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                    fontVariantNumeric: 'tabular-nums',
                                    fontWeight: 700,
                                    fontSize: 13,
                                    color: balance > 0 ? 'error.main' : 'success.main',
                                  }}
                                >
                                  {formatCurrency(balance)}
                                </TableCell>
                                <TableCell sx={{ pr: 2 }}>
                                  <Box
                                    className="ledger-row-actions"
                                    sx={{
                                      display: 'inline-flex',
                                      gap: 0.25,
                                      opacity: { xs: 1, md: 0 },
                                      transition: 'opacity 120ms',
                                    }}
                                  >
                                    {canRecordPayment(entry) && (
                                      <IconButton
                                        size="small"
                                        title="Record payment"
                                        onClick={() => handleOpenPaymentDialog(entry)}
                                      >
                                        <PaymentIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    )}
                                    {canViewInvoice(entry) && (
                                      <IconButton
                                        size="small"
                                        title="View invoice"
                                        onClick={() => handleViewLedgerInvoice(entry)}
                                        disabled={loadingLedgerInvoice}
                                      >
                                        <OpenInNewIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    )}
                                    <IconButton
                                      size="small"
                                      title="Edit entry"
                                      onClick={() => handleEditLedger(entry)}
                                    >
                                      <EditIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                    <IconButton
                                      size="small"
                                      title="Print receipt"
                                      onClick={() => handlePrintSingleReceipt(entry)}
                                    >
                                      <PrintIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                    {canVoid(entry) && (
                                      <IconButton
                                        size="small"
                                        title="Void entry"
                                        color="error"
                                        onClick={() => handleVoidLedger(entry)}
                                      >
                                        <VoidIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    )}
                                  </Box>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </>
              )}

              {detailTab === 'info' && (
                <Box sx={{ p: 2.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EditIcon fontSize="small" />}
                      onClick={() => handleOpenEditCompany(activeCompany)}
                    >
                      Edit company
                    </Button>
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontWeight: 700,
                      color: 'text.secondary',
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                      mb: 1.5,
                    }}
                  >
                    Contact
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                      gap: '14px 22px',
                      mb: 3,
                    }}
                  >
                    <InfoField label="Phone" value={activeCompany.contact_phone || '-'} />
                    <InfoField label="Contact person" value={activeCompany.contact_person || '-'} />
                    <InfoField label="Email" value={activeCompany.contact_email || '-'} />
                    <InfoField
                      label="Registration no."
                      value={activeCompany.registration_number || '-'}
                    />
                    <InfoField
                      label="Address"
                      value={
                        [
                          activeCompany.billing_address,
                          activeCompany.billing_city,
                          activeCompany.billing_state,
                          activeCompany.billing_postal_code,
                        ]
                          .filter(Boolean)
                          .join(', ') || '-'
                      }
                      span={2}
                    />
                  </Box>

                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontWeight: 700,
                      color: 'text.secondary',
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                      mb: 1.5,
                    }}
                  >
                    Billing terms
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                      gap: '14px 22px',
                    }}
                  >
                    <InfoField
                      label="Credit limit"
                      value={
                        activeCompany.credit_limit != null
                          ? formatCurrency(parseFloat(String(activeCompany.credit_limit)))
                          : '-'
                      }
                    />
                    <InfoField
                      label="Payment terms"
                      value={`Net ${activeCompany.payment_terms_days || 30} days`}
                    />
                    <InfoField
                      label="Available credit"
                      value={
                        activeCompany.credit_limit != null
                          ? formatCurrency(
                              Math.max(parseFloat(String(activeCompany.credit_limit)) - activeAgg.due, 0),
                            )
                          : '-'
                      }
                    />
                  </Box>
                </Box>
              )}
              </Box>
            </>
          )}
        </Card>
      </Box>

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
                      // User selected "Add new company" option; open the full
                      // registration dialog with the typed name prefilled.
                      setCompanyRegForm({
                        company_name: newValue.inputValue || '',
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
                      setCompanyRegPrefillCreate(true);
                      setCompanyRegDialogOpen(true);
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
                label="Room Number"
                value={createFormData.room_number || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, room_number: e.target.value })}
                helperText="Used to detect possible duplicate stay charges"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Stay / Ledger Date"
                type="date"
                value={createFormData.posting_date || ''}
                onChange={(e) => setCreateFormData({
                  ...createFormData,
                  posting_date: e.target.value,
                  transaction_date: e.target.value,
                })}
                InputLabelProps={{ shrink: true }}
                helperText="Company + room + date + amount is checked for duplicates"
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
            onClick={() => handleCreateLedger()}
            variant="contained"
            disabled={creating || !createFormData.company_name || !createFormData.description || createFormData.amount <= 0}
          >
            {creating ? 'Creating...' : 'Create Entry'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Possible Duplicate Ledger Dialog */}
      <Dialog open={duplicateDialogOpen} onClose={() => setDuplicateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Possible duplicate ledger entry found</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            A ledger entry already exists for the same company, room, stay date, and amount.
          </Alert>
          {possibleDuplicateLedger && (
            <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Typography sx={{ fontWeight: 700 }}>{possibleDuplicateLedger.description}</Typography>
              <Typography variant="body2" color="text.secondary">
                Room {possibleDuplicateLedger.room_number || '-'} / {formatDateForDisplay(possibleDuplicateLedger.posting_date || possibleDuplicateLedger.created_at)}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                {formatCurrency(asMoney(possibleDuplicateLedger.amount))} / {possibleDuplicateLedger.invoice_number || 'Not invoiced'}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (possibleDuplicateLedger) {
                setSelectedCompanyId(activeCompany?.id || selectedCompanyId);
                setEntriesSearch(possibleDuplicateLedger.invoice_number || possibleDuplicateLedger.description);
              }
              setDuplicateDialogOpen(false);
            }}
          >
            View existing
          </Button>
          <Button onClick={() => setDuplicateDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => handleCreateLedger(true)} variant="contained" disabled={creating}>
            Create anyway
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
                                    showSnackbar('Payment deleted successfully');
                                    // Refresh payment history
                                    const payments = await HotelAPIService.getLedgerPayments(paymentLedger.id);
                                    setPaymentHistory(payments);
                                    await loadData();
                                  } catch (error: any) {
                                    showSnackbar(error.message || 'Failed to delete payment', 'error');
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
              disabled={
                processingPayment ||
                paymentFormData.payment_amount <= 0 ||
                (paymentLedger ? paymentFormData.payment_amount > getLedgerBalanceDue(paymentLedger) : true)
              }
            >
              {processingPayment ? 'Processing...' : 'Record Payment'}
            </Button>
          )}
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
        onClose={() => { setCompanyRegDialogOpen(false); resetCompanyRegForm(); setCompanyRegPrefillCreate(false); }}
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

              {/* Payment overflow warnings (v2) */}
              {(() => {
                const amt = parseFloat(companyPaymentForm.payment_amount || '0') || 0;
                const selectedDue = selectedLedgersForPayment.reduce((sum, l) => {
                  const a = typeof l.amount === 'string' ? parseFloat(l.amount) : l.amount;
                  const bal = typeof l.balance_due === 'string' ? parseFloat(l.balance_due) : (l.balance_due || a);
                  return sum + bal;
                }, 0);
                const companyDue = paymentCompany
                  ? ledgers
                      .filter(l => l.company_name === paymentCompany.company_name)
                      .reduce((sum, l) => sum + asMoney(l.balance_due), 0)
                  : 0;
                const exceedsSelection = amt > selectedDue + 0.001 && amt <= companyDue + 0.001;
                const exceedsOutstanding = amt > companyDue + 0.001;
                if (!exceedsSelection && !exceedsOutstanding) return null;
                return (
                  <Grid size={12}>
                    {exceedsSelection && (
                      <Alert severity="warning" sx={{ mb: 1 }}>
                        Payment amount exceeds selected entries by{' '}
                        <strong>{formatCurrency(amt - selectedDue)}</strong>. The excess will be parked as
                        credit on account.
                      </Alert>
                    )}
                    {exceedsOutstanding && (
                      <Alert severity="error">
                        Payment amount exceeds the company's total outstanding balance of{' '}
                        <strong>{formatCurrency(companyDue)}</strong>. Reduce the amount, or issue a credit note instead.
                      </Alert>
                    )}
                  </Grid>
                );
              })()}

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
                    inputProps: paymentCompany
                      ? {
                          min: 0,
                          max: ledgers
                            .filter(l => l.company_name === paymentCompany.company_name)
                            .reduce((sum, l) => sum + asMoney(l.balance_due), 0)
                            .toFixed(2),
                        }
                      : { min: 0 },
                  }}
                  helperText={
                    paymentCompany
                      ? `Max ${formatCurrency(
                          ledgers
                            .filter(l => l.company_name === paymentCompany.company_name)
                            .reduce((sum, l) => sum + asMoney(l.balance_due), 0),
                        )}`
                      : undefined
                  }
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
            disabled={(() => {
              if (processingCompanyPayment) return true;
              if (selectedLedgersForPayment.length === 0) return true;
              const amt = parseFloat(companyPaymentForm.payment_amount || '0') || 0;
              if (amt <= 0) return true;
              // v2: only block when payment exceeds the company's TOTAL outstanding
              // (exceeding the current selection is allowed — handled as credit on account).
              const companyDue = paymentCompany
                ? ledgers
                    .filter(l => l.company_name === paymentCompany.company_name)
                    .reduce((sum, l) => sum + asMoney(l.balance_due), 0)
                : 0;
              return amt > companyDue + 0.001;
            })()}
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

                {/* Select Ledger Entries — v2: tri-state chip filter */}
                <Grid size={12}>
                  <Divider sx={{ my: 1 }} />
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      mb: 1,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                      {([
                        { key: 'billable', label: 'Uninvoiced', count: invoiceFilterCounts.billable },
                        { key: 'all', label: 'All entries', count: invoiceFilterCounts.all },
                        { key: 'invoiced', label: 'Already invoiced', count: invoiceFilterCounts.invoiced },
                      ] as const).map(f => {
                        const on = invoiceListFilter === f.key;
                        return (
                          <Chip
                            key={f.key}
                            size="small"
                            label={
                              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                <span>{f.label}</span>
                                <Box
                                  component="span"
                                  sx={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    px: 0.6,
                                    py: 0.05,
                                    borderRadius: '999px',
                                    bgcolor: on ? 'rgba(255,255,255,0.25)' : 'action.selected',
                                  }}
                                >
                                  {f.count}
                                </Box>
                              </Box>
                            }
                            onClick={() => setInvoiceListFilter(f.key)}
                            sx={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              height: 26,
                              bgcolor: on ? 'text.primary' : 'background.paper',
                              color: on ? 'background.paper' : 'text.secondary',
                              border: '1px solid',
                              borderColor: on ? 'text.primary' : 'divider',
                              '&:hover': { bgcolor: on ? 'text.primary' : 'action.hover' },
                            }}
                          />
                        );
                      })}
                    </Box>
                    <Button
                      size="small"
                      variant="text"
                      onClick={handleSelectAllEligibleLedgers}
                      disabled={eligibleInvoiceCount === 0}
                    >
                      {eligibleInvoiceCount > 0 && selectedInvoiceLedgers.length === eligibleInvoiceCount
                        ? 'Deselect all'
                        : 'Select all billable'}
                    </Button>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Already-invoiced entries are protected and cannot be added to a new invoice. Use a credit note
                    instead.
                  </Typography>
                </Grid>

                {visibleInvoiceLedgerEntries.length === 0 ? (
                  <Grid size={12}>
                    <Alert severity="warning">
                      No uninvoiced outstanding ledger entries are eligible for invoice generation.
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
                          {visibleInvoiceLedgerEntries.map((ledger) => {
                            const amount = typeof ledger.amount === 'string' ? parseFloat(ledger.amount) : ledger.amount;
                            const balanceDue = typeof ledger.balance_due === 'string' ? parseFloat(ledger.balance_due) : (ledger.balance_due || 0);
                            const eligible = isInvoiceEligible(ledger);
                            return (
                              <TableRow
                                key={ledger.id}
                                hover={eligible}
                                selected={selectedInvoiceLedgers.includes(ledger.id)}
                                onClick={() => handleToggleLedgerSelection(ledger.id)}
                                sx={{
                                  cursor: eligible ? 'pointer' : 'not-allowed',
                                  opacity: eligible ? 1 : 0.62,
                                }}
                              >
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    checked={selectedInvoiceLedgers.includes(ledger.id)}
                                    disabled={!eligible}
                                    onChange={() => handleToggleLedgerSelection(ledger.id)}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                    {ledger.description}
                                  </Typography>
                                  {ledger.invoice_number && (
                                    <Typography variant="caption" color="text.secondary">
                                      Already invoiced: {ledger.invoice_number}
                                    </Typography>
                                  )}
                                </TableCell>
                                <TableCell>{formatDateForDisplay(ledger.created_at)}</TableCell>
                                <TableCell>
                                  <LedgerStatusBadge status={getLedgerUiStatus(ledger)} />
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
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Typography variant="caption" color="text.secondary">Selected Items</Typography>
                          <Typography variant="h6">{getSelectedInvoiceLedgers().length}</Typography>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                          <Typography variant="h6" color="primary.main">
                            {formatCurrency(getSelectedLedgerTotal())}
                          </Typography>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Typography variant="caption" color="text.secondary">Already Paid</Typography>
                          <Typography variant="h6" color="success.main">
                            {formatCurrency(getSelectedLedgerPaidTotal())}
                          </Typography>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                          <Typography variant="caption" color="text.secondary">Balance Due</Typography>
                          <Typography variant="h6" color="error.main">
                            {formatCurrency(getSelectedLedgerBalanceDue())}
                          </Typography>
                        </Grid>
                      </Grid>
                    </Paper>
                    {selectedInvoiceLedgers.some(id => {
                      const entry = invoiceLedgerEntries.find(l => l.id === id);
                      return !entry || !isInvoiceEligible(entry);
                    }) && (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        Some selected entries are no longer eligible and will be excluded from the invoice preview.
                      </Alert>
                    )}
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
                onClick={() => {
                  const invoiceNumberExists = ledgers.some(
                    ledger => ledger.invoice_number?.trim().toLowerCase() === invoiceNumber.trim().toLowerCase()
                      && !selectedInvoiceLedgers.includes(ledger.id),
                  );
                  if (invoiceNumberExists) {
                    showSnackbar('Invoice number already exists', 'warning');
                    return;
                  }
                  if (getSelectedInvoiceLedgers().length === 0) {
                    showSnackbar('Select at least one eligible ledger entry', 'warning');
                    return;
                  }
                  setSelectedInvoiceLedgers(getSelectedInvoiceLedgers().map(entry => entry.id));
                  setShowInvoicePreview(true);
                }}
                variant="contained"
                disabled={getSelectedInvoiceLedgers().length === 0 || !invoiceNumber}
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

      {/* Credit Note Dialog — posts to the backend reversal endpoint */}
      <Dialog
        open={creditNoteDialogOpen}
        onClose={() => setCreditNoteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <CreditNoteIcon color="error" />
            Issue Credit Note
            {activeCompany && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                · {activeCompany.company_name}
              </Typography>
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            A credit note posts a <strong>reversal entry</strong> against an existing ledger
            row. The original entry stays in the ledger and the reversal is audit-tracked.
            Reversals cannot be issued against another reversal.
          </Alert>
          <Grid container spacing={2}>
            <Grid size={12}>
              <TextField
                select
                fullWidth
                required
                label="Original ledger entry"
                value={creditNoteLedgerId}
                onChange={(e) => setCreditNoteLedgerId(e.target.value === '' ? '' : Number(e.target.value))}
                helperText="Pick the entry to reverse"
              >
                {activeCompanyAllEntries
                  .filter(l => !isVoidedLedger(l) && !l.is_reversal)
                  .map(l => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.invoice_number || l.folio_number || `#${l.id}`} · {l.description.slice(0, 48)}
                      {l.description.length > 48 ? '…' : ''} · {formatCurrency(asMoney(l.amount))}
                    </MenuItem>
                  ))}
              </TextField>
              {activeCompanyAllEntries.filter(l => !isVoidedLedger(l) && !l.is_reversal).length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  No reversible entries for this company.
                </Typography>
              )}
            </Grid>
            <Grid size={12}>
              <TextField
                select
                fullWidth
                required
                label="Reason"
                value={creditNoteReason}
                onChange={(e) => setCreditNoteReason(e.target.value)}
              >
                <MenuItem value="">Pick a reason…</MenuItem>
                <MenuItem value="Refund — early checkout">Refund — early checkout</MenuItem>
                <MenuItem value="Room downgrade">Room downgrade</MenuItem>
                <MenuItem value="Service not rendered">Service not rendered</MenuItem>
                <MenuItem value="Billing error">Billing error</MenuItem>
                <MenuItem value="Goodwill / discount">Goodwill / discount</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </TextField>
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Details (optional)"
                value={creditNoteNotes}
                onChange={(e) => setCreditNoteNotes(e.target.value)}
                placeholder="Explain the credit — appears on the reversal record."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreditNoteDialogOpen(false)} disabled={processingCreditNote}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmitCreditNote}
            variant="contained"
            color="error"
            disabled={processingCreditNote || !creditNoteLedgerId || !creditNoteReason}
            startIcon={processingCreditNote ? <CircularProgress size={18} /> : <CreditNoteIcon />}
          >
            {processingCreditNote ? 'Issuing…' : 'Issue credit note'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
};

export default CustomerLedgerPage;
