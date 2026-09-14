import { useCallback, useMemo, useState } from 'react';
import type { BookingWithDetails } from '../../../types';
import { BookingsService } from '../../../api';
import { InvoicesService } from '../../../api/invoices.service';
import { errorMessage } from '../../../utils/errorMessage';
import {
  isGreaterMoney,
  isPositiveMoney,
  subtractMoney,
  sumMoney,
  toMoneyNumber,
} from '../../../utils/money';
import type { CheckoutPaymentRecord } from '../types';

/**
 * Derived deposit lifecycle for the checkout invoice. The payments ledger is
 * the sole money authority; `bookings.deposit_{paid,amount}` is a synced
 * mirror that a legacy booking can assert with no payment rows at all.
 * See docs/superpowers/specs/2026-09-14-deposit-resolution-design.md.
 */
export type DepositResolutionStatus =
  | 'none'
  | 'pending'
  | 'refunded'
  | 'partially_forfeited'
  | 'forfeited'
  | 'cancelled'
  | 'waived';

export interface DepositResolution {
  /** Σ payment_type='deposit' & status='completed'. */
  collected: number;
  /** Σ payment_type='refund' & status='refunded'. */
  refunded: number;
  /** Σ payment_type='deposit_forfeited' & status='completed'. */
  forfeited: number;
  /** collected − refunded − forfeited — the refundable ceiling the backend enforces. */
  remaining: number;
  /** Tender of the latest completed deposit row, when one exists. */
  method: string | null;
  /** Timestamp of the latest completed deposit row (falls back to the booking mirror's deposit_paid_at). */
  collectedAt: string | null;
  status: DepositResolutionStatus;
  /** Voided deposit rows — restorable via restoreDeposit(). */
  voidedDepositCount: number;
  /** booking.deposit_paid ? booking.deposit_amount : 0 — mirror, not money. */
  mirrorDue: number;
}

export interface UseDepositResolutionOptions {
  booking: BookingWithDetails | null;
  /** All payment rows for the booking — voided rows included (the cancelled/restorable state counts them). */
  payments: CheckoutPaymentRecord[];
  /** Refetch the booking's payment rows after a mutation. */
  reloadPayments: () => Promise<void> | void;
  /** Surface a mutation error into the modal's single error alert. */
  setError: (message: string | null) => void;
  /**
   * Invalidate the invoice/booking query caches after a mutation — the
   * modal's `invalidateInvoiceState` (invoices payments + preview, booking
   * detail/workflow keys).
   */
  invalidateInvoiceState?: () => void;
  /**
   * Caller-derived flag: the booking mirror was cleared via a waive. The
   * hook deliberately doesn't sniff `payment_note` — the modal owns that
   * legacy detection (local flag OR note text) and passes the result here.
   */
  depositWaived?: boolean;
}

export interface RefundDepositArgs {
  method: string;
  reference?: string;
  note?: string;
}

export interface ForfeitDepositArgs {
  amount: number;
  reason: string;
  notes?: string;
}

export interface UseDepositResolutionResult {
  deposit: DepositResolution;
  refunding: boolean;
  forfeiting: boolean;
  cancelling: boolean;
  reverting: boolean;
  restoring: boolean;
  refund: (args: RefundDepositArgs) => Promise<boolean>;
  forfeit: (args: ForfeitDepositArgs) => Promise<boolean>;
  cancelUncollected: (reason: string) => Promise<boolean>;
  revertRefund: () => Promise<boolean>;
  restoreDeposit: () => Promise<boolean>;
}

const paymentType = (payment: CheckoutPaymentRecord): string =>
  (payment.payment_type || '').toLowerCase();

const paymentTimestamp = (payment: CheckoutPaymentRecord): string =>
  payment.payment_date || payment.created_at || '';

const isCompletedDepositRow = (payment: CheckoutPaymentRecord): boolean =>
  paymentType(payment) === 'deposit' && payment.payment_status === 'completed';

/**
 * Pure deposit-status derivation over the payment rows + booking mirror.
 *
 * collected  = Σ deposit/completed        forfeited = Σ deposit_forfeited/completed
 * refunded   = Σ refund/refunded          remaining = collected − refunded − forfeited
 * mirrorDue  = deposit_paid ? deposit_amount : 0
 *
 * pending:            remaining > 0, OR collected = 0 AND mirrorDue > 0
 * refunded:           remaining = 0, refunded > 0, forfeited = 0
 * forfeited:          remaining = 0, forfeited > 0, refunded = 0
 * partially_forfeited: remaining = 0, refunded > 0 AND forfeited > 0
 * cancelled:          collected = 0 AND voided deposit rows exist
 * waived:             the caller reports the mirror was cleared via waive
 * none:               nothing recorded
 */
