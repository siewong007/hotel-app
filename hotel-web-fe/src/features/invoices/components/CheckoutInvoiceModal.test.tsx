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
    updatePayment: vi.fn(),
    deletePayment: vi.fn(),
    refundDeposit: (...args: unknown[]) => mocks.refundDeposit(...args),
    forfeitDeposit: (...args: unknown[]) => mocks.forfeitDeposit(...args),
    revertDepositRefund: vi.fn(),
  },
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

function renderModal(ledgerView = false, overrides: Partial<BookingWithDetails> = {}) {
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
    />,
    { wrapper },
  );
}

async function paymentDialog() {
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Record Payment' })).toBeDefined());
  return dialog;
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
    // timers of its own (same pattern as the BookingsPage timezone test).
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
// nothing held and always refuses. The modal repairs that lazily at refund
// time: it asserts the collected amount through the booking update (the server
// mints the missing deposit payment under the booking lock), then refunds
// against the now-real ledger row.
describe('CheckoutInvoiceModal legacy deposit handling', () => {
  beforeEach(() => {
    mocks.updateBooking.mockReset().mockResolvedValue({});
    mocks.refundDeposit.mockReset().mockResolvedValue({ id: 9, payment_status: 'refunded' });
    mocks.setPayments.mockReset();
    mocks.setDepositRefunded.mockReset();
    mocks.payments = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('records the collected deposit via updateBooking before refunding a flag-only deposit', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(await within(dialog).findByRole('button', { name: /Refund RM50\.00/ }));

    await waitFor(() => expect(mocks.refundDeposit).toHaveBeenCalledWith('42', 'cash', 50));
    expect(mocks.updateBooking).toHaveBeenCalledWith('42', {
      deposit_paid: true,
      deposit_amount: 50,
    });
    // The collection assertion must land before the refund call so the
    // minted deposit row exists when the ceiling is evaluated.
    expect(mocks.updateBooking.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.refundDeposit.mock.invocationCallOrder[0]);
    expect(mocks.setDepositRefunded).toHaveBeenCalledWith(true);
  });

  it('does not assert a collection when a deposit payment already covers the refund', async () => {
    mocks.payments = [
      { id: 1, payment_status: 'completed', payment_type: 'deposit', total_amount: 50 },
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(await within(dialog).findByRole('button', { name: /Refund RM50\.00/ }));

    await waitFor(() => expect(mocks.refundDeposit).toHaveBeenCalledWith('42', 'cash', 50));
    expect(mocks.updateBooking).not.toHaveBeenCalled();
  });

  it('persists a deposit waive through updateBooking and unblocks checkout', async () => {
    // A completed booking payment zeroes the balance so the deposit gate is
    // the only thing holding "Proceed to Checkout" disabled.
    mocks.payments = [
      { id: 2, payment_status: 'completed', payment_type: 'booking', total_amount: 100 },
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    const proceed = within(dialog).getByRole('button', { name: 'Proceed to Checkout' });
    expect((proceed as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(
      within(dialog).getByPlaceholderText(/Reason for waiving deposit/i),
      { target: { value: 'Lost keycard' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Waive Deposit' }));

    await waitFor(() =>
      expect(mocks.updateBooking).toHaveBeenCalledWith('42', {
        deposit_paid: false,
        deposit_amount: 0,
        payment_note: 'Deposit waived: Lost keycard',
      }),
    );
    await waitFor(() =>
      expect((within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('keeps checkout locked and surfaces the error when the server rejects the waive', async () => {
    mocks.payments = [
      { id: 1, payment_status: 'completed', payment_type: 'deposit', total_amount: 50 },
      { id: 2, payment_status: 'completed', payment_type: 'booking', total_amount: 100 },
    ];
    mocks.updateBooking.mockRejectedValue(
      new Error('A deposit payment of 50.00 is recorded on this booking'),
    );
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(
      within(dialog).getByPlaceholderText(/Reason for waiving deposit/i),
      { target: { value: 'Lost keycard' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Waive Deposit' }));

    await waitFor(() =>
      expect(within(dialog).getByText(/deposit payment of 50\.00 is recorded/i)).toBeDefined(),
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
// affordances; a forfeit resolves the deposit through a real payment row.
describe('CheckoutInvoiceModal deposit display + forfeit', () => {
  const depositRow = { id: 1, payment_status: 'completed', payment_type: 'deposit', total_amount: 50, payment_method: 'cash' };
  const billPayment = { id: 2, payment_status: 'completed', payment_type: 'booking', total_amount: 100, payment_method: 'cash' };

  beforeEach(() => {
    mocks.forfeitDeposit.mockReset().mockResolvedValue({ id: 3, payment_status: 'completed', payment_type: 'deposit_forfeited', total_amount: 50 });
    mocks.reloadPayments.mockReset().mockResolvedValue(undefined);
    mocks.setPayments.mockReset();
    mocks.payments = [depositRow, billPayment];
  });

  afterEach(() => {
    cleanup();
  });

  it('shows Fully Paid — not Overpayment — when the bill is settled and a deposit is held', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('Fully Paid')).toBeDefined());
    expect(within(dialog).queryByText('Overpayment')).toBeNull();
    // The held deposit renders labeled, outside the bill-payments rows…
    expect(within(dialog).getByText('Deposit held')).toBeDefined();
    // …and carries no delete control — the only delete button in the folio
    // belongs to the real bill payment.
    expect(within(dialog).getAllByTestId('DeleteIcon')).toHaveLength(1);
    // An unresolved deposit still holds the checkout gate.
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps the real outstanding balance collectible when only part of the bill is paid', async () => {
    mocks.payments = [depositRow, { ...billPayment, total_amount: 40 }];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByText('Balance Due')).toBeDefined());
    expect(within(dialog).getByText('RM60.00')).toBeDefined();
    expect(within(dialog).getAllByRole('button', { name: 'Record Payment' }).length).toBeGreaterThan(0);
  });

  it('forfeits the deposit through the service and releases the checkout gate on a full forfeit', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    const proceed = within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement;
    expect(proceed.disabled).toBe(true);

    fireEvent.change(
      within(dialog).getByPlaceholderText(/Reason for forfeiting deposit/i),
      { target: { value: 'Lost keycard' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forfeit Deposit' }));

    await waitFor(() => expect(mocks.forfeitDeposit).toHaveBeenCalledWith('42', 50, 'Lost keycard'));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(mocks.reloadPayments).toHaveBeenCalled();
  });

  it('keeps the checkout gate locked after a partial forfeit', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Forfeit amount'), { target: { value: '20' } });
    fireEvent.change(
      within(dialog).getByPlaceholderText(/Reason for forfeiting deposit/i),
      { target: { value: 'Damaged keycard' } },
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forfeit Deposit' }));

    await waitFor(() => expect(mocks.forfeitDeposit).toHaveBeenCalledWith('42', 20, 'Damaged keycard'));
    // RM30 of the deposit is still held, so checkout stays blocked.
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('releases the checkout gate when forfeit rows on the ledger already cover the held deposit', async () => {
    // The deposit is resolved by the ledger itself — no click this session.
    // The flag is derived from the rows so an out-of-band un-forfeit (void of
    // the deposit_forfeited row) would re-arm the gate on the next reload.
    mocks.payments = [
      depositRow,
      { id: 3, payment_status: 'completed', payment_type: 'deposit_forfeited', total_amount: 50, payment_method: 'cash' },
      billPayment,
    ];
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText('Deposit forfeited')).toBeDefined();
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

    await waitFor(() => expect(within(dialog).getByText('Deposit forfeited')).toBeDefined());
    // RM30 of the deposit is still refundable, so checkout stays blocked.
    expect(
      (within(dialog).getByRole('button', { name: 'Proceed to Checkout' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // …and the forfeit field now defaults to the remaining refundable amount.
    expect((within(dialog).getByLabelText('Forfeit amount') as HTMLInputElement).value).toBe('30');
  });

  it('flags an over-ceiling forfeit amount and keeps the action disabled', async () => {
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Forfeit amount'), { target: { value: '60' } });
    fireEvent.change(
      within(dialog).getByPlaceholderText(/Reason for forfeiting deposit/i),
      { target: { value: 'Lost keycard' } },
    );

    await waitFor(() =>
      expect(within(dialog).getByText(/Cannot exceed refundable deposit of RM50\.00/)).toBeDefined(),
    );
    expect(
      (within(dialog).getByRole('button', { name: 'Forfeit Deposit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.forfeitDeposit).not.toHaveBeenCalled();
  });
});
