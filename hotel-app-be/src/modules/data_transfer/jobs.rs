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
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use axum::body::Body;
use futures_core::Stream;
use serde_json::value::RawValue;
use serde_json::{Map, Value};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use super::crypto::{DecryptingReader, is_encrypted_backup};
use super::repository::{
    DataTransferRepository, ForeignKeyRef, InsertRowOutcome, PkLookup, QualifiedTable,
    TransferTable, transfer_order,
};
use super::service::{
    AUDIT_USER_FK_COLUMNS, EXCLUDED_TABLES, TransferTier, backup_environment,
    expand_full_overwrite_tables, is_never_imported_key, is_transferable_key, protected_table_keys,
    table_is_sensitive,
};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    AuditEvent, BackupFile, BackupImportMode, ConflictPolicy, ImportEntityOutcome,
    ImportExecuteRequest, ImportExecuteResponse, ImportJobReport, ImportJobResult, ImportJobState,
    ImportJobStatus, ImportPreview, ImportPreviewEntity, ImportRelationshipProblem, JobProgress,
    UploadResponse,
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
    stage_backup_upload_to(body, &dir, MAX_UPLOAD_BYTES).await
}

/// The staging loop with its target directory and byte cap parameterized —
/// tests exercise the cap through this without buffering a real 256 MB body.
pub async fn stage_backup_upload_to(
    body: Body,
    dir: &Path,
    max_bytes: u64,
) -> Result<UploadResponse, StageUploadError> {
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|error| stage_internal("create staging dir", error))?;
    sweep_staged_uploads(dir);

    let upload_id = Uuid::new_v4();
    let part_path = staged_part_path(dir, upload_id);
    let json_path = staged_json_path(dir, upload_id);

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
            // Every received byte counts toward the cap BEFORE the whitespace
            // early-continue — an unbounded whitespace prefix must not bypass
            // the mid-stream limit.
            total += bytes.len() as u64;
            if total > max_bytes {
                return Err(StageUploadError::PayloadTooLarge);
            }
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
/// an unlink does not keep an open file readable. The registry check and the
/// unlink share one lock scope so `start_import_job`'s registration cannot
/// slip between them.
pub async fn delete_staged_upload(upload_id: Uuid) -> Result<(), ApiError> {
    let path = staged_upload_path(upload_id);
    let mut jobs = lock_registry();
    prune_finished_jobs(&mut jobs);
    if upload_has_running_job(&jobs, upload_id) {
        return Err(ApiError::Conflict(
            "a running import job is still reading this upload".to_string(),
        ));
    }
    match fs::remove_file(&path) {
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
/// and trust the parse, not this verdict. Retired export shapes (the legacy
/// v1/v2 documents and earlier `hotel-backup` versions) get the `"legacy"`
/// label only so the parse error can name what was uploaded.
pub fn detect_backup_format(prefix: &[u8]) -> &'static str {
    // An encrypted envelope is opaque past its magic — nothing about the
    // document inside is knowable until a passphrase opens it, so the sniff
    // reports the container and preview does the rest.
    if is_encrypted_backup(prefix) {
        return "encrypted";
    }
    let text = String::from_utf8_lossy(prefix);
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.contains("\"format\":\"hotel-backup\"") {
        // The retired v3 shape shares the format marker — flag it here so the
        // parse error can say "retired" instead of the generic version gate.
        // Anything else (missing/unknown versions) parses and the version
        // check names what it found.
        if compact.contains("\"version\":3") || compact.contains("\"version\":2") {
            "legacy"
        } else {
            "v1"
        }
    } else if (compact.contains("\"version\":\"2.0\"") && compact.contains("\"tables\":"))
        || compact.contains("\"version\":\"1.")
        || compact.contains("\"guests\":")
        || compact.contains("\"bookings\":")
        || compact.contains("\"companies\":")
    {
        "legacy"
    } else {
        "unknown"
    }
}

// ---------------------------------------------------------------------------
// Staged-file parsing
// ---------------------------------------------------------------------------

fn parse_reader<T: serde::de::DeserializeOwned>(
    path: &Path,
    passphrase: Option<&str>,
) -> Result<T, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut prefix = [0u8; ENVELOPE_SNIFF_BYTES];
    let read = read_prefix(&mut reader, &mut prefix)?;
    reader = reopen(path)?;
    if is_encrypted_backup(&prefix[..read]) {
        let passphrase = passphrase.ok_or_else(|| {
            "the upload is encrypted — supply the backup passphrase to read it".to_string()
        })?;
        let decrypting = DecryptingReader::new(reader, passphrase)?;
        return serde_json::from_reader(BufReader::new(decrypting))
            .map_err(|error| error.to_string());
    }
    serde_json::from_reader(reader).map_err(|error| error.to_string())
}

/// Bytes sniffed to decide whether a staged file is an encrypted envelope.
const ENVELOPE_SNIFF_BYTES: usize = 32;

fn read_prefix<R: Read>(reader: &mut R, buffer: &mut [u8]) -> Result<usize, String> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(count) => filled += count,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(filled)
}

fn reopen(path: &Path) -> Result<BufReader<fs::File>, String> {
    fs::File::open(path)
        .map(BufReader::new)
        .map_err(|error| error.to_string())
}

