import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isHTTPError } from 'ky';

import { readErrorData } from '../../../api/client';
import { useTranslation } from '../../../i18n/useTranslation';
import { bulkUpdateOnlineInventory, getOnlineInventoryRange } from '../api';
import type {
  CellKey,
  GridCellView,
  InventoryConflict,
  OnlineInventoryAllocation,
  StagedEdit,
} from '../types';
import { buildCellView, cellKey, isRealChange, toCellUpdateInputs } from '../utils';

/**
 * The server's own message wins (`{"error": "..."}` on an HTTP error, or the
 * message of a plain Error); the generic fallback is only for transport
 * failures that carry nothing useful.
 */
const errorMessage = (error: unknown, fallback: string) => {
  if (isHTTPError(error)) {
    const body = readErrorData(error);
    const text = [body.error, body.message].find(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );
    return text ?? fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
};

/** The conflicting cells of a 409 `stale_write`, or `null` for any other error. */
const staleConflicts = (error: unknown): InventoryConflict[] | null => {
  if (!isHTTPError(error) || error.response.status !== 409) return null;
  const body = readErrorData(error);
  if (body.code !== 'stale_write') return null;
  return Array.isArray(body.conflicts)
    ? body.conflicts.filter(
        (c): c is InventoryConflict =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as InventoryConflict).room_type_id === 'number' &&
          typeof (c as InventoryConflict).stay_date === 'string',
      )
    : [];
};

const toSavedMap = (rows: OnlineInventoryAllocation[]) =>
  new Map(rows.map((row) => [cellKey(row.room_type_id, row.stay_date), row]));

export interface InventoryRoomTypeRow {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
}

/**
 * Range-backed inventory state: `savedCells` is server truth, `edits` is the
 * staged overlay the grid displays. Saving is one atomic bulk call — the
 * server commits all cells or none — and every cell carries the row version
 * it was built from, so a save on top of another admin's change is refused
 * (409) instead of silently overwriting it.
 */
export const useOnlineInventory = (from: string, to: string) => {
  const { t } = useTranslation('onlineInventory');
  const [savedCells, setSavedCells] = useState<Map<CellKey, OnlineInventoryAllocation>>(new Map());
  const [edits, setEdits] = useState<Map<CellKey, StagedEdit>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<InventoryConflict[] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Only the latest request may write state: moving the window quickly must
  // not let an older, slower response overwrite the newer one.
  const requestId = useRef(0);

  /** Reads the window; resolves `null` when a newer read has since started. */
  const fetchRange = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const rows = await getOnlineInventoryRange(from, to);
      return id === requestId.current ? rows : null;
    } catch (fetchError) {
      if (id !== requestId.current) return null;
      throw fetchError;
    }
  }, [from, to]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setLoadError(null);
    setConflicts(null);
    setSuccessMessage(null);
    setEdits(new Map());
    try {
      const rows = await fetchRange();
      if (rows === null) return;
      setSavedCells(toSavedMap(rows));
      setIsLoading(false);
    } catch (fetchError) {
      // Shown in place of the grid — an empty grid would read as "no rooms".
      setSavedCells(new Map());
      setLoadError(errorMessage(fetchError, t('errors.load')));
      setIsLoading(false);
    }
  }, [fetchRange, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-reads the window after a save without disturbing the success toast. */
  const refreshQuietly = useCallback(async () => {
    try {
      const rows = await fetchRange();
      if (rows !== null) setSavedCells(toSavedMap(rows));
    } catch {
      // The save itself succeeded and its rows are merged; a failed refresh
      // only means other admins' changes show on the next load.
    }
  }, [fetchRange]);

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
    setConflicts(null);
  }, []);

  const saveChanges = useCallback(async (): Promise<boolean> => {
    const inputs = toCellUpdateInputs(edits, savedCells);
    if (inputs.length === 0) return false;

    setIsSaving(true);
    setError(null);
    setConflicts(null);
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
      setSuccessMessage(t('success.updated', { count: inputs.length }));
      // Pick up the new row versions (and anything another admin changed
      // elsewhere in the window) so the next save starts from fresh data.
      void refreshQuietly();
      return true;
    } catch (saveError) {
      // The bulk write is atomic server-side — nothing was applied, so the
      // staged edits stay staged and the user loses nothing.
      const stale = staleConflicts(saveError);
      if (stale !== null) {
        setConflicts(stale);
      } else {
        setError(errorMessage(saveError, t('errors.save')));
      }
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [edits, savedCells, refreshQuietly, t]);

  /**
   * The conflict banner's Reload: re-read the window, then drop the staged
   * edits for every day someone else changed (the reported conflicts plus
   * any cell whose version moved). Edits on untouched days are kept, now
   * based on the fresh versions.
   */
  const reloadAfterConflict = useCallback(async () => {
    const reported = new Set(
      (conflicts ?? []).map((c) => cellKey(c.room_type_id, c.stay_date)),
    );
    setIsLoading(true);
    setError(null);
    try {
      const rows = await fetchRange();
      if (rows === null) return;
      const fresh = toSavedMap(rows);
      setEdits((current) => {
        const next = new Map<CellKey, StagedEdit>();
        for (const [key, edit] of current) {
          const before = savedCells.get(key);
          const after = fresh.get(key);
          if (reported.has(key) || !after) continue;
          if ((before?.updated_at ?? null) !== (after.updated_at ?? null)) continue;
          if (isRealChange(after, edit)) next.set(key, edit);
        }
        return next;
      });
      setSavedCells(fresh);
      setConflicts(null);
      setIsLoading(false);
    } catch (fetchError) {
      setError(errorMessage(fetchError, t('errors.load')));
      setIsLoading(false);
    }
  }, [conflicts, fetchRange, savedCells, t]);

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
    loadError,
    conflicts,
    successMessage,
    clearSuccessMessage: () => setSuccessMessage(null),
    clearError: () => setError(null),
    stageCell,
    stageMany,
    discardChanges,
    saveChanges,
    reload: load,
    reloadAfterConflict,
  };
};
