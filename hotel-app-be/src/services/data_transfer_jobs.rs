//! Backup-import pipeline: staged uploads, preview, and the background
//! import-job registry behind `upload → preview → execute → poll`.
//!
//! Uploads stream to `<private_uploads>/data-transfer/upload-<uuid>.json`
//! through a `.part` temp file, so a preview or job never opens a half-written
//! body. `private_uploads` resolves relative to the process working directory
//! — the same convention eKYC and payment receipts use (`/app` in the
//! container, bind-mounted from the host, never publicly served).
//!
//! An execute spawns a `tokio` job rather than holding the request open: the
//! registry in [`IMPORT_JOBS`] is process-local state the status endpoint and
//! the upload lifecycle guards read; finished jobs expire after one hour.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use axum::body::Body;
use futures_core::Stream;
use serde_json::value::RawValue;
use serde_json::{Map, Value};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::constants::ImportMode;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    AuditEvent, BackupFile, BackupImportMode, BookingDataExport, ConflictPolicy, FullDataExport,
    ImportEntityOutcome, ImportExecuteRequest, ImportExecuteResponse, ImportJobReport,
    ImportJobResult, ImportJobState, ImportJobStatus, ImportPreview, ImportPreviewEntity,
    ImportRelationshipProblem, JobProgress, UploadResponse,
};
use crate::repositories::data_transfer::{
    DataTransferRepository, ForeignKeyRef, InsertRowOutcome, PkLookup, QualifiedTable,
    TransferTable, transfer_order,
};
use crate::services::data_transfer::{
    AUDIT_USER_FK_COLUMNS, EXCLUDED_TABLES, backup_environment, expand_full_overwrite_tables,
    import_legacy_booking_data, is_transferable_key, legacy_tables_and_data,
};

/// Staging root for in-flight backup uploads — `private_uploads` resolves
/// relative to the working directory exactly like
/// `ekyc::validation::EKYC_UPLOAD_DIR` (`/app/private_uploads` in the
/// container, bind-mounted from the host).
pub const DATA_TRANSFER_UPLOAD_DIR: &str = "private_uploads/data-transfer";

/// Hard cap enforced while the body streams — the route-level
/// `DefaultBodyLimit` only governs buffering extractors, so the upload loop
/// counts bytes itself and aborts past this.
const MAX_UPLOAD_BYTES: u64 = 256 * 1024 * 1024;

/// Bytes sniffed for `detectedFormat` on upload and for format detection
/// inside preview/execute. Every writer this service emits puts the format
/// markers well inside 4 KB.
const SNIFF_PREFIX_BYTES: usize = 4096;

/// Staged files abandoned past this age are swept on startup and per upload.
const STAGED_UPLOAD_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Finished jobs stay queryable for this long, then drop out of the registry.
const FINISHED_JOB_TTL: Duration = Duration::from_secs(60 * 60);

/// How often the job writes progress mid-entity (every entity boundary is an
/// update too — these cover entities with thousands of rows).
const PROGRESS_UPDATE_EVERY: u64 = 5_000;

/// `WHERE pk = ANY($1)` chunk size for the preview's new/existing diff.
const PK_LOOKUP_BATCH: usize = 5_000;

// ---------------------------------------------------------------------------
// Staged uploads
// ---------------------------------------------------------------------------

/// The directory uploads stage into. Exposed so `main.rs` can sweep at
/// startup without re-encoding the path.
pub fn staged_upload_dir() -> PathBuf {
    PathBuf::from(DATA_TRANSFER_UPLOAD_DIR)
}

fn staged_part_path(dir: &Path, upload_id: Uuid) -> PathBuf {
    dir.join(format!("upload-{upload_id}.part"))
}

fn staged_json_path(dir: &Path, upload_id: Uuid) -> PathBuf {
    dir.join(format!("upload-{upload_id}.json"))
}

fn staged_upload_path(upload_id: Uuid) -> PathBuf {
    staged_json_path(&staged_upload_dir(), upload_id)
}

/// Delete `upload-*.{part,json}` files older than [`STAGED_UPLOAD_TTL`].
/// Best-effort: called at startup and on every upload, so individual failures
/// only log. A live job's file is always younger than its own lifetime, so
/// the sweep can never delete a file a job still needs.
pub fn sweep_staged_uploads(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now() - STAGED_UPLOAD_TTL;
    let mut removed = 0_u32;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.starts_with("upload-") || !(name.ends_with(".json") || name.ends_with(".part")) {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if stale && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        log::info!("swept {removed} stale staged data-transfer upload(s)");
    }
}

/// Why an upload never became a staged file. `PayloadTooLarge` maps to a 413
/// response the [`ApiError`] enum has no variant for, so the handler
/// translates this enum itself.
#[derive(Debug)]
pub enum StageUploadError {
    PayloadTooLarge,
    BadRequest(String),
    Internal(ApiError),
}

fn stage_internal(context: &str, error: impl std::fmt::Display) -> StageUploadError {
    log::error!("data-transfer upload staging failed ({context}): {error}");
    StageUploadError::Internal(ApiError::Internal(
        "could not store the uploaded backup".to_string(),
    ))
}

/// Stream the request body to `<staging>/upload-<uuid>.part`, rename to
/// `.json` once complete, and report the sniffed format. The `.part` file is
/// deleted whenever the upload aborts — incomplete bodies never reach the
/// staging set the sweep and the endpoints look at.
pub async fn stage_backup_upload(body: Body) -> Result<UploadResponse, StageUploadError> {
    let dir = staged_upload_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| stage_internal("create staging dir", error))?;
    sweep_staged_uploads(&dir);

    let upload_id = Uuid::new_v4();
    let part_path = staged_part_path(&dir, upload_id);
    let json_path = staged_json_path(&dir, upload_id);

    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|error| stage_internal("create temp file", error))?;
    let mut stream = std::pin::pin!(body.into_data_stream());
    let mut sniff = Vec::with_capacity(SNIFF_PREFIX_BYTES);
    let mut total = 0_u64;
    // The file must be one JSON document; a body whose first non-whitespace
    // byte is not `{` is rejected before any bytes are written.
    let mut object_started = false;

    let outcome: Result<u64, StageUploadError> = async {
        while let Some(chunk) = std::future::poll_fn(|cx| stream.as_mut().poll_next(cx)).await {
            let bytes = chunk.map_err(|error| stage_internal("read body", error))?;
            if !object_started {
                match bytes.iter().find(|byte| !byte.is_ascii_whitespace()) {
                    None => continue,
                    Some(b'{') => object_started = true,
                    Some(_) => {
                        return Err(StageUploadError::BadRequest(
                            "the uploaded file is not a JSON document".to_string(),
                        ));
                    }
                }
            }
            total += bytes.len() as u64;
            if total > MAX_UPLOAD_BYTES {
                return Err(StageUploadError::PayloadTooLarge);
            }
            if sniff.len() < SNIFF_PREFIX_BYTES {
                let take = (SNIFF_PREFIX_BYTES - sniff.len()).min(bytes.len());
                sniff.extend_from_slice(&bytes[..take]);
            }
            file.write_all(&bytes)
                .await
                .map_err(|error| stage_internal("write temp file", error))?;
        }
        if !object_started {
            return Err(StageUploadError::BadRequest(
                "the request body is empty".to_string(),
            ));
        }
        file.flush()
            .await
            .map_err(|error| stage_internal("flush temp file", error))?;
        Ok(total)
    }
    .await;

    drop(file);

    let bytes = match outcome {
        Ok(bytes) => bytes,
        Err(error) => {
            if let Err(remove_error) = tokio::fs::remove_file(&part_path).await {
                log::warn!("could not remove aborted upload staging file: {remove_error}");
            }
            return Err(error);
        }
    };

    if let Err(error) = tokio::fs::rename(&part_path, &json_path).await {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err(stage_internal("rename staged upload", error));
    }

    Ok(UploadResponse {
        upload_id,
        bytes,
        detected_format: detect_backup_format(&sniff).to_string(),
    })
}

