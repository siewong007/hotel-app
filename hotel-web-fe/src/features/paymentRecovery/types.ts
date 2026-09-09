/** Shape returned by `GET /api/booking/recover-payment/{token}`. */
export interface PaymentRecoveryView {
  booking_number: string;
  amount_due: string;
  currency: string;
  expires_at: string;
  payment_methods: string[];
  /** Public PayPal client id; null when this deployment has no PayPal set up. */
  paypal_client_id: string | null;
  /** True once the link has been spent; the page then shows the outcome. */
  already_submitted: boolean;
}
