/**
 * Factories for TanStack Query-shaped hook returns, so a page's data hooks
 * can be `vi.mock`d with realistic settled/loading/error states without
 * hand-writing the same `{ data, isPending, error }` literal in every file.
 */
import { vi } from 'vitest';

export function queryData<T>(data: T) {
  return {
    data,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

export function queryLoading() {
  return {
    data: undefined,
    isPending: true,
    isLoading: true,
    isFetching: true,
    isSuccess: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

export function queryError(error: Error) {
  return {
    data: undefined,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isSuccess: false,
    isError: true,
    error,
    refetch: vi.fn(),
  };
}

export function mutationIdle() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  };
}

/** `useInfiniteQuery`-shaped result for list pages that paginate. */
export function infiniteQueryData<T>(items: T[]) {
  return {
    data: { pages: [items], pageParams: [undefined] },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isSuccess: true,
    isError: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
}
