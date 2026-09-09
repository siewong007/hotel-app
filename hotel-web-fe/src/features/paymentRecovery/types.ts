/** Shape returned by `GET /api/booking/recover-payment/{token}`. */
export interface PaymentRecoveryView {
  booking_number: string;
  amount_due: string;
  currency: string;
  expires_at: string;
  payment_methods: string[];
  /** Public PayPal client id; null when this deployment has no PayPal set up. */
  paypal_client_id: string | null;
  /** The payment this link already raised, if any; needed to attach evidence. */
  payment_id: number | null;
  /** Server's verdict on whether that payment still accepts evidence. */
  receipt_uploadable: boolean;
  /** True once the link has been spent; the page then shows the outcome. */
  already_submitted: boolean;
}
