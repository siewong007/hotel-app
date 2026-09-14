// Shared types for the data-transfer workflow components.

export type ToastSeverity = 'success' | 'error' | 'info' | 'warning';

/** Raise a page-level toast — used for successes and informational notes only.
 * Failures render inline inside the panel/wizard (one error surface). */
export type NotifyFn = (message: string, severity?: ToastSeverity) => void;

/**
 * One device-local transfer-history row (localStorage `dataTransferHistory`).
 * `mode` keeps the legacy `'import'`/`'overwrite'` values readable for entries
 * written before the staged-import redesign; new entries use
 * `'merge'`/`'restore'`.
 */
export interface TransferHistoryEntry {
  id: string;
  type: 'export' | 'import';
  mode?: 'import' | 'overwrite' | 'merge' | 'restore';
  /** What moved — e.g. "Business data backup" or "42 entities". */
  categories: string;
  /** Rows exported/applied; undefined when unknown (e.g. export without a preview). */
  records?: number;
  by: string;
  at: number; // epoch ms
  status: 'success' | 'partial' | 'failed';
  error?: string;
  /** Backend import job id, for cross-referencing the server-side audit log. */
  jobId?: string;
}

export type NewHistoryEntry = Omit<TransferHistoryEntry, 'id' | 'at' | 'by'>;

/** Append a row to the transfer history. */
export type RecordHistoryFn = (entry: NewHistoryEntry) => void;
