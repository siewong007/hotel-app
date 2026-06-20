import React from 'react';
import CheckoutInvoiceModal from './CheckoutInvoiceModal';
import type { CheckoutFlow } from '../hooks/useCheckoutFlow';

interface CheckoutInvoiceModalsProps {
  flow: CheckoutFlow;
  /**
   * Render the read-only receipt modal. Defaults to `true`. The Room
   * Management page has no receipt view, so it can pass `false`.
   */
  withReceipt?: boolean;
}

/**
 * Renders the shared checkout (editable) and receipt (read-only) invoice
 * modals, both driven by a single `useCheckoutFlow` instance. Lets each page
 * mount the unified checkout/receipt experience with a single element.
 */
const CheckoutInvoiceModals: React.FC<CheckoutInvoiceModalsProps> = ({ flow, withReceipt = true }) => (
  <>
    <CheckoutInvoiceModal
      open={flow.checkoutOpen}
      onClose={flow.closeCheckout}
      booking={flow.checkoutBooking}
      onConfirmCheckout={flow.confirmCheckout}
    />
    {withReceipt && (
      <CheckoutInvoiceModal
        open={flow.receiptOpen}
        onClose={flow.closeReceipt}
        booking={flow.receiptBooking}
        readOnly
      />
    )}
  </>
);

export default CheckoutInvoiceModals;
