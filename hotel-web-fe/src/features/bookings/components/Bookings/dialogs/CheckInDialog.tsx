import React, { useEffect, useState } from 'react';
import ReservedCheckInDialog from '../../../../rooms/components/RoomManagement/components/ReservedCheckInDialog';
import type { BookingUpdateRequest, BookingWithDetails, CheckInRequest } from '../../../../../types';
import { GuestsService } from '../../../../../api';
import { useCheckInGuestMutation } from '../../../hooks/useBookingQueries';
import { useCurrency } from '../../../../../hooks/useCurrency';
import { getHotelSettings } from '../../../../../utils/hotelSettings';
import { isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';
import { emitApiNotification } from '../../../../../utils/apiNotifications';
import { getErrorMessage } from '../../../utils/bookingPageUtils';

interface CheckInDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

const CheckInDialog: React.FC<CheckInDialogProps> = ({ open, booking, onClose, onError, onCompleted }) => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const checkInGuestMutation = useCheckInGuestMutation();
  const paymentMethods = getHotelSettings().payment_methods;

  const [processing, setProcessing] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<'pay_now' | 'pay_later'>('pay_later');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [amountPaid, setAmountPaid] = useState(0);
  const [depositChoice, setDepositChoice] = useState<'receive' | 'waive'>('receive');
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositMethod, setDepositMethod] = useState('Cash');
  const [waiveReason, setWaiveReason] = useState('');
  // IC is collected at check-in (optional at booking creation); phone optional.
  const [icNumber, setIcNumber] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (!open || !booking) return undefined;
    const totalAmt = toMoneyNumber(booking.total_amount);
    setPaymentChoice(booking.payment_status === 'paid' ? 'pay_now' : 'pay_later');
    setPaymentMethod(booking.payment_method || 'Cash');
    setAmountPaid(totalAmt);
    setDepositChoice('receive');
    setDepositAmount(getHotelSettings().deposit_amount);
    setDepositMethod('Cash');
    setWaiveReason('');
    setIcNumber('');
    setPhone(booking.guest_phone || '');

    // Back-fill IC / phone from the guest profile (booking summary omits IC).
    if (booking.guest_id !== undefined && booking.guest_id !== null) {
      let cancelled = false;
      GuestsService.getGuest(booking.guest_id)
        .then((guest) => {
          if (cancelled) return;
          setIcNumber((current) => (current.trim() ? current : guest.ic_number || ''));
          setPhone((current) => (current.trim() ? current : guest.phone || ''));
        })
        .catch(() => { /* leave for manual entry */ });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [open, booking]);

  const handleConfirm = async () => {
    if (!booking) return;
    if (!icNumber.trim()) {
      onError('IC / passport number is required to complete check-in.');
      return;
    }
    if (depositChoice === 'receive' && !isPositiveMoney(depositAmount)) {
      onError('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.');
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
      await checkInGuestMutation.mutateAsync({ bookingId: booking.id, data: checkinPayload });
      onClose();
      emitApiNotification({ severity: 'success', message: 'Guest checked in successfully!' });
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || 'Failed to check in guest');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ReservedCheckInDialog
      open={open}
      onClose={() => { if (!processing) onClose(); }}
      onCancel={onClose}
      booking={booking}
      formatCurrency={formatCurrency}
      currencySymbol={currencySymbol}
      paymentMethods={paymentMethods}
      paymentChoice={paymentChoice}
      onPaymentChoiceChange={setPaymentChoice}
      paymentMethod={paymentMethod}
      onPaymentMethodChange={setPaymentMethod}
      amountPaid={amountPaid}
      onAmountPaidChange={setAmountPaid}
      depositChoice={depositChoice}
      onDepositChoiceChange={setDepositChoice}
      depositMethod={depositMethod}
      onDepositMethodChange={setDepositMethod}
      depositAmount={depositAmount}
      onDepositAmountChange={setDepositAmount}
      waiveReason={waiveReason}
      onWaiveReasonChange={setWaiveReason}
      icNumber={icNumber}
      onIcNumberChange={setIcNumber}
      phone={phone}
      onPhoneChange={setPhone}
      processing={processing}
      onCheckIn={handleConfirm}
    />
  );
};

export default CheckInDialog;
