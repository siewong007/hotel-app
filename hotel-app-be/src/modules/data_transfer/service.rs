//! Data-transfer workflows

use std::collections::{BTreeMap, HashMap, HashSet};

use axum::body::{Body, Bytes};
use uuid::Uuid;

use crate::core::config::Environment;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    BackupEntityDescriptor, BackupExclusion, BackupIntegrity, BackupManifest, BackupRelationship,
    BackupSource, ExportPreview, ExportScope, TransferTablePreview,
};
use super::repository::{
    DataTransferRepository, QualifiedTable, TransferTable,
};

/// Every transferable table in foreign-key-safe **insert** order (parents
/// before children). Clearing for restore walks this in reverse. This is the
/// single source of truth — the export entity set, the import allowlist, and
/// column introspection all derive from it; the import's actual order comes
/// from `transfer_order` over live FK metadata.
pub const TABLE_INSERT_ORDER: &[&str] = &[
    // configuration / roots
    "amenities",
    "booking_channels",
    "companies",
    "corporate_accounts",
    "corporate_account_contacts",
    "email_templates",
    "guests",
    // guest-derived configuration, consent and notification state — all of
    // these reference `guests` (or nothing transferable) and the notification
    // tables' only other parent, `users`, is excluded.
    "guest_segments",
    "email_suppressions",
    "notification_subscriptions",
    "notification_consent_events",
    "staff_notifications",
    "staff_notification_reads",
    "promotions",
    "vouchers",
    "promotion_channels",
    // campaigns reference `promotions` and `guest_segments` (RESTRICT) plus
    // `email_templates`, so it cannot sit any earlier.
    "email_campaigns",
    "guest_documents",
    "guest_notes",
    "guest_preferences",
    "loyalty_programs",
    "loyalty_program_rules",
    "loyalty_tiers",
    "promotion_loyalty_tiers",
    "loyalty_memberships",
    "loyalty_members",
    "loyalty_accounts",
    "loyalty_rewards",
    "night_audit_runs",
    "night_audit_details",
    "points_transactions",
    "rate_plans",
    "reward_catalog",
    "room_status_transitions",
    "room_types",
    "promotion_room_types",
    "online_inventory_allocations",
    "guest_complimentary_credits",
    "room_rates",
    "room_type_amenities",
    "rooms",
    "room_events",
    "bookings",
    "voucher_redemptions",
    "voucher_redemption_allocations",
    "booking_guests",
    "booking_history",
    "booking_modifications",
    // support threads reference `guests` (RESTRICT) and `bookings`;
    // consent_records reference `guests`/`bookings`/`users`.
    "support_conversations",
    "support_messages",
    "support_events",
    "consent_records",
    "customer_ledgers",
    "customer_ledger_payments",
    "guest_reviews",
    "housekeeping_tasks",
    "invoices",
    "maintenance_tickets",
    "night_audit_posted_nights",
    "payments",
    "payment_receipt_requests",
    "loyalty_transactions",
    "reward_redemptions",
    "loyalty_redemptions",
    "room_changes",
    "room_history",
    "room_status_change_log",
    "self_checkin_events",
    "services",
    "booking_services",
    "system_settings",
    // teams reference `users` (excluded) only; members/roles hang off `teams`.
    "teams",
    "team_members",
    "team_roles",
    "user_guests",
];

/// Transferable tables carrying sensitive business data — guest PII,
/// financial movements, staff records, and operational history. Everything
/// in [`TABLE_INSERT_ORDER`] not listed here is configuration/reference data
/// that a `standard` export may emit; anything listed here requires the
/// `full`/`backup` scopes (and `data_transfer:export_sensitive`).
///
/// The list is deliberately explicit rather than derived from name prefixes:
/// classification is a per-table decision, and an explicit list fails loudly
/// (via the subset test) when a new transferable table is added without a
/// sensitivity call being made.
pub const SENSITIVE_TABLES: &[&str] = &[
    // guest identity, contact, and derived state
    "guests",
    "guest_segments",
    "guest_documents",
    "guest_notes",
    "guest_preferences",
    "guest_complimentary_credits",
    "guest_reviews",
    "user_guests",
    "email_suppressions",
    "consent_records",
    // corporate billing accounts and their contacts
    "companies",
    "corporate_accounts",
    "corporate_account_contacts",
    // bookings and everything hanging off them
    "bookings",
    "booking_guests",
    "booking_history",
    "booking_modifications",
    "booking_services",
    "self_checkin_events",
    // payments, ledgers, invoicing
    "payments",
    "payment_receipt_requests",
    "invoices",
    "customer_ledgers",
    "customer_ledger_payments",
    "voucher_redemptions",
    "voucher_redemption_allocations",
    // loyalty accounts and movement history
    "loyalty_memberships",
    "loyalty_members",
    "loyalty_accounts",
    "loyalty_transactions",
    "loyalty_redemptions",
    "reward_redemptions",
    "points_transactions",
    // operational history and staff-linked records
    "housekeeping_tasks",
    "maintenance_tickets",
    "night_audit_runs",
    "night_audit_details",
    "night_audit_posted_nights",
    "room_events",
    "room_changes",
    "room_history",
    "room_status_change_log",
    "support_conversations",
    "support_messages",
    "support_events",
    "teams",
    "team_members",
    // notification and marketing send state tied to people
    "notification_subscriptions",
    "notification_consent_events",
    "staff_notifications",
    "staff_notification_reads",
    "email_campaigns",
    "online_inventory_allocations",
];

