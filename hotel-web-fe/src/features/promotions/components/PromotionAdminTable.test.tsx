import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Promotion } from '../types';
import { PromotionAdminTable } from './PromotionAdminTable';

function buildPromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 7,
    slug: 'summer-stay',
    name: 'Summer stay',
    description: null,
    terms: null,
    status: 'draft',
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
    claim_limit: 50,
    claimed_count: 3,
    per_guest_limit: 1,
    is_public: true,
    room_type_ids: [],
    version: 9,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

function renderTable(overrides: Partial<React.ComponentProps<typeof PromotionAdminTable>> = {}) {
  const onEdit = vi.fn();
  const onTransition = vi.fn();
  render(
    <PromotionAdminTable
      promotions={[buildPromotion()]}
      total={1}
      page={0}
      pageSize={25}
      isLoading={false}
      canManage
      isTransitioning={false}
      onEdit={onEdit}
      onTransition={onTransition}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
      {...overrides}
    />
  );
  return { onEdit, onTransition };
}

describe('PromotionAdminTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows a read-only promotion row without administrative actions', () => {
    renderTable({ canManage: false });

    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('offers the correct lifecycle transitions for a draft and sends the selected promotion', () => {
    const promotion = buildPromotion();
    const { onEdit, onTransition } = renderTable({ promotions: [promotion] });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(onEdit).toHaveBeenCalledWith(promotion);
    expect(onTransition).toHaveBeenNthCalledWith(1, promotion, 'publish');
    expect(onTransition).toHaveBeenNthCalledWith(2, promotion, 'archive');
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('offers pause instead of publish for published promotions and locks transitions while saving', () => {
    const promotion = buildPromotion({ status: 'published' });
    const { onTransition } = renderTable({ promotions: [promotion], isTransitioning: true });

    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    const pause = screen.getByRole('button', { name: 'Pause' }) as HTMLButtonElement;
    const archive = screen.getByRole('button', { name: 'Archive' }) as HTMLButtonElement;
    expect(pause.disabled).toBe(true);
    expect(archive.disabled).toBe(true);

    fireEvent.click(pause);
    expect(onTransition).not.toHaveBeenCalled();
  });
});
