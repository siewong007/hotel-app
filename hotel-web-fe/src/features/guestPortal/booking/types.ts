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
}

/** Contact details an anonymous booker supplies inline, standing in for the
 *  account a signed-in booking reads them from. */
export interface AnonymousGuestDetails {
  first_name: string;
  last_name?: string;
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
  guest: AnonymousGuestDetails;
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
