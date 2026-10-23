import { describe, expect, it } from 'vitest';
import {
  addRoom, emptyCart, estimatedTotal, loadCart, MAX_CART_ROOMS, remainingForOffer,
  removeOneOfType, saveCart, toGroupRooms, updateLine, type Cart,
} from './cart';
import type { GuestBookingOffer, GuestBookingSearch } from './types';

const search: GuestBookingSearch = { check_in_date: '2026-12-01', check_out_date: '2026-12-03', adults: 2, children: 1 };

function offer(id: number, available: number, extra = 0): GuestBookingOffer {
  return {
    room_type_id: id, room_type_code: `T${id}`, room_type_name: `Type ${id}`, max_occupancy: 2,
    images: [], features: [], available_rooms: available, max_extra_beds: extra, extra_bed_charge: '30',
    currency: 'MYR', nightly_rates: [], subtotal: '200', discount_amount: '0', tax_amount: '0', total_amount: '200',
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('multi-room cart', () => {
  it('caps a type at its availability', () => {
    let cart = emptyCart(search);
    const deluxe = offer(2, 2);
    cart = addRoom(addRoom(addRoom(cart, deluxe, search), deluxe, search), deluxe, search);
    expect(cart.rooms).toHaveLength(2);
    expect(remainingForOffer(cart, deluxe)).toBe(0);
  });

  it('caps the cart at five rooms', () => {
    let cart: Cart = emptyCart(search);
    const standard = offer(1, 10);
    for (let i = 0; i < 8; i += 1) cart = addRoom(cart, standard, search);
    expect(cart.rooms).toHaveLength(MAX_CART_ROOMS);
  });

  it('fits the searched party into the room and clamps edits', () => {
    let cart = addRoom(emptyCart(search), offer(1, 3, 1), search);
    const [room] = cart.rooms;
    expect(room.adults).toBe(2);
    expect(room.children).toBe(0);
    cart = updateLine(cart, room.line_id, { adults: 1, children: 5, extra_beds: 4 });
    expect(cart.rooms[0]).toMatchObject({ adults: 1, children: 1, extra_beds: 1 });
  });

  it('estimates extra beds per bed per night', () => {
    let cart = addRoom(emptyCart(search), offer(1, 3, 2), search);
    cart = updateLine(cart, cart.rooms[0].line_id, { extra_beds: 2 });
    expect(estimatedTotal(cart)).toBe(200 + 2 * 30 * 2);
    expect(toGroupRooms(cart)).toEqual([{ room_type_id: 1, adults: 2, children: 0, extra_beds: 2 }]);
  });

  it('removes the last room of a type', () => {
    let cart = addRoom(addRoom(emptyCart(search), offer(1, 3), search), offer(2, 3), search);
    cart = removeOneOfType(cart, 1);
    expect(cart.rooms.map((room) => room.room_type_id)).toEqual([2]);
  });

  it('round-trips through storage and drops malformed data', () => {
    const storage = memoryStorage();
    const cart = addRoom(emptyCart(search), offer(1, 3), search);
    saveCart(cart, storage);
    expect(loadCart(storage)).toEqual(cart);
    storage.setItem('portal-booking-cart-v1', '{"check_in_date":1}');
    expect(loadCart(storage)).toBeNull();
    saveCart(emptyCart(search), storage);
    expect(loadCart(storage)).toBeNull();
  });
});
