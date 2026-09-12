// Guest portal (customer self-service) type definitions.
// These mirror the guest-portal login/me/* backend contract, which is separate
// from the staff-facing Guest/Booking types — the portal only ever exposes a
// guest-safe subset of fields, so these are intentionally their own shapes.

/** Guest-safe profile returned by the guest portal login/me endpoints. */
export interface GuestPortalGuest {
  nick_name: string;
  /**
   * Split name parts. The portal's profile form edits these; `nick_name` is the
   * display name the backend derives from them and is never sent back.
   */
  first_name?: string | null;
  last_name?: string | null;
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

/** One consent decision, in the shape `useConsent().buildPayload` produces. */
export interface ConsentAcceptancePayload {
  document: string;
  version: string;
  granted: boolean;
  locale: string;
}

/**
 * Body for `POST /guest-portal/claim-account` — creating a login for the guest
 * a booking access token already authenticates.
 *
 * Distinct from `/auth/register`, which always creates a NEW guest profile and
 * refuses when the name is taken.
 *
 * `booking_number` and `guest_name` are sent from the loaded booking rather
 * than re-typed. They are not a second factor — the same token authorizes
 * `GET /guest-portal/booking`, which returns both — so asking the guest to copy
 * them off the screen would be ceremony. What actually bounds a leaked link is
 * that the account cannot password-login until its email is verified, and that
 * a guest who already has a login gets a conflict rather than a takeover.
 */
export interface GuestPortalClaimAccountRequest {
  booking_number: string;
  guest_name: string;
  username: string;
  password: string;
  email?: string;
  consents: ConsentAcceptancePayload[];
  marketing_opt_in: boolean;
}

export interface GuestPortalClaimAccountResponse {
  /** Portal session for the new account — eKYC continues in the same visit. */
  session: GuestPortalLoginResponse;
  username: string;
  /**
   * True when a verification mail went out. Password login stays blocked until
   * the guest clicks it; the session above works regardless, so pre-check-in
   * and identity verification are not held up by an email round-trip.
   */
  email_verification_required: boolean;
}

/**
 * Result of `POST /guest-portal/auto-checkin` — the guest checking themselves
 * in on approved eKYC (`AutoCheckinResponse` in
 * `hotel-app-be/src/models/booking.rs`).
 */
export interface GuestPortalAutoCheckinResponse {
  success: boolean;
  booking_id: number;
  room_number: string;
  digital_key_sent: boolean;
  checked_in_at: string;
  ekyc_summary: GuestEkycStatusSummary;
  message: string;
}

/**
 * eKYC/auto-check-in eligibility carried on every portal booking response
 * (`GuestEkycStatusSummary` in `hotel-app-be/src/models/guest.rs`).
 * `auto_checkin_block_reason` is the guest-facing explanation of why check-in
 * is not open yet — booking status, stay dates, room readiness, or eKYC state.
 */
export interface GuestEkycStatusSummary {
  guest_id: number;
  ekyc_verification_id?: number | null;
  status: string;
  self_checkin_enabled: boolean;
  verified_at?: string | null;
  can_auto_checkin: boolean;
  auto_checkin_block_reason?: string | null;
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

/**
 * Body for `PATCH /guest-portal/me/profile`.
 *
 * `email` and `ic_number` are absent by design: email is the login identifier,
 * and the IC number is identity data the hotel verifies through eKYC. Both are
 * shown read-only in the portal.
 */
export interface GuestPortalProfileUpdate {
  first_name: string;
  last_name: string;
  phone: string;
  alt_phone?: string | null;
  title?: string | null;
  nationality?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
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
  /** A staff-review cancellation request is already open for this booking. */
  cancellation_pending?: boolean;
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