/// Discard a staged upload. A file a running job still needs answers 409 —
/// deleting it mid-import would orphan the job's input on filesystems where
/// an unlink does not keep an open file readable.
pub async fn delete_staged_upload(upload_id: Uuid) -> Result<(), ApiError> {
    if job_running_for_upload(upload_id) {
        return Err(ApiError::Conflict(
            "a running import job is still reading this upload".to_string(),
        ));
    }
    let path = staged_upload_path(upload_id);
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(ApiError::NotFound(
            "staged upload not found or already consumed".to_string(),
        )),
        Err(error) => {
            log::error!("could not delete staged upload {upload_id}: {error}");
            Err(ApiError::Internal(
                "could not delete the staged upload".to_string(),
            ))
        }
    }
}

/// Classify a staged backup from its first bytes. This is a sniff — upload
/// reports it as `detectedFormat`, while preview and execute re-parse fully
/// and trust the parse, not this verdict.
pub fn detect_backup_format(prefix: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(prefix);
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.contains("\"format\":\"hotel-backup\"")
        && (compact.contains("\"version\":3,") || compact.contains("\"version\":3}"))
    {
        "v3"
    } else if compact.contains("\"version\":\"2.0\"") && compact.contains("\"tables\":") {
        "v2"
    } else if compact.contains("\"version\":\"1.")
        || compact.contains("\"guests\":")
        || compact.contains("\"bookings\":")
        || compact.contains("\"companies\":")
    {
        "v1"
    } else {
        "unknown"
    }
}

// ---------------------------------------------------------------------------
// Staged-file parsing
// ---------------------------------------------------------------------------

/// A staged file parsed into the struct matching its real format. The parser
/// tries formats in sniff order and falls through on failure, so a
/// misdetected file still lands in the right shape.
enum ParsedBackup {
    V3(Box<BackupFile>),
    V2(Box<FullDataExport>),
    V1(Box<BookingDataExport>),
}

fn parse_reader<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    serde_json::from_reader(BufReader::new(file)).map_err(|error| error.to_string())
}

/// Read the first [`SNIFF_PREFIX_BYTES`] for detection, rewind, then try each
/// known format — the sniff's pick first, the rest in newest-first order.
/// Runs inside `spawn_blocking`: a 256 MB parse must not sit on a runtime
/// worker.
fn parse_staged_file(path: &Path) -> Result<ParsedBackup, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut prefix = Vec::new();
    file.by_ref()
        .take(SNIFF_PREFIX_BYTES as u64)
        .read_to_end(&mut prefix)
        .map_err(|error| error.to_string())?;
    let detected = detect_backup_format(&prefix);
    let _ = file.seek(SeekFrom::Start(0));

    let order: &[&str] = match detected {
        "v3" => &["v3", "v2", "v1"],
        "v2" => &["v2", "v3", "v1"],
        "v1" => &["v1", "v3", "v2"],
        _ => &["v3", "v2", "v1"],
    };

    for format in order {
        match *format {
            "v3" => {
                if let Ok(file) = parse_reader::<BackupFile>(path) {
                    return Ok(ParsedBackup::V3(Box::new(file)));
                }
            }
            "v2" => {
                if let Ok(file) = parse_reader::<FullDataExport>(path) {
                    return Ok(ParsedBackup::V2(Box::new(file)));
                }
            }
            _ => {
                if let Ok(file) = parse_reader::<BookingDataExport>(path) {
                    return Ok(ParsedBackup::V1(Box::new(file)));
                }
            }
        }
    }
    Err("the file is not a recognized hotel backup (expected a hotel-backup v3 document, a schema-driven \"2.0\" export, or a legacy booking export)".to_string())
}

async fn read_staged_backup(upload_id: Uuid) -> Result<ParsedBackup, ApiError> {
    let path = staged_upload_path(upload_id);
    if !path.exists() {
        return Err(ApiError::NotFound(
            "staged upload not found — the file may have expired or been consumed".to_string(),
        ));
    }
    tokio::task::spawn_blocking(move || parse_staged_file(&path))
        .await
        .map_err(|error| ApiError::Internal(format!("backup parse task failed: {error}")))?
        .map_err(|error| {
            ApiError::BadRequest(format!("the staged upload could not be parsed: {error}"))
        })
}

/// Rows of one entity inside a backup file: raw JSON text for v3 (the ~1×
/// file-size memory bound), already-parsed values for v2.
enum BackupRows {
    Raw(Vec<Box<RawValue>>),
    Json(Vec<Value>),
}

impl BackupRows {
    fn len(&self) -> usize {
        match self {
            BackupRows::Raw(rows) => rows.len(),
            BackupRows::Json(rows) => rows.len(),
        }
    }

    /// Convert each stored row to a JSON object, one at a time — the laziness
    /// is load-bearing: the v3 file keeps rows as raw text (~1x file size) and
    /// only the row currently being inserted ever becomes a `Map`.
    fn into_objects(
        self,
        entity: &str,
    ) -> Box<dyn Iterator<Item = Result<Map<String, Value>, ApiError>> + Send> {
        let entity = entity.to_string();
        match self {
            BackupRows::Raw(rows) => {
                Box::new(rows.into_iter().enumerate().map(move |(index, raw)| {
                    serde_json::from_str::<Map<String, Value>>(raw.get()).map_err(|error| {
                        ApiError::BadRequest(format!(
                            "{entity} row {} is not a JSON object: {error}",
                            index + 1
                        ))
                    })
                }))
            }
            BackupRows::Json(rows) => Box::new(rows.into_iter().enumerate().map(
                move |(index, value)| match value {
                    Value::Object(object) => Ok(object),
                    _ => Err(ApiError::BadRequest(format!(
                        "{entity} row {} is not a JSON object",
                        index + 1
                    ))),
                },
            )),
        }
    }
}

/// Which fate a row value on a dangling-reference column gets.
enum RefDecision {
    /// The reference resolves — leave the value alone.
    Keep,
    /// Rewrite to the importing admin (audit columns on `users` references) or
    /// to NULL (anything nullable).
    Remap(Value),
    /// A required, non-audit reference to a missing parent — the row cannot
    /// be applied and counts as skipped.
    Skip,
}

// ---------------------------------------------------------------------------
// Missing-reference policy (references to non-transferable parents)
// ---------------------------------------------------------------------------