/// Whether a qualified (`public.guests`) or bare (`guests`) table name is in
/// [`SENSITIVE_TABLES`].
pub fn table_is_sensitive(name_or_key: &str) -> bool {
    let bare = name_or_key.rsplit('.').next().unwrap_or(name_or_key);
    SENSITIVE_TABLES.contains(&bare)
}

/// Schema tables that must never cross the export/import boundary, as
/// `name → reason` pairs. This is the source of truth for the manifest's
/// `exclusions` list: every table `transfer_tables()` can see that is not in
/// [`TABLE_INSERT_ORDER`] must appear here — nothing is silently omitted.
///
/// Reason codes:
/// - `credentials_and_auth_state` — password hashes, TOTP seeds, RBAC grants.
/// - `session_or_token_material` — live sessions and token/challenge state.
/// - `sensitive_ekyc_pii` — identity documents and biometric evidence.
/// - `ephemeral_queue_state` — live send/request queues; re-import replays them.
/// - `internal_system_table` — platform bookkeeping, not business data.
pub const EXCLUDED_TABLES: &[(&str, &str)] = &[
    ("public.users", "credentials_and_auth_state"),
    ("public.roles", "credentials_and_auth_state"),
    ("public.permissions", "credentials_and_auth_state"),
    ("public.role_permissions", "credentials_and_auth_state"),
    ("public.user_roles", "credentials_and_auth_state"),
    ("public.user_permissions", "credentials_and_auth_state"),
    ("public.route_access_policies", "credentials_and_auth_state"),
    ("public.refresh_tokens", "session_or_token_material"),
    ("public.user_sessions", "session_or_token_material"),
    ("public.passkeys", "session_or_token_material"),
    ("public.passkey_challenges", "session_or_token_material"),
    ("public.two_factor_challenges", "session_or_token_material"),
    ("public.guest_portal_sessions", "session_or_token_material"),
    (
        "public.payment_retry_capabilities",
        "session_or_token_material",
    ),
    ("public.ekyc_verifications", "sensitive_ekyc_pii"),
    ("public.ekyc_decision_history", "sensitive_ekyc_pii"),
    ("public.ekyc_access_events", "sensitive_ekyc_pii"),
    ("public.ekyc_sensitive_reveals", "sensitive_ekyc_pii"),
    ("public.ekyc_idempotency_keys", "sensitive_ekyc_pii"),
    ("public.ekyc_notes", "sensitive_ekyc_pii"),
    ("public.ekyc_reason_codes", "sensitive_ekyc_pii"),
    ("public.email_deliveries", "ephemeral_queue_state"),
    (
        "public.support_action_idempotency_keys",
        "ephemeral_queue_state",
    ),
    (
        "public.support_guest_request_idempotency_keys",
        "ephemeral_queue_state",
    ),
    ("public.job_runs", "internal_system_table"),
    ("public.hotel_schema_revisions", "internal_system_table"),
    ("app.invalid_data_quarantine", "internal_system_table"),
    ("public.audit_logs", "internal_system_table"),
    ("public.audit_logs_default", "internal_system_table"),
];

/// Every reason code [`EXCLUDED_TABLES`] may use — keeps the manifest's
/// vocabulary fixed instead of drifting per entry. The manifest builder
/// validates each entry against this list so a typo fails the export instead
/// of shipping an undocumented reason.
const KNOWN_EXCLUSION_REASONS: &[&str] = &[
    "credentials_and_auth_state",
    "session_or_token_material",
    "sensitive_ekyc_pii",
    "ephemeral_queue_state",
    "internal_system_table",
];

