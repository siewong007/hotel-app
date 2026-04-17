import { useState, useMemo } from 'react';
import { CustomerLedger } from '../../../types';

export type SortField = 'company_name' | 'amount' | 'balance_due' | 'status' | 'due_date' | 'created_at';
export type SortOrder = 'asc' | 'desc';

export function useLedgerFilters(ledgers: CustomerLedger[]) {
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expenseTypeFilter, setExpenseTypeFilter] = useState('all');

  const filtered = useMemo(() => {
    let result = [...ledgers];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        l.company_name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.invoice_number?.toLowerCase().includes(q) ||
        l.contact_person?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') result = result.filter(l => l.status === statusFilter);
    if (expenseTypeFilter !== 'all') result = result.filter(l => l.expense_type === expenseTypeFilter);

    result.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case 'company_name': aVal = a.company_name.toLowerCase(); bVal = b.company_name.toLowerCase(); break;
        case 'amount': aVal = parseFloat(String(a.amount)); bVal = parseFloat(String(b.amount)); break;
        case 'balance_due': aVal = parseFloat(String(a.balance_due)); bVal = parseFloat(String(b.balance_due)); break;
        case 'status': aVal = a.status; bVal = b.status; break;
        case 'due_date': aVal = a.due_date ? new Date(a.due_date).getTime() : 0; bVal = b.due_date ? new Date(b.due_date).getTime() : 0; break;
        default: aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime();
      }
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [ledgers, searchQuery, statusFilter, expenseTypeFilter, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setExpenseTypeFilter('all');
    setSortField('created_at');
    setSortOrder('desc');
  };

  return {
    sortField, sortOrder,
    searchQuery, setSearchQuery,
    statusFilter, setStatusFilter,
    expenseTypeFilter, setExpenseTypeFilter,
    filtered,
    handleSort,
    clearFilters,
  };
}
