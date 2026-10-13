// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  canApprove: true,
  approve: vi.fn(),
  reject: vi.fn(),
  refetch: vi.fn(),
  enabledArg: undefined as boolean | undefined,
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (p: string) => p === 'payments:approve' && mocks.canApprove }),
}));

vi.mock('../../../api', () => ({
  PaymentApprovalsService: { downloadReceipt: vi.fn() },
}));

vi.mock('../hooks/usePaymentApprovalsQueries', () => ({
  useUrgentTransferClaims: (enabled: boolean) => {
    mocks.enabledArg = enabled;
    return {
      data: enabled ? { items: mocks.items, total: mocks.items.length } : undefined,
      refetch: mocks.refetch,
    };
  },
  useApprovePayment: () => ({ isPending: false, mutateAsync: mocks.approve }),
  useRejectPayment: () => ({ isPending: false, mutateAsync: mocks.reject }),
}));

import { UrgentTransferAlert, formatWaiting } from './UrgentTransferAlert';

function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: 51,
    booking_id: 5166,
    booking_number: 'BK-5166',
    guest_id: 7,
    guest_name: 'Aisyah Guest',
    amount: '240.00',
    payment_method: 'bank_transfer',
    status: 'pending',
    reference: null,
    notes: null,
    created_at: new Date(Date.now() - 90 * 60_000).toISOString(),
    receipt_requested: false,
    receipt_uploaded: true,
    receipt_file_available: true,
    processed_at: null,
    processed_by_name: null,
    decision_reason: null,
    check_in_date: '2026-10-20',
    check_out_date: '2026-10-21',
    room_number: '101',
    booking_status: 'pending_confirmation',
    ...overrides,
  };
}

describe('UrgentTransferAlert', () => {
  beforeEach(() => {
    mocks.items = [];
    mocks.canApprove = true;
    mocks.approve.mockReset().mockResolvedValue(undefined);
    mocks.reject.mockReset().mockResolvedValue(undefined);
    mocks.refetch.mockReset().mockResolvedValue(undefined);
  });

  it('renders nothing when no claim is pending', () => {
    const { container } = render(<UrgentTransferAlert />);
    expect(container.innerHTML).toBe('');
  });

  it('never queries or renders for staff without payments:approve', () => {
    mocks.canApprove = false;
    mocks.items = [claim()];
    const { container } = render(<UrgentTransferAlert />);
    expect(mocks.enabledArg).toBe(false);
    expect(container.innerHTML).toBe('');
  });

  it('shows a banner with no close control and pops the claim list on load', async () => {
    mocks.items = [claim()];
    render(<UrgentTransferAlert />);

    const banner = screen.getByTestId('urgent-transfer-banner');
    expect(banner.textContent).toMatch(/1 guest bank transfer/);
    expect(within(banner).queryByRole('button', { name: /close|dismiss/i })).toBeNull();

    const dialog = await screen.findByRole('dialog', { name: /Urgent: guest bank transfers/ });
    const item = within(dialog).getByTestId('urgent-transfer-item');
    expect(within(item).getByText('BK-5166')).toBeTruthy();
    expect(within(item).getByText('Aisyah Guest')).toBeTruthy();
    expect(within(item).getByText(/240\.00/)).toBeTruthy();
    expect(within(item).getByText('1 h 30 min')).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'View receipt' })).toBeTruthy();

    // Escape does not close it; minimising keeps the banner.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: /Urgent/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Minimise' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Urgent/ })).toBeNull());
    expect(screen.getByTestId('urgent-transfer-banner')).toBeTruthy();
  });

  it('approves only after the receipt confirmation step', async () => {
    mocks.items = [claim()];
    render(<UrgentTransferAlert />);
    const dialog = await screen.findByRole('dialog', { name: /Urgent/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm receipt & approve' }));
    expect(mocks.approve).not.toHaveBeenCalled();

    const confirm = await screen.findByRole('dialog', { name: 'Approve payment' });
    fireEvent.click(within(confirm).getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith(51));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('requires a reason before rejecting', async () => {
    mocks.items = [claim({ receipt_uploaded: false, receipt_file_available: false })];
    render(<UrgentTransferAlert />);
    const dialog = await screen.findByRole('dialog', { name: /Urgent/ });
    expect(within(dialog).getByText('No receipt uploaded')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));

    const rejectDialog = await screen.findByRole('dialog', { name: 'Reject payment claim' });
    const submit = within(rejectDialog).getAllByRole('button', { name: 'Reject' }).at(-1)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(rejectDialog).getByRole('textbox'), { target: { value: 'No money received' } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.reject).toHaveBeenCalledWith({ paymentId: 51, reason: 'No money received' }),
    );
  });
});

describe('formatWaiting', () => {
  const t = (key: string, o: Record<string, number> = {}) => `${key}:${JSON.stringify(o)}`;
  const now = Date.parse('2026-10-13T10:00:00Z');
  it('parses postgres timestamptz text', () => {
    expect(formatWaiting('2026-10-13 17:44:59.9+08', now, t)).toBe('urgentTransfer.waitingMinutes:{"minutes":15}');
  });
  it('rolls into days', () => {
    expect(formatWaiting('2026-10-12T08:00:00Z', now, t)).toBe('urgentTransfer.waitingDays:{"days":1,"hours":2}');
  });
});
