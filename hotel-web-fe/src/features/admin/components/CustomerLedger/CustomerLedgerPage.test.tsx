// Characterization tests for CustomerLedgerPage. These pin CURRENT observable
// behavior (props handed to the extracted child panes/dialogs, calls made to
// the api barrel and the print helpers) so a future refactor of this 2200+
// line component fails loudly if behavior drifts. Real business logic
// (useCustomerLedgerWorkspace, helpers.ts) is kept real; data/query hooks and
// the ~18 extracted child components are mocked, following the convention in
// src/features/support/components/SupportManagementPage.test.tsx.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Company, CustomerLedger, CustomerLedgerPayment } from '../../../../types';

const mocks = vi.hoisted(() => ({
  useLedgersReturn: {
    ledgers: [] as CustomerLedger[],
    loading: false,
    error: null as string | null,
    setError: vi.fn(),
    reload: vi.fn(),
  },
  useLedgersPage: vi.fn(),
  lastLedgersPageParams: null as Record<string, unknown> | null,
  lastLedgersPageEnabled: undefined as boolean | undefined,
  ledgersPageQuery: {
    data: { data: [] as CustomerLedger[], total: 0 },
    isLoading: false,
    isFetching: false,
  },
  useCurrencyReturn: {
    symbol: '$',
    format: (amount: number) => `$${Number(amount).toFixed(2)}`,
  },
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  emitApiNotification: vi.fn(),
  print: {
    printCompanyInvoice: vi.fn(),
    downloadCompanyInvoice: vi.fn(),
    printCompanyStatement: vi.fn(),
    printSingleReceipt: vi.fn(),
  },
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
  hotelApi: {
    getAllRooms: vi.fn(),
    getAvailableRoomsForDates: vi.fn(),
    getBookingById: vi.fn(),
    getBookingsWithDetails: vi.fn(),
    updateBooking: vi.fn(),
    getAllGuests: vi.fn(),
    createGuest: vi.fn(),
    getCompanies: vi.fn(),
    createCompany: vi.fn(),
    updateCompany: vi.fn(),
    deleteCompany: vi.fn(),
    checkInGuest: vi.fn(),
    createCustomerLedger: vi.fn(),
    updateCustomerLedger: vi.fn(),
    getCustomerLedger: vi.fn(),
    voidLedger: vi.fn(),
    reverseLedger: vi.fn(),
    createLedgerPayment: vi.fn(),
    createCompanyLedgerPayment: vi.fn(),
    getLedgerPayments: vi.fn(),
    deleteLedgerPayment: vi.fn(),
    updateLedgerPaymentDate: vi.fn(),
  },
  captured: {
    companyListPane: null as Record<string, any> | null,
    companyDetailHeader: null as Record<string, any> | null,
    ledgerSummaryStrip: null as Record<string, any> | null,
    ledgerEntriesTab: null as Record<string, any> | null,
    companyInfoTab: null as Record<string, any> | null,
    paymentDialog: null as Record<string, any> | null,
    recordCompanyPaymentDialog: null as Record<string, any> | null,
    companyInvoiceDialog: null as Record<string, any> | null,
    creditNoteDialog: null as Record<string, any> | null,
    createLedgerDialog: null as Record<string, any> | null,
  },
}));

// --- Data / query hooks -----------------------------------------------
vi.mock('../../../../api', () => ({
  BookingsService: {
    getBookingById: (...args: unknown[]) => mocks.hotelApi.getBookingById(...args),
    getBookingsWithDetails: (...args: unknown[]) => mocks.hotelApi.getBookingsWithDetails(...args),
    updateBooking: (...args: unknown[]) => mocks.hotelApi.updateBooking(...args),
    checkInGuest: (...args: unknown[]) => mocks.hotelApi.checkInGuest(...args),
  },
  CompaniesService: {
    getCompanies: (...args: unknown[]) => mocks.hotelApi.getCompanies(...args),
    createCompany: (...args: unknown[]) => mocks.hotelApi.createCompany(...args),
    updateCompany: (...args: unknown[]) => mocks.hotelApi.updateCompany(...args),
    deleteCompany: (...args: unknown[]) => mocks.hotelApi.deleteCompany(...args),
  },
  GuestsService: {
    getAllGuests: (...args: unknown[]) => mocks.hotelApi.getAllGuests(...args),
    createGuest: (...args: unknown[]) => mocks.hotelApi.createGuest(...args),
  },
  LedgerService: {
    createCustomerLedger: (...args: unknown[]) => mocks.hotelApi.createCustomerLedger(...args),
    updateCustomerLedger: (...args: unknown[]) => mocks.hotelApi.updateCustomerLedger(...args),
    getCustomerLedger: (...args: unknown[]) => mocks.hotelApi.getCustomerLedger(...args),
    voidLedger: (...args: unknown[]) => mocks.hotelApi.voidLedger(...args),
    reverseLedger: (...args: unknown[]) => mocks.hotelApi.reverseLedger(...args),
    createLedgerPayment: (...args: unknown[]) => mocks.hotelApi.createLedgerPayment(...args),
    createCompanyLedgerPayment: (...args: unknown[]) => mocks.hotelApi.createCompanyLedgerPayment(...args),
    getLedgerPayments: (...args: unknown[]) => mocks.hotelApi.getLedgerPayments(...args),
    deleteLedgerPayment: (...args: unknown[]) => mocks.hotelApi.deleteLedgerPayment(...args),
    updateLedgerPaymentDate: (...args: unknown[]) => mocks.hotelApi.updateLedgerPaymentDate(...args),
  },
  RoomsService: {
    getAllRooms: (...args: unknown[]) => mocks.hotelApi.getAllRooms(...args),
    getAvailableRoomsForDates: (...args: unknown[]) => mocks.hotelApi.getAvailableRoomsForDates(...args),
  },
}));

vi.mock('../../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mocks.apiClient.get(...args),
    post: (...args: unknown[]) => mocks.apiClient.post(...args),
  },
}));

vi.mock('../../hooks/useLedgers', () => ({
  useLedgers: () => mocks.useLedgersReturn,
  useLedgersPage: (...args: unknown[]) => mocks.useLedgersPage(...args),
  ledgerQueryKeys: {
    all: ['ledgers'],
    list: (params?: unknown) => ['ledgers', 'list', params],
  },
}));

vi.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => mocks.useCurrencyReturn,
}));

