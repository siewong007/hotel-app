// Customer Ledger type definitions

export type FolioType = 'guest_folio' | 'master_folio' | 'city_ledger' | 'group_folio' | 'ar_ledger';
export type TransactionType = 'debit' | 'credit';
export type PostType =
  | 'room_charge' | 'room_tax' | 'service_charge' | 'tourism_tax'
  | 'fnb_restaurant' | 'fnb_room_service' | 'fnb_minibar' | 'fnb_banquet'
  | 'laundry' | 'telephone' | 'internet' | 'parking' | 'spa' | 'gym'
  | 'transportation' | 'miscellaneous' | 'advance_deposit' | 'payment'
  | 'adjustment' | 'rebate' | 'discount' | 'commission' | 'refund'
  | 'transfer_in' | 'transfer_out' | 'city_ledger_transfer';

export interface CustomerLedger {
  id: number;
  company_name: string;
  company_registration_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address_line1?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  description: string;
  expense_type: string;
  amount: number | string;
  currency?: string;
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'void';
  paid_amount: number | string;
  balance_due: number | string;
  payment_method?: string;
  payment_reference?: string;
  payment_date?: string;
  booking_id?: number;
  check_in_date?: string;
  check_out_date?: string;
  guest_id?: number;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  notes?: string;
  internal_notes?: string;
  created_by?: number;
  updated_by?: number;
  created_at: string;
  updated_at: string;
  // Ledger accounting fields
  folio_number?: string;
  folio_type?: FolioType;
  transaction_type?: TransactionType;
  post_type?: PostType;
  department_code?: string;
  transaction_code?: string;
  room_number?: string;
  posting_date?: string;
  transaction_date?: string;
  reference_number?: string;
  cashier_id?: number;
  is_reversal?: boolean;
  original_transaction_id?: number;
  reversal_reason?: string;
  tax_amount?: number | string;
  service_charge?: number | string;
  net_amount?: number | string;
  is_posted?: boolean;
  posted_at?: string;
  void_at?: string;
  void_by?: number;
  void_reason?: string;
}

export interface CustomerLedgerCreateRequest {
  company_name: string;
  company_registration_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address_line1?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  description: string;
  expense_type: string;
  amount: number;
  currency?: string;
  booking_id?: number;
  guest_id?: number;
  invoice_date?: string;
  due_date?: string;
  notes?: string;
  internal_notes?: string;
  // Ledger accounting fields
  folio_type?: FolioType;
  transaction_type?: TransactionType;
  post_type?: PostType;
  department_code?: string;
  transaction_code?: string;
  room_number?: string;
  posting_date?: string;
  transaction_date?: string;
  reference_number?: string;
  tax_amount?: number;
  service_charge?: number;
}

/**
 * Mirrors the backend `CustomerLedgerUpdateRequest`. Fields present on
 * `CustomerLedgerCreateRequest` but deliberately absent here are immutable
 * after posting and are corrected by voiding and re-posting the entry:
 * `booking_id`/`guest_id` (re-parenting breaks the audit trail),
 * `folio_type` (`folio_number`'s prefix is derived from it at insert),
 * `transaction_type` (would invert a posted row's accounting sign), and
 * `posting_date`/`transaction_date` (`posting_date` keys invoice numbering).
 */
export interface CustomerLedgerUpdateRequest {
  company_name?: string;
  company_registration_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address_line1?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  description?: string;
  expense_type?: string;
  amount?: number;
  currency?: string;
  status?: string;
  invoice_date?: string;
  due_date?: string;
  notes?: string;
  internal_notes?: string;
  // Ledger accounting fields
  post_type?: PostType;
  department_code?: string;
  transaction_code?: string;
  room_number?: string;
  reference_number?: string;
  tax_amount?: number;
  service_charge?: number;
}

export interface CustomerLedgerPayment {
  id: number;
  ledger_id: number;
  payment_amount: number | string;
  payment_method: string;
  payment_reference?: string;
  payment_date: string;
  receipt_number?: string;
  receipt_file_url?: string;
  notes?: string;
  processed_by?: number;
  created_at: string;
}

export interface CustomerLedgerPaymentRequest {
  payment_amount: number;
  payment_method: string;
  payment_reference?: string;
  receipt_number?: string;
  receipt_file_url?: string;
  notes?: string;
  payment_date?: string;
  idempotency_key: string;
}

export interface CompanyLedgerPaymentRequest {
  ledger_ids: number[];
  payment_amount: number;
  payment_method: string;
  payment_reference?: string;
  receipt_number?: string;
  notes?: string;
  payment_date?: string;
  idempotency_key: string;
}

export interface CompanyLedgerPaymentResponse {
  payments: CustomerLedgerPayment[];
  payment_amount: number | string;
}

export interface CustomerLedgerWithPayments {
  ledger: CustomerLedger;
  payments: CustomerLedgerPayment[];
}

export interface CustomerLedgerSummary {
  total_entries: number;
  total_amount: number | string;
  total_paid: number | string;
  total_outstanding: number | string;
  pending_count: number;
  partial_count: number;
  overdue_count: number;
}

// Void request
export interface LedgerVoidRequest {
  reason: string;
}

// Reversal request
export interface LedgerReversalRequest {
  reason: string;
  notes?: string;
}