/// Parse a staged upload as the only supported document — a `hotel-backup`
/// file. Retired shapes get a named error; anything else fails the parse.
/// Runs inside `spawn_blocking`: a 256 MB parse must not sit on a runtime
/// worker.
fn parse_staged_file(path: &Path, passphrase: Option<&str>) -> Result<BackupFile, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut prefix = Vec::new();
    file.by_ref()
        .take(SNIFF_PREFIX_BYTES as u64)
        .read_to_end(&mut prefix)
        .map_err(|error| error.to_string())?;
    let encrypted = is_encrypted_backup(&prefix);
    if !encrypted && detect_backup_format(&prefix) == "legacy" {
        return Err("the file uses a retired export format (legacy v1/v2 or hotel-backup v3) — export a fresh backup from the source system and import that instead".to_string());
    }
    parse_reader::<BackupFile>(path, passphrase).map_err(|error| {
        // A decryption failure names a fixable cause (wrong passphrase, or a
        // damaged file); collapsing it into the generic "not a backup" text
        // would send an operator looking for the wrong problem.
        if encrypted {
            error
        } else {
            "the file is not a recognized hotel backup (expected a hotel-backup v1 document)"
                .to_string()
        }
    })
}

async fn read_staged_backup(
    upload_id: Uuid,
    passphrase: Option<String>,
) -> Result<BackupFile, ApiError> {
    let path = staged_upload_path(upload_id);
    if !path.exists() {
        return Err(ApiError::NotFound(
            "staged upload not found — the file may have expired or been consumed".to_string(),
        ));
    }
    tokio::task::spawn_blocking(move || parse_staged_file(&path, passphrase.as_deref()))
        .await
        .map_err(|error| ApiError::Internal(format!("backup parse task failed: {error}")))?
        .map_err(|error| {
            ApiError::BadRequest(format!("the staged upload could not be parsed: {error}"))
        })
}

