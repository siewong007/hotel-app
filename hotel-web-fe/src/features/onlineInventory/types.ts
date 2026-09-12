export interface OnlineInventoryAllocation {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  stay_date: string;
  physical_available_rooms: number;
  walk_in_reserved_rooms: number;
  online_booking_enabled: boolean;
  custom_price: string | null;
  standard_price: string;
  is_override: boolean;
  online_available_rooms: number;
}

export interface EditableCell {
  walk_in_reserved_rooms: number;
  online_booking_enabled: boolean;
  custom_price: string | null;
}

export type StagedEdit = { type: 'set'; value: EditableCell } | { type: 'reset' };

export type CellKey = string; // `${room_type_id}:${stay_date}`

export interface GridCellView {
  key: CellKey;
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  stay_date: string;
  physical: number;
  saved: EditableCell;
  current: EditableCell;
  standard_price: string;
  effective_price: string;
  online_available: number;
  changed: boolean;
  is_reset: boolean;
  is_override: boolean;
}

export interface CellUpdateInput {
  room_type_id: number;
  stay_date: string;
  reset?: boolean;
  walk_in_reserved_rooms?: number;
  online_booking_enabled?: boolean;
  custom_price?: string | null;
}
