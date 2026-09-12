// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnlineInventoryAllocation } from '../types';
import { cellKey } from '../utils';

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
      },
    ]);
    expect(result.current.changedCount).toBe(0);
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
});