vi.mock('../../../../router', () => ({
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock('../../../../utils/apiNotifications', () => ({
  emitApiNotification: (...args: unknown[]) => mocks.emitApiNotification(...args),
}));

vi.mock('./customerLedgerPrint', () => ({
  printCompanyInvoice: (...args: unknown[]) => mocks.print.printCompanyInvoice(...args),
  downloadCompanyInvoice: (...args: unknown[]) => mocks.print.downloadCompanyInvoice(...args),
  printCompanyStatement: (...args: unknown[]) => mocks.print.printCompanyStatement(...args),
  printSingleReceipt: (...args: unknown[]) => mocks.print.printSingleReceipt(...args),
}));

vi.mock('../../../invoices/components/CheckoutInvoiceModals', () => ({
  default: () => null,
}));

// --- Heavy child panes/dialogs: prop-capturing stubs with trigger buttons --
vi.mock('./components/CompanyListPane', () => ({
  default: (props: any) => {
    mocks.captured.companyListPane = props;
    return (
      <section aria-label="mock-company-list-pane">
        <input
          aria-label="Company list search"
          value={props.search}
          onChange={(e: any) => props.onSearchChange(e.target.value)}
        />
        <span data-testid="company-list-rows">
          {props.companyListRows.map((row: any) => row.c.company_name).join(', ')}
        </span>
        <button onClick={() => props.onFilterChange('due')}>Show due only</button>
        <button onClick={() => props.onFilterChange('clear')}>Show clear only</button>
        <button onClick={() => props.onFilterChange('all')}>Show all companies</button>
        <button onClick={() => props.onSelect(2)}>Select Zen Traders</button>
        <button onClick={() => props.onRegister()}>Register company</button>
      </section>
    );
  },
}));

vi.mock('./components/CompanyDetailHeader', () => ({
  default: (props: any) => {
    mocks.captured.companyDetailHeader = props;
    return (
      <div aria-label="mock-company-detail-header">
        <span>{props.company.company_name}</span>
        <button onClick={() => props.onPrintStatement()}>Print company statement</button>
        <button onClick={() => props.onDelete()}>Delete company</button>
      </div>
    );
  },
}));

vi.mock('./components/CompanyBalanceMeter', () => ({ default: () => null }));
vi.mock('./components/ActiveGuestsRow', () => ({ default: () => null }));

vi.mock('./components/LedgerSummaryStrip', () => ({
  default: (props: any) => {
    mocks.captured.ledgerSummaryStrip = props;
    return <div aria-label="mock-ledger-summary-strip" />;
  },
}));

vi.mock('./components/LedgerEntriesTab', () => ({
  default: (props: any) => {
    mocks.captured.ledgerEntriesTab = props;
    const first = props.entries[0];
    return (
      <section aria-label="mock-ledger-entries-tab">
        <input
          aria-label="Entries search"
          value={props.search}
          onChange={(e: any) => props.onSearchChange(e.target.value)}
        />
        <button onClick={() => props.onStatusFilterChange('paid')}>Filter paid entries</button>
        <button onClick={() => props.onPageChange(2)}>Go to entries page 3</button>
        <button onClick={() => props.onPageSizeChange(50)}>Use 50 entries per page</button>
        {first && (
          <>
            <button onClick={() => props.onRecordPayment(first)}>Record payment for first entry</button>
            <button onClick={() => props.onPrintReceipt(first)}>Print first receipt</button>
            <button onClick={() => props.onEdit(first)}>Edit first entry</button>
            <button onClick={() => props.onVoid(first)}>Void first entry</button>
          </>
        )}
      </section>
    );
  },
}));

vi.mock('./components/CompanyInfoTab', () => ({
  default: (props: any) => {
    mocks.captured.companyInfoTab = props;
    return <div aria-label="mock-company-info-tab">{props.company.company_name} info</div>;
  },
}));

vi.mock('./components/CreateLedgerDialog', () => ({
  default: (props: any) => {
    mocks.captured.createLedgerDialog = props;
    return null;
  },
}));

vi.mock('./components/DuplicateLedgerDialog', () => ({ default: () => null }));
vi.mock('./components/VoidLedgerDialog', () => ({ default: () => null }));
vi.mock('./components/EditLedgerDialog', () => ({ default: () => null }));
vi.mock('./components/DeleteCompanyDialog', () => ({ default: () => null }));
vi.mock('./components/CompanyFormDialog', () => ({ default: () => null }));
vi.mock('./components/CompanyCheckInDialog', () => ({ default: () => null }));

vi.mock('./components/PaymentDialog', () => ({
  default: (props: any) => {
    mocks.captured.paymentDialog = props;
    return null;
  },
}));

vi.mock('./components/RecordCompanyPaymentDialog', () => ({
  default: (props: any) => {
    mocks.captured.recordCompanyPaymentDialog = props;
    return null;
  },
}));

vi.mock('./components/CompanyInvoiceDialog', () => ({
  default: (props: any) => {
    mocks.captured.companyInvoiceDialog = props;
    return null;
  },
}));

vi.mock('./components/CreditNoteDialog', () => ({
  default: (props: any) => {
    mocks.captured.creditNoteDialog = props;
    return null;
  },
}));

import CustomerLedgerPage from './CustomerLedgerPage';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

function buildCompanies(): Company[] {
  return [
    {
      id: 1,
      company_name: 'Acme Corp',
      registration_number: 'REG-ACME-1',
      contact_person: 'Alice Tan',
      contact_email: 'alice@acme.test',
      contact_phone: '012-3456789',
      billing_address: '1 Acme Street',
      billing_city: 'Kuching',
      billing_state: 'Sarawak',
      billing_postal_code: '93000',
      billing_country: 'Malaysia',
      is_active: true,
      credit_limit: 5000,
      payment_terms_days: 30,
      notes: '',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 2,
      company_name: 'Zen Traders',
      registration_number: 'REG-ZEN-1',
      contact_person: 'Ben Lee',
      contact_email: 'ben@zen.test',
      contact_phone: '019-8887766',
      billing_address: '2 Zen Avenue',
      billing_city: 'Kuching',
      billing_state: 'Sarawak',
      billing_postal_code: '93100',
      billing_country: 'Malaysia',
      is_active: true,
      credit_limit: 2000,
      payment_terms_days: 30,
      notes: '',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];
}

// Two companies: Acme Corp has an outstanding balance (one pending + one
// partially-paid entry, plus a zeroed-out voided entry); Zen Traders is fully
// settled. Due dates are set far in the future so getLedgerUiStatus's
// date-based overdue check never fires regardless of when the suite runs.
function buildLedgers(): CustomerLedger[] {
  return [
    {
      id: 101,
      company_name: 'Acme Corp',
      description: 'Room 204 accommodation charge',
      expense_type: 'accommodation',
      amount: 500,
      status: 'pending',
      paid_amount: 0,
      balance_due: 500,
      due_date: '2031-01-01',
      created_at: '2026-07-01T03:00:00Z',
      updated_at: '2026-07-01T03:00:00Z',
    },
    {
      id: 102,
      company_name: 'Acme Corp',
      description: 'Banquet catering charge',
      expense_type: 'fnb_banquet',
      amount: 300,
      status: 'partial',
      paid_amount: 100,
      balance_due: 200,
      due_date: '2031-02-01',
      created_at: '2026-07-02T03:00:00Z',
      updated_at: '2026-07-05T03:00:00Z',
    },
    {
      id: 103,
      company_name: 'Acme Corp',
      description: 'Cancelled miscellaneous charge',
      expense_type: 'miscellaneous',
      amount: 100,
      status: 'void',
      paid_amount: 0,
      // customer_ledgers.balance_due is a GENERATED column (amount -
      // paid_amount); voiding never touches it, so a real voided-but-unpaid
      // row has balance_due == amount (100), never 0. A zeroed balance_due
      // here would make this fixture impossible to produce from the
      // database and would let the test pass whether or not the void
      // exclusion below actually works.
      balance_due: 100,
      void_at: '2026-07-10T00:00:00Z',
      void_reason: 'Duplicate entry',
      created_at: '2026-07-03T03:00:00Z',
      updated_at: '2026-07-10T00:00:00Z',
    },
    {
      id: 104,
      company_name: 'Zen Traders',
      description: 'Conference package',
      expense_type: 'accommodation',
      amount: 250,
      status: 'paid',
      paid_amount: 250,
      balance_due: 0,
      due_date: '2026-08-01',
      invoice_number: 'INV-ZEN-000123',
      created_at: '2026-06-01T03:00:00Z',
      updated_at: '2026-06-10T03:00:00Z',
    },
  ];
}

function buildLedgerPayment(ledgerId: number, receiptNumber: string): CustomerLedgerPayment {
  return {
    id: 900 + ledgerId,
    ledger_id: ledgerId,
    payment_amount: 50,
    payment_method: 'cash',
    receipt_number: receiptNumber,
    payment_date: '2026-08-01',
    created_at: '2026-08-01T00:00:00Z',
  };
}

function mockReceiptOnLedger(ledgerId: number, receiptNumber: string) {
  mocks.hotelApi.getLedgerPayments.mockImplementation((requestedLedgerId: number) =>
    Promise.resolve(requestedLedgerId === ledgerId ? [buildLedgerPayment(ledgerId, receiptNumber)] : []),
  );
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function openCreateMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await screen.findByRole('menuitem', { name: /New Ledger Entry/i });
}

describe('CustomerLedgerPage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());

    const companies = buildCompanies();
    const ledgers = buildLedgers();

    mocks.useLedgersReturn.ledgers = ledgers;
    mocks.useLedgersReturn.loading = false;
    mocks.useLedgersReturn.error = null;
    mocks.useLedgersReturn.setError.mockReset();
    mocks.useLedgersReturn.reload.mockReset().mockResolvedValue(undefined);

    mocks.searchParams = new URLSearchParams();
    mocks.setSearchParams.mockReset();

    mocks.useCurrencyReturn = {
      symbol: '$',
      format: (amount: number) => `$${Number(amount).toFixed(2)}`,
    };

    mocks.emitApiNotification.mockReset();

    mocks.print.printCompanyInvoice.mockReset();
    mocks.print.downloadCompanyInvoice.mockReset();
    mocks.print.printCompanyStatement.mockReset();
    mocks.print.printSingleReceipt.mockReset();

    mocks.apiClient.get.mockReset().mockReturnValue({ json: vi.fn().mockResolvedValue({}) });
    mocks.apiClient.post.mockReset().mockResolvedValue({});

    Object.values(mocks.hotelApi).forEach((fn) => fn.mockReset());
    mocks.hotelApi.getCompanies.mockResolvedValue(companies);
    mocks.hotelApi.getAllGuests.mockResolvedValue([]);
    mocks.hotelApi.getBookingsWithDetails.mockResolvedValue([]);
    mocks.hotelApi.getAllRooms.mockResolvedValue([]);
    mocks.hotelApi.getLedgerPayments.mockResolvedValue([]);

    mocks.lastLedgersPageParams = null;
    mocks.lastLedgersPageEnabled = undefined;
    // The entries pane's data source (useLedgersPage) is fully mocked, so it
    // does not re-filter based on params the way the real backend would —
    // tests pin the DERIVED PARAMS (real client-side logic in
    // useCustomerLedgerWorkspace), not a reimplementation of server filtering.
    mocks.ledgersPageQuery = {
      data: { data: ledgers.filter((l) => l.company_name === 'Acme Corp'), total: 3 },
      isLoading: false,
      isFetching: false,
    };
    mocks.useLedgersPage.mockReset().mockImplementation((params: Record<string, unknown> | undefined, enabled: boolean) => {
      mocks.lastLedgersPageParams = params ?? null;
      mocks.lastLedgersPageEnabled = enabled;
      return mocks.ledgersPageQuery;
    });

    mocks.captured.companyListPane = null;
    mocks.captured.companyDetailHeader = null;
    mocks.captured.ledgerSummaryStrip = null;
    mocks.captured.ledgerEntriesTab = null;
    mocks.captured.companyInfoTab = null;
    mocks.captured.paymentDialog = null;
    mocks.captured.recordCompanyPaymentDialog = null;
    mocks.captured.companyInvoiceDialog = null;
    mocks.captured.creditNoteDialog = null;
    mocks.captured.createLedgerDialog = null;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a loading spinner while ledgers are loading, before any pane renders', () => {
    mocks.useLedgersReturn.loading = true;

    render(<CustomerLedgerPage />);

    expect(screen.getByRole('progressbar')).toBeDefined();
    expect(mocks.captured.companyListPane).toBeNull();
  });

  it('shows the ledgers error banner and retries by reloading data', () => {
    mocks.useLedgersReturn.error = 'Ledgers failed to load';

    render(<CustomerLedgerPage />);

    expect(screen.getByText('Ledgers failed to load')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.useLedgersReturn.reload).toHaveBeenCalled();
  });

  it('computes ledger totals and per-company aggregates from the fixtures, and auto-selects the highest-balance company', async () => {
    render(<CustomerLedgerPage />);

    await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Acme Corp'));

    expect(mocks.captured.ledgerSummaryStrip).toMatchObject({
      companiesCount: 2,
      summary: {
        // The voided entry (id 103, $100) is excluded from every summary
        // field, matching the backend's own /ledgers/summary
        // (`WHERE status NOT IN ('void')`): 4 fixtures minus 1 void = 3
        // entries, and $1150 total minus the voided $100 = $1050.
        total_entries: 3,
        total_amount: 1050,
        total_paid: 350,
        total_outstanding: 700,
        pending_count: 1,
        partial_count: 1,
        overdue_count: 0,
      },
    });

    expect(mocks.captured.companyListPane).toMatchObject({ dueCount: 1, clearCount: 1 });
    expect(mocks.captured.companyListPane?.companyListRows.map((r: any) => r.c.company_name)).toEqual([
      'Acme Corp',
      'Zen Traders',
    ]);
    // entryCount comes from the per-company aggregate (activeAgg.count),
    // which now excludes the voided entry (id 103) the same way `summary`
    // does — 3 Acme Corp fixtures minus 1 void = 2.
    expect(mocks.captured.companyDetailHeader).toMatchObject({ entryCount: 2 });
    expect(mocks.captured.ledgerEntriesTab).toMatchObject({ entryCount: 2 });
  });

  it('switches the detail pane to a newly selected company', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Acme Corp'));

    fireEvent.click(screen.getByRole('button', { name: 'Select Zen Traders' }));

    await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Zen Traders'));
    expect(mocks.captured.companyDetailHeader).toMatchObject({ entryCount: 1 });
    expect(mocks.captured.ledgerEntriesTab).toMatchObject({ entryCount: 1 });
    await waitFor(() => expect(mocks.lastLedgersPageParams).toMatchObject({ company_name: 'Zen Traders' }));
  });

  it('narrows the company list rows by the company search box', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.companyListPane?.companyListRows?.length).toBe(2));

    fireEvent.change(screen.getByLabelText('Company list search'), { target: { value: 'zen' } });

    await waitFor(() =>
      expect(mocks.captured.companyListPane?.companyListRows.map((r: any) => r.c.company_name)).toEqual([
        'Zen Traders',
      ]),
    );
  });

  it('narrows the company list to due-only or clear-only accounts via the quick filters', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.companyListPane?.companyListRows?.length).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: 'Show due only' }));
    await waitFor(() =>
      expect(mocks.captured.companyListPane?.companyListRows.map((r: any) => r.c.company_name)).toEqual([
        'Acme Corp',
      ]),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show clear only' }));
    await waitFor(() =>
      expect(mocks.captured.companyListPane?.companyListRows.map((r: any) => r.c.company_name)).toEqual([
        'Zen Traders',
      ]),
    );
  });

  it('switches to the Company Info tab and swaps the primary action button', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Acme Corp'));
    expect(screen.getByRole('button', { name: 'New entry' })).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: /Company info/i }));

    await waitFor(() => expect(mocks.captured.companyInfoTab?.dueAmount).toBe(700));
    expect(mocks.captured.companyInfoTab?.company?.company_name).toBe('Acme Corp');
    expect(screen.getByRole('button', { name: 'Edit company' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New entry' })).toBeNull();
  });

  it('threads entries search, status filter, page, and page size through to the paged ledger query params', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() =>
      expect(mocks.lastLedgersPageParams).toMatchObject({ company_name: 'Acme Corp', page: 1, page_size: 25 }),
    );

    fireEvent.change(screen.getByLabelText('Entries search'), { target: { value: 'catering' } });
    await waitFor(() =>
      expect(mocks.lastLedgersPageParams).toMatchObject({
        company_name: 'Acme Corp',
        search: 'catering',
        page: 1,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter paid entries' }));
    await waitFor(() =>
      expect(mocks.lastLedgersPageParams).toMatchObject({
        search: 'catering',
        ui_status: 'paid',
        page: 1,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go to entries page 3' }));
    await waitFor(() => expect(mocks.lastLedgersPageParams).toMatchObject({ page: 3, page_size: 25 }));

    fireEvent.click(screen.getByRole('button', { name: 'Use 50 entries per page' }));
    await waitFor(() => expect(mocks.lastLedgersPageParams).toMatchObject({ page: 1, page_size: 50 }));
  });

  it('opens the payment dialog for the selected entry and loads its payment history', async () => {
    const paymentFixture = {
      id: 900,
      ledger_id: 101,
      payment_amount: 100,
      payment_method: 'cash',
      payment_date: '2026-07-15',
      created_at: '2026-07-15T00:00:00Z',
    };
    mocks.hotelApi.getLedgerPayments.mockImplementation((ledgerId: number) =>
      Promise.resolve(ledgerId === 101 ? [paymentFixture] : []),
    );

    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.entries?.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Record payment for first entry' }));

    await waitFor(() => expect(mocks.captured.paymentDialog?.open).toBe(true));
    expect(mocks.captured.paymentDialog?.paymentLedger?.id).toBe(101);
    expect(mocks.captured.paymentDialog?.paymentFormData).toMatchObject({
      payment_amount: 500,
      payment_method: 'cash',
    });
    expect(mocks.hotelApi.getLedgerPayments).toHaveBeenCalledWith(101);
    await waitFor(() => expect(mocks.captured.paymentDialog?.paymentHistory).toEqual([paymentFixture]));
  });

  it('waits for fresh target-ledger history before creating a single-ledger payment', async () => {
    const submitHistory = createDeferred<CustomerLedgerPayment[]>();
    mocks.hotelApi.createLedgerPayment.mockResolvedValue(undefined);
    mocks.hotelApi.getCustomerLedger.mockResolvedValue({
      ...buildLedgers()[0],
      status: 'paid',
      paid_amount: 500,
      balance_due: 0,
    });

    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[101]).toEqual([]));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment for first entry' }));
    await waitFor(() => expect(mocks.captured.paymentDialog?.paymentHistory).toEqual([]));

    mocks.hotelApi.getLedgerPayments.mockClear();
    mocks.hotelApi.getLedgerPayments.mockImplementation((ledgerId: number) =>
      ledgerId === 101 ? submitHistory.promise : Promise.resolve([]),
    );
    await act(async () => {
      mocks.captured.paymentDialog!.setPaymentFormData({
        ...mocks.captured.paymentDialog!.paymentFormData,
        receipt_number: 'receipt-fresh-101',
      });
    });

    let submitPromise!: Promise<void>;
    await act(async () => {
      submitPromise = mocks.captured.paymentDialog!.onRecordPayment();
      await Promise.resolve();
    });

    expect(mocks.hotelApi.getLedgerPayments.mock.calls.map(([ledgerId]) => ledgerId)).toEqual([101]);
    expect(mocks.hotelApi.createLedgerPayment).not.toHaveBeenCalled();

    await act(async () => {
      submitHistory.resolve([]);
      await submitPromise;
    });

    expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ receipt_number: 'receipt-fresh-101' }),
    );
  });

  it('creates a receipt-less single-ledger payment without fetching submit-time history', async () => {
    mocks.hotelApi.createLedgerPayment.mockRejectedValue(new Error('timeout'));

    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[101]).toEqual([]));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment for first entry' }));
    await waitFor(() => expect(mocks.captured.paymentDialog?.paymentHistory).toEqual([]));

    mocks.hotelApi.getLedgerPayments.mockClear();
    await act(async () => {
      await mocks.captured.paymentDialog!.onRecordPayment();
    });

    expect(mocks.hotelApi.getLedgerPayments).not.toHaveBeenCalled();
    expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ receipt_number: undefined }),
    );
  });

  it('allows a single-ledger receipt already used on a different ledger', async () => {
    mockReceiptOnLedger(102, ' Receipt-77 ');
    mocks.hotelApi.createLedgerPayment.mockResolvedValue(undefined);
    mocks.hotelApi.getCustomerLedger.mockResolvedValue({
      ...buildLedgers()[0],
      status: 'paid',
      paid_amount: 500,
      balance_due: 0,
    });

    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[102]).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment for first entry' }));
    await waitFor(() => expect(mocks.captured.paymentDialog?.paymentLedger?.id).toBe(101));

    await act(async () => {
      mocks.captured.paymentDialog!.setPaymentFormData({
        ...mocks.captured.paymentDialog!.paymentFormData,
        receipt_number: 'receipt-77',
      });
    });
    await act(async () => {
      await mocks.captured.paymentDialog!.onRecordPayment();
    });

    expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ receipt_number: 'receipt-77' }),
    );
  });

  it('rejects a fresh single-ledger duplicate after a stale empty preload', async () => {
    mocks.hotelApi.createLedgerPayment.mockResolvedValue(undefined);

    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[101]).toEqual([]));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment for first entry' }));
    await waitFor(() => expect(mocks.captured.paymentDialog?.paymentHistory).toEqual([]));

    await act(async () => {
      mocks.captured.paymentDialog!.setPaymentFormData({
        ...mocks.captured.paymentDialog!.paymentFormData,
        receipt_number: 'receipt-77',
      });
    });
    mocks.hotelApi.getLedgerPayments.mockImplementation((ledgerId: number) =>
      Promise.resolve(ledgerId === 101 ? [buildLedgerPayment(101, ' Receipt-77 ')] : []),
    );
    await act(async () => {
      await mocks.captured.paymentDialog!.onRecordPayment();
    });

    expect(mocks.hotelApi.createLedgerPayment).not.toHaveBeenCalled();
    expect(mocks.emitApiNotification).toHaveBeenCalledWith({
      message: 'Receipt number already exists',
      severity: 'warning',
    });
  });

  it('blocks a single-ledger payment and preserves its dialog when fresh history fails', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[101]).toEqual([]));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment for first entry' }));
    await waitFor(() => expect(mocks.captured.paymentDialog?.paymentHistory).toEqual([]));

    await act(async () => {
      mocks.captured.paymentDialog!.setPaymentFormData({
        ...mocks.captured.paymentDialog!.paymentFormData,
        receipt_number: 'receipt-retry-101',
      });
    });
    mocks.hotelApi.getLedgerPayments.mockClear();
    mocks.hotelApi.getLedgerPayments.mockRejectedValue(new Error('history unavailable'));
    await act(async () => {
      await mocks.captured.paymentDialog!.onRecordPayment();
    });

    expect(mocks.hotelApi.getLedgerPayments.mock.calls.map(([ledgerId]) => ledgerId)).toEqual([101]);
    expect(mocks.hotelApi.createLedgerPayment).not.toHaveBeenCalled();
    expect(mocks.emitApiNotification).toHaveBeenCalledWith({
      message: 'Unable to verify receipt number. Please try again.',
      severity: 'error',
    });
    expect(mocks.captured.paymentDialog).toMatchObject({
      open: true,
      paymentFormData: expect.objectContaining({ receipt_number: 'receipt-retry-101' }),
    });
  });

  // Review finding I2. The existing lost-response tests reject createLedgerPayment
  // itself. The dangerous case is the opposite: the POST COMMITS and a later step
  // fails. The clear used to sit immediately after the POST, so the refetch error
  // landed in the catch, told staff "Failed to record payment" for a payment that
  // had succeeded, and the retry minted a NEW key -- a second real charge.
  it('retains the idempotency key when the payment commits but the refetch fails', async () => {
    // Fake timers with automatic advancement make RTL's waitFor polling
    // deterministic under parallel-suite load (same pattern as the
    // BookingsPage timezone test).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.hotelApi.createLedgerPayment.mockResolvedValue(undefined);
      mocks.hotelApi.getCustomerLedger.mockRejectedValueOnce(new Error('network down'));

      render(<CustomerLedgerPage />);
      await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.entries?.length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole('button', { name: 'Record payment for first entry' }));
      await waitFor(() => expect(mocks.captured.paymentDialog?.open).toBe(true));

      await act(async () => {
        await mocks.captured.paymentDialog!.onRecordPayment();
      });
      await waitFor(() => expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledTimes(1));
      const committed = mocks.hotelApi.createLedgerPayment.mock.calls[0][1];

      // The refetch rejected, so the dialog reports failure even though the money
      // is recorded. Staff retry the identical form.
      mocks.hotelApi.getCustomerLedger.mockResolvedValue({
        ...mocks.useLedgersReturn.ledgers[0],
        balance_due: 250,
      });
      await act(async () => {
        await mocks.captured.paymentDialog!.onRecordPayment();
      });
      await waitFor(() => expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledTimes(2));

      expect(mocks.hotelApi.createLedgerPayment.mock.calls[1][1].idempotency_key)
        .toBe(committed.idempotency_key);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays a lost-response single payment before validating an edited receipt with a new key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const timeout = new Error('timeout');
      const editedHistory = createDeferred<CustomerLedgerPayment[]>();
      mocks.hotelApi.createLedgerPayment
        .mockRejectedValueOnce(timeout)
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mocks.hotelApi.getCustomerLedger.mockResolvedValue({
        ...mocks.useLedgersReturn.ledgers[0],
        balance_due: 250,
      });

      render(<CustomerLedgerPage />);
      await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.entries?.length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole('button', { name: 'Record payment for first entry' }));
      await waitFor(() => expect(mocks.captured.paymentDialog?.open).toBe(true));

      await act(async () => {
        mocks.captured.paymentDialog!.setPaymentFormData({
          ...mocks.captured.paymentDialog!.paymentFormData,
          receipt_number: 'receipt-77',
        });
      });
      mocks.useLedgersReturn.reload.mockClear();
      mocks.hotelApi.getCustomerLedger.mockClear();
      await act(async () => {
        await mocks.captured.paymentDialog!.onRecordPayment();
      });
      await waitFor(() => expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledTimes(1));
      const firstRequest = mocks.hotelApi.createLedgerPayment.mock.calls[0][1];

      mocks.hotelApi.getLedgerPayments.mockClear();
      mocks.hotelApi.getLedgerPayments.mockImplementation((ledgerId: number) =>
        Promise.resolve(ledgerId === 101 ? [buildLedgerPayment(101, ' Receipt-77 ')] : []),
      );
      await act(async () => {
        mocks.captured.paymentDialog!.setPaymentFormData({
          ...mocks.captured.paymentDialog!.paymentFormData,
          payment_reference: '   ',
          receipt_number: ' receipt-77 ',
        });
      });
      await act(async () => {
        await mocks.captured.paymentDialog!.onRecordPayment();
      });
      await waitFor(() => expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledTimes(2));
      expect(mocks.hotelApi.createLedgerPayment.mock.calls[1][1].idempotency_key)
        .toBe(firstRequest.idempotency_key);
      expect(mocks.hotelApi.createLedgerPayment.mock.calls[1][1].payment_reference).toBeUndefined();
      expect(mocks.hotelApi.getLedgerPayments).not.toHaveBeenCalled();
      expect(mocks.hotelApi.getCustomerLedger).not.toHaveBeenCalled();
      expect(mocks.useLedgersReturn.reload).not.toHaveBeenCalled();

      await act(async () => {
        mocks.captured.paymentDialog!.setPaymentFormData({
          ...mocks.captured.paymentDialog!.paymentFormData,
          payment_amount: 250,
          receipt_number: 'receipt-78',
        });
      });
      await waitFor(() => expect(mocks.captured.paymentDialog?.paymentFormData).toMatchObject({
        payment_amount: 250,
        receipt_number: 'receipt-78',
      }));

      mocks.hotelApi.getLedgerPayments.mockClear();
      mocks.hotelApi.getLedgerPayments.mockImplementation((ledgerId: number) =>
        ledgerId === 101 ? editedHistory.promise : Promise.resolve([]),
      );
      let editedSubmit!: Promise<void>;
      await act(async () => {
        editedSubmit = mocks.captured.paymentDialog!.onRecordPayment();
        await Promise.resolve();
      });

      expect(mocks.hotelApi.getLedgerPayments.mock.calls.map(([ledgerId]) => ledgerId)).toEqual([101]);
      expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledTimes(2);

      await act(async () => {
        editedHistory.resolve([buildLedgerPayment(101, 'receipt-77')]);
        await editedSubmit;
      });

      expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledTimes(3);
      const changedRequest = mocks.hotelApi.createLedgerPayment.mock.calls[2][1];
      expect(changedRequest.idempotency_key).not.toBe(firstRequest.idempotency_key);
      expect(changedRequest.receipt_number).toBe('receipt-78');
      expect(mocks.hotelApi.getCustomerLedger).toHaveBeenCalledTimes(1);
      expect(mocks.useLedgersReturn.reload).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(mocks.captured.paymentDialog?.paymentFormData.payment_amount).toBe(250));
      await act(async () => {
        mocks.captured.paymentDialog!.setPaymentFormData({
          ...mocks.captured.paymentDialog!.paymentFormData,
          receipt_number: 'receipt-79',
        });
      });
      await act(async () => {
        await mocks.captured.paymentDialog!.onRecordPayment();
      });
      await waitFor(() => expect(mocks.hotelApi.createLedgerPayment).toHaveBeenCalledTimes(4));
      expect(mocks.hotelApi.createLedgerPayment.mock.calls[3][1].idempotency_key)
        .not.toBe(changedRequest.idempotency_key);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prints a single receipt and the company statement using the shared print helpers', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.entries?.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Print first receipt' }));
    expect(mocks.print.printSingleReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ entry: expect.objectContaining({ id: 101 }) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Print company statement' }));
    expect(mocks.print.printCompanyStatement).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Acme Corp',
        ledgers: expect.arrayContaining([
          expect.objectContaining({ id: 101 }),
          expect.objectContaining({ id: 102 }),
          expect.objectContaining({ id: 103 }),
        ]),
      }),
    );
  });

  it('opens the company payment dialog scoped to outstanding, non-voided entries via the Create menu', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Acme Corp'));

    await openCreateMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Record Payment/i }));

    await waitFor(() => expect(mocks.captured.recordCompanyPaymentDialog?.open).toBe(true));
    expect(mocks.captured.recordCompanyPaymentDialog?.paymentCompany?.company_name).toBe('Acme Corp');
    expect(
      mocks.captured.recordCompanyPaymentDialog?.paymentCompanyLedgers.map((l: any) => l.id).sort(),
    ).toEqual([101, 102]);
  });

  it('creates a receipt-less company payment without fetching submit-time histories', async () => {
    mocks.hotelApi.createCompanyLedgerPayment.mockRejectedValue(new Error('timeout'));

    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[101]).toEqual([]));
    await openCreateMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Record Payment/i }));
    await waitFor(() => expect(mocks.captured.recordCompanyPaymentDialog?.open).toBe(true));

    const dialog = mocks.captured.recordCompanyPaymentDialog!;
    await act(async () => {
      dialog.setCompanyPaymentForm({
        ...dialog.companyPaymentForm,
        payment_amount: '700',
      });
    });
    mocks.hotelApi.getLedgerPayments.mockClear();
    await act(async () => {
      await mocks.captured.recordCompanyPaymentDialog!.onSubmit();
    });

    expect(mocks.hotelApi.getLedgerPayments).not.toHaveBeenCalled();
    expect(mocks.hotelApi.createCompanyLedgerPayment).toHaveBeenCalledWith(
      expect.objectContaining({ receipt_number: undefined }),
    );
  });

  it('allows one company receipt on every selected ledger when it exists only on an unselected ledger', async () => {
    mockReceiptOnLedger(103, ' Receipt-88 ');
    mocks.hotelApi.createCompanyLedgerPayment.mockResolvedValue({ payments: [], payment_amount: 700 });
    mocks.hotelApi.getCustomerLedger.mockImplementation((ledgerId: number) =>
      Promise.resolve(buildLedgers().find((ledger) => ledger.id === ledgerId)),
    );

    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[103]).toHaveLength(1));
    await openCreateMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Record Payment/i }));
    await waitFor(() => expect(mocks.captured.recordCompanyPaymentDialog?.open).toBe(true));

    const dialog = mocks.captured.recordCompanyPaymentDialog!;
    await act(async () => {
      dialog.setCompanyPaymentForm({
        ...dialog.companyPaymentForm,
        payment_amount: '700',
        receipt_number: 'receipt-88',
      });
    });
    await act(async () => {
      await mocks.captured.recordCompanyPaymentDialog!.onSubmit();
    });

    expect(mocks.hotelApi.createCompanyLedgerPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        ledger_ids: [101, 102],
        receipt_number: 'receipt-88',
      }),
    );
  });

  it('rejects a fresh company duplicate on a selected ledger after a stale empty preload', async () => {
    mocks.hotelApi.createCompanyLedgerPayment.mockResolvedValue({ payments: [], payment_amount: 700 });
    mocks.hotelApi.getCustomerLedger.mockImplementation((ledgerId: number) =>
      Promise.resolve(buildLedgers().find((ledger) => ledger.id === ledgerId)),
    );

    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[102]).toEqual([]));
    await openCreateMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Record Payment/i }));
    await waitFor(() => expect(mocks.captured.recordCompanyPaymentDialog?.open).toBe(true));

    const dialog = mocks.captured.recordCompanyPaymentDialog!;
    await act(async () => {
      dialog.setCompanyPaymentForm({
        ...dialog.companyPaymentForm,
        payment_amount: '700',
        receipt_number: 'receipt-99',
      });
    });
    mocks.hotelApi.getLedgerPayments.mockImplementation((ledgerId: number) =>
      Promise.resolve(ledgerId === 102 ? [buildLedgerPayment(102, ' Receipt-99 ')] : []),
    );
    await act(async () => {
      await mocks.captured.recordCompanyPaymentDialog!.onSubmit();
    });

    expect(mocks.hotelApi.createCompanyLedgerPayment).not.toHaveBeenCalled();
    expect(mocks.emitApiNotification).toHaveBeenCalledWith({
      message: 'Receipt number already exists',
      severity: 'warning',
    });
  });

  it('blocks a company payment when fresh history fails for its only selected ledger', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.ledgerEntriesTab?.payments?.[102]).toEqual([]));
    await openCreateMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Record Payment/i }));
    await waitFor(() => expect(mocks.captured.recordCompanyPaymentDialog?.open).toBe(true));

    const dialog = mocks.captured.recordCompanyPaymentDialog!;
    await act(async () => {
      dialog.setSelectedLedgersForPayment([
        dialog.paymentCompanyLedgers.find((ledger: CustomerLedger) => ledger.id === 102)!,
      ]);
      dialog.setCompanyPaymentForm({
        ...dialog.companyPaymentForm,
        payment_amount: '200',
        receipt_number: 'receipt-retry-102',
      });
    });
    await waitFor(() =>
      expect(mocks.captured.recordCompanyPaymentDialog?.selectedLedgersForPayment.map(
        (ledger: CustomerLedger) => ledger.id,
      )).toEqual([102]),
    );

    mocks.hotelApi.getLedgerPayments.mockClear();
    mocks.hotelApi.getLedgerPayments.mockRejectedValue(new Error('history unavailable'));
    await act(async () => {
      await mocks.captured.recordCompanyPaymentDialog!.onSubmit();
    });

    expect(mocks.hotelApi.getLedgerPayments.mock.calls.map(([ledgerId]) => ledgerId)).toEqual([102]);
    expect(mocks.hotelApi.createCompanyLedgerPayment).not.toHaveBeenCalled();
    expect(mocks.emitApiNotification).toHaveBeenCalledWith({
      message: 'Unable to verify receipt number. Please try again.',
      severity: 'error',
    });
    expect(mocks.captured.recordCompanyPaymentDialog).toMatchObject({
      open: true,
      companyPaymentForm: expect.objectContaining({ receipt_number: 'receipt-retry-102' }),
    });
  });

  it('replays a lost-response company payment before validating an edited receipt with a new key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const timeout = new Error('timeout');
      const editedHistory = createDeferred<CustomerLedgerPayment[]>();
      mocks.hotelApi.createCompanyLedgerPayment
        .mockRejectedValueOnce(timeout)
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce({ payments: [], payment_amount: 500 })
        .mockResolvedValueOnce({ payments: [], payment_amount: 500 });
      mocks.hotelApi.getCustomerLedger.mockImplementation((ledgerId: number) =>
        Promise.resolve(mocks.useLedgersReturn.ledgers.find((ledger) => ledger.id === ledgerId)),
      );

      render(<CustomerLedgerPage />);
      await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Acme Corp'));

      await openCreateMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: /Record Payment/i }));
      await waitFor(() => expect(mocks.captured.recordCompanyPaymentDialog?.open).toBe(true));

      const initialDialog = mocks.captured.recordCompanyPaymentDialog!;
      await act(async () => {
        initialDialog.setSelectedLedgersForPayment([
          initialDialog.paymentCompanyLedgers[1],
          initialDialog.paymentCompanyLedgers[0],
        ]);
        initialDialog.setCompanyPaymentForm({
          ...initialDialog.companyPaymentForm,
          payment_amount: '600',
          payment_method: 'bank_transfer',
          payment_reference: 'bank-77',
          receipt_number: 'receipt-77',
          notes: 'August settlement',
          payment_date: '2026-08-06',
        });
      });

      await waitFor(() =>
        expect(mocks.captured.recordCompanyPaymentDialog?.selectedLedgersForPayment.map((ledger: CustomerLedger) => ledger.id)).toEqual([102, 101]),
      );

      mocks.useLedgersReturn.reload.mockClear();
      mocks.hotelApi.getCustomerLedger.mockClear();
      await act(async () => {
        await mocks.captured.recordCompanyPaymentDialog!.onSubmit();
      });
      await waitFor(() => expect(mocks.hotelApi.createCompanyLedgerPayment).toHaveBeenCalledTimes(1));
      const firstRequest = mocks.hotelApi.createCompanyLedgerPayment.mock.calls[0][0];

      mocks.hotelApi.getLedgerPayments.mockClear();
      mocks.hotelApi.getLedgerPayments.mockImplementation((ledgerId: number) =>
        Promise.resolve(ledgerId === 102 ? [buildLedgerPayment(102, ' Receipt-77 ')] : []),
      );
      await act(async () => {
        mocks.captured.recordCompanyPaymentDialog!.setCompanyPaymentForm({
          ...mocks.captured.recordCompanyPaymentDialog!.companyPaymentForm,
          payment_method: ' bank_transfer ',
          payment_reference: ' bank-77 ',
          receipt_number: ' receipt-77 ',
          notes: ' August settlement ',
          payment_date: ' 2026-08-06 ',
        });
      });
      await act(async () => {
        await mocks.captured.recordCompanyPaymentDialog!.onSubmit();
      });

      await waitFor(() => expect(mocks.hotelApi.createCompanyLedgerPayment).toHaveBeenCalledTimes(2));
      const retryRequest = mocks.hotelApi.createCompanyLedgerPayment.mock.calls[1][0];
      expect(firstRequest).toMatchObject({ ledger_ids: [102, 101], payment_amount: 600 });
      expect(retryRequest.idempotency_key).toBe(firstRequest.idempotency_key);
      expect(retryRequest).toMatchObject({
        payment_method: 'bank_transfer',
        payment_reference: 'bank-77',
        receipt_number: 'receipt-77',
        notes: 'August settlement',
        payment_date: '2026-08-06',
      });
      expect(mocks.hotelApi.createLedgerPayment).not.toHaveBeenCalled();
      expect(mocks.hotelApi.getLedgerPayments).not.toHaveBeenCalled();
      expect(mocks.hotelApi.getCustomerLedger).not.toHaveBeenCalled();
      expect(mocks.useLedgersReturn.reload).not.toHaveBeenCalled();

      await act(async () => {
        mocks.captured.recordCompanyPaymentDialog!.setCompanyPaymentForm({
          ...mocks.captured.recordCompanyPaymentDialog!.companyPaymentForm,
          receipt_number: 'receipt-78',
        });
      });
      await waitFor(() => expect(mocks.captured.recordCompanyPaymentDialog?.companyPaymentForm.receipt_number).toBe('receipt-78'));

      mocks.hotelApi.getLedgerPayments.mockClear();
      mocks.hotelApi.getLedgerPayments.mockImplementation((ledgerId: number) =>
        ledgerId === 102 ? editedHistory.promise : Promise.resolve([]),
      );
      let editedSubmit!: Promise<void>;
      await act(async () => {
        editedSubmit = mocks.captured.recordCompanyPaymentDialog!.onSubmit();
        await Promise.resolve();
      });

      expect(mocks.hotelApi.getLedgerPayments.mock.calls.map(([ledgerId]) => ledgerId)).toEqual([102, 101]);
      expect(mocks.hotelApi.createCompanyLedgerPayment).toHaveBeenCalledTimes(2);

      await act(async () => {
        editedHistory.resolve([buildLedgerPayment(102, 'receipt-77')]);
        await editedSubmit;
      });

      expect(mocks.hotelApi.createCompanyLedgerPayment).toHaveBeenCalledTimes(3);
      const editedRequest = mocks.hotelApi.createCompanyLedgerPayment.mock.calls[2][0];
      expect(editedRequest.idempotency_key).not.toBe(firstRequest.idempotency_key);
      expect(editedRequest.receipt_number).toBe('receipt-78');
      expect(mocks.hotelApi.getCustomerLedger).toHaveBeenCalledTimes(2);
      expect(mocks.useLedgersReturn.reload).toHaveBeenCalledTimes(1);

      await act(async () => {
        const retryDialog = mocks.captured.recordCompanyPaymentDialog!;
        retryDialog.setSelectedLedgersForPayment([
          retryDialog.paymentCompanyLedgers.find((ledger: CustomerLedger) => ledger.id === 102)!,
          retryDialog.paymentCompanyLedgers.find((ledger: CustomerLedger) => ledger.id === 101)!,
        ]);
        retryDialog.setCompanyPaymentForm({
          ...retryDialog.companyPaymentForm,
          payment_amount: '500',
          payment_method: 'bank_transfer',
          payment_reference: 'bank-77',
          receipt_number: 'receipt-79',
          notes: 'August settlement',
          payment_date: '2026-08-06',
        });
      });

      await act(async () => {
        await mocks.captured.recordCompanyPaymentDialog!.onSubmit();
      });

      await waitFor(() => expect(mocks.hotelApi.createCompanyLedgerPayment).toHaveBeenCalledTimes(4));
      expect(mocks.hotelApi.createCompanyLedgerPayment.mock.calls[3][0].idempotency_key)
        .not.toBe(editedRequest.idempotency_key);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the company invoice dialog pre-selecting only invoice-eligible entries via the Create menu', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Acme Corp'));

    await openCreateMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Generate Invoice/i }));

    await waitFor(() => expect(mocks.captured.companyInvoiceDialog?.open).toBe(true));
    expect(mocks.captured.companyInvoiceDialog?.invoiceCompany?.company_name).toBe('Acme Corp');
    expect(mocks.captured.companyInvoiceDialog?.invoiceLedgerEntries.map((l: any) => l.id).sort()).toEqual([
      101, 102, 103,
    ]);
    expect(mocks.captured.companyInvoiceDialog?.selectedInvoiceLedgers.slice().sort()).toEqual([101, 102]);
    expect(mocks.captured.companyInvoiceDialog?.invoiceNumber).toMatch(/^INV-ACM-\d{6}$/);
  });

  it('opens the credit note dialog with only reversible (non-voided, non-reversal) entries via the Create menu', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Acme Corp'));

    await openCreateMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Credit Note/i }));

    await waitFor(() => expect(mocks.captured.creditNoteDialog?.open).toBe(true));
    expect(mocks.captured.creditNoteDialog?.activeCompany?.company_name).toBe('Acme Corp');
    expect(mocks.captured.creditNoteDialog?.reversibleEntries.map((l: any) => l.id).sort()).toEqual([101, 102]);
  });

  it('opens the create-ledger dialog pre-filled with the active company via the Create menu', async () => {
    render(<CustomerLedgerPage />);
    await waitFor(() => expect(mocks.captured.companyDetailHeader?.company?.company_name).toBe('Acme Corp'));

    await openCreateMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /New Ledger Entry/i }));

    await waitFor(() => expect(mocks.captured.createLedgerDialog?.open).toBe(true));
    expect(mocks.captured.createLedgerDialog?.selectedCompany?.company_name).toBe('Acme Corp');
    await waitFor(() => expect(mocks.hotelApi.getAllRooms).toHaveBeenCalled());
  });
});
