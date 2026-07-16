import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Voucher } from '../types';
import { VoucherCard } from './VoucherCard';

function buildVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 41,
    promotion_id: 17,
    promotion_name: 'Summer stay',
    promotion_slug: 'summer-stay',
    code: 'SUMMER-2026',
    code_masked: 'SUMM••2026',
    status: 'available',
    source: 'guest_claim',
    expires_at: '2999-01-01T00:00:00Z',
    claimed_at: '2026-07-16T00:00:00Z',
    redeemed_at: null,
    revoked_at: null,
    created_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

describe('VoucherCard', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows an available voucher code and copies the unmasked code', async () => {
    writeText.mockResolvedValue(undefined);
    render(<VoucherCard voucher={buildVoucher()} />);

    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByText('SUMMER-2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /copy code/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SUMMER-2026'));
  });

  it('uses the masked code without a copy control when the raw code is unavailable', () => {
    render(<VoucherCard voucher={buildVoucher({ code: undefined, status: 'redeemed' })} />);

    expect(screen.getByText('SUMM••2026')).toBeTruthy();
    expect(screen.getByText('Redeemed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy code/i })).toBeNull();
  });

  it('shows an expired label for an otherwise available expired voucher', () => {
    render(<VoucherCard voucher={buildVoucher({ expires_at: '2000-01-01T00:00:00Z' })} />);

    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('keeps the revoked status distinct from expiry', () => {
    render(
      <VoucherCard
        voucher={buildVoucher({
          status: 'revoked',
          expires_at: '2999-01-01T00:00:00Z',
          code: undefined,
        })}
      />
    );

    expect(screen.getByText('Revoked')).toBeTruthy();
    expect(screen.queryByText('Expired')).toBeNull();
  });
});
