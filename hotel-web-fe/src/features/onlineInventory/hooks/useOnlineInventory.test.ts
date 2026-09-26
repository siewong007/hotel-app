// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnlineInventoryAllocation } from '../types';
import { cellKey } from '../utils';
import { buildKyHttpError } from '../../../api/testSupport/httpError';

const getOnlineInventoryRange = vi.fn();
const bulkUpdateOnlineInventory = vi.fn();

vi.mock('../api', () => ({
  getOnlineInventoryRange: (...args: unknown[]) => getOnlineInventoryRange(...args),
  bulkUpdateOnlineInventory: (...args: unknown[]) => bulkUpdateOnlineInventory(...args),
}));

import { useOnlineInventory } from './useOnlineInventory';

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

const rangeRows = (): OnlineInventoryAllocation[] => [
  allocation(),
  allocation({ stay_date: '2026-09-13' }),
  allocation({ room_type_id: 2, room_type_code: 'STE', room_type_name: 'Suite' }),
];

describe('useOnlineInventory', () => {
  beforeEach(() => {
    getOnlineInventoryRange.mockReset();
    bulkUpdateOnlineInventory.mockReset();
    getOnlineInventoryRange.mockResolvedValue(rangeRows());
    bulkUpdateOnlineInventory.mockImplementation(async () => []);
  });

  it('loads the range and exposes room types, dates and cell views', async () => {
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getOnlineInventoryRange).toHaveBeenCalledWith('2026-09-12', '2026-09-25');
    expect(result.current.roomTypes.map((r) => r.room_type_id)).toEqual([1, 2]);
    expect(result.current.dates).toEqual(['2026-09-12', '2026-09-13']);
    expect(result.current.cells.size).toBe(3);
    expect(result.current.changedCount).toBe(0);
  });

  it('stages real edits and drops no-ops', async () => {
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const key = cellKey(1, '2026-09-12');
    act(() =>
      result.current.stageCell(key, {
        type: 'set',
        value: { walk_in_reserved_rooms: 2, online_booking_enabled: true, custom_price: null },
      }),
    );
    expect(result.current.changedCount).toBe(1);
    expect(result.current.cells.get(key)?.online_available).toBe(3);

    // Staging the saved state again removes the edit
    act(() =>
      result.current.stageCell(key, {
        type: 'set',
        value: { walk_in_reserved_rooms: 0, online_booking_enabled: true, custom_price: null },
      }),
    );
    expect(result.current.changedCount).toBe(0);
  });

  it('discard restores the saved state', async () => {
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const key = cellKey(1, '2026-09-12');
    act(() =>
      result.current.stageCell(key, { type: 'set', value: { walk_in_reserved_rooms: 4, online_booking_enabled: false, custom_price: '100.00' } }),
    );
    expect(result.current.changedCount).toBe(1);
    act(() => result.current.discardChanges());
    expect(result.current.changedCount).toBe(0);
    expect(result.current.cells.get(key)?.current.online_booking_enabled).toBe(true);
  });

  it('saves via one bulk call, merges returned rows and clears edits', async () => {
    bulkUpdateOnlineInventory.mockImplementation(async (cells) =>
      cells.map((c: { room_type_id: number; stay_date: string }) =>
        allocation({
          room_type_id: c.room_type_id,
          stay_date: c.stay_date,
          walk_in_reserved_rooms: 2,
          is_override: true,
        }),
      ),
    );
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The post-save refresh reads the window again and sees the new row.
    getOnlineInventoryRange.mockResolvedValue([
      allocation({ walk_in_reserved_rooms: 2, is_override: true, updated_at: '2026-09-26T06:00:00Z' }),
      ...rangeRows().slice(1),
    ]);

    act(() =>
      result.current.stageCell(cellKey(1, '2026-09-12'), {
        type: 'set',
        value: { walk_in_reserved_rooms: 2, online_booking_enabled: true, custom_price: null },
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.saveChanges();
    });

    expect(ok).toBe(true);
    expect(bulkUpdateOnlineInventory).toHaveBeenCalledTimes(1);
    expect(bulkUpdateOnlineInventory).toHaveBeenCalledWith([
      {
        room_type_id: 1,
        stay_date: '2026-09-12',
        walk_in_reserved_rooms: 2,
        online_booking_enabled: true,
        custom_price: null,
        expected_updated_at: null,
      },
    ]);
    expect(result.current.changedCount).toBe(0);
    await waitFor(() => expect(getOnlineInventoryRange).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.savedCells.get(cellKey(1, '2026-09-12'))?.updated_at).toBe(
        '2026-09-26T06:00:00Z',
      ),
    );
    expect(result.current.cells.get(cellKey(1, '2026-09-12'))?.saved.walk_in_reserved_rooms).toBe(2);
    expect(result.current.successMessage).toContain('1');
  });

  it('keeps edits and surfaces an error when the save fails', async () => {
    bulkUpdateOnlineInventory.mockRejectedValue(new Error('server down'));
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() =>
      result.current.stageCell(cellKey(1, '2026-09-12'), {
        type: 'set',
        value: { walk_in_reserved_rooms: 1, online_booking_enabled: true, custom_price: null },
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.saveChanges();
    });
    expect(ok).toBe(false);
    expect(result.current.changedCount).toBe(1);
    expect(result.current.error).toContain('server down');
  });

  it('does nothing when saving with no edits', async () => {
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.saveChanges();
    });
    expect(bulkUpdateOnlineInventory).not.toHaveBeenCalled();
  });

  it('keeps edits on a 409 stale_write and exposes the conflicting cells', async () => {
    bulkUpdateOnlineInventory.mockRejectedValue(
      buildKyHttpError(409, {
        error: 'Someone else changed these days since you loaded them. Reload to see the latest.',
        code: 'stale_write',
        conflicts: [{ room_type_id: 1, stay_date: '2026-09-12' }],
      }),
    );
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.stageCell(cellKey(1, '2026-09-12'), {
        type: 'set',
        value: { walk_in_reserved_rooms: 1, online_booking_enabled: true, custom_price: null },
      });
      result.current.stageCell(cellKey(1, '2026-09-13'), {
        type: 'set',
        value: { walk_in_reserved_rooms: 3, online_booking_enabled: true, custom_price: null },
      });
    });

    let ok = true;
    await act(async () => {
      ok = await result.current.saveChanges();
    });
    expect(ok).toBe(false);
    expect(result.current.conflicts).toEqual([{ room_type_id: 1, stay_date: '2026-09-12' }]);
    expect(result.current.error).toBeNull();
    expect(result.current.changedCount).toBe(2);

    // Reload: the conflicting day takes the latest value and loses its staged
    // edit; the untouched day keeps its edit.
    getOnlineInventoryRange.mockResolvedValue([
      allocation({ walk_in_reserved_rooms: 2, is_override: true, updated_at: '2026-09-26T06:00:00Z' }),
      ...rangeRows().slice(1),
    ]);
    await act(async () => {
      await result.current.reloadAfterConflict();
    });
    expect(result.current.conflicts).toBeNull();
    expect(result.current.changedCount).toBe(1);
    expect(result.current.edits.has(cellKey(1, '2026-09-13'))).toBe(true);
    expect(result.current.cells.get(cellKey(1, '2026-09-12'))?.saved.walk_in_reserved_rooms).toBe(2);
  });

  it("surfaces the server's error text for other failures", async () => {
    bulkUpdateOnlineInventory.mockRejectedValue(
      buildKyHttpError(403, { error: "You don't have permission to do that.", code: 'forbidden' }),
    );
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() =>
      result.current.stageCell(cellKey(1, '2026-09-12'), {
        type: 'set',
        value: { walk_in_reserved_rooms: 1, online_booking_enabled: true, custom_price: null },
      }),
    );
    await act(async () => {
      await result.current.saveChanges();
    });
    expect(result.current.error).toBe("You don't have permission to do that.");
    expect(result.current.conflicts).toBeNull();
  });

  it('reports a load failure separately so the page can show it', async () => {
    getOnlineInventoryRange.mockRejectedValue(
      buildKyHttpError(400, { error: "Invalid 'to' date", code: 'bad_request' }),
    );
    const { result } = renderHook(() => useOnlineInventory('2026-09-12', '2026-09-25'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBe("Invalid 'to' date");
    expect(result.current.cells.size).toBe(0);
  });
});
