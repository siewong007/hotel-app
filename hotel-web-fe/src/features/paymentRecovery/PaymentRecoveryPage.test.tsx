import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests, setActiveLocale } from '../../i18n/localeStore';

const mocks = vi.hoisted(() => ({
  view: vi.fn(),
  bankTransfer: vi.fn(),
  paypalCreateOrder: vi.fn(),
  paypalCapture: vi.fn(),
  uploadReceipt: vi.fn(),
  scriptRejected: { value: false },
}));

vi.mock('./api', () => ({
  PaymentRecoveryApi: {
    view: (...a: unknown[]) => mocks.view(...a),
    bankTransfer: (...a: unknown[]) => mocks.bankTransfer(...a),
    paypalCreateOrder: (...a: unknown[]) => mocks.paypalCreateOrder(...a),
    paypalCapture: (...a: unknown[]) => mocks.paypalCapture(...a),
    uploadReceipt: (...a: unknown[]) => mocks.uploadReceipt(...a),
  },
}));

// Stand in for PayPal's hosted script. The button drives the real
// createOrder -> onApprove sequence so the page's own wiring is exercised.
vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePayPalScriptReducer: () => [{ isRejected: mocks.scriptRejected.value }, vi.fn()],
  PayPalButtons: (props: Record<string, unknown>) => (
    <button
      type="button"
      data-testid="paypal-pay"
      onClick={() => {
        void (async () => {
          const orderId = await (props.createOrder as () => Promise<string>)();
          await (props.onApprove as (d: { orderID: string }) => Promise<void>)({
            orderID: orderId,
          });
        })().catch(() => {});
      }}
    >
      PayPal
    </button>
  ),
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
  payment_methods: ['bank_transfer', 'paypal'],
  paypal_client_id: 'test-client-id',
  payment_id: null,
  receipt_uploadable: false,
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
  mocks.paypalCreateOrder.mockResolvedValue({ order_id: 'ORDER-7', payment_id: 555 });
  mocks.paypalCapture.mockResolvedValue({
    payment_id: 555,
    status: 'completed',
    booking_status: 'confirmed',
  });
  mocks.uploadReceipt.mockResolvedValue(undefined);
  mocks.scriptRejected.value = false;
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

  it('captures the order against the payment create-order returned, not any other', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('paypal-pay'));
    await waitFor(() => expect(mocks.paypalCapture).toHaveBeenCalledTimes(1));
    // Scope: the server refuses a capture for any payment other than the one
    // this capability produced, so the id must come from create-order.
    expect(mocks.paypalCapture).toHaveBeenCalledWith(
      'a'.repeat(64),
      'ORDER-7',
      555,
    );
    expect(await screen.findByText(/recorded your payment claim/i)).toBeDefined();
  });

  it('authorises only one order per click sequence', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('paypal-pay'));
    await waitFor(() => expect(mocks.paypalCapture).toHaveBeenCalledTimes(1));
    expect(mocks.paypalCreateOrder).toHaveBeenCalledTimes(1);
  });

  it('hides PayPal when the deployment has no PayPal credentials', async () => {
    mocks.view.mockResolvedValue({
      ...liveLink,
      payment_methods: ['bank_transfer'],
      paypal_client_id: null,
    });
    renderPage();
    await screen.findByRole('button', { name: /bank transfer/i });
    expect(screen.queryByTestId('paypal-pay')).toBeNull();
  });

  it('explains when PayPal\u2019s own script cannot load', async () => {
    mocks.scriptRejected.value = true;
    renderPage();
    expect(await screen.findByText(/could not load/i)).toBeDefined();
    expect(screen.queryByTestId('paypal-pay')).toBeNull();
  });

  it('reports a failed PayPal capture without claiming the booking is paid', async () => {
    mocks.paypalCapture.mockRejectedValue(new Error('gateway down'));
    renderPage();
    fireEvent.click(await screen.findByTestId('paypal-pay'));
    expect(await screen.findByText(/could not start your PayPal payment/i)).toBeDefined();
    expect(screen.queryByText(/recorded your payment claim/i)).toBeNull();
  });

  it('offers a receipt upload once a bank transfer claim is raised', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /bank transfer/i }));
    expect(await screen.findByText(/transfer receipt/i)).toBeDefined();

    const file = new File(['x'], 'receipt.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mocks.uploadReceipt).toHaveBeenCalledTimes(1));
    // Scoped to the payment the claim produced, not to anything the page chose.
    expect(mocks.uploadReceipt).toHaveBeenCalledWith('a'.repeat(64), 91, file);
    expect(await screen.findByText(/Receipt received/i)).toBeDefined();
  });

  it('lets a guest who returns later attach evidence to the earlier claim', async () => {
    mocks.view.mockResolvedValue({
      ...liveLink,
      already_submitted: true,
      payment_id: 404,
      receipt_uploadable: true,
    });
    renderPage();
    expect(await screen.findByText(/transfer receipt/i)).toBeDefined();

    const file = new File(['x'], 'receipt.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(mocks.uploadReceipt).toHaveBeenCalledWith('a'.repeat(64), 404, file),
    );
  });

  it('does not offer a receipt upload after a PayPal capture', async () => {
    // payment_id is set, so only the server's receipt_uploadable=false can
    // suppress the upload -- without it this test would pass for the wrong
    // reason.
    mocks.view.mockResolvedValue({ ...liveLink, payment_id: 777, receipt_uploadable: false });
    renderPage();
    fireEvent.click(await screen.findByTestId('paypal-pay'));
    await waitFor(() => expect(mocks.paypalCapture).toHaveBeenCalledTimes(1));
    // A captured card payment needs no evidence, and the server refuses one.
    expect(screen.queryByText(/transfer receipt/i)).toBeNull();
  });

  it('offers the upload on reload only when the server still wants evidence', async () => {
    mocks.view.mockResolvedValue({
      ...liveLink,
      already_submitted: true,
      payment_id: 888,
      receipt_uploadable: false,
    });
    renderPage();
    expect(await screen.findByText(/already used this link/i)).toBeDefined();
    expect(screen.queryByText(/transfer receipt/i)).toBeNull();
  });

  it('reports a rejected receipt without claiming it was accepted', async () => {
    mocks.uploadReceipt.mockRejectedValue(new Error('bad file'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /bank transfer/i }));
    await screen.findByText(/transfer receipt/i);

    const file = new File(['x'], 'virus.exe', { type: 'application/octet-stream' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/could not accept that file/i)).toBeDefined();
    expect(screen.queryByText(/Receipt received/i)).toBeNull();
  });
});
