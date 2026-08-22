import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { OnlineInventoryAllocation } from '../types';
import { InventorySummary } from './InventorySummary';

const allocation = (
  overrides: Partial<OnlineInventoryAllocation> = {},
): OnlineInventoryAllocation => ({
  room_type_id: 1,
  room_type_code: 'STDQ',
  room_type_name: 'Standard Queen',
  stay_date: '2026-09-01',
  physical_available_rooms: 5,
  walk_in_reserved_rooms: 2,
  online_booking_enabled: true,
  custom_price: null,
  online_available_rooms: 3,
  ...overrides,
});

const labels = ['Physically free', 'Held for walk-ins', 'Available online'];

function valueFor(label: string): number {
  // Each summary item renders "<label><value>rooms</value>" — read the number
  // sibling that follows the label.
  const labelEl = screen.getByText(label.toUpperCase());
  const stack = labelEl.parentElement!.parentElement!;
  return Number(stack.textContent!.replace(label.toUpperCase(), '').replace('rooms', ''));
}

describe('InventorySummary', () => {
  afterEach(cleanup);

  it('sums physical, walk-in-held, and online rooms across allocations', () => {
    render(
      <InventorySummary
        items={[
          allocation(),
          allocation({
            room_type_id: 2,
            physical_available_rooms: 4,
            walk_in_reserved_rooms: 1,
          }),
        ]}
      />,
    );

    expect(valueFor(labels[0])).toBe(9); // 5 + 4
    expect(valueFor(labels[1])).toBe(3); // 2 + 1
    expect(valueFor(labels[2])).toBe(6); // (5-2) + (4-1)
  });

  it('excludes offline room types from the online figure but not from physical', () => {
    render(
      <InventorySummary
        items={[
          allocation(),
          allocation({
            room_type_id: 2,
            physical_available_rooms: 7,
            walk_in_reserved_rooms: 0,
            online_booking_enabled: false,
          }),
        ]}
      />,
    );

    expect(valueFor(labels[0])).toBe(12); // 5 + 7
    expect(valueFor(labels[1])).toBe(2);
    expect(valueFor(labels[2])).toBe(3); // only the enabled type contributes
  });

  it('never reports negative online availability when walk-ins exceed physical', () => {
    render(
      <InventorySummary
        items={[
          allocation({ physical_available_rooms: 1, walk_in_reserved_rooms: 4 }),
        ]}
      />,
    );

    expect(valueFor(labels[0])).toBe(1);
    expect(valueFor(labels[1])).toBe(4);
    expect(valueFor(labels[2])).toBe(0); // Math.max(0, 1 - 4)
  });
});
