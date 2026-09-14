// Constants for the data-transfer workflow components.

/** Mirrors `MAX_UPLOAD_BODY_BYTES` in `routes/data_transfer.rs` — checked
 * client-side so an oversize file fails before the upload starts. */
export const MAX_BACKUP_FILE_BYTES = 256 * 1024 * 1024;

/** How often the import wizard polls `GET …/import/jobs/{jobId}` while a job
 * reports `running`. Terminal states stop the polling themselves. */
export const IMPORT_JOB_POLL_MS = 1500;

/** Device-local history cap — oldest entries fall off past this. */
export const TRANSFER_HISTORY_LIMIT = 30;

/** localStorage key shared with the pre-redesign page — existing entries
 * remain readable because the field names are unchanged. */
export const TRANSFER_HISTORY_KEY = 'dataTransferHistory';
