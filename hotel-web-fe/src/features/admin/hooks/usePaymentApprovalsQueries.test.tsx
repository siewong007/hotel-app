// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { AuditLogEntry } from '../../../types/audit.types';

// Mock the api barrel the hook calls into (AuditService for the
// PayPal-conflict lookup, PaymentApprovalsService for the approval workflow
// itself), following the shared hook-test mocking convention.
const listPending = vi.fn();
const approve = vi.fn();
const listHistory = vi.fn();
const reject = vi.fn();
const requestReceipt = vi.fn();
const getAuditLogs = vi.fn();

vi.mock('../../../api', () => ({
  PaymentApprovalsService: {
    listPending: (...args: any[]) => listPending(...args),
    approve: (...args: any[]) => approve(...args),
    listHistory: (...args: any[]) => listHistory(...args),
    reject: (...args: any[]) => reject(...args),
    requestReceipt: (...args: any[]) => requestReceipt(...args),
  },
  AuditService: {
    getAuditLogs: (...args: any[]) => getAuditLogs(...args),
  },
}));

import { queryKeys } from '../../../api/queryKeys';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
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

function buildAuditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    user_id: null,
    username: null,
    action: 'paypal_webhook_conflict',
    resource_type: 'payments',
    category: 'system',
    resource_id: 10,
    details: null,
    ip_address: null,
    user_agent: null,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
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
    getAuditLogs.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries a 30-day lookback for both PayPal conflict actions', async () => {
    getAuditLogs.mockResolvedValue({ data: [], total: 0 });
    const { wrapper } = createWrapper();
    // Computed the same way the hook does, at the same wall-clock moment,
    // instead of faking the system clock (avoids fake-timer/waitFor interplay).
    const expectedStartDate = formatLocalDate(addLocalDays(new Date(), -30));

    renderHook(() => usePaypalConflictEvents(), { wrapper });

    await waitFor(() => expect(getAuditLogs).toHaveBeenCalledTimes(2));

    expect(getAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'paypal_webhook_conflict', start_date: expectedStartDate }),
    );
    expect(getAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'paypal_capture_conflict', start_date: expectedStartDate }),
    );
  });

  it('merges both actions and sorts newest-first across them (business logic: staff must see the latest conflict at the top)', async () => {
    const webhookEvents = [
      buildAuditEntry({ id: 1, action: 'paypal_webhook_conflict', created_at: '2026-07-20T00:00:00Z' }),
      buildAuditEntry({ id: 2, action: 'paypal_webhook_conflict', created_at: '2026-07-10T00:00:00Z' }),
    ];
    const captureEvents = [
      buildAuditEntry({ id: 3, action: 'paypal_capture_conflict', created_at: '2026-07-25T00:00:00Z' }),
    ];
    getAuditLogs.mockImplementation((params: { action: string }) =>
      Promise.resolve(
        params.action === 'paypal_webhook_conflict'
          ? { data: webhookEvents, total: 2 }
          : { data: captureEvents, total: 1 },
      ),
    );
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePaypalConflictEvents(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Merged total sums both responses, not just one.
    expect(result.current.data?.total).toBe(3);
    // Sorted strictly newest-first across the merged set, not per-action.
    expect(result.current.data?.events.map((e) => e.id)).toEqual([3, 1, 2]);
  });

  it('does not fire the audit-log queries when disabled', () => {
    const { wrapper } = createWrapper();
    renderHook(() => usePaypalConflictEvents(false), { wrapper });
    expect(getAuditLogs).not.toHaveBeenCalled();
  });
});
