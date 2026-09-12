import { useCallback, useEffect, useMemo, useState } from 'react';

import { bulkUpdateOnlineInventory, getOnlineInventoryRange } from '../api';
import type { CellKey, GridCellView, OnlineInventoryAllocation, StagedEdit } from '../types';
import { buildCellView, cellKey, isRealChange, toCellUpdateInputs } from '../utils';

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export interface InventoryRoomTypeRow {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
}

/**
 * Range-backed inventory state: `savedCells` is server truth, `edits` is the
 * staged overlay the grid displays. Saving is one atomic bulk call — the
 * server commits all cells or none.
 */
export const useOnlineInventory = (from: string, to: string) => {
  const [savedCells, setSavedCells] = useState<Map<CellKey, OnlineInventoryAllocation>>(new Map());
  const [edits, setEdits] = useState<Map<CellKey, StagedEdit>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    setEdits(new Map());
    try {
      const rows = await getOnlineInventoryRange(from, to);
      setSavedCells(
        new Map(rows.map((row) => [cellKey(row.room_type_id, row.stay_date), row])),
      );
    } catch (loadError) {
      setSavedCells(new Map());
      setError(errorMessage(loadError, 'Unable to load online inventory.'));
    } finally {
      setIsLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const roomTypes = useMemo<InventoryRoomTypeRow[]>(() => {
    const seen = new Map<number, InventoryRoomTypeRow>();
    for (const cell of savedCells.values()) {
      if (!seen.has(cell.room_type_id)) {
        seen.set(cell.room_type_id, {
          room_type_id: cell.room_type_id,
          room_type_code: cell.room_type_code,
          room_type_name: cell.room_type_name,
        });
      }
    }
    return [...seen.values()];
  }, [savedCells]);

  const dates = useMemo<string[]>(
    () => [...new Set([...savedCells.values()].map((cell) => cell.stay_date))].sort(),
    [savedCells],
  );

  const cells = useMemo<Map<CellKey, GridCellView>>(() => {
    const views = new Map<CellKey, GridCellView>();
    for (const [key, saved] of savedCells) {
      views.set(key, buildCellView(saved, edits.get(key)));
    }
    return views;
  }, [savedCells, edits]);

  const stageMany = useCallback(
    (entries: Iterable<[CellKey, StagedEdit]>) => {
      setSuccessMessage(null);
      setEdits((current) => {
        const next = new Map(current);
        for (const [key, edit] of entries) {
          const saved = savedCells.get(key);
          if (!saved) continue;
          if (isRealChange(saved, edit)) next.set(key, edit);
          else next.delete(key);
        }
        return next;
      });
    },
    [savedCells],
  );

  const stageCell = useCallback(
    (key: CellKey, edit: StagedEdit) => {
      stageMany([[key, edit]]);
    },
    [stageMany],
  );

  const discardChanges = useCallback(() => {
    setEdits(new Map());
    setSuccessMessage(null);
    setError(null);
  }, []);

  const saveChanges = useCallback(async (): Promise<boolean> => {
    const inputs = toCellUpdateInputs(edits);
    if (inputs.length === 0) return false;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await bulkUpdateOnlineInventory(inputs);
      setSavedCells((current) => {
        const next = new Map(current);
        for (const row of updated) {
          next.set(cellKey(row.room_type_id, row.stay_date), row);
        }
        return next;
      });
      setEdits(new Map());
      setSuccessMessage(
        `${inputs.length} ${inputs.length === 1 ? 'cell' : 'cells'} updated.`,
      );
      return true;
    } catch (saveError) {
      // The bulk write is atomic server-side — nothing was applied, so the
      // staged edits stay staged and the user loses nothing.
      setError(errorMessage(saveError, 'Unable to save the inventory changes.'));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [edits]);

  return {
    roomTypes,
    dates,
    cells,
    edits,
    savedCells,
    changedCount: edits.size,
    isLoading,
    isSaving,
    error,
    successMessage,
    clearSuccessMessage: () => setSuccessMessage(null),
    stageCell,
    stageMany,
    discardChanges,
    saveChanges,
    reload: load,
  };
};
