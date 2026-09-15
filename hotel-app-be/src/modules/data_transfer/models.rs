//! Data-transfer API models.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::value::RawValue;
use uuid::Uuid;

/// Count preview for all transferable tables before generating an export file.
/// `entities`/`exclusions` mirror the manifest embedded in every export, so
/// the preview shows exactly what a backup would declare.
#[derive(Debug, Serialize)]
pub struct ExportPreview {
    pub generated_at: String,
    pub counts: HashMap<String, i64>,
    pub total_records: i64,
    pub tables: Vec<TransferTablePreview>,
    pub entities: Vec<BackupEntityDescriptor>,
    pub exclusions: Vec<BackupExclusion>,
}

#[derive(Debug, Serialize)]
pub struct TransferTablePreview {
    pub name: String,
    pub count: i64,
    pub dependencies: Vec<String>,
}

// ----- `hotel-backup` file format + upload/preview/execute/job API. -----
// The JSON format is camelCase throughout.

/// Where a backup file was produced. `environment` is the lowercased
/// `config::Environment`; `database_provider` is always `"postgresql"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSource {
    pub environment: String,
    pub database_provider: String,
}

/// One transferable entity's identity in the backup manifest — name,
/// primary-key columns and the exported column list, in schema order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntityDescriptor {
    pub name: String,
    pub primary_key: Vec<String>,
    pub columns: Vec<String>,
}

/// One schema table deliberately left out of a backup. `reason` is one of the
/// reason codes in [`super::service::EXCLUDED_TABLES`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupExclusion {
    pub name: String,
    pub reason: String,
}

/// One foreign-key edge between transferable entities, emitted on `backup`
/// scope exports so a migration can order inserts without introspecting the
/// destination schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRelationship {
    pub table: String,
    pub column: String,
    pub references_table: String,
    pub references_column: String,
}

/// Coverage declaration embedded in every backup file: what was exported and what
/// was intentionally left behind, so a restore can see the difference between
/// "absent" and "excluded". `omitted` names the sensitive entities a standard
/// export deliberately skipped; `relationships` is emitted on `backup`
/// exports only. Both are absent on files written before the tiered-export
/// release, so importers compute sensitivity from entity names instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub entities: Vec<BackupEntityDescriptor>,
    pub exclusions: Vec<BackupExclusion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omitted: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationships: Option<Vec<BackupRelationship>>,
}

/// Trailer written after the last table: the entity count and row counts
/// actually streamed. A download missing this block (or the closing brace) is
/// truncated and must not be trusted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupIntegrity {
    pub entities: u64,
    pub rows: u64,
    pub entity_rows: BTreeMap<String, u64>,
    pub completed_at: String,
}

/// A parsed `hotel-backup` document — the import side's parse target.
///
/// Only ever deserialized: the export writer emits the bytes by hand so a
/// large backup never materializes as a `Value`. `tables` keeps every row as
/// raw JSON text, so the whole file parses at roughly 1x its byte size instead
/// of ~3.5x for `Value` trees; the import job converts rows one at a time.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    /// Always `"hotel-backup"` — anything else is rejected before this parse.
    pub format: String,
    /// Always `1` for this struct — earlier `hotel-backup` snapshots carried
    /// `3` and are rejected like any other unrecognized version.
    pub version: u32,
    /// Payload class; only `"business-data"` exists today.
    pub kind: String,
    /// Required so a document missing `exportId` fails to parse — its value
    /// itself is never read by the import.
    #[allow(dead_code)]
    pub export_id: Uuid,
    /// Export breadth — `"standard"`, `"full"`, or `"backup"`. Sensitivity is
    /// computed from entity names rather than trusting this label.
    #[serde(default)]
    pub export_type: Option<String>,
    /// Producer's declaration that sensitive entities are present. Checked
    /// alongside the entity list — a crafted file cannot drop the requirement
    /// by flipping this flag off.
    #[serde(default)]
    pub includes_sensitive_data: Option<bool>,
    /// Always `false` on files this system writes — credentials and secrets
    /// never leave the database. A file declaring `true` surfaces a preview
    /// warning since no legitimate producer emits it.
    #[serde(default)]
    pub includes_secrets: Option<bool>,
    /// RFC 3339 timestamp, kept as text — the import never does date math on
    /// it.
    pub exported_at: String,
    pub application_version: String,
    pub source: BackupSource,
    pub manifest: BackupManifest,
    pub tables: BTreeMap<String, Vec<Box<RawValue>>>,
    pub integrity: BackupIntegrity,
}

