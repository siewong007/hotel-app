// Guest-related type definitions

// Guest membership types for pricing differentiation
export type GuestType = 'member' | 'non_member';

// Tourism type for tourism tax calculation
// Local: No tourism tax charged
// Foreign: Tourism tax charged per night
export type TourismType = 'local' | 'foreign';

export interface Guest {
  id: number;
  /** Unique display name the guest booked under. For an anonymous booking this
   *  is all the hotel has until check-in; it is never overwritten afterwards. */
  nick_name: string;
  /** Legal name, collected at check-in. `last_name` being empty is how the
   *  check-in form knows it still has to ask. */
  first_name?: string | null;
  last_name?: string | null;
  email?: string;
  phone?: string;
  ic_number?: string;
  nationality?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  title?: string;
  alt_phone?: string;
  is_active: boolean;
  guest_type: GuestType; // Member or non-member for pricing differentiation
  tourism_type?: TourismType; // Local or foreign tourism for tax calculation
  discount_percentage?: number; // Member discount percentage (e.g., 10 for 10% off)
  company_name?: string; // Company the guest is tied to
  /**
   * CRM profile fields (guest relations workspace). The backend serializes
   * each with `skip_serializing_if`, so a field is absent (never `null`)
   * whenever the column is NULL or the SELECT didn't populate it.
   */
  vip_status?: string;
  tags?: string[];
  job_title?: string;
  notes?: string;
  special_requests?: string;
  marketing_opt_in?: boolean;
  communication_preference?: string;
  language_preference?: string;
  is_blacklisted?: boolean;
  blacklist_reason?: string;
  /** Read-only username of the linked guest account, when one exists. */
  account_username?: string;
  /** Activation state of the linked guest account; absent means no account. */
  account_is_active?: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Aggregate counters returned by the list endpoint
   * (`GET /guests`) — populated via subqueries against the bookings table,
   * so they remain undefined for endpoints that fetch guests by id.
   */
  bookings_count?: number;
  /** ISO date (YYYY-MM-DD) of the most recent checked-in/-out stay. */
  last_stay_date?: string;
}

export interface GuestSummary {
  completed_stays: number;
  total_nights: number;
  total_room_revenue: string | number;
  last_stay_at?: string | null;
  next_stay_at?: string | null;
  outstanding_balance: string | number;
  total_bookings: number;
  active_booking_id?: number | null;
  active_booking_number?: string | null;
}

export interface GuestProfileBooking {
  id: number;
  booking_number?: string | null;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  status: string;
  payment_status?: string | null;
  total_amount: string | number;
  total_paid: string | number;
  balance_due: string | number;
  created_at: string;
  room_number: string;
  room_type: string;
  special_requests?: string | null;
  source?: string | null;
}

export interface GuestDuplicateCandidate {
  guest: Guest;
  score: number;
  match_reasons: string[];
  blocking_reasons: string[];
  recommended_action: 'do_not_merge' | 'high_confidence_review' | 'contact_match_review' | 'manual_review' | string;
}

/**
 * Government-issued identifier details, returned only to callers holding
 * `guests:reveal`. Never present on the base `Guest` payload.
 */
export interface GuestSensitiveProfile {
  date_of_birth: string | null;
  id_type: string | null;
  id_number: string | null;
  id_expiry: string | null;
  id_country: string | null;
}

export interface GuestProfile {
  guest: Guest;
  summary: GuestSummary;
  reservations: GuestProfileBooking[];
  duplicate_candidates: GuestDuplicateCandidate[];
  /** Present only when the caller holds `guests:reveal`; omitted otherwise. */
  sensitive?: GuestSensitiveProfile | null;
}

export interface GuestTourismConversionSource {
  booking_id: number;
  booking_number?: string | null;
  check_in_date: string;
  check_out_date: string;
  tourism_tax_amount: string | number;
  net_paid_amount: string | number;
  paid_tourism_tax: boolean;
  inferred_tourism_type: TourismType;
}

export interface GuestTourismConversionResponse {
  guest: Guest;
  source: GuestTourismConversionSource;
}

export interface GuestCreateRequest {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  ic_number?: string;
  nationality?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  is_active?: boolean;
  guest_type?: GuestType;
  tourism_type?: TourismType;
  discount_percentage?: number;
  company_name?: string;
}

export interface GuestUpdateRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  ic_number?: string;
  nationality?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  title?: string;
  alt_phone?: string;
  is_active?: boolean;
  guest_type?: GuestType;
  tourism_type?: TourismType;
  discount_percentage?: number;
  company_name?: string;
  // CRM profile fields (guest relations workspace).
  vip_status?: string;
  tags?: string[];
  job_title?: string;
  notes?: string;
  special_requests?: string;
  marketing_opt_in?: boolean;
  communication_preference?: string;
  language_preference?: string;
  /** `blacklist_reason` is required by the backend when setting this true. */
  is_blacklisted?: boolean;
  blacklist_reason?: string;
  // Sensitive identifier fields — updating any of these additionally
  // requires the caller to hold `guests:reveal`.
  date_of_birth?: string;
  id_type?: string;
  id_number?: string;
  id_expiry?: string;
  id_country?: string;
}