/// Columns inside transferable tables that still carry live credential
/// material and must never leave the database. `bookings.pre_checkin_token`
/// is the guest portal's bearer token — the API model deliberately never
/// serializes it, so it cannot ride a backup either: a leaked file would hand
/// out working pre-check-in links (the token alone authenticates the portal
/// lookup). The export cursor projects [`export_columns`], so the values —
/// not just the names — stay out of the file. The same registry is enforced
/// on import in the repository (`NEVER_TRANSFERRED_COLUMNS`) so a crafted
/// file cannot write them either.
const EXCLUDED_EXPORT_COLUMNS: &[(&str, &str)] =
    super::repository::NEVER_TRANSFERRED_COLUMNS;

/// The columns of `table` the export emits — `ordered_columns` (schema
/// `ordinal_position` order, matching the emitted row key order) minus
/// [`EXCLUDED_EXPORT_COLUMNS`].
pub fn export_columns(table: &TransferTable) -> Vec<String> {
    table
        .ordered_columns
        .iter()
        .filter(|column| {
            !EXCLUDED_EXPORT_COLUMNS.contains(&(table.table.name.as_str(), column.as_str()))
        })
        .cloned()
        .collect()
}

const ALL_IMPORT_TABLES: &[&str] = TABLE_INSERT_ORDER;

/// True when a `schema.name` transfer-table key may cross the export/import
/// boundary. Only `public` business-data tables may move: `users`, `roles`,
/// `refresh_tokens`, session and audit tables carry credentials and grant
/// state, so exporting them would hand a `data_transfer:export_sensitive`
/// holder every password hash and TOTP seed, and importing them could plant a
/// forged `is_super_admin` account.
pub(crate) fn is_transferable_key(key: &str) -> bool {
    QualifiedTable::parse(key)
        .map(|table| table.schema == "public" && ALL_IMPORT_TABLES.contains(&table.name.as_str()))
        .unwrap_or(false)
}

/// User-FK columns that record *who caused* a row rather than *what the row
/// belongs to*. On import, a missing user in one of these remaps to the
/// importing admin instead of nulling or dropping the row — the attribution
/// survives the fact that the original account cannot.
pub(crate) const AUDIT_USER_FK_COLUMNS: &[&str] = &[
    "created_by",
    "updated_by",
    "cancelled_by",
    "posted_by",
    "modified_by",
    "run_by",
    "changed_by",
    "processed_by",
    "cashier_id",
    "void_by",
    "delivered_by",
    "inspected_by",
    "assigned_to",
    "reported_by",
    "linked_by",
    "verified_by",
    "response_by",
    // The newer tables use the `*_user_id` audit spelling or their own verb —
    // same "who caused it" semantics, same remap.
    "actor_user_id",
    "author_user_id",
    "assigned_to_user_id",
    "requested_by",
    "added_by",
    "granted_by",
    "reviewed_by",
    "issued_by",
    "revoked_by",
    "applied_by",
    "reversed_by",
];

pub async fn preview_export_counts(
    pool: &DbPool,
    scope: ExportScope,
) -> Result<ExportPreview, ApiError> {
    let tables = transferable_export_tables(pool, scope).await?;
    let manifest = build_backup_manifest(&tables, scope)?;

    let mut counts = HashMap::new();
    let mut total_records = 0_i64;
    let mut previews = Vec::new();

    for table in &tables {
        let count = DataTransferRepository::count_transfer_table(pool, table).await?;
        let name = table.table.key();
        counts.insert(name.clone(), count);
        total_records += count;
        let mut dependencies: Vec<String> = table.dependencies.iter().cloned().collect();
        dependencies.sort();
        previews.push(TransferTablePreview {
            name,
            count,
            dependencies,
        });
    }

    Ok(ExportPreview {
        generated_at: chrono::Utc::now().to_rfc3339(),
        counts,
        total_records,
        tables: previews,
        entities: manifest.entities,
        exclusions: manifest.exclusions,
    })
}

/// Rows pulled per `FETCH FORWARD` while streaming a full export. Bounds the
/// export's memory to a few hundred wide rows at a time; each batch is written
/// to the body before the next fetch.
const EXPORT_CURSOR_BATCH: i64 = 500;

