//! Data-transfer API models.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::value::RawValue;
use uuid::Uuid;

use crate::constants::ImportMode;

/// Represents all booking-related data for export/import.
#[derive(Debug, Serialize, Deserialize)]
pub struct BookingDataExport {
    pub version: String,
    pub exported_at: String,
    pub guests: Vec<Value>,
    pub guest_complimentary_credits: Vec<Value>,
    pub companies: Vec<Value>,
    pub bookings: Vec<Value>,
    pub payments: Vec<Value>,
    pub invoices: Vec<Value>,
    pub booking_guests: Vec<Value>,
    pub booking_modifications: Vec<Value>,
    pub booking_history: Vec<Value>,
    pub night_audit_runs: Vec<Value>,
    pub night_audit_details: Vec<Value>,
    pub customer_ledgers: Vec<Value>,
    pub customer_ledger_payments: Vec<Value>,
    pub room_changes: Vec<Value>,
    #[serde(default)]
    pub user_guests: Vec<Value>,
    #[serde(default)]
    pub rooms: Vec<Value>,
    #[serde(default)]
    pub room_types: Vec<Value>,
    #[serde(default)]
    pub promotions: Vec<Value>,
    #[serde(default)]
    pub promotion_room_types: Vec<Value>,
    #[serde(default)]
    pub vouchers: Vec<Value>,
    #[serde(default)]
    pub voucher_redemptions: Vec<Value>,
    #[serde(default)]
    pub voucher_redemption_allocations: Vec<Value>,

    // ----- Extended full-backup tables (business config + operational). -----
    // All default to empty so older export files (and partial exports) still
    // deserialize cleanly.
    #[serde(default)]
    pub system_settings: Vec<Value>,
    #[serde(default)]
    pub rate_plans: Vec<Value>,
    #[serde(default)]
    pub room_rates: Vec<Value>,
    #[serde(default)]
    pub amenities: Vec<Value>,
    #[serde(default)]
    pub room_type_amenities: Vec<Value>,
    #[serde(default)]
    pub services: Vec<Value>,
    #[serde(default)]
    pub booking_services: Vec<Value>,
    #[serde(default)]
    pub booking_channels: Vec<Value>,
    #[serde(default)]
    pub room_status_transitions: Vec<Value>,
    #[serde(default)]
    pub room_history: Vec<Value>,
    #[serde(default)]
    pub room_status_change_log: Vec<Value>,
    #[serde(default)]
    pub email_templates: Vec<Value>,
    #[serde(default)]
    pub loyalty_programs: Vec<Value>,
    #[serde(default)]
    pub loyalty_tiers: Vec<Value>,
    #[serde(default)]
    pub loyalty_memberships: Vec<Value>,
    #[serde(default)]
    pub loyalty_members: Vec<Value>,
    #[serde(default)]
    pub loyalty_accounts: Vec<Value>,
    #[serde(default)]
    pub points_transactions: Vec<Value>,
    #[serde(default)]
    pub loyalty_transactions: Vec<Value>,
    #[serde(default)]
    pub reward_catalog: Vec<Value>,
    #[serde(default)]
    pub loyalty_rewards: Vec<Value>,
    #[serde(default)]
    pub reward_redemptions: Vec<Value>,
    #[serde(default)]
    pub loyalty_redemptions: Vec<Value>,
    #[serde(default)]
    pub loyalty_program_rules: Vec<Value>,
    #[serde(default)]
    pub corporate_accounts: Vec<Value>,
    #[serde(default)]
    pub corporate_account_contacts: Vec<Value>,
    #[serde(default)]
    pub housekeeping_tasks: Vec<Value>,
    #[serde(default)]
    pub maintenance_tickets: Vec<Value>,
    #[serde(default)]
    pub guest_documents: Vec<Value>,
    #[serde(default)]
    pub guest_notes: Vec<Value>,
    #[serde(default)]
    pub guest_preferences: Vec<Value>,
    #[serde(default)]
    pub guest_reviews: Vec<Value>,
    #[serde(default)]
    pub self_checkin_events: Vec<Value>,
    #[serde(default)]
    pub night_audit_posted_nights: Vec<Value>,
}

/// Schema-driven full database export. Table keys are always schema-qualified
/// (for example, `public.users`) so rows from application schemas cannot
/// collide with public tables of the same name.
#[derive(Debug, Serialize, Deserialize)]
pub struct FullDataExport {
    pub version: String,
    pub exported_at: String,
    pub tables: BTreeMap<String, Vec<Value>>,
}

/// Accept both historic flat exports and schema-driven full exports.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum TransferPayload {
    V2(FullDataExport),
    V1(Box<BookingDataExport>),
}

/// Count preview for all transferable tables before generating an export file.
#[derive(Debug, Serialize)]
pub struct ExportPreview {
    pub generated_at: String,
    pub counts: HashMap<String, i64>,
    pub total_records: i64,
    pub tables: Vec<TransferTablePreview>,
}

