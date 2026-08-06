import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const guest: Guest = {
  id: 7,
  full_name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '0123456789',
  ic_number: '990101-01-1234',
  is_active: true,
  guest_type: 'member',
} as Guest;

describe('EnhancedCheckInModal payment idempotency', () => {
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
    expect(mocks.recordPayment.mock.calls[1][0].idempotency_key).toBe(firstRequest.idempotency_key);

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Payment' }));
    fireEvent.change(within(dialog).getByLabelText('Amount Paid'), { target: { value: '125' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check In' }));
    await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(3));
    const changedRequest = mocks.recordPayment.mock.calls[2][0];
    expect(changedRequest.idempotency_key).not.toBe(firstRequest.idempotency_key);
    expect(mocks.checkInGuest).toHaveBeenCalledTimes(1);
    expect(mocks.onCheckInSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });
});
