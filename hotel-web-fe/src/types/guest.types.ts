// Guest-related type definitions

export interface Guest {
  id: number;
  full_name: string;
  email: string;
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
  created_at: string;
  updated_at: string;
}

export interface GuestCreateRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  ic_number?: string;
  nationality?: string;
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  is_active?: boolean;
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
}