#[derive(Debug, Serialize)]
pub struct TransferTablePreview {
    pub name: String,
    pub count: i64,
    pub dependencies: Vec<String>,
}

/// Import request wrapper.
#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub mode: ImportMode,
    pub data: TransferPayload,
    #[serde(default)]
    pub tables: Vec<String>,
}

// ----- `hotel-backup` v3 file format + upload/preview/execute/job API. -----
// The JSON format is camelCase; legacy structs above keep their snake_case
// fields untouched. Every item below is wired to the export/import endpoints
// landing in the next tasks, so each carries `#[allow(dead_code)]` (the bin
// target re-declares these modules and would otherwise warn).

/// Where a backup file was produced. `environment` is the lowercased
/// `config::Environment`; `database_provider` is always `"postgresql"`.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSource {
    pub environment: String,
    pub database_provider: String,
}

/// One transferable entity's identity in the backup manifest — name,
/// primary-key columns and the exported column list, in schema order.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntityDescriptor {
    pub name: String,
    pub primary_key: Vec<String>,
    pub columns: Vec<String>,
}

/// One schema table deliberately left out of a backup. `reason` is one of the
/// reason codes in [`crate::services::data_transfer::EXCLUDED_TABLES`].
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupExclusion {
    pub name: String,
    pub reason: String,
}

/// Coverage declaration embedded in every v3 file: what was exported and what
/// was intentionally left behind, so a restore can see the difference between
/// "absent" and "excluded".
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub entities: Vec<BackupEntityDescriptor>,
    pub exclusions: Vec<BackupExclusion>,
}

/// Trailer written after the last table: the entity count and row counts
/// actually streamed. A download missing this block (or the closing brace) is
/// truncated and must not be trusted.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupIntegrity {
    pub entities: u64,
    pub rows: u64,
    pub entity_rows: BTreeMap<String, u64>,
    pub completed_at: String,
}

/// A parsed `hotel-backup` v3 document — the import side's parse target.
///
/// Only ever deserialized: the export writer emits the bytes by hand so a
/// large backup never materializes as a `Value`. `tables` keeps every row as
/// raw JSON text, so the whole file parses at roughly 1x its byte size instead
/// of ~3.5x for `Value` trees; the import job converts rows one at a time.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    /// Always `"hotel-backup"` — anything else is rejected before this parse.
    pub format: String,
    /// Always `3` for this struct.
    pub version: u32,
    /// Payload class; only `"business-data"` exists today.
    pub kind: String,
    pub export_id: Uuid,
    /// RFC 3339 timestamp, kept as text (matches `exported_at` on the legacy
    /// structs — the import never does date math on it).
    pub exported_at: String,
    pub application_version: String,
    pub source: BackupSource,
    pub manifest: BackupManifest,
    pub tables: BTreeMap<String, Vec<Box<RawValue>>>,
    pub integrity: BackupIntegrity,
}

/// Response to `POST /data-transfer/import/uploads` — the staged file's
/// handle for preview/execute/delete.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub upload_id: Uuid,
    pub bytes: u64,
    /// `"v3"`, `"v2"`, `"v1"`, or `"unknown"`. Detection is a first-kilobytes
    /// sniff, not a verdict — preview reports the real parse errors.
    pub detected_format: String,
}

/// Request body for `POST /data-transfer/import/preview`.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewRequest {
    pub upload_id: Uuid,
}

/// Per-entity diff between a staged backup and the destination database.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewEntity {
    pub name: String,
    /// Rows the file carries for this entity.
    pub rows: u64,
    /// Rows whose primary key does not exist in the destination — `None` when
    /// the format cannot support the diff (v1 files carry counts only).
    pub new: Option<u64>,
    pub existing: Option<u64>,
    /// Rows the import would skip (for example references to excluded parents
    /// such as a `created_by` user absent here).
    pub skipped: Option<u64>,
}

/// Rows that reference records outside the transferable set (for example a
/// `created_by` user that does not exist in this database) and so cannot be
/// applied as-is. Shared by the preview and the finished job's report.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRelationshipProblem {
    pub entity: String,
    pub rows: u64,
    pub reason: String,
}

/// What a staged backup would do if executed — the pre-flight report returned
/// by `POST /data-transfer/import/preview`.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub upload_id: Uuid,
    /// `"v3"`, `"v2"`, `"v1"`, or `"unknown"`.
    pub format: String,
    /// Numeric format version when the file carries one (v3 -> 3, v2 -> 2).
    pub version: Option<u32>,
    pub exported_at: Option<String>,
    /// `source.environment` for v3 files; `None` for older formats.
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
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackupImportMode {
    /// Insert only; conflicts resolve per `on_conflict`.
    Merge,
    /// Clear the selected transferable tables first, then insert.
    Restore,
}

