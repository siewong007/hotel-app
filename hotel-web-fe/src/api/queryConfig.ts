import type { DefaultOptions } from '@tanstack/react-query';

export const queryStaleTime = {
  realtime: 15_000,
  short: 30_000,
  standard: 60_000,
  long: 5 * 60_000,
  static: 10 * 60_000,
} as const;

export const queryGcTime = {
  standard: 15 * 60_000,
  long: 30 * 60_000,
} as const;

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const maybeError = error as {
    statusCode?: number;
    response?: { status?: number };
  };
  return maybeError.statusCode ?? maybeError.response?.status;
}

export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 1) return false;
  const status = getErrorStatus(error);
  return status != null && transientStatuses.has(status);
}

export function getQueryErrorMessage(error: unknown, fallback = 'Request failed') {
  if (!error) return null;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object') {
    const maybeError = error as {
      message?: string;
      details?: { error?: string; message?: string };
      response?: { data?: { error?: string; message?: string } };
    };
    return (
      maybeError.details?.error ||
      maybeError.details?.message ||
      maybeError.response?.data?.error ||
      maybeError.response?.data?.message ||
      maybeError.message ||
      fallback
    );
  }
  return fallback;
}

export const defaultQueryOptions: DefaultOptions = {
  queries: {
    staleTime: queryStaleTime.standard,
    gcTime: queryGcTime.standard,
    retry: shouldRetryQuery,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
  },
  mutations: {
    retry: false,
  },
};
