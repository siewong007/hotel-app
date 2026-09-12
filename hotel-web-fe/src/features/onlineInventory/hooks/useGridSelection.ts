import { useCallback, useMemo, useState } from 'react';

import type { CellKey } from '../types';
import { cellKey, rectKeys } from '../utils';

/**
 * Selection model for the inventory grid: an anchor cell, a focused cell
 * (roving tabindex target), and a set of selected cells. Rectangles are
 * resolved against the visible row/column order the caller passes in.
 */
export const useGridSelection = (roomTypeIds: number[], dates: string[]) => {
  const [anchor, setAnchor] = useState<CellKey | null>(null);
  const [focused, setFocused] = useState<CellKey | null>(null);
  const [selected, setSelected] = useState<Set<CellKey>>(new Set());

  const rectBetween = useCallback(
    (a: CellKey, b: CellKey): Set<CellKey> =>
      new Set(rectKeys(a, b, roomTypeIds, dates)),
    [roomTypeIds, dates],
  );

  const selectCell = useCallback(
    (key: CellKey, extend: boolean) => {
      setFocused(key);
      if (extend && anchor !== null) {
        setSelected(rectBetween(anchor, key));
      } else {
        setAnchor(key);
        setSelected(new Set([key]));
      }
    },
    [anchor, rectBetween],
  );

  const moveFocus = useCallback(
    (key: CellKey, extend: boolean) => {
      setFocused(key);
      if (extend && anchor !== null) {
        setSelected(rectBetween(anchor, key));
      }
    },
    [anchor, rectBetween],
  );

  const selectRow = useCallback(
    (roomTypeId: number) => {
      if (dates.length === 0) return;
      const keys = dates.map((date) => cellKey(roomTypeId, date));
      setAnchor(keys[0]);
      setFocused(keys[0]);
      setSelected(new Set(keys));
    },
    [dates],
  );

  const selectColumn = useCallback(
    (date: string) => {
      if (roomTypeIds.length === 0) return;
      const keys = roomTypeIds.map((id) => cellKey(id, date));
      setAnchor(keys[0]);
      setFocused(keys[0]);
      setSelected(new Set(keys));
    },
    [roomTypeIds],
  );

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  const setSelectedKeys = useCallback((keys: Iterable<CellKey>) => {
    const next = new Set(keys);
    setSelected(next);
    const first = next.values().next().value;
    setAnchor(first ?? null);
    setFocused(first ?? null);
  }, []);

  return useMemo(
    () => ({
      anchor,
      focused,
      selected,
      isSelected: (key: CellKey) => selected.has(key),
      selectCell,
      moveFocus,
      selectRow,
      selectColumn,
      clear,
      setSelected: setSelectedKeys,
    }),
    [anchor, focused, selected, selectCell, moveFocus, selectRow, selectColumn, clear, setSelectedKeys],
  );
};
