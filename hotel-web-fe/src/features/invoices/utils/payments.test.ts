import { describe, expect, it } from 'vitest';

import type { CheckoutPaymentRecord } from '../types';
import { isDepositLikePayment, settledPaymentsTotal } from './payments';

// Regression coverage for the deposit-checkout-guard incident: the modal used
// to sum EVERY completed payment into the balance, so a held deposit read as
// bill settlement and produced a false "Overpayment"/"Fully Paid". These
// helpers mirror the backend total_paid predicate
// (services/payments.rs: payment_type NOT IN ('refund','deposit','deposit_forfeited')).

const row = (overrides: Partial<CheckoutPaymentRecord>): CheckoutPaymentRecord => ({
  id: 1,
  payment_status: 'completed',
  total_amount: 0,
  ...overrides,
});

describe('isDepositLikePayment', () => {
  it('flags deposit and deposit_forfeited rows regardless of casing', () => {
    expect(isDepositLikePayment(row({ payment_type: 'deposit' }))).toBe(true);
    expect(isDepositLikePayment(row({ payment_type: 'deposit_forfeited' }))).toBe(true);
    expect(isDepositLikePayment(row({ payment_type: 'DEPOSIT' }))).toBe(true);
  });

  it('does not flag ordinary bill payments or refund rows', () => {
    expect(isDepositLikePayment(row({ payment_type: 'booking' }))).toBe(false);
    expect(isDepositLikePayment(row({ payment_type: 'service' }))).toBe(false);
    expect(isDepositLikePayment(row({ payment_type: 'refund' }))).toBe(false);
    expect(isDepositLikePayment(row({ payment_type: null }))).toBe(false);
    expect(isDepositLikePayment(row({ payment_type: undefined }))).toBe(false);
  });
});

describe('settledPaymentsTotal', () => {
  it('counts a full bill payment but not a held deposit on the same folio', () => {
    const total = settledPaymentsTotal([
      row({ id: 1, payment_type: 'deposit', total_amount: 50 }),
      row({ id: 2, payment_type: 'booking', total_amount: 100 }),
    ]);

    expect(total).toBe(100);
  });

  it('excludes deposit_forfeited rows too — forfeited money is kept, not bill settlement', () => {
    const total = settledPaymentsTotal([
      row({ id: 1, payment_type: 'deposit', total_amount: 50 }),
      row({ id: 2, payment_type: 'deposit_forfeited', total_amount: 50 }),
      row({ id: 3, payment_type: 'booking', total_amount: 100 }),
    ]);

    expect(total).toBe(100);
  });

  it('ignores non-completed rows (refunded, void, pending) of any type', () => {
    const total = settledPaymentsTotal([
      row({ id: 1, payment_type: 'refund', payment_status: 'refunded', total_amount: 50 }),
      row({ id: 2, payment_type: 'booking', payment_status: 'void', total_amount: 100 }),
      row({ id: 3, payment_type: 'booking', payment_status: 'pending', total_amount: 100 }),
      row({ id: 4, payment_type: 'booking', payment_status: 'completed', total_amount: 100 }),
    ]);

    expect(total).toBe(100);
  });

  it('sums string amounts with cent-safe money math', () => {
    const total = settledPaymentsTotal([
      row({ id: 1, payment_type: 'booking', total_amount: '33.33' }),
      row({ id: 2, payment_type: 'booking', total_amount: '66.67' }),
      row({ id: 3, payment_type: 'deposit', total_amount: '50.00' }),
    ]);

    expect(total).toBe(100);
  });
});
