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
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import {
  CustomerLedger,
  CustomerLedgerCreateRequest,
  CustomerLedgerUpdateRequest,
  CustomerLedgerPayment,
  CustomerLedgerPaymentRequest,
  CustomerLedgerSummary,
} from '../../../types';
import { formatCurrency } from '../../../utils/currency';

type SortField = 'company_name' | 'amount' | 'balance_due' | 'status' | 'due_date' | 'created_at';
type SortOrder = 'asc' | 'desc';

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

// Helper function to format date for input[type="date"]
const formatDateForInput = (dateString: string | null | undefined): string => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    // Format as YYYY-MM-DD
    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
};

// Helper function to format date for display
const formatDateForDisplay = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
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
    case 'cancelled':
      return 'default';
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
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
};

const CustomerLedgerPage: React.FC = () => {
  const [ledgers, setLedgers] = useState<CustomerLedger[]>([]);
  const [summary, setSummary] = useState<CustomerLedgerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sorting and filtering state
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expenseTypeFilter, setExpenseTypeFilter] = useState<string>('all');

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

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingLedger, setDeletingLedger] = useState<CustomerLedger | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Payment dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentLedger, setPaymentLedger] = useState<CustomerLedger | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<CustomerLedgerPayment[]>([]);
  const [paymentTab, setPaymentTab] = useState(0);
  const [paymentFormData, setPaymentFormData] = useState<CustomerLedgerPaymentRequest>({
    payment_amount: 0,
    payment_method: 'cash',
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

  // Notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadData();
    loadCompanies();
  }, []);

  // Load companies from database
  const loadCompanies = async () => {
    try {
      const companies = await HotelAPIService.getCompanies({ is_active: true });
      const options: CompanyOption[] = companies.map((company: any) => ({
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

  const loadData = async () => {
    try {
      setLoading(true);
      const [ledgersData, summaryData] = await Promise.all([
        HotelAPIService.getCustomerLedgers(),
        HotelAPIService.getCustomerLedgerSummary(),
      ]);
      setLedgers(ledgersData);
      setSummary(summaryData);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load ledger data:', err);
      setError(err.message || 'Failed to load ledger data. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort ledgers
  const filteredAndSortedLedgers = useMemo(() => {
    let filtered = [...ledgers];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(ledger =>
        ledger.company_name.toLowerCase().includes(query) ||
        ledger.description.toLowerCase().includes(query) ||
        ledger.invoice_number?.toLowerCase().includes(query) ||
        ledger.contact_person?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(ledger => ledger.status === statusFilter);
    }

    // Expense type filter
    if (expenseTypeFilter !== 'all') {
      filtered = filtered.filter(ledger => ledger.expense_type === expenseTypeFilter);
    }

    // Sorting
    filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'company_name':
          aValue = a.company_name.toLowerCase();
          bValue = b.company_name.toLowerCase();
          break;
        case 'amount':
          aValue = parseFloat(String(a.amount));
          bValue = parseFloat(String(b.amount));
          break;
        case 'balance_due':
          aValue = parseFloat(String(a.balance_due));
          bValue = parseFloat(String(b.balance_due));
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        case 'due_date':
          aValue = a.due_date ? new Date(a.due_date).getTime() : 0;
          bValue = b.due_date ? new Date(b.due_date).getTime() : 0;
          break;
        case 'created_at':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        default:
          aValue = a.created_at;
          bValue = b.created_at;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [ledgers, searchQuery, statusFilter, expenseTypeFilter, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setExpenseTypeFilter('all');
    setSortField('created_at');
    setSortOrder('desc');
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

  // Delete ledger handlers
  const handleDeleteLedger = (ledger: CustomerLedger) => {
    setDeletingLedger(ledger);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingLedger) return;

    try {
      setDeleting(true);
      await HotelAPIService.deleteCustomerLedger(deletingLedger.id);
      setSnackbarMessage('Ledger entry deleted successfully!');
      setSnackbarOpen(true);
      setDeleteDialogOpen(false);
      setDeletingLedger(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete ledger entry');
    } finally {
      setDeleting(false);
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

  const canDelete = (ledger: CustomerLedger) => {
    return ledger.status !== 'paid' && parseFloat(String(ledger.paid_amount)) === 0;
  };

  const canRecordPayment = (ledger: CustomerLedger) => {
    return ledger.status !== 'paid' && ledger.status !== 'cancelled';
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
    setPrintDialogOpen(true);
  };

  const handlePrint = () => {
    const printContent = document.getElementById('print-statement-content');
    if (printContent) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        const totalAmount = companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.amount)), 0);
        const totalPaid = companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.paid_amount)), 0);
        const totalBalance = companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.balance_due)), 0);

        printWindow.document.write(`
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
                  .no-print { display: none; }
                }
              </style>
            </head>
            <body>
              <div class="header">
                <h1>Salim Inn</h1>
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
                <p>Salim Inn - Hotel Management System</p>
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
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
          <Grid item xs={12} sm={6} md={3}>
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

          <Grid item xs={12} sm={6} md={3}>
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

          <Grid item xs={12} sm={6} md={3}>
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

          <Grid item xs={12} sm={6} md={3}>
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

      {/* Company Summary with Print Buttons */}
      {uniqueCompanies.length > 0 && (
        <Card sx={{ mb: 3, p: 2 }}>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <BusinessIcon color="primary" />
            <Typography variant="h6">Companies</Typography>
          </Box>
          <Grid container spacing={2}>
            {uniqueCompanies.map((company) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={company.name}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    '&:hover': { boxShadow: 2 },
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Typography variant="subtitle1" fontWeight="bold" noWrap sx={{ flex: 1 }}>
                      {company.name}
                    </Typography>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => handlePrintCompanyStatement(company.name)}
                      title="Print Statement"
                    >
                      <PrintIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {company.entries} entries
                  </Typography>
                  <Box display="flex" justifyContent="space-between" mt={1}>
                    <Typography variant="body2">
                      Total: {formatCurrency(company.total)}
                    </Typography>
                    <Typography
                      variant="body2"
                      color={company.balance > 0 ? 'error.main' : 'success.main'}
                      fontWeight="medium"
                    >
                      Due: {formatCurrency(company.balance)}
                    </Typography>
                  </Box>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Card>
      )}

      {/* Filters and Search */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <FilterIcon color="action" />
          <Typography variant="h6">Filters & Search</Typography>
        </Box>

        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
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

          <Grid item xs={12} sm={6} md={2}>
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
                <MenuItem value="cancelled">Cancelled</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6} md={2}>
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

          <Grid item xs={12} md={2}>
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
          {filteredAndSortedLedgers.length !== ledgers.length && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto', alignSelf: 'center' }}>
              Showing {filteredAndSortedLedgers.length} of {ledgers.length} entries
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
            {filteredAndSortedLedgers.map((ledger) => (
              <TableRow key={ledger.id} hover>
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
                    color={parseFloat(String(ledger.balance_due)) > 0 ? 'error.main' : 'success.main'}
                    fontWeight="medium"
                  >
                    {formatCurrency(parseFloat(String(ledger.balance_due)))}
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
                <TableCell>
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
                    <IconButton
                      size="small"
                      onClick={() => handleEditLedger(ledger)}
                      color="primary"
                      title="Edit"
                    >
                      <EditIcon />
                    </IconButton>
                    {canDelete(ledger) && (
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteLedger(ledger)}
                        color="error"
                        title="Delete"
                      >
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {filteredAndSortedLedgers.length === 0 && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            {ledgers.length === 0 ? 'No ledger entries yet' : 'No entries match your filters'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {ledgers.length === 0
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
            <Grid item xs={12} sm={6}>
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
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Registration Number"
                value={createFormData.company_registration_number || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, company_registration_number: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Contact Person"
                value={createFormData.contact_person || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, contact_person: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Contact Email"
                type="email"
                value={createFormData.contact_email || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, contact_email: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Contact Phone"
                value={createFormData.contact_phone || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, contact_phone: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Billing Address"
                value={createFormData.billing_address_line1 || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, billing_address_line1: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
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
            <Grid item xs={12} sm={6}>
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
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                required
                label="Amount"
                type="number"
                value={createFormData.amount}
                onChange={(e) => setCreateFormData({ ...createFormData, amount: parseFloat(e.target.value) || 0 })}
                InputProps={{
                  startAdornment: <InputAdornment position="start">RM</InputAdornment>,
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Invoice Date"
                type="date"
                value={createFormData.invoice_date || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, invoice_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Due Date"
                type="date"
                value={createFormData.due_date || ''}
                onChange={(e) => setCreateFormData({ ...createFormData, due_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12}>
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
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Company Name"
                value={editFormData.company_name || ''}
                onChange={(e) => setEditFormData({ ...editFormData, company_name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Registration Number"
                value={editFormData.company_registration_number || ''}
                onChange={(e) => setEditFormData({ ...editFormData, company_registration_number: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Contact Person"
                value={editFormData.contact_person || ''}
                onChange={(e) => setEditFormData({ ...editFormData, contact_person: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Contact Email"
                type="email"
                value={editFormData.contact_email || ''}
                onChange={(e) => setEditFormData({ ...editFormData, contact_email: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                multiline
                rows={2}
                value={editFormData.description || ''}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
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
            <Grid item xs={12} sm={6}>
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
                  <MenuItem value="cancelled">Cancelled</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Due Date"
                type="date"
                value={editFormData.due_date || ''}
                onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={2}
                value={editFormData.notes || ''}
                onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Ledger Entry</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to delete this ledger entry? This action cannot be undone.
          </Alert>
          <Box>
            <Typography variant="body2"><strong>Company:</strong> {deletingLedger?.company_name}</Typography>
            <Typography variant="body2"><strong>Amount:</strong> {formatCurrency(parseFloat(String(deletingLedger?.amount || 0)))}</Typography>
            <Typography variant="body2"><strong>Description:</strong> {deletingLedger?.description}</Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmDelete} variant="contained" color="error" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete Entry'}
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
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    required
                    label="Payment Amount"
                    type="number"
                    value={paymentFormData.payment_amount}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_amount: parseFloat(e.target.value) || 0 })}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">RM</InputAdornment>,
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
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
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Payment Reference"
                    value={paymentFormData.payment_reference || ''}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_reference: e.target.value })}
                    placeholder="Transaction ID, cheque number, etc."
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Receipt Number"
                    value={paymentFormData.receipt_number || ''}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, receipt_number: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12}>
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
                      <ListItem>
                        <ListItemText
                          primary={
                            <Box display="flex" justifyContent="space-between">
                              <Typography variant="body1" fontWeight="medium">
                                {formatCurrency(parseFloat(String(payment.payment_amount)))}
                              </Typography>
                              <Chip label={payment.payment_method} size="small" variant="outlined" />
                            </Box>
                          }
                          secondary={
                            <>
                              <Typography variant="body2" color="text.secondary">
                                {new Date(payment.payment_date).toLocaleString()}
                              </Typography>
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

      {/* Print Statement Preview Dialog */}
      <Dialog open={printDialogOpen} onClose={() => setPrintDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={1}>
              <PrintIcon color="primary" />
              Company Ledger Statement
            </Box>
            <Button
              variant="contained"
              startIcon={<PrintIcon />}
              onClick={handlePrint}
            >
              Print
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box id="print-statement-content">
            <Box sx={{ textAlign: 'center', mb: 3, borderBottom: '2px solid #333', pb: 2 }}>
              <Typography variant="h4" fontWeight="bold">Salim Inn</Typography>
              <Typography variant="h6" color="text.secondary">Company Ledger Statement</Typography>
            </Box>

            <Box sx={{ mb: 3 }}>
              <Typography variant="h5" fontWeight="bold">{printingCompany}</Typography>
              <Typography variant="body2" color="text.secondary">
                Statement Date: {new Date().toLocaleDateString()}
              </Typography>
            </Box>

            {/* Summary */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={3}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'grey.100' }}>
                  <Typography variant="caption" color="text.secondary">Total Entries</Typography>
                  <Typography variant="h6" fontWeight="bold">{companyLedgerEntries.length}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={3}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'grey.100' }}>
                  <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                  <Typography variant="h6" fontWeight="bold">
                    {formatCurrency(companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.amount)), 0))}
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={3}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'success.50' }}>
                  <Typography variant="caption" color="text.secondary">Total Paid</Typography>
                  <Typography variant="h6" fontWeight="bold" color="success.main">
                    {formatCurrency(companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.paid_amount)), 0))}
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={3}>
                <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'error.50' }}>
                  <Typography variant="caption" color="text.secondary">Balance Due</Typography>
                  <Typography variant="h6" fontWeight="bold" color="error.main">
                    {formatCurrency(companyLedgerEntries.reduce((sum, e) => sum + parseFloat(String(e.balance_due)), 0))}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            {/* Transactions Table */}
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'primary.main' }}>
                    <TableCell sx={{ color: 'white' }}>Invoice #</TableCell>
                    <TableCell sx={{ color: 'white' }}>Date</TableCell>
                    <TableCell sx={{ color: 'white' }}>Description</TableCell>
                    <TableCell sx={{ color: 'white' }}>Type</TableCell>
                    <TableCell sx={{ color: 'white' }} align="right">Amount</TableCell>
                    <TableCell sx={{ color: 'white' }} align="right">Paid</TableCell>
                    <TableCell sx={{ color: 'white' }} align="right">Balance</TableCell>
                    <TableCell sx={{ color: 'white' }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {companyLedgerEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.invoice_number || '-'}</TableCell>
                      <TableCell>{new Date(entry.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{entry.description}</TableCell>
                      <TableCell>
                        <Chip
                          label={EXPENSE_TYPES.find(t => t.value === entry.expense_type)?.label || entry.expense_type}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">{formatCurrency(parseFloat(String(entry.amount)))}</TableCell>
                      <TableCell align="right">{formatCurrency(parseFloat(String(entry.paid_amount)))}</TableCell>
                      <TableCell align="right">
                        <Typography color={parseFloat(String(entry.balance_due)) > 0 ? 'error.main' : 'success.main'}>
                          {formatCurrency(parseFloat(String(entry.balance_due)))}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={getStatusText(entry.status)}
                          color={getStatusColor(entry.status)}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={{ mt: 3, textAlign: 'center', color: 'text.secondary' }}>
              <Typography variant="caption">
                Generated on {new Date().toLocaleString()} | Salim Inn - Hotel Management System
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrintDialogOpen(false)}>Close</Button>
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