/// One foreign-key column on a transferable table whose parent sits outside
/// the transferable set (`users`, `roles`, `ekyc_verifications`, …). A backup
/// can carry ids the destination never had — the generalized form of the V1
/// path's `user_fk_columns` handling.
struct DanglingRef {
    column: String,
    parent_key: String,
    /// `NOT NULL` on the child column — a dangling value cannot be nulled out.
    required: bool,
    /// Audit column on a `users` reference — remap to the importing admin so
    /// attribution survives the missing account.
    audit_remap: bool,
}

/// Precomputed scan context: which columns can dangle, and the values that
/// actually exist on each non-transferable parent.
struct MissingRefScan {
    /// Transferable child key -> columns to check per row.
    refs: HashMap<String, Vec<DanglingRef>>,
    /// Parent key -> existing key values in canonical text form.
    existing: HashMap<String, HashSet<String>>,
    /// The importing admin — remap target for missing audit-user references.
    fallback_user_id: i64,
}

/// Canonical text form for comparing a JSON key value against `::text` output
/// — integers and uuids normalize, anything else scalar compares verbatim.
fn ref_value_key(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => Some(number.to_string()),
        Value::String(text) => {
            if let Ok(int) = text.parse::<i64>() {
                Some(int.to_string())
            } else if let Ok(uuid) = Uuid::parse_str(text) {
                Some(uuid.to_string())
            } else {
                Some(text.clone())
            }
        }
        Value::Bool(value) => Some(value.to_string()),
        // Null is handled before this; arrays/objects are malformed values the
        // insert itself will reject with a real type error.
        _ => None,
    }
}

impl MissingRefScan {
    async fn build(
        pool: &DbPool,
        children: &[QualifiedTable],
        fallback_user_id: i64,
    ) -> Result<Self, ApiError> {
        let foreign_keys = DataTransferRepository::foreign_key_refs(pool, children).await?;
        let bare_names: Vec<&str> = children
            .iter()
            .filter(|child| child.schema == "public")
            .map(|child| child.name.as_str())
            .collect();
        let required_columns = DataTransferRepository::required_columns(pool, &bare_names).await?;

        let mut refs: HashMap<String, Vec<DanglingRef>> = HashMap::new();
        let mut parents: HashMap<String, (QualifiedTable, String)> = HashMap::new();
        for ForeignKeyRef {
            child,
            column,
            parent,
            parent_column,
        } in foreign_keys
        {
            // References between transferable tables are import ordering's
            // problem, not this scan's — those rows come with the file or
            // fail the deferred constraint check.
            if is_transferable_key(&parent.key()) {
                continue;
            }
            let parent_key = parent.key();
            parents
                .entry(parent_key.clone())
                .or_insert((parent, parent_column));
            let required = required_columns
                .get(&child.name)
                .is_some_and(|columns| columns.contains(&column));
            let audit_remap =
                parent_key == "public.users" && AUDIT_USER_FK_COLUMNS.contains(&column.as_str());
            refs.entry(child.key()).or_default().push(DanglingRef {
                column,
                parent_key,
                required,
                audit_remap,
            });
        }

        let mut existing = HashMap::new();
        for (key, (parent, column)) in parents {
            existing.insert(
                key,
                DataTransferRepository::existing_key_values(pool, &parent, &column).await?,
            );
        }

        Ok(Self {
            refs,
            existing,
            fallback_user_id,
        })
    }

    fn column_decision(&self, reference: &DanglingRef, value: &Value) -> RefDecision {
        let Some(key) = ref_value_key(value) else {
            return RefDecision::Keep;
        };
        if self
            .existing
            .get(&reference.parent_key)
            .is_some_and(|values| values.contains(&key))
        {
            return RefDecision::Keep;
        }
        if reference.audit_remap {
            RefDecision::Remap(Value::Number(self.fallback_user_id.into()))
        } else if reference.required {
            RefDecision::Skip
        } else {
            RefDecision::Remap(Value::Null)
        }
    }

    /// Apply the missing-reference policy in place: rewrite audit references
    /// to the importing admin, null the nullable rest, and report the
    /// `(column, parent)` that forces the row to be skipped, if any.
    fn apply(&self, table_key: &str, row: &mut Map<String, Value>) -> Option<(String, String)> {
        let references = self.refs.get(table_key)?;
        for reference in references {
            let Some(value) = row.get(&reference.column) else {
                continue;
            };
            if value.is_null() {
                continue;
            }
            match self.column_decision(reference, value) {
                RefDecision::Keep => {}
                RefDecision::Remap(new_value) => {
                    row.insert(reference.column.clone(), new_value);
                }
                RefDecision::Skip => {
                    return Some((reference.column.clone(), reference.parent_key.clone()));
                }
            }
        }
        None
    }

    /// Non-mutating preview counterpart of [`Self::apply`]: `(reason the row
    /// would be skipped, references that would be rewritten)`.
    fn assess(&self, table_key: &str, row: &Map<String, Value>) -> (Option<(String, String)>, u64) {
        let Some(references) = self.refs.get(table_key) else {
            return (None, 0);
        };
        let mut rewrites = 0_u64;
        for reference in references {
            let Some(value) = row.get(&reference.column) else {
                continue;
            };
            if value.is_null() {
                continue;
            }
            match self.column_decision(reference, value) {
                RefDecision::Keep => {}
                RefDecision::Remap(_) => rewrites += 1,
                RefDecision::Skip => {
                    return (
                        Some((reference.column.clone(), reference.parent_key.clone())),
                        rewrites,
                    );
                }
            }
        }
        (None, rewrites)
    }
}

