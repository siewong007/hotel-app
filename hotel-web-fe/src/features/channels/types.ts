/** Mirrors `modules/booking_channels/models.rs` — Decimal arrives as string. */

export interface BookingChannel {
  id: number;
  name: string;
  channel_type: string;
  default_commission_type: 'none' | 'percentage' | 'fixed_amount' | string;
  default_commission_value: string | number;
  default_commission_scope: 'per_booking' | 'per_night' | string;
  is_active: boolean;
  abbreviation?: string | null;
  code?: string | null;
  integration_mode: string;
  created_at: string;
  updated_at: string;
}

export interface BookingChannelInput {
  name: string;
  channel_type?: string;
  default_commission_type?: string;
  default_commission_value?: number;
  default_commission_scope?: string;
  is_active?: boolean;
  abbreviation?: string | null;
  code?: string | null;
  integration_mode?: string;
}

export type BookingChannelUpdate = Partial<BookingChannelInput>;

export type PricingRuleType =
  | 'markup_percent'
  | 'markup_fixed'
  | 'discount_percent'
  | 'fixed_price'
  | 'net_rate';

export interface ChannelPricingRule {
  id: number;
  channel_id: number;
  room_type_id: number | null;
  rate_plan_id: number | null;
  rule_type: PricingRuleType | string;
  value: string | number;
  effective_from: string;
  effective_to: string | null;
  min_price: string | number | null;
  max_price: string | number | null;
  priority: number;
  is_active: boolean;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelPricingRuleInput {
  room_type_id?: number | null;
  rate_plan_id?: number | null;
  rule_type: string;
  value: number;
  effective_from: string;
  effective_to?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  priority?: number;
  is_active?: boolean;
  reason?: string | null;
}

export interface PricingRuleResponse {
  rule: ChannelPricingRule;
  /** Human-readable warnings (e.g. overlapping same-scope rules). */
  warnings: string[];
}

export interface ChannelCommissionRule {
  id: number;
  channel_id: number;
  commission_type: 'percentage' | 'fixed_amount' | string;
  value: string | number;
  scope: 'per_booking' | 'per_night' | string;
  effective_from: string;
  effective_to: string | null;
  priority: number;
  is_active: boolean;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelCommissionRuleInput {
  commission_type: string;
  value: number;
  scope?: string;
  effective_from: string;
  effective_to?: string | null;
  priority?: number;
  is_active?: boolean;
  reason?: string | null;
}

export interface ChannelRoomTypeMapping {
  id: number;
  channel_id: number;
  room_type_id: number;
  room_type_name: string | null;
  external_room_id: string | null;
  external_room_name: string | null;
  is_enabled: boolean;
  sync_status: string | null;
  last_synced_at: string | null;
  updated_at: string;
}

export interface ChannelRatePlanMapping {
  id: number;
  channel_id: number;
  rate_plan_id: number;
  rate_plan_name: string | null;
  external_rate_plan_id: string | null;
  external_rate_plan_name: string | null;
  is_enabled: boolean;
  sync_status: string | null;
  last_synced_at: string | null;
  updated_at: string;
}

export interface ChannelMappings {
  room_types: ChannelRoomTypeMapping[];
  rate_plans: ChannelRatePlanMapping[];
}

export interface ChannelRoomTypeMappingInput {
  room_type_id: number;
  external_room_id?: string | null;
  external_room_name?: string | null;
  is_enabled?: boolean;
}

export interface ChannelRatePlanMappingInput {
  rate_plan_id: number;
  external_rate_plan_id?: string | null;
  external_rate_plan_name?: string | null;
  is_enabled?: boolean;
}

export interface ChannelPricePreviewRequest {
  channel_id: number;
  room_type_id: number;
  rate_plan_id?: number | null;
  check_in: string;
  check_out: string;
}

export interface NightlyChannelPrice {
  date: string;
  source_rate: string | number;
  selling_price: string | number | null;
  net_rate: string | number | null;
  rule_id: number | null;
  rule_label: string;
}

export interface ChannelPricePreview {
  channel_id: number;
  channel_name: string;
  room_type_id: number;
  room_type_name: string;
  rate_plan_id: number | null;
  check_in: string;
  check_out: string;
  currency: string;
  nights: NightlyChannelPrice[];
  selling_subtotal: string | number | null;
  commission_base: string | number;
  commission_type: string;
  commission_value: string | number;
  commission_scope: string;
  commission_amount: string | number | null;
  net_revenue: string | number | null;
}

export interface ChannelMatrixCell {
  channel_id: number;
  channel_name: string;
  channel_type: string;
  room_type_id: number;
  source_rate: string | number;
  selling_price: string | number | null;
  net_rate: string | number | null;
  rule_id: number | null;
  rule_label: string;
  commission_amount: string | number | null;
  net_revenue: string | number | null;
}

export interface ChannelMatrix {
  date: string;
  rate_plan_id: number | null;
  currency: string;
  cells: ChannelMatrixCell[];
}
