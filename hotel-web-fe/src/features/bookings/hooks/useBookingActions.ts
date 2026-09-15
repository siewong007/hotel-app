import { createElement, useState } from 'react';
import type {
  BookingTimelineEntry,
  BookingWithDetails,
  PaymentWorkflowSummary,
  Room,
} from '../../../types';
import { useCheckoutFlow } from '../../invoices/hooks/useCheckoutFlow';
import { LedgerService } from '../../../api/ledger.service';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { isPositiveMoney } from '../../../utils/money';
import {
  getBookingBalance,
  getErrorMessage,
  isCompanyBooking,
} from '../utils/bookingPageUtils';
import {
  useBookingWorkflowFetcher,
  useUpdateBooking,
} from './useBookingQueries';
import BookingActionDialogs from '../components/Bookings/dialogs/BookingActionDialogs';
import { useTranslation } from '../../../i18n';
import type { PaymentDialogContext } from '../components/Bookings/dialogs/PaymentDialog';

/** The action callbacks BookingDetailsPanel (and its phone action menu) fire. */
export interface BookingActionCallbacks {
  /** Takes the booking itself. It used to take an id and resolve it against a
   *  lookup pool, which tied check-in to a full-table fetch that no longer
   *  exists -- and every caller already holds the row. */
  onCheckIn: (booking: BookingWithDetails) => void;
  onCheckOut: (booking: BookingWithDetails) => void;
  onPayment: (booking: BookingWithDetails) => void;
  onWorkflow: (booking: BookingWithDetails) => void;
  onEdit: (booking: BookingWithDetails) => void;
  onInvoice: (booking: BookingWithDetails) => void;
  onRelease: (booking: BookingWithDetails) => void;
  onVoid: (booking: BookingWithDetails) => void;
  onReactivate: (booking: BookingWithDetails) => void;
}

export interface UseBookingActionsOptions {
  /** Room list handed to the edit dialog's room picker. */
  rooms: Room[];
  /** Page-level error surface (BookingsPage's `setError`, detail page's alert). */
  onError: (message: string) => void;
  /** Reload page data after a mutation completes (list refetch / detail refetch). */
  onCompleted: () => Promise<void> | void;
}

/**
 * Owns every booking-action dialog mounted by BookingsPage — CheckIn, Payment,
 * Workflow, Edit, Invoice (checkout/receipt flow), Release, Void, Reactivate —
 * plus the mutations and fetchers behind them. Extracted verbatim so the
 * `/bookings/$bookingId` detail page drives the same workflows.
 *
 * Returns `{ callbacks, dialogs }`: spread `callbacks` onto
 * `BookingDetailsPanel` and render `dialogs` once near the page root.
 */
