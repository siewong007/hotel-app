// Data transfer (backup/restore) type definitions.
//
// IMPORTANT: `BookingDataExport` mirrors the payload produced by the backend's
// generic data-transfer export (`hotel-app-be/src/repositories/data_transfer.rs`
// `export_table` -> `SELECT row_to_json(t) FROM (SELECT * FROM <table> ...) t`).
// That endpoint does NOT reuse the app's normal API response structs — it
// serializes the RAW table row for every column, in DB column order. Because of
// that, the row shapes below intentionally do NOT reuse most of this app's
// existing domain types (`Guest`, `Booking`, `Room`, `LoyaltyProgram`, ...):
// those types describe hand-picked/aliased/joined API responses (e.g. the
// guests API aliases `address_line_1 AS address_line1`; `Room` embeds joined
// room-type fields), which are provably different from `SELECT * FROM guests`.
// Reusing them here would silently mistype the backup/restore payload — the
// exact failure mode this file exists to prevent.
//
// Row shapes were verified against the PostgreSQL V1 baseline schema.
// (PostgreSQL; the production/default build per CLAUDE.md) as of 2026-07-12.
// A handful of tables genuinely do match an existing domain type 1:1 and reuse
// it (`Company`, `CustomerLedger`, `CustomerLedgerPayment`, `MaintenanceTicket`,
// `LoyaltyTransaction`, `AdminLoyaltyReward`) — each call-site below is
// annotated with why. Money/decimal columns are typed as plain `number`
// (not the `number | string` union used elsewhere in this app) because
// Postgres's `row_to_json()` emits genuine JSON numbers for `DECIMAL`/`NUMERIC`
// columns, unlike the `rust_decimal` string serialization used by most other
// API responses.
//
// These are intentionally NOT re-exported from `./index.ts` — they are
// implementation detail of the export/import payload, not general-purpose
// domain types, and several names would collide with the real domain types
// (e.g. `RoomType`, `Room`) if barrel-exported.

import type { Company } from './company.types';
import type { CustomerLedger, CustomerLedgerPayment } from './ledger.types';
import type { LoyaltyTransaction, AdminLoyaltyReward } from './loyaltyAdmin.types';
import type { MaintenanceTicket } from './maintenance.types';

export type ImportMode = 'import' | 'overwrite';

// ============================================================================
// Guests
// ============================================================================

/** Raw `guests` row. Distinct from `Guest` (API response), which aliases
 * `address_line_1`/`state` and omits several raw columns (tags, total_stays,
 * total_spend, id_type/id_number, deleted_at, ...). */
export interface DataTransferGuestRow {
  id: number;
  uuid: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  alt_phone?: string;
  date_of_birth?: string;
  nationality?: string;
  ic_number?: string;
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  id_type?: string;
  id_number?: string;
  id_expiry?: string;
  id_country?: string;
  language_preference?: string;
  communication_preference?: string;
  marketing_opt_in?: boolean;
  vip_status?: string;
  company_name?: string;
  job_title?: string;
  notes?: string;
  special_requests?: string;
  tags?: string[];
  total_stays?: number;
  total_spend?: number;
  average_rating?: number;
  complimentary_nights_credit?: number;
  is_blacklisted?: boolean;
  blacklist_reason?: string;
  is_active: boolean;
  guest_type: string;
  discount_percentage: number;
  tourism_type?: string;
  created_at?: string;
  created_by?: number;
  updated_at?: string;
  updated_by?: number;
  deleted_at?: string;
}

