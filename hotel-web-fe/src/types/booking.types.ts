// Booking-related type definitions
import type { GuestUpdateRequest } from './guest.types';

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CHECKED_IN = 'checked_in',
  CHECKED_OUT = 'checked_out',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
  AUTO_CHECKED_IN = 'auto_checked_in',
  LATE_CHECKOUT = 'late_checkout'
}

export interface Booking {
  id: string;
  guest_id: string;
  room_id: string;
  room_type?: string;
  check_in_date: string;
  check_out_date: string;
  total_amount: number | string;
  status: BookingStatus | string;
  folio_number?: string;
  post_type?: 'normal_stay' | 'same_day';
  rate_code?: string;
  is_tourist?: boolean;
  tourism_tax_amount?: number | string;
  extra_bed_count?: number;
  extra_bed_charge?: number | string;
  room_card_deposit?: number | string;
  late_checkout_penalty?: number | string;
  payment_method?: string;
  market_code?: string;
  discount_percentage?: number;
  rate_override_weekday?: number;
  rate_override_weekend?: number;
  check_in_time?: string;
  check_out_time?: string;
  pre_checkin_completed?: boolean;
  pre_checkin_completed_at?: string;
  created_at?: string;
  updated_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  special_requests?: string;
  number_of_guests?: number;
}

export interface BookingWithDetails extends Booking {
  guest_name: string;
  guest_email: string;
  guest_phone?: string;
  room_number: string;
  room_type: string;
  room_type_code?: string;
  price_per_night: number | string;
  number_of_nights?: number;
  formatted_check_in?: string;
  formatted_check_out?: string;
  formatted_total?: string;
  is_active?: boolean;
  can_cancel?: boolean;
  can_modify?: boolean;
  is_tourist?: boolean;
  tourism_tax_amount?: number | string;
  extra_bed_count?: number;
  extra_bed_charge?: number | string;
  room_card_deposit?: number | string;
  late_checkout_penalty?: number | string;
  payment_method?: string;
}

export interface BookingCreateRequest {
  guest_id: number;
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  post_type?: 'normal_stay' | 'same_day';
  rate_code?: string;
  booking_remarks?: string;
  special_requests?: string;
  number_of_guests?: number;
  is_tourist?: boolean;
  tourism_tax_amount?: number;
  extra_bed_count?: number;
  extra_bed_charge?: number;
  room_card_deposit?: number;
  late_checkout_penalty?: number;
  payment_method?: string;
}

export interface BookingUpdateRequest {
  room_id?: string;
  check_in_date?: string;
  check_out_date?: string;
  status?: string;
  post_type?: string;
  rate_code?: string;
  booking_remarks?: string;
  market_code?: string;
  discount_percentage?: number;
  rate_override_weekday?: number;
  rate_override_weekend?: number;
  check_in_time?: string;
  check_out_time?: string;
  payment_method?: string;
  special_requests?: string;
  number_of_guests?: number;
  cancellation_reason?: string;
}

export interface BookingCancellationRequest {
  booking_id: string;
  reason?: string;
}

export interface CheckInRequest {
  guest_update?: GuestUpdateRequest;
  booking_update?: BookingUpdateRequest;
  checkin_notes?: string;
}

export interface PreCheckInUpdateRequest {
  guest_update: GuestUpdateRequest;
  market_code?: string;
  special_requests?: string;
}

export interface RateCodesResponse {
  rate_codes: string[];
}

export interface MarketCodesResponse {
  market_codes: string[];
}