/// Response to `POST /data-transfer/import/uploads` — the staged file's
/// handle for preview/execute/delete.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub upload_id: Uuid,
    pub bytes: u64,
    /// `"v1"` (a `hotel-backup` document), `"legacy"` (a retired v1/v2/v3
    /// export shape), or `"unknown"`. Detection is a first-kilobytes sniff,
    /// not a verdict — preview reports the real parse errors.
    pub detected_format: String,
}

/// Request body for `POST /data-transfer/import/preview`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewRequest {
    pub upload_id: Uuid,
}

/// Per-entity diff between a staged backup and the destination database.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewEntity {
    pub name: String,
    /// Rows the file carries for this entity.
    pub rows: u64,
    /// Rows whose primary key does not exist in the destination — `None` only
    /// for entities the diff could not classify.
    pub new: Option<u64>,
    pub existing: Option<u64>,
    /// Rows the import would skip (for example references to excluded parents
    /// such as a `created_by` user absent here).
    pub skipped: Option<u64>,
}

/// Rows that reference records outside the transferable set (for example a
/// `created_by` user that does not exist in this database) and so cannot be
/// applied as-is. Shared by the preview and the finished job's report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRelationshipProblem {
    pub entity: String,
    pub rows: u64,
    pub reason: String,
}

/// What a staged backup would do if executed — the pre-flight report returned
/// by `POST /data-transfer/import/preview`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub upload_id: Uuid,
    /// `"v1"` — the only format that parses far enough to produce a preview.
    pub format: String,
    /// Numeric format version the file declares (`1` today).
    pub version: Option<u32>,
    /// The export's declared breadth (`"standard"`/`"full"`/`"backup"`).
    pub export_type: Option<String>,
    /// True when the file carries sensitive entities — anything listed in
    /// `SENSITIVE_TABLES` or a `includesSensitiveData: true` declaration.
    pub sensitive: bool,
    /// Permissions the caller still needs to execute this file (for example
    /// `data_transfer:import_sensitive` on a sensitive upload). Echoed so the
    /// UI can warn before the execute call fails; the server re-checks
    /// regardless of what the client shows.
    pub requires_permissions: Vec<String>,
    pub exported_at: Option<String>,
    /// `source.environment` the file was exported from.
    pub source_environment: Option<String>,
    pub application_version: Option<String>,
    pub entities: Vec<ImportPreviewEntity>,
    /// Entities in the file that are neither transferable nor a known
    /// exclusion — surfaced so nothing is silently dropped.
    pub unsupported_entities: Vec<String>,
    /// Problems that make the file unimportable (bad version, wrong kind…).
    pub validation_errors: Vec<String>,
    pub relationship_problems: Vec<ImportRelationshipProblem>,
    pub warnings: Vec<String>,
    pub total_rows: u64,
}

/// How a backup import treats the destination's existing data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackupImportMode {
    /// Insert only; conflicts resolve per `on_conflict`.
    Merge,
    /// Clear the selected transferable tables first, then insert.
    Restore,
}

/// What a merge import does when a row's primary key already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictPolicy {
    /// `ON CONFLICT DO NOTHING` — keep the destination row.
    Skip,
    /// `ON CONFLICT (pk) DO UPDATE` — overwrite every non-key column.
    Update,
    /// No conflict clause — the first duplicate aborts the import.
    Fail,
}

/// Request body for `POST /data-transfer/import/execute`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExecuteRequest {
    pub upload_id: Uuid,
    pub mode: BackupImportMode,
    /// Merge-time conflict handling. Absent under `restore`, which clears the
    /// selected tables first and so has nothing to conflict with.
    #[serde(default)]
    pub on_conflict: Option<ConflictPolicy>,
    /// Restrict the import to these qualified entity names; empty means all.
    #[serde(default)]
    pub tables: Vec<String>,
    /// Must be `true` — an import is destructive enough to need an explicit
    /// confirmation flag rather than defaulting into one.
    pub confirm: bool,
}