fn relationship_problem_reason(column: &str, parent_key: &str) -> String {
    format!("{column} references {parent_key} rows not present in this database")
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/// What a staged backup would do — the pre-flight diff behind
/// `POST /data-transfer/import/preview`.
pub async fn preview_import(pool: &DbPool, upload_id: Uuid) -> Result<ImportPreview, ApiError> {
    match read_staged_backup(upload_id).await? {
        ParsedBackup::V3(file) => preview_structured(pool, upload_id, *file).await,
        ParsedBackup::V2(file) => {
            let tables = file
                .tables
                .into_iter()
                .map(|(key, rows)| (key, BackupRows::Json(rows)))
                .collect();
            let preview = preview_table_map(
                pool,
                upload_id,
                FileHeader {
                    format: "v2",
                    version: Some(2),
                    exported_at: Some(file.exported_at.clone()),
                    source_environment: None,
                    application_version: None,
                },
                tables,
            )
            .await?;
            if file.version != "2.0" {
                return Ok(with_validation_error(
                    preview,
                    format!(
                        "unsupported schema-driven export version '{}' — this build understands \"2.0\"",
                        file.version
                    ),
                ));
            }
            Ok(preview)
        }
        ParsedBackup::V1(file) => preview_legacy(pool, upload_id, *file).await,
    }
}

fn with_validation_error(mut preview: ImportPreview, error: String) -> ImportPreview {
    preview.validation_errors.push(error);
    preview
}

/// Diff one structured (`tables`-keyed) file against the destination. Shared
/// by the v3 and v2 preview paths.
async fn preview_structured(
    pool: &DbPool,
    upload_id: Uuid,
    file: BackupFile,
) -> Result<ImportPreview, ApiError> {
    // The manifest and integrity trailer exist precisely so this check can
    // run: a file whose row counts disagree with its own trailer was
    // truncated or modified after the export completed.
    let manifest_names: HashSet<&str> = file
        .manifest
        .entities
        .iter()
        .map(|entity| entity.name.as_str())
        .collect();
    let mut trailer_warnings = Vec::new();
    for key in file.tables.keys() {
        if !manifest_names.contains(key.as_str()) {
            trailer_warnings.push(format!(
                "{key} is present in the file but absent from its manifest"
            ));
        }
    }
    let declared_rows: u64 = file.integrity.entity_rows.values().sum();
    let actual_rows: u64 = file.tables.values().map(|rows| rows.len() as u64).sum();
    if declared_rows != actual_rows {
        trailer_warnings.push(format!(
            "the integrity trailer declares {declared_rows} rows but the file carries {actual_rows} — the file may be truncated or modified"
        ));
    }

    let mut preview = preview_table_map(
        pool,
        upload_id,
        FileHeader {
            format: "v3",
            version: Some(file.version),
            exported_at: Some(file.exported_at.clone()),
            source_environment: Some(file.source.environment.clone()),
            application_version: Some(file.application_version.clone()),
        },
        file.tables
            .into_iter()
            .map(|(key, rows)| (key, BackupRows::Raw(rows)))
            .collect(),
    )
    .await?;
    preview.warnings.extend(trailer_warnings);

    if file.format != "hotel-backup" {
        preview
            .validation_errors
            .push(format!("unsupported backup format '{}'", file.format));
    }
    if file.version != 3 {
        preview.validation_errors.push(format!(
            "unsupported hotel-backup version {} — this build understands version 3",
            file.version
        ));
    }
    if file.kind != "business-data" {
        preview
            .validation_errors
            .push(format!("unsupported backup kind '{}'", file.kind));
    }
    Ok(preview)
}

/// Mutable accumulators the per-entity diff writes into — bundled so the
/// function signature stays readable.
struct PreviewAccum<'a> {
    /// `(entity, column, parent)` -> rows that would be skipped.
    relationship_problems: &'a mut HashMap<(String, String, String), u64>,
    /// References that would be rewritten (admin-remap or NULL).
    rewritten_refs: &'a mut u64,
    validation_errors: &'a mut Vec<String>,
}

/// `new`/`existing`/`skipped` for one entity: collect each row's normalized
/// primary-key value, batch-match against the destination, and count rows
/// whose key is absent (or missing — a keyless row always inserts as new).
/// The missing-reference assessment rides the same single pass.
async fn diff_entity_rows(
    pool: &DbPool,
    descriptor: &TransferTable,
    key: &str,
    rows: BackupRows,
    scan: &MissingRefScan,
    entity: &mut ImportPreviewEntity,
    accum: &mut PreviewAccum<'_>,
) -> Result<(), ApiError> {
    let pk_columns = &descriptor.primary_key_columns;
    let mut malformed = 0_u64;
    let mut skipped = 0_u64;

    // One pass: assess the row and lift its primary-key value(s). Composite
    // keys keep per-row EXISTS lookups — the batched ANY() path only pays off
    // for the single-column keys every large table uses.
    let mut single_keys: Vec<Option<String>> = Vec::new();
    let mut composite_keys: Vec<Option<Vec<(String, String)>>> = Vec::new();
    for object in rows.into_objects(key) {
        let object = match object {
            Ok(object) => object,
            Err(_) => {
                malformed += 1;
                single_keys.push(None);
                composite_keys.push(None);
                continue;
            }
        };
        let (skip_reason, rewrites) = scan.assess(key, &object);
        *accum.rewritten_refs += rewrites;
        if let Some((column, parent)) = skip_reason {
            skipped += 1;
            *accum
                .relationship_problems
                .entry((key.to_string(), column, parent))
                .or_default() += 1;
        }
        match pk_columns.as_slice() {
            [column] => single_keys.push(object.get(column).and_then(ref_value_key)),
            _ if !pk_columns.is_empty() => composite_keys.push(
                pk_columns
                    .iter()
                    .map(|column| {
                        object
                            .get(column)
                            .and_then(ref_value_key)
                            .map(|value| (column.clone(), value))
                    })
                    .collect(),
            ),
            _ => {}
        }
    }

    if malformed > 0 {
        accum.validation_errors.push(format!(
            "{key}: {malformed} row(s) are not JSON objects and cannot be imported"
        ));
    }
    entity.skipped = Some(skipped);

    if pk_columns.is_empty() {
        // No primary key — nothing to diff against; every row inserts as new.
        entity.existing = Some(0);
        entity.new = Some(entity.rows);
        return Ok(());
    }

    let mut existing = 0_u64;
    if pk_columns.len() == 1 {
        // Lift the batch to the narrowest key type so the ANY() array binds to
        // the pk column's own type.
        let typed_keys: Vec<&String> = single_keys.iter().flatten().collect();
        let all_int = typed_keys.iter().all(|key| key.parse::<i64>().is_ok());
        let all_uuid = typed_keys.iter().all(|key| Uuid::parse_str(key).is_ok());
        let mut found: HashSet<String> = HashSet::new();
        for chunk in typed_keys.chunks(PK_LOOKUP_BATCH) {
            let lookup = if all_int {
                PkLookup::Int(
                    chunk
                        .iter()
                        .filter_map(|key| key.parse::<i64>().ok())
                        .collect(),
                )
            } else if all_uuid {
                PkLookup::Uuid(
                    chunk
                        .iter()
                        .filter_map(|key| Uuid::parse_str(key).ok())
                        .collect(),
                )
            } else {
                PkLookup::Text(chunk.iter().map(|key| (*key).clone()).collect())
            };
            found.extend(
                DataTransferRepository::existing_pk_values(pool, descriptor, &lookup).await?,
            );
        }
        existing = single_keys
            .iter()
            .flatten()
            .filter(|key| found.contains(*key))
            .count() as u64;
    } else {
        for keys in &composite_keys {
            if let Some(keys) = keys
                && DataTransferRepository::row_exists_by_columns(pool, descriptor, keys).await?
            {
                existing += 1;
            }
        }
    }

    entity.existing = Some(existing);
    entity.new = Some(entity.rows - existing);
    Ok(())
}

/// File-level header fields a structured (`tables`-keyed) backup carries —
/// v3 fills all of them, v2 only version/export timestamp.
struct FileHeader<'a> {
    format: &'a str,
    version: Option<u32>,
    exported_at: Option<String>,
    source_environment: Option<String>,
    application_version: Option<String>,
}

