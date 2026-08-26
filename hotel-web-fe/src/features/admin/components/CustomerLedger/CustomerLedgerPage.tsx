import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
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
import { BookingsService, CompaniesService, GuestsService, LedgerService, RoomsService } from '../../../../api';
import { api } from '../../../../api/client';
import {
  CustomerLedger,
  CustomerLedgerCreateRequest,
  CustomerLedgerUpdateRequest,
  CustomerLedgerPayment,
  CustomerLedgerPaymentRequest,
  Room,
  Guest,
  BookingWithDetails,
  Booking,
} from '../../../../types';
import type { Company } from '../../../../types';
import { useCurrency } from '../../../../hooks/useCurrency';
import { useSearchParams } from '../../../../router';
import { getHotelSettings, HotelSettings } from '../../../../utils/hotelSettings';
import { formatLocalDate, addLocalDays } from '../../../../utils/date';
import { compareMoney, isGreaterMoney, isPositiveMoney, subtractMoney, sumMoney, toMoneyNumber } from '../../../../utils/money';
import { getIdempotencyAttempt, type IdempotencyAttempt } from '../../../../utils/idempotency';
import CheckoutInvoiceModals from '../../../invoices/components/CheckoutInvoiceModals';
import { useCheckoutFlow } from '../../../invoices/hooks/useCheckoutFlow';
import { enhanceBookingDetails } from '../../../../utils/bookingUtils';
import { useLedgers } from '../../hooks/useLedgers';
import { ApiNotificationSeverity, emitApiNotification } from '../../../../utils/apiNotifications';

// Extracted modules
import type { CompanyOption, LedgerUiStatus, EntryStatusFilter } from './types';
import { EXPENSE_TYPES, PAYMENT_METHODS } from './constants';
import {
  formatDateForInput,
  formatDateForDisplay,
  getStatusColor,
  getStatusText,
  asMoney,
  isLedgerVoided,
  getLedgerUiStatus,
} from './helpers';
import { LedgerStatusBadge, InfoField } from './StatusPill';
import {
  printCompanyInvoice,
  downloadCompanyInvoice,
  printCompanyStatement,
  printSingleReceipt,
} from './customerLedgerPrint';
import DuplicateLedgerDialog from './components/DuplicateLedgerDialog';
import VoidLedgerDialog from './components/VoidLedgerDialog';
import EditLedgerDialog from './components/EditLedgerDialog';
import DeleteCompanyDialog from './components/DeleteCompanyDialog';
import CreditNoteDialog from './components/CreditNoteDialog';
import CompanyFormDialog from './components/CompanyFormDialog';
import CreateLedgerDialog from './components/CreateLedgerDialog';
import PaymentDialog from './components/PaymentDialog';
import CompanyCheckInDialog from './components/CompanyCheckInDialog';
import RecordCompanyPaymentDialog from './components/RecordCompanyPaymentDialog';
import CompanyInvoiceDialog from './components/CompanyInvoiceDialog';
import LedgerSummaryStrip from './components/LedgerSummaryStrip';
import CompanyListPane from './components/CompanyListPane';
import CompanyDetailHeader from './components/CompanyDetailHeader';
import CompanyBalanceMeter from './components/CompanyBalanceMeter';
import ActiveGuestsRow from './components/ActiveGuestsRow';
import LedgerEntriesTab from './components/LedgerEntriesTab';
import CompanyInfoTab from './components/CompanyInfoTab';
import { useCustomerLedgerWorkspace } from './hooks/useCustomerLedgerWorkspace';
import { useConfirm } from '../../../../components/common/ConfirmProvider';

const normalizeOptionalPaymentText = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized || undefined;
};

const normalizeReceiptNumber = (value?: string): string | undefined =>
  normalizeOptionalPaymentText(value)?.toLowerCase();

