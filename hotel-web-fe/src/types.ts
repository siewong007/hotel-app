// Type definitions matching the Rust backend models

export interface Room {
  id: string; // UUID
  room_number: string;
  room_type: string;
  price_per_night: number | string; // Can be Decimal from backend
  available: boolean;
  description?: string;
  max_occupancy: number;
  average_rating?: number;
  review_count?: number;
}

export interface Guest {
  id: string; // UUID
  full_name: string;
  email: string;
  phone?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
}

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CHECKED_IN = 'checked_in',
  CHECKED_OUT = 'checked_out',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show'
}

export interface Booking {
  id: string; // UUID
  guest_id: string;
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  total_amount: number | string;
  status: BookingStatus | string;
  folio_number?: string;
  post_type?: 'normal_stay' | 'same_day';
  rate_code?: string;
  created_at?: string;
  updated_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  special_requests?: string;
  number_of_guests?: number;
}

export interface GuestCreateRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
}

export interface BookingCreateRequest {
  guest_id: string; // UUID
  room_id: string; // UUID
  check_in_date: string;
  check_out_date: string;
  post_type?: 'normal_stay' | 'same_day';
  rate_code?: string;
  special_requests?: string;
  number_of_guests?: number;
}

export interface BookingUpdateRequest {
  check_in_date?: string;
  check_out_date?: string;
  status?: BookingStatus | string;
  special_requests?: string;
  number_of_guests?: number;
  cancellation_reason?: string;
}

export interface BookingValidation {
  isValid: boolean;
  errors: string[];
}

export interface BookingCancellationRequest {
  booking_id: string;
  reason?: string;
}

export interface SearchQuery {
  room_type?: string;
  max_price?: number;
  [key: string]: string | number | undefined;
}

// Extended types for UI display
export interface RoomWithDisplay extends Room {
  displayPrice: string;
  availabilityText: string;
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

// Loyalty Program Types
export interface LoyaltyProgram {
  id: number;
  name: string;
  description?: string;
  tier_level: number;
  points_multiplier: number;
  minimum_points_required: number;
  benefits?: any;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyMembership {
  id: number;
  guest_id: number;
  program_id: number;
  membership_number: string;
  points_balance: number;
  lifetime_points: number;
  tier_level: number;
  status: 'active' | 'inactive' | 'suspended' | 'expired';
  enrolled_date: string;
  expiry_date?: string;
  last_points_activity?: string;
  created_at: string;
  updated_at: string;
}

export interface PointsTransaction {
  id: string;
  membership_id: number;
  transaction_type: 'earn' | 'redeem' | 'expire' | 'adjust';
  points_amount: number;
  balance_after: number;
  reference_type?: string;
  reference_id?: number;
  description?: string;
  expires_at?: string;
  created_at: string;
  created_by?: number;
}

export interface LoyaltyMembershipWithDetails extends LoyaltyMembership {
  guest_name: string;
  guest_email: string;
  program_name: string;
  program_description?: string;
  points_multiplier: number;
}

export interface LoyaltyStatistics {
  total_members: number;
  active_members: number;
  members_by_tier: {
    tier_level: number;
    tier_name: string;
    count: number;
    percentage: number;
  }[];
  total_points_issued: number;
  total_points_redeemed: number;
  total_points_active: number;
  average_points_per_member: number;
  top_members: {
    guest_name: string;
    guest_email: string;
    points_balance: number;
    lifetime_points: number;
    tier_level: number;
    membership_number: string;
  }[];
  recent_transactions: {
    id: string;
    guest_name: string;
    transaction_type: string;
    points_amount: number;
    description?: string;
    created_at: string;
  }[];
  membership_growth: {
    date: string;
    new_members: number;
    total_members: number;
  }[];
  points_activity: {
    date: string;
    points_earned: number;
    points_redeemed: number;
  }[];
}

// User Loyalty Types
export interface TierInfo {
  tier_level: number;
  tier_name: string;
  minimum_points: number;
  benefits: string[];
  points_multiplier: number;
}

export interface UserLoyaltyMembership {
  id: number;
  membership_number: string;
  points_balance: number;
  lifetime_points: number;
  tier_level: number;
  tier_name: string;
  status: string;
  enrolled_date: string;
  expiry_date?: string;
  next_tier?: TierInfo;
  current_tier_benefits: string[];
  points_to_next_tier?: number;
  recent_transactions: PointsTransaction[];
}

export interface LoyaltyReward {
  id: number;
  name: string;
  description?: string;
  category: 'room_upgrade' | 'service' | 'discount' | 'gift' | 'dining' | 'spa' | 'experience';
  points_cost: number;
  monetary_value?: number;
  minimum_tier_level: number;
  is_active: boolean;
  stock_quantity?: number;
  image_url?: string;
  terms_conditions?: string;
  created_at: string;
  updated_at: string;
}

export interface RedeemRewardInput {
  reward_id: number;
  booking_id?: number;
  notes?: string;
}

// User Profile Types
export interface UserProfile {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  phone?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface UserProfileUpdate {
  full_name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
}

export interface PasswordUpdate {
  current_password: string;
  new_password: string;
}

export interface PasskeyInfo {
  id: string; // UUID
  credential_id: string;
  device_name?: string;
  created_at: string;
  last_used_at?: string;
}

export interface PasskeyUpdateInput {
  device_name: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
  roles: string[];
  permissions: string[];
  is_first_login: boolean;
}

// Rewards Management Types
export interface RewardInput {
  name: string;
  description?: string;
  category: string;
  points_cost: number;
  monetary_value?: number;
  minimum_tier_level: number;
  stock_quantity?: number;
  image_url?: string;
  terms_conditions?: string;
}

export interface RewardUpdateInput {
  name?: string;
  description?: string;
  category?: string;
  points_cost?: number;
  monetary_value?: number;
  minimum_tier_level?: number;
  is_active?: boolean;
  stock_quantity?: number;
  image_url?: string;
  terms_conditions?: string;
}

export interface RewardRedemption {
  id: number;
  guest_name: string;
  guest_email: string;
  reward_name: string;
  category: string;
  points_spent: number;
  redeemed_at: string;
  status: string;
}