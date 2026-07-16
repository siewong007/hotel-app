import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Promotion } from '../types';
import { PromotionCard } from './PromotionCard';

function buildPromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 17,
    slug: 'summer-stay',
    name: 'Summer stay',
    description: 'Save on a relaxing stay.',
    terms: 'Subject to availability.',
    status: 'published',
    promotion_kind: 'deal',
    discount_type: 'percentage',
    discount_value: 15,
    max_discount_amount: null,
    currency: 'USD',
    claim_starts_at: null,
    claim_ends_at: null,
    stay_starts_on: null,
    stay_ends_on: null,
    min_nights: null,
    max_nights: null,
    min_subtotal: null,
    claim_limit: null,
    claimed_count: 0,
    per_guest_limit: 1,
    is_public: true,
    room_type_ids: [],
    version: 1,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

describe('PromotionCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('labels a public deal and directs a visitor to sign in before claiming', () => {
    const onSignIn = vi.fn();

    render(<PromotionCard promotion={buildPromotion()} onSignIn={onSignIn} />);

    expect(screen.getByText('Deal')).toBeTruthy();
    expect(screen.getByText('15% off')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to claim' }));

    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('labels a voucher and allows an eligible portal guest to claim it', () => {
    const onClaim = vi.fn();

    render(
      <PromotionCard
        promotion={buildPromotion({ promotion_kind: 'voucher', name: 'Welcome voucher' })}
        isPortal
        canClaim
        onClaim={onClaim}
      />
    );

    expect(screen.getByText('Voucher')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Claim deal' }));

    expect(onClaim).toHaveBeenCalledOnce();
  });

  it('makes a claimed or in-progress offer unavailable to another click', () => {
    const onClaim = vi.fn();
    const { rerender } = render(
      <PromotionCard promotion={buildPromotion()} isPortal canClaim hasVoucher onClaim={onClaim} />
    );

    const claimedButton = screen.getByRole('button', { name: 'Already claimed' });
    expect((claimedButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Claimed')).toBeTruthy();
    fireEvent.click(claimedButton);
    expect(onClaim).not.toHaveBeenCalled();

    rerender(
      <PromotionCard promotion={buildPromotion()} isPortal canClaim isClaiming onClaim={onClaim} />
    );

    const claimingButton = screen.getByRole('button', { name: 'Claiming…' });
    expect((claimingButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server-supplied reason when a guest cannot claim yet', () => {
    render(
      <PromotionCard
        promotion={buildPromotion()}
        isPortal
        claimUnavailableReason="This offer is not available until tomorrow."
      />
    );

    expect((screen.getByRole('button', { name: 'Claim deal' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByText('This offer is not available until tomorrow.')).toBeTruthy();
  });
});
