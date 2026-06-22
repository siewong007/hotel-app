import { BookingWithDetails } from '../../../types';
import { HotelSettings } from '../../../utils/hotelSettings';
import { divideMoney, multiplyMoney, subtractMoney, sumMoney, toMoneyNumber } from '../../../utils/money';

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

  let bookingPricePerNight = toMoneyNumber(booking.price_per_night);

  const taxRate = hotelSettings.service_tax_rate / 100;
  const taxMultiplier = 1 + taxRate;

  let taxInclusivePrice = bookingPricePerNight;
  if (!taxInclusivePrice || taxInclusivePrice === 0) {
    taxInclusivePrice = roomPrice;
  }
  if (!taxInclusivePrice || taxInclusivePrice === 0) {
    const totalAmount = toMoneyNumber(booking.total_amount);
    taxInclusivePrice = nights > 0 ? divideMoney(totalAmount, nights) : 0;
  }

  let roomSubtotal: number;
  if (Object.keys(editableDailyRates).length > 0) {
    roomSubtotal = sumMoney(Object.values(editableDailyRates));
  } else if (booking.daily_rates && typeof booking.daily_rates === 'object' && Object.keys(booking.daily_rates).length > 0) {
    roomSubtotal = sumMoney(Object.values(booking.daily_rates));
  } else {
    roomSubtotal = multiplyMoney(taxInclusivePrice, nights);
  }

  const roomCharges = divideMoney(roomSubtotal, taxMultiplier);
  const serviceTax = subtractMoney(roomSubtotal, roomCharges);

  const roomCardDeposit = booking.deposit_paid
    ? toMoneyNumber(booking.deposit_amount)
    : 0;

  const isForeignTourist = booking.guest_tourism_type === 'foreign' || booking.is_tourist === true;
  let tourismTax = 0;
  if (isForeignTourist) {
    tourismTax = multiplyMoney(hotelSettings.tourism_tax_rate, nights);
  }

  const extraBedChargeInclTax = toMoneyNumber(booking.extra_bed_charge);
  const extraBedCharge = extraBedChargeInclTax > 0 ? divideMoney(extraBedChargeInclTax, taxMultiplier) : 0;
  const extraBedServiceTax = subtractMoney(extraBedChargeInclTax, extraBedCharge);

  const subtotal = sumMoney([roomCharges, serviceTax, tourismTax, extraBedCharge, extraBedServiceTax]);
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
