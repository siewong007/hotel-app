import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../api/queryKeys';
import type { Promotion, PromotionListResponse } from '../types';

const transition = vi.fn();

vi.mock('../api/promotionsApi', () => ({
  PromotionsApi: {
    transition: (...args: unknown[]) => transition(...args),
  },
}));

import { usePromotionTransition } from './usePromotionAdmin';

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

const publishedPromotion = {
  id: 4,
  name: 'Direct booking offer',
  status: 'published',
  version: 2,
} as Promotion;

describe('usePromotionTransition', () => {
  beforeEach(() => {
    transition.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('puts the returned status and version into every cached admin list immediately', async () => {
    const params = { page: 1, page_size: 25 };
    const cachedDraft = {
      ...publishedPromotion,
      status: 'draft',
      version: 1,
    } as Promotion;
    const cachedList: PromotionListResponse = {
      items: [cachedDraft],
      total: 1,
      page: 1,
      page_size: 25,
    };
    transition.mockResolvedValue(publishedPromotion);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(queryKeys.promotions.adminList(params), cachedList);
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue();

    const { result } = renderHook(() => usePromotionTransition(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        promotionId: 4,
        action: 'publish',
        expectedVersion: 1,
      });
    });

    expect(transition).toHaveBeenCalledWith(4, 'publish', {
      expected_version: 1,
    });
    expect(
      queryClient.getQueryData<PromotionListResponse>(
        queryKeys.promotions.adminList(params)
      )?.items[0]
    ).toEqual(publishedPromotion);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.promotions.all,
    });
  });
});
