export type CheckoutPaymentStatus = 'completed' | 'refunded' | 'failed' | 'pending' | string;

export interface CheckoutPaymentRecord {
  id: number;
  payment_status: CheckoutPaymentStatus;
  total_amount?: number | string | null;
  payment_method?: string | null;
  transaction_reference?: string | null;
  notes?: string | null;
  payment_date?: string | null;
  created_at?: string | null;
}
