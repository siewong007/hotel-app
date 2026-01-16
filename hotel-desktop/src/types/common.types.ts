// Common shared types and utilities

export interface SearchQuery {
  room_type?: string;
  max_price?: number;
  check_in_date?: string;
  check_out_date?: string;
  [key: string]: string | number | undefined;
}

export interface BookingValidation {
  isValid: boolean;
  errors: string[];
}
