import { useCallback, useState } from 'react';
import { storage } from '../../../../utils/storage';
import { TRANSFER_HISTORY_KEY, TRANSFER_HISTORY_LIMIT } from './constants';
import type { NewHistoryEntry, TransferHistoryEntry } from './types';

/**
 * Device-local transfer history — persisted to localStorage so it survives
 * reloads (and predates this redesign; the storage key and field names are
 * unchanged, so old entries keep rendering).
 */
export function useTransferHistory(performedBy: string) {
  const [entries, setEntries] = useState<TransferHistoryEntry[]>(
    () => storage.getItem<TransferHistoryEntry[]>(TRANSFER_HISTORY_KEY) || [],
  );

  const pushEntry = useCallback(
    (entry: NewHistoryEntry) => {
      const full: TransferHistoryEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        by: performedBy,
      };
      setEntries((prev) => {
        const next = [full, ...prev].slice(0, TRANSFER_HISTORY_LIMIT);
        storage.setItem(TRANSFER_HISTORY_KEY, next);
        return next;
      });
    },
    [performedBy],
  );

  return { entries, pushEntry };
}