/// `202 Accepted` body for `POST /data-transfer/import/execute` — the handle
/// the client polls on `GET /data-transfer/import/jobs/{jobId}`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExecuteResponse {
    pub job_id: Uuid,
}

/// Export breadth selected by `?scope=` on `GET /data-transfer/export` and
/// `GET /data-transfer/export/preview`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportScope {
    /// Non-sensitive entities only — the routine operational transfer.
    #[default]
    Standard,
    /// Every transferable entity, including sensitive business data.
    /// Requires `data_transfer:export_sensitive` + step-up.
    Full,
    /// `full` plus a `manifest.relationships` FK edge list, for migration
    /// tooling. Same permission requirements as `full`.
    Backup,
}

impl ExportScope {
    /// The `exportType` label written into the document header.
    pub fn label(self) -> &'static str {
        match self {
            ExportScope::Standard => "standard",
            ExportScope::Full => "full",
            ExportScope::Backup => "backup",
        }
    }

    /// Whether this scope emits sensitive entities.
    pub fn includes_sensitive(self) -> bool {
        !matches!(self, ExportScope::Standard)
    }
}

/// `?scope=` query for the export endpoints.
#[derive(Debug, Deserialize)]
pub struct ExportScopeQuery {
    #[serde(default)]
    pub scope: ExportScope,
}

/// `POST /data-transfer/step-up` — re-authentication for privileged
/// operations (full/backup export, restore execute). When the account has
/// TOTP enabled, `totp_code` is required alongside the password.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepUpRequest {
    pub password: String,
    pub totp_code: Option<String>,
}

/// Short-lived proof of re-authentication, sent as the `X-Step-Up` header on
/// the gated operation it unlocks.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepUpResponse {
    pub step_up_token: String,
    pub expires_at: String,
}

/// One transfer-history row — an audit event projected for the data-transfer
/// page (`details` carries job id/mode/counts, never row data).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferHistoryEntry {
    pub id: i64,
    pub action: String,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub created_at: String,
    pub details: Option<Value>,
}

/// `GET /data-transfer/history` response.
#[derive(Debug, Serialize)]
pub struct TransferHistory {
    pub entries: Vec<TransferHistoryEntry>,
    pub total: i64,
}

/// `?limit=` query for the transfer-history endpoint (server clamps to a
/// sane range).
#[derive(Debug, Deserialize)]
pub struct TransferHistoryQuery {
    #[serde(default)]
    pub limit: Option<i64>,
}

/// Lifecycle states of a background import job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportJobState {
    Running,
    Succeeded,
    Failed,
}

/// Live progress of a running import job, updated per entity batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    /// Entity currently being applied; `None` before the first batch.
    pub entity: Option<String>,
    pub rows_applied: u64,
    pub total_rows: u64,
}

/// Per-entity outcome inside [`ImportJobReport`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntityOutcome {
    pub entity: String,
    pub inserted: u64,
    pub updated: u64,
    pub skipped: u64,
}

/// The detailed half of a finished job's result: per-entity counts plus the
/// rows skipped for references outside the transferable set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobReport {
    pub entities: Vec<ImportEntityOutcome>,
    #[serde(default)]
    pub relationship_problems: Vec<ImportRelationshipProblem>,
    /// File entities that were never applied — excluded tables, schema tables
    /// outside the transferable set, and names this database does not have.
    #[serde(default)]
    pub unsupported_entities: Vec<String>,
}

/// Final counts of a finished import job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobResult {
    pub inserted: u64,
    pub updated: u64,
    pub skipped: u64,
    pub report: ImportJobReport,
}

