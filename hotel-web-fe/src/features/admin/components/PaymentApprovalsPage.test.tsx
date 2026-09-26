// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
import { expectNoAxeViolations } from '../../../test/axe';

function pendingPayment(
  paymentMethod: 'paypal' | 'bank_transfer',
  overrides: Record<string, unknown> = {},
) {
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
    check_in_date: '2026-09-26',
    check_out_date: '2026-09-28',
    room_number: '202',
    booking_status: 'pending_confirmation',
    ...overrides,
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

  it('shows the stay dates, room and booking status of each claim', () => {
    mocks.pendingItems = [pendingPayment('bank_transfer')];

    render(<PaymentApprovalsPage />);

    expect(screen.getByRole('columnheader', { name: 'Stay' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Room' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Booking status' })).toBeTruthy();
    const row = screen.getByRole('row', { name: /BK-42/ });
    expect(within(row).getByText('Sep 26, 2026 – Sep 28, 2026')).toBeTruthy();
    expect(within(row).getByText('202')).toBeTruthy();
    expect(within(row).getByText('Pending confirmation')).toBeTruthy();
  });

  it('asks for confirmation and warns before approving a claim without a receipt', async () => {
    mocks.pendingItems = [pendingPayment('bank_transfer')];
    mocks.approve.mockResolvedValue(undefined);

    render(<PaymentApprovalsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const dialog = await screen.findByRole('dialog', { name: 'Approve payment' });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Test Guest')).toBeTruthy();
    expect(within(dialog).getByText('BK-42')).toBeTruthy();
    expect(within(dialog).getByText(/100\.00/)).toBeTruthy();
    expect(within(dialog).getByText('Not uploaded')).toBeTruthy();
    expect(
      within(dialog).getByText(
        'No receipt uploaded. Only approve if you have seen the transfer in the bank account.',
      ),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve payment' }));

    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith(42));
    expect(await screen.findByText(/booking confirmed/)).toBeTruthy();
  });

  it('does not approve when the confirmation is cancelled', async () => {
    mocks.pendingItems = [pendingPayment('bank_transfer')];

    render(<PaymentApprovalsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve payment' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Approve payment' })).toBeNull());
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it('omits the no-receipt warning when the guest uploaded proof', async () => {
    mocks.pendingItems = [
      pendingPayment('bank_transfer', {
        receipt_requested: true,
        receipt_uploaded: true,
        receipt_file_available: true,
      }),
    ];

    render(<PaymentApprovalsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve payment' });
    expect(within(dialog).getByText('Uploaded')).toBeTruthy();
    expect(within(dialog).queryByText(/No receipt uploaded/)).toBeNull();
  });

  it('disables Reject but keeps Approve for a booking staff already confirmed', async () => {
    mocks.pendingItems = [pendingPayment('bank_transfer', { booking_status: 'confirmed' })];

    render(<PaymentApprovalsPage />);

    const reject = screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    expect(screen.getByLabelText(/Approve the payment, or void\/refund the booking instead/, { selector: 'span' })).toBeTruthy();

    fireEvent.click(approve);
    const dialog = await screen.findByRole('dialog', { name: 'Approve payment' });
    expect(
      within(dialog).getByText(
        'This booking is already Confirmed. Approving records the payment without changing the booking status.',
      ),
    ).toBeTruthy();
  });

  it('shows the server refusal when a rejection is refused', async () => {
    const refusal =
      'This booking was already confirmed by staff. Approve the payment, or void/refund the booking instead.';
    mocks.pendingItems = [pendingPayment('bank_transfer')];
    mocks.reject.mockRejectedValue(new Error(refusal));

    render(<PaymentApprovalsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject payment claim' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Transfer not found' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject payment' }));

    await waitFor(() =>
      expect(mocks.reject).toHaveBeenCalledWith({ paymentId: 42, reason: 'Transfer not found' }),
    );
    expect(await within(dialog).findByText(refusal)).toBeTruthy();
  });

  it('has no axe violations on the populated approvals list', async () => {
    mocks.pendingItems = [pendingPayment('bank_transfer')];

    const { container } = render(<PaymentApprovalsPage />);

    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});
