import type { ConsentAcceptance } from '../../legal/useConsent';

/** Soft room preference: steers room allocation, never blocks a booking.
 *  Omitted from the request when the guest has no preference. */
export type SmokingPreference = 'smoking' | 'non_smoking';
export interface GuestBookingSearch {
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
}

export interface GuestNightlyRate {
  date: string;
  rate_plan_code: string;
  amount: string | number;
}

export interface GuestBookingOffer {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  description?: string | null;
  max_occupancy: number;
  bed_type?: string | null;
  bed_count?: number | null;
  images: string[];
  features: string[];
  available_rooms: number;
  /** Extra beds one room of this type may add (0/absent = none). */
  max_extra_beds?: number;
  /** Charge per extra bed per night. */
  extra_bed_charge?: string | number;
  currency: string;
  nightly_rates: GuestNightlyRate[];
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
}

export interface GuestBookingQuoteRequest extends GuestBookingSearch {
  room_type_id: number;
  voucher_id?: number;
  /** Nights (YYYY-MM-DD) the guest wants to fund with complimentary credits.
   *  Rates vary per night, so the guest picks which nights are comped. */
  complimentary_dates?: string[];
  /** Anonymous quotes send this so tourism tax can be priced before submit. */
  tourism_type?: 'local' | 'foreign';
}

export interface GuestBookingQuote {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
  currency: string;
  nightly_rates: GuestNightlyRate[];
  subtotal: string | number;
  /** Combined discount (complimentary nights + voucher). Always
   *  `subtotal - discount_amount + tax_amount === total_amount`. */
  discount_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  voucher_id?: number | null;
  voucher_name?: string | null;
  complimentary_dates: string[];
  complimentary_nights: number;
  complimentary_discount: string | number;
  /** Credits the guest holds for this room type right now. */
  credits_available: number;
  /** Hours an unpaid booking keeps its room before the hold is released
   *  (`null`/absent when auto-release is off). */
  hold_release_hours?: number | null;
  /** `false` when the applied voucher locks the booking against cancellation. */
  voucher_is_cancellable?: boolean | null;
}

export interface GuestBookingVoucherOptions {
  quote: GuestBookingQuote;
  eligible_voucher_ids: number[];
}

export interface CreateGuestBookingRequest extends GuestBookingQuoteRequest {
  client_request_id: string;
  expected_total: string | number;
  special_requests?: string;
  cleaning_preference?: boolean;
  smoking_preference?: SmokingPreference;
  consents: ConsentAcceptance[];
}

/** Contact details an anonymous booker supplies inline, standing in for the
 *  account a signed-in booking reads them from. */
export interface AnonymousGuestDetails {
  /** The unique nickname the guest books under. Sent as `first_name` because
   *  that is the wire field the backend validates; the legal name is collected
   *  at check-in, never here. */
  first_name: string;
  /** Required: the only way to send the confirmation, and (with the booking
   *  number) the only way back to the booking once its token lapses. */
  email: string;
  phone?: string;
  /** Never defaulted — it decides whether tourism tax applies. */
  tourism_type: 'local' | 'foreign' | '';
}

/** A booking made without an account. Carries no `voucher_id` and no
 *  `complimentary_dates`: those belong to an account and the server rejects
 *  them here. */
export interface CreateAnonymousBookingRequest extends GuestBookingSearch {
  client_request_id: string;
  room_type_id: number;
  expected_total: string | number;
  special_requests?: string;
  cleaning_preference?: boolean;
  smoking_preference?: SmokingPreference;
  guest: AnonymousGuestDetails;
  /** PDPA consent taken on the booking form. The API refuses the booking if the
   *  Booking Terms or Privacy Notice consent is missing, refused, or stale. */
  consents: ConsentAcceptance[];
  marketing_opt_in: boolean;
}

export interface GuestBookingConfirmation {
  booking_id: number;
  booking_number: string;
  room_type_name: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  payment_status: string;
  currency: string;
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  created_at: string;
  /** The preference recorded on the booking; `null`/absent = no preference. */
  smoking_preference?: SmokingPreference | null;
  /** Present only for an anonymous booking: a booking-scoped token that lets
   *  the guest pay and track this one booking with no account. */
  access_token?: string;
  access_token_expires_at?: string;
}

export interface AvailabilityEvent {
  event_id: string;
  event_type: 'availability_changed';
  reason: 'booking_created' | 'online_inventory_changed' | 'room_inventory_changed';
  room_type_id: number | null;
  check_in_date: string | null;
  check_out_date: string | null;
  remaining_rooms: number | null;
}

// ---------------------------------------------------------------- multi-room

/** One room in a multi-room cart, as sent to the group quote/create APIs. */
export interface GroupRoomRequest {
  room_type_id: number;
  adults: number;
  children: number;
  extra_beds: number;
}

export interface GroupQuoteRequest {
  check_in_date: string;
  check_out_date: string;
  rooms: GroupRoomRequest[];
  tourism_type?: 'local' | 'foreign';
  /** Signed-in only. */
  voucher_id?: number;
  /** Signed-in only: spend credits on the cheapest room-nights first. */
  use_credits?: boolean;
}

export interface GroupRoomQuote {
  index: number;
  quote: GuestBookingQuote;
  extra_bed_count: number;
  extra_bed_charge: string | number;
  room_total: string | number;
}

export interface GroupQuote {
  check_in_date: string;
  check_out_date: string;
  currency: string;
  room_count: number;
  max_rooms: number;
  rooms: GroupRoomQuote[];
  availability: { room_type_id: number; requested: number; available: number }[];
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  extra_bed_charge: string | number;
  total_amount: string | number;
  hold_release_hours?: number | null;
  voucher_id?: number | null;
  voucher_name?: string | null;
  voucher_discount: string | number;
  voucher_is_cancellable?: boolean | null;
  complimentary_nights: number;
  complimentary_discount: string | number;
  credits_available: { room_type_id: number; nights_available: number }[];
}

interface GroupCreateCommon {
  client_request_id: string;
  check_in_date: string;
  check_out_date: string;
  rooms: GroupRoomRequest[];
  expected_total: string | number;
  special_requests?: string;
  cleaning_preference?: boolean;
  smoking_preference?: SmokingPreference;
  consents: ConsentAcceptance[];
}

export interface CreateGuestGroupBookingRequest extends GroupCreateCommon {
  voucher_id?: number;
  use_credits?: boolean;
}

export interface CreateAnonymousGroupBookingRequest extends GroupCreateCommon {
  guest: AnonymousGuestDetails;
  marketing_opt_in: boolean;
}

export interface GroupBookingConfirmation {
  group_id: number;
  group_number: string;
  status: string;
  payment_status: string;
  check_in_date: string;
  check_out_date: string;
  currency: string;
  room_count: number;
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  hold_expires_at?: string | null;
  rooms: GuestBookingConfirmation[];
  access_token?: string;
  access_token_expires_at?: string;
}

export interface GroupPaymentActionResponse {
  booking_group_id: number;
  group_payment_ref: string;
  payment_ids: number[];
  amount: string | number;
  status: string;
}
