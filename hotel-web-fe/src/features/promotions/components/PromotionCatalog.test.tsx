import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestPromotion, Promotion } from '../types';

const navigate = vi.fn();
const mocks = vi.hoisted(() => ({
  claimMutation: {
    error: null as unknown,
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
    variables: undefined as { promotionId: number } | undefined,
  },
  guestCatalog: {
    data: undefined as unknown,
    error: null as unknown,
    isLoading: false,
  },
  publicCatalog: {
    data: undefined as unknown,
    error: null as unknown,
    isLoading: false,
  },
  useClaimPromotion: vi.fn(),
  useGuestPromotionCatalog: vi.fn(),
  usePromotionCatalog: vi.fn(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('../hooks/usePromotionCatalog', () => ({
  useClaimPromotion: (...args: unknown[]) => mocks.useClaimPromotion(...args),
  useGuestPromotionCatalog: (...args: unknown[]) => mocks.useGuestPromotionCatalog(...args),
  usePromotionCatalog: (...args: unknown[]) => mocks.usePromotionCatalog(...args),
}));

import { PromotionCatalog } from './PromotionCatalog';

function buildPromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 17,
    slug: 'summer-stay',
    name: 'Summer stay',
    description: null,
    terms: null,
    status: 'published',
    promotion_kind: 'voucher',
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

function buildGuestPromotion(overrides: Partial<GuestPromotion> = {}): GuestPromotion {
  return {
    promotion: buildPromotion(),
    can_claim: true,
    has_voucher: false,
    claim_unavailable_reason: null,
    ...overrides,
  };
}

function resetCatalogMocks() {
  navigate.mockReset();
  mocks.usePromotionCatalog.mockReset();
  mocks.useGuestPromotionCatalog.mockReset();
  mocks.useClaimPromotion.mockReset();
  mocks.claimMutation.error = null;
  mocks.claimMutation.isPending = false;
  mocks.claimMutation.mutate.mockReset();
  mocks.claimMutation.reset.mockReset();
  mocks.claimMutation.variables = undefined;
  mocks.guestCatalog.data = undefined;
  mocks.guestCatalog.error = null;
  mocks.guestCatalog.isLoading = false;
  mocks.publicCatalog.data = undefined;
  mocks.publicCatalog.error = null;
  mocks.publicCatalog.isLoading = false;
  mocks.usePromotionCatalog.mockReturnValue(mocks.publicCatalog);
  mocks.useGuestPromotionCatalog.mockReturnValue(mocks.guestCatalog);
  mocks.useClaimPromotion.mockReturnValue(mocks.claimMutation);
}

describe('PromotionCatalog', () => {
  beforeEach(() => {
    resetCatalogMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('uses the public catalogue for a visitor and routes them to guest sign-in', () => {
    mocks.publicCatalog.data = {
      items: [buildPromotion({ promotion_kind: 'deal' })],
      total: 1,
      page: 1,
      page_size: 50,
    };

    render(<PromotionCatalog />);

    expect(mocks.usePromotionCatalog).toHaveBeenCalledWith({ page: 1, page_size: 50 }, true);
    expect(mocks.useGuestPromotionCatalog).toHaveBeenCalledWith(
      undefined,
      { page: 1, page_size: 50 },
      false
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to claim' }));
    expect(navigate).toHaveBeenCalledWith('/portal/login');
  });

  it('claims an eligible portal promotion and confirms the issued voucher code', async () => {
    const entry = buildGuestPromotion();
    mocks.guestCatalog.data = { items: [entry], total: 1, page: 1, page_size: 50 };
    mocks.claimMutation.mutate.mockImplementation(
      (_variables: unknown, options?: { onSuccess?: (voucher: { code?: string }) => void }) => {
        options?.onSuccess?.({ code: 'WELCOME-17' });
      }
    );

    render(<PromotionCatalog token="guest-session-token" />);

    expect(mocks.usePromotionCatalog).toHaveBeenCalledWith({ page: 1, page_size: 50 }, false);
    expect(mocks.useGuestPromotionCatalog).toHaveBeenCalledWith(
      'guest-session-token',
      { page: 1, page_size: 50 },
      true
    );
    fireEvent.click(screen.getByRole('button', { name: 'Claim deal' }));

    expect(mocks.claimMutation.reset).toHaveBeenCalledOnce();
    expect(mocks.claimMutation.mutate).toHaveBeenCalledWith(
      {
        promotionId: entry.promotion.id,
        input: { client_request_id: expect.any(String) },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    await waitFor(() =>
      expect(
        screen.getByText('Summer stay is now in My Vouchers. Code: WELCOME-17')
      ).toBeTruthy()
    );
  });

  it('shows catalogue and claim errors without replacing an already loaded catalogue', () => {
    mocks.publicCatalog.error = new Error('Offers service is unavailable');
    const { rerender } = render(<PromotionCatalog />);

    expect(screen.getByText('Offers service is unavailable')).toBeTruthy();

    mocks.publicCatalog.error = null;
    mocks.guestCatalog.data = { items: [buildGuestPromotion()], total: 1, page: 1, page_size: 50 };
    mocks.claimMutation.error = new Error('This offer has already been claimed');
    rerender(<PromotionCatalog token="guest-session-token" />);

    expect(screen.getByText('This offer has already been claimed')).toBeTruthy();
    expect(screen.getByText('Summer stay')).toBeTruthy();
  });

  it('renders useful loading and empty states for the active catalogue only', () => {
    mocks.guestCatalog.isLoading = true;
    const { rerender } = render(<PromotionCatalog token="guest-session-token" />);

    expect(screen.getByRole('progressbar')).toBeTruthy();

    mocks.guestCatalog.isLoading = false;
    mocks.guestCatalog.data = { items: [], total: 0, page: 1, page_size: 50 };
    rerender(<PromotionCatalog token="guest-session-token" />);

    expect(screen.getByText('No offers are available right now')).toBeTruthy();
  });
});