/// Shared preview engine for v3/v2 files: classify each entity, diff the
/// transferable ones, and aggregate warnings, problems and totals.
async fn preview_table_map(
    pool: &DbPool,
    upload_id: Uuid,
    header: FileHeader<'_>,
    tables: BTreeMap<String, BackupRows>,
) -> Result<ImportPreview, ApiError> {
    let descriptors = DataTransferRepository::transfer_tables(pool).await?;
    let descriptor_by_name: HashMap<String, TransferTable> = descriptors
        .into_iter()
        .map(|descriptor| (descriptor.table.key(), descriptor))
        .collect();
    let excluded_names: HashSet<&str> = EXCLUDED_TABLES.iter().map(|(name, _)| *name).collect();

    // Split the file's entity list up front so the reference scan only
    // inspects tables that will actually import.
    let mut transferable: Vec<(String, BackupRows)> = Vec::new();
    let mut unsupported_entities = Vec::new();
    let mut warnings = Vec::new();
    let mut validation_errors = Vec::new();
    let mut total_rows = 0_u64;
    for (key, rows) in tables {
        total_rows += rows.len() as u64;
        if QualifiedTable::parse(&key).is_err() {
            validation_errors.push(format!(
                "'{key}' is not a valid schema-qualified entity name"
            ));
            continue;
        }
        if is_transferable_key(&key) {
            if descriptor_by_name.contains_key(&key) {
                transferable.push((key, rows));
            } else {
                // Cannot happen while KNOWN_TABLES mirrors the catalog, but
                // never silently drop an entity.
                unsupported_entities.push(key);
            }
        } else if excluded_names.contains(key.as_str()) {
            warnings.push(format!(
                "{key} is excluded from data transfers and will not be imported"
            ));
        } else if descriptor_by_name.contains_key(&key) {
            unsupported_entities.push(key);
        } else {
            validation_errors.push(format!("{key} does not exist in this database's schema"));
        }
    }

    let children: Vec<QualifiedTable> = transferable
        .iter()
        .filter_map(|(key, _)| QualifiedTable::parse(key).ok())
        .collect();
    let scan = MissingRefScan::build(pool, &children, 0).await?;

    let mut entities = Vec::new();
    let mut relationship_problems: HashMap<(String, String, String), u64> = HashMap::new();
    let mut rewritten_refs = 0_u64;
    for (key, rows) in transferable {
        let descriptor = descriptor_by_name
            .get(&key)
            .expect("transferable keys were filtered against the catalog");
        let mut entity = ImportPreviewEntity {
            name: key.clone(),
            rows: rows.len() as u64,
            new: None,
            existing: None,
            skipped: Some(0),
        };
        let mut accum = PreviewAccum {
            relationship_problems: &mut relationship_problems,
            rewritten_refs: &mut rewritten_refs,
            validation_errors: &mut validation_errors,
        };
        diff_entity_rows(pool, descriptor, &key, rows, &scan, &mut entity, &mut accum).await?;
        entities.push(entity);
    }

    if let Some(environment) = &header.source_environment
        && environment != &backup_environment()
    {
        warnings.push(format!(
            "the backup was exported from a different environment ('{environment}' vs this '{this}')",
            this = backup_environment()
        ));
    }
    if let Some(version_seen) = &header.application_version
        && version_seen != env!("CARGO_PKG_VERSION")
    {
        warnings.push(format!(
            "the backup was exported by application version {version_seen} (this server runs {})",
            env!("CARGO_PKG_VERSION")
        ));
    }
    if rewritten_refs > 0 {
        warnings.push(format!(
            "{rewritten_refs} reference(s) to users or roles absent from this database will be reassigned to the importing user or cleared"
        ));
    }
    if !unsupported_entities.is_empty() {
        warnings.push(format!(
            "{} entity/entities in the file are not part of the transferable set and will be skipped",
            unsupported_entities.len()
        ));
    }

    let relationship_problems = relationship_problems
        .into_iter()
        .map(
            |((entity, column, parent), rows)| ImportRelationshipProblem {
                entity,
                rows,
                reason: relationship_problem_reason(&column, &parent),
            },
        )
        .collect();

    Ok(ImportPreview {
        upload_id,
        format: header.format.to_string(),
        version: header.version,
        exported_at: header.exported_at,
        source_environment: header.source_environment,
        application_version: header.application_version,
        entities,
        unsupported_entities,
        validation_errors,
        relationship_problems,
        warnings,
        total_rows,
    })
}

/// A v1 `BookingDataExport` predates the schema-driven layout — row counts
/// exist, but a new/existing diff or missing-reference scan does not.
async fn preview_legacy(
    _pool: &DbPool,
    upload_id: Uuid,
    file: BookingDataExport,
) -> Result<ImportPreview, ApiError> {
    let mut entities: Vec<ImportPreviewEntity> = legacy_tables_and_data(&file)
        .into_iter()
        .filter(|(_, rows)| !rows.is_empty())
        .map(|(table, rows)| ImportPreviewEntity {
            name: format!("public.{table}"),
            rows: rows.len() as u64,
            new: None,
            existing: None,
            skipped: None,
        })
        .collect();
    entities.sort_by(|left, right| left.name.cmp(&right.name));
    let total_rows = entities.iter().map(|entity| entity.rows).sum();

    Ok(ImportPreview {
        upload_id,
        format: "v1".to_string(),
        version: None,
        exported_at: Some(file.exported_at.clone()),
        source_environment: None,
        application_version: None,
        entities,
        unsupported_entities: Vec::new(),
        validation_errors: Vec::new(),
        relationship_problems: Vec::new(),
        warnings: vec![
            "legacy v1 export — per-row new/existing diff is not available for this format"
                .to_string(),
        ],
        total_rows,
    })
}

// ---------------------------------------------------------------------------
// Job registry
// ---------------------------------------------------------------------------

/// One registered import job. Process-local by design — a restart abandons
/// the staged file to the sweep, which is also what happens when the caller
/// never executes.
struct ImportJobEntry {
    upload_id: Uuid,
    status: ImportJobState,
    progress: JobProgress,
    result: Option<ImportJobResult>,
    error: Option<String>,
    finished_at: Option<Instant>,
}

