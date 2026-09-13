export interface ValidationErrors {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  alt_phone?: string;
  ic_number?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardName?: string;
}

// Company option for autocomplete
export interface CompanyOption {
  id?: number;
  inputValue?: string;
  company_name: string;
  registration_number?: string;
  company_registration_number?: string; // Alias for backwards compatibility
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  payment_terms_days?: number;
  isNew?: boolean;
}
