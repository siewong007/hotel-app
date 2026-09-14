// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phone view: useMediaQuery reports a phone viewport (jsdom has no matchMedia).
const mocks = vi.hoisted(() => ({ isPhone: true }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});

import type { CellKey, GridCellView, OnlineInventoryAllocation } from '../types';
import { buildCellView, cellKey } from '../utils';
import { CellEditorSheet } from './CellEditorSheet';
import { PhoneInventoryView } from './PhoneInventoryView';

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

const TODAY = '2026-09-12';
const DATES = ['2026-09-12', '2026-09-13', '2026-09-14'];

const roomTypes = [
  { room_type_id: 1, room_type_code: 'DLXK', room_type_name: 'Deluxe King' },
  { room_type_id: 2, room_type_code: 'STE', room_type_name: 'Suite' },
];

const fixtureCells = (): Map<CellKey, GridCellView> => {
  const map = new Map<CellKey, GridCellView>();
  for (const id of [1, 2]) {
    for (const date of DATES) {
      const saved = allocation({
        room_type_id: id,
        room_type_name: id === 1 ? 'Deluxe King' : 'Suite',
        room_type_code: id === 1 ? 'DLXK' : 'STE',
        stay_date: date,
        // Suite holds 2 of 5 for walk-ins today → 3 free.
        walk_in_reserved_rooms: id === 2 && date === TODAY ? 2 : 0,
      });
      map.set(cellKey(id, date), buildCellView(saved, undefined));
    }
  }
  return map;
};

const viewProps = (overrides: Partial<Parameters<typeof PhoneInventoryView>[0]> = {}) => ({
  roomTypes,
  dates: DATES,
  cells: fixtureCells(),
  today: TODAY,
  selected: new Set<CellKey>(),
  selectMode: false,
  onToggleSelect: vi.fn(),
  onOpenCell: vi.fn(),
  formatPrice: (v: string) => `RM ${v}`,
  ...overrides,
});

const renderView = (overrides: Partial<Parameters<typeof PhoneInventoryView>[0]> = {}) => {
  const props = viewProps(overrides);
  const utils = render(<PhoneInventoryView {...props} />);
  return { props, ...utils };
};

describe('PhoneInventoryView', () => {
  beforeEach(() => {
    mocks.isPhone = true;
  });
  afterEach(cleanup);

  it('renders one card per room type with the code chip', () => {
    renderView();
    expect(screen.getByText('Deluxe King')).toBeTruthy();
    expect(screen.getByText('Suite')).toBeTruthy();
    expect(screen.getByText('DLXK')).toBeTruthy();
    expect(screen.getByText('STE')).toBeTruthy();
  });

  it('reads the "N free today" count from the cells map', () => {
    renderView();
    // Deluxe King today: 5 physical, 0 held → 5 online; Suite: 5 - 2 held → 3.
    expect(screen.getByText('5 free today')).toBeTruthy();
    expect(screen.getByText('3 free today')).toBeTruthy();
  });

  it('tapping a day cell in normal mode opens the cell editor', () => {
    const { props } = renderView();
    fireEvent.click(
      screen.getByRole('button', { name: /suite.*september 14/i }),
    );
    expect(props.onOpenCell).toHaveBeenCalledWith('2:2026-09-14');
    expect(props.onToggleSelect).not.toHaveBeenCalled();
  });

  it('select mode toggles cells instead of opening the editor', () => {
    const { props, rerender } = renderView({
      selectMode: true,
      selected: new Set<CellKey>(['1:2026-09-12']),
    });

    const first = screen.getByRole('button', { name: /deluxe king.*september 12/i });
    const second = screen.getByRole('button', { name: /deluxe king.*september 13/i });
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(second);
    expect(props.onToggleSelect).toHaveBeenCalledWith('1:2026-09-13');
    expect(props.onOpenCell).not.toHaveBeenCalled();

    // The page adds the key to the selection — both cells now read selected.
    rerender(
      <PhoneInventoryView
        {...props}
        selected={new Set<CellKey>(['1:2026-09-12', '1:2026-09-13'])}
      />,
    );
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the Closed lock row and still dots overridden cells', () => {
    const cells = fixtureCells();
    cells.set(
      '1:2026-09-13',
      buildCellView(
        allocation({ stay_date: '2026-09-13', online_booking_enabled: false, is_override: true }),
        undefined,
      ),
    );
    cells.set(
      '1:2026-09-14',
      buildCellView(allocation({ stay_date: '2026-09-14' }), {
        type: 'set',
        value: { walk_in_reserved_rooms: 1, online_booking_enabled: true, custom_price: null },
      }),
    );
    renderView({ cells });

    const closed = screen.getByRole('button', { name: /closed to online booking/i });
    expect(closed.textContent).toContain('Closed');
    const changed = screen.getByRole('button', { name: /modified/i });
    expect(changed.getAttribute('aria-label')).toContain('modified');
  });
});

describe('CellEditorSheet', () => {
  afterEach(cleanup);

  const sheetProps = (overrides: Partial<Parameters<typeof CellEditorSheet>[0]> = {}) => ({
    view: buildCellView(allocation(), undefined),
    onClose: vi.fn(),
    onApply: vi.fn(),
    ...overrides,
  });

  it('renders the cell title and stages the edited draft on Apply', () => {
    const props = sheetProps();
    render(<CellEditorSheet {...props} />);

    expect(screen.getByText(/Deluxe King · /)).toBeTruthy();

    const hold = screen.getByRole('spinbutton', { name: /walk-in hold/i });
    fireEvent.change(hold, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(props.onApply).toHaveBeenCalledWith('1:2026-09-12', {
      type: 'set',
      value: { walk_in_reserved_rooms: 4, online_booking_enabled: true, custom_price: null },
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('offers Reset only for override cells and stages a reset edit', () => {
    const props = sheetProps({
      view: buildCellView(allocation({ is_override: true, custom_price: '150.00' }), undefined),
    });
    render(<CellEditorSheet {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /reset to standard/i }));
    expect(props.onApply).toHaveBeenCalledWith('1:2026-09-12', { type: 'reset' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('hides Reset for non-override cells and blocks Apply on an invalid price', () => {
    const props = sheetProps();
    render(<CellEditorSheet {...props} />);

    expect(screen.queryByRole('button', { name: /reset to standard/i })).toBeNull();

    const price = screen.getByRole('spinbutton', { name: /custom online price/i });
    fireEvent.change(price, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
  });

  it('stays closed when no cell is open', () => {
    const props = sheetProps({ view: null });
    render(<CellEditorSheet {...props} />);
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });
});
