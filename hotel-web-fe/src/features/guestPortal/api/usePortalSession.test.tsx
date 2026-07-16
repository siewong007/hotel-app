import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../api/queryKeys';
import { portalSessionScope } from '../../promotions/utils';
import { getPortalToken, setPortalToken } from './portalTokenStore';

const navigate = vi.fn();

vi.mock('../../../router', () => ({
  useNavigate: () => navigate,
}));

import { usePortalSession } from './usePortalSession';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function createQueryClientWrapper(queryClient: QueryClient) {
  return function QueryClientWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('usePortalSession', () => {
  beforeEach(() => {
    navigate.mockReset();
    window.sessionStorage.clear();
  });

  it('exposes a valid guest portal session', () => {
    setPortalToken('guest-token', '2999-01-01T00:00:00Z');
    const queryClient = createQueryClient();

    const { result } = renderHook(() => usePortalSession(), {
      wrapper: createQueryClientWrapper(queryClient),
    });

    expect(result.current.token).toBe('guest-token');
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('does not authenticate an expired stored portal token', () => {
    setPortalToken('expired-token', '2000-01-01T00:00:00Z');
    const queryClient = createQueryClient();

    const { result } = renderHook(() => usePortalSession(), {
      wrapper: createQueryClientWrapper(queryClient),
    });

    expect(result.current.token).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(getPortalToken()).toBeNull();
  });

  it('clears the guest token and returns to portal sign-in on logout', () => {
    setPortalToken('guest-token', '2999-01-01T00:00:00Z');
    const queryClient = createQueryClient();
    const sessionScope = portalSessionScope('guest-token');
    const portalCatalogKey = queryKeys.promotions.portalCatalog(sessionScope, {
      page: 1,
      page_size: 50,
    });
    const portalVoucherKey = queryKeys.promotions.portalVouchers(sessionScope, {
      page: 1,
      page_size: 50,
    });
    queryClient.setQueryData(portalCatalogKey, { items: [] });
    queryClient.setQueryData(portalVoucherKey, { items: [] });

    const { result } = renderHook(() => usePortalSession(), {
      wrapper: createQueryClientWrapper(queryClient),
    });

    act(() => result.current.logout());

    expect(getPortalToken()).toBeNull();
    expect(queryClient.getQueryData(portalCatalogKey)).toBeUndefined();
    expect(queryClient.getQueryData(portalVoucherKey)).toBeUndefined();
    expect(navigate).toHaveBeenCalledWith('/portal/login', { replace: true });
  });
});
