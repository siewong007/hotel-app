import { describe, expect, it } from 'vitest';
import { groupCreditRequest, placementFromQuote, toggleCreditNight } from './creditPlacement';
import type { GroupQuote } from './types';

const roomQuote = (typeId: number, dates: string[]) => ({
  room_type_id: typeId,
  nightly_rates: [{ date: '2026-07-17', amount: '100' }, { date: '2026-07-18', amount: '150' }],
  complimentary_dates: dates,
});
const quote = {
  rooms: [
    { index: 0, quote: roomQuote(7, ['2026-07-17']) },
    { index: 1, quote: roomQuote(7, []) },
    { index: 2, quote: roomQuote(8, []) },
  ],
  credits_available: [{ room_type_id: 7, nights_available: 1 }],
} as unknown as GroupQuote;

describe('group credit placement', () => {
  it('reads the placement the quote currently applies', () => {
    expect(placementFromQuote(quote)).toEqual([{ room_index: 0, date: '2026-07-17' }]);
  });

  it('refuses a night past the room type balance and allows a move', () => {
    const current = placementFromQuote(quote);
    expect(toggleCreditNight(quote, current, 1, '2026-07-18')).toBeNull();
    expect(toggleCreditNight(quote, current, 2, '2026-07-18')).toBeNull();
    const freed = toggleCreditNight(quote, current, 0, '2026-07-17');
    expect(freed).toEqual([]);
    expect(toggleCreditNight(quote, freed!, 1, '2026-07-18')).toEqual([{ room_index: 1, date: '2026-07-18' }]);
  });

  it('maps toggle and placement onto the request fields', () => {
    expect(groupCreditRequest(false, [{ room_index: 0, date: 'x' }])).toEqual({ use_credits: false });
    expect(groupCreditRequest(true, null)).toEqual({ use_credits: true });
    expect(groupCreditRequest(true, [])).toEqual({ use_credits: false });
    expect(groupCreditRequest(true, [{ room_index: 1, date: 'x' }])).toEqual({ use_credits: true, complimentary: [{ room_index: 1, date: 'x' }] });
  });
});
