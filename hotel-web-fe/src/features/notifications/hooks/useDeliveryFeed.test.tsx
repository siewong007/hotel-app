// @vitest-environment jsdom
// The delivery feed must not be requested for staff without
// `communications:read`: the endpoint answers 403, and the API client turns
// every refusal into a "no permission" toast and notification-center entry,
// once per poll, on every page that shows the bell.
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const listDeliveries = vi.fn();

vi.mock('../api', () => ({
  listDeliveries: (...args: unknown[]) => listDeliveries(...args),
}));

import { useDeliveryFeed } from './useDeliveryFeed';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useDeliveryFeed', () => {
  afterEach(() => {
    listDeliveries.mockReset();
  });

  it('never requests the feed when the caller may not read it', async () => {
    const { result } = renderHook(() => useDeliveryFeed({ tier: 'all' }, false, true), {
      wrapper: createWrapper(),
    });
    // Give a would-be request every chance to start before checking.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listDeliveries).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('requests a page of ten when the caller may read it', async () => {
    listDeliveries.mockResolvedValue({ items: [], total: 0, unread: 0, page: 1, page_size: 10 });
    const { result } = renderHook(() => useDeliveryFeed({ tier: 'marketing' }, true, false), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listDeliveries).toHaveBeenCalledTimes(1);
    expect(listDeliveries.mock.calls[0][0]).toEqual({ page_size: 10, tier: 'marketing' });
  });
});
