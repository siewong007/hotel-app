import { useEffect, useMemo } from 'react';
import { LedgerService } from '../../../../../api';
import type { BookingWithDetails, Company, CustomerLedger } from '../../../../../types';
import { useLedgersPage } from '../../../hooks/useLedgers';
import { getLedgerUiStatus, isLedgerVoided } from '../helpers';
import type { EntryStatusFilter } from '../types';
import { isPositiveMoney, sumMoney, toMoneyNumber } from '../../../../../utils/money';

export type CompanyListFilter = 'all' | 'due' | 'clear';

export interface CompanyLedgerAggregate {
  total: number;
  paid: number;
  due: number;
  pending: number;
  overdue: number;
  count: number;
}

export interface CustomerLedgerSummary {
  total_entries: number;
  total_amount: number;
  total_paid: number;
  total_outstanding: number;
  pending_count: number;
  partial_count: number;
  overdue_count: number;
}

interface UseCustomerLedgerWorkspaceParams {
  ledgers: CustomerLedger[];
  companies: Company[];
  allCompanyBookings: BookingWithDetails[];
  selectedCompanyId: number | null;
  setSelectedCompanyId: (value: number | null) => void;
  companyListSearch: string;
  companyListFilter: CompanyListFilter;
  entriesSearch: string;
  entriesStatusFilter: EntryStatusFilter;
  entriesPage: number;
  entriesPageSize: number;
  setEntriesPage: (value: number) => void;
}

const EMPTY_AGGREGATE: CompanyLedgerAggregate = {
  total: 0,
  paid: 0,
  due: 0,
  pending: 0,
  overdue: 0,
  count: 0,
};

