// Shared types for the data-transfer workflow components.

export type ToastSeverity = 'success' | 'error' | 'info' | 'warning';

/** Raise a page-level toast — used for successes and informational notes only.
 * Failures render inline inside the panel/wizard (one error surface). */
export type NotifyFn = (message: string, severity?: ToastSeverity) => void;

/**
 * One transfer-history display row. The source is `GET /data-transfer/history`
 * (audit-log events); `mapServerHistoryEntry` in `utils.ts` does the
 * projection. The legacy localStorage fields stay in the union so entries
 * written before the server-backed history still render.
 */
export interface TransferHistoryEntry {
  id: string;
  /** `security` covers the step-up audit rows (granted + denied). */
  type: 'export' | 'import' | 'security';
  mode?: 'import' | 'overwrite' | 'merge' | 'restore';
  /** Precomputed title when the action needs more than type+mode to describe
   * (e.g. "Re-authentication denied"). Wins over `describeHistoryAction`. */
  actionLabel?: string;
  /** What moved — e.g. "Full export" or "42 entities". */
  categories: string;
  /** Rows exported/applied; undefined when unknown (e.g. an in-flight import). */
  records?: number;
  by: string;
  at: number; // epoch ms
  status: 'success' | 'partial' | 'failed' | 'started';
  error?: string;
  /** Backend import job id or export id, for cross-referencing the audit log. */
  jobId?: string;
}
