import { describe, expect, it } from 'vitest';
import { canRejectPaymentClaim, hasPaymentReceipt } from './paymentApprovals';

describe('canRejectPaymentClaim', () => {
  it('allows rejection while the booking is still awaiting payment', () => {
    for (const status of ['pending', 'pending_payment', 'pending_confirmation']) {
      expect(canRejectPaymentClaim(status)).toBe(true);
    }
  });

  it('refuses rejection once staff moved the booking on by hand', () => {
    for (const status of ['confirmed', 'checked_in', 'auto_checked_in', 'checked_out', 'voided']) {
      expect(canRejectPaymentClaim(status)).toBe(false);
    }
  });

  it('keeps rejection available when the status is unknown', () => {
    expect(canRejectPaymentClaim(undefined)).toBe(true);
    expect(canRejectPaymentClaim(null)).toBe(true);
  });
});

describe('hasPaymentReceipt', () => {
  it('treats an uploaded or stored receipt as present', () => {
    expect(hasPaymentReceipt({ receipt_uploaded: true, receipt_file_available: false })).toBe(true);
    expect(hasPaymentReceipt({ receipt_uploaded: false, receipt_file_available: true })).toBe(true);
    expect(hasPaymentReceipt({ receipt_uploaded: false, receipt_file_available: false })).toBe(false);
  });
});