export function useBookingActions({
  rooms,
  onError,
  onCompleted,
}: UseBookingActionsOptions) {
  const { t } = useTranslation('bookings');
  const updateBookingMutation = useUpdateBooking();

  const showSnackbar = (message: string) => {
    emitApiNotification({ message, severity: 'success' });
  };

  // Shared checkout + read-only receipt flow. Bookings keeps its react-query
  // mutation (cache invalidation) and lets the backend mark the room dirty.
  const checkoutFlow = useCheckoutFlow({
    updateBooking: (bookingId, data) => updateBookingMutation.mutateAsync({ bookingId: String(bookingId), data }),
    setRoomDirty: false,
    onAfterCheckout: () => onCompleted(),
    successMessage: () => 'Guest checked out successfully!',
    notify: (message) => showSnackbar(message),
  });

  const fetchBookingWorkflow = useBookingWorkflowFetcher();

  const [checkinBooking, setCheckinBooking] = useState<BookingWithDetails | null>(null);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [workflowBooking, setWorkflowBooking] = useState<BookingWithDetails | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<PaymentWorkflowSummary | null>(null);
  const [workflowTimeline, setWorkflowTimeline] = useState<BookingTimelineEntry[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);

  // Edit booking dialog (admin only)
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);

  // Release / void / reactivate dialogs
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [releasingBooking, setReleasingBooking] = useState<BookingWithDetails | null>(null);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingBooking, setVoidingBooking] = useState<BookingWithDetails | null>(null);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [reactivatingBooking, setReactivatingBooking] = useState<BookingWithDetails | null>(null);

  // Payment status update dialog
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState<BookingWithDetails | null>(null);
  const [paymentDialogContext, setPaymentDialogContext] = useState<PaymentDialogContext>('manual');

  const handleEditBooking = (booking: BookingWithDetails) => {
    setEditingBooking(booking);
    setEditDialogOpen(true);
  };

  const handleReleaseBooking = (booking: BookingWithDetails) => {
    setReleasingBooking(booking);
    setReleaseDialogOpen(true);
  };

  const handleVoidBooking = (booking: BookingWithDetails) => {
    setVoidingBooking(booking);
    setVoidDialogOpen(true);
  };

  const handleReactivateBooking = (booking: BookingWithDetails) => {
    setReactivatingBooking(booking);
    setReactivateDialogOpen(true);
  };

  // Payment status handlers
  const handleUpdatePaymentStatus = (booking: BookingWithDetails) => {
    setPaymentBooking(booking);
    setPaymentDialogContext('manual');
    setPaymentDialogOpen(true);
  };

  const handleCheckIn = (booking: BookingWithDetails) => {
    setCheckinBooking(booking);
    setShowCheckinModal(true);
  };

  /** Same thing under the name the create flow calls it by. */
  const openCheckInDialog = handleCheckIn;

  // View invoice for checked-out bookings. For company city-ledger bookings the
  // payments live on the customer ledger (not the booking `payments` table), so
  // look up the backing room-charge ledger and pass it through — the invoice
  // then renders the ledger's payment history, same as the ledger page.
  const handleViewInvoice = async (booking: BookingWithDetails) => {
    const isCompanyBilling = isCompanyBooking(booking);
    if (!isCompanyBilling) {
      checkoutFlow.openReceipt(booking);
      return;
    }
    try {
      const ledger = await LedgerService.getRoomChargeLedgerForBooking(
        Number(booking.id),
        booking.room_number,
      );
      checkoutFlow.openReceipt(booking, ledger);
    } catch {
      // Fall back to the booking-sourced receipt if the ledger lookup fails.
      checkoutFlow.openReceipt(booking);
    }
  };

  const handleViewWorkflow = async (booking: BookingWithDetails) => {
    setWorkflowBooking(booking);
    setWorkflowDialogOpen(true);
    setWorkflowLoading(true);
    setWorkflowSummary(null);
    setWorkflowTimeline([]);

    try {
      const [summary, timeline] = await fetchBookingWorkflow(booking.id);
      setWorkflowSummary(summary);
      setWorkflowTimeline(timeline);
    } catch (err: unknown) {
      onError(getErrorMessage(err) || t('workflow.loadFailed'));
    } finally {
      setWorkflowLoading(false);
    }
  };

  // Check-out functions
  const handleCheckOut = (booking: BookingWithDetails) => {
    const balanceDue = getBookingBalance(booking);
    if (isPositiveMoney(balanceDue) && !isCompanyBooking(booking)) {
      setPaymentBooking(booking);
      setPaymentDialogContext('checkout_required');
      setPaymentDialogOpen(true);
      return;
    }

    checkoutFlow.openCheckout(booking);
  };

  const callbacks: BookingActionCallbacks = {
    onCheckIn: handleCheckIn,
    onCheckOut: handleCheckOut,
    onPayment: handleUpdatePaymentStatus,
    onWorkflow: handleViewWorkflow,
    onEdit: handleEditBooking,
    onInvoice: handleViewInvoice,
    onRelease: handleReleaseBooking,
    onVoid: handleVoidBooking,
    onReactivate: handleReactivateBooking,
  };

  // `.ts` file: the mounted dialog fragment is built via createElement so the
  // JSX itself stays verbatim inside BookingActionDialogs.
  const dialogs = createElement(BookingActionDialogs, {
    checkIn: {
      open: showCheckinModal,
      booking: checkinBooking,
      onClose: () => { setShowCheckinModal(false); setCheckinBooking(null); },
    },
    payment: {
      open: paymentDialogOpen,
      booking: paymentBooking,
      context: paymentDialogContext,
      onClose: () => {
        setPaymentDialogOpen(false);
        setPaymentBooking(null);
        setPaymentDialogContext('manual');
      },
    },
    workflow: {
      open: workflowDialogOpen,
      booking: workflowBooking,
      summary: workflowSummary,
      timeline: workflowTimeline,
      loading: workflowLoading,
      onClose: () => setWorkflowDialogOpen(false),
    },
    edit: {
      open: editDialogOpen,
      booking: editingBooking,
      rooms,
      onClose: () => setEditDialogOpen(false),
    },
    release: {
      open: releaseDialogOpen,
      booking: releasingBooking,
      onClose: () => setReleaseDialogOpen(false),
    },
    voidBooking: {
      open: voidDialogOpen,
      booking: voidingBooking,
      onClose: () => setVoidDialogOpen(false),
    },
    reactivate: {
      open: reactivateDialogOpen,
      booking: reactivatingBooking,
      onClose: () => setReactivateDialogOpen(false),
    },
    checkoutFlow,
    onError,
    onCompleted,
  });

  return { callbacks, dialogs, openCheckInDialog };
}
