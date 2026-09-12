// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GridCellView, OnlineInventoryAllocation } from '../types';
import { buildCellView, cellKey } from '../utils';
import { InventoryGrid } from './InventoryGrid';

const allocation = (
  overrides: Partial<OnlineInventoryAllocation> = {},
): OnlineInventoryAllocation => ({
  room_type_id: 1,
  room_type_code: 'DLXK',
  room_type_name: 'Deluxe King',
  stay_date: '2026-09-12',
  physical_available_rooms: 5,
  walk_in_reserved_rooms: 0,
  online_booking_enabled: true,
  custom_price: null,
  standard_price: '280.00',
  is_override: false,
  online_available_rooms: 5,
  ...overrides,
});

const IDS = [1, 2];
const DATES = ['2026-09-12', '2026-09-13', '2026-09-14'];

const fixtureCells = (): Map<string, GridCellView> => {
  const map = new Map<string, GridCellView>();
  for (const id of IDS) {
    for (const date of DATES) {
      const saved = allocation({
        room_type_id: id,
        room_type_name: id === 1 ? 'Deluxe King' : 'Suite',
        room_type_code: id === 1 ? 'DLXK' : 'STE',
        stay_date: date,
      });
      map.set(cellKey(id, date), buildCellView(saved, undefined));
    }
  }
  return map;
};

const roomTypes = [
  { room_type_id: 1, room_type_code: 'DLXK', room_type_name: 'Deluxe King' },
  { room_type_id: 2, room_type_code: 'STE', room_type_name: 'Suite' },
];

const renderGrid = (overrides: Partial<Parameters<typeof InventoryGrid>[0]> = {}) => {
  const props = {
    roomTypes,
    dates: DATES,
    cells: fixtureCells(),
    selected: new Set<string>(),
    focused: null as string | null,
    today: '2026-09-12',
    onSelectCell: vi.fn(),
    onMoveFocus: vi.fn(),
    onSelectRange: vi.fn(),
    onSelectRow: vi.fn(),
    onSelectColumn: vi.fn(),
    onSelectAll: vi.fn(),
    onOpenEditor: vi.fn(),
    onClearSelection: vi.fn(),
    formatPrice: (v: string) => `RM ${v}`,
    ...overrides,
  };
  render(<InventoryGrid {...props} />);
  return props;
};

describe('InventoryGrid', () => {
  afterEach(cleanup);

  it('renders an ARIA grid with row/column headers and gridcells', () => {
    renderGrid();
    expect(screen.getByRole('grid', { name: /online inventory/i })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 room types
    expect(screen.getAllByRole('columnheader')).toHaveLength(4); // corner + 3 dates
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
    expect(screen.getAllByRole('gridcell')).toHaveLength(6); // 2 types x 3 dates
  });

  it('labels each cell with type, date, availability and price', () => {
    renderGrid();
    const cell = screen.getAllByRole('gridcell')[0];
    expect(cell.getAttribute('aria-label')).toContain('Deluxe King');
    expect(cell.getAttribute('aria-label')).toContain('5 online');
    expect(cell.getAttribute('aria-label')).toContain('RM 280.00');
  });

  it('moves focus with arrow keys and opens the editor on Enter', () => {
    const props = renderGrid({ focused: '1:2026-09-12' });
    const cell = screen.getAllByRole('gridcell')[0];

    fireEvent.keyDown(cell, { key: 'ArrowRight' });
    expect(props.onMoveFocus).toHaveBeenCalledWith('1:2026-09-13', false);

    fireEvent.keyDown(cell, { key: 'ArrowDown' });
    expect(props.onMoveFocus).toHaveBeenCalledWith('2:2026-09-12', false);

    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(props.onOpenEditor).toHaveBeenCalledWith('1:2026-09-12', expect.anything());
  });

  it('extends the selection on shift+arrow and clears it on Escape', () => {
    const props = renderGrid({ focused: '1:2026-09-12' });
    const cell = screen.getAllByRole('gridcell')[0];

    fireEvent.keyDown(cell, { key: 'ArrowRight', shiftKey: true });
    expect(props.onMoveFocus).toHaveBeenCalledWith('1:2026-09-13', true);

    fireEvent.keyDown(cell, { key: 'Escape' });
    expect(props.onClearSelection).toHaveBeenCalled();
  });

  it('marks selected cells and selects via headers', () => {
    const props = renderGrid({ selected: new Set(['1:2026-09-12']), focused: '1:2026-09-12' });
    const cell = screen.getAllByRole('gridcell')[0];
    expect(cell.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /select all .*september 13/i }));
    expect(props.onSelectColumn).toHaveBeenCalledWith('2026-09-13');

    fireEvent.click(screen.getByRole('button', { name: /select row suite/i }));
    expect(props.onSelectRow).toHaveBeenCalledWith(2);
  });

  it('selects a cell on click and opens the editor on double click', () => {
    const props = renderGrid();
    const cell = screen.getAllByRole('gridcell')[0];

    fireEvent.click(cell);
    expect(props.onSelectCell).toHaveBeenCalledWith('1:2026-09-12', false);

    fireEvent.doubleClick(cell);
    expect(props.onOpenEditor).toHaveBeenCalledWith('1:2026-09-12', expect.anything());
  });

  it('renders closed, sold-out and changed states as text, not color alone', () => {
    const cells = fixtureCells();
    cells.set(
      '1:2026-09-12',
      buildCellView(allocation({ online_booking_enabled: false, is_override: true }), undefined),
    );
    cells.set(
      '1:2026-09-13',
      buildCellView(allocation({ physical_available_rooms: 0, stay_date: '2026-09-13' }), undefined),
    );
    cells.set(
      '1:2026-09-14',
      buildCellView(allocation({ stay_date: '2026-09-14' }), {
        type: 'set',
        value: { walk_in_reserved_rooms: 2, online_booking_enabled: true, custom_price: null },
      }),
    );
    renderGrid({ cells });

    const closed = screen.getAllByRole('gridcell')[0];
    expect(closed.textContent).toContain('Closed');
    const soldOut = screen.getAllByRole('gridcell')[1];
    expect(soldOut.textContent).toContain('None left');
    const changed = screen.getAllByRole('gridcell')[2];
    expect(changed.getAttribute('aria-label')).toContain('modified');
  });
});
