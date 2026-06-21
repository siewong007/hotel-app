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
  // Extended full-backup tables (business config + operational).
  system_settings: any[];
  rate_plans: any[];
  room_rates: any[];
  amenities: any[];
  room_type_amenities: any[];
  services: any[];
  booking_services: any[];
  booking_channels: any[];
  room_status_transitions: any[];
  room_history: any[];
  room_status_change_log: any[];
  email_templates: any[];
  loyalty_programs: any[];
  loyalty_tiers: any[];
  loyalty_memberships: any[];
  points_transactions: any[];
  reward_catalog: any[];
  reward_redemptions: any[];
  corporate_accounts: any[];
  corporate_account_contacts: any[];
  housekeeping_tasks: any[];
  maintenance_tickets: any[];
  guest_documents: any[];
  guest_notes: any[];
  guest_preferences: any[];
  guest_reviews: any[];
  self_checkin_events: any[];
  night_audit_posted_nights: any[];
}

export interface ExportPreview {
  generated_at: string;
  counts: Record<string, number>;
  total_records: number;
}

export interface ImportResult {
  success: boolean;
  mode: string;
  records_imported: Record<string, number>;
  errors?: Record<string, { failed: number; last_error: string }>;
}
