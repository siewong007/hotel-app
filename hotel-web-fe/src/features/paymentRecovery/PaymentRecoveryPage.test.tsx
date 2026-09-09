import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests, setActiveLocale } from '../../i18n/localeStore';

const mocks = vi.hoisted(() => ({
  view: vi.fn(),
  bankTransfer: vi.fn(),
}));

vi.mock('./api', () => ({
  PaymentRecoveryApi: {
    view: (...a: unknown[]) => mocks.view(...a),
    bankTransfer: (...a: unknown[]) => mocks.bankTransfer(...a),
  },
}));

import PaymentRecoveryPage from './PaymentRecoveryPage';

function renderPage(token = 'a'.repeat(64)) {
  // Retries off: an error state must render immediately rather than after the
  // default backoff, and these tests assert the error path.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<PaymentRecoveryPage token={token} />, { wrapper });
}

const liveLink = {
  booking_number: 'BK-2043',
  amount_due: '250.00',
  currency: 'MYR',
  expires_at: '2026-09-09T18:00:00Z',
  payment_methods: ['bank_transfer'],
  already_submitted: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetLocaleStoreForTests();
});

beforeEach(() => {
  mocks.view.mockResolvedValue(liveLink);
  mocks.bankTransfer.mockResolvedValue({
    payment_id: 91,
    status: 'pending',
    booking_status: 'pending_confirmation',
  });
});

describe('PaymentRecoveryPage', () => {
  it('shows the reservation and amount, and offers to pay', async () => {
    renderPage();
    expect(await screen.findByText('BK-2043')).toBeDefined();
    expect(screen.getByText('MYR 250.00')).toBeDefined();
    expect(screen.getByRole('button', { name: /bank transfer/i })).toBeDefined();
  });

  it('passes the token from the URL to the view call', async () => {
    const token = 'b'.repeat(64);
    renderPage(token);
    await waitFor(() => expect(mocks.view).toHaveBeenCalledWith(token));
  });

  it('never exposes guest identity on a page anyone holding the link can open', async () => {
    renderPage();
    await screen.findByText('BK-2043');
    // The response carries no name/email by design; assert the page did not
    // acquire one from somewhere else.
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('shows one generic message for an unusable link and no way to pay', async () => {
    mocks.view.mockRejectedValue(new Error('gone'));
    renderPage();
    expect(await screen.findByText(/no longer available/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /bank transfer/i })).toBeNull();
  });

  it('offers no payment form for a link that was already used', async () => {
    mocks.view.mockResolvedValue({ ...liveLink, already_submitted: true });
    renderPage();
    // A duplicate submission must be impossible from the UI; the server also
    // resolves a spent capability to the payment it already made.
    expect(await screen.findByText(/already used this link/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /bank transfer/i })).toBeNull();
  });

  it('submits a bank transfer claim and confirms it', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /bank transfer/i }));
    await waitFor(() => expect(mocks.bankTransfer).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/recorded your payment claim/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /bank transfer/i })).toBeNull();
  });

  it('reports a failed submission and leaves the guest able to retry', async () => {
    mocks.bankTransfer.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /bank transfer/i }));
    expect(await screen.findByText(/could not record your payment/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /bank transfer/i })).toBeDefined();
  });

  it('renders Malay copy when that locale is active', async () => {
    resetLocaleStoreForTests();
    setActiveLocale('ms');
    renderPage();
    expect(await screen.findByText(/Lengkapkan pembayaran anda/i)).toBeDefined();
  });
});