/// The transferable tables in the order the backup document emits them —
/// alphabetical by schema-qualified key, matching the previous `BTreeMap`
/// serialization order. `ExportScope::Standard` drops every
/// [`SENSITIVE_TABLES`] entry; `full` and `backup` emit the complete set.
async fn transferable_export_tables(
    pool: &DbPool,
    scope: ExportScope,
) -> Result<Vec<TransferTable>, ApiError> {
    let mut tables: Vec<TransferTable> = DataTransferRepository::transfer_tables(pool)
        .await?
        .into_iter()
        .filter(|table| is_transferable_key(&table.table.key()))
        .filter(|table| scope.includes_sensitive() || !table_is_sensitive(&table.table.name))
        .collect();
    tables.sort_by_key(|table| table.table.key());
    Ok(tables)
}

/// The lowercased `config::Environment` for `source.environment`, falling
/// back to `"development"` when config was never initialized (unit tests and
/// bare export calls must not panic on `config::get()`).
pub(crate) fn backup_environment() -> String {
    crate::core::config::try_get()
        .map_or("development", |config| environment_name(config.environment))
        .to_string()
}

fn environment_name(environment: Environment) -> &'static str {
    match environment {
        Environment::Development => "development",
        Environment::Staging => "staging",
        Environment::Production => "production",
    }
}

/// The `manifest` block of an export: one entity descriptor per emitted
/// table (name, primary key, exported columns — no row counts; those land in
/// `integrity`) plus every [`EXCLUDED_TABLES`] entry so nothing is silently
/// omitted. `tables` must be the export's sorted list so the manifest order
/// matches the `tables` payload order.
///
/// Standard exports additionally record `omitted` — the sensitive entity
/// names left out (names only, never rows). `backup` exports also record
/// `relationships`, but that needs the schema so the header builder fills it
/// in — this function stays synchronous for tests.
fn build_backup_manifest(
    tables: &[TransferTable],
    scope: ExportScope,
) -> Result<BackupManifest, ApiError> {
    let entities = tables
        .iter()
        .map(|table| BackupEntityDescriptor {
            name: table.table.key(),
            primary_key: table.primary_key_columns.clone(),
            columns: export_columns(table),
        })
        .collect();

    let mut exclusions = Vec::with_capacity(EXCLUDED_TABLES.len());
    for (name, reason) in EXCLUDED_TABLES {
        if !KNOWN_EXCLUSION_REASONS.contains(reason) {
            return Err(ApiError::Internal(format!(
                "excluded table '{name}' uses unknown reason '{reason}'"
            )));
        }
        exclusions.push(BackupExclusion {
            name: (*name).to_string(),
            reason: (*reason).to_string(),
        });
    }

    let omitted = if scope.includes_sensitive() {
        None
    } else {
        // Name-only record of the sensitive entities a standard export skips —
        // catalog names, so the file explains its own coverage without
        // leaking row data.
        let emitted: HashSet<&str> =
            tables.iter().map(|table| table.table.name.as_str()).collect();
        Some(
            SENSITIVE_TABLES
                .iter()
                .filter(|name| !emitted.contains(**name))
                .map(|name| format!("public.{name}"))
                .collect(),
        )
    };

    Ok(BackupManifest {
        entities,
        exclusions,
        omitted,
        relationships: None,
    })
}

/// Column-level FK edges between emitted entities — `backup` scope only.
/// References to excluded parents (users, ekyc_*) are an import-time concern,
/// not something a backup file should map.
async fn backup_relationships(
    pool: &DbPool,
    tables: &[TransferTable],
) -> Result<Vec<BackupRelationship>, ApiError> {
    let children: Vec<QualifiedTable> =
        tables.iter().map(|table| table.table.clone()).collect();
    let emitted_keys: HashSet<String> =
        tables.iter().map(|table| table.table.key()).collect();
    let edges = DataTransferRepository::foreign_key_refs(pool, &children).await?;
    Ok(edges
        .into_iter()
        .filter(|edge| emitted_keys.contains(&edge.parent.key()))
        .map(|edge| BackupRelationship {
            table: edge.child.key(),
            column: edge.column,
            references_table: edge.parent.key(),
            references_column: edge.parent_column,
        })
        .collect())
}

