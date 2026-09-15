import { useCallback, useState } from 'react';
import { BookingsService, GuestsService } from '../../../api';
import type { BookingUpdateRequest, BookingWithDetails, CheckInRequest } from '../../../types';
import { getHotelSettings } from '../../../utils/hotelSettings';
import type { ApiNotificationSeverity } from '../../../utils/apiNotifications';
import { isPositiveMoney, toMoneyNumber } from '../../../utils/money';
import { errorMessage } from '../../../utils/errorMessage';
import { useTranslation } from '../../../i18n/useTranslation';

type PaymentChoice = 'pay_now' | 'pay_later';
type DepositChoice = 'receive' | 'waive';

interface UseReservedCheckInWorkflowArgs {
  reload: () => Promise<void> | void;
  showSnackbar: (message: string, severity: ApiNotificationSeverity) => void;
}

export function useReservedCheckInWorkflow({
  reload,
  showSnackbar,
}: UseReservedCheckInWorkflowArgs) {
  const { t } = useTranslation('rooms');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [booking, setBooking] = useState<BookingWithDetails | null>(null);
  const [processing, setProcessing] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>('pay_later');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [amountPaid, setAmountPaid] = useState(0);
  const [depositChoice, setDepositChoice] = useState<DepositChoice>('receive');
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositMethod, setDepositMethod] = useState('Cash');
  const [waiveReason, setWaiveReason] = useState('');
  // Identity document is required at check-in (it is optional at booking
  // creation); phone is optional. Pre-filled from the guest record on open so
  // guests who already have these on file don't need to re-enter them.
  const [icNumber, setIcNumber] = useState('');
  const [phone, setPhone] = useState('');

  const openWithBooking = useCallback((
    nextBooking: BookingWithDetails,
    fallbackPaymentMethod = 'Cash',
  ) => {
    const settingsDeposit = getHotelSettings().deposit_amount;
    const totalAmount = toMoneyNumber(nextBooking.total_amount);

    setBooking(nextBooking);
    setPaymentChoice(nextBooking.payment_status === 'paid' ? 'pay_now' : 'pay_later');
    setPaymentMethod(nextBooking.payment_method || fallbackPaymentMethod);
    setAmountPaid(totalAmount);
    setDepositChoice('receive');
    setDepositAmount(settingsDeposit);
    setDepositMethod('Cash');
    setWaiveReason('');
    setIcNumber('');
    setPhone(nextBooking.guest_phone || '');
    setDialogOpen(true);

    // Back-fill the identity document and phone from the guest profile (the
    // booking summary doesn't carry the IC). Best-effort: a failure just leaves
    // the fields for staff to complete manually.
    const guestId = nextBooking.guest_id;
    if (guestId !== undefined && guestId !== null) {
      GuestsService.getGuest(guestId)
        .then((guest) => {
          setIcNumber((current) => (current.trim() ? current : guest.ic_number || ''));
          setPhone((current) => (current.trim() ? current : guest.phone || ''));
        })
        .catch(() => {
          /* leave fields empty for manual entry */
        });
    }
  }, []);

  const close = useCallback(() => {
    if (processing) return;

    setDialogOpen(false);
    setBooking(null);
    setIcNumber('');
    setPhone('');
  }, [processing]);

  const cancel = useCallback(() => {
    setDialogOpen(false);
    setBooking(null);
    setIcNumber('');
    setPhone('');
  }, []);

  const checkIn = useCallback(async () => {
    if (!booking) {
      showSnackbar(t('notifications.noBookingSelected'), 'warning');
      return;
    }

    if (!icNumber.trim()) {
      showSnackbar(t('bookings:checkIn.icRequiredError'), 'warning');
      return;
    }

    if (depositChoice === 'receive' && !isPositiveMoney(depositAmount)) {
      showSnackbar(t('bookings:checkIn.depositRequiredError'), 'warning');
      return;
    }

    try {
      setProcessing(true);

      // Single atomic request: deposit fields + payment + the status flip all go
      // through the check-in endpoint, which commits them in one transaction.
      // (Don't push payment_status — recording the payments row is what flips the
      // derived status; an override would be overwritten by the backend anyway.)
      const bookingUpdate: BookingUpdateRequest = {};
      if (paymentChoice === 'pay_now') {
        bookingUpdate.payment_method = paymentMethod;
      }
      if (depositChoice === 'receive') {
        bookingUpdate.deposit_paid = true;
        bookingUpdate.deposit_amount = toMoneyNumber(depositAmount);
        bookingUpdate.payment_note = `Deposit received (${depositMethod})`;
        bookingUpdate.deposit_payment_method = depositMethod;
      } else {
        bookingUpdate.deposit_paid = false;
        bookingUpdate.deposit_amount = 0;
        bookingUpdate.payment_note = `Deposit waived: ${waiveReason}`;
      }

      const checkinPayload: CheckInRequest = {
        booking_update: bookingUpdate,
        guest_update: {
          ic_number: icNumber.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
      };
      if (paymentChoice === 'pay_now' && isPositiveMoney(amountPaid)) {
        checkinPayload.payment_record = {
          amount: toMoneyNumber(amountPaid),
          payment_method: paymentMethod,
          payment_type: 'booking',
          notes: 'Payment collected at check-in',
        };
      }

      await BookingsService.checkInGuest(String(booking.id), checkinPayload);

      showSnackbar(t('notifications.checkedInGuest', { guest: booking.guest_name, room: booking.room_number }), 'success');
      setDialogOpen(false);
      setBooking(null);
      setIcNumber('');
      setPhone('');
      await reload();
    } catch (error) {
      showSnackbar(errorMessage(error, t('errors.checkIn')), 'error');
    } finally {
      setProcessing(false);
    }
  }, [
    amountPaid,
    booking,
    depositAmount,
    depositChoice,
    depositMethod,
    icNumber,
    paymentChoice,
    paymentMethod,
    phone,
    reload,
    showSnackbar,
    t,
    waiveReason,
  ]);

  return {
    dialogOpen,
    booking,
    processing,
    paymentChoice,
    setPaymentChoice,
    paymentMethod,
    setPaymentMethod,
    amountPaid,
    setAmountPaid,
    depositChoice,
    setDepositChoice,
    depositMethod,
    setDepositMethod,
    depositAmount,
    setDepositAmount,
    waiveReason,
    setWaiveReason,
    icNumber,
    setIcNumber,
    phone,
    setPhone,
    openWithBooking,
    close,
    cancel,
    checkIn,
  };
}
