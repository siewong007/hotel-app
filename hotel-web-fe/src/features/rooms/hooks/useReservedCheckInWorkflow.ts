import { useCallback, useState } from 'react';
import { HotelAPIService } from '../../../api';
import type { BookingWithDetails, CheckInRequest } from '../../../types';
import { getHotelSettings } from '../../../utils/hotelSettings';
import type { ApiNotificationSeverity } from '../../../utils/apiNotifications';
import { isPositiveMoney, toMoneyNumber } from '../../../utils/money';

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [booking, setBooking] = useState<BookingWithDetails | null>(null);
  const [processing, setProcessing] = useState(false);
  const [collectingDeposit, setCollectingDeposit] = useState(false);
  const [depositPaymentMethod, setDepositPaymentMethod] = useState('');
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

  const resetDepositState = useCallback(() => {
    setCollectingDeposit(false);
    setDepositPaymentMethod('');
  }, []);

  const openWithBooking = useCallback((
    nextBooking: BookingWithDetails,
    fallbackPaymentMethod = 'Cash',
  ) => {
    const settingsDeposit = getHotelSettings().deposit_amount;
    const totalAmount = toMoneyNumber(nextBooking.total_amount);

    setBooking(nextBooking);
    resetDepositState();
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
      HotelAPIService.getGuest(guestId)
        .then((guest) => {
          setIcNumber((current) => (current.trim() ? current : guest.ic_number || ''));
          setPhone((current) => (current.trim() ? current : guest.phone || ''));
        })
        .catch(() => {
          /* leave fields empty for manual entry */
        });
    }
  }, [resetDepositState]);

  const close = useCallback(() => {
    if (processing) return;

    setDialogOpen(false);
    setBooking(null);
    setIcNumber('');
    setPhone('');
    resetDepositState();
  }, [processing, resetDepositState]);

  const cancel = useCallback(() => {
    setDialogOpen(false);
    setBooking(null);
    setIcNumber('');
    setPhone('');
    resetDepositState();
  }, [resetDepositState]);

  const checkIn = useCallback(async () => {
    if (!booking) {
      showSnackbar('No booking selected', 'warning');
      return;
    }

    if (!icNumber.trim()) {
      showSnackbar('IC / passport number is required to complete check-in.', 'warning');
      return;
    }

    if (depositChoice === 'receive' && !isPositiveMoney(depositAmount)) {
      showSnackbar('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.', 'warning');
      return;
    }

    try {
      setProcessing(true);

      const updateData: Record<string, unknown> = {};
      if (paymentChoice === 'pay_now') {
        updateData.payment_status = 'paid';
        updateData.amount_paid = toMoneyNumber(amountPaid);
        updateData.payment_method = paymentMethod;
      } else {
        updateData.payment_status = 'unpaid';
      }

      if (depositChoice === 'receive') {
        updateData.deposit_paid = true;
        updateData.deposit_amount = toMoneyNumber(depositAmount);
        updateData.payment_note = `Deposit received (${depositMethod})`;
      } else {
        updateData.deposit_paid = false;
        updateData.deposit_amount = 0;
        updateData.payment_note = `Deposit waived: ${waiveReason}`;
      }

      await HotelAPIService.updateBooking(booking.id, updateData);

      const checkinPayload: CheckInRequest = {
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

      await HotelAPIService.checkInGuest(String(booking.id), checkinPayload);

      showSnackbar(`Guest ${booking.guest_name} checked in successfully to Room ${booking.room_number}`, 'success');
      setDialogOpen(false);
      setBooking(null);
      setIcNumber('');
      setPhone('');
      resetDepositState();
      await reload();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to check in guest', 'error');
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
    resetDepositState,
    showSnackbar,
    waiveReason,
  ]);

  return {
    dialogOpen,
    booking,
    processing,
    collectingDeposit,
    depositPaymentMethod,
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
