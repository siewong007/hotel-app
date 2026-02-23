// Guest-related type definitions

// Guest membership types for pricing differentiation
export type GuestType = 'member' | 'non_member';

// Tourism type for tourism tax calculation
// Local: No tourism tax charged
// Foreign: Tourism tax charged per night
export type TourismType = 'local' | 'foreign';

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
  tourism_type?: TourismType; // Local or foreign tourism for tax calculation
  discount_percentage?: number; // Member discount percentage (e.g., 10 for 10% off)
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
  tourism_type?: TourismType;
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
  tourism_type?: TourismType;
  discount_percentage?: number;
}

// Guest type display configuration
export const GUEST_TYPE_CONFIG: Record<GuestType, { label: string; color: string; discountLabel: string }> = {
  member: { label: 'Member', color: '#2e7d32', discountLabel: 'Member Discount' },
  non_member: { label: 'Non-Member', color: '#757575', discountLabel: 'Standard Rate' },
};

// Tourism type display configuration
export const TOURISM_TYPE_CONFIG: Record<TourismType, { label: string; color: string; taxLabel: string }> = {
  local: { label: 'Local', color: '#1976d2', taxLabel: 'No Tourism Tax' },
  foreign: { label: 'Foreign', color: '#ed6c02', taxLabel: 'Tourism Tax Applies' },
};