const CustomerLedgerPage: React.FC = () => {
  const [pageSearchParams] = useSearchParams();
  const confirm = useConfirm();
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
  const [editBookingRoomRate, setEditBookingRoomRate] = useState('');
  const [loadingEditBookingRoomRate, setLoadingEditBookingRoomRate] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Void dialog state (mirrors normal booking void flow)
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingLedger, setVoidingLedger] = useState<CustomerLedger | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Read-only invoice (receipt) is shown via the shared checkoutFlow below.
  const [loadingLedgerInvoice, setLoadingLedgerInvoice] = useState(false);

  // Payment dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentLedger, setPaymentLedger] = useState<CustomerLedger | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<CustomerLedgerPayment[]>([]);
  const [paymentTab, setPaymentTab] = useState(0);
  const [paymentFormData, setPaymentFormData] = useState<CustomerLedgerPaymentRequest>({
    payment_amount: 0,
    payment_method: 'cash',
    payment_date: formatLocalDate(),
    idempotency_key: '',
  });
  const [processingPayment, setProcessingPayment] = useState(false);
  const ledgerPaymentAttemptRef = useRef<IdempotencyAttempt | null>(null);

  // Company autocomplete state
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyOption | null>(null);
  const [ledgerRooms, setLedgerRooms] = useState<Room[]>([]);
  const [loadingLedgerRooms, setLoadingLedgerRooms] = useState(false);

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

  // Shared checkout + read-only receipt flow. Company room charges are
  // auto-posted to customer_ledgers by the backend on the checked_out
  // transition, so this just updates status + marks the room dirty.
  const checkoutFlow = useCheckoutFlow({
    onAfterCheckout: async () => {
      await loadData();
      await loadAllCompanyBookings();
    },
    successMessage: (b) => `${b.guest_name} checked out from Room ${b.room_number}`,
    notify: (message, severity) => showSnackbar(message, severity as ApiNotificationSeverity),
  });

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
  const [checkInCompany, setCheckInCompany] = useState<Company | null>(null);
  const [checkInGuest, setCheckInGuest] = useState<Guest | null>(null);
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [checkInRoomRate, setCheckInRoomRate] = useState('');
  const [checkInDate, setCheckInDate] = useState<string>(formatLocalDate());
  const [checkOutDate, setCheckOutDate] = useState<string>(() => formatLocalDate(addLocalDays(new Date(), 1)));
  const [processingCheckIn, setProcessingCheckIn] = useState(false);
  const [isCreatingNewCheckInGuest, setIsCreatingNewCheckInGuest] = useState(false);
  const [newCheckInGuestForm, setNewCheckInGuestForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    ic_number: '',
    tourism_type: 'local',
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
  const companyPaymentAttemptRef = useRef<IdempotencyAttempt | null>(null);
  const [companyPaymentForm, setCompanyPaymentForm] = useState({
    payment_amount: '',
    payment_method: 'bank_transfer',
    payment_reference: '',
    receipt_number: '',
    notes: '',
    payment_date: formatLocalDate(),
  });

  // Company Invoice state
  const [companyInvoiceDialogOpen, setCompanyInvoiceDialogOpen] = useState(false);
  const [invoiceCompany, setInvoiceCompany] = useState<Company | null>(null);
  const [invoiceLedgerEntries, setInvoiceLedgerEntries] = useState<CustomerLedger[]>([]);
  const [selectedInvoiceLedgers, setSelectedInvoiceLedgers] = useState<number[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(formatLocalDate());
  const [invoiceDueDate, setInvoiceDueDate] = useState<string>(() => formatLocalDate(addLocalDays(new Date(), 30)));
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
  const [entriesPage, setEntriesPage] = useState(0);
  const [entriesPageSize, setEntriesPageSize] = useState(25);
  const routedLedgerTab = pageSearchParams.get('tab') || '';
  const routedLedgerSearch = pageSearchParams.get('search') || '';
  const routedLedgerId = pageSearchParams.get('ledger_id') || '';
  const routedLedgerCompanyId = pageSearchParams.get('company_id') || '';
  const routedLedgerCompanyName = pageSearchParams.get('company') || '';
  const [createMenuAnchor, setCreateMenuAnchor] = useState<null | HTMLElement>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [possibleDuplicateLedger, setPossibleDuplicateLedger] = useState<CustomerLedger | null>(null);
  const [activeCompanyPayments, setActiveCompanyPayments] = useState<Record<number, CustomerLedgerPayment[]>>({});
  const [loadingActiveCompanyPayments, setLoadingActiveCompanyPayments] = useState(false);
  const [expandedReceiptId, setExpandedReceiptId] = useState<number | null>(null);

  const handleEntriesStatusFilterChange = (value: EntryStatusFilter) => {
    setEntriesStatusFilter(value);
    setEntriesPage(0);
  };

  useEffect(() => {
    loadData();
    loadCompanies();
    loadGuests();
    loadAllCompanyBookings();

    const handleSettingsChange = () => setHotelSettings(getHotelSettings());
    window.addEventListener('hotelSettingsChange', handleSettingsChange);
    return () => window.removeEventListener('hotelSettingsChange', handleSettingsChange);
  }, [loadData]);

  useEffect(() => {
    const hasLedgerTarget = Boolean(
      routedLedgerTab ||
      routedLedgerSearch ||
      routedLedgerId ||
      routedLedgerCompanyId ||
      routedLedgerCompanyName,
    );
    if (!hasLedgerTarget) return;

    if (routedLedgerTab === 'entries' || routedLedgerSearch || routedLedgerId) {
      setDetailTab('entries');
    }

    const nextSearch = routedLedgerSearch || routedLedgerId;
    if (nextSearch) {
      setEntriesSearch(nextSearch);
      setEntriesStatusFilter('all');
      setEntriesPage(0);
    }

    const companyId = Number(routedLedgerCompanyId);
    if (Number.isFinite(companyId) && companyId > 0) {
      setSelectedCompanyId(companyId);
      return;
    }

    if (routedLedgerCompanyName && companies.length > 0) {
      const normalizedCompanyName = routedLedgerCompanyName.trim().toLowerCase();
      const company = companies.find(
        (item) => item.company_name.trim().toLowerCase() === normalizedCompanyName
      );
      if (company) setSelectedCompanyId(company.id);
    }
  }, [
    routedLedgerTab,
    routedLedgerSearch,
    routedLedgerId,
    routedLedgerCompanyId,
    routedLedgerCompanyName,
    companies,
  ]);

  // Load currently-active company-billed bookings.
  // Backend filters on company_id IS NOT NULL; we narrow to active statuses client-side.
  const loadAllCompanyBookings = async () => {
    try {
      const bookings = await BookingsService.getBookingsWithDetails({ company_billed: true });
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
      const companiesData = await CompaniesService.getCompanies({ is_active: true });
      setCompanies(companiesData);
      const options: CompanyOption[] = companiesData.map((company) => ({
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
      const guestsData = await GuestsService.getAllGuests();
      setGuests(guestsData.sort((a, b) => a.full_name.localeCompare(b.full_name)));
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

  const loadLedgerRooms = async () => {
    if (ledgerRooms.length > 0) return;

    try {
      setLoadingLedgerRooms(true);
      const rooms = await RoomsService.getAllRooms();
      setLedgerRooms(sortRoomsByNumber(rooms));
    } catch (err) {
      console.error('Failed to load rooms for ledger entry:', err);
      setLedgerRooms([]);
    } finally {
      setLoadingLedgerRooms(false);
    }
  };

  // Load available rooms for given dates
  const loadAvailableRooms = async (checkIn: string, checkOut: string) => {
    try {
      const rooms = await RoomsService.getAvailableRoomsForDates(checkIn, checkOut);
      setAvailableRooms(sortRoomsByNumber(rooms));
    } catch (err) {
      console.error('Failed to load available rooms:', err);
      setAvailableRooms([]);
    }
  };

  // Load bookings for a specific company
  const loadCompanyBookings = async (companyId: number) => {
    try {
      const allBookings = await BookingsService.getBookingsWithDetails();
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

  // Company selection from the check-in Autocomplete. Loads that company's
  // bookings (API) on select — kept page-side so the dialog stays presentational.
  const handleCheckInCompanyChange = (newValue: Company | null) => {
    setCheckInCompany(newValue);
    if (newValue) {
      loadCompanyBookings(newValue.id);
    } else {
      setCompanyBookings([]);
    }
  };

  // Handle company check-in
  const handleCompanyCheckIn = async () => {
    if (!checkInCompany || !checkInRoom) {
      showSnackbar('Please select a company and room', 'warning');
      return;
    }

    const customRoomRateInput = checkInRoomRate.trim();
    const roomRateOverride = customRoomRateInput ? toMoneyNumber(customRoomRateInput) : undefined;
    if (roomRateOverride !== undefined && !isPositiveMoney(roomRateOverride)) {
      showSnackbar('Please enter a valid room rate', 'warning');
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

        if (!newCheckInGuestForm.ic_number.trim()) {
          showSnackbar('Please enter IC/Passport number for the guest', 'warning');
          setProcessingCheckIn(false);
          return;
        }

        // Email and phone are optional — online bookings often arrive without
        // either, and contact details are collected at check-in. Do not block.

        // Validate email format only if provided
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (newCheckInGuestForm.email && newCheckInGuestForm.email.trim() && !emailRegex.test(newCheckInGuestForm.email)) {
          showSnackbar('Please enter a valid email address for the guest', 'warning');
          setProcessingCheckIn(false);
          return;
        }

        const newGuest = await GuestsService.createGuest({
          first_name: newCheckInGuestForm.first_name,
          last_name: newCheckInGuestForm.last_name,
          email: newCheckInGuestForm.email.trim() || undefined,
          phone: newCheckInGuestForm.phone.trim() || undefined,
          ic_number: newCheckInGuestForm.ic_number.trim() || undefined,
          tourism_type: (newCheckInGuestForm.tourism_type || 'local') as 'local' | 'foreign',
          nationality: newCheckInGuestForm.nationality.trim() || undefined,
          address_line1: newCheckInGuestForm.address_line1.trim() || undefined,
          city: newCheckInGuestForm.city.trim() || undefined,
          state_province: newCheckInGuestForm.state_province.trim() || undefined,
          postal_code: newCheckInGuestForm.postal_code.trim() || undefined,
          country: newCheckInGuestForm.country.trim() || undefined,
        });
        guestToUse = newGuest;
      }

      if (!guestToUse) {
        showSnackbar('Please select or create a guest', 'warning');
        setProcessingCheckIn(false);
        return;
      }

      // Get room_id - handle both 'id' and potential 'room_id' field names. The
      // `Room` type only ever declares `id`; `room_id` is a defensive fallback for
      // a differently-shaped payload that has never been observed from the API.
      const roomId = checkInRoom.id || (checkInRoom as unknown as { room_id?: string }).room_id;
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
          room_rate_override: roomRateOverride,
        },
      }).json<Booking>();

      // Update booking with company info
      await BookingsService.updateBooking(booking.id, {
        company_id: checkInCompany.id,
        company_name: checkInCompany.company_name,
      });

      // Check in the guest
      await BookingsService.checkInGuest(booking.id, {});

      // For back-dated bookings: auto-checkout if check-out date is today or in the past.
      // Backend's auto_post_company_ledger handles the room_charge ledger row on the
      // checked_out transition (and dedupes via an EXISTS check), so no client-side post here.
      const today = formatLocalDate();
      if (checkOutDate <= today) {
        await BookingsService.updateBooking(booking.id, { status: 'checked_out' });
      }

      showSnackbar(`Guest ${guestToUse.full_name} checked in to Room ${checkInRoom.room_number} (Company: ${checkInCompany.company_name})`);

      // Reset and close dialog
      setCheckInDialogOpen(false);
      resetCheckInForm();
      await loadData();
      await loadCompanies();
      await loadAllCompanyBookings();
    } catch (err) {
      console.error('Failed to perform company check-in:', err);
      showSnackbar(err instanceof Error && err.message ? err.message : 'Failed to perform company check-in', 'error');
    } finally {
      setProcessingCheckIn(false);
    }
  };

  // Reset check-in form
  const resetCheckInForm = () => {
    setCheckInCompany(null);
    setCheckInGuest(null);
    setCheckInRoom(null);
    setCheckInRoomRate('');
    setCheckInDate(formatLocalDate());
    setCheckOutDate(formatLocalDate(addLocalDays(new Date(), 1)));
    setIsCreatingNewCheckInGuest(false);
    setNewCheckInGuestForm({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      ic_number: '',
      tourism_type: 'local',
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
    checkoutFlow.openCheckout(booking);
  };

  // Backend's auto_post_company_ledger inserts the room_charge ledger row on the
  // checked_out transition, so no client-side ledger post is needed here — the
  // shared checkoutFlow just updates status, marks the room dirty, and reloads.

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

      const created = await CompaniesService.createCompany({
        company_name: companyRegForm.company_name.trim(),
        registration_number: companyRegForm.registration_number.trim() || undefined,
        contact_person: companyRegForm.contact_person.trim() || undefined,
        contact_email: companyRegForm.contact_email.trim() || undefined,
        contact_phone: companyRegForm.contact_phone.trim() || undefined,
        billing_address: companyRegForm.billing_address.trim() || undefined,
        billing_city: companyRegForm.billing_city.trim() || undefined,
        billing_state: companyRegForm.billing_state.trim() || undefined,
        billing_postal_code: companyRegForm.billing_postal_code.trim() || undefined,
        credit_limit: companyRegForm.credit_limit ? toMoneyNumber(companyRegForm.credit_limit) : undefined,
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
    } catch (error) {
      console.error('Failed to register company:', error);
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to register company', 'error');
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

      await CompaniesService.updateCompany(editingCompany.id, {
        company_name: companyEditForm.company_name.trim(),
        registration_number: companyEditForm.registration_number.trim() || undefined,
        contact_person: companyEditForm.contact_person.trim() || undefined,
        contact_email: companyEditForm.contact_email.trim() || undefined,
        contact_phone: companyEditForm.contact_phone.trim() || undefined,
        billing_address: companyEditForm.billing_address.trim() || undefined,
        billing_city: companyEditForm.billing_city.trim() || undefined,
        billing_state: companyEditForm.billing_state.trim() || undefined,
        billing_postal_code: companyEditForm.billing_postal_code.trim() || undefined,
        credit_limit: companyEditForm.credit_limit ? toMoneyNumber(companyEditForm.credit_limit) : undefined,
        payment_terms_days: companyEditForm.payment_terms_days ? parseInt(companyEditForm.payment_terms_days) : 30,
        notes: companyEditForm.notes.trim() || undefined,
      });

      showSnackbar(`Company "${companyEditForm.company_name}" updated successfully`);
      setCompanyEditDialogOpen(false);
      resetCompanyEditForm();

      // Reload companies
      await loadCompanies();
    } catch (error) {
      console.error('Failed to update company:', error);
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to update company', 'error');
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

      await CompaniesService.deleteCompany(deletingCompanyData.id);

      showSnackbar(`Company "${deletingCompanyData.company_name}" deleted successfully`);
      setCompanyDeleteDialogOpen(false);
      setDeletingCompanyData(null);

      // Reload companies
      await loadCompanies();
    } catch (error) {
      console.error('Failed to delete company:', error);
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to delete company', 'error');
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
           isPositiveMoney(getLedgerBalanceDue(l)) &&
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
      payment_date: formatLocalDate(),
      notes: '',
    });
    setPaymentCompany(null);
    setPaymentCompanyLedgers([]);
    setSelectedLedgersForPayment([]);
  };

  const isVoidedLedger = useCallback((ledger: CustomerLedger) => {
    return Boolean(ledger.void_at) || ledger.status === 'void';
  }, []);

  const getLedgerBalanceDue = useCallback((ledger: CustomerLedger) => {
    return isVoidedLedger(ledger) ? 0 : toMoneyNumber(ledger.balance_due);
  }, [isVoidedLedger]);

  const isInvoiceEligible = useCallback((ledger: CustomerLedger) => {
    return !ledger.invoice_number && !isVoidedLedger(ledger) && isPositiveMoney(getLedgerBalanceDue(ledger));
  }, [isVoidedLedger, getLedgerBalanceDue]);

  const getSelectedInvoiceLedgers = () =>
    invoiceLedgerEntries.filter(l => selectedInvoiceLedgers.includes(l.id) && (showInvoicePreview || isInvoiceEligible(l)));

  // Handle recording company payment (distributes across selected ledgers)
  const handleRecordCompanyPayment = async () => {
    if (selectedLedgersForPayment.length === 0 || !companyPaymentForm.payment_amount) {
      showSnackbar('Please select at least one ledger entry and enter payment amount', 'warning');
      return;
    }

    const paymentAmount = toMoneyNumber(companyPaymentForm.payment_amount);
    if (!isPositiveMoney(paymentAmount)) {
      showSnackbar('Please enter a valid payment amount', 'warning');
      return;
    }

    const selectedBalance = sumMoney(selectedLedgersForPayment.map(getLedgerBalanceDue));
    if (isGreaterMoney(paymentAmount, selectedBalance)) {
      showSnackbar('Payment amount cannot exceed the selected outstanding balance', 'warning');
      return;
    }

    const request = {
      ledger_ids: selectedLedgersForPayment.map((ledger) => ledger.id),
      payment_amount: paymentAmount,
      payment_method: companyPaymentForm.payment_method.trim(),
      payment_reference: normalizeOptionalPaymentText(companyPaymentForm.payment_reference),
      receipt_number: normalizeOptionalPaymentText(companyPaymentForm.receipt_number),
      notes: normalizeOptionalPaymentText(companyPaymentForm.notes),
      payment_date: normalizeOptionalPaymentText(companyPaymentForm.payment_date),
    };
    const fingerprint = JSON.stringify({
      ...request,
      payment_amount: paymentAmount.toFixed(2),
    });
    const receiptNumber = normalizeReceiptNumber(request.receipt_number);
    const retainedAttempt = companyPaymentAttemptRef.current?.fingerprint === fingerprint
      ? companyPaymentAttemptRef.current
      : null;

    try {
      setProcessingCompanyPayment(true);
      if (receiptNumber && !retainedAttempt) {
        let paymentHistories: CustomerLedgerPayment[][];
        try {
          paymentHistories = await Promise.all(
            selectedLedgersForPayment.map(ledger => LedgerService.getLedgerPayments(ledger.id)),
          );
        } catch (error) {
          console.error('Failed to verify receipt number:', error);
          showSnackbar('Unable to verify receipt number. Please try again.', 'error');
          return;
        }

        const receiptExists = paymentHistories.some(payments =>
          payments.some(payment => normalizeReceiptNumber(payment.receipt_number) === receiptNumber),
        );
        if (receiptExists) {
          showSnackbar('Receipt number already exists', 'warning');
          return;
        }
      }

      const attempt = retainedAttempt
        ?? getIdempotencyAttempt(companyPaymentAttemptRef.current, fingerprint);
      companyPaymentAttemptRef.current = attempt;
      await LedgerService.createCompanyLedgerPayment({ ...request, idempotency_key: attempt.key });

      // Re-fetch the entries we just paid against to see what's still owed.
      const refreshed = await Promise.all(
        paymentCompanyLedgers.map(l =>
          LedgerService.getCustomerLedger(l.id).catch(() => l)
        )
      );
      const stillOutstanding = refreshed.filter(
        l => isPositiveMoney(getLedgerBalanceDue(l)) && !isVoidedLedger(l)
      );

      // Reload the page table.
      await loadData();

      if (stillOutstanding.length === 0) {
        // Everything is settled — close the window.
        showSnackbar(`Payment of ${formatCurrency(paymentAmount)} recorded — all entries settled!`);
        setCompanyPaymentDialogOpen(false);
        resetCompanyPaymentForm();
      } else {
        // Outstanding entries remain — keep the window open and re-arm the form
        // for the next payment against the still-unpaid entries.
        showSnackbar(`Payment of ${formatCurrency(paymentAmount)} recorded! Outstanding entries remain.`);
        setPaymentCompanyLedgers(stillOutstanding);
        setSelectedLedgersForPayment(stillOutstanding);
        setCompanyPaymentForm(prev => ({
          ...prev,
          payment_amount: '',
          payment_reference: '',
          receipt_number: '',
          notes: '',
          payment_date: formatLocalDate(),
        }));
      }
      // Review finding I2: the attempt is released only after every step that
      // can throw. Clearing it right after the POST meant a failing refetch
      // fell into the catch below, showed "Failed to record payment" for a
      // payment that had in fact committed, and left the retry to mint a NEW
      // key -- charging the guest twice. While it is retained, an identical
      // retry replays server-side instead.
      companyPaymentAttemptRef.current = null;
    } catch (error) {
      console.error('Failed to record payment:', error);
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to record payment', 'error');
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
    setInvoiceDueDate(formatLocalDate(addLocalDays(new Date(), company.payment_terms_days || 30)));
    setInvoiceDate(formatLocalDate());
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
    setInvoiceDate(formatLocalDate());
    setInvoiceDueDate(formatLocalDate(addLocalDays(new Date(), 30)));
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

  const getSelectedLedgerTotal = () =>
    getSelectedInvoiceLedgers().reduce((sum, l) => sumMoney([sum, l.amount]), 0);

  const getSelectedLedgerPaidTotal = () => {
    return getSelectedInvoiceLedgers()
      .reduce((sum, l) => sumMoney([sum, l.paid_amount]), 0);
  };

  const getSelectedLedgerBalanceDue = () => {
    return getSelectedInvoiceLedgers()
      .reduce((sum, l) => sumMoney([sum, l.balance_due]), 0);
  };

  // Validate the invoice number + selection, then switch to the preview pane.
  // Lifted out of the dialog's Preview button so state ownership stays page-side.
  const handlePreviewInvoice = () => {
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
  };

  const handlePrintCompanyInvoice = () => {
    printCompanyInvoice(invoiceNumber);
  };

  const handleDownloadCompanyInvoice = () => {
    downloadCompanyInvoice({
      invoiceNumber,
      hotelSettings,
      invoiceCompany,
      invoiceDate,
      invoiceDueDate,
      invoiceNotes,
      invoiceLedgerEntries,
      selectedInvoiceLedgers,
      selectedLedgerTotal: getSelectedLedgerTotal(),
      selectedLedgerBalanceDue: getSelectedLedgerBalanceDue(),
      formatCurrency,
    });
  };

  const findPossibleDuplicateLedger = () => {
    const company = createFormData.company_name.trim().toLowerCase();
    const room = (createFormData.room_number || '').trim().toLowerCase();
    const stayDate = createFormData.posting_date || createFormData.transaction_date || createFormData.invoice_date || '';
    const amount = toMoneyNumber(createFormData.amount);

    if (!company || !room || !stayDate || !isPositiveMoney(amount)) return null;

    return ledgers.find((ledger) => {
      const ledgerDate = formatDateForInput(ledger.posting_date || ledger.transaction_date || ledger.invoice_date || ledger.created_at);
      return (
        ledger.company_name.trim().toLowerCase() === company &&
        (ledger.room_number || '').trim().toLowerCase() === room &&
        ledgerDate === stayDate &&
        compareMoney(ledger.amount, amount) === 0 &&
        !isLedgerVoided(ledger)
      );
    }) || null;
  };

  const selectedCreateRoom = useMemo(() => {
    const roomNumber = (createFormData.room_number || '').trim();
    if (!roomNumber) return null;
    return ledgerRooms.find((room) => room.room_number === roomNumber) || null;
  }, [createFormData.room_number, ledgerRooms]);

  // Company selection from the create-entry Autocomplete. Owns the decision to
  // either prefill the create form from an existing company or open the full
  // registration dialog for a brand-new one — kept in the page so the create
  // dialog stays presentational.
  const handleCreateCompanyChange = (newValue: CompanyOption | null) => {
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
      await LedgerService.createCustomerLedger({
        ...createFormData,
        amount: toMoneyNumber(createFormData.amount),
      });
      showSnackbar('Ledger entry created successfully!');
      setCreateDialogOpen(false);
      setDuplicateDialogOpen(false);
      setPossibleDuplicateLedger(null);
      resetCreateForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to create ledger entry');
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
  const handleEditLedger = async (ledger: CustomerLedger) => {
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
      status: ledger.status,
      due_date: formatDateForInput(ledger.due_date),
      notes: ledger.notes,
      internal_notes: ledger.internal_notes,
    });
    setEditBookingRoomRate('');
    setLoadingEditBookingRoomRate(Boolean(ledger.booking_id && ledger.post_type === 'room_charge'));
    setEditDialogOpen(true);

    if (ledger.booking_id && ledger.post_type === 'room_charge') {
      try {
        const booking = await BookingsService.getBookingById(String(ledger.booking_id));
        const roomRate = toMoneyNumber(booking.room_rate);
        setEditBookingRoomRate(isPositiveMoney(roomRate) ? roomRate.toFixed(2) : '');
      } catch (err) {
        console.error('Failed to load booking rate for ledger entry:', err);
        showSnackbar('Unable to load booking room rate', 'warning');
      } finally {
        setLoadingEditBookingRoomRate(false);
      }
    }
  };

  const handleUpdateLedger = async () => {
    if (!editingLedger) return;

    const bookingRoomRateInput = editBookingRoomRate.trim();
    const bookingRoomRateOverride = editingLedger.booking_id && editingLedger.post_type === 'room_charge' && bookingRoomRateInput
      ? toMoneyNumber(bookingRoomRateInput)
      : undefined;
    if (
      bookingRoomRateOverride !== undefined &&
      !isPositiveMoney(bookingRoomRateOverride)
    ) {
      showSnackbar('Please enter a valid booking room rate', 'warning');
      return;
    }

    try {
      setUpdating(true);
      if (bookingRoomRateOverride !== undefined && editingLedger.booking_id) {
        await BookingsService.updateBooking(String(editingLedger.booking_id), {
          room_rate_override: bookingRoomRateOverride,
        });
      }
      await LedgerService.updateCustomerLedger(editingLedger.id, editFormData);
      showSnackbar(bookingRoomRateOverride !== undefined
        ? 'Ledger entry and booking rate updated successfully!'
        : 'Ledger entry updated successfully!');
      setEditDialogOpen(false);
      setEditingLedger(null);
      setEditBookingRoomRate('');
      await loadData();
      await loadAllCompanyBookings();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to update ledger entry');
    } finally {
      setUpdating(false);
    }
  };

  // Payment handlers
  const handleOpenPaymentDialog = async (ledger: CustomerLedger) => {
    setPaymentLedger(ledger);
    setPaymentFormData({
      payment_amount: getLedgerBalanceDue(ledger),
      payment_method: 'cash',
      payment_date: formatLocalDate(),
      idempotency_key: '',
    });
    setPaymentTab(0);
    setPaymentDialogOpen(true);

    // Load payment history
    try {
      const payments = await LedgerService.getLedgerPayments(ledger.id);
      setPaymentHistory(payments);
    } catch (err) {
      console.error('Failed to load payment history:', err);
      setPaymentHistory([]);
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentLedger) return;

    const balanceDue = getLedgerBalanceDue(paymentLedger);
    if (isGreaterMoney(paymentFormData.payment_amount, balanceDue)) {
      showSnackbar('Payment amount cannot exceed the outstanding balance', 'warning');
      return;
    }

    const paymentAmount = toMoneyNumber(paymentFormData.payment_amount);
    const paymentRequest = {
      payment_amount: paymentAmount,
      payment_method: paymentFormData.payment_method.trim(),
      payment_reference: normalizeOptionalPaymentText(paymentFormData.payment_reference),
      receipt_number: normalizeOptionalPaymentText(paymentFormData.receipt_number),
      receipt_file_url: normalizeOptionalPaymentText(paymentFormData.receipt_file_url),
      notes: normalizeOptionalPaymentText(paymentFormData.notes),
      payment_date: normalizeOptionalPaymentText(paymentFormData.payment_date),
    };
    const fingerprint = JSON.stringify({
      ledger_id: paymentLedger.id,
      ...paymentRequest,
      payment_amount: paymentAmount.toFixed(2),
    });
    const receiptNumber = normalizeReceiptNumber(paymentRequest.receipt_number);
    const retainedAttempt = ledgerPaymentAttemptRef.current?.fingerprint === fingerprint
      ? ledgerPaymentAttemptRef.current
      : null;

    try {
      setProcessingPayment(true);
      if (receiptNumber && !retainedAttempt) {
        let payments: CustomerLedgerPayment[];
        try {
          payments = await LedgerService.getLedgerPayments(paymentLedger.id);
        } catch (error) {
          console.error('Failed to verify receipt number:', error);
          showSnackbar('Unable to verify receipt number. Please try again.', 'error');
          return;
        }

        const receiptExists = payments.some(
          payment => normalizeReceiptNumber(payment.receipt_number) === receiptNumber,
        );
        if (receiptExists) {
          showSnackbar('Receipt number already exists', 'warning');
          return;
        }
      }

      const attempt = retainedAttempt
        ?? getIdempotencyAttempt(ledgerPaymentAttemptRef.current, fingerprint);
      ledgerPaymentAttemptRef.current = attempt;
      await LedgerService.createLedgerPayment(paymentLedger.id, {
        ...paymentRequest,
        idempotency_key: attempt.key,
      });

      // Re-fetch the ledger + history so the dialog reflects the new balance.
      const [updatedLedger, payments] = await Promise.all([
        LedgerService.getCustomerLedger(paymentLedger.id),
        LedgerService.getLedgerPayments(paymentLedger.id),
      ]);
      setPaymentHistory(payments);
      await loadData();

      const remainingBalance = getLedgerBalanceDue(updatedLedger);
      if (!isPositiveMoney(remainingBalance)) {
        // Fully settled — close the window.
        showSnackbar('Payment recorded — balance fully settled!');
        setPaymentDialogOpen(false);
        setPaymentLedger(null);
      } else {
        // Still outstanding — keep the window open and re-arm the form for the
        // next payment (defaulting the amount to the remaining balance).
        showSnackbar('Payment recorded! Remaining balance still outstanding.');
        setPaymentLedger(updatedLedger);
        setPaymentFormData({
          payment_amount: remainingBalance,
          payment_method: paymentFormData.payment_method,
          payment_date: formatLocalDate(),
          idempotency_key: '',
        });
      }

      // Review finding I2: released only after every step that can throw. The
      // clear used to sit immediately after the POST, so a failing re-fetch
      // landed in the catch below, showed "Failed to record payment" for a
      // payment that had in fact committed, and left the retry to mint a NEW
      // key -- charging the company twice. Retained, an identical retry
      // replays server-side instead.
      ledgerPaymentAttemptRef.current = null;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to record payment');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleSavePaymentDate = async (payment: CustomerLedgerPayment) => {
    if (!editingPaymentDate || !paymentLedger) return;
    try {
      setSavingPaymentDate(true);
      const updatedPayment = await LedgerService.updateLedgerPaymentDate(paymentLedger.id, payment.id, editingPaymentDate);
      setPaymentHistory(prev => prev.map(p => p.id === updatedPayment.id ? updatedPayment : p));
      setActiveCompanyPayments(prev => {
        const ledgerPayments = prev[updatedPayment.ledger_id];
        if (!ledgerPayments) return prev;
        return {
          ...prev,
          [updatedPayment.ledger_id]: ledgerPayments.map(p =>
            p.id === updatedPayment.id ? updatedPayment : p
          ),
        };
      });
      // Refresh payment history
      const payments = await LedgerService.getLedgerPayments(paymentLedger.id);
      setPaymentHistory(payments);
      setEditingPaymentId(null);
      showSnackbar('Payment date updated successfully');
      await loadData();
    } catch (err) {
      showSnackbar(err instanceof Error && err.message ? err.message : 'Failed to update payment date', 'error');
    } finally {
      setSavingPaymentDate(false);
    }
  };

  // Delete a payment from the history tab (lifted out of the dialog JSX so the
  // API call stays page-side). Refreshes history + ledger totals on success.
  const handleDeletePayment = async (payment: CustomerLedgerPayment) => {
    if (!paymentLedger) return;
    const accepted = await confirm({
      title: 'Delete payment',
      message: 'This removes the payment from the ledger and restores the outstanding balance. This cannot be undone.',
      confirmText: 'Delete payment',
      severity: 'error',
    });
    if (!accepted) return;
    try {
      await LedgerService.deleteLedgerPayment(paymentLedger.id, payment.id);
      showSnackbar('Payment deleted successfully');
      // Refresh payment history
      const payments = await LedgerService.getLedgerPayments(paymentLedger.id);
      setPaymentHistory(payments);
      await loadData();
    } catch (error) {
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to delete payment', 'error');
    }
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
      await LedgerService.voidLedger(voidingLedger.id, {
        reason: voidReason || 'Voided by admin',
      });
      showSnackbar('Ledger entry voided successfully');
      setVoidDialogOpen(false);
      setVoidingLedger(null);
      setVoidReason('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to void ledger entry');
    } finally {
      setVoiding(false);
    }
  };

  const handleViewLedgerInvoice = async (ledger: CustomerLedger) => {
    if (!ledger.booking_id) return;
    try {
      setLoadingLedgerInvoice(true);
      const booking = await api.get(`bookings/${ledger.booking_id}`).json<BookingWithDetails>();
      checkoutFlow.openReceipt(enhanceBookingDetails(booking), ledger);
    } catch (err) {
      showSnackbar(err instanceof Error && err.message ? err.message : 'Failed to load invoice', 'error');
    } finally {
      setLoadingLedgerInvoice(false);
    }
  };

  // Print company ledger statement
  const handlePrintCompanyStatement = (companyName: string) => {
    printCompanyStatement({
      companyName,
      ledgers,
      hotelSettings,
      formatCurrency,
      onEmpty: () => showSnackbar('No ledger entries to print for this company.', 'info'),
    });
  };

  // Print a single receipt
  const handlePrintSingleReceipt = (entry: CustomerLedger) => {
    printSingleReceipt({ entry, hotelSettings, formatCurrency });
  };

  const {
    summary,
    companyAggregates,
    companyListRows,
    dueCount,
    clearCount,
    activeCompany,
    activeAgg,
    activeBookingsForCompany,
    activeCompanyAllEntries,
    activeCompanyEntries,
    activeCompanyEntriesTotal,
    activeCompanyEntriesLoading,
    paidEntriesCount,
  } = useCustomerLedgerWorkspace({
    ledgers,
    companies,
    allCompanyBookings,
    selectedCompanyId,
    setSelectedCompanyId,
    companyListSearch,
    companyListFilter,
    entriesSearch,
    entriesStatusFilter,
    entriesPage,
    entriesPageSize,
    setEntriesPage,
  });

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
              const payments = await LedgerService.getLedgerPayments(ledger.id);
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
  }, [invoiceLedgerEntries, invoiceListFilter, isVoidedLedger, isInvoiceEligible]);

  const invoiceFilterCounts = useMemo(() => {
    const nonVoid = invoiceLedgerEntries.filter(l => !isVoidedLedger(l));
    return {
      billable: nonVoid.filter(isInvoiceEligible).length,
      all: nonVoid.length,
      invoiced: nonVoid.filter(l => Boolean(l.invoice_number)).length,
    };
  }, [invoiceLedgerEntries, isVoidedLedger, isInvoiceEligible]);

  const eligibleInvoiceCount = useMemo(
    () => invoiceLedgerEntries.filter(isInvoiceEligible).length,
    [invoiceLedgerEntries, isInvoiceEligible],
  );


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

  const openCreateLedgerDialog = () => {
    setCreateDialogOpen(true);
    void loadLedgerRooms();
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
      openCreateLedgerDialog();
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
      await LedgerService.reverseLedger(Number(creditNoteLedgerId), {
        reason: reasonText,
        notes: creditNoteNotes.trim() || undefined,
      });
      showSnackbar('Credit note issued — reversal entry posted.');
      setCreditNoteDialogOpen(false);
      setCreditNoteLedgerId('');
      setCreditNoteReason('');
      setCreditNoteNotes('');
      await loadData();
    } catch (err) {
      showSnackbar(err instanceof Error && err.message ? err.message : 'Failed to issue credit note', 'error');
    } finally {
      setProcessingCreditNote(false);
    }
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px"
        }}>
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
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 0.5
            }}>
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
            <MenuItem onClick={() => openContextualCreate('payment')} disabled={!activeCompany || !isPositiveMoney(activeAgg.due)}>
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
      <LedgerSummaryStrip
        summary={summary}
        ledgers={ledgers}
        companiesCount={companies.length}
        formatCurrency={formatCurrency}
        currencySymbol={currencySymbol}
      />
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
        <CompanyListPane
          companies={companies}
          companyListRows={companyListRows}
          search={companyListSearch}
          onSearchChange={setCompanyListSearch}
          filter={companyListFilter}
          onFilterChange={setCompanyListFilter}
          dueCount={dueCount}
          clearCount={clearCount}
          selectedCompanyId={selectedCompanyId}
          onSelect={setSelectedCompanyId}
          onRegister={() => setCompanyRegDialogOpen(true)}
          formatCurrency={formatCurrency}
        />

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
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  maxWidth: 320,
                  mx: 'auto'
                }}>
                Select a company to view its ledger entries, balance, and take actions like
                check-in, payment, or invoicing.
              </Typography>
            </Box>
          ) : (
            <>
              {/* Company header */}
              <CompanyDetailHeader
                company={activeCompany}
                entryCount={activeAgg.count}
                hasActiveBookings={activeBookingsForCompany.length > 0}
                formatCurrency={formatCurrency}
                onPrintStatement={() => handlePrintCompanyStatement(activeCompany.company_name)}
                onDelete={() => handleOpenDeleteCompany(activeCompany)}
              />

              {/* Billed / Collected / Outstanding meter */}
              <CompanyBalanceMeter
                agg={activeAgg}
                currencySymbol={currencySymbol}
                formatCurrency={formatCurrency}
              />

              {/* Active guests row (if any) */}
              <ActiveGuestsRow
                bookings={activeBookingsForCompany}
                onCheckout={handleOpenCheckoutDialog}
              />

              {/* Tabs + per-tab primary action (v2) */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' },
                  alignItems: 'center',
                  gap: { xs: 0.75, sm: 1.5 },
                  px: 2.5,
                  py: 0.75,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Tabs
                  value={detailTab}
                  onChange={(_, v) => setDetailTab(v)}
                  sx={{
                    minWidth: 0,
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
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                    minHeight: 40,
                  }}
                >
                  {detailTab === 'entries' && (
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => {
                        if (!activeCompany) return;
                        prefillCreateForCompany(activeCompany);
                        openCreateLedgerDialog();
                      }}
                      disabled={!activeCompany}
                      sx={{
                        height: 34,
                        minHeight: 34,
                        px: 1.5,
                        py: 0,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
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
                      sx={{
                        height: 34,
                        minHeight: 34,
                        px: 1.5,
                        py: 0,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      Edit company
                    </Button>
                  )}
                </Box>
              </Box>

              {/* Scrollable tab body keeps header/meter/tabs pinned above */}
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {detailTab === 'entries' && (
                <LedgerEntriesTab
                  search={entriesSearch}
                  onSearchChange={setEntriesSearch}
                  statusFilter={entriesStatusFilter}
                  onStatusFilterChange={handleEntriesStatusFilterChange}
                  loading={activeCompanyEntriesLoading}
                  entries={activeCompanyEntries}
                  entryCount={activeAgg.count}
                  payments={activeCompanyPayments}
                  total={activeCompanyEntriesTotal}
                  page={entriesPage}
                  onPageChange={setEntriesPage}
                  pageSize={entriesPageSize}
                  onPageSizeChange={(size) => { setEntriesPageSize(size); setEntriesPage(0); }}
                  loadingInvoice={loadingLedgerInvoice}
                  onRecordPayment={handleOpenPaymentDialog}
                  onViewInvoice={handleViewLedgerInvoice}
                  onEdit={handleEditLedger}
                  onPrintReceipt={handlePrintSingleReceipt}
                  onVoid={handleVoidLedger}
                  formatCurrency={formatCurrency}
                />
              )}

              {detailTab === 'info' && (
                <CompanyInfoTab
                  company={activeCompany}
                  dueAmount={activeAgg.due}
                  formatCurrency={formatCurrency}
                  onEdit={() => handleOpenEditCompany(activeCompany)}
                />
              )}
              </Box>
            </>
          )}
        </Card>
      </Box>
      {/* Create Ledger Dialog */}
      <CreateLedgerDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        createFormData={createFormData}
        setCreateFormData={setCreateFormData}
        selectedCompany={selectedCompany}
        onCompanyChange={handleCreateCompanyChange}
        selectedCreateRoom={selectedCreateRoom}
        companyOptions={companyOptions}
        ledgerRooms={ledgerRooms}
        loadingLedgerRooms={loadingLedgerRooms}
        loadLedgerRooms={loadLedgerRooms}
        creating={creating}
        onSubmit={() => handleCreateLedger()}
        onCancel={() => { setCreateDialogOpen(false); resetCreateForm(); }}
        currencySymbol={currencySymbol}
      />
      {/* Possible Duplicate Ledger Dialog */}
      <DuplicateLedgerDialog
        open={duplicateDialogOpen}
        onClose={() => setDuplicateDialogOpen(false)}
        duplicate={possibleDuplicateLedger}
        creating={creating}
        onViewExisting={() => {
          if (possibleDuplicateLedger) {
            setSelectedCompanyId(activeCompany?.id || selectedCompanyId);
            setEntriesSearch(possibleDuplicateLedger.invoice_number || possibleDuplicateLedger.description);
          }
          setDuplicateDialogOpen(false);
        }}
        onCreateAnyway={() => handleCreateLedger(true)}
        formatCurrency={formatCurrency}
      />
      {/* Edit Ledger Dialog */}
      <EditLedgerDialog
        open={editDialogOpen}
        onClose={() => { setEditDialogOpen(false); setEditBookingRoomRate(''); }}
        editingLedger={editingLedger}
        editFormData={editFormData}
        setEditFormData={setEditFormData}
        bookingRoomRate={editBookingRoomRate}
        setBookingRoomRate={setEditBookingRoomRate}
        loadingBookingRoomRate={loadingEditBookingRoomRate}
        updating={updating}
        onUpdate={handleUpdateLedger}
        currencySymbol={currencySymbol}
      />
      {/* Void Ledger Dialog */}
      <VoidLedgerDialog
        open={voidDialogOpen}
        onClose={() => setVoidDialogOpen(false)}
        voidingLedger={voidingLedger}
        voidReason={voidReason}
        onVoidReasonChange={setVoidReason}
        voiding={voiding}
        onConfirm={handleConfirmVoidLedger}
        formatCurrency={formatCurrency}
      />
      {/* Payment Dialog */}
      <PaymentDialog
        open={paymentDialogOpen}
        onClose={() => setPaymentDialogOpen(false)}
        paymentTab={paymentTab}
        setPaymentTab={setPaymentTab}
        paymentFormData={paymentFormData}
        setPaymentFormData={setPaymentFormData}
        paymentLedger={paymentLedger}
        paymentHistory={paymentHistory}
        editingPaymentId={editingPaymentId}
        setEditingPaymentId={setEditingPaymentId}
        editingPaymentDate={editingPaymentDate}
        setEditingPaymentDate={setEditingPaymentDate}
        savingPaymentDate={savingPaymentDate}
        processingPayment={processingPayment}
        onRecordPayment={handleRecordPayment}
        onSavePaymentDate={handleSavePaymentDate}
        onDeletePayment={handleDeletePayment}
        currencySymbol={currencySymbol}
        formatCurrency={formatCurrency}
        getLedgerBalanceDue={getLedgerBalanceDue}
      />
      {/* Company Check-In Dialog */}
      <CompanyCheckInDialog
        open={checkInDialogOpen}
        onClose={() => { setCheckInDialogOpen(false); resetCheckInForm(); }}
        checkInCompany={checkInCompany}
        onCompanyChange={handleCheckInCompanyChange}
        isCreatingNewCheckInGuest={isCreatingNewCheckInGuest}
        setIsCreatingNewCheckInGuest={setIsCreatingNewCheckInGuest}
        checkInGuest={checkInGuest}
        setCheckInGuest={setCheckInGuest}
        newCheckInGuestForm={newCheckInGuestForm}
        setNewCheckInGuestForm={setNewCheckInGuestForm}
        checkInDate={checkInDate}
        onCheckInDateChange={handleCheckInDateChange}
        checkOutDate={checkOutDate}
        onCheckOutDateChange={handleCheckOutDateChange}
        checkInRoom={checkInRoom}
        setCheckInRoom={setCheckInRoom}
        customRoomRate={checkInRoomRate}
        setCustomRoomRate={setCheckInRoomRate}
        companies={companies}
        guests={guests}
        availableRooms={availableRooms}
        companyBookings={companyBookings}
        processingCheckIn={processingCheckIn}
        onSubmit={handleCompanyCheckIn}
        currencySymbol={currencySymbol}
        formatCurrency={formatCurrency}
      />
      {/* Checkout Invoice Modal */}
      {/* Shared checkout + read-only receipt modals */}
      <CheckoutInvoiceModals
        flow={checkoutFlow}
        onReceiptPaymentsChanged={() => { void loadData(); }}
      />
      {/* Company Registration Dialog */}
      <CompanyFormDialog
        open={companyRegDialogOpen}
        onClose={() => { setCompanyRegDialogOpen(false); resetCompanyRegForm(); setCompanyRegPrefillCreate(false); }}
        onCancel={() => { setCompanyRegDialogOpen(false); resetCompanyRegForm(); }}
        mode="create"
        form={companyRegForm}
        setForm={setCompanyRegForm}
        submitting={creatingCompany}
        currencySymbol={currencySymbol}
        onSubmit={handleRegisterCompany}
      />
      {/* Edit Company Dialog */}
      <CompanyFormDialog
        open={companyEditDialogOpen}
        onClose={() => { setCompanyEditDialogOpen(false); resetCompanyEditForm(); }}
        onCancel={() => { setCompanyEditDialogOpen(false); resetCompanyEditForm(); }}
        mode="edit"
        form={companyEditForm}
        setForm={setCompanyEditForm}
        submitting={updatingCompany}
        currencySymbol={currencySymbol}
        onSubmit={handleUpdateCompany}
      />
      {/* Delete Company Confirmation Dialog */}
      <DeleteCompanyDialog
        open={companyDeleteDialogOpen}
        onClose={() => { setCompanyDeleteDialogOpen(false); setDeletingCompanyData(null); }}
        company={deletingCompanyData}
        deleting={deletingCompany}
        onConfirm={handleDeleteCompany}
      />
      {/* Record Payment Dialog */}
      <RecordCompanyPaymentDialog
        open={companyPaymentDialogOpen}
        onClose={() => { setCompanyPaymentDialogOpen(false); resetCompanyPaymentForm(); }}
        companyPaymentForm={companyPaymentForm}
        setCompanyPaymentForm={setCompanyPaymentForm}
        selectedLedgersForPayment={selectedLedgersForPayment}
        setSelectedLedgersForPayment={setSelectedLedgersForPayment}
        paymentCompany={paymentCompany}
        paymentCompanyLedgers={paymentCompanyLedgers}
        ledgers={ledgers}
        processingCompanyPayment={processingCompanyPayment}
        onSubmit={handleRecordCompanyPayment}
        currencySymbol={currencySymbol}
        formatCurrency={formatCurrency}
      />
      {/* Company Invoice Dialog */}
      <CompanyInvoiceDialog
        open={companyInvoiceDialogOpen}
        onClose={() => { setCompanyInvoiceDialogOpen(false); resetCompanyInvoiceForm(); }}
        showInvoicePreview={showInvoicePreview}
        onPreview={handlePreviewInvoice}
        onBackToEdit={() => setShowInvoicePreview(false)}
        invoiceNumber={invoiceNumber}
        setInvoiceNumber={setInvoiceNumber}
        invoiceDate={invoiceDate}
        setInvoiceDate={setInvoiceDate}
        invoiceDueDate={invoiceDueDate}
        setInvoiceDueDate={setInvoiceDueDate}
        invoiceNotes={invoiceNotes}
        setInvoiceNotes={setInvoiceNotes}
        invoiceListFilter={invoiceListFilter}
        setInvoiceListFilter={setInvoiceListFilter}
        selectedInvoiceLedgers={selectedInvoiceLedgers}
        onToggleLedgerSelection={handleToggleLedgerSelection}
        onSelectAllEligible={handleSelectAllEligibleLedgers}
        invoiceCompany={invoiceCompany}
        invoiceLedgerEntries={invoiceLedgerEntries}
        visibleInvoiceLedgerEntries={visibleInvoiceLedgerEntries}
        invoiceFilterCounts={invoiceFilterCounts}
        eligibleInvoiceCount={eligibleInvoiceCount}
        hotelSettings={hotelSettings}
        isInvoiceEligible={isInvoiceEligible}
        getSelectedInvoiceLedgers={getSelectedInvoiceLedgers}
        getSelectedLedgerTotal={getSelectedLedgerTotal}
        getSelectedLedgerPaidTotal={getSelectedLedgerPaidTotal}
        getSelectedLedgerBalanceDue={getSelectedLedgerBalanceDue}
        onPrint={handlePrintCompanyInvoice}
        onDownload={handleDownloadCompanyInvoice}
        formatCurrency={formatCurrency}
      />
      {/* Credit Note Dialog — posts to the backend reversal endpoint */}
      <CreditNoteDialog
        open={creditNoteDialogOpen}
        onClose={() => setCreditNoteDialogOpen(false)}
        activeCompany={activeCompany}
        reversibleEntries={activeCompanyAllEntries.filter(l => !isVoidedLedger(l) && !l.is_reversal)}
        creditNoteLedgerId={creditNoteLedgerId}
        setCreditNoteLedgerId={setCreditNoteLedgerId}
        creditNoteReason={creditNoteReason}
        setCreditNoteReason={setCreditNoteReason}
        creditNoteNotes={creditNoteNotes}
        setCreditNoteNotes={setCreditNoteNotes}
        processingCreditNote={processingCreditNote}
        onSubmit={handleSubmitCreditNote}
        formatCurrency={formatCurrency}
      />
    </Box>
  );
};

export default CustomerLedgerPage;
