// Constants for the data-transfer workflow components.

/** Mirrors `MAX_UPLOAD_BODY_BYTES` in `routes/data_transfer.rs` — checked
 * client-side so an oversize file fails before the upload starts. */
export const MAX_BACKUP_FILE_BYTES = 256 * 1024 * 1024;

/** How often the import wizard polls `GET …/import/jobs/{jobId}` while a job
 * reports `running`. Terminal states stop the polling themselves. */
export const IMPORT_JOB_POLL_MS = 1500;
