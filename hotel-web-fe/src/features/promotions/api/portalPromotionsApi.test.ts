import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const getPortalToken = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

vi.mock('../../guestPortal/api/portalTokenStore', () => ({
  getPortalToken: () => getPortalToken(),
}));

import { PortalPromotionsApi } from './portalPromotionsApi';

function jsonResponse<T>(value: T) {
  return { json: vi.fn().mockResolvedValue(value) };
}

function latestSearchParams(): URLSearchParams {
  const call = get.mock.calls[get.mock.calls.length - 1];
  return call[1].searchParams as URLSearchParams;
}

describe('PortalPromotionsApi', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    getPortalToken.mockReset();
  });

  it('uses the explicit guest token and bounded catalogue filters', async () => {
    get.mockReturnValue(jsonResponse({ items: [], total: 0, page: 2, page_size: 25 }));

    await PortalPromotionsApi.listPromotions(
      { page: 2, page_size: 25, search: 'summer', promotion_kind: 'voucher' },
      'guest-token-a'
    );

    expect(get).toHaveBeenCalledWith('guest-portal/me/promotions', {
      headers: { Authorization: 'Bearer guest-token-a' },
      searchParams: expect.any(URLSearchParams),
    });
    expect(Object.fromEntries(latestSearchParams())).toEqual({
      page: '2',
      page_size: '25',
      search: 'summer',
      promotion_kind: 'voucher',
    });
    expect(getPortalToken).not.toHaveBeenCalled();
  });

  it('falls back to the stored guest token for wallet reads and omits empty filters', async () => {
    getPortalToken.mockReturnValue('stored-guest-token');
    get.mockReturnValue(jsonResponse({ items: [], total: 0, page: 1, page_size: 50 }));

    await PortalPromotionsApi.listVouchers({ page: 1, page_size: 50, search: '', status: undefined });

    expect(get).toHaveBeenCalledWith('guest-portal/me/vouchers', {
      headers: { Authorization: 'Bearer stored-guest-token' },
      searchParams: expect.any(URLSearchParams),
    });
    expect(Object.fromEntries(latestSearchParams())).toEqual({ page: '1', page_size: '50' });
  });

  it('does not make an unauthenticated guest-portal request', () => {
    getPortalToken.mockReturnValue(null);

    expect(() => PortalPromotionsApi.listPromotions()).toThrow(
      'Sign in to the guest portal to continue'
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('sends a claim request to the promotion-specific guest endpoint', async () => {
    post.mockReturnValue(jsonResponse({ id: 31, code: 'WELCOME-31' }));

    await PortalPromotionsApi.claim(31, { client_request_id: 'claim-31' }, 'guest-token-a');

    expect(post).toHaveBeenCalledWith('guest-portal/me/promotions/31/claim', {
      headers: { Authorization: 'Bearer guest-token-a' },
      json: { client_request_id: 'claim-31' },
    });
  });
});