export function deriveDepositResolution(
  payments: CheckoutPaymentRecord[],
  booking: BookingWithDetails | null,
  depositWaived = false,
): DepositResolution {
  const collected = sumMoney(
    payments.filter(isCompletedDepositRow).map((p) => p.total_amount),
  );
  const refunded = sumMoney(
    payments
      .filter((p) => paymentType(p) === 'refund' && p.payment_status === 'refunded')
      .map((p) => p.total_amount),
  );
  const forfeited = sumMoney(
    payments
      .filter((p) => paymentType(p) === 'deposit_forfeited' && p.payment_status === 'completed')
      .map((p) => p.total_amount),
  );
  const remaining = subtractMoney(subtractMoney(collected, refunded), forfeited);
  const voidedDepositCount = payments.filter(
    (p) => paymentType(p) === 'deposit' && p.payment_status === 'void',
  ).length;
  const mirrorDue = booking?.deposit_paid ? toMoneyNumber(booking.deposit_amount) : 0;

  // The latest completed deposit row carries the collection tender + time —
  // multiple rows are possible (the mirror mints a delta row when the
  // asserted amount grows).
  const latestDepositRow = payments
    .filter(isCompletedDepositRow)
    .reduce<CheckoutPaymentRecord | null>((latest, row) => {
      if (!latest) return row;
      const rowTs = paymentTimestamp(row);
      const latestTs = paymentTimestamp(latest);
      return rowTs > latestTs || (rowTs === latestTs && row.id > latest.id) ? row : latest;
    }, null);

  const status: DepositResolutionStatus = (() => {
    // Money still held dominates every other state — a partially refunded or
    // partially forfeited deposit is still pending while a remainder is owed.
    if (isPositiveMoney(remaining)) return 'pending';
    // The caller-flagged waive wins over the mirror-due pending path: the
    // flag lands locally while the post-waive booking refetch is in flight.
    if (depositWaived) return 'waived';
    // Flag-only legacy deposit: no rows, but the mirror still asserts money
    // held (the backend checkout gate reads max(collected, mirror) too).
    if (!isPositiveMoney(collected) && isPositiveMoney(mirrorDue)) return 'pending';
    // Reaching here means remaining <= 0 — fully resolved money states.
    if (isPositiveMoney(refunded) && isPositiveMoney(forfeited)) return 'partially_forfeited';
    if (isPositiveMoney(refunded)) return 'refunded';
    if (isPositiveMoney(forfeited)) return 'forfeited';
    if (!isPositiveMoney(collected) && voidedDepositCount > 0) return 'cancelled';
    return 'none';
  })();

  return {
    collected,
    refunded,
    forfeited,
    remaining,
    method: latestDepositRow?.payment_method ?? null,
    collectedAt: latestDepositRow
      ? paymentTimestamp(latestDepositRow) || null
      : booking?.deposit_paid_at ?? null,
    status,
    voidedDepositCount,
    mirrorDue,
  };
}

/**
 * Deposit derivation + the mutation handlers extracted from
 * CheckoutInvoiceModal. Confirm-dialog prompts deliberately stay out — the
 * modal owns that orchestration and calls these actions after acceptance.
 * Every handler: set busy, clear the alert, mutate, reload payments +
 * invalidate caches, surface `toApiError`-wrapped failures via setError.
 */
