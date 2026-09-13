/** Rate-management domain types — mirror hotel-app-be models/rate.rs and
 * modules/revenue/models.rs. */

export interface RatePlan {
  id: number;
  name: string;
  code: string;
  description: string | null;
  plan_type: string;
  adjustment_type: string;
  adjustment_value: string | null;
  valid_from: string | null;
  valid_to: string | null;
  applies_monday: boolean;
  applies_tuesday: boolean;
  applies_wednesday: boolean;
  applies_thursday: boolean;
  applies_friday: boolean;
  applies_saturday: boolean;
  applies_sunday: boolean;
  min_nights: number;
  max_nights: number | null;
  min_advance_booking: number;
  max_advance_booking: number | null;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface RatePlanInput {
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
  /** Create-only: the API stores blackout dates but does not return them. */
  blackout_dates?: string[];
  is_active?: boolean;
  priority?: number;
}

export interface RoomRateWithDetails {
  id: number;
  rate_plan_id: number;
  rate_plan_name: string;
  rate_plan_code: string;
  room_type_id: number;
  room_type_name: string;
  room_type_code: string;
  price: string;
  effective_from: string;
  effective_to: string | null;
}

export interface RoomRate {
  id: number;
  rate_plan_id: number;
  room_type_id: number;
  price: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

export interface BulkRoomRateInput {
  rate_plan_id: number;
  room_type_ids: number[];
  effective_from: string;
  effective_to: string;
  price: number;
}

export interface RoomTypeRef {
  id: number;
  name: string;
  code: string;
  base_price: string;
}

export interface RatePlanWithRates {
  rate_plan: RatePlan;
  rates: RoomRateWithDetails[];
}

export interface RateCalendarRoomType {
  room_type_id: number;
  code: string;
  name: string;
}

export interface RateCalendarCell {
  room_type_id: number;
  stay_date: string;
  rate_plan_code: string;
  plan_rate: string;
  is_base_rate: boolean;
  custom_price: string | null;
  effective_rate: string;
  physical_rooms: number;
  sold_rooms: number;
  available_rooms: number;
  occupancy_pct: string;
  online_booking_enabled: boolean;
  walk_in_reserved_rooms: number;
}

export interface RateCalendar {
  from: string;
  to: string;
  room_types: RateCalendarRoomType[];
  cells: RateCalendarCell[];
}
