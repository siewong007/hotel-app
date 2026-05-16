// Data transfer type definitions

export type ImportMode = 'import' | 'overwrite';

export interface BookingDataExport {
  version: string;
  exported_at: string;
  guests: any[];
  guest_complimentary_credits: any[];
  companies: any[];
  bookings: any[];
  payments: any[];
  invoices: any[];
  booking_guests: any[];
  booking_modifications: any[];
  booking_history: any[];
  night_audit_runs: any[];
  night_audit_details: any[];
  customer_ledgers: any[];
  customer_ledger_payments: any[];
  room_changes: any[];
  user_guests: any[];
  rooms: any[];
  room_types: any[];
}

export interface ImportResult {
  success: boolean;
  mode: string;
  records_imported: Record<string, number>;
  errors?: Record<string, { failed: number; last_error: string }>;
}
