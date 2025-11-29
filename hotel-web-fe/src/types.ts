// Type definitions matching the Rust backend models

export interface Room {
  id: string; // UUID
  room_number: string;
  room_type: string;
  price_per_night: number | string; // Can be Decimal from backend
  available: boolean;
  description?: string;
  max_occupancy: number;
}

export interface Guest {
  id: string; // UUID
  name: string;
  email: string;
  phone?: string;
  address?: string;
}

export interface Booking {
  id: string; // UUID
  guest_id: string;
  room_id: string;
  check_in: string;
  check_out: string;
  total_price: number | string;
  status: string;
}

export interface GuestCreateRequest {
  name: string;
  email: string;
}

export interface BookingCreateRequest {
  guest_id: string; // UUID
  room_id: string; // UUID
  check_in: string;
  check_out: string;
}

export interface SearchQuery {
  room_type?: string;
  max_price?: number;
}

// Extended types for UI display
export interface RoomWithDisplay extends Room {
  displayPrice: string;
  availabilityText: string;
}

export interface BookingWithDetails extends Booking {
  checkInDate: string;
  checkOutDate: string;
  guestName?: string;
  roomType?: string;
}

// RBAC Types
export interface Role {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description?: string;
  created_at: string;
}

export interface RoleInput {
  name: string;
  description?: string;
}

export interface PermissionInput {
  name: string;
  resource: string;
  action: string;
  description?: string;
}

export interface AssignRoleInput {
  user_id: string;
  role_id: string;
}

export interface AssignPermissionInput {
  role_id: string;
  permission_id: string;
}

export interface RoleWithPermissions {
  role: Role;
  permissions: Permission[];
}

export interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserWithRolesAndPermissions {
  user: User;
  roles: Role[];
  permissions: Permission[];
}