/// `GET /data-transfer/import/jobs/{jobId}` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobStatus {
    pub status: ImportJobState,
    pub progress: JobProgress,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<ImportJobResult>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{BackupFile, BackupImportMode, ConflictPolicy, ImportJobState, UploadResponse};
    use serde_json::{json, Value};
    use uuid::Uuid;

    #[test]
    fn backup_import_mode_uses_exact_wire_strings() {
        assert_eq!(
            serde_json::to_value(BackupImportMode::Merge).unwrap(),
            json!("merge")
        );
        assert_eq!(
            serde_json::to_value(BackupImportMode::Restore).unwrap(),
            json!("restore")
        );
        assert_eq!(
            serde_json::from_value::<BackupImportMode>(json!("merge")).unwrap(),
            BackupImportMode::Merge
        );
        assert_eq!(
            serde_json::from_value::<BackupImportMode>(json!("restore")).unwrap(),
            BackupImportMode::Restore
        );
        assert!(serde_json::from_value::<BackupImportMode>(json!("import")).is_err());
        assert!(serde_json::from_value::<BackupImportMode>(json!("overwrite")).is_err());
    }

    #[test]
    fn conflict_policy_uses_exact_wire_strings() {
        for (variant, wire) in [
            (ConflictPolicy::Skip, "skip"),
            (ConflictPolicy::Update, "update"),
            (ConflictPolicy::Fail, "fail"),
        ] {
            assert_eq!(serde_json::to_value(variant).unwrap(), json!(wire));
            assert_eq!(
                serde_json::from_value::<ConflictPolicy>(json!(wire)).unwrap(),
                variant
            );
        }
        assert!(serde_json::from_value::<ConflictPolicy>(json!("abort")).is_err());
    }

    #[test]
    fn import_job_state_uses_exact_wire_strings() {
        for (variant, wire) in [
            (ImportJobState::Running, "running"),
            (ImportJobState::Succeeded, "succeeded"),
            (ImportJobState::Failed, "failed"),
        ] {
            assert_eq!(serde_json::to_value(variant).unwrap(), json!(wire));
            assert_eq!(
                serde_json::from_value::<ImportJobState>(json!(wire)).unwrap(),
                variant
            );
        }
    }

    #[test]
    fn backup_file_deserializes_v1_document_with_raw_rows() {
        let export_id = Uuid::new_v4();
        let document = json!({
            "format": "hotel-backup",
            "version": 1,
            "kind": "business-data",
            "exportId": export_id,
            "exportedAt": "2026-09-14T12:00:00Z",
            "applicationVersion": "0.2.0",
            "source": {"environment": "production", "databaseProvider": "postgresql"},
            "manifest": {
                "entities": [{"name": "public.amenities", "primaryKey": ["id"], "columns": ["id", "name"]}],
                "exclusions": [{"name": "public.users", "reason": "credentials_and_auth_state"}]
            },
            "tables": {
                "public.amenities": [{"id": 1, "name": "Wi-Fi"}]
            },
            "integrity": {"entities": 1, "rows": 1, "entityRows": {"public.amenities": 1}, "completedAt": "2026-09-14T12:00:01Z"}
        });

        let file: BackupFile =
            serde_json::from_value(document).expect("v1 document should deserialize");

        assert_eq!(file.format, "hotel-backup");
        assert_eq!(file.version, 1);
        assert_eq!(file.kind, "business-data");
        assert_eq!(file.export_id, export_id);
        assert_eq!(file.source.database_provider, "postgresql");
        assert_eq!(file.manifest.entities[0].primary_key, vec!["id"]);
        assert_eq!(
            file.manifest.exclusions[0].reason,
            "credentials_and_auth_state"
        );
        assert_eq!(file.integrity.entity_rows["public.amenities"], 1);

        // Rows stay raw JSON text — the import job parses them one at a time.
        let raw_rows = &file.tables["public.amenities"];
        assert_eq!(raw_rows.len(), 1);
        let row: Value = serde_json::from_str(raw_rows[0].get()).expect("raw row should parse");
        assert_eq!(row["name"], "Wi-Fi");
    }

    #[test]
    fn upload_response_serializes_camel_case() {
        let upload_id = Uuid::new_v4();
        let response = UploadResponse {
            upload_id,
            bytes: 42,
            detected_format: "v1".to_string(),
        };

        let value = serde_json::to_value(response).expect("response should serialize");
        assert_eq!(value["uploadId"], json!(upload_id));
        assert_eq!(value["bytes"], json!(42));
        assert_eq!(value["detectedFormat"], json!("v1"));
        assert!(value.get("upload_id").is_none());
    }
}
