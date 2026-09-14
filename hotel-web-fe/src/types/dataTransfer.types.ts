// Data transfer (backup/restore) type definitions.
//
// These types mirror the staged backup API in
// `hotel-app-be/src/models/data_transfer.rs` field-for-field. Everything from
// `BackupSource` down is serialized camelCase (`#[serde(rename_all =
// "camelCase")]`); the legacy `ExportPreview`/`TransferTablePreview` pair keeps
// its historical snake_case fields — the mix is intentional, not a typo.
//
// The backup file itself is never parsed client-side (uploads stream to the
// server as raw bytes), so there are intentionally no per-table row types here
// anymore.

// ----- Export -------------------------------------------------------------

/** One transferable entity's manifest entry — name, primary-key columns and
 * the exported column list, in schema order. */
export interface BackupEntityDescriptor {
  name: string;
  primaryKey: string[];
  columns: string[];
}

/** One schema table deliberately left out of a backup, with its reason code
 * (`credentials_and_auth_state`, `session_or_token_material`,
 * `sensitive_ekyc_pii`, `ephemeral_queue_state`, `internal_system_table`). */
export interface BackupExclusion {
  name: string;
  reason: string;
}

export interface TransferTablePreview {
  name: string;
  count: number;
  dependencies: string[];
}

/** `GET data-transfer/export/preview` — live counts plus the exact manifest a
 * backup would declare (entities + exclusions). */
export interface ExportPreview {
  generated_at: string;
  counts: Record<string, number>;
  total_records: number;
  tables: TransferTablePreview[];
  entities: BackupEntityDescriptor[];
  exclusions: BackupExclusion[];
}

// ----- Import pipeline ----------------------------------------------------

/** Detected backup file format (`"v3"` is the current `hotel-backup` format;
 * `"v2"`/`"v1"` are legacy export shapes; `"unknown"` failed the sniff). */
export type BackupDetectedFormat = 'v3' | 'v2' | 'v1' | 'unknown';

/** `POST data-transfer/import/uploads` response — the staged file's handle. */
export interface UploadResponse {
  uploadId: string;
  bytes: number;
  detectedFormat: BackupDetectedFormat;
}

/** Per-entity diff between a staged backup and this database. `new`/`existing`/
 * `skipped` are `null` when the format cannot support the diff (v1 files carry
 * counts only). */
export interface ImportPreviewEntity {
  name: string;
  rows: number;
  new: number | null;
  existing: number | null;
  skipped: number | null;
}

/** Rows that reference records outside the transferable set (e.g. a
 * `created_by` user absent here) and so cannot be applied as-is. Shared by the
 * preview and the finished job's report. */
export interface ImportRelationshipProblem {
  entity: string;
  rows: number;
  reason: string;
}

/** `POST data-transfer/import/preview` response — what a staged backup would
 * do if executed. `validationErrors` non-empty means unimportable. */
export interface ImportPreview {
  uploadId: string;
  format: BackupDetectedFormat;
  version: number | null;
  exportedAt: string | null;
  sourceEnvironment: string | null;
  applicationVersion: string | null;
  entities: ImportPreviewEntity[];
  unsupportedEntities: string[];
  validationErrors: string[];
  relationshipProblems: ImportRelationshipProblem[];
  warnings: string[];
  totalRows: number;
}

/** How an import treats the destination's existing data: `merge` inserts only;
 * `restore` clears the selected transferable tables first. */
export type BackupImportMode = 'merge' | 'restore';

/** Merge-time conflict handling (meaningless under `restore`, which clears
 * first): `skip` keeps the destination row, `update` overwrites non-key
 * columns, `fail` aborts on the first duplicate. */
export type ConflictPolicy = 'skip' | 'update' | 'fail';

/** `POST data-transfer/import/execute` request. `confirm` must be `true` — the
 * literal type makes a missing confirmation a compile error, matching the
 * backend's `400` guard. */
export interface ImportExecuteRequest {
  uploadId: string;
  mode: BackupImportMode;
  onConflict?: ConflictPolicy;
  /** Restrict the import to these qualified entity names; empty/absent = all. */
  tables?: string[];
  confirm: true;
}

/** `202 Accepted` body — the job handle the client polls. */
export interface ImportExecuteResponse {
  jobId: string;
}

export type ImportJobState = 'running' | 'succeeded' | 'failed';

/** Live progress of a running import job, updated per entity batch. */
export interface JobProgress {
  entity: string | null;
  rowsApplied: number;
  totalRows: number;
}

export interface ImportEntityOutcome {
  entity: string;
  inserted: number;
  updated: number;
  skipped: number;
}

/** Per-entity counts plus rows skipped for references outside the
 * transferable set, and file entities that were never applied. */
export interface ImportJobReport {
  entities: ImportEntityOutcome[];
  relationshipProblems: ImportRelationshipProblem[];
  unsupportedEntities: string[];
}

export interface ImportJobResult {
  inserted: number;
  updated: number;
  skipped: number;
  report: ImportJobReport;
}

/** `GET data-transfer/import/jobs/{jobId}` response. */
export interface ImportJobStatus {
  status: ImportJobState;
  progress: JobProgress;
  result?: ImportJobResult;
  error?: string;
}
