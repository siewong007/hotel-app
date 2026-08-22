import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  paymentConfig: vi.fn(),
  portalSubmitBankTransfer: vi.fn(),
  portalUploadReceipt: vi.fn(),
  portalCreatePaypalOrder: vi.fn(),
  portalCapturePaypalOrder: vi.fn(),
  dashboardSubmitBankTransfer: vi.fn(),
  dashboardUploadReceipt: vi.fn(),
  dashboardCreatePaypalOrder: vi.fn(),
  dashboardCapturePaypalOrder: vi.fn(),
  paypalButtons: vi.fn(),
}));

vi.mock('../../../api/guestPortal.service', () => ({
  GuestPortalService: {
    paymentConfig: (...args: unknown[]) => mocks.paymentConfig(...args),
    submitBankTransfer: (...args: unknown[]) => mocks.portalSubmitBankTransfer(...args),
    uploadPaymentReceipt: (...args: unknown[]) => mocks.portalUploadReceipt(...args),
    createPaypalOrder: (...args: unknown[]) => mocks.portalCreatePaypalOrder(...args),
    capturePaypalOrder: (...args: unknown[]) => mocks.portalCapturePaypalOrder(...args),
  },
}));

vi.mock('../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    submitBankTransfer: (...args: unknown[]) => mocks.dashboardSubmitBankTransfer(...args),
    uploadPaymentReceipt: (...args: unknown[]) => mocks.dashboardUploadReceipt(...args),
    createPaypalOrder: (...args: unknown[]) => mocks.dashboardCreatePaypalOrder(...args),
    capturePaypalOrder: (...args: unknown[]) => mocks.dashboardCapturePaypalOrder(...args),
  },
}));

// PayPal's real SDK needs network + a live client id. Capture the callbacks the
// component wires up so tests can drive createOrder/onApprove directly. The
// real SDK always invokes the LATEST render's callbacks (createOrder runs,
// state updates, then the popup approves) — so the click handler must read
// through a ref instead of the possibly-stale render-time props.
// Every render of PayPalButtons appends its props here, so tests can wait for
// the re-render that carries the freshly-set pending-payment id.
const paypalPropsByRender: Record<string, unknown>[] = [];

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PayPalButtons: (props: Record<string, unknown>) => {
    mocks.paypalButtons(props);
    paypalPropsByRender.push(props);
    return (
      <button
        type="button"
        data-testid="paypal-pay"
        onClick={() => {
          void (async () => {
            const createOrder = paypalPropsByRender[
              paypalPropsByRender.length - 1
            ].createOrder as () => Promise<string>;
            const orderID = await createOrder();
            // The real popup takes long enough for React to commit the
            // pending-payment state that onApprove's closure reads; mimic it by
            // waiting for that re-render before approving.
            const onApprove = await vi.waitFor(() => {
              const latest = paypalPropsByRender[paypalPropsByRender.length - 1];
              if (paypalPropsByRender.length < 2) {
                throw new Error('waiting for post-create-order re-render');
              }
              return latest.onApprove as (d: { orderID: string }) => Promise<void>;
            });
            await onApprove({ orderID });
          })();
        }}
      >
        pay-with-paypal
      </button>
    );
  },
}));

import { GuestPaymentPanel } from './GuestPaymentPanel';

const baseConfig = {
  bank_details: {
    bank_name: 'Maybank',
    account_name: 'Salim Inn Sdn Bhd',
    account_number: '5123 4567 8901',
  },
  paypal_enabled: false,
  paypal_client_id: undefined as string | undefined,
};

function configWith(overrides: Partial<typeof baseConfig> = {}) {
  return { ...baseConfig, ...overrides };
}

