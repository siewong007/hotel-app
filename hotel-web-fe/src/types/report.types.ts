// Reports domain types.
//
// The backend has no typed Rust structs for report responses — every report
// generator in hotel-app-be/src/repositories/analytics.rs and
// channel_net_revenue.rs builds an ad-hoc `serde_json::Value` via the `json!`
// macro. These interfaces are hand-traced mirrors of those literal shapes
// (field names and numeric-vs-string typing verified against the exact
// `json!({...})` call that produces each array), not a real backend contract.
// If a report generator's shape changes, these types will silently drift —
// re-verify against the source `json!` call before trusting a line anchor.
//
// Money/Decimal fields note: rust_decimal's `Decimal` serializes to JSON as a
// STRING (no `serde-float` feature enabled — see Cargo.toml), so any field
// built directly from a `Decimal` (not run through `.to_string().parse::<f64>()`
// or `decimal_to_f64`) is typed `number | string` here, matching the existing
// convention in src/types/ledger.types.ts. Fields the backend explicitly
// converts to `f64` before serializing are typed as plain `number`.

// ---------------------------------------------------------------------------
// General Journal report (analytics.rs generate_general_journal, ~line 944)
// ---------------------------------------------------------------------------

export interface GeneralJournalEntry {
  date: string;
  account: string;
  debit: number | string;
  credit: number | string;
  contra_account?: string;
  contra_amount?: number | string;
  room_number?: string;
}

export interface GeneralJournalSection {
  name: string;
  entries: GeneralJournalEntry[];
  total_debit: number | string;
  total_credit: number | string;
  net_amount?: number | string;
}

// ---------------------------------------------------------------------------
// Company Ledger Statement report (analytics.rs generate_company_ledger_statement, ~line 2229)
// ---------------------------------------------------------------------------

export interface CompanyLedgerTransaction {
  id?: number;
  invoice_date?: string | null;
  voucher: string;
  invoice?: string | null;
  reference?: string;
  original_amount: number | string;
  payments_received: number | string;
  finance_charges?: number;
  open_amount: number | string;
  status: string;
  due_date?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  days_old?: number;
}

// ---------------------------------------------------------------------------
// Balance Sheet report (analytics.rs generate_balance_sheet, ~line 621)
// Note: the backend only ever emits "name" for each account, never
// "account_name" — see report from the reports-any-cleanup task.
// ---------------------------------------------------------------------------

export interface BalanceSheetAccount {
  name?: string;
  account_name?: string;
  debit: number | string;
  credit: number | string;
  balance: number | string;
}

// ---------------------------------------------------------------------------
// Shift / Payment Records report (analytics.rs generate_shift_report, ~line 769)
// ---------------------------------------------------------------------------

export interface ShiftReportPaymentMethodSummary {
  method: string;
  amount: number | string;
  count: number;
}

