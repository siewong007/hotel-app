import { useCallback, useState } from 'react';
import type { BookingWithDetails, CustomerLedger } from '../../../types';
import { BookingsService, RoomsService } from '../../../api';
import { errorMessage } from '../../../utils/errorMessage';

export interface LateCheckoutData {
  penalty: number;
  notes: string;
}

type NotifySeverity = 'success' | 'error' | 'warning' | 'info';

export interface UseCheckoutFlowOptions {
  /**
   * How to persist the booking status update. Defaults to a direct API call.
   * Pages backed by react-query inject their mutation here so cache
   * invalidation/optimistic behavior is preserved (e.g. BookingsPage).
   */
  updateBooking?: (bookingId: string | number, payload: Record<string, unknown>) => Promise<unknown>;
  /** Refresh page data after a successful checkout. */
  onAfterCheckout?: () => Promise<void> | void;
  /**
   * Whether to explicitly mark the room `dirty` after checkout. Defaults to
   * `true`. The Bookings page relies on the backend doing this on the
   * `checked_out` transition, so it passes `false`.
   */
  setRoomDirty?: boolean;
  /**
   * Whether to forward late-checkout penalty/notes onto the booking update.
   * Defaults to `true`.
   */
  applyLateCheckout?: boolean;
  /** Build the success snackbar message. */
  successMessage?: (booking: BookingWithDetails, lateCheckoutData?: LateCheckoutData) => string;
  /** Surface a snackbar/toast. */
  notify?: (message: string, severity?: NotifySeverity) => void;
}

export interface CheckoutFlow {
  // Checkout (editable) modal state
  checkoutOpen: boolean;
  checkoutBooking: BookingWithDetails | null;
  openCheckout: (booking: BookingWithDetails) => void;
  closeCheckout: () => void;
  // Read-only receipt/invoice modal state
  receiptOpen: boolean;
  receiptBooking: BookingWithDetails | null;
  /** Set when the receipt is a company city-ledger invoice; payments are then
   * sourced from this ledger instead of the booking. */
  receiptLedger: CustomerLedger | null;
  openReceipt: (booking: BookingWithDetails, ledger?: CustomerLedger | null) => void;
  closeReceipt: () => void;
  // Shared confirm-checkout orchestration (matches CheckoutInvoiceModal's
  // onConfirmCheckout signature). Re-throws on error so the modal can display it.
  confirmCheckout: (lateCheckoutData?: LateCheckoutData, paymentMethod?: string) => Promise<void>;
}

/**
 * Shared checkout + receipt flow used by the Bookings, Customer Ledger, and
 * Room Management pages. Owns the modal state and the (previously duplicated)
 * confirm-checkout orchestration, parameterized per page.
 */
export function useCheckoutFlow(options: UseCheckoutFlowOptions = {}): CheckoutFlow {
  const {
    updateBooking = (bookingId, payload) => BookingsService.updateBooking(String(bookingId), payload),
    onAfterCheckout,
    setRoomDirty = true,
    applyLateCheckout = true,
    successMessage,
    notify,
  } = options;

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutBooking, setCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptBooking, setReceiptBooking] = useState<BookingWithDetails | null>(null);
  const [receiptLedger, setReceiptLedger] = useState<CustomerLedger | null>(null);

  const openCheckout = useCallback((booking: BookingWithDetails) => {
    setCheckoutBooking(booking);
    setCheckoutOpen(true);
  }, []);

  const closeCheckout = useCallback(() => {
    setCheckoutOpen(false);
    setCheckoutBooking(null);
  }, []);

  const openReceipt = useCallback((booking: BookingWithDetails, ledger: CustomerLedger | null = null) => {
    setReceiptBooking(booking);
    setReceiptLedger(ledger);
    setReceiptOpen(true);
  }, []);

  const closeReceipt = useCallback(() => {
    setReceiptOpen(false);
    setReceiptBooking(null);
    setReceiptLedger(null);
  }, []);

  const confirmCheckout = useCallback(
    async (lateCheckoutData?: LateCheckoutData, paymentMethod?: string) => {
      if (!checkoutBooking) return;

      try {
        const updatePayload: Record<string, unknown> = { status: 'checked_out' };
        if (paymentMethod) {
          updatePayload.payment_method = paymentMethod;
        }
        if (applyLateCheckout && lateCheckoutData) {
          updatePayload.late_checkout_penalty = lateCheckoutData.penalty;
          updatePayload.late_checkout_notes = lateCheckoutData.notes;
        }

        await updateBooking(checkoutBooking.id, updatePayload);

        // After checkout the room must be cleaned before the next guest. The
        // Bookings page leaves this to the backend's checked_out transition.
        if (setRoomDirty && checkoutBooking.room_id != null) {
          const dirtyNotes = lateCheckoutData
            ? `Room requires cleaning after late checkout. Late checkout penalty: ${lateCheckoutData.penalty}. Notes: ${lateCheckoutData.notes || 'None'}`
            : 'Room requires cleaning after checkout';
          await RoomsService.updateRoomStatus(checkoutBooking.room_id, {
            status: 'dirty',
            notes: dirtyNotes,
          });
        }

        if (notify) {
          const message = successMessage
            ? successMessage(checkoutBooking, lateCheckoutData)
            : `${checkoutBooking.guest_name || 'Guest'} checked out from Room ${checkoutBooking.room_number}`;
          notify(message, 'success');
        }

        // The modal closes itself on success via onClose; reset our state too.
        closeCheckout();
        await onAfterCheckout?.();
      } catch (error) {
        throw new Error(errorMessage(error, 'Failed to process checkout'));
      }
    },
    [checkoutBooking, updateBooking, setRoomDirty, applyLateCheckout, successMessage, notify, onAfterCheckout, closeCheckout],
  );

  return {
    checkoutOpen,
    checkoutBooking,
    openCheckout,
    closeCheckout,
    receiptOpen,
    receiptBooking,
    receiptLedger,
    openReceipt,
    closeReceipt,
    confirmCheckout,
  };
}
