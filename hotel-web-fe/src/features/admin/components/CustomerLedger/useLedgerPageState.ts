 /**
 * Custom hook encapsulating all state management and handlers for the
 * Customer Ledger page. Extracted to reduce the main component from
 * ~3,300 lines to a more manageable size.
 */
import { useState, useEffect, useCallback } from 'react';
import { HotelAPIService } from '../../../../api';
import type { Company, Room, Guest, BookingWithDetails, Booking } from '../../../../types';
import type {
  CustomerLedger,
  CustomerLedgerCreateRequest,
  CustomerLedgerUpdateRequest,
  CustomerLedgerPaymentRequest,
  CustomerLedgerPayment,
} from '../../../../types/ledger.types';
import { getHotelSettings, HotelSettings } from '../../../../utils/hotelSettings';
import { enhanceBookingDetails } from '../../../../utils/bookingUtils';
import { useLedgers } from '../../hooks/useLedgers';
import { ApiNotificationSeverity, emitApiNotification } from '../../../../utils/apiNotifications';
import type { CompanyOption, EntryStatusFilter } from './types';

const showSnackbar = (
  message: string,
  severity: ApiNotificationSeverity = 'success',
) => {
  emitApiNotification({ message, severity });
};

// ---------------------------------------------------------------------------
// Sort rooms by room number ascending (stable helper)
// ---------------------------------------------------------------------------
function sortRoomsByNumber(roomList: Room[]): Room[] {
  return [...roomList].sort((a, b) => {
    const numA = parseInt(a.room_number, 10);
    const numB = parseInt(b.room_number, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.room_number.localeCompare(b.room_number);
  });
}

// ---------------------------------------------------------------------------
// Return type – every piece of state the page needs
// ---------------------------------------------------------------------------
export interface LedgerPageState {
  // --- Data from useLedgers ---
  ledgers: CustomerLedger[];
  loading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  loadData: () => void;
  hotelSettings: HotelSettings;
  currencySymbol: string;

  // --- Create dialog ---
  createDialogOpen: boolean;
  setCreateDialogOpen: (v: boolean) => void;
  creating: boolean;
  createFormData: CustomerLedgerCreateRequest;
  setCreateFormData: React.Dispatch<React.SetStateAction<CustomerLedgerCreateRequest>>;
  handleCreateLedger: (skipDuplicateCheck?: boolean) => Promise<void>;
  findPossibleDuplicateLedger: (amount: number) => CustomerLedger | null;

  // --- Edit dialog ---
  editDialogOpen: boolean;
  setEditDialogOpen: (v: boolean) => void;
  editingLedger: CustomerLedger | null;
  editFormData: CustomerLedgerUpdateRequest;
  setEditFormData: React.Dispatch<React.SetStateAction<CustomerLedgerUpdateRequest>>;
  updating: boolean;
  handleEditLedger: (ledger: CustomerLedger) => void;
  handleUpdateLedger: () => Promise<void>;

  // --- Void dialog ---
  voidDialogOpen: boolean;
  setVoidDialogOpen: (v: boolean) => void;
  voidingLedger: CustomerLedger | null;
  voidReason: string;
  setVoidReason: (v: string) => void;
  voiding: boolean;
  handleVoidLedger: (ledger: CustomerLedger) => void;
  handleConfirmVoid: () => Promise<void>;

  // --- Payment dialog ---
  paymentDialogOpen: boolean;
  setPaymentDialogOpen: (v: boolean) => void;
  paymentLedger: CustomerLedger | null;
  paymentHistory: CustomerLedgerPayment[];
  paymentTab: number;
  setPaymentTab: (v: number) => void;
  paymentFormData: CustomerLedgerPaymentRequest;
  setPaymentFormData: React.Dispatch<React.SetStateAction<CustomerLedgerPaymentRequest>>;
  processingPayment: boolean;
  handleOpenPaymentDialog: (ledger: CustomerLedger) => Promise<void>;
  handleRecordPayment: () => Promise<void>;
  editingPaymentId: number | null;
  editingPaymentDate: string;
  savingPaymentDate: boolean;
  setEditingPaymentId: (v: number | null) => void;
  setEditingPaymentDate: (v: string) => void;
  handleSavePaymentDate: (paymentId: number) => Promise<void>;

  // --- Invoice modal ---
  ledgerInvoiceOpen: boolean;
  setLedgerInvoiceOpen: (v: boolean) => void;
  ledgerInvoiceBooking: BookingWithDetails | null;
  loadingLedgerInvoice: boolean;

  // --- Company autocomplete ---
  companyOptions: CompanyOption[];
  selectedCompany: CompanyOption | null;
  setSelectedCompany: (v: CompanyOption | null) => void;
  ledgerRooms: Room[];
  loadingLedgerRooms: boolean;
  loadLedgerRooms: () => Promise<void>;
  companyRegPrefillCreate: boolean;
  setCompanyRegPrefillCreate: (v: boolean) => void;
  handleCreateCompanyChange: (newValue: CompanyOption | null) => void;

  // --- Company check-in ---
  checkInDialogOpen: boolean;
  companies: Company[];
  availableRooms: Room[];
  guests: Guest[];
  companyBookings: BookingWithDetails[];
  allCompanyBookings: BookingWithDetails[];
  checkoutDialogOpen: boolean;
  checkoutBooking: BookingWithDetails | null;
  checkInCompany: Company | null;
  checkInGuest: Guest | null;
  checkInRoom: Room | null;
  checkInDate: string;
  checkOutDate: string;
  processingCheckIn: boolean;
  isCreatingNewCheckInGuest: boolean;
  newCheckInGuestForm: Record<string, string>;
  setCheckInCompany: (v: Company | null) => void;
  setCheckInGuest: (v: Guest | null) => void;
  setCheckInRoom: (v: Room | null) => void;
  setCheckInDate: (v: string) => void;
  setCheckOutDate: (v: string) => void;
  setIsCreatingNewCheckInGuest: (v: boolean) => void;
  setNewCheckInGuestForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setCheckoutDialogOpen: (v: boolean) => void;
  handleOpenCheckInDialog: (company?: Company) => Promise<void>;
  handleCheckInCompanyChange: (newValue: Company | null) => void;
  handleCompanyCheckIn: () => Promise<void>;
  handleOpenCheckoutDialog: (booking: BookingWithDetails) => void;
  handleConfirmCompanyCheckout: (lateCheckoutData?: { penalty: number; notes: string }, paymentMethod?: string) => Promise<void>;
  handleCheckInDateChange: (newDate: string) => void;
  handleCheckOutDateChange: (newDate: string) => void;

  // --- Company registration ---
  companyRegDialogOpen: boolean;
  creatingCompany: boolean;
  companyRegForm: Record<string, string>;
  setCompanyRegDialogOpen: (v: boolean) => void;
  setCompanyRegForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleRegisterCompany: () => Promise<void>;

  // --- Company edit ---
  companyEditDialogOpen: boolean;
  editingCompany: Company | null;
  updatingCompany: boolean;
  companyEditForm: Record<string, string>;
  setCompanyEditDialogOpen: (v: boolean) => void;
  setEditingCompany: (v: Company | null) => void;
  setCompanyEditForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleOpenEditCompany: (company: Company) => void;
  handleUpdateCompany: () => Promise<void>;

  // --- Company delete ---
  companyDeleteDialogOpen: boolean;
  deletingCompanyData: Company | null;
  deletingCompany: boolean;
  setCompanyDeleteDialogOpen: (v: boolean) => void;
  handleOpenDeleteCompany: (company: Company) => void;
  handleDeleteCompany: () => Promise<void>;

  // --- Company payment ---
  companyPaymentDialogOpen: boolean;
  paymentCompany: Company | null;
  paymentCompanyLedgers: CustomerLedger[];
  selectedLedgersForPayment: CustomerLedger[];
  processingCompanyPayment: boolean;
  companyPaymentForm: Record<string, string>;
  setCompanyPaymentDialogOpen: (v: boolean) => void;
  setSelectedLedgersForPayment: (v: CustomerLedger[]) => void;
  setCompanyPaymentForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleOpenCompanyPaymentDialog: (company: Company) => Promise<void>;
  handleRecordCompanyPayment: () => Promise<void>;

  // --- Company invoice ---
  companyInvoiceDialogOpen: boolean;
  invoiceCompany: Company | null;
  invoiceLedgerEntries: CustomerLedger[];
  selectedInvoiceLedgers: number[];
  invoiceNumber: string;
  invoiceDate: string;
  invoiceDueDate: string;
  invoiceNotes: string;
  showInvoicePreview: boolean;
  invoiceListFilter: 'billable' | 'all' | 'invoiced';
  setCompanyInvoiceDialogOpen: (v: boolean) => void;
  setSelectedInvoiceLedgers: React.Dispatch<React.SetStateAction<number[]>>;
  setInvoiceNumber: (v: string) => void;
  setInvoiceDate: (v: string) => void;
  setInvoiceDueDate: (v: string) => void;
  setInvoiceNotes: (v: string) => void;
  setShowInvoicePreview: (v: boolean) => void;
  setInvoiceListFilter: (v: 'billable' | 'all' | 'invoiced') => void;
  handleOpenCompanyInvoiceDialog: (company: Company) => void;
  handleToggleLedgerSelection: (ledgerId: number) => void;
  handleSelectAllEligibleLedgers: () => void;
  handlePreviewInvoice: () => void;
  handlePrintCompanyInvoice: () => void;
  handleDownloadCompanyInvoice: () => void;
  getSelectedInvoiceLedgers: () => CustomerLedger[];
  getSelectedLedgerTotal: () => number;
  getSelectedLedgerPaidTotal: () => number;
  getSelectedLedgerBalanceDue: () => number;
  isInvoiceEligible: (ledger: CustomerLedger) => boolean;
  invoiceNumberExists: (num: string) => boolean;

  // --- Credit note ---
  creditNoteDialogOpen: boolean;
  creditNoteLedgerId: number | '';
  creditNoteReason: string;
  creditNoteNotes: string;
  processingCreditNote: boolean;
  setCreditNoteDialogOpen: (v: boolean) => void;
  setCreditNoteLedgerId: (v: number | '') => void;
  setCreditNoteReason: (v: string) => void;
  setCreditNoteNotes: (v: string) => void;
  handleCreateCreditNote: () => Promise<void>;

  // --- Two-pane workspace ---
  selectedCompanyId: number | null;
  setSelectedCompanyId: (v: number | null) => void;
  companyListSearch: string;
  setCompanyListSearch: (v: string) => void;
  companyListFilter: 'all' | 'due' | 'clear';
  setCompanyListFilter: (v: 'all' | 'due' | 'clear') => void;
  detailTab: 'entries' | 'info';
  setDetailTab: (v: 'entries' | 'info') => void;
  entriesSearch: string;
  setEntriesSearch: (v: string) => void;
  entriesStatusFilter: EntryStatusFilter;
  setEntriesStatusFilter: (v: EntryStatusFilter) => void;
  entriesPage: number;
  setEntriesPage: (v: number) => void;
  entriesPageSize: number;
  setEntriesPageSize: (v: number) => void;
  createMenuAnchor: null | HTMLElement;
  setCreateMenuAnchor: (v: null | HTMLElement) => void;
  duplicateDialogOpen: boolean;
  setDuplicateDialogOpen: (v: boolean) => void;
  possibleDuplicateLedger: CustomerLedger | null;
  activeCompanyPayments: Record<number, CustomerLedgerPayment[]>;
  loadingActiveCompanyPayments: boolean;
  expandedReceiptId: number | null;
  setExpandedReceiptId: (v: number | null) => void;
  companyLedgersFiltered: CustomerLedger[];
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------
export function useLedgerPageState(): LedgerPageState {
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

  // Void dialog state
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingLedger, setVoidingLedger] = useState<CustomerLedger | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Invoice modal state
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
  const [ledgerRooms, setLedgerRooms] = useState<Room[]>([]);
  const [loadingLedgerRooms, setLoadingLedgerRooms] = useState(false);
  const [companyRegPrefillCreate, setCompanyRegPrefillCreate] = useState(false);

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
  const [newCheckInGuestForm, setNewCheckInGuestForm] = useState<Record<string, string>>({
    first_name: '', last_name: '', email: '', phone: '', ic_number: '',
    nationality: '', address_line1: '', city: '', state_province: '',
    postal_code: '', country: '',
  });

  // Company Registration state
  const [companyRegDialogOpen, setCompanyRegDialogOpen] = useState(false);
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [companyRegForm, setCompanyRegForm] = useState<Record<string, string>>({
    company_name: '', registration_number: '', contact_person: '',
    contact_email: '', contact_phone: '', billing_address: '',
    billing_city: '', billing_state: '', billing_postal_code: '',
    credit_limit: '', payment_terms_days: '30', notes: '',
  });

  // Company Edit state
  const [companyEditDialogOpen, setCompanyEditDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [updatingCompany, setUpdatingCompany] = useState(false);
  const [companyEditForm, setCompanyEditForm] = useState<Record<string, string>>({
    company_name: '', registration_number: '', contact_person: '',
    contact_email: '', contact_phone: '', billing_address: '',
    billing_city: '', billing_state: '', billing_postal_code: '',
    credit_limit: '', payment_terms_days: '30', notes: '',
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
  const [companyPaymentForm, setCompanyPaymentForm] = useState<Record<string, string>>({
    payment_amount: '', payment_method: 'bank_transfer',
    payment_reference: '', receipt_number: '', notes: '',
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
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [invoiceNotes, setInvoiceNotes] = useState<string>('');
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [invoiceListFilter, setInvoiceListFilter] = useState<'billable' | 'all' | 'invoiced'>('billable');

  // Credit Note state
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
  const [createMenuAnchor, setCreateMenuAnchor] = useState<null | HTMLElement>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [possibleDuplicateLedger, setPossibleDuplicateLedger] = useState<CustomerLedger | null>(null);
  const [activeCompanyPayments, setActiveCompanyPayments] = useState<Record<number, CustomerLedgerPayment[]>>({});
  const [loadingActiveCompanyPayments, setLoadingActiveCompanyPayments] = useState(false);
  const [expandedReceiptId, setExpandedReceiptId] = useState<number | null>(null);

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------
  const companyLedgersFiltered = ledgers.filter(l =>
    selectedCompanyId != null ? (l as any).company_id === selectedCompanyId : true,
  );

  // -----------------------------------------------------------------------
  // Initial data load
  // -----------------------------------------------------------------------
  useEffect(() => {
    loadData();
    loadCompanies();
    loadGuests();
    loadAllCompanyBookings();
    const handleSettingsChange = () => setHotelSettings(getHotelSettings());
    window.addEventListener('hotelSettingsChange', handleSettingsChange);
    return () => window.removeEventListener('hotelSettingsChange', handleSettingsChange);
  }, []);

  // -----------------------------------------------------------------------
  // Data loaders
  // -----------------------------------------------------------------------
  const loadAllCompanyBookings = useCallback(async () => {
    try {
      const bookings = await HotelAPIService.getBookingsWithDetails({ company_billed: true });
      setAllCompanyBookings(bookings.filter(
        b => b.status === 'checked_in' || b.status === 'auto_checked_in',
      ));
    } catch (err) { console.error('Failed to load company bookings:', err); }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      const data = await HotelAPIService.getCompanies({ is_active: true });
      setCompanies(data);
      setCompanyOptions(data.map((c: any) => ({
        company_name: c.company_name,
        company_registration_number: c.registration_number,
        contact_person: c.contact_person,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
        billing_address_line1: c.billing_address,
      })));
    } catch (err) { console.error('Failed to load companies:', err); }
  }, []);

  const loadGuests = useCallback(async () => {
    try {
      const data = await HotelAPIService.getAllGuests();
      setGuests(data.sort((a: any, b: any) => a.full_name.localeCompare(b.full_name)));
    } catch (err) { console.error('Failed to load guests:', err); }
  }, []);

  const loadLedgerRooms = useCallback(async () => {
    if (ledgerRooms.length > 0) return;
    try {
      setLoadingLedgerRooms(true);
      setLedgerRooms(sortRoomsByNumber(await HotelAPIService.getAllRooms()));
    } catch (err) { console.error('Failed to load rooms:', err); setLedgerRooms([]); }
    finally { setLoadingLedgerRooms(false); }
  }, [ledgerRooms.length]);

  const loadAvailableRooms = useCallback(async (checkIn: string, checkOut: string) => {
    try {
      setAvailableRooms(sortRoomsByNumber(
        await HotelAPIService.getAvailableRoomsForDates(checkIn, checkOut),
      ));
    } catch (err) { console.error('Failed to load available rooms:', err); setAvailableRooms([]); }
  }, []);

  const loadCompanyBookings = useCallback(async (companyId: number) => {
    try {
      const all = await HotelAPIService.getBookingsWithDetails();
      setCompanyBookings(all.filter(b => b.company_id === companyId));
    } catch (err) { console.error('Failed to load company bookings:', err); setCompanyBookings([]); }
  }, []);

  // -----------------------------------------------------------------------
  // Create handlers
  // -----------------------------------------------------------------------
  const handleCreateCompanyChange = useCallback((newValue: CompanyOption | null) => {
    setSelectedCompany(newValue);
    if (newValue) {
      setCreateFormData(prev => ({
        ...prev,
        company_name: newValue.company_name || '',
        company_id: (newValue as any).company_id,
      }));
    }
  }, []);

  const findPossibleDuplicateLedger = useCallback((amount: number): CustomerLedger | null => {
    if (!selectedCompany) return null;
    return ledgers.find(l =>
      (l as any).company_id === (selectedCompany as any).company_id &&
      Number(l.amount) === amount &&
      l.status !== 'void',
    ) || null;
  }, [selectedCompany, ledgers]);

  const handleCreateLedger = useCallback(async (skipDuplicateCheck = false) => {
    if (!createFormData.company_name || !createFormData.amount) {
      showSnackbar('Company name and amount are required', 'warning');
      return;
    }
    if (!skipDuplicateCheck) {
      const dup = findPossibleDuplicateLedger(createFormData.amount);
      if (dup) {
        setPossibleDuplicateLedger(dup);
        setDuplicateDialogOpen(true);
        return;
      }
    }
    try {
      setCreating(true);
      await HotelAPIService.createCustomerLedger(createFormData);
      showSnackbar('Ledger entry created');
      setCreateDialogOpen(false);
      setCreateFormData({ company_name: '', description: '', expense_type: 'accommodation', amount: 0 });
      loadData();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to create ledger', 'error');
    } finally { setCreating(false); }
  }, [createFormData, findPossibleDuplicateLedger, loadData]);

  // -----------------------------------------------------------------------
  // Edit handlers
  // -----------------------------------------------------------------------
  const handleEditLedger = useCallback((ledger: CustomerLedger) => {
    setEditingLedger(ledger);
    setEditFormData({
      description: ledger.description,
      expense_type: ledger.expense_type,
      amount: Number(ledger.amount),
    });
    setEditDialogOpen(true);
  }, []);

  const handleUpdateLedger = useCallback(async () => {
    if (!editingLedger) return;
    try {
      setUpdating(true);
      await HotelAPIService.updateCustomerLedger(editingLedger.id, editFormData);
      showSnackbar('Ledger entry updated');
      setEditDialogOpen(false);
      loadData();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to update ledger', 'error');
    } finally { setUpdating(false); }
  }, [editingLedger, editFormData, loadData]);

  // -----------------------------------------------------------------------
  // Void handlers
  // -----------------------------------------------------------------------
  const handleVoidLedger = useCallback((ledger: CustomerLedger) => {
    setVoidingLedger(ledger);
    setVoidReason('');
    setVoidDialogOpen(true);
  }, []);

  const handleConfirmVoid = useCallback(async () => {
    if (!voidingLedger) return;
    try {
      setVoiding(true);
      await HotelAPIService.voidLedger(voidingLedger.id, { reason: voidReason } as any);
      showSnackbar('Ledger entry voided');
      setVoidDialogOpen(false);
      loadData();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to void ledger', 'error');
    } finally { setVoiding(false); }
  }, [voidingLedger, voidReason, loadData]);

  // -----------------------------------------------------------------------
  // Payment handlers
  // -----------------------------------------------------------------------
  const handleOpenPaymentDialog = useCallback(async (ledger: CustomerLedger) => {
    setPaymentLedger(ledger);
    setPaymentTab(0);
    setPaymentFormData({ payment_amount: 0, payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0] });
    setPaymentDialogOpen(true);
    try {
      const history = await HotelAPIService.getLedgerPayments(ledger.id);
      setPaymentHistory(history);
    } catch { setPaymentHistory([]); }
  }, []);

  const handleRecordPayment = useCallback(async () => {
    if (!paymentLedger || paymentFormData.payment_amount <= 0) {
      showSnackbar('Please enter a valid payment amount', 'warning');
      return;
    }
    try {
      setProcessingPayment(true);
      await HotelAPIService.createLedgerPayment(paymentLedger.id, paymentFormData);
      showSnackbar('Payment recorded');
      setPaymentDialogOpen(false);
      loadData();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to record payment', 'error');
    } finally { setProcessingPayment(false); }
  }, [paymentLedger, paymentFormData, loadData]);

  const handleSavePaymentDate = useCallback(async (paymentId: number) => {
    try {
      setSavingPaymentDate(true);
      await HotelAPIService.updateLedgerPaymentDate(paymentLedger?.id ?? 0, paymentId, editingPaymentDate);
      showSnackbar('Payment date updated');
      setEditingPaymentId(null);
      if (paymentLedger) {
        const history = await HotelAPIService.getLedgerPayments(paymentLedger.id);
        setPaymentHistory(history);
      }
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to update payment date', 'error');
    } finally { setSavingPaymentDate(false); }
  }, [editingPaymentDate, paymentLedger]);

  // -----------------------------------------------------------------------
  // Company check-in handlers
  // -----------------------------------------------------------------------
  const handleOpenCheckInDialog = useCallback(async (company?: Company) => {
    setCheckInDialogOpen(true);
    if (company) { setCheckInCompany(company); await loadCompanyBookings(company.id); }
    await loadAvailableRooms(checkInDate, checkOutDate);
  }, [checkInDate, checkOutDate, loadCompanyBookings, loadAvailableRooms]);

  const handleCheckInCompanyChange = useCallback((newValue: Company | null) => {
    setCheckInCompany(newValue);
    if (newValue) loadCompanyBookings(newValue.id);
    else setCompanyBookings([]);
  }, [loadCompanyBookings]);

  const handleCompanyCheckIn = useCallback(async () => {
    if (!checkInCompany || !checkInRoom) {
      showSnackbar('Please select a company and room', 'warning');
      return;
    }
    try {
      setProcessingCheckIn(true);
      let guestToUse = checkInGuest;
      if (isCreatingNewCheckInGuest) {
        if (!newCheckInGuestForm.first_name || !newCheckInGuestForm.last_name) {
          showSnackbar('Please enter guest first and last name', 'warning');
          setProcessingCheckIn(false);
          return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (newCheckInGuestForm.email && newCheckInGuestForm.email.trim() && !emailRegex.test(newCheckInGuestForm.email)) {
          showSnackbar('Please enter a valid email address for the guest', 'warning');
          setProcessingCheckIn(false);
          return;
        }
        guestToUse = await HotelAPIService.createGuest({
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
      }
      if (!guestToUse) {
        showSnackbar('Please select or create a guest', 'warning');
        setProcessingCheckIn(false);
        return;
      }
      const booking = await HotelAPIService.createBooking({
        guest_id: guestToUse.id,
        room_id: checkInRoom.id,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        company_id: checkInCompany.id,
      } as any);
      await HotelAPIService.updateBooking(booking.id, { status: 'checked_in' } as any);
      showSnackbar('Company check-in successful');
      setCheckInDialogOpen(false);
      loadData();
      loadAllCompanyBookings();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to check in', 'error');
    } finally { setProcessingCheckIn(false); }
  }, [checkInCompany, checkInRoom, checkInGuest, isCreatingNewCheckInGuest, newCheckInGuestForm, checkInDate, checkOutDate, loadData, loadAllCompanyBookings]);

  const handleOpenCheckoutDialog = useCallback((booking: BookingWithDetails) => {
    setCheckoutBooking(booking);
    setCheckoutDialogOpen(true);
  }, []);

  const handleConfirmCompanyCheckout = useCallback(async (_lateCheckoutData?: { penalty: number; notes: string }, paymentMethod?: string) => {
    if (!checkoutBooking) return;
    try {
      await HotelAPIService.updateBooking(checkoutBooking.id, { status: 'checked_out' } as any);
      showSnackbar('Checkout successful');
      setCheckoutDialogOpen(false);
      loadData();
      loadAllCompanyBookings();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to checkout', 'error');
    }
  }, [checkoutBooking, loadData, loadAllCompanyBookings]);

  const handleCheckInDateChange = useCallback((newDate: string) => {
    setCheckInDate(newDate);
    loadAvailableRooms(newDate, checkOutDate);
  }, [checkOutDate, loadAvailableRooms]);

  const handleCheckOutDateChange = useCallback((newDate: string) => {
    setCheckOutDate(newDate);
    loadAvailableRooms(checkInDate, newDate);
  }, [checkInDate, loadAvailableRooms]);

  // -----------------------------------------------------------------------
  // Company registration / edit / delete handlers
  // -----------------------------------------------------------------------
  const handleRegisterCompany = useCallback(async () => {
    if (!companyRegForm.company_name) {
      showSnackbar('Company name is required', 'warning');
      return;
    }
    try {
      setCreatingCompany(true);
      await HotelAPIService.createCompany(companyRegForm as any);
      showSnackbar('Company registered');
      setCompanyRegDialogOpen(false);
      await loadCompanies();
      if (companyRegPrefillCreate && companyRegForm.company_name) {
        setSelectedCompany({ company_name: companyRegForm.company_name } as CompanyOption);
        setCreateFormData(prev => ({ ...prev, company_name: companyRegForm.company_name }));
        setCompanyRegPrefillCreate(false);
      }
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to register company', 'error');
    } finally { setCreatingCompany(false); }
  }, [companyRegForm, companyRegPrefillCreate, loadCompanies]);

  const handleOpenEditCompany = useCallback((company: Company) => {
    setEditingCompany(company);
    setCompanyEditForm({
      company_name: company.company_name || '',
      registration_number: company.registration_number || '',
      contact_person: company.contact_person || '',
      contact_email: company.contact_email || '',
      contact_phone: company.contact_phone || '',
      billing_address: company.billing_address || '',
      billing_city: (company as any).billing_city || '',
      billing_state: (company as any).billing_state || '',
      billing_postal_code: (company as any).billing_postal_code || '',
      credit_limit: String((company as any).credit_limit || ''),
      payment_terms_days: String(company.payment_terms_days || 30),
      notes: (company as any).notes || '',
    });
    setCompanyEditDialogOpen(true);
  }, []);

  const handleUpdateCompany = useCallback(async () => {
    if (!editingCompany) return;
    try {
      setUpdatingCompany(true);
      await HotelAPIService.updateCompany(editingCompany.id, companyEditForm);
      showSnackbar('Company updated');
      setCompanyEditDialogOpen(false);
      await loadCompanies();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to update company', 'error');
    } finally { setUpdatingCompany(false); }
  }, [editingCompany, companyEditForm, loadCompanies]);

  const handleOpenDeleteCompany = useCallback((company: Company) => {
    setDeletingCompanyData(company);
    setCompanyDeleteDialogOpen(true);
  }, []);

  const handleDeleteCompany = useCallback(async () => {
    if (!deletingCompanyData) return;
    try {
      setDeletingCompany(true);
      await HotelAPIService.deleteCompany(deletingCompanyData.id);
      showSnackbar('Company deleted');
      setCompanyDeleteDialogOpen(false);
      setSelectedCompanyId(null);
      await loadCompanies();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to delete company', 'error');
    } finally { setDeletingCompany(false); }
  }, [deletingCompanyData, loadCompanies]);

  // -----------------------------------------------------------------------
  // Company payment handlers
  // -----------------------------------------------------------------------
  const handleOpenCompanyPaymentDialog = useCallback(async (company: Company) => {
    setPaymentCompany(company);
    try {
      const ledgers = await HotelAPIService.getCustomerLedgers({ status: 'pending,partial' } as any);
      setPaymentCompanyLedgers(ledgers);
      setSelectedLedgersForPayment([]);
      setCompanyPaymentForm({
        payment_amount: '', payment_method: 'bank_transfer',
        payment_reference: '', receipt_number: '', notes: '',
        payment_date: new Date().toISOString().split('T')[0],
      });
      setCompanyPaymentDialogOpen(true);
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to load ledger entries', 'error');
    }
  }, []);

  const handleRecordCompanyPayment = useCallback(async () => {
    if (!paymentCompany) return;
    const amount = parseFloat(companyPaymentForm.payment_amount);
    if (!amount || amount <= 0) {
      showSnackbar('Please enter a valid payment amount', 'warning');
      return;
    }
    try {
      setProcessingCompanyPayment(true);
      for (const ledger of selectedLedgersForPayment) {
        await HotelAPIService.createLedgerPayment(ledger.id, {
          payment_amount: amount / selectedLedgersForPayment.length,
          payment_method: companyPaymentForm.payment_method,
          payment_date: companyPaymentForm.payment_date,
          payment_reference: companyPaymentForm.payment_reference,
        });
      }
      showSnackbar('Payment recorded successfully');
      setCompanyPaymentDialogOpen(false);
      loadData();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to record payment', 'error');
    } finally { setProcessingCompanyPayment(false); }
  }, [paymentCompany, companyPaymentForm, selectedLedgersForPayment, loadData]);

  // -----------------------------------------------------------------------
  // Company invoice handlers
  // -----------------------------------------------------------------------
  const isInvoiceEligible = useCallback((ledger: CustomerLedger): boolean => {
    return ledger.status === 'pending' || ledger.status === 'partial';
  }, []);

  const invoiceNumberExists = useCallback((num: string): boolean => {
    return ledgers.some(l => l.invoice_number === num && l.status !== 'void');
  }, [ledgers]);

  const handleOpenCompanyInvoiceDialog = useCallback((company: Company) => {
    setInvoiceCompany(company);
    const entries = ledgers.filter(l => (l as any).company_id === company.id);
    setInvoiceLedgerEntries(entries);
    setSelectedInvoiceLedgers(entries.filter(isInvoiceEligible).map(l => l.id));
    const today = new Date().toISOString().split('T')[0];
    setInvoiceDate(today);
    const due = new Date(); due.setDate(due.getDate() + 30);
    setInvoiceDueDate(due.toISOString().split('T')[0]);
    setInvoiceNotes('');
    setShowInvoicePreview(false);
    setInvoiceListFilter('billable');
    setCompanyInvoiceDialogOpen(true);
  }, [ledgers, isInvoiceEligible]);

  const handleToggleLedgerSelection = useCallback((ledgerId: number) => {
    setSelectedInvoiceLedgers(prev =>
      prev.includes(ledgerId) ? prev.filter(id => id !== ledgerId) : [...prev, ledgerId],
    );
  }, []);

  const handleSelectAllEligibleLedgers = useCallback(() => {
    setSelectedInvoiceLedgers(invoiceLedgerEntries.filter(isInvoiceEligible).map(l => l.id));
  }, [invoiceLedgerEntries, isInvoiceEligible]);

  const getSelectedInvoiceLedgers = useCallback(() => {
    return invoiceLedgerEntries.filter(l => selectedInvoiceLedgers.includes(l.id));
  }, [invoiceLedgerEntries, selectedInvoiceLedgers]);

  const getSelectedLedgerTotal = useCallback(() => getSelectedInvoiceLedgers().reduce((s, l) => s + Number(l.amount), 0), [getSelectedInvoiceLedgers]);
  const getSelectedLedgerPaidTotal = useCallback(() => getSelectedInvoiceLedgers().reduce((s, l) => s + Number(l.paid_amount || 0), 0), [getSelectedInvoiceLedgers]);
  const getSelectedLedgerBalanceDue = useCallback(() => getSelectedLedgerTotal() - getSelectedLedgerPaidTotal(), [getSelectedLedgerTotal, getSelectedLedgerPaidTotal]);

  const handlePreviewInvoice = useCallback(() => { setShowInvoicePreview(true); }, []);
  const handlePrintCompanyInvoice = useCallback(() => { window.print(); }, []);
  const handleDownloadCompanyInvoice = useCallback(() => { window.print(); }, []);

  // -----------------------------------------------------------------------
  // Credit note handler
  // -----------------------------------------------------------------------
  const handleCreateCreditNote = useCallback(async () => {
    if (!creditNoteLedgerId || !creditNoteReason) {
      showSnackbar('Ledger ID and reason are required', 'warning');
      return;
    }
    try {
      setProcessingCreditNote(true);
      await HotelAPIService.reverseLedger(creditNoteLedgerId, { reason: creditNoteReason, notes: creditNoteNotes });
      showSnackbar('Credit note created');
      setCreditNoteDialogOpen(false);
      loadData();
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to create credit note', 'error');
    } finally { setProcessingCreditNote(false); }
  }, [creditNoteLedgerId, creditNoteReason, creditNoteNotes, loadData]);

  return {
    ledgers, loading, error, setError, loadData, hotelSettings,
    currencySymbol: '',
    // Create
    createDialogOpen, setCreateDialogOpen, creating, createFormData, setCreateFormData,
    handleCreateLedger, findPossibleDuplicateLedger,
    // Edit
    editDialogOpen, setEditDialogOpen, editingLedger, editFormData, setEditFormData, updating,
    handleEditLedger, handleUpdateLedger,
    // Void
    voidDialogOpen, setVoidDialogOpen, voidingLedger, voidReason, setVoidReason, voiding,
    handleVoidLedger, handleConfirmVoid,
    // Payment
    paymentDialogOpen, setPaymentDialogOpen, paymentLedger, paymentHistory, paymentTab, setPaymentTab,
    paymentFormData, setPaymentFormData, processingPayment,
    handleOpenPaymentDialog, handleRecordPayment,
    editingPaymentId, editingPaymentDate, savingPaymentDate,
    setEditingPaymentId, setEditingPaymentDate, handleSavePaymentDate,
    // Invoice modal
    ledgerInvoiceOpen, setLedgerInvoiceOpen, ledgerInvoiceBooking, loadingLedgerInvoice,
    // Company autocomplete
    companyOptions, selectedCompany, setSelectedCompany, ledgerRooms, loadingLedgerRooms,
    loadLedgerRooms, companyRegPrefillCreate, setCompanyRegPrefillCreate, handleCreateCompanyChange,
    // Check-in
    checkInDialogOpen, companies, availableRooms, guests, companyBookings, allCompanyBookings,
    checkoutDialogOpen, checkoutBooking, checkInCompany, checkInGuest, checkInRoom,
    checkInDate, checkOutDate, processingCheckIn, isCreatingNewCheckInGuest, newCheckInGuestForm,
    setCheckInCompany, setCheckInGuest, setCheckInRoom, setCheckInDate, setCheckOutDate,
    setIsCreatingNewCheckInGuest, setNewCheckInGuestForm, setCheckoutDialogOpen,
    handleOpenCheckInDialog, handleCheckInCompanyChange, handleCompanyCheckIn,
    handleOpenCheckoutDialog, handleConfirmCompanyCheckout,
    handleCheckInDateChange, handleCheckOutDateChange,
    // Registration
    companyRegDialogOpen, creatingCompany, companyRegForm,
    setCompanyRegDialogOpen, setCompanyRegForm, handleRegisterCompany,
    // Edit company
    companyEditDialogOpen, editingCompany, updatingCompany, companyEditForm,
    setCompanyEditDialogOpen, setEditingCompany, setCompanyEditForm,
    handleOpenEditCompany, handleUpdateCompany,
    // Delete company
    companyDeleteDialogOpen, deletingCompanyData, deletingCompany,
    setCompanyDeleteDialogOpen, handleOpenDeleteCompany, handleDeleteCompany,
    // Company payment
    companyPaymentDialogOpen, paymentCompany, paymentCompanyLedgers, selectedLedgersForPayment,
    processingCompanyPayment, companyPaymentForm,
    setCompanyPaymentDialogOpen, setSelectedLedgersForPayment, setCompanyPaymentForm,
    handleOpenCompanyPaymentDialog, handleRecordCompanyPayment,
    // Company invoice
    companyInvoiceDialogOpen, invoiceCompany, invoiceLedgerEntries, selectedInvoiceLedgers,
    invoiceNumber, invoiceDate, invoiceDueDate, invoiceNotes, showInvoicePreview, invoiceListFilter,
    setCompanyInvoiceDialogOpen, setSelectedInvoiceLedgers, setInvoiceNumber, setInvoiceDate,
    setInvoiceDueDate, setInvoiceNotes, setShowInvoicePreview, setInvoiceListFilter,
    handleOpenCompanyInvoiceDialog, handleToggleLedgerSelection, handleSelectAllEligibleLedgers,
    handlePreviewInvoice, handlePrintCompanyInvoice, handleDownloadCompanyInvoice,
    getSelectedInvoiceLedgers, getSelectedLedgerTotal, getSelectedLedgerPaidTotal,
    getSelectedLedgerBalanceDue, isInvoiceEligible, invoiceNumberExists,
    // Credit note
    creditNoteDialogOpen, creditNoteLedgerId, creditNoteReason, creditNoteNotes, processingCreditNote,
    setCreditNoteDialogOpen, setCreditNoteLedgerId, setCreditNoteReason, setCreditNoteNotes,
    handleCreateCreditNote,
    // Two-pane
    selectedCompanyId, setSelectedCompanyId, companyListSearch, setCompanyListSearch,
    companyListFilter, setCompanyListFilter, detailTab, setDetailTab,
    entriesSearch, setEntriesSearch, entriesStatusFilter, setEntriesStatusFilter,
    entriesPage, setEntriesPage, entriesPageSize, setEntriesPageSize,
    createMenuAnchor, setCreateMenuAnchor, duplicateDialogOpen, setDuplicateDialogOpen,
    possibleDuplicateLedger, activeCompanyPayments, loadingActiveCompanyPayments,
    expandedReceiptId, setExpandedReceiptId, companyLedgersFiltered,
  };
}