/// Everything a backup document emits before the streamed `tables` payload.
/// `export_id` identifies this exact file — it also lands on the audit row so
/// a download can be tied to its event. `export_type` and
/// `includes_sensitive_data` describe the tier; `includes_secrets` is always
/// `false` — credentials never leave the database at any scope.
struct ExportHeader {
    export_id: Uuid,
    exported_at: String,
    export_type: &'static str,
    includes_sensitive_data: bool,
    source: BackupSource,
    manifest: BackupManifest,
}

fn build_export_header_inner(
    tables: &[TransferTable],
    scope: ExportScope,
) -> Result<ExportHeader, ApiError> {
    Ok(ExportHeader {
        export_id: Uuid::new_v4(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        export_type: scope.label(),
        includes_sensitive_data: scope.includes_sensitive(),
        source: BackupSource {
            environment: backup_environment(),
            database_provider: "postgresql".to_string(),
        },
        manifest: build_backup_manifest(tables, scope)?,
    })
}

async fn build_export_header(
    pool: &DbPool,
    tables: &[TransferTable],
    scope: ExportScope,
) -> Result<ExportHeader, ApiError> {
    let mut header = build_export_header_inner(tables, scope)?;
    if scope == ExportScope::Backup {
        header.manifest.relationships = Some(backup_relationships(pool, tables).await?);
    }
    Ok(header)
}

/// `{"format":"hotel-backup",…,"tables":{` — the document through the opening
/// brace of the streamed tables object, in the spec's exact key order.
fn export_doc_prefix(header: &ExportHeader) -> Result<String, ApiError> {
    // Each interpolated piece goes through serde_json so strings stay escaped
    // and struct field order (source, manifest) follows the model definitions.
    let export_id = serde_json::to_string(&header.export_id)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let exported_at = serde_json::to_string(&header.exported_at)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let application_version = serde_json::to_string(env!("CARGO_PKG_VERSION"))
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let source = serde_json::to_string(&header.source)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let manifest = serde_json::to_string(&header.manifest)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    Ok(format!(
        "{{\"format\":\"hotel-backup\",\"version\":1,\"kind\":\"business-data\",\"exportType\":{},\"includesSensitiveData\":{},\"includesSecrets\":false,\"exportId\":{export_id},\"exportedAt\":{exported_at},\"applicationVersion\":{application_version},\"source\":{source},\"manifest\":{manifest},\"tables\":{{",
        serde_json::to_string(header.export_type)
            .map_err(|error| ApiError::Internal(error.to_string()))?,
        header.includes_sensitive_data,
    ))
}

/// `},"integrity":{…}}` — closes the tables object, writes the trailer, and
/// closes the document.
fn export_doc_suffix(integrity: &BackupIntegrity) -> Result<String, ApiError> {
    let integrity =
        serde_json::to_string(integrity).map_err(|error| ApiError::Internal(error.to_string()))?;
    Ok(format!("}},\"integrity\":{integrity}}}"))
}

/// The shared export generator: emits the `hotel-backup` document as a
/// bounded byte stream — header and manifest first, then each table's rows
/// through a SQL cursor, then the `integrity` trailer with the counts
/// actually written.
///
/// One read transaction holds every cursor, so the export is a single
/// consistent snapshot. `audit_user_id` is `Some` only on the HTTP path: the
/// audit row is written once the body was fully produced — the largest
/// exfiltration channel in the product gets a record, the counts describe
/// what actually left, and a client disconnect drops the transaction and
/// skips the audit.
fn stream_export(
    pool: DbPool,
    tables: Vec<TransferTable>,
    scope: ExportScope,
    audit_user_id: Option<i64>,
) -> futures_core::stream::BoxStream<'static, Result<Bytes, ApiError>> {
    Box::pin(async_stream::try_stream! {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        let header = build_export_header(&pool, &tables, scope).await?;
        yield Bytes::from(export_doc_prefix(&header)?);

        let mut entity_rows: BTreeMap<String, u64> = BTreeMap::new();
        let mut record_count: u64 = 0;
        for (index, table) in tables.iter().enumerate() {
            if index > 0 {
                yield Bytes::from_static(b",");
            }
            let key = serde_json::to_string(&table.table.key())
                .map_err(|error| ApiError::Internal(error.to_string()))?;
            yield Bytes::from(format!("{key}:["));
            let columns = export_columns(table);

            DataTransferRepository::declare_export_cursor(&mut tx, table, &columns).await?;
            let mut table_rows: u64 = 0;
            let mut first_row = true;
            loop {
                let rows =
                    DataTransferRepository::fetch_export_cursor(&mut tx, EXPORT_CURSOR_BATCH)
                        .await?;
                if rows.is_empty() {
                    break;
                }
                table_rows += rows.len() as u64;
                let mut batch = Vec::new();
                for row in rows {
                    if !first_row {
                        batch.push(b',');
                    }
                    first_row = false;
                    batch.extend_from_slice(row.as_bytes());
                }
                yield Bytes::from(batch);
            }
            DataTransferRepository::close_export_cursor(&mut tx).await?;
            record_count += table_rows;
            entity_rows.insert(table.table.key(), table_rows);
            yield Bytes::from_static(b"]");
        }

        tx.commit().await.map_err(ApiError::from)?;
        let integrity = BackupIntegrity {
            entities: entity_rows.len() as u64,
            rows: record_count,
            entity_rows,
            completed_at: chrono::Utc::now().to_rfc3339(),
        };
        yield Bytes::from(export_doc_suffix(&integrity)?);

        if let Some(user_id) = audit_user_id {
            let _ = crate::services::audit::AuditLog::log_event(
                &pool,
                crate::models::AuditEvent {
                    user_id: Some(user_id),
                    action: "data_export",
                    resource_type: "data_transfer",
                    details: Some(serde_json::json!({
                        "export_id": header.export_id.to_string(),
                        "export_type": header.export_type,
                        "includes_sensitive_data": header.includes_sensitive_data,
                        "table_count": tables.len(),
                        "record_count": record_count,
                    })),
                    ..Default::default()
                },
            )
            .await;
        }
    })
}

