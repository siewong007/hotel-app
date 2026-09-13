import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configure } from '@testing-library/dom';

// The payment idempotency suite below runs under fake timers with automatic
// advancement, so its waitFor windows no longer race wall-clock time. The
// raised async-util timeout stays as a cheap safety net for the remaining
// render-heavy waits in this file.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Booking, Guest } from '../../../types';

const mocks = vi.hoisted(() => ({
  checkInGuest: vi.fn(),
  recordPayment: vi.fn(),
  onClose: vi.fn(),
  onCheckInSuccess: vi.fn(),
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ symbol: 'RM', format: (amount: number) => `RM${Number(amount).toFixed(2)}` }),
}));

vi.mock('../../../utils/hotelSettings', () => ({
  getHotelSettings: () => ({
    deposit_amount: 50,
    payment_methods: ['Cash', 'Bank Transfer'],
  }),
}));

vi.mock('../../../api', () => ({
  BookingsService: {
    checkInGuest: (...args: unknown[]) => mocks.checkInGuest(...args),
    getCheckInAdvisory: vi.fn().mockResolvedValue(null),
  },
  CompaniesService: { createCompany: vi.fn() },
  LedgerService: {},
}));

vi.mock('../../../api/invoices.service', () => ({
  InvoicesService: {
    recordPayment: (...args: unknown[]) => mocks.recordPayment(...args),
  },
}));

