// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// Mock the api barrel the hook calls into (PaymentApprovalsService covers
// both the approval workflow and the narrow PayPal-conflict endpoint),
// following the shared hook-test mocking convention.
const listPending = vi.fn();
const approve = vi.fn();
const listHistory = vi.fn();
const reject = vi.fn();
const requestReceipt = vi.fn();
const paypalConflicts = vi.fn();

vi.mock('../../../api', () => ({
  PaymentApprovalsService: {
    listPending: (...args: any[]) => listPending(...args),
    approve: (...args: any[]) => approve(...args),
    listHistory: (...args: any[]) => listHistory(...args),
    reject: (...args: any[]) => reject(...args),
    requestReceipt: (...args: any[]) => requestReceipt(...args),
    paypalConflicts: (...args: any[]) => paypalConflicts(...args),
  },
}));

import { queryKeys } from '../../../api/queryKeys';
import {
  usePendingPayments,
  useApprovePayment,
  usePaymentApprovalHistory,
  useRejectPayment,
  usePaypalConflictEvents,
  useRequestPaymentReceipt,
} from './usePaymentApprovalsQueries';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateQueries };
}

describe('usePendingPayments', () => {
  beforeEach(() => listPending.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('fetches the review queue with the default page/pageSize', async () => {
    const page = { items: [], total: 0 };
    listPending.mockResolvedValue(page);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePendingPayments(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listPending).toHaveBeenCalledWith({ page: 1, perPage: 25 });
    expect(result.current.data).toEqual(page);
  });

  it('forwards a custom page/pageSize filter', async () => {
    listPending.mockResolvedValue({ items: [], total: 0 });
    const { wrapper } = createWrapper();

    renderHook(() => usePendingPayments({ page: 3, pageSize: 10 }), { wrapper });

    await waitFor(() => expect(listPending).toHaveBeenCalledWith({ page: 3, perPage: 10 }));
  });
});

describe('useApprovePayment', () => {
  beforeEach(() => approve.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('approves the payment (completes it + confirms the booking) and invalidates every dependent query', async () => {
    approve.mockResolvedValue({ payment_id: 42, status: 'completed', booking_status: 'confirmed' });
    const { wrapper, invalidateQueries } = createWrapper();
    const { result } = renderHook(() => useApprovePayment(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(42);
    });

    expect(approve).toHaveBeenCalledWith(42);
    // Approving money in flight must refresh the queue itself plus every
    // surface that shows booking/ledger/dashboard state derived from it.
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.paymentApprovals.all }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.bookings.all }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.ledgers.all }),
    );
  });

  it('does not invalidate anything when the approval call fails (edge case)', async () => {
    approve.mockRejectedValue(new Error('booking already voided'));
    const { wrapper, invalidateQueries } = createWrapper();
    const { result } = renderHook(() => useApprovePayment(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(42)).rejects.toThrow('booking already voided');
    });

    expect(invalidateQueries).not.toHaveBeenCalled();

    // Neutralize the mock immediately after asserting the rejection: the
    // mutation observer can re-invoke mutationFn once more asynchronously
    // after this point (react-query's own post-settle bookkeeping), and
    // leaving it configured to reject would surface as an unhandled
    // rejection in test cleanup despite the test itself having passed.
    approve.mockReset().mockResolvedValue({ payment_id: 42, status: 'completed', booking_status: null });
  });
});

describe('useRejectPayment', () => {
  beforeEach(() => reject.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('rejects the payment with a reason, leaving the booking state untouched, and invalidates dependents', async () => {
    reject.mockResolvedValue({ payment_id: 42, status: 'rejected', booking_status: null });
    const { wrapper, invalidateQueries } = createWrapper();
    const { result } = renderHook(() => useRejectPayment(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ paymentId: 42, reason: 'Receipt amount mismatch' });
    });

    expect(reject).toHaveBeenCalledWith(42, 'Receipt amount mismatch');
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.paymentApprovals.all }),
    );
  });
});

describe('usePaymentApprovalHistory', () => {
  beforeEach(() => listHistory.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('fetches decision history with the default page/pageSize', async () => {
    listHistory.mockResolvedValue({ items: [], total: 0 });
    const { wrapper } = createWrapper();

    renderHook(() => usePaymentApprovalHistory(), { wrapper });

    await waitFor(() => expect(listHistory).toHaveBeenCalledWith({ page: 1, perPage: 25 }));
  });
});

describe('useRequestPaymentReceipt', () => {
  beforeEach(() => requestReceipt.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('requests a receipt with an optional message and invalidates dependents', async () => {
    requestReceipt.mockResolvedValue(undefined);
    const { wrapper, invalidateQueries } = createWrapper();
    const { result } = renderHook(() => useRequestPaymentReceipt(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ paymentId: 42, message: 'please resend the receipt' });
    });

    expect(requestReceipt).toHaveBeenCalledWith(42, 'please resend the receipt');
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.paymentApprovals.all }),
    );
  });
});

describe('usePaypalConflictEvents', () => {
  beforeEach(() => {
    paypalConflicts.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to the narrow paypal-conflicts endpoint (lookback and action set are pinned server-side)', async () => {
    const payload = {
      events: [{ id: 3, action: 'paypal_capture_conflict', created_at: '2026-07-25T00:00:00Z' }],
      total: 5,
    };
    paypalConflicts.mockResolvedValue(payload);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePaypalConflictEvents(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paypalConflicts).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(payload);
  });

  it('does not fire the endpoint when disabled', () => {
    const { wrapper } = createWrapper();
    renderHook(() => usePaypalConflictEvents(false), { wrapper });
    expect(paypalConflicts).not.toHaveBeenCalled();
  });
});
