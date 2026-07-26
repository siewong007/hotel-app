import { describe, expect, it } from 'vitest';

import type { BookingWithDetails } from '../../../types';
import type { HotelSettings } from '../../../utils/hotelSettings';
import { calculateChargesFromInputs, emptyCharges } from './chargesCalculation';

// Only the two fields the calculation reads are populated; everything else on
// HotelSettings is irrelevant here (matches the cast-fixture style used by
// sibling invoice/booking hook tests).
function buildSettings(overrides: Partial<HotelSettings> = {}): HotelSettings {
  return {
    service_tax_rate: 8,
    tourism_tax_rate: 10,
    ...overrides,
  } as HotelSettings;
}

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '7',
    booking_number: 'B-0007',
    guest_id: 'g-1',
    guest_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    room_id: 'r-1',
    room_number: '101',
    room_type: 'Deluxe',
    check_in_date: '2026-07-10',
    check_out_date: '2026-07-12',
    total_amount: 216,
    price_per_night: 108,
    status: 'checked_in',
    payment_method: 'cash',
    ...overrides,
  } as BookingWithDetails;
}

describe('calculateChargesFromInputs', () => {
  it('splits a clean 2-night stay into tax-exclusive room charge + service tax with no rounding leak', () => {
    // 108/night incl. 8% tax * 2 nights = 216 subtotal; 216 / 1.08 = 200 exactly.
    const booking = buildBooking({ price_per_night: 108, check_in_date: '2026-07-10', check_out_date: '2026-07-12' });
    const settings = buildSettings({ service_tax_rate: 8 });

    const result = calculateChargesFromInputs(booking, 0, settings, {});

    expect(result.roomCharges).toBe(200);
    expect(result.serviceTax).toBe(16);
    // Invariant: the tax-exclusive charge plus the tax split back out must
    // reconstitute the exact tax-inclusive subtotal (money.ts rounds each
    // operation to the nearest cent, so this is not automatic).
    expect(result.roomCharges + result.serviceTax).toBe(216);
    expect(result.tourismTax).toBe(0);
    expect(result.extraBedCharge).toBe(0);
    expect(result.roomCardDeposit).toBe(0);
    expect(result.grandTotal).toBe(216);
    expect(result.subtotal).toBe(result.grandTotal);
  });

  it('rounds the room-charge/service-tax split to the cent with no leaked or duplicated money', () => {
    // 100 incl. 6% tax, 1 night: 100 / 1.06 = 94.339622... -> rounds to 94.34.
    const booking = buildBooking({ price_per_night: 100, check_in_date: '2026-07-10', check_out_date: '2026-07-11' });
    const settings = buildSettings({ service_tax_rate: 6 });

    const result = calculateChargesFromInputs(booking, 0, settings, {});

    expect(result.roomCharges).toBe(94.34);
    expect(result.serviceTax).toBe(5.66);
    expect(result.roomCharges + result.serviceTax).toBe(100);
  });

  it('treats a same-day / hourly stay as exactly one night, not zero', () => {
    // check-in === check-out => rawNights would be 0; the function must not
    // zero out the room charge for an hourly/same-day booking.
    const booking = buildBooking({
      post_type: 'hourly',
      check_in_date: '2026-07-10T10:00:00.000Z',
      check_out_date: '2026-07-10T10:00:00.000Z',
      price_per_night: 108,
    });
    const settings = buildSettings({ service_tax_rate: 8 });

    const result = calculateChargesFromInputs(booking, 0, settings, {});

    expect(result.roomCharges).toBe(100);
    expect(result.serviceTax).toBe(8);
  });

  it('falls back from price_per_night to roomPrice, then to total_amount/nights, in that order', () => {
    const settings = buildSettings({ service_tax_rate: 8 });

    // price_per_night present -> used directly, roomPrice ignored.
    const withBookingPrice = calculateChargesFromInputs(
      buildBooking({ price_per_night: 108, total_amount: 999 }),
      500,
      settings,
      {},
    );
    expect(withBookingPrice.roomCharges + withBookingPrice.serviceTax).toBe(216);

    // price_per_night missing -> falls back to the passed-in roomPrice.
    const withRoomPrice = calculateChargesFromInputs(
      buildBooking({ price_per_night: 0, total_amount: 999 }),
      108,
      settings,
      {},
    );
    expect(withRoomPrice.roomCharges + withRoomPrice.serviceTax).toBe(216);

    // Both missing -> falls back to total_amount / nights.
    const withTotalAmount = calculateChargesFromInputs(
      buildBooking({ price_per_night: 0, total_amount: 216, check_in_date: '2026-07-10', check_out_date: '2026-07-12' }),
      0,
      settings,
      {},
    );
    expect(withTotalAmount.roomCharges + withTotalAmount.serviceTax).toBe(216);
  });

  it('prefers editableDailyRates over both price_per_night and booking.daily_rates', () => {
    const booking = buildBooking({
      price_per_night: 999, // must be ignored
      daily_rates: { '2026-07-10': 999, '2026-07-11': 999 }, // must also be ignored
      check_in_date: '2026-07-10',
      check_out_date: '2026-07-12',
    });
    const settings = buildSettings({ service_tax_rate: 8 });
    const editableDailyRates = { '2026-07-10': 100, '2026-07-11': 150 };

    const result = calculateChargesFromInputs(booking, 0, settings, editableDailyRates);

    // Room subtotal (incl. tax) is exactly the sum of the edited rates: 250.
    expect(result.roomCharges + result.serviceTax).toBe(250);
  });

  it('sums booking.daily_rates when editableDailyRates is empty', () => {
    const booking = buildBooking({
      price_per_night: 999, // must be ignored once daily_rates is present
      daily_rates: { '2026-07-10': 100, '2026-07-11': 150 },
      check_in_date: '2026-07-10',
      check_out_date: '2026-07-12',
    });
    const settings = buildSettings({ service_tax_rate: 8 });

    const result = calculateChargesFromInputs(booking, 0, settings, {});

    expect(result.roomCharges + result.serviceTax).toBe(250);
  });

  it('only charges the room-card deposit (and its refund) when the booking actually took one', () => {
    const settings = buildSettings();

    const paid = calculateChargesFromInputs(
      buildBooking({ deposit_paid: true, deposit_amount: 50 }),
      0,
      settings,
      {},
    );
    expect(paid.roomCardDeposit).toBe(50);
    expect(paid.depositRefund).toBe(50);

    const notPaid = calculateChargesFromInputs(
      buildBooking({ deposit_paid: false, deposit_amount: 50 }),
      0,
      settings,
      {},
    );
    expect(notPaid.roomCardDeposit).toBe(0);
    expect(notPaid.depositRefund).toBe(0);
  });

  it('charges per-night tourism tax only for foreign tourists (by flag or tourism type)', () => {
    const settings = buildSettings({ tourism_tax_rate: 10 });
    const nights2 = { check_in_date: '2026-07-10', check_out_date: '2026-07-12' };

    const foreignByType = calculateChargesFromInputs(
      buildBooking({ ...nights2, guest_tourism_type: 'foreign' }),
      0,
      settings,
      {},
    );
    expect(foreignByType.tourismTax).toBe(20);

    const foreignByFlag = calculateChargesFromInputs(
      buildBooking({ ...nights2, is_tourist: true }),
      0,
      settings,
      {},
    );
    expect(foreignByFlag.tourismTax).toBe(20);

    const domestic = calculateChargesFromInputs(
      buildBooking({ ...nights2, guest_tourism_type: 'local', is_tourist: false }),
      0,
      settings,
      {},
    );
    expect(domestic.tourismTax).toBe(0);
  });

  it('backs a tax-inclusive extra-bed charge out into charge + tax with no rounding leak, and zeroes both when absent', () => {
    const settings = buildSettings({ service_tax_rate: 8 });

    // 54 incl. 8% tax = 50 exclusive + 4 tax exactly.
    const withExtraBed = calculateChargesFromInputs(
      buildBooking({ extra_bed_charge: 54 }),
      0,
      settings,
      {},
    );
    expect(withExtraBed.extraBedCharge).toBe(50);
    expect(withExtraBed.extraBedServiceTax).toBe(4);
    expect(withExtraBed.extraBedCharge + withExtraBed.extraBedServiceTax).toBe(54);

    const withoutExtraBed = calculateChargesFromInputs(
      buildBooking({ extra_bed_charge: 0 }),
      0,
      settings,
      {},
    );
    expect(withoutExtraBed.extraBedCharge).toBe(0);
    expect(withoutExtraBed.extraBedServiceTax).toBe(0);
  });

  it('reconciles a full checkout (room + extra bed + tourism tax + deposit) to an exact grand total', () => {
    const booking = buildBooking({
      price_per_night: 108,
      check_in_date: '2026-07-10',
      check_out_date: '2026-07-12', // 2 nights
      extra_bed_charge: 54,
      guest_tourism_type: 'foreign',
      deposit_paid: true,
      deposit_amount: 50,
    });
    const settings = buildSettings({ service_tax_rate: 8, tourism_tax_rate: 10 });

    const result = calculateChargesFromInputs(booking, 0, settings, {});

    // room: 216 incl tax -> 200 + 16; extra bed: 54 incl tax -> 50 + 4;
    // tourism: 10 * 2 nights = 20. Nothing may be silently dropped.
    expect(result.roomCharges).toBe(200);
    expect(result.serviceTax).toBe(16);
    expect(result.extraBedCharge).toBe(50);
    expect(result.extraBedServiceTax).toBe(4);
    expect(result.tourismTax).toBe(20);
    expect(result.subtotal).toBe(290); // 200+16+50+4+20
    expect(result.grandTotal).toBe(290);
    // The room-card deposit is tracked as a refundable liability, not folded
    // into the guest's owed total.
    expect(result.roomCardDeposit).toBe(50);
    expect(result.depositRefund).toBe(50);
  });

  it('exposes a zeroed emptyCharges default with the documented starting room-card deposit', () => {
    expect(emptyCharges.roomCardDeposit).toBe(50);
    expect(emptyCharges.grandTotal).toBe(0);
    expect(emptyCharges.subtotal).toBe(0);
  });
});
