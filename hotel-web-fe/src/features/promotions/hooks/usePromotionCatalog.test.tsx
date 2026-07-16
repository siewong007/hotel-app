import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../api/queryKeys';
import { portalSessionScope } from '../utils';

const listPublic = vi.fn();
const listPromotions = vi.fn();
const claim = vi.fn();
const listVouchers = vi.fn();

vi.mock('../api/promotionsApi', () => ({
  PromotionsApi: {
    listPublic: (...args: unknown[]) => listPublic(...args),
  },
}));

vi.mock('../api/portalPromotionsApi', () => ({
  PortalPromotionsApi: {
    claim: (...args: unknown[]) => claim(...args),
    listPromotions: (...args: unknown[]) => listPromotions(...args),
    listVouchers: (...args: unknown[]) => listVouchers(...args),
  },
}));

import {
  useClaimPromotion,
  useGuestPromotionCatalog,
  usePromotionCatalog,
} from './usePromotionCatalog';
import { useVoucherWallet } from './useVoucherWallet';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('promotion query hooks', () => {
  beforeEach(() => {
    listPublic.mockReset();
    listPromotions.mockReset();
    claim.mockReset();
    listVouchers.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads public offers with the requested page and filter parameters', async () => {
    const response = { items: [], total: 0, page: 2, page_size: 25 };
    const params = { page: 2, page_size: 25, search: 'summer', promotion_kind: 'deal' as const };
    listPublic.mockResolvedValue(response);
    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(() => usePromotionCatalog(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listPublic).toHaveBeenCalledWith(params);
    expect(queryClient.getQueryData(queryKeys.promotions.publicCatalog(params))).toEqual(response);
  });

  it('scopes each guest catalogue and wallet to its portal token instead of a shared cache', async () => {
    const catalogue = { items: [], total: 0, page: 1, page_size: 50 };
    const wallet = { items: [], total: 0, page: 1, page_size: 50 };
    const params = { page: 1, page_size: 50 };
    listPromotions.mockResolvedValue(catalogue);
    listVouchers.mockResolvedValue(wallet);
    const { queryClient, wrapper } = createWrapper();
    const token = 'guest-token-a';
    const scope = portalSessionScope(token);

    const { result: catalogueResult } = renderHook(
      () => useGuestPromotionCatalog(token, params),
      { wrapper }
    );
    const { result: walletResult } = renderHook(() => useVoucherWallet(token, params), { wrapper });

    await waitFor(() => expect(catalogueResult.current.isSuccess).toBe(true));
    await waitFor(() => expect(walletResult.current.isSuccess).toBe(true));
    expect(listPromotions).toHaveBeenCalledWith(params, token);
    expect(listVouchers).toHaveBeenCalledWith(params, token);
    expect(queryClient.getQueryData(queryKeys.promotions.portalCatalog(scope, params))).toEqual(catalogue);
    expect(queryClient.getQueryData(queryKeys.promotions.portalVouchers(scope, params))).toEqual(wallet);
    expect(queryKeys.promotions.portalCatalog(scope, params)).not.toEqual(
      queryKeys.promotions.portalCatalog(portalSessionScope('guest-token-b'), params)
    );
  });

  it('does not query a guest catalogue without a portal token', async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useGuestPromotionCatalog(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(listPromotions).not.toHaveBeenCalled();
  });

  it('invalidates only the current guest portal promotion scope after a claim', async () => {
    const token = 'guest-token-a';
    claim.mockResolvedValue({ id: 17, code: 'WELCOME-17' });
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useClaimPromotion(token), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        promotionId: 17,
        input: { client_request_id: 'claim-17' },
      });
    });

    expect(claim).toHaveBeenCalledWith(17, { client_request_id: 'claim-17' }, token);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.promotions.portal(portalSessionScope(token)),
    });
  });
});