/// Convert each raw row to a JSON object, one at a time — the laziness is
/// load-bearing: the file keeps rows as raw text (~1x file size) and only
/// the row currently being inspected or inserted ever becomes a `Map`.
fn rows_into_objects(
    rows: Vec<Box<RawValue>>,
    entity: &str,
) -> Box<dyn Iterator<Item = Result<Map<String, Value>, ApiError>> + Send> {
    let entity = entity.to_string();
    Box::new(rows.into_iter().enumerate().map(move |(index, raw)| {
        serde_json::from_str::<Map<String, Value>>(raw.get()).map_err(|error| {
            ApiError::BadRequest(format!(
                "{entity} row {} is not a JSON object: {error}",
                index + 1
            ))
        })
    }))
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
/// can carry ids the destination never had.
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

/// Raw scalar text for a JSON value — verbatim strings, unlike
/// [`ref_value_key`] which normalizes for cross-type comparison. The
/// single-column PK diff stores raw keys because the *schema* picks the
/// binding type: a `varchar` key column must compare `"007"` as `"007"`.
fn ref_value_raw(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => Some(number.to_string()),
        Value::String(text) => Some(text.clone()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
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
    /// Build the scan context for `children`. Also returns the foreign-key
    /// edges whose parents ARE transferable — the preview resolves those
    /// against the file's own rows and the destination so a key present in
    /// neither surfaces as a warning instead of only failing at commit; the
    /// job ignores them (they would have to fail that check anyway).
    async fn build(
        pool: &DbPool,
        children: &[QualifiedTable],
        fallback_user_id: i64,
        tier: TransferTier,
    ) -> Result<(Self, Vec<ForeignKeyRef>), ApiError> {
        let foreign_keys = DataTransferRepository::foreign_key_refs(pool, children).await?;
        let bare_names: Vec<&str> = children
            .iter()
            .filter(|child| child.schema == "public")
            .map(|child| child.name.as_str())
            .collect();
        let required_columns = DataTransferRepository::required_columns(pool, &bare_names).await?;

        let mut refs: HashMap<String, Vec<DanglingRef>> = HashMap::new();
        let mut parents: HashMap<String, (QualifiedTable, String)> = HashMap::new();
        let mut transferable_edges: Vec<ForeignKeyRef> = Vec::new();
        for fk in foreign_keys {
            // References between transferable tables are import ordering's
            // problem, not this scan's — those rows come with the file or
            // fail the deferred constraint check.
            if is_transferable_key(&fk.parent.key(), tier) {
                transferable_edges.push(fk);
                continue;
            }
            let ForeignKeyRef {
                child,
                column,
                parent,
                parent_column,
            } = fk;
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

        Ok((
            Self {
                refs,
                existing,
                fallback_user_id,
            },
            transferable_edges,
        ))
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

/// Reason text for a reference into a *transferable* parent whose key is in
/// neither the file nor the destination — the row inserts fine and the whole
/// job dies at the deferred-constraint check, so the preview must say so.
fn dangling_reference_reason(column: &str, parent_key: &str) -> String {
    format!(
        "{column} references {parent_key} keys that are in neither the file nor this database — the affected rows will fail at commit"
    )
}

/// Aggregated row count for one (entity, reason) reference problem — the
/// reason text already carries the column and parent.
type ProblemCounts = HashMap<(String, String), u64>;

/// Which [`PkLookup`] variant a single-column primary key binds as — decided
/// by the column's declared `udt_name`, never inferred from the file's value
/// shapes (a `varchar` key column holding all-numeric ids must still bind
/// `text[]`, or the `pk = ANY($1)` probe errors on the type mismatch).
enum PkBinding {
    Int,
    Uuid,
    Text,
}

impl PkBinding {
    fn for_udt(udt_name: Option<&str>) -> Self {
        match udt_name {
            Some("int2") | Some("int4") | Some("int8") => Self::Int,
            Some("uuid") => Self::Uuid,
            _ => Self::Text,
        }
    }

    /// Canonical text form matching what `existing_pk_values` returns for
    /// this binding — `None` drops keys that can never match (for example a
    /// non-numeric value against an `int8` key column counts as new).
    fn canonical(&self, raw: &str) -> Option<String> {
        match self {
            Self::Int => raw.parse::<i64>().ok().map(|value| value.to_string()),
            Self::Uuid => Uuid::parse_str(raw).ok().map(|value| value.to_string()),
            Self::Text => Some(raw.to_string()),
        }
    }

    fn lookup(&self, keys: &[String]) -> PkLookup {
        match self {
            Self::Int => PkLookup::Int(
                keys.iter()
                    .filter_map(|key| key.parse::<i64>().ok())
                    .collect(),
            ),
            Self::Uuid => PkLookup::Uuid(
                keys.iter()
                    .filter_map(|key| Uuid::parse_str(key).ok())
                    .collect(),
            ),
            Self::Text => PkLookup::Text(keys.to_vec()),
        }
    }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/// What a staged backup would do — the pre-flight diff behind
/// `POST /data-transfer/import/preview`.
pub async fn preview_import(
    pool: &DbPool,
    upload_id: Uuid,
    passphrase: Option<String>,
) -> Result<ImportPreview, ApiError> {
    let file = read_staged_backup(upload_id, passphrase.clone()).await?;
    let tier = staged_file_tier(upload_id, passphrase).await;
    preview_structured(pool, upload_id, file, tier).await
}

/// Diff the staged `hotel-backup` file against the destination.
async fn preview_structured(
    pool: &DbPool,
    upload_id: Uuid,
    file: BackupFile,
    tier: TransferTier,
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

    // Sensitivity is computed from the entity names actually present — the
    // declared flag can only ever RAISE it (a crafted file cannot downgrade
    // itself by writing `includesSensitiveData: false`).
    let sensitive = file.includes_sensitive_data == Some(true)
        || file.tables.keys().any(|key| table_is_sensitive(key));
    let export_type = file.export_type.clone();
    let mut preview = preview_table_map(
        pool,
        upload_id,
        FileHeader {
            format: "v1",
            version: Some(file.version),
            export_type,
            sensitive,
            exported_at: Some(file.exported_at.clone()),
            source_environment: Some(file.source.environment.clone()),
            application_version: Some(file.application_version.clone()),
        },
        file.tables,
        tier,
    )
    .await?;
    preview.warnings.extend(trailer_warnings);

    if file.format != "hotel-backup" {
        preview
            .validation_errors
            .push(format!("unsupported backup format '{}'", file.format));
    }
    if file.version != 1 {
        preview.validation_errors.push(format!(
            "unsupported hotel-backup version {} — this build understands version 1",
            file.version
        ));
    }
    if file.kind != "business-data" && file.kind != "full-system" {
        preview
            .validation_errors
            .push(format!("unsupported backup kind '{}'", file.kind));
    }
    // `includesSecrets` is expected on a full-system document and suspicious
    // on anything else, where no legitimate producer sets it.
    if file.includes_secrets == Some(true) && file.kind != "full-system" {
        preview.warnings.push(
            "the file declares it may contain secrets but is not a full-system backup — no legitimate export does this; inspect it before importing"
                .to_string(),
        );
    }
    if tier == TransferTier::System {
        preview.warnings.push(
            "this is a full-system backup: importing it replaces user accounts, passwords, RBAC grants and eKYC records in this database"
                .to_string(),
        );
    }
    Ok(preview)
}

/// Mutable accumulators the per-entity diff writes into — bundled so the
/// function signature stays readable.
struct PreviewAccum<'a> {
    /// `(entity, reason)` -> affected rows; the reason text carries the
    /// column and parent.
    relationship_problems: &'a mut ProblemCounts,
    /// References that would be rewritten (admin-remap or NULL).
    rewritten_refs: &'a mut u64,
    validation_errors: &'a mut Vec<String>,
    /// Entity key -> file columns whose values feed the parent-key pool.
    parent_columns: &'a HashMap<String, HashSet<String>>,
    /// Entity key -> its foreign keys whose parents are transferable.
    child_edges: &'a HashMap<String, Vec<ForeignKeyRef>>,
    /// `(parent entity, parent column)` -> key values the file itself
    /// provides across all of that entity's rows.
    file_parent_keys: &'a mut HashMap<(String, String), HashSet<String>>,
    /// `(child, column, parent, parent column)` -> referenced value -> rows.
    outgoing_refs: &'a mut HashMap<(String, String, String, String), HashMap<String, u64>>,
}

/// `new`/`existing`/`skipped` for one entity: collect each row's normalized
/// primary-key value, batch-match against the destination, and count rows
/// whose key is absent (or missing — a keyless row always inserts as new).
/// The missing-reference assessment and the parent-key/reference harvest
/// ride the same single pass.
async fn diff_entity_rows(
    pool: &DbPool,
    descriptor: &TransferTable,
    key: &str,
    rows: Vec<Box<RawValue>>,
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
    for object in rows_into_objects(rows, key) {
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
                .entry((
                    key.to_string(),
                    relationship_problem_reason(&column, &parent),
                ))
                .or_default() += 1;
        }
        // Harvest the key values this entity provides as a transferable
        // parent, and the references it makes into transferable parents —
        // resolved against the destination after every entity is scanned.
        if let Some(columns) = accum.parent_columns.get(key) {
            for column in columns {
                if let Some(value) = object.get(column).and_then(ref_value_key) {
                    accum
                        .file_parent_keys
                        .entry((key.to_string(), column.clone()))
                        .or_default()
                        .insert(value);
                }
            }
        }
        if let Some(edges) = accum.child_edges.get(key) {
            for edge in edges {
                if let Some(value) = object.get(&edge.column).and_then(ref_value_key) {
                    *accum
                        .outgoing_refs
                        .entry((
                            key.to_string(),
                            edge.column.clone(),
                            edge.parent.key(),
                            edge.parent_column.clone(),
                        ))
                        .or_default()
                        .entry(value)
                        .or_default() += 1;
                }
            }
        }
        match pk_columns.as_slice() {
            // Raw scalar text — the schema picks the binding type below, so
            // "007" on a varchar key column must not collapse to "7" here.
            [column] => single_keys.push(object.get(column).and_then(ref_value_raw)),
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
    if let [column] = pk_columns.as_slice() {
        // The binding type comes from the column's declared type — a varchar
        // primary key holding all-numeric ids must still bind `text[]`, or
        // the ANY() probe errors on the type mismatch.
        let binding = PkBinding::for_udt(
            DataTransferRepository::column_udt_name(pool, &descriptor.table, column)
                .await?
                .as_deref(),
        );
        let keys: Vec<String> = single_keys
            .iter()
            .flatten()
            .filter_map(|key| binding.canonical(key))
            .collect();
        let mut found: HashSet<String> = HashSet::new();
        for chunk in keys.chunks(PK_LOOKUP_BATCH) {
            found.extend(
                DataTransferRepository::existing_pk_values(
                    pool,
                    descriptor,
                    &binding.lookup(chunk),
                )
                .await?,
            );
        }
        existing = keys.iter().filter(|key| found.contains(*key)).count() as u64;
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

/// File-level header fields a `hotel-backup` document carries.
struct FileHeader<'a> {
    format: &'a str,
    version: Option<u32>,
    /// The export's declared breadth (`standard`/`full`/`backup`).
    export_type: Option<String>,
    /// Whether the file carries sensitive entities — computed from the
    /// parsed entity names (never trusting the declared flag alone).
    sensitive: bool,
    exported_at: Option<String>,
    source_environment: Option<String>,
    application_version: Option<String>,
}

/// The preview engine: classify each entity, diff the transferable ones, and
/// aggregate warnings, problems and totals.
async fn preview_table_map(
    pool: &DbPool,
    upload_id: Uuid,
    header: FileHeader<'_>,
    tables: BTreeMap<String, Vec<Box<RawValue>>>,
    tier: TransferTier,
) -> Result<ImportPreview, ApiError> {
    let descriptors = DataTransferRepository::transfer_tables(pool).await?;
    let descriptor_by_name: HashMap<String, TransferTable> = descriptors
        .into_iter()
        .map(|descriptor| (descriptor.table.key(), descriptor))
        .collect();
    let excluded_names: HashSet<&str> = EXCLUDED_TABLES.iter().map(|(name, _)| *name).collect();

    // Split the file's entity list up front so the reference scan only
    // inspects tables that will actually import.
    let mut transferable: Vec<(String, Vec<Box<RawValue>>)> = Vec::new();
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
        if is_never_imported_key(&key) {
            // Carried by the document for forensics, never applied. Reported
            // rather than dropped silently so the preview's row totals and
            // the operator's expectations still line up.
            warnings.push(format!(
                "'{key}' is present in the file and will not be imported — it records which schema patches the SOURCE database had applied, and restoring it here would make this database misreport its own schema"
            ));
            continue;
        }
        if is_transferable_key(&key, tier) {
            if descriptor_by_name.contains_key(&key) {
                transferable.push((key, rows));
            } else {
                // Cannot happen while the catalog mirrors the transferable
                // list, but never silently drop an entity.
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
    let (scan, transferable_edges) = MissingRefScan::build(pool, &children, 0, tier).await?;

    // References between transferable tables resolve against the file's own
    // rows first and the destination second — a referenced key present in
    // neither survives every insert and detonates at the job's deferred
    // foreign-key check, so the preview must report it while the file can
    // still be fixed.
    let mut child_edges: HashMap<String, Vec<ForeignKeyRef>> = HashMap::new();
    let mut parent_columns: HashMap<String, HashSet<String>> = HashMap::new();
    for edge in transferable_edges {
        parent_columns
            .entry(edge.parent.key())
            .or_default()
            .insert(edge.parent_column.clone());
        child_edges.entry(edge.child.key()).or_default().push(edge);
    }

    let mut entities = Vec::new();
    let mut relationship_problems: ProblemCounts = HashMap::new();
    let mut rewritten_refs = 0_u64;
    let mut file_parent_keys: HashMap<(String, String), HashSet<String>> = HashMap::new();
    let mut outgoing_refs: HashMap<(String, String, String, String), HashMap<String, u64>> =
        HashMap::new();
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
            parent_columns: &parent_columns,
            child_edges: &child_edges,
            file_parent_keys: &mut file_parent_keys,
            outgoing_refs: &mut outgoing_refs,
        };
        diff_entity_rows(pool, descriptor, &key, rows, &scan, &mut entity, &mut accum).await?;
        entities.push(entity);
    }

    // Every entity's keys are harvested now — resolve the transferable-parent
    // references collected above against file-then-database, and report the
    // rows that would fail at commit.
    let mut unresolved_ref_rows = 0_u64;
    for (child_key, edges) in &child_edges {
        for edge in edges {
            let Some(counts) = outgoing_refs.get(&(
                child_key.clone(),
                edge.column.clone(),
                edge.parent.key(),
                edge.parent_column.clone(),
            )) else {
                continue;
            };
            let provided = file_parent_keys.get(&(edge.parent.key(), edge.parent_column.clone()));
            let candidates: Vec<String> = counts
                .keys()
                .filter(|value| !provided.is_some_and(|keys| keys.contains(*value)))
                .cloned()
                .collect();
            if candidates.is_empty() {
                continue;
            }
            // Composite foreign keys are checked column-wise — that can
            // under-report (two columns satisfied by different parent rows),
            // but never invents a problem; the commit-time check stays the
            // backstop either way.
            let mut dangling_rows = 0_u64;
            for chunk in candidates.chunks(PK_LOOKUP_BATCH) {
                let found = DataTransferRepository::existing_values_any(
                    pool,
                    &edge.parent,
                    &edge.parent_column,
                    chunk,
                )
                .await?;
                for value in chunk {
                    if !found.contains(value) {
                        dangling_rows += counts[value];
                    }
                }
            }
            if dangling_rows > 0 {
                unresolved_ref_rows += dangling_rows;
                *relationship_problems
                    .entry((
                        child_key.clone(),
                        dangling_reference_reason(&edge.column, &edge.parent.key()),
                    ))
                    .or_default() += dangling_rows;
            }
        }
    }
    if unresolved_ref_rows > 0 {
        warnings.push(format!(
            "{unresolved_ref_rows} row(s) reference keys that are in neither the file nor this database — the import will fail at commit"
        ));
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

    let mut relationship_problems: Vec<ImportRelationshipProblem> = relationship_problems
        .into_iter()
        .map(|((entity, reason), rows)| ImportRelationshipProblem {
            entity,
            rows,
            reason,
        })
        .collect();
    relationship_problems.sort_by(|left, right| {
        left.entity
            .cmp(&right.entity)
            .then(left.reason.cmp(&right.reason))
    });

    let mut requires_permissions = Vec::new();
    if header.sensitive {
        requires_permissions.push("data_transfer:import_sensitive".to_string());
    }

    Ok(ImportPreview {
        upload_id,
        format: header.format.to_string(),
        version: header.version,
        export_type: header.export_type,
        sensitive: header.sensitive,
        requires_permissions,
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

fn upload_has_running_job(jobs: &HashMap<Uuid, ImportJobEntry>, upload_id: Uuid) -> bool {
    jobs.values()
        .any(|job| job.upload_id == upload_id && job.status == ImportJobState::Running)
}

/// Why an upload could not be claimed for a new job.
enum RegisterJobError {
    /// A running job already claims this upload.
    Busy,
    /// No staged file exists for this upload id.
    Missing,
}

/// Atomically verify the staged file exists and no running job claims the
/// upload, then register the new job — all inside ONE lock acquisition.
/// Two concurrent `execute` calls on the same upload can no longer each
/// observe "not running" before the other's insert, and a `DELETE` can no
/// longer unlink the file between the existence check and the registration
/// because `delete_staged_upload` holds this same lock while it unlinks.
fn try_register_job(upload_id: Uuid) -> Result<Uuid, RegisterJobError> {
    let mut jobs = lock_registry();
    prune_finished_jobs(&mut jobs);
    if upload_has_running_job(&jobs, upload_id) {
        return Err(RegisterJobError::Busy);
    }
    if !staged_upload_path(upload_id).exists() {
        return Err(RegisterJobError::Missing);
    }
    let job_id = Uuid::new_v4();
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
    Ok(job_id)
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
/// Needle scanned for in a staged file: `"public.<sensitive-table>"` as a
/// JSON key. Row *values* containing the same text produce a false positive —
/// the file is then treated as sensitive, which fails closed.
const ENTITY_KEY_PREFIX: &[u8] = b"\"public.";
/// The header flag — matched loosely (the value is checked separately).
const SENSITIVE_FLAG_KEY: &[u8] = b"\"includesSensitiveData\"";

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Whether the staged file carries sensitive content — decides if execute
/// needs `data_transfer:import_sensitive` without paying for a full parse.
///
/// A `hotel-backup` file is sensitive when the header declares it or any
/// `"public.<name>"` entity key names a [`SENSITIVE_TABLES`] entry. Legacy
/// files always carried guest data, and anything unrecognizable fails closed.
fn staged_file_is_sensitive_sync(path: &Path, passphrase: Option<&str>) -> bool {
    let Some(bytes) = staged_plaintext(path, passphrase) else {
        // Unreadable files fail closed; execute surfaces the real error later.
        return true;
    };
    let head = &bytes[..bytes.len().min(SNIFF_PREFIX_BYTES)];
    if detect_backup_format(head) != "v1" {
        return true;
    }

    // `"includesSensitiveData": true` — whitespace between key/colon/value is
    // tolerated so pretty-printed foreign files are still caught.
    if let Some(index) = find_subslice(&bytes, SENSITIVE_FLAG_KEY) {
        let mut cursor = index + SENSITIVE_FLAG_KEY.len();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor < bytes.len() && bytes[cursor] == b':' {
            cursor += 1;
            while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            if bytes[cursor..].starts_with(b"true") {
                return true;
            }
        }
    }

    let mut cursor = 0_usize;
    while let Some(found) = find_subslice(&bytes[cursor..], ENTITY_KEY_PREFIX) {
        let name_start = cursor + found + ENTITY_KEY_PREFIX.len();
        let name_end = bytes[name_start..]
            .iter()
            .position(|byte| *byte == b'"')
            .map(|offset| name_start + offset)
            .unwrap_or(bytes.len());
        if let Ok(name) = std::str::from_utf8(&bytes[name_start..name_end])
            && table_is_sensitive(name)
        {
            return true;
        }
        cursor = name_start;
    }
    false
}

async fn staged_file_is_sensitive(upload_id: Uuid, passphrase: Option<String>) -> bool {
    let path = staged_upload_path(upload_id);
    if !path.exists() {
        // Missing uploads fail closed; execute reports NotFound separately.
        return true;
    }
    tokio::task::spawn_blocking(move || staged_file_is_sensitive_sync(&path, passphrase.as_deref()))
        .await
        .unwrap_or(true)
}

/// The staged document as plaintext bytes, decrypting first when the file is
/// an encrypted envelope. `None` means it could not be read at all, which
/// every caller treats as "fail closed".
///
/// This materializes the document, matching what the plaintext sniff has
/// always done; the 256 MB upload cap is what bounds it.
fn staged_plaintext(path: &Path, passphrase: Option<&str>) -> Option<Vec<u8>> {
    let mut file = fs::File::open(path).ok()?;
    let mut prefix = [0u8; ENVELOPE_SNIFF_BYTES];
    let read = read_prefix(&mut file, &mut prefix).ok()?;
    if !is_encrypted_backup(&prefix[..read]) {
        return fs::read(path).ok();
    }
    let reader = reopen(path).ok()?;
    let mut decrypting = DecryptingReader::new(reader, passphrase?).ok()?;
    let mut plain = Vec::new();
    decrypting.read_to_end(&mut plain).ok()?;
    Some(plain)
}

/// Which tier a staged file demands, decided by what it actually contains
/// rather than by the `exportType` it declares — a hand-edited header must
/// not be able to smuggle `public.users` in under a `full` label.
///
/// Fails closed: anything unreadable is treated as a system file so the
/// stricter gate applies and execute reports the real error later.
fn staged_file_tier_sync(path: &Path, passphrase: Option<&str>) -> TransferTier {
    let Some(bytes) = staged_plaintext(path, passphrase) else {
        return TransferTier::System;
    };
    let protected: Vec<String> = protected_table_keys();
    for key in protected {
        let needle = format!("\"{key}\"");
        if find_subslice(&bytes, needle.as_bytes()).is_some() {
            return TransferTier::System;
        }
    }
    TransferTier::Business
}

async fn staged_file_tier(upload_id: Uuid, passphrase: Option<String>) -> TransferTier {
    let path = staged_upload_path(upload_id);
    if !path.exists() {
        return TransferTier::System;
    }
    tokio::task::spawn_blocking(move || staged_file_tier_sync(&path, passphrase.as_deref()))
        .await
        .unwrap_or(TransferTier::System)
}

/// The permission checks that depend on the file and the requested mode —
/// layered on top of the route's `data_transfer:import` guard:
///
/// - sensitive file contents → `data_transfer:import_sensitive`
/// - `onConflict: "update"` → `data_transfer:override`
/// - `mode: "restore"` → `data_transfer:restore` **and** a fresh step-up token
///
/// Every denial is a 403 naming the missing permission, except step-up which
/// is a 401 — the standard "re-authenticate" signal.
pub async fn enforce_import_permissions(
    pool: &DbPool,
    user_id: i64,
    headers: &axum::http::HeaderMap,
    request: &ImportExecuteRequest,
) -> Result<(), ApiError> {
    if staged_file_is_sensitive(request.upload_id, request.passphrase.clone()).await {
        crate::core::middleware::check_permission(pool, user_id, "data_transfer:import_sensitive")
            .await?;
    }
    // A file carrying the protected set can rewrite who can log in and what
    // they may do, so it clears the same bar as producing one: super admin
    // plus step-up re-authentication, on top of the import permissions.
    if staged_file_tier(request.upload_id, request.passphrase.clone()).await == TransferTier::System
    {
        crate::core::middleware::ensure_super_admin(pool, user_id).await?;
        let claims = crate::core::middleware::extract_claims(headers).await?;
        super::step_up::require_step_up(headers, &claims)?;
    }
    if request.on_conflict == Some(ConflictPolicy::Update) {
        crate::core::middleware::check_permission(pool, user_id, "data_transfer:override").await?;
    }
    if request.mode == BackupImportMode::Restore {
        crate::core::middleware::check_permission(pool, user_id, "data_transfer:restore").await?;
        let claims = crate::core::middleware::extract_claims(headers).await?;
        super::step_up::require_step_up(headers, &claims)?;
    }
    Ok(())
}

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
    // Resolved from the file's own contents, then reused for the job — the
    // permission gate in `enforce_import_permissions` ran against the same
    // classification, so the two cannot disagree.
    let tier = staged_file_tier(request.upload_id, request.passphrase.clone()).await;
    for table in &request.tables {
        QualifiedTable::parse(table)?;
        if is_never_imported_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{table}' cannot be imported: it records which schema patches the source database had applied, and restoring it would make this database misreport its own schema"
            )));
        }
        if !is_transferable_key(table, tier) {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{table}' is not permitted for this file's table set"
            )));
        }
    }

    let path = staged_upload_path(request.upload_id);
    let job_id = match try_register_job(request.upload_id) {
        Ok(job_id) => job_id,
        Err(RegisterJobError::Busy) => {
            return Err(ApiError::Conflict(
                "an import job is already running for this upload".to_string(),
            ));
        }
        Err(RegisterJobError::Missing) => {
            return Err(ApiError::NotFound(
                "staged upload not found — the file may have expired or been consumed".to_string(),
            ));
        }
    };

    let job_pool = pool.clone();
    let job_path = path.clone();
    let job_request = request;
    tokio::spawn(async move {
        run_import_job(
            job_pool,
            job_id,
            job_path,
            job_request,
            import_user_id,
            tier,
        )
        .await;
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
    tier: TransferTier,
) {
    let started = Instant::now();
    audit_import_event(&pool, import_user_id, job_id, &request, "start", None, None).await;

    let outcome = execute_staged_import(&pool, job_id, &path, &request, import_user_id, tier).await;

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

/// Parse the staged file inside the job, validate the `hotel-backup` header,
/// then hand the raw row maps to the import engine with the execute-time
/// mode and conflict policy.
async fn execute_staged_import(
    pool: &DbPool,
    job_id: Uuid,
    path: &Path,
    request: &ImportExecuteRequest,
    import_user_id: i64,
    tier: TransferTier,
) -> Result<ImportJobResult, ApiError> {
    let file_path = path.to_path_buf();
    let passphrase = request.passphrase.clone();
    let file =
        tokio::task::spawn_blocking(move || parse_staged_file(&file_path, passphrase.as_deref()))
            .await
            .map_err(|error| ApiError::Internal(format!("backup parse task failed: {error}")))?
            .map_err(ApiError::BadRequest)?;

    if file.format != "hotel-backup" {
        return Err(ApiError::BadRequest(format!(
            "unsupported backup format '{}'",
            file.format
        )));
    }
    if file.version != 1 {
        return Err(ApiError::BadRequest(format!(
            "unsupported hotel-backup version {} — this build understands version 1",
            file.version
        )));
    }
    if file.kind != "business-data" && file.kind != "full-system" {
        return Err(ApiError::BadRequest(format!(
            "unsupported backup kind '{}'",
            file.kind
        )));
    }
    import_structured_backup(pool, job_id, import_user_id, tier, request, file.tables).await
}

/// The import engine: clear (restore) then insert every selected entity in
/// FK-safe order inside one transaction, with the execute-time conflict
/// policy and the missing-reference policy applied per row.
async fn import_structured_backup(
    pool: &DbPool,
    job_id: Uuid,
    import_user_id: i64,
    tier: TransferTier,
    request: &ImportExecuteRequest,
    file_tables: BTreeMap<String, Vec<Box<RawValue>>>,
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
    let mut importable: BTreeMap<String, Vec<Box<RawValue>>> = BTreeMap::new();
    let mut unsupported_entities = Vec::new();
    for (key, rows) in file_tables {
        let known = QualifiedTable::parse(&key)
            .map(|_| {
                !is_never_imported_key(&key)
                    && is_transferable_key(&key, tier)
                    && descriptor_by_name.contains_key(&key)
            })
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
        if !is_transferable_key(table, tier) {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{table}' is not permitted for this file's table set"
            )));
        }
        if !importable.contains_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Selected transfer table '{table}' is missing from the import file"
            )));
        }
    }
    if request.mode == BackupImportMode::Restore {
        expand_full_overwrite_tables(&mut selected, &dependencies, tier);
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

    // Transferable-parent edges are the preview's concern — here a truly
    // dangling one fails the deferred-constraint check below, which is the
    // correct outcome for the job.
    let (scan, _transferable_edges) = MissingRefScan::build(
        pool,
        &ordered_tables
            .iter()
            .map(|table| table.table.clone())
            .collect::<Vec<_>>(),
        import_user_id,
        tier,
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
    let mut problems: ProblemCounts = HashMap::new();
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

        for (index, object) in rows_into_objects(rows, &name).enumerate() {
            let mut object = object.map_err(|error| row_error(&name, index, &error))?;
            if let Some((column, parent)) = scan.apply(&name, &mut object) {
                outcome.skipped += 1;
                *problems
                    .entry((name.clone(), relationship_problem_reason(&column, &parent)))
                    .or_default() += 1;
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

    // A restore can rewrite RBAC grants and settings rows wholesale; converge
    // every replica's caches now rather than leaving them stale for the TTL.
    crate::core::rbac_cache::invalidate_all(pool).await;
    crate::core::settings_cache::invalidate_all(pool).await;

    report.relationship_problems = problems
        .into_iter()
        .map(|((entity, reason), rows)| ImportRelationshipProblem {
            entity,
            rows,
            reason,
        })
        .collect();
    report.relationship_problems.sort_by(|left, right| {
        left.entity
            .cmp(&right.entity)
            .then(left.reason.cmp(&right.reason))
    });

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
        super::service::import_error_detail(error)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_classifies_each_backup_shape() {
        assert_eq!(
            detect_backup_format(br#"{"format":"hotel-backup","version":1,"kind":"business-data""#),
            "v1"
        );
        // Whitespace/formatting must not change the verdict.
        assert_eq!(
            detect_backup_format(b"{ \"format\": \"hotel-backup\", \"version\": 1 }"),
            "v1"
        );
        // Retired shapes are flagged as legacy so the parse error can name
        // them: schema-driven "2.0" exports, the flat booking export, and the
        // retired hotel-backup v3 document all land here.
        assert_eq!(
            detect_backup_format(br#"{"format":"hotel-backup","version":3,"kind":"business-data""#),
            "legacy"
        );
        assert_eq!(
            detect_backup_format(br#"{"version":"2.0","exported_at":"x","tables":{}}"#),
            "legacy"
        );
        assert_eq!(
            detect_backup_format(br#"{"version":"1.0","guests":[]}"#),
            "legacy"
        );
        // A legacy v1-shaped body with no version still detects by its table
        // fields.
        assert_eq!(detect_backup_format(br#"{"bookings":[]}"#), "legacy");
        // "public.guests" in a tables map must not trip the legacy `"guests"`
        // sniff — but it is still a "2.0" export, hence legacy.
        assert_eq!(
            detect_backup_format(br#"{"version":"2.0","tables":{"public.guests":[]}}"#),
            "legacy"
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
    fn staged_file_parse_accepts_a_v1_document_and_tolerates_unknown_fields() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("data-transfer-parse-test-{}.json", Uuid::new_v4()));
        // A document carrying fields this build does not know (like the stray
        // `guests` key) must still parse — forward compatibility means newer
        // fields never block an import.
        let document = br#"{
            "format":"hotel-backup","version":1,"kind":"business-data",
            "exportId":"11111111-1111-1111-1111-111111111111",
            "exportedAt":"x","applicationVersion":"0","guests":[],
            "source":{"environment":"test","databaseProvider":"postgresql"},
            "manifest":{"entities":[],"exclusions":[]},
            "tables":{},
            "integrity":{"entities":0,"rows":0,"entityRows":{},"completedAt":"x"}
        }"#;
        fs::write(&path, document).expect("fixture writes");
        let parsed = parse_staged_file(&path, None).expect("v1 document parses");
        assert_eq!(parsed.version, 1);
        fs::remove_file(&path).ok();
    }

    #[test]
    fn staged_file_parse_rejects_a_legacy_document_with_a_named_error() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("data-transfer-parse-test-{}.json", Uuid::new_v4()));
        fs::write(&path, br#"{"version":"2.0","exported_at":"x","tables":{}}"#)
            .expect("fixture writes");
        let error = parse_staged_file(&path, None).expect_err("legacy files must be rejected");
        assert!(
            error.contains("retired export format"),
            "the error must name the legacy format: {error}"
        );
        fs::remove_file(&path).ok();
    }

    #[test]
    fn pk_binding_comes_from_the_column_type() {
        // The binding is chosen by the declared udt_name, never by the file's
        // value shapes — an all-numeric id set on a varchar key column still
        // binds text[] (a bigint[] bind fails the ANY() probe).
        assert!(matches!(PkBinding::for_udt(Some("int2")), PkBinding::Int));
        assert!(matches!(PkBinding::for_udt(Some("int4")), PkBinding::Int));
        assert!(matches!(PkBinding::for_udt(Some("int8")), PkBinding::Int));
        assert!(matches!(PkBinding::for_udt(Some("uuid")), PkBinding::Uuid));
        assert!(matches!(
            PkBinding::for_udt(Some("varchar")),
            PkBinding::Text
        ));
        assert!(matches!(PkBinding::for_udt(Some("text")), PkBinding::Text));
        assert!(matches!(PkBinding::for_udt(None), PkBinding::Text));
        // Canonical form: ints normalize ("007" -> 7), text compares verbatim.
        assert_eq!(PkBinding::Int.canonical("007").as_deref(), Some("7"));
        assert_eq!(PkBinding::Text.canonical("007").as_deref(), Some("007"));
        assert_eq!(PkBinding::Int.canonical("abc"), None);
    }

    #[test]
    fn upload_cap_is_256_mib() {
        // The documented backup ceiling — `DefaultBodyLimit::max(...)` on the
        // route and every "how large can a backup be" answer agree on this
        // number. Pinned as a bare literal so changing the constant forces
        // this test to be edited deliberately.
        assert_eq!(MAX_UPLOAD_BYTES, 268_435_456);
    }

    #[tokio::test]
    async fn oversize_mid_stream_is_rejected_and_leaves_no_files() {
        let dir = std::env::temp_dir().join(format!("dt-cap-mid-{}", Uuid::new_v4()));
        // A body that only crosses the cap in its second chunk — the running
        // byte count must trip mid-stream, not just on a Content-Length or a
        // single oversized first chunk.
        let stream = async_stream::stream! {
            yield Ok::<_, std::io::Error>(vec![b' '; 768]);
            yield Ok::<_, std::io::Error>(vec![b' '; 768]);
        };
        let rejected = stage_backup_upload_to(Body::from_stream(stream), &dir, 1024).await;
        assert!(matches!(rejected, Err(StageUploadError::PayloadTooLarge)));
        // The aborted `.part` file is removed — nothing partial stays behind
        // for the sweep to find.
        let leftovers = fs::read_dir(&dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);
        assert!(!leftovers, "an aborted upload must not leave staging files");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn whitespace_prefix_still_counts_against_the_upload_cap() {
        let dir = std::env::temp_dir().join(format!("dt-cap-test-{}", Uuid::new_v4()));
        // 4 KiB of pure whitespace against a 1 KiB cap: all-whitespace chunks
        // used to `continue` before their bytes were counted, so an unbounded
        // whitespace prefix bypassed the mid-stream limit entirely.
        let rejected = stage_backup_upload_to(Body::from(vec![b' '; 4096]), &dir, 1024).await;
        assert!(matches!(rejected, Err(StageUploadError::PayloadTooLarge)));

        // Whitespace inside the cap is measured, not rejected — a small
        // whitespace-prefixed document still stages and sniffs.
        let mut document = vec![b' '; 512];
        document.extend_from_slice(br#"{"bookings":[]}"#);
        let staged = stage_backup_upload_to(Body::from(document), &dir, 1024)
            .await
            .expect("a small whitespace-prefixed JSON document still stages");
        assert_eq!(staged.detected_format, "legacy");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn staged_file_parse_rejects_unrecognized_documents() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("data-transfer-parse-test-{}.json", Uuid::new_v4()));
        fs::write(&path, b"[1,2,3]").expect("fixture writes");
        assert!(parse_staged_file(&path, None).is_err());
        fs::remove_file(&path).ok();
    }
}
