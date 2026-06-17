import { useCallback, useState } from 'react';
import { HotelAPIService } from '../../../api';
import type { BookingWithDetails } from '../../../types';
import { getHotelSettings } from '../../../utils/hotelSettings';
import type { ApiNotificationSeverity } from '../../../utils/apiNotifications';

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

  const resetDepositState = useCallback(() => {
    setCollectingDeposit(false);
    setDepositPaymentMethod('');
  }, []);

  const openWithBooking = useCallback((
    nextBooking: BookingWithDetails,
    fallbackPaymentMethod = 'Cash',
  ) => {
    const settingsDeposit = getHotelSettings().deposit_amount;
    const totalAmount = Number(nextBooking.total_amount || 0);

    setBooking(nextBooking);
    resetDepositState();
    setPaymentChoice(nextBooking.payment_status === 'paid' ? 'pay_now' : 'pay_later');
    setPaymentMethod(nextBooking.payment_method || fallbackPaymentMethod);
    setAmountPaid(totalAmount);
    setDepositChoice('receive');
    setDepositAmount(settingsDeposit);
    setDepositMethod('Cash');
    setWaiveReason('');
    setDialogOpen(true);
  }, [resetDepositState]);

  const close = useCallback(() => {
    if (processing) return;

    setDialogOpen(false);
    setBooking(null);
    resetDepositState();
  }, [processing, resetDepositState]);

  const cancel = useCallback(() => {
    setDialogOpen(false);
    setBooking(null);
    resetDepositState();
  }, [resetDepositState]);

  const checkIn = useCallback(async () => {
    if (!booking) {
      showSnackbar('No booking selected', 'warning');
      return;
    }

    if (depositChoice === 'receive' && Number(depositAmount) <= 0) {
      showSnackbar('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.', 'warning');
      return;
    }

    try {
      setProcessing(true);

      const updateData: Record<string, unknown> = {};
      if (paymentChoice === 'pay_now') {
        updateData.payment_status = 'paid';
        updateData.amount_paid = amountPaid;
        updateData.payment_method = paymentMethod;
      } else {
        updateData.payment_status = 'unpaid';
      }

      if (depositChoice === 'receive') {
        updateData.deposit_paid = true;
        updateData.deposit_amount = depositAmount;
        updateData.payment_note = `Deposit received (${depositMethod})`;
      } else {
        updateData.deposit_paid = false;
        updateData.deposit_amount = 0;
        updateData.payment_note = `Deposit waived: ${waiveReason}`;
      }

      await HotelAPIService.updateBooking(booking.id, updateData);

      const checkinPayload = paymentChoice === 'pay_now' && amountPaid > 0
        ? {
            payment_record: {
              amount: amountPaid,
              payment_method: paymentMethod,
              payment_type: 'booking',
              notes: 'Payment collected at check-in',
            },
          }
        : undefined;

      await HotelAPIService.checkInGuest(String(booking.id), checkinPayload);

      showSnackbar(`Guest ${booking.guest_name} checked in successfully to Room ${booking.room_number}`, 'success');
      setDialogOpen(false);
      setBooking(null);
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
    paymentChoice,
    paymentMethod,
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
    openWithBooking,
    close,
    cancel,
    checkIn,
  };
}
