// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OnlineInventoryAllocation } from '../types';
import { buildCellView } from '../utils';
import { BulkEditPanel } from './BulkEditPanel';

const allocation = (
  overrides: Partial<OnlineInventoryAllocation> = {},
): OnlineInventoryAllocation => ({
  room_type_id: 1,
  room_type_code: 'DLXK',
  room_type_name: 'Deluxe King',
  stay_date: '2026-09-12', // a Saturday
  physical_available_rooms: 5,
  walk_in_reserved_rooms: 0,
  online_booking_enabled: true,
  custom_price: null,
  standard_price: '280.00',
  is_override: false,
  online_available_rooms: 5,
  ...overrides,
});

const twoCells = () => [
  buildCellView(allocation(), undefined), // Sat Sep 12
  buildCellView(allocation({ stay_date: '2026-09-14' }), undefined), // Mon Sep 14
];

const renderPanel = (targets = twoCells()) => {
  const onApply = vi.fn();
  const onClear = vi.fn();
  render(<BulkEditPanel targets={targets} onApply={onApply} onClear={onClear} />);
  return { onApply, onClear };
};

describe('BulkEditPanel', () => {
  afterEach(cleanup);

  it('renders nothing without a selection', () => {
    const { container } = render(
      <BulkEditPanel
        targets={[]}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('announces the selection size', () => {
    renderPanel();
    expect(screen.getByText(/2 cells selected/)).toBeTruthy();
  });

  it('closes all selected cells', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close online' }));
    const edits = props.onApply.mock.calls[0][0] as Map<string, unknown>;
    expect(edits.size).toBe(2);
    expect(edits.get('1:2026-09-12')).toEqual({
      type: 'set',
      value: { walk_in_reserved_rooms: 0, online_booking_enabled: false, custom_price: null },
    });
  });

  it('sets a price on all selected cells', () => {
    const props = renderPanel();
    fireEvent.change(screen.getByRole('spinbutton', { name: /set price/i }), {
      target: { value: '199' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set price' }));
    const edits = props.onApply.mock.calls[0][0] as Map<string, { value: { custom_price: string } }>;
    expect(edits.get('1:2026-09-12')?.value.custom_price).toBe('199.00');
  });

  it('adjusts the effective price by a percentage', () => {
    const props = renderPanel();
    fireEvent.change(screen.getByRole('spinbutton', { name: /adjust by percent/i }), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply %' }));
    const edits = props.onApply.mock.calls[0][0] as Map<string, { value: { custom_price: string } }>;
    expect(edits.get('1:2026-09-12')?.value.custom_price).toBe('308.00');
  });

  it('filters the projection by weekday', () => {
    const props = renderPanel();
    // Leave only Saturday selected → the Monday cell drops out.
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sun']) {
      fireEvent.click(screen.getByRole('button', { name: day }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close online' }));
    const edits = props.onApply.mock.calls[0][0] as Map<string, unknown>;
    expect(edits.size).toBe(1);
    expect(edits.has('1:2026-09-12')).toBe(true);
    expect(edits.has('1:2026-09-14')).toBe(false);
  });

  it('reports skipped cells when an adjustment goes non-positive', () => {
    const props = renderPanel();
    fireEvent.change(screen.getByRole('spinbutton', { name: /adjust by percent/i }), {
      target: { value: '-150' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply %' }));
    expect(screen.getByText(/2 cells skipped/)).toBeTruthy();
    expect(props.onApply).toHaveBeenCalled();
  });

  it('stages resets via Clear overrides', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Clear overrides' }));
    const edits = props.onApply.mock.calls[0][0] as Map<string, unknown>;
    expect(edits.get('1:2026-09-12')).toEqual({ type: 'reset' });
  });
});
