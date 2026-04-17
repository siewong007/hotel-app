import { BookingWithDetails } from '../../../types';
import { HotelSettings } from '../../../utils/hotelSettings';

export interface ChargesBreakdown {
  roomCharges: number;
  roomCardDeposit: number;
  serviceTax: number;
  tourismTax: number;
  extraBedCharge: number;
  extraBedServiceTax: number;
  subtotal: number;
  depositRefund: number;
  grandTotal: number;
}

export const emptyCharges: ChargesBreakdown = {
  roomCharges: 0,
  roomCardDeposit: 50,
  serviceTax: 0,
  tourismTax: 0,
  extraBedCharge: 0,
  extraBedServiceTax: 0,
  subtotal: 0,
  depositRefund: 0,
  grandTotal: 0,
};

export function calculateChargesFromInputs(
  booking: BookingWithDetails,
  roomPrice: number,
  hotelSettings: HotelSettings,
  editableDailyRates: Record<string, number>
): ChargesBreakdown {
  const checkIn = new Date(booking.check_in_date);
  const checkOut = new Date(booking.check_out_date);
  const rawNights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  const isHourly = booking.post_type === 'hourly' || rawNights === 0;
  const nights = isHourly ? 1 : rawNights;

  let bookingPricePerNight = typeof booking.price_per_night === 'string'
    ? parseFloat(booking.price_per_night)
    : booking.price_per_night || 0;

  const taxRate = hotelSettings.service_tax_rate / 100;
  const taxMultiplier = 1 + taxRate;

  let taxInclusivePrice = bookingPricePerNight;
  if (!taxInclusivePrice || taxInclusivePrice === 0) {
    taxInclusivePrice = roomPrice;
  }
  if (!taxInclusivePrice || taxInclusivePrice === 0) {
    const totalAmount = typeof booking.total_amount === 'string'
      ? parseFloat(booking.total_amount)
      : booking.total_amount || 0;
    taxInclusivePrice = nights > 0 ? totalAmount / nights : 0;
  }

  let roomSubtotal: number;
  if (Object.keys(editableDailyRates).length > 0) {
    roomSubtotal = Object.values(editableDailyRates).reduce((sum, rate) => sum + (rate || 0), 0);
  } else if (booking.daily_rates && typeof booking.daily_rates === 'object' && Object.keys(booking.daily_rates).length > 0) {
    roomSubtotal = Object.values(booking.daily_rates).reduce((sum: number, rate: any) => sum + (parseFloat(rate) || 0), 0);
  } else {
    roomSubtotal = taxInclusivePrice * nights;
  }

  const roomCharges = roomSubtotal / taxMultiplier;
  const serviceTax = roomSubtotal - roomCharges;

  const roomCardDeposit = booking.deposit_paid
    ? (typeof booking.deposit_amount === 'string' ? parseFloat(booking.deposit_amount) : booking.deposit_amount) || 0
    : 0;

  const isForeignTourist = booking.guest_tourism_type === 'foreign' || booking.is_tourist === true;
  let tourismTax = 0;
  if (isForeignTourist) {
    const storedTourismTax = booking.tourism_tax_amount
      ? (typeof booking.tourism_tax_amount === 'string' ? parseFloat(booking.tourism_tax_amount) : booking.tourism_tax_amount)
      : 0;
    tourismTax = storedTourismTax > 0 ? storedTourismTax : nights * hotelSettings.tourism_tax_rate;
  }

  const extraBedChargeInclTax = booking.extra_bed_charge
    ? (typeof booking.extra_bed_charge === 'string' ? parseFloat(booking.extra_bed_charge) : booking.extra_bed_charge)
    : 0;
  const extraBedCharge = extraBedChargeInclTax > 0 ? extraBedChargeInclTax / (1 + hotelSettings.service_tax_rate / 100) : 0;
  const extraBedServiceTax = extraBedChargeInclTax - extraBedCharge;

  const subtotal = roomCharges + serviceTax + tourismTax + extraBedCharge + extraBedServiceTax;
  const depositRefund = roomCardDeposit;
  const grandTotal = subtotal;

  return {
    roomCharges,
    roomCardDeposit,
    serviceTax,
    tourismTax,
    extraBedCharge,
    extraBedServiceTax,
    subtotal,
    depositRefund,
    grandTotal,
  };
}
