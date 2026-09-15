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

/** Export breadth selected by `?scope=` on the export endpoints. `full` and
 * `backup` carry sensitive entities and require `data_transfer:export_sensitive`
 * plus a fresh step-up token; `backup` additionally emits the FK
 * `manifest.relationships` edge list for migration tooling. */
export type ExportScope = 'standard' | 'full' | 'backup';

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

/** Detected backup file format. `"v1"` is the only accepted format — the
 * structured `hotel-backup` version-1 document; `"legacy"` is any retired
 * export shape (the flat v1/v2 exports and older `hotel-backup` versions),
 * which the server rejects at preview/execute; `"unknown"` failed the sniff. */
export type BackupDetectedFormat = 'v1' | 'legacy' | 'unknown';

/** `POST data-transfer/import/uploads` response — the staged file's handle. */
export interface UploadResponse {
  uploadId: string;
  bytes: number;
  detectedFormat: BackupDetectedFormat;
}

/** Per-entity diff between a staged backup and this database. `new`/`existing`/
 * `skipped` are `null` when the server could not diff that entity (the only
 * accepted format, `hotel-backup` v1, always diffs). */
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
  /** The export's declared breadth (`standard`/`full`/`backup`) for tiered
   * exports; `null` when the file predates tiering or does not declare it. */
  exportType: string | null;
  /** True when the file carries sensitive entities (computed server-side
   * from entity names — never the producer's claim alone). */
  sensitive: boolean;
  /** Permissions execution requires beyond `data_transfer:import` — for
   * example `data_transfer:import_sensitive` on a sensitive upload. The
   * server re-checks regardless of what the client shows. */
  requiresPermissions: string[];
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

// ----- Step-up re-authentication ------------------------------------------

/** `POST data-transfer/step-up` request. `totpCode` is required when the
 * account has two-factor authentication enabled. */
export interface StepUpRequest {
  password: string;
  totpCode?: string;
}

/** Short-lived proof of re-authentication, sent as the `X-Step-Up` header on
 * the gated operation it unlocks (full/backup export, restore execute). */
export interface StepUpResponse {
  stepUpToken: string;
  expiresAt: string;
}

// ----- Server-backed transfer history --------------------------------------

/** One `GET data-transfer/history` row — an audit event projected for the
 * transfer page. `details` carries job id/mode/counts, never row data. */
export interface TransferHistoryEntry {
  id: number;
  /** `data_export` | `data_import` | `data_transfer_step_up` |
   * `data_transfer_step_up_denied`. */
  action: string;
  userId: number | null;
  username: string | null;
  createdAt: string;
  details: Record<string, unknown> | null;
}

/** `GET data-transfer/history` response. */
export interface TransferHistory {
  entries: TransferHistoryEntry[];
  total: number;
}
