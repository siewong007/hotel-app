import type { GroupCreditNight, GroupQuote } from './types';

/** The credit nights the quote currently places, as a request placement. */
export function placementFromQuote(quote: GroupQuote): GroupCreditNight[] {
  return quote.rooms.flatMap((room) => (room.quote.complimentary_dates ?? []).map((date) => ({ room_index: room.index, date })));
}

/** Toggle one room-night in a placement; returns null when over the type's balance. */
export function toggleCreditNight(quote: GroupQuote, current: GroupCreditNight[], roomIndex: number, date: string): GroupCreditNight[] | null {
  const on = current.some((night) => night.room_index === roomIndex && night.date === date);
  if (on) return current.filter((night) => !(night.room_index === roomIndex && night.date === date));
  const typeOf = (index: number) => quote.rooms.find((room) => room.index === index)?.quote.room_type_id;
  const type = typeOf(roomIndex);
  const balance = Math.max(0, quote.credits_available.find((entry) => entry.room_type_id === type)?.nights_available ?? 0);
  const used = current.filter((night) => typeOf(night.room_index) === type).length;
  if (used >= balance) return null;
  return [...current, { room_index: roomIndex, date }];
}

/**
 * The credit fields for a signed-in group quote/create. No placement = the
 * server's cheapest-first default; an empty placement = no credits at all
 * (the server treats an empty list as "use the default").
 */
export function groupCreditRequest(useCredits: boolean, placement: GroupCreditNight[] | null): { use_credits: boolean; complimentary?: GroupCreditNight[] } {
  if (!useCredits) return { use_credits: false };
  if (placement === null) return { use_credits: true };
  if (placement.length === 0) return { use_credits: false };
  return { use_credits: true, complimentary: placement };
}
