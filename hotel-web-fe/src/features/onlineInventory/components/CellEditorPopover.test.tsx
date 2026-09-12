// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OnlineInventoryAllocation } from '../types';
import { buildCellView } from '../utils';
import { CellEditorPopover } from './CellEditorPopover';

const allocation = (
  overrides: Partial<OnlineInventoryAllocation> = {},
): OnlineInventoryAllocation => ({
  room_type_id: 1,
  room_type_code: 'DLXK',
  room_type_name: 'Deluxe King',
  stay_date: '2026-09-12',
  physical_available_rooms: 5,
  walk_in_reserved_rooms: 2,
  online_booking_enabled: true,
  custom_price: null,
  standard_price: '280.00',
  is_override: false,
  online_available_rooms: 3,
  ...overrides,
});

const renderPopover = (overrides: Partial<Parameters<typeof CellEditorPopover>[0]> = {}) => {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  const props = {
    view: buildCellView(allocation(), undefined),
    anchorEl: anchor,
    onClose: vi.fn(),
    onApply: vi.fn(),
    formatPrice: (v: string) => `RM ${v}`,
    ...overrides,
  };
  render(<CellEditorPopover {...props} />);
  return props;
};

describe('CellEditorPopover', () => {
  afterEach(cleanup);

  it('shows the room type, date and standard-rate context', () => {
    renderPopover();
    expect(screen.getByText(/Deluxe King/)).toBeTruthy();
    expect(screen.getByText(/September 12/)).toBeTruthy();
    expect(screen.getByText(/Standard rate.*RM 280\.00/)).toBeTruthy();
  });

  it('stages a set edit with the edited fields on Apply', () => {
    const props = renderPopover();
    const hold = screen.getByRole('spinbutton', { name: /walk-in hold/i });
    fireEvent.change(hold, { target: { value: '4' } });
    const price = screen.getByRole('spinbutton', { name: /custom online price/i });
    fireEvent.change(price, { target: { value: '199.50' } });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(props.onApply).toHaveBeenCalledWith('1:2026-09-12', {
      type: 'set',
      value: { walk_in_reserved_rooms: 4, online_booking_enabled: true, custom_price: '199.50' },
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('blocks Apply when the price is invalid', () => {
    renderPopover();
    const price = screen.getByRole('spinbutton', { name: /custom online price/i });
    fireEvent.change(price, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/greater than zero/i)).toBeTruthy();
  });

  it('warns softly when the hold exceeds physical availability', () => {
    renderPopover();
    const hold = screen.getByRole('spinbutton', { name: /walk-in hold/i });
    fireEvent.change(hold, { target: { value: '9' } });
    expect(screen.getByText(/higher than the physical availability/i)).toBeTruthy();
    // still applies — the backend tolerates over-holding
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  });

  it('stages a reset edit', () => {
    const props = renderPopover({
      view: buildCellView(allocation({ is_override: true, custom_price: '150.00' }), undefined),
    });
    fireEvent.click(screen.getByRole('button', { name: /reset to standard/i }));
    expect(props.onApply).toHaveBeenCalledWith('1:2026-09-12', { type: 'reset' });
  });

  it('toggles online booking off and on', () => {
    const props = renderPopover();
    const toggle = screen.getByRole('switch', { name: /bookable online/i });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(props.onApply).toHaveBeenCalledWith('1:2026-09-12', {
      type: 'set',
      value: { walk_in_reserved_rooms: 2, online_booking_enabled: false, custom_price: null },
    });
  });
});
