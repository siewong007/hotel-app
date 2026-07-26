import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookingWithDetails, CustomerLedger, CustomerLedgerPayment } from '../../../types';
import { GuestsService, RoomsService } from '../../../api';
import { InvoicesService } from '../../../api/invoices.service';
import { LedgerService } from '../../../api/ledger.service';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { getHotelSettings, HotelSettings } from '../../../utils/hotelSettings';
import type { CheckoutPaymentRecord } from '../types';
import { formatLocalDate, parseLocalDate, addLocalDays } from '../../../utils/date';
import { toMoneyNumber } from '../../../utils/money';

// Map a company city-ledger payment onto the shared payment-row shape so the
// invoice modal can render ledger payments the same way it renders booking
// payments. Company-billed bookings record their payments against the customer
// ledger (`customer_ledger_payments`), not the booking `payments` table.
function ledgerPaymentToRecord(payment: CustomerLedgerPayment): CheckoutPaymentRecord {
  return {
    id: payment.id,
    payment_status: 'completed',
    total_amount: payment.payment_amount,
    payment_method: payment.payment_method,
    payment_type: 'payment',
    transaction_reference: payment.payment_reference || payment.receipt_number || null,
    notes: payment.notes || null,
    payment_date: payment.payment_date,
    created_at: payment.created_at,
  };
}

export function useCheckoutInvoiceData(
  booking: BookingWithDetails | null,
  open: boolean,
  ledger?: CustomerLedger | null,
) {
  const queryClient = useQueryClient();
  const [hotelSettings, setHotelSettings] = useState<HotelSettings>(getHotelSettings());
  const [roomPrice, setRoomPrice] = useState(0);
  const [guestCompanyName, setGuestCompanyName] = useState('');
  const [guestAddress, setGuestAddress] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestIcNumber, setGuestIcNumber] = useState('');
  const [payments, setPayments] = useState<CheckoutPaymentRecord[]>([]);
  const [depositRefunded, setDepositRefunded] = useState(false);
  const [editableDailyRates, setEditableDailyRates] = useState<Record<string, number>>({});

  const reloadPayments = useCallback(async () => {
    if (!booking) return;
    // City-ledger receipts: payments live on the customer ledger, not the
    // booking. Source them from there so the modal reflects what was actually
    // collected (and the resulting balance due) for company-billed stays.
    if (ledger?.id) {
      try {
        const ledgerPayments = await queryClient.fetchQuery({
          queryKey: queryKeys.ledgers.payments(ledger.id),
          queryFn: () => LedgerService.getLedgerPayments(ledger.id),
          staleTime: 0,
        });
        setPayments((ledgerPayments || []).map(ledgerPaymentToRecord));
      } catch {
        setPayments([]);
      }
      setDepositRefunded(false);
      return;
    }
    try {
      const existing = await queryClient.fetchQuery({
        queryKey: queryKeys.invoices.payments(booking.id),
        queryFn: () => InvoicesService.getBookingPayments(booking.id),
        staleTime: 0,
      });
      const normalizedPayments = (existing || []) as CheckoutPaymentRecord[];
      setPayments(normalizedPayments);
      // Detect a refunded keycard deposit structurally rather than by an exact
      // note string. The backend marks deposit refunds with payment_type='refund'
      // / status='refunded' (see refund_deposit + bookings_queries deposit_refunded),
      // so match on those signals and treat a deposit-related note only as a
      // fallback. This stays correct even if the note text/method changes.
      const hasRefund = normalizedPayments.some(
        (p) =>
          p.payment_status === 'refunded' ||
          (p.payment_type || '').toLowerCase() === 'refund' ||
          /deposit\s*refund/i.test(p.notes || '')
      );
      setDepositRefunded(hasRefund);
    } catch {
      setPayments([]);
    }
  }, [booking, queryClient, ledger?.id]);

  useEffect(() => {
    if (!open || !booking) return;

    const settings = getHotelSettings();
    setHotelSettings(settings);

    // Fetch room price
    queryClient.ensureQueryData({
      queryKey: queryKeys.rooms.all,
      queryFn: () => RoomsService.getAllRooms(),
      staleTime: queryStaleTime.standard,
    }).then(rooms => {
      const room = rooms.find(r => r.id.toString() === booking.room_id.toString());
      if (room) {
        setRoomPrice(toMoneyNumber(room.price_per_night));
      } else {
        setRoomPrice(0);
      }
    }).catch(() => setRoomPrice(0));

    // Fetch guest info
    queryClient.ensureQueryData({
      queryKey: queryKeys.guests.list(),
      queryFn: () => GuestsService.getAllGuests(),
      staleTime: queryStaleTime.standard,
    }).then(guests => {
      const guest = guests.find(g => String(g.id) === String(booking.guest_id));
      if (guest) {
        setGuestCompanyName(guest.company_name || '');
        setGuestPhone(guest.phone || '');
        setGuestIcNumber(guest.ic_number || '');
        const parts = [
          guest.address_line1,
          guest.city,
          guest.state_province,
          guest.postal_code,
          guest.country,
        ].filter(Boolean);
        setGuestAddress(parts.join(', '));
      } else {
        setGuestCompanyName('');
        setGuestAddress('');
        setGuestPhone('');
        setGuestIcNumber('');
      }
    }).catch(() => {
      setGuestCompanyName('');
      setGuestAddress('');
      setGuestPhone('');
      setGuestIcNumber('');
    });

    // Initialize editable daily rates
    const checkIn = parseLocalDate(booking.check_in_date);
    const checkOut = parseLocalDate(booking.check_out_date);
    const rawNights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
    const isHourly = booking.post_type === 'hourly' || rawNights === 0;
    if (!isHourly) {
      const pricePerNight = toMoneyNumber(booking.price_per_night);
      const rates: Record<string, number> = {};
      for (let i = 0; i < rawNights; i++) {
        const key = formatLocalDate(addLocalDays(checkIn, i));
        if (booking.daily_rates && typeof booking.daily_rates === 'object' && booking.daily_rates[key] !== undefined) {
          rates[key] = toMoneyNumber(booking.daily_rates[key]);
        } else {
          rates[key] = pricePerNight;
        }
      }
      setEditableDailyRates(rates);
    } else {
      setEditableDailyRates({});
    }

    // Load payments
    reloadPayments();
  }, [open, booking, queryClient, reloadPayments]);

  // Listen for hotel settings changes
  useEffect(() => {
    const handleSettingsChange = (event: CustomEvent) => {
      setHotelSettings(event.detail);
    };
    window.addEventListener('hotelSettingsChange', handleSettingsChange as EventListener);
    return () => window.removeEventListener('hotelSettingsChange', handleSettingsChange as EventListener);
  }, []);

  return {
    hotelSettings,
    roomPrice,
    guestCompanyName,
    guestAddress,
    guestPhone,
    guestIcNumber,
    payments,
    setPayments,
    depositRefunded,
    setDepositRefunded,
    editableDailyRates,
    setEditableDailyRates,
    reloadPayments,
  };
}
