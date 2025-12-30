// Room-related type definitions
import type { BookingWithDetails } from './booking.types';

export interface Room {
  id: string; // UUID
  room_number: string;
  room_type: string;
  price_per_night: number | string;
  available: boolean;
  description?: string;
  max_occupancy: number;
  average_rating?: number;
  review_count?: number;
  status?: string;
  floor?: number;
  // Status metadata fields
  reserved_start_date?: string;
  reserved_end_date?: string;
  maintenance_start_date?: string;
  maintenance_end_date?: string;
  cleaning_start_date?: string;
  cleaning_end_date?: string;
  target_room_id?: string;
  status_notes?: string;
}

export interface RoomWithDisplay extends Room {
  displayPrice: string;
  availabilityText: string;
}

export interface RoomEvent {
  id: string;
  room_id: string;
  event_type: 'reserve' | 'booking' | 'cleaning' | 'maintenance' | 'inspection' | 'repair' | 'status_change';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  notes?: string;
  scheduled_date?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RoomEventInput {
  event_type: 'reserved' | 'cleaning' | 'maintenance';
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  notes?: string;
  scheduled_date?: string;
}

export interface RoomStatusUpdateInput {
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved' | 'dirty';
  notes?: string;
  reserved_start_date?: string;
  reserved_end_date?: string;
  maintenance_start_date?: string;
  maintenance_end_date?: string;
  cleaning_start_date?: string;
  cleaning_end_date?: string;
  target_room_id?: string;
  guest_id?: string;
  booking_id?: string;
  reward_id?: string;
}

export interface RoomDetailedStatus {
  id: string;
  room_number: string;
  room_type: string;
  status: string;
  available: boolean;
  current_booking?: BookingWithDetails;
  next_booking?: BookingWithDetails;
  recent_events: RoomEvent[];
  maintenance_notes?: string;
  last_maintenance_date?: string;
  next_maintenance_date?: string;
  reserved_start_date?: string;
  reserved_end_date?: string;
  maintenance_start_date?: string;
  maintenance_end_date?: string;
  cleaning_start_date?: string;
  cleaning_end_date?: string;
  target_room_id?: string;
  status_notes?: string;
}

export interface RoomHistory {
  id: string;
  room_id: string;
  from_status?: string;
  to_status: string;
  booking_id?: string;
  guest_id?: string;
  guest_name?: string;
  reward_id?: string;
  reward_name?: string;
  start_date?: string;
  end_date?: string;
  target_room_id?: string;
  target_room_number?: string;
  changed_by?: string;
  changed_by_name?: string;
  created_at: string;
  notes?: string;
  is_auto_generated?: boolean;
}

// ==================== OCCUPANCY TYPES ====================
// Automatic occupancy derived from bookings - no manual input required

/** Current occupancy status for a room (derived from active bookings) */
export interface RoomCurrentOccupancy {
  room_id: number;
  room_number: string;
  room_type_id?: number;
  room_type_name?: string;
  max_occupancy?: number;
  room_status?: string;
  current_adults: number;
  current_children: number;
  current_infants: number;
  current_total_guests: number;
  occupancy_percentage?: number;
  current_booking_id?: number;
  current_booking_number?: string;
  current_guest_id?: number;
  check_in_date?: string;
  check_out_date?: string;
  is_occupied: boolean;
}

/** Hotel-wide occupancy summary (calculated automatically) */
export interface HotelOccupancySummary {
  total_rooms: number;
  occupied_rooms: number;
  available_rooms: number;
  occupancy_rate?: number;
  total_adults: number;
  total_children: number;
  total_infants: number;
  total_guests: number;
  total_capacity: number;
  guest_occupancy_rate?: number;
}

/** Occupancy breakdown by room type */
export interface OccupancyByRoomType {
  room_type_id?: number;
  room_type_name?: string;
  capacity_per_room?: number;
  total_rooms: number;
  occupied_rooms: number;
  room_occupancy_rate?: number;
  total_guests: number;
  total_capacity: number;
  guest_occupancy_rate?: number;
}

/** Room with occupancy data combined */
export interface RoomWithOccupancy extends Room {
  current_adults: number;
  current_children: number;
  current_infants: number;
  current_total_guests: number;
  is_occupied: boolean;
  current_booking_id?: number;
  current_guest_id?: number;
}
