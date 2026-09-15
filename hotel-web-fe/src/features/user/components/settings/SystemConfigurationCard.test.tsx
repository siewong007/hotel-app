import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SystemConfigurationCard from './SystemConfigurationCard';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  rateCodes: ['BAR', 'COR'],
  marketCodes: ['OTA'] as string[],
  bookingChannels: [{ name: 'Booking.com', abbreviation: 'B.C' }] as Array<{ name: string; abbreviation: string }>,
  paymentMethods: ['Cash'] as string[],
}));

function renderCard({ isAdmin = true }: { isAdmin?: boolean } = {}) {
  return render(
    <SystemConfigurationCard
      isAdmin={isAdmin}
      rateCodes={mocks.rateCodes}
      onRateCodesChange={(v) => {
        mocks.rateCodes = typeof v === 'function' ? (v as (prev: string[]) => string[])(mocks.rateCodes) : v;
      }}
      marketCodes={mocks.marketCodes}
      onMarketCodesChange={(v) => {
        mocks.marketCodes = typeof v === 'function' ? (v as (prev: string[]) => string[])(mocks.marketCodes) : v;
      }}
      bookingChannels={mocks.bookingChannels}
      paymentMethods={mocks.paymentMethods}
      onPaymentMethodsChange={(v) => {
        mocks.paymentMethods = typeof v === 'function' ? (v as (prev: string[]) => string[])(mocks.paymentMethods) : v;
      }}
    />,
  );
}

describe('SystemConfigurationCard', () => {
  beforeEach(() => {
    mocks.rateCodes = ['BAR', 'COR'];
    mocks.marketCodes = ['OTA'];
    mocks.bookingChannels = [{ name: 'Booking.com', abbreviation: 'B.C' }];
    mocks.paymentMethods = ['Cash'];
  });

  afterEach(cleanup);

  it('renders existing code chips and the booking channel with its abbreviation', () => {
    renderCard();

    expect(screen.getByText('BAR')).toBeTruthy();
    expect(screen.getByText('COR')).toBeTruthy();
    expect(screen.getByText('OTA')).toBeTruthy();
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(screen.getByText('Booking.com (B.C)')).toBeTruthy();
  });

  it('uppercases and appends new rate codes via the Add button', () => {
    renderCard();

    fireEvent.change(screen.getByPlaceholderText('Add rate code'), {
      target: { value: 'promo' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    expect(mocks.rateCodes).toEqual(['BAR', 'COR', 'PROMO']);
  });

  it('deduplicates rate codes regardless of case', () => {
    renderCard();

    const input = screen.getByPlaceholderText('Add rate code');
    fireEvent.change(input, { target: { value: 'bar' } });
    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    fireEvent.click(addButtons[0]);

    expect(mocks.rateCodes).toEqual(['BAR', 'COR']);
  });

  it('removes a rate code through its chip delete control', () => {
    renderCard();

    const chip = screen.getByText('BAR').closest('.MuiChip-root')!;
    fireEvent.click(chip.querySelector('.MuiChip-deleteIcon')!);

    expect(mocks.rateCodes).toEqual(['COR']);
  });

  it('shows booking channels read-only with a manage link to /channels', () => {
    renderCard();

    // The JSON list is deprecated — no name/abbreviation inputs, no chip delete.
    expect(screen.queryByPlaceholderText(/Channel name/)).toBeNull();
    expect(screen.getByText('Booking.com (B.C)').querySelector('.MuiChip-deleteIcon')).toBeNull();
    expect(screen.getByRole('button', { name: /channels/i })).toBeTruthy();
  });

  it('adds a trimmed payment method', () => {
    renderCard();

    fireEvent.change(screen.getByPlaceholderText(/payment method/), {
      target: { value: '  E-Wallet  ' },
    });
    const buttons = screen.getAllByRole('button', { name: 'Add' });
    fireEvent.click(buttons[buttons.length - 1]);

    expect(mocks.paymentMethods).toEqual(['Cash', 'E-Wallet']);
  });

  it('disables inputs and hides chip deletion for non-admins', () => {
    renderCard({ isAdmin: false });

    expect((screen.getByPlaceholderText('Add rate code') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByPlaceholderText('Add market code').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('BAR').querySelector('.MuiChip-deleteIcon')).toBeNull();
  });
});
