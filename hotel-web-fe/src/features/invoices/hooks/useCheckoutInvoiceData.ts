import { useState, useEffect, useCallback } from 'react';
import { BookingWithDetails } from '../../../types';
import { HotelAPIService } from '../../../api';
import { InvoicesService } from '../../../api/invoices.service';
import { getHotelSettings, HotelSettings } from '../../../utils/hotelSettings';

export function useCheckoutInvoiceData(booking: BookingWithDetails | null, open: boolean) {
  const [hotelSettings, setHotelSettings] = useState<HotelSettings>(getHotelSettings());
  const [roomPrice, setRoomPrice] = useState(0);
  const [guestCompanyName, setGuestCompanyName] = useState('');
  const [guestAddress, setGuestAddress] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestIcNumber, setGuestIcNumber] = useState('');
  const [payments, setPayments] = useState<any[]>([]);
  const [depositRefunded, setDepositRefunded] = useState(false);
  const [editableDailyRates, setEditableDailyRates] = useState<Record<string, number>>({});

  const reloadPayments = useCallback(async () => {
    if (!booking) return;
    try {
      const existing = await InvoicesService.getBookingPayments(booking.id);
      setPayments(existing || []);
      const hasRefund = (existing || []).some(
        (p: any) => p.payment_status === 'refunded' && p.notes === 'Keycard deposit refund'
      );
      setDepositRefunded(hasRefund);
    } catch {
      setPayments([]);
    }
  }, [booking]);

  useEffect(() => {
    if (!open || !booking) return;

    const settings = getHotelSettings();
    setHotelSettings(settings);

    // Fetch room price
    HotelAPIService.getAllRooms().then(rooms => {
      const room = rooms.find(r => r.id.toString() === booking.room_id.toString());
      if (room) {
        const price = typeof room.price_per_night === 'string'
          ? parseFloat(room.price_per_night)
          : room.price_per_night || 0;
        setRoomPrice(price);
      } else {
        setRoomPrice(0);
      }
    }).catch(() => setRoomPrice(0));

    // Fetch guest info
    HotelAPIService.getAllGuests().then(guests => {
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
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    const rawNights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
    const isHourly = booking.post_type === 'hourly' || rawNights === 0;
    if (!isHourly) {
      const pricePerNight = typeof booking.price_per_night === 'string'
        ? parseFloat(booking.price_per_night) : booking.price_per_night || 0;
      const rates: Record<string, number> = {};
      for (let i = 0; i < rawNights; i++) {
        const d = new Date(checkIn);
        d.setDate(d.getDate() + i);
        const key = d.toISOString().split('T')[0];
        if (booking.daily_rates && typeof booking.daily_rates === 'object' && booking.daily_rates[key] !== undefined) {
          rates[key] = parseFloat(String(booking.daily_rates[key])) || 0;
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
  }, [open, booking]);

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
