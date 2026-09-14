import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configure } from '@testing-library/dom';

// All three idempotency suites below now run under fake timers with automatic
// advancement, so their waitFor windows no longer race wall-clock time. The
// raised async-util timeout stays as a cheap safety net for the remaining
// render-heavy waits in this file.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { BookingWithDetails, CustomerLedger } from '../../../types';
import type { CheckoutPaymentRecord } from '../types';

const mocks = vi.hoisted(() => ({
  recordPayment: vi.fn(),
  createLedgerPayment: vi.fn(),
  updatePayment: vi.fn(),
  deletePayment: vi.fn(),
  revertDepositRefund: vi.fn(),
  revertDepositVoid: vi.fn(),
  hasPermission: vi.fn(),
  setPayments: vi.fn(),
  reloadPayments: vi.fn(),
  updateBooking: vi.fn(),
  refundDeposit: vi.fn(),
  forfeitDeposit: vi.fn(),
  setDepositRefunded: vi.fn(),
  payments: [] as CheckoutPaymentRecord[],
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (amount: number) => `RM${Number(amount).toFixed(2)}`, symbol: 'RM' }),
}));

vi.mock('../../../api', () => ({
  BookingsService: { updateBooking: (...args: unknown[]) => mocks.updateBooking(...args) },
}));

