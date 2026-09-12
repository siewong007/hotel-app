import { addLocalDays, formatLocalDate, parseLocalDate } from '../../utils/date';

import type {
  CellKey,
  CellUpdateInput,
  EditableCell,
  GridCellView,
  OnlineInventoryAllocation,
  StagedEdit,
} from './types';

export const cellKey = (roomTypeId: number, date: string): CellKey =>
  `${roomTypeId}:${date}`;

export const parseCellKey = (key: CellKey): { roomTypeId: number; date: string } => {
  const separator = key.indexOf(':');
  return {
    roomTypeId: Number(key.slice(0, separator)),
    date: key.slice(separator + 1),
  };
};

export const shiftDate = (date: string, days: number): string =>
  formatLocalDate(addLocalDays(date, days));

export const dateRange = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => shiftDate(from, index));

/** 0 = Monday … 6 = Sunday (chrono's num_days_from_monday ordering). */
export const weekdayOf = (date: string): number =>
  (parseLocalDate(date).getDay() + 6) % 7;

export const editableOf = (a: OnlineInventoryAllocation): EditableCell => ({
  walk_in_reserved_rooms: a.walk_in_reserved_rooms,
  online_booking_enabled: a.online_booking_enabled,
  custom_price: a.custom_price,
});

export const DEFAULT_EDIT: EditableCell = {
  walk_in_reserved_rooms: 0,
  online_booking_enabled: true,
  custom_price: null,
};

const comparablePrice = (value: string | null): string | null => {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : value;
};

export const editsEqual = (a: EditableCell, b: EditableCell): boolean =>
  a.walk_in_reserved_rooms === b.walk_in_reserved_rooms &&
  a.online_booking_enabled === b.online_booking_enabled &&
  comparablePrice(a.custom_price) === comparablePrice(b.custom_price);

/**
 * Whether staging `edit` on `saved` changes anything. A `set` equal to the
 * saved triple is a no-op; a `reset` only matters when a stored row exists or
 * the visible state is already non-default.
 */
export const isRealChange = (
  saved: OnlineInventoryAllocation,
  edit: StagedEdit,
): boolean =>
  edit.type === 'reset'
    ? saved.is_override || !editsEqual(editableOf(saved), DEFAULT_EDIT)
    : !editsEqual(edit.value, editableOf(saved));

export const onlineAvailableOf = (edit: EditableCell, physical: number): number =>
  edit.online_booking_enabled ? Math.max(0, physical - edit.walk_in_reserved_rooms) : 0;

export const buildCellView = (
  saved: OnlineInventoryAllocation,
  edit: StagedEdit | undefined,
): GridCellView => {
  const savedEdit = editableOf(saved);
  const current =
    edit === undefined
      ? savedEdit
      : edit.type === 'reset'
        ? DEFAULT_EDIT
        : edit.value;
  return {
    key: cellKey(saved.room_type_id, saved.stay_date),
    room_type_id: saved.room_type_id,
    room_type_code: saved.room_type_code,
    room_type_name: saved.room_type_name,
    stay_date: saved.stay_date,
    physical: saved.physical_available_rooms,
    saved: savedEdit,
    current,
    standard_price: saved.standard_price,
    effective_price: current.custom_price ?? saved.standard_price,
    online_available: onlineAvailableOf(current, saved.physical_available_rooms),
    changed: edit !== undefined && isRealChange(saved, edit),
    is_reset: edit?.type === 'reset',
    is_override: saved.is_override,
  };
};

export const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export type BulkAction =
  | { kind: 'set_enabled'; enabled: boolean }
  | { kind: 'set_hold'; rooms: number }
  | { kind: 'set_price'; price: string }
  | { kind: 'adjust_price_percent'; percent: number }
  | { kind: 'adjust_price_amount'; amount: string }
  | { kind: 'reset' };

export interface BulkProjection {
  edits: Map<CellKey, StagedEdit>;
  /** Cells skipped because the price adjustment would produce ≤ 0. */
  skipped: number;
}

/**
 * Projects one bulk action over the selected cells. The base is each cell's
 * *current* (staged-aware) editable state, so chained adjustments behave the
 * way the grid displays. `weekdays` filters by `weekdayOf` (0=Mon..6=Sun);
 * null means every day.
 */
export const projectBulkAction = (
  targets: GridCellView[],
  action: BulkAction,
  weekdays: ReadonlySet<number> | null,
): BulkProjection => {
  const edits = new Map<CellKey, StagedEdit>();
  let skipped = 0;
  for (const target of targets) {
    if (weekdays !== null && !weekdays.has(weekdayOf(target.stay_date))) continue;
    if (action.kind === 'reset') {
      edits.set(target.key, { type: 'reset' });
      continue;
    }
    const base = target.current;
    let next: EditableCell;
    switch (action.kind) {
      case 'set_enabled':
        next = { ...base, online_booking_enabled: action.enabled };
        break;
      case 'set_hold':
        next = { ...base, walk_in_reserved_rooms: Math.max(0, Math.trunc(action.rooms)) };
        break;
      case 'set_price':
        next = { ...base, custom_price: action.price };
        break;
      case 'adjust_price_percent':
      case 'adjust_price_amount': {
        const effective = Number(base.custom_price ?? target.standard_price);
        const adjusted =
          action.kind === 'adjust_price_percent'
            ? roundMoney(effective * (1 + action.percent / 100))
            : roundMoney(effective + Number(action.amount));
        if (!Number.isFinite(adjusted) || adjusted <= 0) {
          skipped += 1;
          continue;
        }
        next = { ...base, custom_price: adjusted.toFixed(2) };
        break;
      }
    }
    edits.set(target.key, { type: 'set', value: next });
  }
  return { edits, skipped };
};