export interface DataTransferGuestComplimentaryCreditRow {
  id: number;
  guest_id: number;
  room_type_id: number;
  nights_available: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DataTransferUserGuestRow {
  id: number;
  user_id: number;
  guest_id: number;
  relationship_type?: string;
  can_book_for?: boolean;
  can_view_bookings?: boolean;
  can_modify?: boolean;
  notes?: string;
  linked_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DataTransferGuestDocumentRow {
  id: number;
  guest_id: number;
  document_type: string;
  document_number?: string;
  file_url?: string;
  is_verified?: boolean;
  verified_at?: string;
  verified_by?: number;
  expires_at?: string;
  created_at?: string;
}

export interface DataTransferGuestNoteRow {
  id: number;
  guest_id: number;
  note_type?: string;
  content: string;
  is_alert?: boolean;
  is_private?: boolean;
  created_at?: string;
  created_by?: number;
  updated_at?: string;
}

export interface DataTransferGuestPreferenceRow {
  id: number;
  guest_id: number;
  category: string;
  preference_key: string;
  preference_value: string;
  created_at?: string;
  updated_at?: string;
}

export interface DataTransferGuestReviewRow {
  id: number;
  guest_id: number;
  booking_id?: number;
  overall_rating: number;
  cleanliness_rating?: number;
  service_rating?: number;
  comfort_rating?: number;
  location_rating?: number;
  value_rating?: number;
  title?: string;
  content?: string;
  pros?: string;
  cons?: string;
  response?: string;
  response_at?: string;
  response_by?: number;
  is_published?: boolean;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Bookings
// ============================================================================

/** Raw `bookings` row. Distinct from `Booking` (API response): raw row has
 * generated columns (`nights`, `total_guests`), separate guest snapshot
 * fields, and numeric ids, none of which match the `Booking` shape. */
export interface DataTransferBookingRow {
  id: number;
  uuid: string;
  booking_number: string;
  folio_number?: string;
  guest_id: number;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  corporate_account_id?: string;
  room_id: number;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  adults: number;
  children?: number;
  infants?: number;
  total_guests: number;
  rate_plan_id?: number;
  room_rate: number;
  subtotal: number;
  tax_amount?: number;
  discount_amount?: number;
  discount_percentage?: number;
  total_amount: number;
  currency?: string;
  rate_override_weekday?: number;
  rate_override_weekend?: number;
  daily_rates?: Record<string, number>;
  is_tourist?: boolean;
  tourism_tax_amount?: number;
  extra_bed_count?: number;
  extra_bed_charge?: number;
  room_card_deposit?: number;
  late_checkout_penalty?: number;
  is_complimentary?: boolean;
  complimentary_reason?: string;
  complimentary_start_date?: string;
  complimentary_end_date?: string;
  original_total_amount?: number;
  complimentary_nights?: number;
  deposit_paid?: boolean;
  deposit_amount?: number;
  deposit_paid_at?: string;
  status?: string;
  payment_status?: string;
  payment_method?: string;
  payment_note?: string;
  market_code?: string;
  company_id?: number;
  company_name?: string;
  check_in_time?: string;
  check_out_time?: string;
  actual_check_in?: string;
  actual_check_out?: string;
  early_check_in?: boolean;
  late_check_out?: boolean;
  pre_checkin_completed?: boolean;
  pre_checkin_completed_at?: string;
  pre_checkin_token?: string;
  pre_checkin_token_expires_at?: string;
  special_requests?: string;
  internal_notes?: string;
  remarks?: string;
  source?: string;
  post_type?: string;
  channel?: string;
  commission_rate?: number;
  cancelled_at?: string;
  cancelled_by?: number;
  cancellation_reason?: string;
  cancellation_fee?: number;
  is_posted?: boolean;
  posted_date?: string;
  posted_at?: string;
  posted_by?: number;
  created_at?: string;
  created_by?: number;
  updated_at?: string;
  updated_by?: number;
}

export interface DataTransferBookingGuestRow {
  id: number;
  booking_id: number;
  guest_id?: number;
  first_name?: string;
  last_name?: string;
  age_group?: string;
  is_primary?: boolean;
  created_at?: string;
}

export interface DataTransferBookingModificationRow {
  id: string;
  booking_id: number;
  modification_type: string;
  old_value?: unknown;
  new_value?: unknown;
  reason?: string;
  price_adjustment?: number;
  modified_at?: string;
  modified_by: number;
}

export interface DataTransferBookingHistoryRow {
  id: string;
  booking_id: number;
  previous_status?: string;
  new_status: string;
  changed_by?: number;
  change_reason?: string;
  metadata?: unknown;
  created_at?: string;
}

export interface DataTransferRoomChangeRow {
  id: number;
  booking_id: number;
  from_room_id: number;
  to_room_id: number;
  guest_id?: number;
  reason?: string;
  changed_by?: number;
  changed_at?: string;
  created_at?: string;
}

export interface DataTransferBookingServiceRow {
  id: string;
  booking_id: number;
  service_id: number;
  quantity?: number;
  unit_price: number;
  total_price: number;
  service_date?: string;
  status?: string;
  notes?: string;
  delivered_by?: number;
  created_at?: string;
  created_by?: number;
}

export interface DataTransferBookingChannelRow {
  id: number;
  name: string;
  channel_type: string;
  default_commission_type: string;
  default_commission_value: number;
  default_commission_scope: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Payments & Invoices
// ============================================================================

/** Raw `payments` row. There is no domain `Payment` API type in this app to
 * reuse — payment reads go through `PaymentWorkflowSummary`/`PaymentEntryRow`
 * style aggregates instead. */
export interface DataTransferPaymentRow {
  id: number;
  uuid: string;
  booking_id: number;
  amount: number;
  currency?: string;
  payment_method: string;
  payment_type?: string;
  transaction_id?: string;
  card_last_four?: string;
  card_brand?: string;
  payment_gateway?: string;
  gateway_customer_id?: string;
  gateway_payment_intent_id?: string;
  gateway_charge_id?: string;
  status?: string;
  failure_reason?: string;
  refund_amount?: number;
  refunded_at?: string;
  refund_reason?: string;
  gateway_refund_id?: string;
  metadata?: unknown;
  notes?: string;
  receipt_url?: string;
  created_at?: string;
  created_by?: number;
  processed_at?: string;
  processed_by?: number;
}

/** Raw `invoices` row. Distinct from `Invoice` (API response), which is a
 * booking/guest JOIN (customer_name, room_number, ...) — the raw row instead
 * has `bill_to_guest_id`/`billing_name`/`issue_date`/`pdf_url`. */
export interface DataTransferInvoiceRow {
  id: number;
  uuid: string;
  invoice_number: string;
  booking_id: number;
  bill_to_guest_id?: number;
  bill_to_corporate_id?: string;
  billing_name: string;
  billing_address?: string;
  billing_email?: string;
  tax_id?: string;
  issue_date: string;
  due_date?: string;
  subtotal: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount: number;
  paid_amount?: number;
  balance_due: number;
  currency?: string;
  line_items: unknown;
  status?: string;
  pdf_url?: string;
  invoice_type?: string;
  payment_terms?: string;
  room_charges?: number;
  service_charges?: number;
  additional_charges?: number;
  notes?: string;
  terms?: string;
  created_at?: string;
  created_by?: number;
  updated_at?: string;
  sent_at?: string;
  paid_at?: string;
}

export interface DataTransferServiceRow {
  id: number;
  name: string;
  category: string;
  description?: string;
  unit_price: number;
  unit_type?: string;
  tax_rate?: number;
  is_taxable?: boolean;
  is_active?: boolean;
  image_url?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Rooms & rates
// ============================================================================

/** Raw `rooms` row. Distinct from `Room` (API response), which is a
 * room-type JOIN with derived fields (`price_per_night`, `available`,
 * `average_rating`) that don't exist as raw columns. */
export interface DataTransferRoomRow {
  id: number;
  room_number: string;
  room_type_id: number;
  floor?: number;
  building?: string;
  custom_price?: number;
  status?: string;
  status_notes?: string;
  reserved_start_date?: string;
  reserved_end_date?: string;
  maintenance_start_date?: string;
  maintenance_end_date?: string;
  cleaning_start_date?: string;
  cleaning_end_date?: string;
  current_occupancy?: number;
  last_cleaned_at?: string;
  last_inspected_at?: string;
  inspected_by?: number;
  is_smoking?: boolean;
  is_accessible?: boolean;
  has_view?: boolean;
  view_type?: string;
  connecting_room_id?: number;
  notes?: string;
  is_active?: boolean;
  last_posted_status?: string;
  last_posted_date?: string;
  created_at?: string;
  updated_at?: string;
}

/** Raw `room_types` row. `RoomType` (API type) omits `size_sqm`/`size_sqft`/
 * `floor_range`/`images`/`features`, which are real columns here. */
export interface DataTransferRoomTypeRow {
  id: number;
  code: string;
  name: string;
  description?: string;
  base_price: number;
  weekday_rate?: number;
  weekend_rate?: number;
  max_occupancy?: number;
  bed_type?: string;
  bed_count?: number;
  allows_extra_bed?: boolean;
  max_extra_beds?: number;
  extra_bed_charge?: number;
  size_sqm?: number;
  size_sqft?: number;
  floor_range?: string;
  images?: unknown;
  features?: unknown;
  is_active?: boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DataTransferAmenityRow {
  id: number;
  name: string;
  category: string;
  icon?: string;
  description?: string;
  is_paid?: boolean;
  price?: number;
  is_active?: boolean;
  created_at?: string;
}

/** Raw `room_type_amenities` row — composite-keyed join table, no `id`. */
export interface DataTransferRoomTypeAmenityRow {
  room_type_id: number;
  amenity_id: number;
  is_complimentary?: boolean;
}

export interface DataTransferRoomHistoryRow {
  id: number;
  room_id: number;
  from_status?: string;
  to_status: string;
  notes?: string;
  start_date?: string;
  end_date?: string;
  changed_by?: number;
  is_auto_generated?: boolean;
  created_at?: string;
}

/** Raw `room_status_transitions` row — composite-keyed state machine table,
 * no `id`. */
export interface DataTransferRoomStatusTransitionRow {
  from_status: string;
  to_status: string;
  is_allowed?: boolean;
  requires_permission?: string;
  notes?: string;
  created_at?: string;
}

export interface DataTransferRoomStatusChangeLogRow {
  id: string;
  room_id: number;
  from_status?: string;
  to_status?: string;
  trigger_source?: string;
  booking_id?: number;
  was_blocked?: boolean;
  reason?: string;
  created_at?: string;
}

export interface DataTransferRatePlanRow {
  id: number;
  name: string;
  code: string;
  description?: string;
  plan_type?: string;
  adjustment_type?: string;
  adjustment_value?: number;
  valid_from?: string;
  valid_to?: string;
  applies_monday?: boolean;
  applies_tuesday?: boolean;
  applies_wednesday?: boolean;
  applies_thursday?: boolean;
  applies_friday?: boolean;
  applies_saturday?: boolean;
  applies_sunday?: boolean;
  min_nights?: number;
  max_nights?: number;
  min_advance_booking?: number;
  max_advance_booking?: number;
  blackout_dates?: unknown;
  is_active?: boolean;
  priority?: number;
  created_at?: string;
  created_by?: number;
  updated_at?: string;
}

export interface DataTransferRoomRateRow {
  id: number;
  rate_plan_id: number;
  room_type_id: number;
  price: number;
  effective_from: string;
  effective_to?: string;
  created_at?: string;
}

// ============================================================================
// Housekeeping / maintenance
// ============================================================================

/** Raw `housekeeping_tasks` row. Distinct from `HousekeepingTask` (API
 * response), which requires joined `room_number`/`room_type` fields that
 * don't exist on the raw table. */
export interface DataTransferHousekeepingTaskRow {
  id: number;
  room_id: number;
  task_type?: string;
  priority?: string;
  status?: string;
  assigned_to?: number;
  scheduled_date?: string;
  task_date?: string;
  started_at?: string;
  completed_at?: string;
  notes?: string;
  inspection_notes?: string;
  items_used?: unknown;
  created_at?: string;
  created_by?: number;
  updated_at?: string;
}

// ============================================================================
// Loyalty (legacy `loyalty_programs`/`loyalty_memberships` schema)
// ============================================================================

/** Raw `loyalty_programs` row. Unlike `LoyaltyProgram` (legacy API type,
 * which targets an unmounted route), the real column is `points_per_dollar`,
 * not `tier_level`/`points_multiplier`/`minimum_points_required`. */
export interface DataTransferLoyaltyProgramRow {
  id: number;
  name: string;
  description?: string;
  points_per_dollar?: number;
  currency?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Raw `loyalty_tiers` row — union of the original migration's columns and
 * the later `code`/`min_nights`/`min_spend`/`is_active`/`updated_at` columns
 * added for the newer `modules::loyalty` router (both live on one table). */
export interface DataTransferLoyaltyTierRow {
  id: number;
  program_id: number;
  name: string;
  min_points?: number;
  max_points?: number;
  benefits?: unknown;
  discount_percentage?: number;
  points_multiplier?: number;
  color?: string;
  icon?: string;
  sort_order?: number;
  created_at?: string;
  code?: string;
  min_nights?: number;
  min_spend?: number;
  is_active?: boolean;
  updated_at?: string;
}

export interface DataTransferLoyaltyMembershipRow {
  id: number;
  guest_id: number;
  program_id: number;
  tier_id?: number;
  member_number: string;
  points_balance?: number;
  lifetime_points?: number;
  status?: string;
  enrolled_at?: string;
  expires_at?: string;
  last_activity_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DataTransferPointsTransactionRow {
  id: number;
  membership_id: number;
  transaction_type: string;
  points: number;
  balance_after: number;
  reference_type?: string;
  reference_id?: number;
  description?: string;
  created_at?: string;
  created_by?: number;
}

export interface DataTransferRewardCatalogRow {
  id: number;
  program_id: number;
  name: string;
  description?: string;
  category: string;
  points_required: number;
  quantity_available?: number;
  valid_from?: string;
  valid_to?: string;
  is_active?: boolean;
  terms_conditions?: string;
  image_url?: string;
  created_at?: string;
  updated_at?: string;
}

/** Raw `reward_redemptions` row (legacy `reward_catalog`-linked table).
 * Distinct from the backend's `RewardRedemption` struct, which targets a
 * different (`transaction_id`-bearing) query, not `SELECT *`. */
export interface DataTransferRewardRedemptionRow {
  id: number;
  membership_id: number;
  reward_id: number;
  booking_id?: number;
  points_spent: number;
  status?: string;
  redemption_code?: string;
  redeemed_at?: string;
  used_at?: string;
  expires_at?: string;
  notes?: string;
}

// ============================================================================
// Loyalty (current `modules::loyalty` schema: members/accounts/rewards)
// ============================================================================

export interface DataTransferLoyaltyMemberRow {
  id: number;
  guest_id: number;
  member_number: string;
  status?: string;
  enrolled_at?: string;
  closed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DataTransferLoyaltyAccountRow {
  id: number;
  member_id: number;
  current_tier_id: number;
  lifetime_points?: number;
  qualifying_points?: number;
  qualifying_nights?: number;
  qualifying_spend?: number;
  tier_evaluation_year?: number;
  created_at?: string;
  updated_at?: string;
}

/** Raw `loyalty_redemptions` row. Distinct from `LoyaltyRedemption` (API
 * type), which requires joined `member_number`/`guest_name`/`reward_name`
 * fields that don't exist on the raw table. */
export interface DataTransferLoyaltyRedemptionRow {
  id: number;
  member_id: number;
  reward_id: number;
  transaction_id?: number;
  points_spent: number;
  status?: string;
  requested_at?: string;
  reviewed_by?: number;
  reviewed_at?: string;
  rejection_reason?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** Raw `loyalty_program_rules` row. Superset of `LoyaltyProgramRules` (API
 * type), which omits `created_at`. */
export interface DataTransferLoyaltyProgramRulesRow {
  id: number;
  points_per_currency_unit?: number;
  tier_qualification_metric?: string;
  point_expiry_months?: number;
  redemption_approval_required?: boolean;
  earning_enabled?: boolean;
  min_eligible_amount?: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Corporate accounts
// ============================================================================

export interface DataTransferCorporateAccountRow {
  id: string;
  name: string;
  company_registration?: string;
  tax_id?: string;
  industry?: string;
  billing_address?: string;
  billing_email?: string;
  billing_phone?: string;
  credit_limit?: number;
  credit_balance?: number;
  payment_terms?: string;
  discount_percentage?: number;
  contract_start?: string;
  contract_end?: string;
  is_active?: boolean;
  notes?: string;
  created_at?: string;
  created_by?: number;
  updated_at?: string;
}

export interface DataTransferCorporateAccountContactRow {
  id: number;
  corporate_account_id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  is_primary?: boolean;
  created_at?: string;
}

// ============================================================================
// Night audit
// ============================================================================

/** Raw `night_audit_runs` row. Distinct from `NightAuditRun` (API response),
 * whose `payment_method_breakdown`/`booking_channel_breakdown` are computed
 * `RevenueBreakdownItem[]` arrays, not the raw JSONB object columns here. */
export interface DataTransferNightAuditRunRow {
  id: number;
  audit_date: string;
  run_at?: string;
  run_by?: number;
  status?: string;
  total_bookings_posted?: number;
  total_checkins?: number;
  total_checkouts?: number;
  total_revenue?: number;
  total_rooms_occupied?: number;
  total_rooms_available?: number;
  occupancy_rate?: number;
  rooms_available?: number;
  rooms_occupied?: number;
  rooms_reserved?: number;
  rooms_maintenance?: number;
  rooms_dirty?: number;
  payment_method_breakdown?: unknown;
  booking_channel_breakdown?: unknown;
  notes?: string;
  error_message?: string;
  created_at?: string;
}

export interface DataTransferNightAuditDetailRow {
  id: number;
  audit_run_id: number;
  booking_id?: number;
  room_id?: number;
  record_type: string;
  action: string;
  data?: unknown;
  created_at?: string;
}

export interface DataTransferNightAuditPostedNightRow {
  id: number;
  booking_id: number;
  audit_date: string;
  room_rate: number;
  room_charge: number;
  service_tax: number;
  tourism_tax: number;
  extra_bed_charge: number;
  extra_bed_tax: number;
  total_posted: number;
  audit_run_id?: number;
  posted_at?: string;
  posted_by?: number;
}

// ============================================================================
// Misc
// ============================================================================

export interface DataTransferSystemSettingRow {
  id: number;
  key: string;
  value: string;
  value_type?: string;
  category?: string;
  description?: string;
  is_public?: boolean;
  is_encrypted?: boolean;
  validation_pattern?: string;
  created_at?: string;
  updated_at?: string;
  updated_by?: number;
}

export interface DataTransferEmailTemplateRow {
  id: number;
  code: string;
  name: string;
  subject: string;
  body_html: string;
  body_text?: string;
  variables?: unknown;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Raw `self_checkin_events` row. Matches the backend's `SelfCheckinEvent`
 * struct (`hotel-app-be/src/models/ekyc.rs`) field-for-field, which has no
 * frontend equivalent to reuse. */
export interface DataTransferSelfCheckinEventRow {
  id: number;
  booking_id: number;
  guest_id?: number;
  ekyc_verification_id?: number;
  user_id?: number;
  checked_in_at?: string;
  room_key_issued?: boolean;
  digital_key_sent?: boolean;
  device_type?: string;
  checkin_location?: string;
  event_type?: string;
  source?: string;
  event_data?: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
}

// ============================================================================
// Full export/import payload
// ============================================================================

export interface BookingDataExport {
  version: string;
  exported_at: string;
  /** Schema-driven v2 full backup. Keys are qualified names such as
   * `public.users`; values intentionally retain raw credential/session rows. */
  tables?: Record<string, Record<string, unknown>[]>;
  guests: DataTransferGuestRow[];
  guest_complimentary_credits: DataTransferGuestComplimentaryCreditRow[];
  // `companies` matches the `Company` API type column-for-column.
  companies: Company[];
  bookings: DataTransferBookingRow[];
  payments: DataTransferPaymentRow[];
  invoices: DataTransferInvoiceRow[];
  booking_guests: DataTransferBookingGuestRow[];
  booking_modifications: DataTransferBookingModificationRow[];
  booking_history: DataTransferBookingHistoryRow[];
  night_audit_runs: DataTransferNightAuditRunRow[];
  night_audit_details: DataTransferNightAuditDetailRow[];
  // `customer_ledgers`/`customer_ledger_payments` match their ledger.types.ts
  // counterparts column-for-column (verified against the V1 baseline).
  customer_ledgers: CustomerLedger[];
  customer_ledger_payments: CustomerLedgerPayment[];
  room_changes: DataTransferRoomChangeRow[];
  user_guests: DataTransferUserGuestRow[];
  rooms: DataTransferRoomRow[];
  room_types: DataTransferRoomTypeRow[];
  // Extended full-backup tables (business config + operational).
  system_settings: DataTransferSystemSettingRow[];
  rate_plans: DataTransferRatePlanRow[];
  room_rates: DataTransferRoomRateRow[];
  amenities: DataTransferAmenityRow[];
  room_type_amenities: DataTransferRoomTypeAmenityRow[];
  services: DataTransferServiceRow[];
  booking_services: DataTransferBookingServiceRow[];
  booking_channels: DataTransferBookingChannelRow[];
  room_status_transitions: DataTransferRoomStatusTransitionRow[];
  room_history: DataTransferRoomHistoryRow[];
  room_status_change_log: DataTransferRoomStatusChangeLogRow[];
  email_templates: DataTransferEmailTemplateRow[];
  loyalty_programs: DataTransferLoyaltyProgramRow[];
  loyalty_tiers: DataTransferLoyaltyTierRow[];
  loyalty_memberships: DataTransferLoyaltyMembershipRow[];
  loyalty_members: DataTransferLoyaltyMemberRow[];
  loyalty_accounts: DataTransferLoyaltyAccountRow[];
  points_transactions: DataTransferPointsTransactionRow[];
  // `loyalty_transactions` matches `LoyaltyTransaction` (loyaltyAdmin.types.ts)
  // column-for-column.
  loyalty_transactions: LoyaltyTransaction[];
  reward_catalog: DataTransferRewardCatalogRow[];
  // `loyalty_rewards` matches `AdminLoyaltyReward` (loyaltyAdmin.types.ts):
  // its one extra field (`minimum_tier_name`, a join) is optional there.
  loyalty_rewards: AdminLoyaltyReward[];
  reward_redemptions: DataTransferRewardRedemptionRow[];
  loyalty_redemptions: DataTransferLoyaltyRedemptionRow[];
  loyalty_program_rules: DataTransferLoyaltyProgramRulesRow[];
  corporate_accounts: DataTransferCorporateAccountRow[];
  corporate_account_contacts: DataTransferCorporateAccountContactRow[];
  housekeeping_tasks: DataTransferHousekeepingTaskRow[];
  // `maintenance_tickets` matches `MaintenanceTicket` (maintenance.types.ts):
  // its joined display fields (`room_number`, `assigned_to_name`) are
  // already optional there, so the raw row still satisfies the type.
  maintenance_tickets: MaintenanceTicket[];
  guest_documents: DataTransferGuestDocumentRow[];
  guest_notes: DataTransferGuestNoteRow[];
  guest_preferences: DataTransferGuestPreferenceRow[];
  guest_reviews: DataTransferGuestReviewRow[];
  self_checkin_events: DataTransferSelfCheckinEventRow[];
  night_audit_posted_nights: DataTransferNightAuditPostedNightRow[];
}

export interface ExportPreview {
  generated_at: string;
  counts: Record<string, number>;
  total_records: number;
  tables?: Array<{ name: string; count: number; dependencies: string[] }>;
}

export interface ImportResult {
  success: boolean;
  mode: string;
  records_imported: Record<string, number>;
  errors?: Record<string, { failed: number; last_error: string }>;
}