vi.mock('../../../api/invoices.service', () => ({
  InvoicesService: {
    recordPayment: (...args: unknown[]) => mocks.recordPayment(...args),
    updatePayment: (...args: unknown[]) => mocks.updatePayment(...args),
    deletePayment: (...args: unknown[]) => mocks.deletePayment(...args),
    refundDeposit: (...args: unknown[]) => mocks.refundDeposit(...args),
    forfeitDeposit: (...args: unknown[]) => mocks.forfeitDeposit(...args),
    revertDepositRefund: (...args: unknown[]) => mocks.revertDepositRefund(...args),
    revertDepositVoid: (...args: unknown[]) => mocks.revertDepositVoid(...args),
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('../../../api/ledger.service', () => ({
  LedgerService: {
    createLedgerPayment: (...args: unknown[]) => mocks.createLedgerPayment(...args),
    updateLedgerPayment: vi.fn(),
    deleteLedgerPayment: vi.fn(),
  },
}));

vi.mock('../hooks/useCheckoutInvoiceData', () => ({
  useCheckoutInvoiceData: () => ({
    hotelSettings: {
      service_tax_rate: 0,
      tourism_tax_rate: 0,
      payment_methods: ['Cash', 'Bank Transfer'],
    },
    roomPrice: 100,
    guestCompanyName: '',
    guestAddress: '',
    guestPhone: '',
    guestIcNumber: '',
    payments: mocks.payments,
    setPayments: (...args: unknown[]) => mocks.setPayments(...args),
    depositRefunded: false,
    setDepositRefunded: (...args: unknown[]) => mocks.setDepositRefunded(...args),
    editableDailyRates: {},
    setEditableDailyRates: vi.fn(),
    reloadPayments: (...args: unknown[]) => mocks.reloadPayments(...args),
  }),
}));

vi.mock('./CheckoutInvoicePrintView', () => ({ default: () => null }));

import CheckoutInvoiceModal from './CheckoutInvoiceModal';
import { ConfirmProvider } from '../../../components/common/ConfirmProvider';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const booking: BookingWithDetails = {
  id: '42',
  booking_number: 'BK-42',
  folio_number: 'F-42',
  guest_id: '7',
  guest_name: 'Jane Doe',
  room_id: '101',
  room_number: '101',
  room_type: 'Deluxe',
  check_in_date: '2026-08-01T00:00:00.000Z',
  check_out_date: '2026-08-02T00:00:00.000Z',
  total_amount: 100,
  price_per_night: 100,
  status: 'checked_in',
  payment_status: 'unpaid',
  balance_due: 100,
  payment_method: 'Cash',
  deposit_paid: false,
  deposit_amount: 0,
} as BookingWithDetails;

const ledger: CustomerLedger = {
  id: 9,
  company_name: 'Acme Corp',
  description: 'Room charge',
  expense_type: 'room',
  amount: 100,
  status: 'pending',
  paid_amount: 0,
  balance_due: 100,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

function renderModal(
  ledgerView = false,
  overrides: Partial<BookingWithDetails> = {},
  modalProps: { readOnly?: boolean } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // ConfirmProvider: the modal calls useConfirm() for its delete/revert prompts.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </QueryClientProvider>
  );
  render(
    <CheckoutInvoiceModal
      open
      onClose={vi.fn()}
      booking={{ ...booking, ...overrides }}
      ledger={ledgerView ? ledger : null}
      readOnly={modalProps.readOnly}
    />,
    { wrapper },
  );
}

async function paymentDialog() {
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Record Payment' })).toBeDefined());
  return dialog;
}

// Guided deposit resolution: the pending card offers three radio-style
// options (refund / forfeit / cancel uncollected) and mounts only the
// selected option's form.
function selectResolutionOption(dialog: HTMLElement, name: RegExp) {
  fireEvent.click(within(dialog).getByRole('radio', { name }));
}

async function selectComboboxOption(combobox: HTMLElement, optionName: string) {
  fireEvent.mouseDown(combobox);
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

describe('CheckoutInvoiceModal payment idempotency', () => {
  it('reports no critical axe violations', async () => {
    renderModal();
    await screen.findByRole('dialog');
    await expectNoCriticalAxeViolations(document.body);
  });

  beforeEach(() => {
    mocks.recordPayment.mockReset();
    mocks.createLedgerPayment.mockReset();
    mocks.setPayments.mockReset();
    mocks.reloadPayments.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('reuses a failed booking-payment key, rotates it after an edit, and clears it after success', async () => {
    // Fake timers with automatic advancement make RTL's waitFor polling
    // deterministic under parallel-suite load; the code under test has no
    // timers of its own (same pattern as the BookingDetailPage timezone test).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const timeout = new Error('timeout');
      mocks.recordPayment
        .mockRejectedValueOnce(timeout)
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 2 });
      renderModal();
      const dialog = await paymentDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(1));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(2));
      const firstRequest = mocks.recordPayment.mock.calls[0][0];
      expect(mocks.recordPayment.mock.calls[1][0].idempotency_key).toBe(firstRequest.idempotency_key);

      fireEvent.mouseDown(within(dialog).getByRole('combobox'));
      fireEvent.click(await screen.findByRole('option', { name: 'Bank Transfer' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(3));
      const changedRequest = mocks.recordPayment.mock.calls[2][0];
      expect(changedRequest.idempotency_key).not.toBe(firstRequest.idempotency_key);

      await waitFor(() => expect(within(dialog).getAllByRole('button', { name: 'Record Payment' })).toHaveLength(1));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(within(dialog).getByRole('spinbutton')).toBeDefined());
      fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '100' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(4));
      expect(mocks.recordPayment.mock.calls[3][0].idempotency_key).not.toBe(changedRequest.idempotency_key);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses a failed ledger-payment key, rotates it after an edit, and clears it after success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const timeout = new Error('timeout');
      mocks.createLedgerPayment
        .mockRejectedValueOnce(timeout)
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 2 });
      renderModal(true);
      const dialog = await paymentDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.createLedgerPayment).toHaveBeenCalledTimes(1));
      const firstRequest = mocks.createLedgerPayment.mock.calls[0][1];

      fireEvent.change(within(dialog).getByLabelText('Reference (Optional)'), { target: { value: '   ' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.createLedgerPayment).toHaveBeenCalledTimes(2));
      expect(mocks.createLedgerPayment.mock.calls[1][1].idempotency_key).toBe(firstRequest.idempotency_key);
      expect(mocks.createLedgerPayment.mock.calls[1][1].payment_reference).toBeUndefined();

      fireEvent.mouseDown(within(dialog).getByRole('combobox'));
      fireEvent.click(await screen.findByRole('option', { name: 'Bank Transfer' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.createLedgerPayment).toHaveBeenCalledTimes(3));
      const changedRequest = mocks.createLedgerPayment.mock.calls[2][1];
      expect(changedRequest.idempotency_key).not.toBe(firstRequest.idempotency_key);

      await waitFor(() => expect(within(dialog).getAllByRole('button', { name: 'Record Payment' })).toHaveLength(1));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(within(dialog).getByRole('spinbutton')).toBeDefined());
      fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '100' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.createLedgerPayment).toHaveBeenCalledTimes(4));
      expect(mocks.createLedgerPayment.mock.calls[3][1].idempotency_key).not.toBe(changedRequest.idempotency_key);
    } finally {
      vi.useRealTimers();
    }
  });

  // Review finding I2. This test used to assert the OPPOSITE -- that the key was
  // cleared as soon as the POST resolved. That is the double-charge path: the
  // payment COMMITS, the refresh then throws, the catch reports "Failed to record
  // payment" for money that is already recorded, and because the key was already
  // released the staff retry mints a NEW one and charges the guest a second time.
  // The attempt is now released only after every step that can throw, so an
  // identical retry replays server-side under the same key.
  it('retains a committed ledger-payment key when the refresh afterwards fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const refreshFailure = new Error('refresh failed');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mocks.createLedgerPayment
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 2 });
      mocks.reloadPayments
        .mockRejectedValueOnce(refreshFailure)
        .mockResolvedValueOnce(undefined);
      renderModal(true);
      const dialog = await paymentDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.createLedgerPayment).toHaveBeenCalledTimes(1));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
      await waitFor(() => expect(mocks.createLedgerPayment).toHaveBeenCalledTimes(2));

      expect(mocks.createLedgerPayment.mock.calls[1][1].idempotency_key)
        .toBe(mocks.createLedgerPayment.mock.calls[0][1].idempotency_key);
      consoleError.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Pre-integrity-rework bookings carry the deposit only in booking columns with