static IMPORT_JOBS: OnceLock<Mutex<HashMap<Uuid, ImportJobEntry>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<Uuid, ImportJobEntry>> {
    IMPORT_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_registry() -> std::sync::MutexGuard<'static, HashMap<Uuid, ImportJobEntry>> {
    registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Drop finished jobs past [`FINISHED_JOB_TTL`]. Called under the lock on
/// every read/write path so a burst of imports cannot grow the map without
/// bound.
fn prune_finished_jobs(jobs: &mut HashMap<Uuid, ImportJobEntry>) {
    let Some(cutoff) = Instant::now().checked_sub(FINISHED_JOB_TTL) else {
        return;
    };
    jobs.retain(|_, job| job.finished_at.is_none_or(|finished| finished > cutoff));
}

fn job_running_for_upload(upload_id: Uuid) -> bool {
    let mut jobs = lock_registry();
    prune_finished_jobs(&mut jobs);
    jobs.values()
        .any(|job| job.upload_id == upload_id && job.status == ImportJobState::Running)
}

fn register_job(job_id: Uuid, upload_id: Uuid) {
    let mut jobs = lock_registry();
    prune_finished_jobs(&mut jobs);
    jobs.insert(
        job_id,
        ImportJobEntry {
            upload_id,
            status: ImportJobState::Running,
            progress: JobProgress {
                entity: None,
                rows_applied: 0,
                total_rows: 0,
            },
            result: None,
            error: None,
            finished_at: None,
        },
    );
}

fn set_job_progress(job_id: Uuid, entity: Option<String>, rows_applied: u64, total_rows: u64) {
    let mut jobs = lock_registry();
    if let Some(job) = jobs.get_mut(&job_id) {
        job.progress = JobProgress {
            entity,
            rows_applied,
            total_rows,
        };
    }
}

fn finish_job(job_id: Uuid, result: ImportJobResult) {
    let mut jobs = lock_registry();
    if let Some(job) = jobs.get_mut(&job_id) {
        job.status = ImportJobState::Succeeded;
        job.progress.rows_applied = job.progress.total_rows;
        job.result = Some(result);
        job.finished_at = Some(Instant::now());
    }
}

fn fail_job(job_id: Uuid, error: String) {
    let mut jobs = lock_registry();
    if let Some(job) = jobs.get_mut(&job_id) {
        job.status = ImportJobState::Failed;
        job.error = Some(error);
        job.finished_at = Some(Instant::now());
    }
}

/// The `GET /data-transfer/import/jobs/{jobId}` payload — `None` for unknown
/// or expired jobs (finished entries drop out after an hour).
pub fn import_job_status(job_id: Uuid) -> Option<ImportJobStatus> {
    let mut jobs = lock_registry();
    prune_finished_jobs(&mut jobs);
    jobs.get(&job_id).map(|job| ImportJobStatus {
        status: job.status,
        progress: job.progress.clone(),
        result: job.result.clone(),
        error: job.error.clone(),
    })
}

// ---------------------------------------------------------------------------
// Execute + job runner
// ---------------------------------------------------------------------------

/// Validate the execute request, register the job, and spawn the import task.
/// The actual file parse happens inside the job — the response is 202 as soon
/// as the job exists.
pub async fn start_import_job(
    pool: &DbPool,
    import_user_id: i64,
    request: ImportExecuteRequest,
) -> Result<ImportExecuteResponse, ApiError> {
    if !request.confirm {
        return Err(ApiError::BadRequest(
            "confirm must be true to run an import — the operation is destructive".to_string(),
        ));
    }
    let path = staged_upload_path(request.upload_id);
    if !path.exists() {
        return Err(ApiError::NotFound(
            "staged upload not found — the file may have expired or been consumed".to_string(),
        ));
    }
    for table in &request.tables {
        QualifiedTable::parse(table)?;
        if !is_transferable_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{table}' is not permitted: only the business-data table set can be imported"
            )));
        }
    }
    if job_running_for_upload(request.upload_id) {
        return Err(ApiError::Conflict(
            "an import job is already running for this upload".to_string(),
        ));
    }

    let job_id = Uuid::new_v4();
    register_job(job_id, request.upload_id);

    let job_pool = pool.clone();
    let job_path = path.clone();
    let job_request = request;
    tokio::spawn(async move {
        run_import_job(job_pool, job_id, job_path, job_request, import_user_id).await;
    });

    Ok(ImportExecuteResponse { job_id })
}

/// Job body: parse the staged file, run the import, then delete the file
/// regardless of outcome — the sweep only covers uploads that never reach a
/// job.
async fn run_import_job(
    pool: DbPool,
    job_id: Uuid,
    path: PathBuf,
    request: ImportExecuteRequest,
    import_user_id: i64,
) {
    let started = Instant::now();
    audit_import_event(&pool, import_user_id, job_id, &request, "start", None, None).await;

    let outcome = execute_staged_import(&pool, job_id, &path, &request, import_user_id).await;

    if let Err(error) = tokio::fs::remove_file(&path).await {
        log::warn!("import job {job_id}: could not remove staged file: {error}");
    }

    match outcome {
        Ok(result) => {
            finish_job(job_id, result.clone());
            audit_import_event(
                &pool,
                import_user_id,
                job_id,
                &request,
                "completed",
                Some(&result),
                None,
            )
            .await;
            let detail = serde_json::json!({
                "job_id": job_id.to_string(),
                "inserted": result.inserted,
                "updated": result.updated,
                "skipped": result.skipped,
            });
            crate::core::job_runs::record(
                &pool,
                "data_transfer_import",
                Some(detail),
                None,
                started.elapsed(),
            )
            .await;
            log::info!("import job {job_id} completed: {result:?}");
        }
        Err(error) => {
            let message = job_error_message(&error);
            log::error!("import job {job_id} failed: {error}");
            fail_job(job_id, message.clone());
            audit_import_event(
                &pool,
                import_user_id,
                job_id,
                &request,
                "failed",
                None,
                Some(&message),
            )
            .await;
            crate::core::job_runs::record(
                &pool,
                "data_transfer_import",
                None,
                Some(message),
                started.elapsed(),
            )
            .await;
        }
    }
}

/// Job-visible error text: messages written for clients pass through; raw
/// database/internal detail stays in the server log.
fn job_error_message(error: &ApiError) -> String {
    match error {
        ApiError::BadRequest(message) | ApiError::Conflict(message) => message.clone(),
        ApiError::NotFound(message) => message.clone(),
        _ => {
            "the import failed with an internal error — the transaction was rolled back".to_string()
        }
    }
}

async fn audit_import_event(
    pool: &DbPool,
    import_user_id: i64,
    job_id: Uuid,
    request: &ImportExecuteRequest,
    phase: &str,
    result: Option<&ImportJobResult>,
    error: Option<&str>,
) {
    let mut details = serde_json::json!({
        "job_id": job_id.to_string(),
        "phase": phase,
        "mode": serde_json::to_value(request.mode).unwrap_or(Value::Null),
        "on_conflict": request
            .on_conflict
            .and_then(|policy| serde_json::to_value(policy).ok())
            .unwrap_or(Value::Null),
    });
    if let Some(result) = result {
        details["inserted"] = result.inserted.into();
        details["updated"] = result.updated.into();
        details["skipped"] = result.skipped.into();
        details["entities"] = serde_json::to_value(&result.report.entities).unwrap_or(Value::Null);
    }
    if let Some(error) = error {
        details["error"] = error.into();
    }
    let _ = crate::services::audit::AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(import_user_id),
            action: "data_import",
            resource_type: "data_transfer",
            details: Some(details),
            ..Default::default()
        },
    )
    .await;
}

/// Parse the staged file inside the job and dispatch on its real format:
/// v1 keeps its legacy import path; v2/v3 share the structured engine with
/// the execute-time mode and conflict policy.
async fn execute_staged_import(
    pool: &DbPool,
    job_id: Uuid,
    path: &Path,
    request: &ImportExecuteRequest,
    import_user_id: i64,
) -> Result<ImportJobResult, ApiError> {
    let file_path = path.to_path_buf();
    let parsed = tokio::task::spawn_blocking(move || parse_staged_file(&file_path))
        .await
        .map_err(|error| ApiError::Internal(format!("backup parse task failed: {error}")))?
        .map_err(ApiError::BadRequest)?;

    match parsed {
        ParsedBackup::V1(data) => import_v1_backup(pool, *data, request, import_user_id).await,
        ParsedBackup::V2(file) => {
            if file.version != "2.0" {
                return Err(ApiError::BadRequest(format!(
                    "unsupported schema-driven export version '{}' — this build understands \"2.0\"",
                    file.version
                )));
            }
            let tables = file
                .tables
                .into_iter()
                .map(|(key, rows)| (key, BackupRows::Json(rows)))
                .collect();
            import_structured_backup(pool, job_id, import_user_id, request, tables).await
        }
        ParsedBackup::V3(file) => {
            if file.format != "hotel-backup" {
                return Err(ApiError::BadRequest(format!(
                    "unsupported backup format '{}'",
                    file.format
                )));
            }
            if file.version != 3 {
                return Err(ApiError::BadRequest(format!(
                    "unsupported hotel-backup version {} — this build understands version 3",
                    file.version
                )));
            }
            if file.kind != "business-data" {
                return Err(ApiError::BadRequest(format!(
                    "unsupported backup kind '{}'",
                    file.kind
                )));
            }
            let tables = file
                .tables
                .into_iter()
                .map(|(key, rows)| (key, BackupRows::Raw(rows)))
                .collect();
            import_structured_backup(pool, job_id, import_user_id, request, tables).await
        }
    }
}