export function useCustomerLedgerWorkspace({
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
}: UseCustomerLedgerWorkspaceParams) {
  const summary = useMemo<CustomerLedgerSummary>(() => {
    let total_amount = 0;
    let total_paid = 0;
    let total_outstanding = 0;
    let pending_count = 0;
    let partial_count = 0;
    let overdue_count = 0;

    // Voided ledgers keep their GENERATED balance_due column as-is (voiding
    // never zeroes it), so they must be excluded here to match the backend's
    // own /ledgers/summary (`WHERE status NOT IN ('void')`) and what the Void
    // dialog promises the operator: a voided charge stops counting toward
    // what a company owes.
    const activeLedgers = ledgers.filter((ledger) => !isLedgerVoided(ledger));

    activeLedgers.forEach((ledger) => {
      total_amount = sumMoney([total_amount, ledger.amount]);
      total_paid = sumMoney([total_paid, ledger.paid_amount]);
      total_outstanding = sumMoney([total_outstanding, ledger.balance_due]);
      if (ledger.status === 'pending') pending_count += 1;
      else if (ledger.status === 'partial') partial_count += 1;
      else if (ledger.status === 'overdue') overdue_count += 1;
    });

    return {
      total_entries: activeLedgers.length,
      total_amount,
      total_paid,
      total_outstanding,
      pending_count,
      partial_count,
      overdue_count,
    };
  }, [ledgers]);

  const companyAggregates = useMemo(() => {
    const rows = new Map<string, CompanyLedgerAggregate>();
    // Same void exclusion as `summary` above: a voided ledger's balance_due
    // is never zeroed by the void action, so leaving it in would show a
    // company as still owing (or having billed) money for a charge the Void
    // dialog told the operator was cancelled.
    ledgers.filter((ledger) => !isLedgerVoided(ledger)).forEach((ledger) => {
      const current = rows.get(ledger.company_name) || { ...EMPTY_AGGREGATE };
      const uiStatus = getLedgerUiStatus(ledger);
      const amount = toMoneyNumber(ledger.amount);
      const paid = toMoneyNumber(ledger.paid_amount);
      const balance = toMoneyNumber(ledger.balance_due);
      current.total = sumMoney([current.total, amount]);
      current.paid = sumMoney([current.paid, paid]);
      current.due = sumMoney([current.due, balance]);
      current.count += 1;
      if (isPositiveMoney(balance)) current.pending += 1;
      if (uiStatus === 'overdue') current.overdue = sumMoney([current.overdue, balance]);
      rows.set(ledger.company_name, current);
    });
    return rows;
  }, [ledgers]);

  const companyListRows = useMemo(() => {
    const q = companyListSearch.trim().toLowerCase();
    return companies
      .map((company) => ({ c: company, agg: companyAggregates.get(company.company_name) || EMPTY_AGGREGATE }))
      .filter(({ c, agg }) => {
        if (companyListFilter === 'due' && !isPositiveMoney(agg.due)) return false;
        if (companyListFilter === 'clear' && isPositiveMoney(agg.due)) return false;
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
    () => companies.filter((company) => isPositiveMoney(companyAggregates.get(company.company_name)?.due || 0)).length,
    [companies, companyAggregates],
  );
  const clearCount = companies.length - dueCount;

  useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) {
      const sorted = [...companies].sort((a, b) => {
        const aDue = companyAggregates.get(a.company_name)?.due || 0;
        const bDue = companyAggregates.get(b.company_name)?.due || 0;
        return bDue - aDue;
      });
      setSelectedCompanyId(sorted[0].id);
    }
  }, [companies, companyAggregates, selectedCompanyId, setSelectedCompanyId]);

  const activeCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  );

  const activeAgg = activeCompany
    ? companyAggregates.get(activeCompany.company_name) || EMPTY_AGGREGATE
    : EMPTY_AGGREGATE;

  const activeBookingsForCompany = useMemo(
    () => (activeCompany ? allCompanyBookings.filter((booking) => booking.company_id === activeCompany.id) : []),
    [allCompanyBookings, activeCompany],
  );

  const activeCompanyAllEntries = useMemo(() => {
    if (!activeCompany) return [] as CustomerLedger[];
    return ledgers.filter((ledger) => ledger.company_name === activeCompany.company_name);
  }, [ledgers, activeCompany]);

  const activeLedgerPageParams = useMemo(() => {
    if (!activeCompany) return undefined;

    const params: Parameters<typeof LedgerService.getLedgersPage>[0] = {
      company_name: activeCompany.company_name,
      page: entriesPage + 1,
      page_size: entriesPageSize,
      sort_by: 'created_at',
      sort_order: 'desc',
    };
    const q = entriesSearch.trim();
    if (q) params.search = q;

    if (entriesStatusFilter === 'uninvoiced') params.invoice_state = 'uninvoiced';
    else if (entriesStatusFilter === 'outstanding') params.balance_state = 'outstanding';
    else if (entriesStatusFilter === 'invoiced') params.invoice_state = 'invoiced';
    else if (entriesStatusFilter !== 'all') params.ui_status = entriesStatusFilter;

    return params;
  }, [activeCompany, entriesPage, entriesPageSize, entriesSearch, entriesStatusFilter]);

  const activeLedgerPageQuery = useLedgersPage(activeLedgerPageParams, Boolean(activeCompany));

  useEffect(() => {
    setEntriesPage(0);
  }, [activeCompany?.company_name, entriesSearch, entriesStatusFilter, setEntriesPage]);

  const activeCompanyEntries = useMemo(() => {
    if (!activeCompany) return [] as CustomerLedger[];
    return activeLedgerPageQuery.data?.data ?? [];
  }, [activeCompany, activeLedgerPageQuery.data]);

  const activeCompanyEntriesTotal = activeLedgerPageQuery.data?.total ?? 0;
  const activeCompanyEntriesLoading = activeLedgerPageQuery.isLoading || activeLedgerPageQuery.isFetching;

  const paidEntriesCount = useMemo(
    () =>
      activeCompany
        ? ledgers.filter((ledger) => ledger.company_name === activeCompany.company_name && getLedgerUiStatus(ledger) === 'paid').length
        : 0,
    [ledgers, activeCompany],
  );

  return {
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
  };
}
