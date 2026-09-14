import { sumMoney } from '../../../utils/money';
import type { CheckoutPaymentRecord } from '../types';

// Deposit-type rows carry collected money but are not bill settlement:
// `deposit` is held collateral owed back to the guest, and `deposit_forfeited`
// is income kept by the hotel. The backend's total_paid excludes both
// (services/payments.rs: payment_type NOT IN ('refund','deposit','deposit_forfeited')),
// and the checkout modal must match that predicate exactly — counting a held
// deposit as a bill payment is what produced the false "Overpayment" incident.
const DEPOSIT_LIKE_TYPES = ['deposit', 'deposit_forfeited'];

export const isDepositLikePayment = (payment: CheckoutPaymentRecord): boolean =>
  DEPOSIT_LIKE_TYPES.includes((payment.payment_type || '').toLowerCase());

// Sum of completed payments that actually settle the bill — the frontend
// mirror of the backend total_paid.
export const settledPaymentsTotal = (payments: CheckoutPaymentRecord[]): number =>
  sumMoney(
    payments
      .filter((p) => p.payment_status === 'completed' && !isDepositLikePayment(p))
      .map((p) => p.total_amount),
  );
