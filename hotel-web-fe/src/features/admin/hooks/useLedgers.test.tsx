// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// Mock the HotelAPIService barrel the hook calls into, following the shared
// hook-test mocking convention.
const getCustomerLedgers = vi.fn();
const getLedgersPage = vi.fn();

vi.mock('../../../api', () => ({
  HotelAPIService: {
    getCustomerLedgers: (...args: any[]) => getCustomerLedgers(...args),
    getLedgersPage: (...args: any[]) => getLedgersPage(...args),
  },
}));

import { useLedgers, useLedgersPage } from './useLedgers';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateQueries };
}

describe('useLedgers', () => {
  beforeEach(() => {
    getCustomerLedgers.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads the full ledger list and exposes a combined loading flag', async () => {
    const ledgers = [{ id: 1, company_name: 'Acme Corp' }];
    getCustomerLedgers.mockResolvedValue(ledgers);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useLedgers(), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ledgers).toEqual(ledgers);
    expect(result.current.error).toBeNull();
  });

  it('defaults to an empty array (edge case) rather than undefined before data arrives / on empty response', async () => {
    getCustomerLedgers.mockResolvedValue([]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useLedgers(), { wrapper });

    expect(result.current.ledgers).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ledgers).toEqual([]);
  });

  it('surfaces the query error message and reload() clears it before refetching', async () => {
    getCustomerLedgers.mockRejectedValueOnce(new Error('network down'));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useLedgers(), { wrapper });

    await waitFor(() => expect(result.current.error).toBe('network down'));

    // Not "Once": reload() both invalidates (which triggers an implicit
    // active-query refetch) and then explicitly calls refetch() itself, so
    // the queryFn can run more than once here — every call must see the
    // same recovered data.
    getCustomerLedgers.mockResolvedValue([{ id: 2, company_name: 'Beta Ltd' }]);
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.ledgers).toEqual([{ id: 2, company_name: 'Beta Ltd' }]);
  });

  it('reload() invalidates the ledgers cache before refetching (loadLedgers is the same function)', async () => {
    getCustomerLedgers.mockResolvedValue([]);
    const { wrapper, invalidateQueries } = createWrapper();

    const { result } = renderHook(() => useLedgers(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loadLedgers).toBe(result.current.reload);

    await act(async () => {
      await result.current.reload();
    });

    expect(invalidateQueries).toHaveBeenCalled();
  });
});

describe('useLedgersPage', () => {
  beforeEach(() => {
    getLedgersPage.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('forwards paging/filter params to the API and returns the page', async () => {
    const page = { items: [], total: 0 };
    getLedgersPage.mockResolvedValue(page);
    const { wrapper } = createWrapper();
    const params = { page: 2, page_size: 25 } as any;

    const { result } = renderHook(() => useLedgersPage(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getLedgersPage).toHaveBeenCalledWith(params);
    expect(result.current.data).toEqual(page);
  });

  it('does not fetch when disabled', () => {
    const { wrapper } = createWrapper();
    renderHook(() => useLedgersPage(undefined, false), { wrapper });
    expect(getLedgersPage).not.toHaveBeenCalled();
  });
});
