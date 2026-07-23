export interface OnlineInventoryAllocation {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  stay_date: string;
  physical_available_rooms: number;
  walk_in_reserved_rooms: number;
  online_booking_enabled: boolean;
  custom_price: string | null;
  online_available_rooms: number;
}

export interface UpdateOnlineInventoryInput {
  walk_in_reserved_rooms: number;
  online_booking_enabled: boolean;
  custom_price: string | null;
}
