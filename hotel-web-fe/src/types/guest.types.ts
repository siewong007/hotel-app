// Guest-related type definitions

// Guest membership types for pricing differentiation
export type GuestType = 'member' | 'non_member';

// Tourism type for tourism tax calculation
// Local: No tourism tax charged
// Foreign: Tourism tax charged per night
export type TourismType = 'local' | 'foreign';

export interface Guest {
  id: number;
  full_name: string;
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
  /** Read-only username of the linked active guest account, when one exists. */
  account_username?: string;
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

export interface GuestProfile {
  guest: Guest;
  summary: GuestSummary;
  reservations: GuestProfileBooking[];
  duplicate_candidates: GuestDuplicateCandidate[];
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
}