describe('GuestPaymentPanel', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.paymentConfig.mockResolvedValue(configWith());
  });

  afterEach(cleanup);

  it('shows a loading state until the payment config resolves', async () => {
    mocks.paymentConfig.mockReturnValue(new Promise(() => {}));

    render(<GuestPaymentPanel mode="session" bookingId={7} token="portal-token" />);

    expect(screen.getByText('Loading payment options…')).toBeTruthy();
  });

  it('offers a retry when the payment config fails to load', async () => {
    mocks.paymentConfig.mockRejectedValueOnce(new Error('network down'));

    render(<GuestPaymentPanel mode="session" bookingId={7} token="portal-token" />);

    expect(await screen.findByText('network down')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Offline banking (bank transfer)')).toBeTruthy();
    expect(mocks.paymentConfig).toHaveBeenCalledTimes(2);
  }, 15000);

  it('submits a bank-transfer claim against the session booking and reports success', async () => {
    mocks.dashboardSubmitBankTransfer.mockResolvedValue({
      payment_id: 42,
      status: 'pending_verification',
    });

    const onPaid = vi.fn();
    render(<GuestPaymentPanel mode="session" bookingId={7} token="portal-token" onPaid={onPaid} />);

    fireEvent.click(await screen.findByText('Offline banking (bank transfer)'));
    fireEvent.click(screen.getByText("I've paid via bank transfer"));

    expect(await screen.findByText('Pending payment confirmation by our team.')).toBeTruthy();
    expect(mocks.dashboardSubmitBankTransfer).toHaveBeenCalledWith(7, 'portal-token');
    expect(mocks.dashboardUploadReceipt).not.toHaveBeenCalled();
    expect(onPaid).toHaveBeenCalledWith({ payment_id: 42, status: 'pending_verification' });
  });

  it('uploads an attached receipt with the claimed payment id', async () => {
    mocks.dashboardSubmitBankTransfer.mockResolvedValue({
      payment_id: 43,
      status: 'pending_verification',
    });

    render(<GuestPaymentPanel mode="session" bookingId={9} token="portal-token" />);

    fireEvent.click(await screen.findByText('Offline banking (bank transfer)'));
    const file = new File(['receipt-bytes'], 'receipt.png', { type: 'image/png' });
    const input = screen
      .getByLabelText(/Attach receipt/)
      .closest('label')
      ?.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText("I've paid via bank transfer"));

    await screen.findByText('Pending payment confirmation by our team.');
    expect(mocks.dashboardUploadReceipt).toHaveBeenCalledWith(43, file, 'portal-token');
  });

  it('routes pre-arrival (token mode) claims through the unauthenticated service', async () => {
    mocks.portalSubmitBankTransfer.mockResolvedValue({
      payment_id: 44,
      status: 'completed',
    });

    render(<GuestPaymentPanel mode="token" token="booking-token" />);

    fireEvent.click(await screen.findByText('Offline banking (bank transfer)'));
    fireEvent.click(screen.getByText("I've paid via bank transfer"));

    expect(await screen.findByText('Payment received — your booking is confirmed.')).toBeTruthy();
    expect(mocks.portalSubmitBankTransfer).toHaveBeenCalledWith('booking-token');
    expect(mocks.dashboardSubmitBankTransfer).not.toHaveBeenCalled();
  });

  it('ignores a second click while a bank-transfer claim is in flight', async () => {
    let release!: (value: { payment_id: number; status: string }) => void;
    mocks.dashboardSubmitBankTransfer.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    render(<GuestPaymentPanel mode="session" bookingId={7} token="portal-token" />);

    fireEvent.click(await screen.findByText('Offline banking (bank transfer)'));
    const submit = screen.getByText("I've paid via bank transfer");
    fireEvent.click(submit);
    fireEvent.click(submit);
    release({ payment_id: 50, status: 'pending_verification' });

    await waitFor(() =>
      expect(mocks.dashboardSubmitBankTransfer).toHaveBeenCalledTimes(1),
    );
  });

  it('hides the PayPal option when the hotel has it disabled', async () => {
    mocks.paymentConfig.mockResolvedValue(configWith({ paypal_enabled: false }));

    render(<GuestPaymentPanel mode="session" bookingId={7} token="portal-token" />);

    expect(await screen.findByText('Offline banking (bank transfer)')).toBeTruthy();
    expect(screen.queryByText('PayPal or debit / credit card')).toBeNull();
  });

  it('runs create-order then capture through the dashboard service and confirms', async () => {
    mocks.paymentConfig.mockResolvedValue(
      configWith({ paypal_enabled: true, paypal_client_id: 'test-client-id' }),
    );
    mocks.dashboardCreatePaypalOrder.mockResolvedValue({ order_id: 'ORDER-1', payment_id: 60 });
    mocks.dashboardCapturePaypalOrder.mockResolvedValue({
      payment_id: 60,
      status: 'completed',
    });

    const onPaid = vi.fn();
    render(
      <GuestPaymentPanel mode="session" bookingId={7} token="portal-token" onPaid={onPaid} />,
    );

    fireEvent.click(await screen.findByText('PayPal or debit / credit card'));
    expect(mocks.paypalButtons).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('paypal-pay'));

    await screen.findByText('Payment received — your booking is confirmed.');
    expect(mocks.dashboardCreatePaypalOrder).toHaveBeenCalledWith(7, 'portal-token');
    expect(mocks.dashboardCapturePaypalOrder).toHaveBeenCalledWith(7, 'ORDER-1', 60, 'portal-token');
    expect(onPaid).toHaveBeenCalledWith({ payment_id: 60, status: 'completed' });
  }, 15000);
});
