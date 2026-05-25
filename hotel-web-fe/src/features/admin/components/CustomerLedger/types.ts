// Types for the Customer Ledger feature

// Company option for autocomplete
export interface CompanyOption {
  inputValue?: string;
  company_name: string;
  company_registration_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address_line1?: string;
  isNew?: boolean;
}

export type LedgerUiStatus =
  | 'draft'
  | 'ready_to_invoice'
  | 'invoiced'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'voided';

export type EntryStatusFilter =
  | 'all'
  | 'uninvoiced'
  | 'outstanding'
  | 'invoiced'
  | 'paid'
  | 'overdue'
  | 'voided';

export type ToneName = 'neutral' | 'blue' | 'indigo' | 'amber' | 'green' | 'red' | 'muted';
