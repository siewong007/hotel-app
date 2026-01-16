// Payment and Invoice type definitions

export interface Invoice {
  id: number;
  invoice_number: string;
  booking_id: number;
  payment_id?: number;
  user_id: number;
  invoice_date: string;
  due_date?: string;
  subtotal: number | string;
  service_charge: number | string;
  service_charge_percentage: number | string;
  tax_amount: number | string;
  tax_percentage: number | string;
  keycard_deposit: number | string;
  total_amount: number | string;
  line_items: any;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  customer_address?: string;
  room_number?: string;
  room_type?: string;
  check_in_date?: string;
  check_out_date?: string;
  number_of_nights?: number;
  status: string;
  pdf_generated: boolean;
  pdf_path?: string;
  pdf_generated_at?: string;
  notes?: string;
  terms_and_conditions?: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number | string;
  total: number | string;
}

export interface InvoicePreview {
  invoice: Invoice;
  payment?: any;
  booking_details: any;
}
