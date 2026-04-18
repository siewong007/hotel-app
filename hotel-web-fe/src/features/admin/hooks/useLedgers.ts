import { useState, useCallback, useEffect } from 'react';
import { HotelAPIService } from '../../../api';
import { CustomerLedger, CustomerLedgerSummary } from '../../../types';

export type SortField = 'company_name' | 'amount' | 'balance_due' | 'status' | 'due_date' | 'created_at';
export type SortOrder = 'asc' | 'desc';

export const PAGE_SIZE = 50;

export function useLedgers() {
  const [ledgers, setLedgers] = useState<CustomerLedger[]>([]);
  const [summary, setSummary] = useState<CustomerLedgerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalLedgers, setTotalLedgers] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter & sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expenseTypeFilter, setExpenseTypeFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const loadLedgers = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await HotelAPIService.getLedgersPage({
        page: currentPage,
        page_size: PAGE_SIZE,
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(expenseTypeFilter !== 'all' ? { expense_type: expenseTypeFilter } : {}),
        sort_by: sortField,
        sort_order: sortOrder,
      });
      setLedgers(resp.data);
      setTotalLedgers(resp.total);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load ledger data. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, statusFilter, expenseTypeFilter, sortField, sortOrder]);

  const loadSummary = useCallback(async () => {
    try {
      const data = await HotelAPIService.getCustomerLedgerSummary();
      setSummary(data);
    } catch {
      // summary is non-critical
    }
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([loadLedgers(), loadSummary()]);
  }, [loadLedgers, loadSummary]);

  // Initial summary load
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Reload on page/filter/sort changes; debounce text search
  useEffect(() => {
    const delay = searchQuery ? 400 : 0;
    const timer = setTimeout(() => loadLedgers(), delay);
    return () => clearTimeout(timer);
  }, [currentPage, searchQuery, statusFilter, expenseTypeFilter, sortField, sortOrder]);

  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
      else setSortOrder('asc');
      return field;
    });
    setCurrentPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setExpenseTypeFilter('all');
    setSortField('created_at');
    setSortOrder('desc');
    setCurrentPage(1);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  }, []);

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  }, []);

  const handleExpenseTypeChange = useCallback((value: string) => {
    setExpenseTypeFilter(value);
    setCurrentPage(1);
  }, []);

  return {
    ledgers,
    summary,
    loading,
    error,
    setError,
    totalLedgers,
    currentPage,
    setCurrentPage,
    searchQuery,
    setSearchQuery: handleSearchChange,
    statusFilter,
    setStatusFilter: handleStatusChange,
    expenseTypeFilter,
    setExpenseTypeFilter: handleExpenseTypeChange,
    sortField,
    sortOrder,
    handleSort,
    clearFilters,
    reload,
    loadLedgers,
  };
}
