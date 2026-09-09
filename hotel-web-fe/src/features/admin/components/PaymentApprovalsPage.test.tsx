// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  pendingItems: [] as Array<Record<string, unknown>>,
  approve: vi.fn(),
  reject: vi.fn(),
  requestReceipt: vi.fn(),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => false }),
}));

vi.mock('../../../api', () => ({
  PaymentApprovalsService: { downloadReceipt: vi.fn() },
}));

vi.mock('../hooks/usePaymentApprovalsQueries', () => ({
  usePendingPayments: () => ({
    data: { items: mocks.pendingItems, total: mocks.pendingItems.length },
    isPending: false,
    error: null,
  }),
  usePaymentApprovalHistory: () => ({ data: { items: [], total: 0 }, isPending: false, error: null }),
  useApprovePayment: () => ({ isPending: false, variables: undefined, mutateAsync: mocks.approve }),
  useRejectPayment: () => ({ isPending: false, variables: undefined, mutateAsync: mocks.reject }),
  useRequestPaymentReceipt: () => ({ isPending: false, variables: undefined, mutateAsync: mocks.requestReceipt }),
  usePaypalConflictEvents: () => ({ data: { events: [], total: 0 } }),
}));

import PaymentApprovalsPage from './PaymentApprovalsPage';

function pendingPayment(paymentMethod: 'paypal' | 'bank_transfer') {
  return {
    id: 42,
    booking_id: 11,
    booking_number: 'BK-42',
    guest_id: 7,
    guest_name: 'Test Guest',
    amount: '100.00',
    payment_method: paymentMethod,
    status: 'pending',
    reference: null,
    notes: null,
    created_at: '2026-09-09T00:00:00Z',
    receipt_requested: false,
    receipt_uploaded: false,
    receipt_file_available: false,
    processed_at: null,
    processed_by_name: null,
    decision_reason: null,
  };
}

describe('PaymentApprovalsPage payment actions', () => {
  beforeEach(() => {
    mocks.pendingItems = [];
    mocks.approve.mockReset();
    mocks.reject.mockReset();
    mocks.requestReceipt.mockReset();
  });

  it('cancels a pending PayPal attempt without exposing manual approval', () => {
    mocks.pendingItems = [pendingPayment('paypal')];

    render(<PaymentApprovalsPage />);

    expect(screen.getByRole('button', { name: 'Cancel PayPal attempt' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('keeps approval available for a pending bank transfer', () => {
    mocks.pendingItems = [pendingPayment('bank_transfer')];

    render(<PaymentApprovalsPage />);

    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
  });
});