/// Build the full-database export as a streamed response body.
///
/// The pre-cursor export loaded every transferable table into memory and
/// serialized it in one shot — behind Cloudflare the request produced no
/// bytes for the duration of the dump, so large exports surfaced as "the
/// origin returned an invalid or incomplete response", and peak RSS scaled
/// with database size. [`stream_export`] emits the `hotel-backup`
/// document: the header and manifest go out immediately, then each table's
/// rows are pulled through a SQL cursor and written in bounded batches, and
/// the `integrity` trailer closes the document so a truncated download is
/// detectable.
pub async fn export_booking_data_body(
    pool: &DbPool,
    user_id: i64,
    scope: ExportScope,
) -> Result<Body, ApiError> {
    let tables = transferable_export_tables(pool, scope).await?;
    Ok(Body::from_stream(stream_export(
        pool.clone(),
        tables,
        scope,
        Some(user_id),
    )))
}

/// Collect a full export into one in-memory document.
///
/// Test-only counterpart to [`export_booking_data_body`]: it buffers the
/// output of the same [`stream_export`] generator, so the streamed and
/// materialized shapes can never drift — the equivalence test scrubs the
/// per-run fields (`exportId`, `exportedAt`, `completedAt`) and compares the
/// rest byte for byte. Never wire this to a handler: buffering is exactly
/// what the streamed path exists to avoid.
#[allow(dead_code)] // used by tests/data_transfer_export.rs
pub async fn export_booking_data(pool: &DbPool, scope: ExportScope) -> Result<String, ApiError> {
    let tables = transferable_export_tables(pool, scope).await?;
    let body = Body::from_stream(stream_export(pool.clone(), tables, scope, None));
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    String::from_utf8(bytes.to_vec()).map_err(|error| ApiError::Internal(error.to_string()))
}


pub(crate) fn expand_full_overwrite_tables(
    selected: &mut HashSet<String>,
    dependencies: &HashMap<String, HashSet<String>>,
) {
    let mut changed = true;
    while changed {
        changed = false;
        for (child, parents) in dependencies {
            if parents.iter().any(|parent| selected.contains(parent))
                && is_transferable_key(child)
                && selected.insert(child.clone())
            {
                changed = true;
            }
        }
    }
}