vi.mock('../hooks/useCheckInFormData', () => ({
  useCheckInFormData: () => ({
    rateCodes: [],
    marketCodes: [],
    companyOptions: [],
    setCompanyOptions: vi.fn(),
    loadingCompanies: false,
    roomTypeConfig: null,
    setRoomTypeConfig: vi.fn(),
    loadDropdownData: vi.fn().mockResolvedValue(undefined),
    loadCompanies: vi.fn().mockResolvedValue(undefined),
    loadRoomTypeConfig: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../utils/bookingChannel', () => ({
  getBookingChannelInfo: () => null,
}));

import EnhancedCheckInModal from './EnhancedCheckInModal';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const booking: Booking = {
  id: '42',
  folio_number: 'F-42',
  room_id: '101',
  room_type: 'Deluxe',
  check_in_date: '2026-08-01T00:00:00.000Z',
  check_out_date: '2026-08-02T00:00:00.000Z',
  total_amount: 100,
  status: 'confirmed',
  payment_status: 'paid',
  payment_method: 'Cash',
  source: 'walk_in',
  deposit_paid: false,
  deposit_amount: 0,
} as Booking;

// A guest who has already supplied a legal name, so the payment suite below
// is not blocked by check-in's name validation. The nickname-only case is
// covered by the legal-name suite at the bottom of this file.
const guest: Guest = {
  id: 7,
  nick_name: 'Jane Doe',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  phone: '0123456789',
  ic_number: '990101-01-1234',
  is_active: true,
  guest_type: 'member',
} as Guest;

describe('EnhancedCheckInModal payment idempotency', () => {
  it('reports no critical axe violations', async () => {
    render(
      <EnhancedCheckInModal
        open
        booking={booking}
        guest={guest}
        onClose={mocks.onClose}
        onCheckInSuccess={mocks.onCheckInSuccess}
      />,
    );
    await screen.findByRole('dialog');
    // The dialog is portaled to document.body — audit the whole document.
    await expectNoCriticalAxeViolations(document.body);
  });

  beforeEach(() => {
    mocks.checkInGuest.mockReset().mockResolvedValue(undefined);
    mocks.recordPayment.mockReset();
    mocks.onClose.mockReset();
    mocks.onCheckInSuccess.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('retries only the payment after check-in, reuses its key, and rotates it after an amount edit', async () => {
    // Fake timers with automatic advancement make RTL's waitFor polling
    // deterministic under parallel-suite load; the code under test has no
    // timers of its own.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const timeout = new Error('timeout');
      mocks.checkInGuest
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('already checked in'));
      mocks.recordPayment
        .mockRejectedValueOnce(timeout)
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce({ id: 1 });

      render(
        <EnhancedCheckInModal
          open
          booking={booking}
          guest={guest}
          onClose={mocks.onClose}
          onCheckInSuccess={mocks.onCheckInSuccess}
        />,
      );

      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Check In' })).toBeDefined());

      fireEvent.click(within(dialog).getByRole('button', { name: 'Check In' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(1));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Check In' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(2));
      expect(mocks.checkInGuest).toHaveBeenCalledTimes(1);
      const firstRequest = mocks.recordPayment.mock.calls[0][0];
      const retryRequest = mocks.recordPayment.mock.calls[1][0];
      expect(firstRequest.payment_type).toBe('booking');
      expect(retryRequest.payment_type).toBe('booking');
      expect(retryRequest.idempotency_key).toBe(firstRequest.idempotency_key);

      fireEvent.click(within(dialog).getByRole('tab', { name: 'Payment' }));
      fireEvent.change(within(dialog).getByLabelText('Amount Paid'), { target: { value: '125' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Check In' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(3));
      const changedRequest = mocks.recordPayment.mock.calls[2][0];
      expect(changedRequest.idempotency_key).not.toBe(firstRequest.idempotency_key);
      expect(mocks.checkInGuest).toHaveBeenCalledTimes(1);
      expect(mocks.onCheckInSuccess).toHaveBeenCalledTimes(1);
      expect(mocks.onClose).toHaveBeenCalledTimes(1);
    } finally {
      // restoreAllMocks in afterEach does not restore timers.
      vi.useRealTimers();
    }
  });
});

describe('EnhancedCheckInModal legal name collection', () => {
  beforeEach(() => {
    mocks.checkInGuest.mockReset().mockResolvedValue(undefined);
    mocks.recordPayment.mockReset();
    mocks.onClose.mockReset();
    mocks.onCheckInSuccess.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderWith = async (overrides: Partial<Guest>) => {
    render(
      <EnhancedCheckInModal
        open
        booking={booking}
        guest={{ ...guest, ...overrides } as Guest}
        onClose={mocks.onClose}
        onCheckInSuccess={mocks.onCheckInSuccess}
      />,
    );
    return screen.findByRole('dialog');
  };

  it('asks for legal names on a nickname-only guest and does not split the nickname', async () => {
    const dialog = await renderWith({
      nick_name: 'CoolAlex',
      first_name: 'CoolAlex',
      last_name: null,
    });

    // The nickname is shown for orientation, never split into a legal name.
    expect(within(dialog).getByText(/Booked as:\s*CoolAlex/)).toBeDefined();

    const firstName = within(dialog).getByLabelText(/First Name/i) as HTMLInputElement;
    const lastName = within(dialog).getByLabelText(/Last Name/i) as HTMLInputElement;
    expect(firstName.value).toBe('');
    expect(lastName.value).toBe('');
    expect(firstName.disabled).toBe(false);
    expect(lastName.disabled).toBe(false);
  });

  it('prefills the legal name once it exists and drops the booked-as hint', async () => {
    const dialog = await renderWith({
      nick_name: 'CoolAlex',
      first_name: 'Aisha',
      last_name: 'Rahman',
    });

    const firstName = within(dialog).getByLabelText(/First Name/i) as HTMLInputElement;
    const lastName = within(dialog).getByLabelText(/Last Name/i) as HTMLInputElement;
    expect(firstName.value).toBe('Aisha');
    expect(lastName.value).toBe('Rahman');
    expect(within(dialog).queryByText(/Booked as:/)).toBeNull();
  });

  it('blocks check-in until both halves of the legal name are supplied', async () => {
    const dialog = await renderWith({
      nick_name: 'CoolAlex',
      first_name: 'CoolAlex',
      last_name: null,
    });

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Check In' })).toBeDefined(),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check In' }));

    await waitFor(() => expect(within(dialog).getByText('First name is required')).toBeDefined());
    expect(within(dialog).getByText('Last name is required')).toBeDefined();
    expect(mocks.checkInGuest).not.toHaveBeenCalled();
  });

  it('never sends the nickname back in the guest update', async () => {
    const dialog = await renderWith({
      nick_name: 'CoolAlex',
      first_name: 'CoolAlex',
      last_name: null,
    });

    fireEvent.change(within(dialog).getByLabelText(/First Name/i), {
      target: { value: 'Aisha' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Last Name/i), {
      target: { value: 'Rahman' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check In' }));

    await waitFor(() => expect(mocks.checkInGuest).toHaveBeenCalledTimes(1));
    const request = mocks.checkInGuest.mock.calls[0][1];
    expect(request.guest_update.first_name).toBe('Aisha');
    expect(request.guest_update.last_name).toBe('Rahman');
    expect('nick_name' in request.guest_update).toBe(false);
  });
});
