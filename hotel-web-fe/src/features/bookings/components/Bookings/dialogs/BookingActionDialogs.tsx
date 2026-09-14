import React from 'react';
import type {
  BookingTimelineEntry,
  BookingWithDetails,
  PaymentWorkflowSummary,
  Room,
} from '../../../../../types';
import CheckoutInvoiceModals from '../../../../invoices/components/CheckoutInvoiceModals';
import type { CheckoutFlow } from '../../../../invoices/hooks/useCheckoutFlow';
import WorkflowDialog from './WorkflowDialog';
import ReleaseDialog from './ReleaseDialog';
import VoidDialog from './VoidDialog';
import ReactivateDialog from './ReactivateDialog';
import PaymentDialog, { type PaymentDialogContext } from './PaymentDialog';
import CheckInDialog from './CheckInDialog';
import EditBookingDialog from './EditBookingDialog';

/**
 * The mounted action dialogs previously inlined at the bottom of BookingsPage.
 * State and handlers live in `useBookingActions`; this component is the JSX
 * fragment both the list page and the /bookings/$bookingId detail page render.
 */
export interface BookingActionDialogsProps {
  checkIn: {
    open: boolean;
    booking: BookingWithDetails | null;
    onClose: () => void;
  };
  payment: {
    open: boolean;
    booking: BookingWithDetails | null;
    context: PaymentDialogContext;
    onClose: () => void;
  };
  workflow: {
    open: boolean;
    booking: BookingWithDetails | null;
    summary: PaymentWorkflowSummary | null;
    timeline: BookingTimelineEntry[];
    loading: boolean;
    onClose: () => void;
  };
  edit: {
    open: boolean;
    booking: BookingWithDetails | null;
    rooms: Room[];
    onClose: () => void;
  };
  release: {
    open: boolean;
    booking: BookingWithDetails | null;
    onClose: () => void;
  };
  voidBooking: {
    open: boolean;
    booking: BookingWithDetails | null;
    onClose: () => void;
  };
  reactivate: {
    open: boolean;
    booking: BookingWithDetails | null;
    onClose: () => void;
  };
  checkoutFlow: CheckoutFlow;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

const BookingActionDialogs: React.FC<BookingActionDialogsProps> = ({
  checkIn,
  payment,
  workflow,
  edit,
  release,
  voidBooking,
  reactivate,
  checkoutFlow,
  onError,
  onCompleted,
}) => (
  <>
    {/* Booking Workflow Dialog */}
    <WorkflowDialog
      open={workflow.open}
      booking={workflow.booking}
      summary={workflow.summary}
      timeline={workflow.timeline}
      loading={workflow.loading}
      onClose={workflow.onClose}
    />
    {/* Edit Booking Dialog (Admin Only) */}
    <EditBookingDialog
      open={edit.open}
      booking={edit.booking}
      rooms={edit.rooms}
      onClose={edit.onClose}
      onError={onError}
      onCompleted={onCompleted}
    />
    <ReleaseDialog
      open={release.open}
      booking={release.booking}
      onClose={release.onClose}
      onError={onError}
      onCompleted={onCompleted}
    />
    <VoidDialog
      open={voidBooking.open}
      booking={voidBooking.booking}
      onClose={voidBooking.onClose}
      onError={onError}
      onCompleted={onCompleted}
    />
    {/* Reactivate Booking Dialog */}
    <ReactivateDialog
      open={reactivate.open}
      booking={reactivate.booking}
      onClose={reactivate.onClose}
      onError={onError}
      onCompleted={onCompleted}
    />
    <PaymentDialog
      open={payment.open}
      booking={payment.booking}
      context={payment.context}
      onClose={payment.onClose}
      onError={onError}
      onCompleted={onCompleted}
    />
    {/* Shared checkout + read-only receipt modals */}
    <CheckoutInvoiceModals
      flow={checkoutFlow}
      onReceiptPaymentsChanged={() => { void onCompleted(); }}
    />
    {/* Check-In Dialog */}
    <CheckInDialog
      open={checkIn.open}
      booking={checkIn.booking}
      onClose={checkIn.onClose}
      onError={onError}
      onCompleted={onCompleted}
    />
  </>
);

export default BookingActionDialogs;
