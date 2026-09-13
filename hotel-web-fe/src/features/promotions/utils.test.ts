import { describe, expect, it } from 'vitest';
import type { Promotion, Voucher } from './types';
import {
  formatCurrencyAmount,
  guestDisplayName,
  promotionClaimIssue,
  relativeExpiryLabel,
  voucherDisplayStatus,
  voucherSourceLabel,
} from './utils';

const NOW = new Date('2026-09-13T12:00:00Z').getTime();

const baseVoucher: Voucher = {
  id: 1,
  promotion_id: 2,
  promotion_name: 'Offer',
  promotion_slug: 'offer',
  code_masked: '••••AB12',
  status: 'available',
  source: 'admin_issue',
  is_cancellable: true,
  guest_id: 9,
  expires_at: null,
  created_at: '2026-09-01T00:00:00Z',
};

describe('voucherDisplayStatus', () => {
  it('flags expired only for available vouchers past expiry', () => {
    expect(
      voucherDisplayStatus(
        { ...baseVoucher, expires_at: '2026-09-12T12:00:00Z' },
        NOW,
      ),
    ).toBe('expired');
    expect(
      voucherDisplayStatus(
        {
          ...baseVoucher,
          status: 'redeemed',
          expires_at: '2026-09-12T12:00:00Z',
        },
        NOW,
      ),
    ).toBe('redeemed');
    expect(
      voucherDisplayStatus(
        { ...baseVoucher, expires_at: '2026-09-20T12:00:00Z' },
        NOW,
      ),
    ).toBe('available');
    expect(voucherDisplayStatus(baseVoucher, NOW)).toBe('available');
  });
});

describe('relativeExpiryLabel', () => {
  it('describes missing, past, today, and future expiries', () => {
    expect(relativeExpiryLabel(null, NOW)).toBe('No expiry');
    expect(relativeExpiryLabel('2026-09-10T12:00:00Z', NOW)).toBe('Expired 3d ago');
    expect(relativeExpiryLabel('2026-09-13T06:00:00Z', NOW)).toBe('Expired today');
    expect(relativeExpiryLabel('2026-09-13T18:00:00Z', NOW)).toBe('Expires today');
    expect(relativeExpiryLabel('2026-09-16T12:00:00Z', NOW)).toBe('Expires in 3d');
  });
});

describe('voucherSourceLabel', () => {
  it('maps known sources and humanizes unknowns', () => {
    expect(voucherSourceLabel('guest_claim')).toBe('Guest claim');
    expect(voucherSourceLabel('admin_issue')).toBe('Issued by staff');
    expect(voucherSourceLabel('partner_api')).toBe('Partner Api');
  });
});

describe('promotionClaimIssue', () => {
  const published: Promotion = {
    id: 1,
    slug: 'x',
    name: 'X',
    status: 'published',
    promotion_kind: 'voucher',
    discount_type: 'percentage',
    discount_value: 10,
    currency: 'USD',
    claimed_count: 0,
    per_guest_limit: 1,
    is_public: true,
    room_type_ids: [],
    version: 1,
    created_at: '',
    updated_at: '',
  };

  it('returns a reason for unpublished, unopened, closed, and exhausted offers', () => {
    expect(promotionClaimIssue({ ...published, status: 'draft' }, NOW)).toBe(
      'Not published',
    );
    expect(
      promotionClaimIssue(
        { ...published, claim_starts_at: '2026-09-14T00:00:00Z' },
        NOW,
      ),
    ).toBe('Claims not open yet');
    expect(
      promotionClaimIssue(
        { ...published, claim_ends_at: '2026-09-12T00:00:00Z' },
        NOW,
      ),
    ).toBe('Claim window closed');
    expect(
      promotionClaimIssue(
        { ...published, claim_limit: 5, claimed_count: 5 },
        NOW,
      ),
    ).toBe('Claim limit reached');
    expect(promotionClaimIssue(published, NOW)).toBeNull();
  });
});

describe('guestDisplayName', () => {
  it('prefers the guest name and falls back to the id', () => {
    expect(guestDisplayName({ ...baseVoucher, guest_name: 'Aisha' })).toBe(
      'Aisha',
    );
    expect(guestDisplayName({ ...baseVoucher, guest_name: '  ' })).toBe(
      'Guest #9',
    );
    expect(guestDisplayName(baseVoucher)).toBe('Guest #9');
    expect(
      guestDisplayName({ ...baseVoucher, guest_id: null }),
    ).toBe('—');
  });
});

describe('formatCurrencyAmount', () => {
  it('formats with the given currency', () => {
    expect(formatCurrencyAmount(1234.5, 'USD')).toContain('1,234');
  });
});