/// A v1 file runs through the legacy importer untouched — same row policy,
/// same `ON CONFLICT DO NOTHING` semantics, just mapped onto the job result
/// shape afterwards.
async fn import_v1_backup(
    pool: &DbPool,
    data: BookingDataExport,
    request: &ImportExecuteRequest,
    import_user_id: i64,
) -> Result<ImportJobResult, ApiError> {
    let mode = match request.mode {
        BackupImportMode::Merge => ImportMode::Import,
        BackupImportMode::Restore => ImportMode::Overwrite,
    };
    let tables: Vec<String> = request
        .tables
        .iter()
        .map(|key| {
            key.strip_prefix("public.")
                .unwrap_or(key.as_str())
                .to_string()
        })
        .collect();

    let response = import_legacy_booking_data(pool, import_user_id, mode, data, tables).await?;

    let mut entities = Vec::new();
    let mut inserted = 0_u64;
    if let Some(counts) = response.get("records_imported").and_then(Value::as_object) {
        for (table, count) in counts {
            let count = count.as_u64().unwrap_or(0);
            inserted += count;
            entities.push(ImportEntityOutcome {
                entity: format!("public.{table}"),
                inserted: count,
                updated: 0,
                skipped: 0,
            });
        }
    }
    entities.sort_by(|left, right| left.entity.cmp(&right.entity));

    Ok(ImportJobResult {
        inserted,
        updated: 0,
        skipped: 0,
        report: ImportJobReport {
            entities,
            relationship_problems: Vec::new(),
            unsupported_entities: Vec::new(),
        },
    })
}

/// The shared v2/v3 import engine: clear (restore) then insert every selected
/// entity in FK-safe order inside one transaction, with the execute-time
/// conflict policy and the missing-reference policy applied per row.
async fn import_structured_backup(
    pool: &DbPool,
    job_id: Uuid,
    import_user_id: i64,
    request: &ImportExecuteRequest,
    file_tables: BTreeMap<String, BackupRows>,
) -> Result<ImportJobResult, ApiError> {
    let descriptors = DataTransferRepository::transfer_tables(pool).await?;
    let descriptor_by_name: HashMap<String, TransferTable> = descriptors
        .into_iter()
        .map(|descriptor| (descriptor.table.key(), descriptor))
        .collect();
    let dependencies: HashMap<String, HashSet<String>> = descriptor_by_name
        .iter()
        .map(|(name, descriptor)| (name.clone(), descriptor.dependencies.clone()))
        .collect();

    // The file decides what can import; anything else in `tables` is carried
    // into the report so nothing is silently dropped.
    let mut importable: BTreeMap<String, BackupRows> = BTreeMap::new();
    let mut unsupported_entities = Vec::new();
    for (key, rows) in file_tables {
        let known = QualifiedTable::parse(&key)
            .map(|_| is_transferable_key(&key) && descriptor_by_name.contains_key(&key))
            .unwrap_or(false);
        if known {
            importable.insert(key, rows);
        } else {
            unsupported_entities.push(key);
        }
    }

    let mut selected: HashSet<String> = if request.tables.is_empty() {
        importable.keys().cloned().collect()
    } else {
        request.tables.iter().cloned().collect()
    };
    for table in &selected {
        QualifiedTable::parse(table)?;
        if !is_transferable_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{table}' is not permitted: only the business-data table set can be imported"
            )));
        }
        if !importable.contains_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Selected transfer table '{table}' is missing from the import file"
            )));
        }
    }
    if request.mode == BackupImportMode::Restore {
        expand_full_overwrite_tables(&mut selected, &dependencies);
    }
    let selected_names: Vec<String> = selected.into_iter().collect();
    let order = transfer_order(&selected_names, &dependencies)?;
    let ordered_tables: Vec<TransferTable> = order
        .iter()
        .map(|name| {
            descriptor_by_name
                .get(name)
                .cloned()
                .expect("selected tables were validated against catalog")
        })
        .collect();

    let scan = MissingRefScan::build(
        pool,
        &ordered_tables
            .iter()
            .map(|table| table.table.clone())
            .collect::<Vec<_>>(),
        import_user_id,
    )
    .await?;

    let on_conflict = request.on_conflict.unwrap_or(ConflictPolicy::Skip);
    let total_rows: u64 = ordered_tables
        .iter()
        .filter_map(|table| importable.get(&table.table.key()))
        .map(|rows| rows.len() as u64)
        .sum();
    set_job_progress(job_id, None, 0, total_rows);

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    // The clear and the insert both walk a foreign-key cycle (`users` <->
    // `guests`), which no ordering can satisfy while the constraints are
    // checked per statement -- deleting `users` first strands
    // `guests.created_by`, and inserting it first strands `users.guest_id`.
    // Deferring to COMMIT is what makes either direction possible. This must
    // happen before the clear, not just before the inserts.
    let relaxed = DataTransferRepository::relax_foreign_keys(&mut tx, &ordered_tables).await?;
    DataTransferRepository::set_transfer_triggers(&mut tx, &ordered_tables, false).await?;

    // Every ALTER TABLE above has to happen before anything queues a deferred
    // trigger event, because PostgreSQL refuses to alter a table that has any
    // pending. Deferring only after the schema is settled keeps the clear and
    // the inserts inside the window where ordering does not matter.
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *tx)
        .await
        .map_err(ApiError::from)?;

    if request.mode == BackupImportMode::Restore {
        let clear_tables: Vec<_> = ordered_tables.iter().rev().cloned().collect();
        DataTransferRepository::clear_transfer_tables(&mut tx, &clear_tables).await?;
    }

    let mut report = ImportJobReport {
        entities: Vec::new(),
        relationship_problems: Vec::new(),
        unsupported_entities,
    };
    let mut problems: HashMap<(String, String, String), u64> = HashMap::new();
    let mut rows_applied = 0_u64;

    for table in &ordered_tables {
        let name = table.table.key();
        set_job_progress(job_id, Some(name.clone()), rows_applied, total_rows);
        let mut outcome = ImportEntityOutcome {
            entity: name.clone(),
            inserted: 0,
            updated: 0,
            skipped: 0,
        };
        // `remove` so the row loop owns the storage — selected tables that are
        // absent from the file (restore expands the selection to dependents)
        // still get a report row: they were cleared.
        let Some(rows) = importable.remove(&name) else {
            report.entities.push(outcome);
            continue;
        };

        for (index, object) in rows.into_objects(&name).enumerate() {
            let mut object = object.map_err(|error| row_error(&name, index, &error))?;
            if let Some((column, parent)) = scan.apply(&name, &mut object) {
                outcome.skipped += 1;
                *problems.entry((name.clone(), column, parent)).or_default() += 1;
            } else {
                match DataTransferRepository::insert_transfer_row(
                    &mut tx,
                    table,
                    &object,
                    on_conflict,
                )
                .await
                {
                    Ok(InsertRowOutcome::Inserted) => outcome.inserted += 1,
                    Ok(InsertRowOutcome::Updated) => outcome.updated += 1,
                    Ok(InsertRowOutcome::Skipped) => outcome.skipped += 1,
                    Err(error) => {
                        let _ = tx.rollback().await;
                        return Err(row_error(&name, index, &error));
                    }
                }
            }
            rows_applied += 1;
            if rows_applied.is_multiple_of(PROGRESS_UPDATE_EVERY) {
                set_job_progress(job_id, Some(name.clone()), rows_applied, total_rows);
            }
        }
        report.entities.push(outcome);
        set_job_progress(job_id, Some(name.clone()), rows_applied, total_rows);
    }

    // Deferred checks fire on COMMIT — validate them while the transaction is
    // still open so a violation reports as a clearable import error instead of
    // a bare COMMIT failure.
    sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            ApiError::BadRequest(format!(
                "Import failed a deferred foreign-key or check constraint: {error}. No changes were saved."
            ))
        })?;

    DataTransferRepository::set_transfer_triggers(&mut tx, &ordered_tables, true).await?;
    DataTransferRepository::restore_foreign_keys(&mut tx, &relaxed).await?;
    DataTransferRepository::reset_transfer_sequences(&mut tx, &ordered_tables).await?;
    tx.commit().await.map_err(ApiError::from)?;

    report.relationship_problems = problems
        .into_iter()
        .map(
            |((entity, column, parent), rows)| ImportRelationshipProblem {
                entity,
                rows,
                reason: relationship_problem_reason(&column, &parent),
            },
        )
        .collect();

    Ok(ImportJobResult {
        inserted: report.entities.iter().map(|entity| entity.inserted).sum(),
        updated: report.entities.iter().map(|entity| entity.updated).sum(),
        skipped: report.entities.iter().map(|entity| entity.skipped).sum(),
        report,
    })
}

