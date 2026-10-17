export type PriceField = 'base_price' | 'weekday_rate' | 'weekend_rate';
export type PriceMethod = 'set_exact' | 'percent' | 'amount';

export const PRICE_FIELDS: PriceField[] = ['base_price', 'weekday_rate', 'weekend_rate'];
export const ROUND_STEPS = [1, 5, 10] as const;

export interface BulkPriceRequest {
  /** Empty means every room type. */
  room_type_ids: number[];
  fields: PriceField[];
  method: PriceMethod;
  value: number;
  round_to?: number | null;
  reason?: string;
  confirm_large_change?: boolean;
}

export interface FieldChange {
  field: PriceField;
  old_price: string;
  new_price: string;
  delta: string;
  delta_percent: string | null;
  changed: boolean;
  large: boolean;
}

export interface RoomTypePriceChange {
  room_type_id: number;
  code: string;
  name: string;
  changes: FieldChange[];
  changed: boolean;
}

export interface BulkPricePreview {
  rows: RoomTypePriceChange[];
  changed_room_types: number;
  changed_fields: number;
  requires_confirmation: boolean;
  large_change_percent: number;
}

export interface BulkPriceResult {
  batch_id: string;
  preview: BulkPricePreview;
}

export interface LastBulkPriceChange {
  batch_id: string;
  action: 'room_prices_bulk_updated' | 'room_prices_bulk_reverted';
  user_id: number | null;
  username: string | null;
  created_at: string;
  reason: string | null;
  room_types: number;
  can_revert: boolean;
}
