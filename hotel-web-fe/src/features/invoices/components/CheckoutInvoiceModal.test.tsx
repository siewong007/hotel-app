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

const mocks = vi.hoisted(() => ({
  recordPayment: vi.fn(),
  createLedgerPayment: vi.fn(),
  setPayments: vi.fn(),
  reloadPayments: vi.fn(),
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (amount: number) => `RM${Number(amount).toFixed(2)}`, symbol: 'RM' }),
}));

vi.mock('../../../api', () => ({
  BookingsService: { updateBooking: vi.fn() },
}));

vi.mock('../../../api/invoices.service', () => ({
  InvoicesService: {
    recordPayment: (...args: unknown[]) => mocks.recordPayment(...args),
    updatePayment: vi.fn(),
    deletePayment: vi.fn(),
    refundDeposit: vi.fn(),
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
    payments: [],
    setPayments: (...args: unknown[]) => mocks.setPayments(...args),
    depositRefunded: false,
    setDepositRefunded: vi.fn(),
    editableDailyRates: {},
    setEditableDailyRates: vi.fn(),
    reloadPayments: (...args: unknown[]) => mocks.reloadPayments(...args),
  }),
}));

vi.mock('./CheckoutInvoicePrintView', () => ({ default: () => null }));

import CheckoutInvoiceModal from './CheckoutInvoiceModal';
import { ConfirmProvider } from '../../../components/common/ConfirmProvider';

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

function renderModal(ledgerView = false) {
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
      booking={booking}
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