/// Attach the entity and row position to an insert/parse failure — a bare
/// constraint name means nothing against a 256 MB file.
fn row_error(entity: &str, index: usize, error: &ApiError) -> ApiError {
    ApiError::BadRequest(format!(
        "Import failed for {entity} row {}: {}. No changes were saved.",
        index + 1,
        crate::services::data_transfer::import_error_detail(error)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_classifies_each_backup_shape() {
        assert_eq!(
            detect_backup_format(br#"{"format":"hotel-backup","version":3,"kind":"business-data""#),
            "v3"
        );
        // Whitespace/formatting must not change the verdict.
        assert_eq!(
            detect_backup_format(b"{ \"format\": \"hotel-backup\", \"version\": 3 }"),
            "v3"
        );
        assert_eq!(
            detect_backup_format(br#"{"version":"2.0","exported_at":"x","tables":{}}"#),
            "v2"
        );
        assert_eq!(
            detect_backup_format(br#"{"version":"1.0","guests":[]}"#),
            "v1"
        );
        // A v1-shaped body with no version still detects by its table fields.
        assert_eq!(detect_backup_format(br#"{"bookings":[]}"#), "v1");
        // "public.guests" in a v2 map must not trip the v1 `"guests"` sniff.
        assert_eq!(
            detect_backup_format(br#"{"version":"2.0","tables":{"public.guests":[]}}"#),
            "v2"
        );
        assert_eq!(detect_backup_format(br#"{"hello":"world"}"#), "unknown");
        assert_eq!(detect_backup_format(b""), "unknown");
    }

    fn scan_with(refs: Vec<DanglingRef>, existing: HashSet<String>) -> MissingRefScan {
        MissingRefScan {
            refs: HashMap::from([("public.child".to_string(), refs)]),
            existing: HashMap::from([("public.users".to_string(), existing)]),
            fallback_user_id: 42,
        }
    }

    #[test]
    fn missing_audit_user_remaps_to_importing_admin() {
        let scan = scan_with(
            vec![DanglingRef {
                column: "created_by".to_string(),
                parent_key: "public.users".to_string(),
                required: true,
                audit_remap: true,
            }],
            HashSet::from(["7".to_string()]),
        );
        let mut row = Map::from_iter([("created_by".to_string(), Value::Number(999.into()))]);
        assert_eq!(scan.apply("public.child", &mut row), None);
        assert_eq!(row["created_by"], Value::Number(42.into()));
    }

    #[test]
    fn missing_nullable_ref_becomes_null() {
        let scan = scan_with(
            vec![DanglingRef {
                column: "approver_id".to_string(),
                parent_key: "public.users".to_string(),
                required: false,
                audit_remap: false,
            }],
            HashSet::new(),
        );
        let mut row = Map::from_iter([("approver_id".to_string(), Value::Number(999.into()))]);
        assert_eq!(scan.apply("public.child", &mut row), None);
        assert_eq!(row["approver_id"], Value::Null);
    }

    #[test]
    fn missing_required_ref_skips_the_row() {
        let scan = scan_with(
            vec![DanglingRef {
                column: "role_id".to_string(),
                parent_key: "public.users".to_string(),
                required: true,
                audit_remap: false,
            }],
            HashSet::new(),
        );
        let mut row = Map::from_iter([("role_id".to_string(), Value::Number(999.into()))]);
        let skipped = scan.apply("public.child", &mut row);
        assert_eq!(
            skipped,
            Some(("role_id".to_string(), "public.users".to_string()))
        );
        // The preview's non-mutating pass reports the same fate.
        let (reason, rewrites) = scan.assess("public.child", &row);
        assert_eq!(
            reason,
            Some(("role_id".to_string(), "public.users".to_string()))
        );
        assert_eq!(rewrites, 0);
    }

    #[test]
    fn present_ref_is_left_alone() {
        let scan = scan_with(
            vec![DanglingRef {
                column: "created_by".to_string(),
                parent_key: "public.users".to_string(),
                required: true,
                audit_remap: false,
            }],
            HashSet::from(["9".to_string()]),
        );
        let mut row = Map::from_iter([("created_by".to_string(), Value::Number(9.into()))]);
        assert_eq!(scan.apply("public.child", &mut row), None);
        assert_eq!(row["created_by"], Value::Number(9.into()));
    }

    #[test]
    fn staged_file_parse_falls_through_format_order() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("data-transfer-parse-test-{}.json", Uuid::new_v4()));
        // Sniffs as v1 (guests field) but parses as v3 — the parse order must
        // land on the format that actually validates.
        let document = br#"{
            "format":"hotel-backup","version":3,"kind":"business-data",
            "exportId":"11111111-1111-1111-1111-111111111111",
            "exportedAt":"x","applicationVersion":"0","guests":[],
            "source":{"environment":"test","databaseProvider":"postgresql"},
            "manifest":{"entities":[],"exclusions":[]},
            "tables":{},
            "integrity":{"entities":0,"rows":0,"entityRows":{},"completedAt":"x"}
        }"#;
        fs::write(&path, document).expect("fixture writes");
        let parsed = parse_staged_file(&path).expect("v3 document parses");
        assert!(matches!(parsed, ParsedBackup::V3(_)));
        fs::remove_file(&path).ok();
    }

    #[test]
    fn staged_file_parse_rejects_unrecognized_documents() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("data-transfer-parse-test-{}.json", Uuid::new_v4()));
        fs::write(&path, b"[1,2,3]").expect("fixture writes");
        assert!(parse_staged_file(&path).is_err());
        fs::remove_file(&path).ok();
    }
}