export function useDepositResolution({
  booking,
  payments,
  reloadPayments,
  setError,
  invalidateInvoiceState,
  depositWaived = false,
}: UseDepositResolutionOptions): UseDepositResolutionResult {
  const [refunding, setRefunding] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const deposit = useMemo(
    () => deriveDepositResolution(payments, booking, depositWaived),
    [payments, booking, depositWaived],
  );
  const completedDepositRows = useMemo(
    () => payments.filter(isCompletedDepositRow),
    [payments],
  );

  const refund = useCallback(
    async ({ method, reference, note }: RefundDepositArgs): Promise<boolean> => {
      if (!booking) return false;
      // Fixed full-amount refund — always the whole remaining refundable
      // balance (a partial outcome is reached via partial forfeit → refund
      // remainder; the backend's one-active-refund rule makes partial
      // refunds a trap). For a flag-only legacy deposit the held amount is
      // the mirror — the assert below mints the matching row first.
      const amount = isPositiveMoney(deposit.remaining) ? deposit.remaining : deposit.mirrorDue;
      if (!isPositiveMoney(amount)) return false;
      setRefunding(true);
      setError('');
      try {
        if (booking.deposit_paid && completedDepositRows.length === 0) {
          // Legacy bookings carry the deposit only in booking columns with
          // no deposit payment row, so the refund ceiling sees nothing held.
          // Asserting the collected amount through the booking update mints
          // the missing deposit payment under the booking lock — it must
          // land before the refund call.
          await BookingsService.updateBooking(booking.id, {
            deposit_paid: true,
            deposit_amount: deposit.mirrorDue,
          });
        }
        await InvoicesService.refundDeposit(booking.id, method, amount, {
          transaction_reference: reference,
          note,
        });
        await reloadPayments();
        invalidateInvoiceState?.();
        return true;
      } catch (err) {
        setError(errorMessage(err, 'Failed to refund deposit'));
        return false;
      } finally {
        setRefunding(false);
      }
    },
    [booking, deposit, completedDepositRows, reloadPayments, setError, invalidateInvoiceState],
  );

  const forfeit = useCallback(
    async ({ amount, reason, notes }: ForfeitDepositArgs): Promise<boolean> => {
      const trimmedReason = reason.trim();
      const forfeitAmount = toMoneyNumber(amount);
      if (!booking || !trimmedReason || !isPositiveMoney(forfeitAmount)) return false;
      // Client-side cap: a button's disabled state isn't a real guard for
      // keyboard/programmatic paths — refuse over-ceiling forfeits locally
      // instead of relying on the backend 400.
      if (isGreaterMoney(forfeitAmount, deposit.remaining)) {
        setError('Forfeit amount cannot exceed the refundable deposit');
        return false;
      }
      setForfeiting(true);
      setError('');
      try {
        await InvoicesService.forfeitDeposit(booking.id, forfeitAmount, trimmedReason, notes);
        await reloadPayments();
        invalidateInvoiceState?.();
        return true;
      } catch (err) {
        setError(errorMessage(err, 'Failed to forfeit deposit'));
        return false;
      } finally {
        setForfeiting(false);
      }
    },
    [booking, deposit.remaining, reloadPayments, setError, invalidateInvoiceState],
  );

  // One "cancel uncollected deposit" choice that auto-routes: no completed
  // deposit rows → the deposit is only a mirror assertion, cleared via a
  // waive; rows exist → void each (kept server-side as 'void', restorable).
  const cancelUncollected = useCallback(
    async (reason: string): Promise<boolean> => {
      const trimmedReason = reason.trim();
      if (!booking || !trimmedReason) return false;
      setCancelling(true);
      setError('');
      try {
        if (completedDepositRows.length === 0) {
          // The 'Deposit waived' vocabulary is load-bearing: reopen
          // detection sniffs 'waived' in payment_note — keep the phrase.
          await BookingsService.updateBooking(booking.id, {
            deposit_paid: false,
            deposit_amount: 0,
            payment_note: booking.payment_note
              ? `${booking.payment_note} | Deposit waived: ${trimmedReason}`
              : `Deposit waived: ${trimmedReason}`,
          });
        } else {
          for (const row of completedDepositRows) {
            await InvoicesService.deletePayment(row.id);
          }
        }
        await reloadPayments();
        invalidateInvoiceState?.();
        return true;
      } catch (err) {
        setError(errorMessage(err, 'Failed to cancel deposit'));
        return false;
      } finally {
        setCancelling(false);
      }
    },
    [booking, completedDepositRows, reloadPayments, setError, invalidateInvoiceState],
  );

  const revertRefund = useCallback(async (): Promise<boolean> => {
    if (!booking) return false;
    setReverting(true);
    setError('');
    try {
      await InvoicesService.revertDepositRefund(booking.id);
      await reloadPayments();
      invalidateInvoiceState?.();
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Failed to revert deposit refund'));
      return false;
    } finally {
      setReverting(false);
    }
  }, [booking, reloadPayments, setError, invalidateInvoiceState]);

  const restoreDeposit = useCallback(async (): Promise<boolean> => {
    if (!booking) return false;
    setRestoring(true);
    setError('');
    try {
      await InvoicesService.revertDepositVoid(booking.id);
      await reloadPayments();
      invalidateInvoiceState?.();
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Failed to restore deposit'));
      return false;
    } finally {
      setRestoring(false);
    }
  }, [booking, reloadPayments, setError, invalidateInvoiceState]);

  return {
    deposit,
    refunding,
    forfeiting,
    cancelling,
    reverting,
    restoring,
    refund,
    forfeit,
    cancelUncollected,
    revertRefund,
    restoreDeposit,
  };
}
