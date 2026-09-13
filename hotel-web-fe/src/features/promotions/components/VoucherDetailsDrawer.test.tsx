import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Promotion, Voucher } from '../types';

const voucherFixture: Voucher = {
  id: 11,
  promotion_id: 2,
  promotion_name: 'Stay longer',
  promotion_slug: 'stay-longer',
  code_masked: '••••AB12',
  status: 'available',
  source: 'admin_issue',
  is_cancellable: true,
  guest_id: 9,
  guest_name: 'Aisha',
  expires_at: '2099-01-01T00:00:00Z',
  claimed_at: '2026-09-01T10:00:00Z',
  created_at: '2026-09-01T10:00:00Z',
};

const promotionFixture: Promotion = {
  id: 2,
  slug: 'stay-longer',
  name: 'Stay longer',
  status: 'published',
  promotion_kind: 'voucher',
  discount_type: 'percentage',
  discount_value: 15,
  currency: 'USD',
  claimed_count: 3,
  claim_limit: 50,
  per_guest_limit: 1,
  is_public: true,
  room_type_ids: [],
  version: 4,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const useAdminVoucherMock = vi.fn();
const useAdminPromotionMock = vi.fn();

vi.mock('../hooks/usePromotionAdmin', () => ({
  useAdminVoucher: (id: number | null, enabled?: boolean) =>
    useAdminVoucherMock(id, enabled),
  useAdminPromotion: (id: number | null, enabled?: boolean) =>
    useAdminPromotionMock(id, enabled),
}));

vi.mock('../../rooms/hooks', () => ({
  useAllRoomTypes: () => ({ data: [] }),
}));

import { VoucherDetailsDrawer } from './VoucherDetailsDrawer';

function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof VoucherDetailsDrawer>> = {},
) {
  const props = {
    voucherId: 11,
    open: true,
    canManage: true,
    isRevoking: false,
    onClose: vi.fn(),
    onRevoke: vi.fn(),
    ...overrides,
  };
  render(<VoucherDetailsDrawer {...props} />);
  return props;
}

describe('VoucherDetailsDrawer', () => {
  afterEach(() => cleanup());

  it('renders code, status, lifecycle, and offer rules', () => {
    useAdminVoucherMock.mockReturnValue({
      data: voucherFixture,
      isLoading: false,
      error: null,
    });
    useAdminPromotionMock.mockReturnValue({
      data: promotionFixture,
      isLoading: false,
    });
    renderDrawer();
    expect(screen.getByText('••••AB12')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByText('Aisha')).toBeTruthy();
    expect(screen.getByText('Stay longer')).toBeTruthy();
    expect(screen.getByText(/15% off/)).toBeTruthy();
    expect(screen.getAllByText('Issued').length).toBeGreaterThan(0);
    expect(screen.getByText('Expires')).toBeTruthy();
  });

  it('hides revoke for redeemed vouchers', () => {
    useAdminVoucherMock.mockReturnValue({
      data: {
        ...voucherFixture,
        status: 'redeemed',
        redeemed_at: '2026-09-05T00:00:00Z',
      },
      isLoading: false,
      error: null,
    });
    useAdminPromotionMock.mockReturnValue({
      data: promotionFixture,
      isLoading: false,
    });
    renderDrawer();
    expect(
      screen.queryByRole('button', { name: 'Revoke voucher' }),
    ).toBeNull();
  });

  it('captures a reason and revokes through the inline panel', () => {
    useAdminVoucherMock.mockReturnValue({
      data: voucherFixture,
      isLoading: false,
      error: null,
    });
    useAdminPromotionMock.mockReturnValue({
      data: promotionFixture,
      isLoading: false,
    });
    const { onRevoke } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke voucher' }));
    fireEvent.change(screen.getByLabelText('Reason (optional)'), {
      target: { value: 'Duplicate issue' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(onRevoke).toHaveBeenCalledWith(11, '••••AB12', 'Duplicate issue');
  });
});