export const toCellUpdateInputs = (
  edits: Map<CellKey, StagedEdit>,
): CellUpdateInput[] =>
  [...edits.entries()].map(([key, edit]) => {
    const { roomTypeId, date } = parseCellKey(key);
    return edit.type === 'reset'
      ? { room_type_id: roomTypeId, stay_date: date, reset: true }
      : { room_type_id: roomTypeId, stay_date: date, ...edit.value };
  });

/** All cell keys inside the rectangle two keys span, row-major order. */
export const rectKeys = (
  a: CellKey,
  b: CellKey,
  roomTypeIds: number[],
  dates: string[],
): CellKey[] => {
  const pa = parseCellKey(a);
  const pb = parseCellKey(b);
  const r0 = roomTypeIds.indexOf(pa.roomTypeId);
  const r1 = roomTypeIds.indexOf(pb.roomTypeId);
  const c0 = dates.indexOf(pa.date);
  const c1 = dates.indexOf(pb.date);
  if (r0 < 0 || r1 < 0 || c0 < 0 || c1 < 0) return [b];
  const keys: CellKey[] = [];
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r += 1) {
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c += 1) {
      keys.push(cellKey(roomTypeIds[r], dates[c]));
    }
  }
  return keys;
};

export interface SummaryRun {
  from: string;
  to: string;
  lines: string[];
}

export interface EditSummaryGroup {
  roomTypeId: number;
  name: string;
  code: string;
  runs: SummaryRun[];
}

const describeEdit = (
  saved: OnlineInventoryAllocation | undefined,
  edit: StagedEdit,
  formatPrice: (value: string) => string,
): string[] => {
  if (edit.type === 'reset') return ['Reset to standard rules'];
  if (!saved) return ['Updated'];
  const lines: string[] = [];
  const value = edit.value;
  if (value.online_booking_enabled !== saved.online_booking_enabled) {
    lines.push(value.online_booking_enabled ? 'Reopen online' : 'Close online');
  }
  if (value.walk_in_reserved_rooms !== saved.walk_in_reserved_rooms) {
    lines.push(
      `Hold ${value.walk_in_reserved_rooms} for walk-ins (was ${saved.walk_in_reserved_rooms})`,
    );
  }
  if (comparablePrice(value.custom_price) !== comparablePrice(saved.custom_price)) {
    lines.push(
      value.custom_price === null
        ? 'Price → standard rate'
        : `Price → ${formatPrice(value.custom_price)} (standard ${formatPrice(saved.standard_price)})`,
    );
  }
  return lines.length > 0 ? lines : ['Updated'];
};

const sameEdit = (a: StagedEdit, b: StagedEdit): boolean =>
  a.type === 'reset' && b.type === 'reset'
    ? true
    : a.type === 'set' && b.type === 'set' && editsEqual(a.value, b.value);

/**
 * Groups staged edits per room type, collapsing runs of contiguous dates that
 * carry an identical edit — "Jul 3–9 → Close online" instead of seven rows.
 * Descriptions are computed against the run's first saved cell.
 */
export const summarizeEdits = (
  edits: Map<CellKey, StagedEdit>,
  saved: Map<CellKey, OnlineInventoryAllocation>,
  formatPrice: (value: string) => string,
): EditSummaryGroup[] => {
  const byRoomType = new Map<number, { name: string; code: string; entries: [string, StagedEdit][] }>();
  for (const [key, edit] of edits) {
    const { roomTypeId, date } = parseCellKey(key);
    const savedCell = saved.get(key);
    const group = byRoomType.get(roomTypeId) ?? {
      name: savedCell?.room_type_name ?? `Room type ${roomTypeId}`,
      code: savedCell?.room_type_code ?? '',
      entries: [],
    };
    group.entries.push([date, edit]);
    byRoomType.set(roomTypeId, group);
  }

  type RunDraft = SummaryRun & { edit: StagedEdit };

  return [...byRoomType.entries()]
    .map(([roomTypeId, group]) => {
      group.entries.sort(([a], [b]) => a.localeCompare(b));
      const runs: RunDraft[] = [];
      for (const [date, edit] of group.entries) {
        const last = runs[runs.length - 1];
        if (last && shiftDate(last.to, 1) === date && sameEdit(last.edit, edit)) {
          last.to = date;
          continue;
        }
        runs.push({
          from: date,
          to: date,
          lines: describeEdit(saved.get(cellKey(roomTypeId, date)), edit, formatPrice),
          edit,
        });
      }
      return { roomTypeId, name: group.name, code: group.code, runs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};
