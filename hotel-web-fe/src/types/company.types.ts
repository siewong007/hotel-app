// Company type definitions

export interface Company {
  id: number;
  company_name: string;
  registration_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  is_active: boolean;
  credit_limit?: number;
  payment_terms_days?: number;
  notes?: string;
  created_by?: number;
  created_at: string;
  updated_at: string;
}

export interface CompanyCreateRequest {
  company_name: string;
  registration_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  credit_limit?: number;
  payment_terms_days?: number;
  notes?: string;
}

export interface CompanyUpdateRequest {
  company_name?: string;
  registration_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  is_active?: boolean;
  credit_limit?: number;
  payment_terms_days?: number;
  notes?: string;
}
