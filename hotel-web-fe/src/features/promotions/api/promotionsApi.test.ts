import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

import { PromotionsApi } from './promotionsApi';

function jsonResponse<T>(value: T) {
  return { json: vi.fn().mockResolvedValue(value) };
}

function latestSearchParams(mock: ReturnType<typeof vi.fn>): URLSearchParams {
  const call = mock.mock.calls[mock.mock.calls.length - 1];
  return call[1].searchParams as URLSearchParams;
}

describe('PromotionsApi', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
  });

  it('serializes meaningful public-catalogue filters and omits empty values', async () => {
    get.mockReturnValue(jsonResponse({ items: [], total: 0, page: 2, page_size: 25 }));

    await PromotionsApi.listPublic({
      page: 2,
      page_size: 25,
      search: 'summer',
      status: 'published',
      promotion_kind: 'voucher',
    });

    expect(get).toHaveBeenCalledWith('promotions', expect.anything());
    expect(Object.fromEntries(latestSearchParams(get))).toEqual({
      page: '2',
      page_size: '25',
      search: 'summer',
      status: 'published',
      promotion_kind: 'voucher',
    });

    get.mockReturnValue(jsonResponse({ items: [], total: 0, page: 1, page_size: 50 }));
    await PromotionsApi.listPublic({ search: '', status: undefined });
    expect(Object.fromEntries(latestSearchParams(get))).toEqual({});
  });

  it('uses the management endpoints and preserves optimistic version data', async () => {
    const created = { id: 17 };
    post.mockReturnValue(jsonResponse(created));
    put.mockReturnValue(jsonResponse(created));

    await PromotionsApi.create({
      slug: 'summer-stay',
      name: 'Summer stay',
      promotion_kind: 'voucher',
      discount_type: 'percentage',
      discount_value: 15,
      currency: 'USD',
      per_guest_limit: 1,
      is_public: true,
      room_type_ids: [],
    });
    await PromotionsApi.update(17, { name: 'Updated summer stay', expected_version: 4 });
    await PromotionsApi.transition(17, 'publish', { expected_version: 4 });

    expect(post).toHaveBeenNthCalledWith(1, 'admin/promotions', {
      json: expect.objectContaining({ slug: 'summer-stay', per_guest_limit: 1 }),
    });
    expect(put).toHaveBeenCalledWith('admin/promotions/17', {
      json: { name: 'Updated summer stay', expected_version: 4 },
    });
    expect(post).toHaveBeenNthCalledWith(2, 'admin/promotions/17/publish', {
      json: { expected_version: 4 },
    });
  });

  it('forwards voucher filters and issue/revoke payloads to their admin endpoints', async () => {
    get.mockReturnValue(jsonResponse({ items: [], total: 0, page: 1, page_size: 50 }));
    post.mockReturnValue(jsonResponse({ id: 9 }));

    await PromotionsApi.listVouchers({
      page: 1,
      page_size: 50,
      search: 'SUMMER',
      status: 'available',
      promotion_id: 17,
      guest_id: 22,
    });
    await PromotionsApi.issueVoucher({ promotion_id: 17, guest_id: 22, code: 'SUMMER-22' });
    await PromotionsApi.revokeVoucher(9, { reason: 'Requested by guest' });

    expect(get).toHaveBeenCalledWith('admin/vouchers', expect.anything());
    expect(Object.fromEntries(latestSearchParams(get))).toEqual({
      page: '1',
      page_size: '50',
      search: 'SUMMER',
      status: 'available',
      promotion_id: '17',
      guest_id: '22',
    });
    expect(post).toHaveBeenNthCalledWith(1, 'admin/vouchers', {
      json: { promotion_id: 17, guest_id: 22, code: 'SUMMER-22' },
    });
    expect(post).toHaveBeenNthCalledWith(2, 'admin/vouchers/9/revoke', {
      json: { reason: 'Requested by guest' },
    });
  });
});
