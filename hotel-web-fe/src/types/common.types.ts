// Common shared types and utilities

export interface SearchQuery {
  room_type?: string;
  max_price?: number;
  [key: string]: string | number | undefined;
}

export interface BookingValidation {
  isValid: boolean;
  errors: string[];
}
