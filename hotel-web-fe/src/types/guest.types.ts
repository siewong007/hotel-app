// Guest-related type definitions

// Guest membership types for pricing differentiation
export type GuestType = 'member' | 'non_member';

export interface Guest {
  id: number;
  full_name: string;
  email?: string;
  phone?: string;
  ic_number?: string;
  nationality?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  title?: string;
  alt_phone?: string;
  is_active: boolean;
  guest_type: GuestType; // Member or non-member for pricing differentiation
  discount_percentage?: number; // Member discount percentage (e.g., 10 for 10% off)
  complimentary_nights_credit: number; // Unused complimentary nights that can be used on future bookings
  created_at: string;
  updated_at: string;
}

export interface GuestCreateRequest {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  ic_number?: string;
  nationality?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  is_active?: boolean;
  guest_type?: GuestType;
  discount_percentage?: number;
}

export interface GuestUpdateRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  ic_number?: string;
  nationality?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  title?: string;
  alt_phone?: string;
  is_active?: boolean;
  guest_type?: GuestType;
  discount_percentage?: number;
}

// Guest type display configuration
export const GUEST_TYPE_CONFIG: Record<GuestType, { label: string; color: string; discountLabel: string }> = {
  member: { label: 'Member', color: '#2e7d32', discountLabel: 'Member Discount' },
  non_member: { label: 'Non-Member', color: '#757575', discountLabel: 'Standard Rate' },
};
