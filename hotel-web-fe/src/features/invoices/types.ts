export type CheckoutPaymentStatus = 'completed' | 'refunded' | 'failed' | 'pending' | string;

export interface CheckoutPaymentRecord {
  id: number;
  payment_status: CheckoutPaymentStatus;
  total_amount?: number | string | null;
  payment_method?: string | null;
  payment_type?: string | null;
  transaction_reference?: string | null;
  notes?: string | null;
  payment_date?: string | null;
  created_at?: string | null;
  /** Set on voided rows: the staff reason, when, and who voided it. */
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by_name?: string | null;
  /**
   * Business date the reversing night-audit line posts on when the void
   * landed after the payment's own day was closed; null otherwise.
   */
  void_reversal_date?: string | null;
  /** Staff who approved this guest payment claim, and when. */
  approved_by_name?: string | null;
  approved_at?: string | null;
}
