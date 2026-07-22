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

export interface PaymentWorkflowSummary {
  booking_id: number;
  booking_status: string;
  payment_status: string;
  total_amount: number | string;
  total_paid: number | string;
  total_refunded: number | string;
  balance_due: number | string;
  deposit_collected: number | string;
  deposit_refunded: number | string;
  has_failed_payment: boolean;
  next_action: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Guest-portal payments (bank-transfer claim + PayPal) — mirrors
// hotel-app-be/src/models/payment.rs exactly (session, token, and staff
// review-queue contracts).
// ---------------------------------------------------------------------------

/** Hotel bank-transfer display details for the manual guest payment path. */
export interface GuestPaymentBankDetails {
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
}

/** Public payment configuration served by `GET /guest-portal/payment-config`. */
export interface GuestPaymentConfig {
  paypal_enabled: boolean;
  paypal_client_id: string | null;
  bank_details: GuestPaymentBankDetails;
}

/** Generic acknowledgement returned by the guest payment mutation endpoints. */
export interface PaymentActionResponse {
  payment_id: number;
  status: string;
  booking_status: string | null;
}

/** Response from the PayPal create-order endpoints (session and token flows). */
export interface PaypalCreateOrderResponse {
  order_id: string;
  payment_id: number;
}

/** A single pending bank-transfer/PayPal claim in the staff review queue. */
export interface PendingPaymentEntry {
  id: number;
  booking_id: number;
  booking_number: string | null;
  guest_id: number | null;
  guest_name: string | null;
  amount: string;
  payment_method: string;
  status: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

/** Paginated wrapper for `GET /admin/payments/pending`. */
export interface PendingPaymentPage {
  items: PendingPaymentEntry[];
  total: number;
}