// no `payment_type='deposit'` row, so refund_deposit's ledger-only ceiling sees
// nothing held and always refuses. `useDepositResolution` repairs that lazily
// at refund time: it asserts the collected amount through the booking update
// (the server mints the missing deposit payment under the booking lock), then
// refunds against the now-real ledger row.
describe('CheckoutInvoiceModal legacy deposit handling', () => {
  beforeEach(() => {
    mocks.updateBooking.mockReset().mockResolvedValue({});
    mocks.refundDeposit.mockReset().mockResolvedValue({ id: 9, payment_status: 'refunded' });
    mocks.deletePayment.mockReset().mockResolvedValue({});
    mocks.revertDepositRefund.mockReset().mockResolvedValue({});
    mocks.revertDepositVoid.mockReset().mockResolvedValue({});
    mocks.setPayments.mockReset();
    mocks.setDepositRefunded.mockReset();
    mocks.hasPermission.mockReset().mockReturnValue(true);
    mocks.reloadPayments.mockReset().mockResolvedValue(undefined);
    mocks.payments = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('records the collected deposit via updateBooking before refunding a flag-only deposit', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    selectResolutionOption(dialog, /Refund deposit/i);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Refund RM50.00' }));

    await waitFor(() =>
      expect(mocks.refundDeposit).toHaveBeenCalledWith('42', 'Cash', 50, {
        transaction_reference: undefined,
        note: undefined,
      }),
    );
    expect(mocks.updateBooking).toHaveBeenCalledWith('42', {
      deposit_paid: true,
      deposit_amount: 50,
    });
    // The collection assertion must land before the refund call so the
    // minted deposit row exists when the ceiling is evaluated.
    expect(mocks.updateBooking.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.refundDeposit.mock.invocationCallOrder[0]);
    expect(mocks.reloadPayments).toHaveBeenCalled();
  });

  it('mints the shortfall first when the recorded deposit under-covers the mirror', async () => {
    // One deposit row exists but the booking mirror asserts more — the
    // backend gate reads max(collected, mirror), so the refund must draw on
    // the full asserted amount. The hook tops the ledger up via the booking
    // update before refunding.
    mocks.payments = [
      { id: 1, payment_status: 'completed', payment_type: 'deposit', total_amount: 30 },
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    selectResolutionOption(dialog, /Refund deposit/i);
    // The CTA already shows the post-mint amount the refund will draw.
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Refund RM50.00' }));

    await waitFor(() =>
      expect(mocks.refundDeposit).toHaveBeenCalledWith('42', 'Cash', 50, {
        transaction_reference: undefined,
        note: undefined,
      }),
    );
    expect(mocks.updateBooking).toHaveBeenCalledWith('42', {
      deposit_paid: true,
      deposit_amount: 50,
    });
    expect(mocks.updateBooking.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.refundDeposit.mock.invocationCallOrder[0]);
  });

  it('does not assert a collection when a deposit payment already covers the refund', async () => {
    mocks.payments = [
      { id: 1, payment_status: 'completed', payment_type: 'deposit', total_amount: 50 },
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    selectResolutionOption(dialog, /Refund deposit/i);
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Refund RM50.00' }));

    await waitFor(() =>
      expect(mocks.refundDeposit).toHaveBeenCalledWith('42', 'Cash', 50, {
        transaction_reference: undefined,
        note: undefined,
      }),
    );
    expect(mocks.updateBooking).not.toHaveBeenCalled();
  });

  it('persists a deposit waive through updateBooking and unblocks checkout', async () => {
    // A completed booking payment zeroes the balance so the deposit gate is
    // the only thing holding "Proceed to Checkout" disabled. With no deposit
    // rows, "Cancel uncollected deposit" auto-routes to the mirror waive.
    mocks.payments = [
      { id: 2, payment_status: 'completed', payment_type: 'booking', total_amount: 100 },
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    const proceed = within(dialog).getByRole('button', { name: 'Proceed to Checkout' });
    expect((proceed as HTMLButtonElement).disabled).toBe(true);

    selectResolutionOption(dialog, /Cancel uncollected deposit/i);
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Lost keycard' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel deposit record' }));
    // The destructive confirm stays in the modal, after the section's reason.
    const confirmDialog = await screen.findByRole('dialog', { name: 'Cancel deposit' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel deposit' }));

    await waitFor(() =>
      expect(mocks.updateBooking).toHaveBeenCalledWith('42', {
        deposit_paid: false,
        deposit_amount: 0,
        payment_note: 'Deposit waived: Lost keycard',
      }),
    );
    expect(mocks.deletePayment).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('keeps checkout locked and surfaces the error when the server rejects the waive', async () => {
    mocks.payments = [
      { id: 2, payment_status: 'completed', payment_type: 'booking', total_amount: 100 },
    ];
    mocks.updateBooking.mockRejectedValue(new Error('Server rejected the deposit waive'));
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    selectResolutionOption(dialog, /Cancel uncollected deposit/i);
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Lost keycard' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel deposit record' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Cancel deposit' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel deposit' }));

    await waitFor(() =>
      expect(within(dialog).getByText(/Server rejected the deposit waive/i)).toBeDefined(),
    );
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// The incident this guards against: a held deposit was summed into the
// folio's "paid" total, so a fully-paid bill plus a deposit read as
// "Overpayment" — and the deposit row carried a working delete button, which
// is how the refund obligation was voided. Deposit-type rows are now excluded
// from the balance math and render in their own group with no edit/delete
// affordances; the resolution card resolves the deposit through guided
// refund/forfeit/cancel options.
describe('CheckoutInvoiceModal deposit display + forfeit', () => {
  const depositRow = { id: 1, payment_status: 'completed', payment_type: 'deposit', total_amount: 50, payment_method: 'cash' };
  const billPayment = { id: 2, payment_status: 'completed', payment_type: 'booking', total_amount: 100, payment_method: 'cash' };

  beforeEach(() => {
    mocks.forfeitDeposit.mockReset().mockResolvedValue({ id: 3, payment_status: 'completed', payment_type: 'deposit_forfeited', total_amount: 50 });
    mocks.updatePayment.mockReset().mockResolvedValue({ ...depositRow, payment_method: 'bank_transfer' });
    mocks.deletePayment.mockReset().mockResolvedValue({});
    mocks.revertDepositRefund.mockReset().mockResolvedValue({});
    mocks.revertDepositVoid.mockReset().mockResolvedValue({});
    mocks.updateBooking.mockReset().mockResolvedValue({});
    mocks.reloadPayments.mockReset().mockResolvedValue(undefined);
    mocks.setPayments.mockReset();
    mocks.hasPermission.mockReset().mockReturnValue(true);
    mocks.payments = [depositRow, billPayment];
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the bill balance as Paid — not Overpayment — when the bill is settled and a deposit is held', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('Bill balance: RM0.00 — Paid')).toBeDefined());
    expect(within(dialog).queryByText('Overpayment')).toBeNull();
    // The held deposit renders labeled, outside the bill-payments rows…
    expect(within(dialog).getByText('Deposit held')).toBeDefined();
    // …and carries no delete control — the only delete button in the folio
    // belongs to the real bill payment.
    expect(within(dialog).getAllByTestId('DeleteIcon')).toHaveLength(1);
    // An unresolved deposit still holds the checkout gate — the readiness
    // strip names the blocker.
    expect(
      within(dialog).getByText('Checkout is not ready — Resolve the RM50.00 security deposit'),
    ).toBeDefined();
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps the real outstanding balance collectible when only part of the bill is paid', async () => {
    mocks.payments = [depositRow, { ...billPayment, total_amount: 40 }];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('Bill balance: RM60.00 — Partially paid')).toBeDefined());
    expect(within(dialog).getAllByRole('button', { name: 'Record Payment' }).length).toBeGreaterThan(0);
  });

  it('lists every unmet condition in the readiness strip when the bill and deposit are both unresolved', async () => {
    mocks.payments = [];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() =>
      expect(
        within(dialog).getByText(
          'Checkout is not ready — Resolve the RM50.00 security deposit · Settle the outstanding bill balance of RM100.00',
        ),
      ).toBeDefined(),
    );
    expect(within(dialog).getByText('Bill balance: RM100.00 — Outstanding')).toBeDefined();
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the ready strip and releases the gate once the deposit is resolved and the bill is paid', async () => {
    mocks.payments = [
      depositRow,
      { id: 4, payment_status: 'refunded', payment_type: 'refund', total_amount: 50, payment_method: 'Cash' },
      billPayment,
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() =>
      expect(
        within(dialog).getByText('Ready for checkout — Bill paid · Deposit refunded RM50.00 via Cash'),
      ).toBeDefined(),
    );
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('still shows "No payments recorded yet" when the only rows are voided', async () => {
    // `payments` now retains void rows — the empty state must key off the
    // displayed (completed + refunded) groups, not the raw array.
    mocks.payments = [{ ...depositRow, payment_status: 'void' }];
    renderModal(false, { deposit_paid: false });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('No payments recorded yet')).toBeDefined());
  });

  it('forfeits the deposit through the service and releases the checkout gate on a full forfeit', async () => {
    // reloadPayments mirrors the server truth: after the forfeit, a
    // deposit_forfeited row covers the held amount and the gate opens.
    mocks.reloadPayments.mockImplementation(async () => {
      mocks.payments = [
        ...mocks.payments,
        { id: 3, payment_status: 'completed', payment_type: 'deposit_forfeited', total_amount: 50, payment_method: 'cash' },
      ];
    });
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    const proceed = within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement;
    expect(proceed.disabled).toBe(true);

    selectResolutionOption(dialog, /Forfeit deposit/i);
    await selectComboboxOption(
      within(dialog).getByRole('combobox', { name: /forfeit reason/i }),
      'Room damage',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review forfeiture' }));
    // The review step is the forfeit confirm — it states the retain/refund
    // split before the destructive submit.
    expect(
      within(dialog).getByText('You are retaining RM50.00 of the deposit — RM0.00 will remain to refund.'),
    ).toBeDefined();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Forfeit RM50.00' }));

    await waitFor(() => expect(mocks.forfeitDeposit).toHaveBeenCalledWith('42', 50, 'Room damage', undefined));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(mocks.reloadPayments).toHaveBeenCalled();
  });

  it('keeps the checkout gate locked after a partial forfeit', async () => {
    mocks.reloadPayments.mockImplementation(async () => {
      mocks.payments = [
        ...mocks.payments,
        { id: 3, payment_status: 'completed', payment_type: 'deposit_forfeited', total_amount: 20, payment_method: 'cash' },
      ];
    });
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    selectResolutionOption(dialog, /Forfeit deposit/i);
    fireEvent.change(within(dialog).getByLabelText('Forfeit amount'), { target: { value: '20' } });
    await selectComboboxOption(
      within(dialog).getByRole('combobox', { name: /forfeit reason/i }),
      'Room damage',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review forfeiture' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Forfeit RM20.00' }));

    await waitFor(() => expect(mocks.forfeitDeposit).toHaveBeenCalledWith('42', 20, 'Room damage', undefined));
    // RM30 of the deposit is still held, so checkout stays blocked — the
    // readiness strip names the new remainder.
    await waitFor(() =>
      expect(
        within(dialog).getByText(/Checkout is not ready — Resolve the RM30\.00 security deposit/),
      ).toBeDefined(),
    );
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('releases the checkout gate when forfeit rows on the ledger already cover the held deposit', async () => {
    // The deposit is resolved by the ledger itself — no click this session.
    // The status is derived from the rows so an out-of-band un-forfeit (void
    // of the deposit_forfeited row) would re-arm the gate on the next reload.
    mocks.payments = [
      depositRow,
      { id: 3, payment_status: 'completed', payment_type: 'deposit_forfeited', total_amount: 50, payment_method: 'cash' },
      billPayment,
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    // The folio chip and the resolution strip both read forfeited.
    expect(within(dialog).getAllByText('Deposit forfeited').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(mocks.forfeitDeposit).not.toHaveBeenCalled();
  });

  it('keeps the checkout gate locked when a partial forfeit row leaves money held', async () => {
    mocks.payments = [
      depositRow,
      { id: 3, payment_status: 'completed', payment_type: 'deposit_forfeited', total_amount: 20, payment_method: 'cash' },
      billPayment,
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getAllByText('Deposit forfeited').length).toBeGreaterThan(0));
    // RM30 of the deposit is still refundable, so checkout stays blocked.
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // …and the forfeit field defaults to the remaining refundable amount.
    selectResolutionOption(dialog, /Forfeit deposit/i);
    expect(
      ((await within(dialog).findByLabelText('Forfeit amount')) as HTMLInputElement).value,
    ).toBe('30.00');
  });

  it('flags an over-ceiling forfeit amount and keeps the action disabled', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    selectResolutionOption(dialog, /Forfeit deposit/i);
    fireEvent.change(within(dialog).getByLabelText('Forfeit amount'), { target: { value: '60' } });
    await selectComboboxOption(
      within(dialog).getByRole('combobox', { name: /forfeit reason/i }),
      'Room damage',
    );

    await waitFor(() =>
      expect(within(dialog).getByText(/Cannot exceed RM50\.00/)).toBeDefined(),
    );
    // With a valid reason picked, the over-ceiling amount is the only thing
    // holding the review step back.
    expect(
      (within(dialog).getByRole('button', { name: 'Review forfeiture' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.forfeitDeposit).not.toHaveBeenCalled();
  });

  // A wrong tender on a posted deposit row can't be voided (in-house deposit
  // voids are guarded), so the row exposes a method-only correction: Edit
  // opens a form with just the tender Select, and the PATCH sends only
  // payment_method — amount/date/reference would 400 on a completed row.
  it('lets staff correct a deposit row method — method-only form', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('Deposit held')).toBeDefined());
    // Scope to the deposits section — the section header sits in its own Box
    // directly above the rows, so two levels up is the section container.
    const depositsHeader = within(dialog).getByText(/Deposits — collateral/i);
    const depositSection = depositsHeader.parentElement!.parentElement!;
    // The deposit row gets Edit but never Delete — the folio's only delete
    // button still belongs to the bill payment.
    expect(within(depositSection).queryByTestId('DeleteIcon')).toBeNull();
    expect(within(dialog).getAllByTestId('DeleteIcon')).toHaveLength(1);

    fireEvent.click(
      within(depositSection).getByRole('button', { name: 'Edit deposit payment method' }),
    );

    // Method-only form: the tender Select renders; amount, date, reference
    // and notes fields do not — the backend keeps them immutable.
    await within(depositSection).findByRole('combobox');
    expect(within(depositSection).queryByLabelText('Amount')).toBeNull();
    expect(within(depositSection).queryByLabelText('Payment Date')).toBeNull();
    expect(within(depositSection).queryByLabelText('Reference')).toBeNull();
    expect(within(depositSection).queryByLabelText('Notes')).toBeNull();

    fireEvent.mouseDown(within(depositSection).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Bank Transfer' }));
    fireEvent.click(within(depositSection).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.updatePayment).toHaveBeenCalledTimes(1));
    expect(mocks.updatePayment).toHaveBeenCalledWith(1, { payment_method: 'Bank Transfer' });
    // No amount/payment_date/transaction_reference keys — sending them on a
    // posted deposit row would be rejected server-side.
    expect(Object.keys(mocks.updatePayment.mock.calls[0][1])).toEqual(['payment_method']);
  });

  it('routes Cancel uncollected deposit through deletePayment for each held deposit row', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p === 'payments:delete');
    // After the void, the rows come back voided → the card flips to the
    // cancelled strip and the checkout gate releases.
    mocks.reloadPayments.mockImplementation(async () => {
      mocks.payments = mocks.payments.map((p) =>
        p.id === depositRow.id ? { ...p, payment_status: 'void' } : p,
      );
    });
    // The backend drops the booking mirror when the last deposit row voids;
    // the test's booking prop can't change mid-flight, so it starts clear.
    renderModal(false, { deposit_paid: false });
    const dialog = await screen.findByRole('dialog');

    selectResolutionOption(dialog, /Cancel uncollected deposit/i);
    // The cancel panel requires a reason and warns it is not a refund.
    expect(within(dialog).getByText('This does not issue a refund.')).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), {
      target: { value: 'Recorded but never collected' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel deposit record' }));
    // The destructive confirm stays in the modal — title and confirm button
    // are both 'Cancel deposit'.
    const confirmDialog = await screen.findByRole('dialog', { name: 'Cancel deposit' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel deposit' }));

    await waitFor(() => expect(mocks.deletePayment).toHaveBeenCalledWith(depositRow.id));
    expect(mocks.updateBooking).not.toHaveBeenCalled();
    expect(mocks.reloadPayments).toHaveBeenCalled();
    await waitFor(() =>
      expect(within(dialog).getByText('Cancelled — not collected')).toBeDefined(),
    );
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it('disables the cancel option without payments:delete or bookings:update', async () => {
    mocks.hasPermission.mockReturnValue(false);
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    // Row-backed deposit → the cancel route needs payments:delete. The
    // option renders aria-disabled with a caption rather than hiding.
    const cancelOption = within(dialog).getByRole('radio', { name: /Cancel uncollected deposit/i });
    expect(cancelOption.getAttribute('aria-disabled')).toBe('true');
    expect(
      within(dialog).getByText('Requires the payments:delete or bookings:update permission'),
    ).toBeDefined();

    fireEvent.click(cancelOption);
    expect(within(dialog).queryByRole('button', { name: 'Cancel deposit record' })).toBeNull();
  });

  it('shows Restore deposit when a voided deposit row exists and calls revertDepositVoid', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p === 'payments:delete');
    mocks.revertDepositVoid.mockReset().mockResolvedValue({ deposit_restored: true });
    mocks.reloadPayments.mockReset().mockResolvedValue(undefined);
    mocks.payments = [{ ...depositRow, payment_status: 'void' }];
    renderModal(false, { deposit_paid: false });
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /^Restore deposit$/ }));
    await waitFor(() => expect(mocks.revertDepositVoid).toHaveBeenCalled());
    expect(mocks.reloadPayments).toHaveBeenCalled();
  });

  it('reverts a deposit refund through the modal confirm dialog under payments:manage', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p === 'payments:manage');
    // After the revert the refund row reads void → the deposit re-opens.
    mocks.reloadPayments.mockImplementation(async () => {
      mocks.payments = mocks.payments.map((p) =>
        p.payment_type === 'refund' ? { ...p, payment_status: 'void' } : p,
      );
    });
    mocks.payments = [
      depositRow,
      { id: 4, payment_status: 'refunded', payment_type: 'refund', total_amount: 50, payment_method: 'Cash' },
      billPayment,
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Revert refund' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Revert deposit refund' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Revert refund' }));

    await waitFor(() => expect(mocks.revertDepositRefund).toHaveBeenCalledWith('42'));
    expect(mocks.reloadPayments).toHaveBeenCalled();
    // The refund row is void → the deposit is pending again and the gate
    // re-locks.
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it('hides Revert refund without payments:manage', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p !== 'payments:manage');
    mocks.payments = [
      depositRow,
      { id: 4, payment_status: 'refunded', payment_type: 'refund', total_amount: 50, payment_method: 'Cash' },
      billPayment,
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await within(dialog).findByText('Deposit refunded');
    expect(within(dialog).queryByRole('button', { name: 'Revert refund' })).toBeNull();
  });

  it('passes the chosen refund method, reference and staff note through to the service', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    selectResolutionOption(dialog, /Refund deposit/i);
    // The record-payment form's "Reference (Optional)"/"Notes (Optional)"
    // fields stay mounted inside their Collapse — scope to the deposit
    // resolution area so only the refund panel's fields match.
    const depositArea = within(dialog).getByRole('radiogroup')
      .parentElement as HTMLElement;
    await selectComboboxOption(
      within(depositArea).getByRole('combobox', { name: /refund method/i }),
      'Bank Transfer',
    );
    fireEvent.change(within(depositArea).getByLabelText(/Reference \(optional\)/i), {
      target: { value: 'RF-9001' },
    });
    fireEvent.change(within(depositArea).getByLabelText(/^Note \(optional\)/i), {
      target: { value: 'handed to guest at desk' },
    });
    fireEvent.click(within(depositArea).getByRole('button', { name: 'Refund RM50.00' }));

    // The completed deposit row already covers the mirror — no mint, just
    // the refund carrying the staff-entered reference and note.
    await waitFor(() =>
      expect(mocks.refundDeposit).toHaveBeenCalledWith('42', 'Bank Transfer', 50, {
        transaction_reference: 'RF-9001',
        note: 'handed to guest at desk',
      }),
    );
    expect(mocks.updateBooking).not.toHaveBeenCalled();
  });

  it('gates the refund and forfeit options on payments:refund while cancel stays routed on its own permission', async () => {
    // bookings:update only: cancel auto-routes through the mirror waive and
    // stays enabled; refund/forfeit render disabled with the caption.
    mocks.hasPermission.mockImplementation((p: string) => p === 'bookings:update');
    mocks.payments = [billPayment];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    const refundOption = within(dialog).getByRole('radio', { name: /Refund deposit/i });
    const forfeitOption = within(dialog).getByRole('radio', { name: /Forfeit deposit/i });
    const cancelOption = within(dialog).getByRole('radio', { name: /Cancel uncollected deposit/i });
    expect(refundOption.getAttribute('aria-disabled')).toBe('true');
    expect(forfeitOption.getAttribute('aria-disabled')).toBe('true');
    expect(cancelOption.getAttribute('aria-disabled')).toBe('false');
    expect(
      within(dialog).getAllByText('Requires the payments:refund permission'),
    ).toHaveLength(2);

    fireEvent.click(refundOption);
    expect(within(dialog).queryByRole('button', { name: /Refund RM50\.00/ })).toBeNull();
  });

  it('reads "Bill to the company ledger" in the ready strip when the unpaid bill posts to the ledger', async () => {
    // Company billing: an unpaid bill is not a checkout blocker — it posts
    // to the company ledger — so the strip reads ready with ledger wording.
    mocks.payments = [];
    renderModal(false, { deposit_paid: false, company_id: 5, company_name: 'Acme Corp' });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() =>
      expect(
        within(dialog).getByText('Ready for checkout — Bill to the company ledger'),
      ).toBeDefined(),
    );
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('labels the no-deposit chip "City Ledger - N/A" on a company-billing booking', async () => {
    mocks.payments = [billPayment];
    renderModal(false, { deposit_paid: false, company_id: 5, company_name: 'Acme Corp' });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('City Ledger - N/A')).toBeDefined());
    expect(within(dialog).queryByText('No deposit')).toBeNull();
  });

  it('labels the no-deposit chip "No deposit" on a guest-billed booking', async () => {
    mocks.payments = [billPayment];
    renderModal(false, { deposit_paid: false });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('No deposit')).toBeDefined());
  });

  it('suppresses the readiness strip in readOnly — a receipt carries no checkout framing', async () => {
    // A held deposit would block checkout, but a read-only receipt should
    // not say "Checkout is not ready" — the strip is suppressed entirely.
    renderModal(false, { deposit_paid: true, deposit_amount: 50 }, { readOnly: true });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('Pending resolution')).toBeDefined());
    expect(within(dialog).queryByText(/Checkout is not ready|Ready for checkout/)).toBeNull();
    // Receipt actions only — no checkout gate or resolution controls.
    expect(within(dialog).queryByRole('button', { name: 'Proceed to Checkout' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Print Invoice' })).toBeDefined();
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
  });
});