pub(crate) fn import_error_detail(error: &ApiError) -> String {
    match error {
        ApiError::BadRequest(message)
        | ApiError::Conflict(message)
        | ApiError::Database(message) => message.clone(),
        _ => error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ALL_IMPORT_TABLES, EXCLUDED_TABLES, Environment, KNOWN_EXCLUSION_REASONS,
        QualifiedTable, SENSITIVE_TABLES, TABLE_INSERT_ORDER, TransferTable, backup_environment,
        build_backup_manifest, build_export_header_inner, environment_name, export_columns,
        export_doc_prefix, export_doc_suffix, table_is_sensitive,
    };
    use crate::models::{BackupIntegrity, ExportScope};
    use std::collections::{BTreeMap, HashSet};

    #[test]
    fn table_insert_order_is_unique_and_covers_known_tables() {
        let unique: HashSet<_> = TABLE_INSERT_ORDER.iter().collect();
        assert_eq!(
            unique.len(),
            TABLE_INSERT_ORDER.len(),
            "TABLE_INSERT_ORDER must not contain duplicates"
        );
        // The full-backup set the API exports/imports.
        assert_eq!(TABLE_INSERT_ORDER.len(), 75);
        // Introspection list and the canonical order must stay in lock-step.
        assert_eq!(ALL_IMPORT_TABLES, TABLE_INSERT_ORDER);
    }

    #[test]
    fn excluded_tables_are_qualified_unique_and_reasoned() {
        let mut names = HashSet::new();
        for (name, reason) in EXCLUDED_TABLES {
            assert!(
                name.split_once('.').is_some(),
                "excluded table '{name}' must be schema-qualified"
            );
            assert!(!reason.is_empty(), "excluded table '{name}' needs a reason");
            assert!(
                KNOWN_EXCLUSION_REASONS.contains(reason),
                "excluded table '{name}' uses unknown reason '{reason}'"
            );
            assert!(names.insert(*name), "duplicate exclusion '{name}'");
            let qualified = QualifiedTable::parse(name)
                .unwrap_or_else(|_| panic!("excluded table '{name}' must parse"));
            assert!(
                !ALL_IMPORT_TABLES.contains(&qualified.name.as_str()),
                "'{name}' is both transferable and excluded"
            );
        }
        // The 29 pg_class-visible tables kept out of the transferable set.
        assert_eq!(EXCLUDED_TABLES.len(), 29);
    }

    #[test]
    fn promotion_tables_follow_foreign_key_safe_insert_order() {
        let position = |table: &str| {
            TABLE_INSERT_ORDER
                .iter()
                .position(|candidate| *candidate == table)
                .unwrap_or_else(|| panic!("{table} should be transferable"))
        };

        for (parent, child) in [
            ("promotions", "vouchers"),
            ("promotions", "promotion_room_types"),
            ("room_types", "promotion_room_types"),
            ("bookings", "voucher_redemptions"),
            ("vouchers", "voucher_redemptions"),
            ("voucher_redemptions", "voucher_redemption_allocations"),
        ] {
            assert!(
                position(parent) < position(child),
                "{parent} must be inserted before {child}"
            );
        }
    }

    fn transfer_table(name: &str, columns: &[&str], primary_key: &[&str]) -> TransferTable {
        let ordered_columns: Vec<String> =
            columns.iter().map(|column| (*column).to_string()).collect();
        TransferTable {
            table: QualifiedTable {
                schema: "public".to_string(),
                name: name.to_string(),
            },
            is_partitioned: false,
            columns: ordered_columns.iter().cloned().collect(),
            ordered_columns,
            generated_columns: HashSet::new(),
            primary_key_columns: primary_key
                .iter()
                .map(|column| (*column).to_string())
                .collect(),
            dependencies: HashSet::new(),
        }
    }

    #[test]
    fn sensitive_tables_partition_the_transferable_set() {
        // Every sensitive name must be a real transferable table — a stale
        // entry here means a new table got classified without being added to
        // the catalog, or the catalog shrank under the registry.
        for name in SENSITIVE_TABLES {
            assert!(
                TABLE_INSERT_ORDER.contains(name),
                "'{name}' is marked sensitive but is not in TABLE_INSERT_ORDER"
            );
        }
        // And nothing excluded can also be sensitive — excluded tables never
        // reach either side of the tiered export.
        for (excluded, _) in EXCLUDED_TABLES {
            assert!(
                !table_is_sensitive(excluded),
                "'{excluded}' is both excluded and sensitive"
            );
        }
        // Standard scope emits exactly the non-sensitive remainder.
        let standard_count = TABLE_INSERT_ORDER
            .iter()
            .filter(|name| !table_is_sensitive(name))
            .count();
        assert_eq!(
            standard_count + SENSITIVE_TABLES.len(),
            TABLE_INSERT_ORDER.len(),
            "sensitive + standard must partition the transferable set"
        );
    }

    #[test]
    fn manifest_builder_lists_every_exclusion_with_its_reason() {
        let manifest =
            build_backup_manifest(&[], ExportScope::Full).expect("manifest should build");

        assert!(manifest.entities.is_empty());
        assert_eq!(manifest.exclusions.len(), EXCLUDED_TABLES.len());
        for (exclusion, (name, reason)) in manifest.exclusions.iter().zip(EXCLUDED_TABLES) {
            assert_eq!(exclusion.name, *name);
            assert_eq!(exclusion.reason, *reason);
        }
    }

    #[test]
    fn manifest_entities_report_exported_columns_without_credentials() {
        let table = transfer_table(
            "bookings",
            &[
                "id",
                "pre_checkin_token",
                "pre_checkin_token_expires_at",
                "status",
            ],
            &["id"],
        );

        let manifest =
            build_backup_manifest(&[table], ExportScope::Full).expect("manifest should build");
        let entity = &manifest.entities[0];

        assert_eq!(entity.name, "public.bookings");
        assert_eq!(entity.primary_key, vec!["id".to_string()]);
        // The guest-portal bearer token stays out of the manifest and (via the
        // same `export_columns` projection) out of the emitted rows.
        assert_eq!(entity.columns, vec!["id".to_string(), "status".to_string()]);
    }

    #[test]
    fn export_columns_preserve_schema_order() {
        let table = transfer_table("rooms", &["room_number", "id", "status"], &["id"]);

        // Ordinal order is kept — the manifest describes the emitted row shape.
        assert_eq!(
            export_columns(&table),
            vec![
                "room_number".to_string(),
                "id".to_string(),
                "status".to_string()
            ]
        );
    }

    #[test]
    fn export_header_emits_spec_key_order() {
        let header = build_export_header_inner(
            &[transfer_table("amenities", &["id", "name"], &["id"])],
            ExportScope::Full,
        )
        .expect("header should build");
        let prefix = export_doc_prefix(&header).expect("prefix should render");

        assert!(
            prefix.starts_with(
                "{\"format\":\"hotel-backup\",\"version\":1,\"kind\":\"business-data\",\"exportType\":\"full\",\"includesSensitiveData\":true,\"includesSecrets\":false,\"exportId\":\""
            ),
            "prefix must open with the v1 header: {prefix}"
        );
        let mut cursor = 0;
        for key in [
            "\"exportId\"",
            "\"exportedAt\"",
            "\"applicationVersion\"",
            "\"source\"",
            "\"manifest\"",
            "\"tables\":{",
        ] {
            let position = prefix[cursor..]
                .find(key)
                .map(|found| found + cursor)
                .unwrap_or_else(|| panic!("'{key}' missing after offset {cursor}: {prefix}"));
            cursor = position + key.len();
        }
        assert!(prefix.ends_with("\"tables\":{"));
        assert!(prefix.contains(&format!("\"exportId\":\"{}\"", header.export_id)));
        assert!(prefix.contains("\"databaseProvider\":\"postgresql\""));
    }

    #[test]
    fn backup_environment_is_a_lowercase_known_name() {
        for (environment, name) in [
            (Environment::Development, "development"),
            (Environment::Staging, "staging"),
            (Environment::Production, "production"),
        ] {
            assert_eq!(environment_name(environment), name);
        }
        // Whether or not a sibling test initialized the global config, the
        // field must come back as a known lowercase name — never a
        // `config::get()` panic.
        assert!(["development", "staging", "production"].contains(&backup_environment().as_str()));
    }

    #[test]
    fn empty_export_document_is_valid_v1_json() {
        let header =
            build_export_header_inner(&[], ExportScope::Full).expect("header should build");
        let prefix = export_doc_prefix(&header).expect("prefix should render");
        let suffix = export_doc_suffix(&BackupIntegrity {
            entities: 0,
            rows: 0,
            entity_rows: BTreeMap::new(),
            completed_at: chrono::Utc::now().to_rfc3339(),
        })
        .expect("suffix should render");

        let parsed: crate::models::BackupFile = serde_json::from_str(&format!("{prefix}{suffix}"))
            .expect("an empty export must parse as a v1 document");
        assert_eq!(parsed.format, "hotel-backup");
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.kind, "business-data");
        assert_eq!(parsed.export_id, header.export_id);
        assert_eq!(parsed.application_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(parsed.source.database_provider, "postgresql");
        assert_eq!(parsed.manifest.exclusions.len(), EXCLUDED_TABLES.len());
        assert!(parsed.tables.is_empty());
        assert_eq!(parsed.integrity.rows, 0);
    }
}
