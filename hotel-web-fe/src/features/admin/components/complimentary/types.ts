export interface GuestCredit {
  guest_id: number;
  guest_name: string;
  email: string | null;
  room_type_id: number;
  room_type_name: string;
  room_type_code: string | null;
  nights_available: number;
  reason?: string | null;
  notes: string | null;
}

export interface ComplimentarySummary {
  total_complimentary_bookings: number;
  total_complimentary_nights: number;
  total_credits_available: number;
  value_of_complimentary_nights: string;
}

export type SortField = 'created_at' | 'guest_name' | 'room_number' | 'complimentary_nights' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface GuestOption {
  id: number;
  nick_name: string;
  email?: string;
}

export interface RoomTypeOption {
  id: number;
  name: string;
  code?: string;
}
