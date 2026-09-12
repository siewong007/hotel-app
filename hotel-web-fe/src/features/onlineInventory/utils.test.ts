import { describe, expect, it } from 'vitest';

import type { EditableCell, GridCellView, OnlineInventoryAllocation, StagedEdit } from './types';
import {
  DEFAULT_EDIT,
  buildCellView,
  cellKey,
  dateRange,
  editsEqual,
  editableOf,
  isRealChange,
  parseCellKey,
  projectBulkAction,
  rectKeys,
  shiftDate,
  summarizeEdits,
  toCellUpdateInputs,
  weekdayOf,
} from './utils';

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

const fmt = (v: string) => `RM ${v}`;

describe('cell keys and dates', () => {
  it('round-trips cell keys', () => {
    const key = cellKey(7, '2026-09-12');
    expect(key).toBe('7:2026-09-12');
    expect(parseCellKey(key)).toEqual({ roomTypeId: 7, date: '2026-09-12' });
  });

  it('shifts dates across month boundaries', () => {
    expect(shiftDate('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01'); // 2026 not a leap year
  });

  it('builds an inclusive date range', () => {
    expect(dateRange('2026-09-28', 5)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });

  it('maps weekdays as 0=Mon..6=Sun', () => {
    expect(weekdayOf('2026-09-12')).toBe(5); // Saturday
    expect(weekdayOf('2026-09-13')).toBe(6); // Sunday
    expect(weekdayOf('2026-09-14')).toBe(0); // Monday
  });
});

describe('edit comparison', () => {
  it('treats "10" and "10.00" as the same price', () => {
    const a: EditableCell = { walk_in_reserved_rooms: 0, online_booking_enabled: true, custom_price: '10' };
    const b: EditableCell = { walk_in_reserved_rooms: 0, online_booking_enabled: true, custom_price: '10.00' };
    expect(editsEqual(a, b)).toBe(true);
  });

  it('flags real changes and ignores no-ops', () => {
    const saved = allocation();
    expect(isRealChange(saved, { type: 'set', value: { ...editableOf(saved) } })).toBe(false);
    expect(
      isRealChange(saved, { type: 'set', value: { ...editableOf(saved), walk_in_reserved_rooms: 2 } }),
    ).toBe(true);
    // reset on an untouched cell is a no-op; on an override row it deletes the row
    expect(isRealChange(saved, { type: 'reset' })).toBe(false);
    expect(isRealChange(allocation({ is_override: true }), { type: 'reset' })).toBe(true);
    expect(
      isRealChange(
        allocation({ is_override: false, walk_in_reserved_rooms: 3 }),
        { type: 'reset' },
      ),
    ).toBe(true);
  });
});

describe('buildCellView', () => {
  it('falls back to the standard price and clamps online availability at zero', () => {
    const view = buildCellView(
      allocation({ physical_available_rooms: 2, walk_in_reserved_rooms: 5 }),
      undefined,
    );
    expect(view.effective_price).toBe('280.00');
    expect(view.online_available).toBe(0);
    expect(view.changed).toBe(false);
  });

  it('applies a staged set and marks the cell changed', () => {
    const view = buildCellView(allocation(), {
      type: 'set',
      value: { walk_in_reserved_rooms: 2, online_booking_enabled: true, custom_price: '199.00' },
    });
    expect(view.effective_price).toBe('199.00');
    expect(view.online_available).toBe(3);
    expect(view.changed).toBe(true);
    expect(view.is_reset).toBe(false);
  });

  it('applies a staged reset to defaults and flags it', () => {
    const view = buildCellView(
      allocation({ is_override: true, custom_price: '150.00', online_booking_enabled: false }),
      { type: 'reset' },
    );
    expect(view.current).toEqual(DEFAULT_EDIT);
    expect(view.is_reset).toBe(true);
    expect(view.changed).toBe(true);
    expect(view.effective_price).toBe('280.00');
  });
});

describe('projectBulkAction', () => {
  const views = (specs: Partial<OnlineInventoryAllocation>[]): GridCellView[] =>
    specs.map((s, i) => buildCellView(allocation({ stay_date: `2026-09-${String(12 + i).padStart(2, '0')}`, ...s }), undefined));

  it('applies set_enabled to every target', () => {
    const targets = views([{}, {}]);
    const { edits } = projectBulkAction(targets, { kind: 'set_enabled', enabled: false }, null);
    expect(edits.size).toBe(2);
    for (const e of edits.values()) {
      expect(e).toEqual({ type: 'set', value: expect.objectContaining({ online_booking_enabled: false }) });
    }
  });

  it('respects the weekday filter', () => {
    // 2026-09-12 = Sat (5), 2026-09-13 = Sun (6), 2026-09-14 = Mon (0)
    const targets = views([{}, {}, {}]);
    const { edits } = projectBulkAction(
      targets,
      { kind: 'set_hold', rooms: 2 },
      new Set([0]), // Mondays only
    );
    expect(edits.size).toBe(1);
    const [key] = [...edits.keys()];
    expect(parseCellKey(key).date).toBe('2026-09-14');
  });

  it('adjusts price by percent on the effective price and rounds to cents', () => {
    const targets = views([{ standard_price: '100.00' }]);
    const { edits, skipped } = projectBulkAction(
      targets,
      { kind: 'adjust_price_percent', percent: 12.5 },
      null,
    );
    expect(skipped).toBe(0);
    const [edit] = [...edits.values()];
    expect(edit).toEqual({
      type: 'set',
      value: expect.objectContaining({ custom_price: '112.50' }),
    });
  });

  it('adjusts price by amount from the current custom price when set', () => {
    const targets = views([{ custom_price: '90.00', standard_price: '100.00' }]);
    const { edits } = projectBulkAction(
      targets,
      { kind: 'adjust_price_amount', amount: '-15' },
      null,
    );
    const [edit] = [...edits.values()];
    expect(edit).toEqual({
      type: 'set',
      value: expect.objectContaining({ custom_price: '75.00' }),
    });
  });

  it('skips adjustments that would drop a price to zero or below', () => {
    const targets = views([{ standard_price: '100.00' }]);
    const { edits, skipped } = projectBulkAction(
      targets,
      { kind: 'adjust_price_percent', percent: -100 },
      null,
    );
    expect(edits.size).toBe(0);
    expect(skipped).toBe(1);
  });

  it('stages resets', () => {
    const targets = views([{ is_override: true }]);
    const { edits } = projectBulkAction(targets, { kind: 'reset' }, null);
    expect([...edits.values()]).toEqual([{ type: 'reset' }]);
  });
});

describe('toCellUpdateInputs', () => {
  it('serializes set and reset edits for the bulk endpoint', () => {
    const edits = new Map<string, StagedEdit>([
      ['1:2026-09-12', { type: 'set', value: { walk_in_reserved_rooms: 2, online_booking_enabled: false, custom_price: '99.00' } }],
      ['1:2026-09-13', { type: 'reset' }],
    ]);
    expect(toCellUpdateInputs(edits)).toEqual([
      {
        room_type_id: 1,
        stay_date: '2026-09-12',
        walk_in_reserved_rooms: 2,
        online_booking_enabled: false,
        custom_price: '99.00',
      },
      { room_type_id: 1, stay_date: '2026-09-13', reset: true },
    ]);
  });
});

describe('rectKeys', () => {
  it('produces the rectangle between two cells', () => {
    const rect = rectKeys('1:2026-09-12', '2:2026-09-13', [1, 2, 3], ['2026-09-12', '2026-09-13', '2026-09-14']);
    expect(new Set(rect)).toEqual(
      new Set(['1:2026-09-12', '1:2026-09-13', '2:2026-09-12', '2:2026-09-13']),
    );
  });
});

describe('summarizeEdits', () => {
  it('collapses contiguous identical edits into one run per room type', () => {
    const saved = new Map([
      [cellKey(1, '2026-09-12'), allocation({ stay_date: '2026-09-12' })],
      [cellKey(1, '2026-09-13'), allocation({ stay_date: '2026-09-13' })],
      [cellKey(1, '2026-09-14'), allocation({ stay_date: '2026-09-14' })],
      [cellKey(2, '2026-09-12'), allocation({ room_type_id: 2, room_type_name: 'Suite', stay_date: '2026-09-12' })],
    ]);
    const closed: StagedEdit = {
      type: 'set',
      value: { walk_in_reserved_rooms: 0, online_booking_enabled: false, custom_price: null },
    };
    const edits = new Map<string, StagedEdit>([
      [cellKey(1, '2026-09-12'), closed],
      [cellKey(1, '2026-09-13'), closed],
      [cellKey(1, '2026-09-14'), { type: 'set', value: { walk_in_reserved_rooms: 1, online_booking_enabled: true, custom_price: null } }],
      [cellKey(2, '2026-09-12'), { type: 'reset' }],
    ]);

    const groups = summarizeEdits(edits, saved, fmt);
    expect(groups).toHaveLength(2);
    const deluxe = groups.find((g) => g.roomTypeId === 1)!;
    expect(deluxe.runs).toHaveLength(2);
    expect(deluxe.runs[0]).toMatchObject({ from: '2026-09-12', to: '2026-09-13' });
    expect(deluxe.runs[0].lines.join(' ')).toContain('Close online');
    expect(deluxe.runs[1].lines.join(' ')).toContain('Hold 1');
    const suite = groups.find((g) => g.roomTypeId === 2)!;
    expect(suite.runs[0].lines.join(' ')).toContain('standard');
  });
});
