/**
 * Multi-room cart for the portal booking page.
 *
 * The cart is a list of rooms for ONE stay (check-in/out). It lives in
 * sessionStorage so it survives navigating away (e.g. to sign in) and a page
 * refresh, but not a closed tab — an abandoned cart should not resurface days
 * later on a shared device. Prices in the cart are display snapshots only; the
 * server re-quotes the whole cart before anything is booked.
 */
import type { GroupRoomRequest, GuestBookingOffer, GuestBookingSearch } from './types';

/** Mirrors the backend's `MAX_GROUP_ROOMS`. */
export const MAX_CART_ROOMS = 5;
export const CART_STORAGE_KEY = 'portal-booking-cart-v1';

export interface CartRoom extends GroupRoomRequest {
  /** Stable per-line id so React keys survive removals. */
  line_id: string;
  room_type_name: string;
  max_occupancy: number;
  max_extra_beds: number;
  /** Snapshot of the type's stay price when added — display only. */
  unit_total: number;
  extra_bed_charge: number;
  currency: string;
}

export interface Cart {
  check_in_date: string;
  check_out_date: string;
  rooms: CartRoom[];
}

export function emptyCart(search: Pick<GuestBookingSearch, 'check_in_date' | 'check_out_date'>): Cart {
  return { check_in_date: search.check_in_date, check_out_date: search.check_out_date, rooms: [] };
}

function lineId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `line-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function countOfType(cart: Cart, roomTypeId: number): number {
  return cart.rooms.filter((room) => room.room_type_id === roomTypeId).length;
}

/** How many more rooms of this offer the cart may take. */
export function remainingForOffer(cart: Cart, offer: GuestBookingOffer): number {
  const byType = offer.available_rooms - countOfType(cart, offer.room_type_id);
  const byCart = MAX_CART_ROOMS - cart.rooms.length;
  return Math.max(0, Math.min(byType, byCart));
}

export function addRoom(cart: Cart, offer: GuestBookingOffer, search: GuestBookingSearch): Cart {
  if (remainingForOffer(cart, offer) <= 0) return cart;
  const maxOccupancy = Math.max(1, offer.max_occupancy);
  const adults = Math.min(Math.max(1, search.adults || 1), maxOccupancy);
  const children = Math.min(Math.max(0, search.children || 0), maxOccupancy - adults);
  const room: CartRoom = {
    line_id: lineId(),
    room_type_id: offer.room_type_id,
    room_type_name: offer.room_type_name,
    max_occupancy: maxOccupancy,
    max_extra_beds: Math.max(0, offer.max_extra_beds ?? 0),
    adults,
    children,
    extra_beds: 0,
    unit_total: Number(offer.total_amount) || 0,
    extra_bed_charge: Number(offer.extra_bed_charge) || 0,
    currency: offer.currency,
  };
  return { ...cart, rooms: [...cart.rooms, room] };
}

/** Remove the most recently added room of a type (the stepper's "−"). */
export function removeOneOfType(cart: Cart, roomTypeId: number): Cart {
  const index = cart.rooms.map((room) => room.room_type_id).lastIndexOf(roomTypeId);
  if (index < 0) return cart;
  return { ...cart, rooms: cart.rooms.filter((_, i) => i !== index) };
}

export function removeLine(cart: Cart, lineIdToRemove: string): Cart {
  return { ...cart, rooms: cart.rooms.filter((room) => room.line_id !== lineIdToRemove) };
}

/** Update one room's party, clamped to what the room type allows. */
export function updateLine(
  cart: Cart,
  id: string,
  patch: Partial<Pick<CartRoom, 'adults' | 'children' | 'extra_beds'>>,
): Cart {
  return {
    ...cart,
    rooms: cart.rooms.map((room) => {
      if (room.line_id !== id) return room;
      const adults = clamp(patch.adults ?? room.adults, 1, room.max_occupancy);
      const children = clamp(patch.children ?? room.children, 0, room.max_occupancy - adults);
      const extraBeds = clamp(patch.extra_beds ?? room.extra_beds, 0, room.max_extra_beds);
      return { ...room, adults, children, extra_beds: extraBeds };
    }),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), Math.max(min, max));
}

/**
 * Guests the cart can sleep: each room type's max occupancy. Extra beds are
 * not counted — the server prices them but does not let them raise a room's
 * occupancy limit, so counting them would promise space that is not there.
 */
export function cartCapacity(cart: Cart): number {
  return cart.rooms.reduce((sum, room) => sum + Math.max(0, room.max_occupancy), 0);
}

export function nightsOf(cart: Cart): number {
  const start = Date.parse(`${cart.check_in_date}T00:00:00Z`);
  const end = Date.parse(`${cart.check_out_date}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Display-only estimate until the server quote arrives. */
export function estimatedTotal(cart: Cart): number {
  const nights = nightsOf(cart);
  return cart.rooms.reduce(
    (sum, room) => sum + room.unit_total + room.extra_beds * room.extra_bed_charge * nights,
    0,
  );
}

export function toGroupRooms(cart: Cart): GroupRoomRequest[] {
  return cart.rooms.map(({ room_type_id, adults, children, extra_beds }) => ({
    room_type_id,
    adults,
    children,
    extra_beds,
  }));
}

export function sameStay(cart: Cart, search: Pick<GuestBookingSearch, 'check_in_date' | 'check_out_date'>): boolean {
  return cart.check_in_date === search.check_in_date && cart.check_out_date === search.check_out_date;
}

function isCartRoom(value: unknown): value is CartRoom {
  if (!value || typeof value !== 'object') return false;
  const room = value as Record<string, unknown>;
  return (
    typeof room.line_id === 'string' &&
    typeof room.room_type_id === 'number' &&
    typeof room.room_type_name === 'string' &&
    typeof room.adults === 'number' &&
    typeof room.children === 'number' &&
    typeof room.extra_beds === 'number' &&
    typeof room.max_occupancy === 'number' &&
    typeof room.max_extra_beds === 'number' &&
    typeof room.unit_total === 'number' &&
    typeof room.extra_bed_charge === 'number' &&
    typeof room.currency === 'string'
  );
}

/** Read the saved cart; anything malformed or empty reads as no cart. */
export function loadCart(storage: Pick<Storage, 'getItem'> | undefined = safeSessionStorage()): Cart | null {
  try {
    const raw = storage?.getItem(CART_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Cart>;
    if (typeof parsed.check_in_date !== 'string' || typeof parsed.check_out_date !== 'string') return null;
    const rooms = Array.isArray(parsed.rooms) ? parsed.rooms.filter(isCartRoom).slice(0, MAX_CART_ROOMS) : [];
    if (rooms.length === 0) return null;
    return { check_in_date: parsed.check_in_date, check_out_date: parsed.check_out_date, rooms };
  } catch {
    return null;
  }
}

export function saveCart(
  cart: Cart | null,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeSessionStorage(),
): void {
  try {
    if (!cart || cart.rooms.length === 0) storage?.removeItem(CART_STORAGE_KEY);
    else storage?.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Private mode / quota: the cart simply does not persist.
  }
}

function safeSessionStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
