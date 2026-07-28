// Guest portal (customer self-service) type definitions.
// These mirror the guest-portal login/me/* backend contract, which is separate
// from the staff-facing Guest/Booking types — the portal only ever exposes a
// guest-safe subset of fields, so these are intentionally their own shapes.

/** Guest-safe profile returned by the guest portal login/me endpoints. */
export interface GuestPortalGuest {
  full_name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  ic_number?: string | null;
  nationality?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  // Loose catch-all so unforeseen fields from the backend don't break the type.
  [key: string]: unknown;
}

export interface GuestPortalLoginResponse {
  token: string;
  expires_at: string;
  guest: GuestPortalGuest;
}

export interface GuestPortalMeResponse {
  guest: GuestPortalGuest;
  /**
   * Backend-authoritative completion verdict from `services::profile::completion_for_guest`.
   * Optional so a portal backend that predates this field keeps working — treat
   * a missing value as complete rather than trapping the guest in a loop.
   */
  profile_complete?: boolean;
  missing_profile_fields?: string[];
}

export interface GuestPortalBookingSummary {
  id: number;
  booking_number: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  total_amount: string | number;
  /** Present only after a booking payment is completed. */
  completed_payment_id?: number | null;
  completed_payment_method?: string | null;
  completed_payment_amount?: string | number | null;
  can_cancel: boolean;
  cancellation_unavailable_reason?: string | null;
  /** Reason from the most recently rejected payment claim, if the booking is still awaiting payment. */
  payment_rejection_reason?: string | null;
  receipt_request_payment_id?: number | null;
  receipt_request_message?: string | null;
  receipt_uploaded?: boolean;
}

export interface GuestPortalPagedResponse<T> {
  items: T[];
  total: number;
}

export type GuestPortalTransactionKind = 'payment' | 'invoice';

export interface GuestPortalTransaction {
  kind: GuestPortalTransactionKind;
  date: string;
  amount: string | number;
  method: string | null;
  reference: string | null;
  invoice_number: string | null;
  booking_number: string | null;
  status: string | null;
}

export interface GuestPortalMembership {
  member_number: string;
  tier_name: string;
  tier_level: number;
  points_balance: number;
  lifetime_points: number;
  status: string;
}

export interface GuestPortalMembershipActivity {
  date: string;
  transaction_type: string;
  points: number;
  balance_after: number;
  reason: string | null;
  booking_number: string | null;
  adjusted_by: string | null;
}

export interface GuestPortalMembershipResponse {
  membership: GuestPortalMembership | null;
  recent_activity: GuestPortalMembershipActivity[];
}

export interface GuestPortalTierBenefit {
  tier_name: string;
  discount_percentage: number;
}

export interface GuestPortalReward {
  id: number;
  name: string;
  description: string;
  category: string;
  points_required: number;
  affordable: boolean;
}

export interface GuestPortalBenefitsResponse {
  tier_benefits: GuestPortalTierBenefit[];
  rewards: GuestPortalReward[];
}

/** One room type's complimentary-night balance. Credits are not transferable
 *  between room types, so the breakdown is what the guest actually spends. */
export interface GuestPortalRoomTypeCredit {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  nights_available: number;
}

export interface GuestPortalCreditsResponse {
  total_nights_available: number;
  credits_by_room_type: GuestPortalRoomTypeCredit[];
}

/**
 * Guest-facing eKYC verification status. Mirrors the backend's
 * `EkycStatusResponse` (`hotel-app-be/src/models/ekyc.rs`), minus the
 * `verification` field: on the guest-portal read path that field is always
 * `null` (`validation::status_response` never populates it there), so it is
 * omitted here rather than modelled as the full internal verification shape.
 */
export interface GuestPortalEkycStatus {
  id: number;
  status: string;
  self_checkin_enabled?: boolean | null;
  submitted_at?: string | null;
  verified_at?: string | null;
  full_name?: string | null;
  id_type?: string | null;
  id_expiry_date?: string | null;
  customer_message?: string | null;
}

/** Body for `POST /guest-portal/me/ekyc/submit`. Mirrors the backend's
 *  `EkycSubmissionRequest` (`hotel-app-be/src/models/ekyc.rs`). */
export interface GuestPortalEkycSubmission {
  selfie_image: string;
  id_front_image: string;
  id_back_image?: string | null;
  id_type: string;
  id_number: string;
  full_name: string;
  date_of_birth: string;
  nationality?: string | null;
  address?: string | null;
  id_expiry_date: string;
  id_issue_date?: string | null;
  id_issuing_country?: string | null;
  proof_of_address?: string | null;
  phone?: string | null;
  email?: string | null;
  current_address?: string | null;
}

/** Response from `POST /guest-portal/me/ekyc/documents`. */
export interface GuestPortalEkycUploadResult {
  success: boolean;
  file_path: string;
  filename: string;
  document_type: string;
}
