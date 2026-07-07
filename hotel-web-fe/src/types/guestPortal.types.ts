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

export interface GuestPortalLoginRequest {
  email: string;
  booking_number?: string;
  member_number?: string;
}

export interface GuestPortalLoginResponse {
  token: string;
  expires_at: string;
  guest: GuestPortalGuest;
}

export interface GuestPortalMeResponse {
  guest: GuestPortalGuest;
}

export interface GuestPortalBookingSummary {
  booking_number: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  total_amount: string | number;
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