/// What a merge import does when a row's primary key already exists.
#[allow(dead_code)]
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
#[allow(dead_code)]
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

/// Lifecycle states of a background import job.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportJobState {
    Running,
    Succeeded,
    Failed,
}

/// Live progress of a running import job, updated per entity batch.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    /// Entity currently being applied; `None` before the first batch.
    pub entity: Option<String>,
    pub rows_applied: u64,
    pub total_rows: u64,
}

/// Per-entity outcome inside [`ImportJobReport`].
#[allow(dead_code)]
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
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobReport {
    pub entities: Vec<ImportEntityOutcome>,
    #[serde(default)]
    pub relationship_problems: Vec<ImportRelationshipProblem>,
}

/// Final counts of a finished import job.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobResult {
    pub inserted: u64,
    pub updated: u64,
    pub skipped: u64,
    pub report: ImportJobReport,
}

/// `GET /data-transfer/import/jobs/{jobId}` response.
#[allow(dead_code)]
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
    use super::{
        BackupFile, BackupImportMode, BookingDataExport, ConflictPolicy, ImportJobState,
        TransferPayload, UploadResponse,
    };
    use serde_json::{Value, json};
    use uuid::Uuid;

    fn legacy_payload() -> Value {
        json!({
            "version": "1.0",
            "exported_at": "2026-07-15T00:00:00Z",
            "guests": [],
            "guest_complimentary_credits": [],
            "companies": [],
            "bookings": [],
            "payments": [],
            "invoices": [],
            "booking_guests": [],
            "booking_modifications": [],
            "booking_history": [],
            "night_audit_runs": [],
            "night_audit_details": [],
            "customer_ledgers": [],
            "customer_ledger_payments": [],
            "room_changes": []
        })
    }

    #[test]
    fn legacy_payload_defaults_promotion_tables_to_empty() {
        let export: BookingDataExport =
            serde_json::from_value(legacy_payload()).expect("legacy payload should deserialize");

        assert!(export.promotions.is_empty());
        assert!(export.promotion_room_types.is_empty());
        assert!(export.vouchers.is_empty());
        assert!(export.voucher_redemptions.is_empty());
        assert!(export.voucher_redemption_allocations.is_empty());
    }

    #[test]
    fn promotion_payload_tables_deserialize_and_serialize() {
        let mut payload = legacy_payload();
        let object = payload
            .as_object_mut()
            .expect("test payload should be an object");
        object.insert("promotions".to_string(), json!([{"id": 1}]));
        object.insert(
            "promotion_room_types".to_string(),
            json!([{"promotion_id": 1, "room_type_id": 2}]),
        );
        object.insert("vouchers".to_string(), json!([{"id": 3}]));
        object.insert("voucher_redemptions".to_string(), json!([{"id": 4}]));
        object.insert(
            "voucher_redemption_allocations".to_string(),
            json!([{"id": 5}]),
        );

        let export: BookingDataExport =
            serde_json::from_value(payload).expect("promotion payload should deserialize");
        assert_eq!(export.promotions, vec![json!({"id": 1})]);
        assert_eq!(export.promotion_room_types.len(), 1);
        assert_eq!(export.vouchers.len(), 1);
        assert_eq!(export.voucher_redemptions.len(), 1);
        assert_eq!(export.voucher_redemption_allocations.len(), 1);

        let serialized = serde_json::to_value(export).expect("payload should serialize");
        assert_eq!(serialized["voucher_redemption_allocations"][0]["id"], 5);
    }

    #[test]
    fn v2_payload_preserves_schema_qualified_credential_rows() {
        let payload = json!({
            "version": "2.0",
            "exported_at": "2026-07-27T00:00:00Z",
            "tables": {
                "public.users": [{"id": 1, "password_hash": "stored-hash"}]
            }
        });

        let export: TransferPayload =
            serde_json::from_value(payload).expect("v2 payload should deserialize");

        let TransferPayload::V2(export) = export else {
            panic!("v2 payload should use schema-driven transfer format");
        };
        assert_eq!(
            export.tables["public.users"][0]["password_hash"],
            "stored-hash"
        );
    }

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
    fn backup_file_deserializes_v3_document_with_raw_rows() {
        let export_id = Uuid::new_v4();
        let document = json!({
            "format": "hotel-backup",
            "version": 3,
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
            serde_json::from_value(document).expect("v3 document should deserialize");

        assert_eq!(file.format, "hotel-backup");
        assert_eq!(file.version, 3);
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
            detected_format: "v3".to_string(),
        };

        let value = serde_json::to_value(response).expect("response should serialize");
        assert_eq!(value["uploadId"], json!(upload_id));
        assert_eq!(value["bytes"], json!(42));
        assert_eq!(value["detectedFormat"], json!("v3"));
        assert!(value.get("upload_id").is_none());
    }
}