export interface ShiftReportPayment {
  booking_number: string;
  date: string;
  guest_name: string;
  room_number: string;
  room_type: string;
  amount: number | string;
  payment_method: string;
  payment_status: string;
  deposit_amount: number | string;
  deposit_paid: boolean;
  booking_status: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Rooms Sold report (analytics.rs generate_rooms_sold_report, ~line 883)
// ---------------------------------------------------------------------------

export interface RoomsSoldBooking {
  folio?: string;
  room_number: string;
  room_type: string;
  guest_name: string;
  check_in_date: string;
  check_out_date: string;
  post_type?: string;
  adult_count: number;
  child_count: number;
  infant_count?: number;
  rate_plan?: string;
}

// ---------------------------------------------------------------------------
// Daily Operations report (analytics.rs generate_daily_operations_report, ~line 1289)
// ---------------------------------------------------------------------------

export interface DailyOperationsGuestEntry {
  id?: number;
  booking_number: string;
  guest_name: string;
  room_number: string;
  payment_status: string | null;
}

export interface DailyOperationsInHouseEntry {
  id?: number;
  booking_number: string;
  guest_name: string;
  room_number: string;
  check_in_date: string;
  check_out_date: string;
}

// ---------------------------------------------------------------------------
// Occupancy / Revenue reports (analytics.rs generate_occupancy_report ~1443,
// generate_revenue_report ~1582) — revenue is always converted to f64 before
// serializing, so it is a plain number here.
// ---------------------------------------------------------------------------

export interface RoomTypeRevenueStat {
  room_type: string;
  bookings: number;
  revenue: number;
}

export interface RevenueBySourceStat {
  source: string;
  bookings: number;
  revenue: number;
}

export interface RevenueByPaymentStatusStat {
  payment_status: string;
  bookings: number;
  revenue: number;
}

// ---------------------------------------------------------------------------
// Channel Net Revenue report (channel_net_revenue.rs generate, ~line 973,
// row_to_json ~line 564) — all money fields go through decimal_to_f64, so
// they are plain numbers here.
// ---------------------------------------------------------------------------

export interface ChannelNetRevenueRow {
  booking_id: number;
  booking_number: string;
  ota_reference?: string | null;
  guest_name: string;
  room_number: string;
  room_type: string;
  check_in_date: string;
  check_out_date: string;
  business_date: string;
  posted_date?: string | null;
  booking_channel_id?: number | null;
  booking_channel: string;
  channel_type: string;
  platform_name: string;
  gross_room_revenue: number;
  commission_type: string;
  commission_scope: string;
  commission_value: number;
  commission_amount: number;
  net_hotel_revenue: number;
  service_tax: number;
  tourism_tax: number;
  booking_status: string;
  posted_status: string;
}

export interface ChannelRevenueSummary {
  channel_name: string;
  channel_type: string;
  bookings: number;
  room_nights: number;
  gross_revenue: number;
  commission_amount: number;
  net_revenue: number;
}

// ---------------------------------------------------------------------------
// OTA Monthly Statement report (channel_net_revenue.rs generate_monthly_statement, ~line 744)
// ---------------------------------------------------------------------------

export interface OtaStatementRow {
  booking_id: number;
  booking_number: string;
  ref_no: string;
  name: string;
  amount: number;
  commission: number;
  tax: number;
  amount_paid: number;
  check_in_date: string;
  check_out_date: string;
}

export interface OtaStatementTotals {
  bookings: number;
  amount: number;
  commission: number;
  tax: number;
  amount_paid: number;
}

export interface OtaStatement {
  platform: string;
  channel_id?: number | null;
  channel_type: string;
  booking_channel: string;
  commission_type: string;
  commission_scope: string;
  commission_value: number;
  rows: OtaStatementRow[];
  totals: OtaStatementTotals;
}

// ---------------------------------------------------------------------------
// Payment Status report (analytics.rs generate_payment_status_report, ~line 1737)
// ---------------------------------------------------------------------------

export interface PaymentStatusBreakdown {
  payment_status: string;
  count: number;
  total_amount: number;
}

export interface OverduePayment {
  id?: number;
  booking_number: string;
  guest_name: string;
  room_number: string;
  total_amount: number;
  check_out_date: string;
  payment_status?: string | null;
}

// ---------------------------------------------------------------------------
// Complimentary report (analytics.rs generate_complimentary_report, ~line 1836)
// ---------------------------------------------------------------------------

export interface ComplimentaryBooking {
  id?: number;
  booking_number: string;
  guest_name: string;
  room_number: string;
  check_in_date?: string;
  check_out_date?: string;
  is_complimentary?: boolean | null;
  complimentary_reason?: string | null;
  complimentary_start_date?: string | null;
  complimentary_end_date?: string | null;
  original_amount: number;
  actual_amount: number;
  complimentary_nights?: number | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Guest Statistics report (analytics.rs generate_guest_statistics_report, ~line 1948)
// ---------------------------------------------------------------------------

export interface TopGuestStat {
  id?: number;
  name: string;
  bookings: number;
  total_spent: number;
}

export interface NationalityStat {
  nationality: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Room Performance report (analytics.rs generate_room_performance_report, ~line 2114)
// ---------------------------------------------------------------------------

export interface RoomTypePerformanceStat {
  room_type: string;
  room_count: number;
  bookings: number;
  revenue: number;
}

export interface UnderperformingRoomStat {
  room_number: string;
  room_type: string;
  bookings: number;
}

export interface RoomPerformanceStat {
  room_number: string;
  room_type: string;
  bookings: number;
  revenue: number;
}
