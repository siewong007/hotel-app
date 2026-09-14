//! Data-transfer workflows

use std::collections::{BTreeMap, HashMap, HashSet};

use axum::body::{Body, Bytes};
use serde_json::Value;
use uuid::Uuid;

use crate::constants::ImportMode;
use crate::core::config::Environment;
use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::models::{
    BackupEntityDescriptor, BackupExclusion, BackupIntegrity, BackupManifest, BackupSource,
    BookingDataExport, ExportPreview, FullDataExport, ImportRequest, TransferPayload,
    TransferTablePreview,
};
use crate::repositories::data_transfer::{
    DataTransferRepository, ImportRowPolicy, QualifiedTable, TransferTable, transfer_order,
};

/// Every transferable table in foreign-key-safe **insert** order (parents
/// before children). Clearing for overwrite walks this in reverse. This is the
/// single source of truth — the export struct, the import row loop, the
/// overwrite clear, and column introspection all derive from it. The v2/v3
/// insert order itself comes from `transfer_order` over live FK metadata; this
/// constant's order still governs the V1 legacy path.
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

/// Schema tables that must never cross the export/import boundary, as
/// `name → reason` pairs. This is the source of truth for the v3 manifest's
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
/// not just the names — stay out of the file.
const EXCLUDED_EXPORT_COLUMNS: &[(&str, &str)] = &[
    ("bookings", "pre_checkin_token"),
    ("bookings", "pre_checkin_token_expires_at"),
];

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
/// state, so exporting them would hand a `settings:manage` holder every
/// password hash and TOTP seed, and importing them could plant a forged
/// `is_super_admin` account.
fn is_transferable_key(key: &str) -> bool {
    QualifiedTable::parse(key)
        .map(|table| table.schema == "public" && ALL_IMPORT_TABLES.contains(&table.name.as_str()))
        .unwrap_or(false)
}

/// Tables keyed by a composite primary key (no serial `id`): excluded from
/// sequence resets, and exported with an explicit key order.
const COMPOSITE_PK_TABLES: &[&str] = &[
    "room_type_amenities",
    "room_status_transitions",
    "promotion_room_types",
    "promotion_channels",
    "promotion_loyalty_tiers",
    "online_inventory_allocations",
    "team_members",
    "team_roles",
    "staff_notification_reads",
];

const TABLES_WITH_TRIGGERS: &[&str] = &[
    "bookings",
    "rooms",
    "guests",
    "customer_ledgers",
    "payments",
];

const ROOM_REFERENCE_COLUMNS: &[(&str, &[&str])] = &[
    ("bookings", &["room_id"]),
    ("room_history", &["room_id"]),
    ("housekeeping_tasks", &["room_id"]),
    ("maintenance_tickets", &["room_id"]),
    ("room_changes", &["from_room_id", "to_room_id"]),
    ("room_status_change_log", &["room_id"]),
];

const AUDIT_USER_FK_COLUMNS: &[&str] = &[
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
];

/// Child -> parent relationships where deleting the parent either deletes the
/// child too (`CASCADE`) or is blocked until the child is removed
/// (`NO ACTION`/`RESTRICT`). Overwrite expands through this graph so old export
/// files that predate newer dependent tables can still clear a selected parent
/// without hitting FK violations mid-transaction.
const OVERWRITE_DELETE_DEPENDENCIES: &[(&str, &str)] = &[
    ("rooms", "room_types"),
    ("bookings", "companies"),
    ("bookings", "guests"),
    ("bookings", "rooms"),
    ("bookings", "booking_channels"),
    ("promotion_room_types", "promotions"),
    ("promotion_room_types", "room_types"),
    ("vouchers", "promotions"),
    ("vouchers", "guests"),
    ("voucher_redemptions", "vouchers"),
    ("voucher_redemptions", "promotions"),
    ("voucher_redemptions", "bookings"),
    ("voucher_redemptions", "guests"),
    ("voucher_redemption_allocations", "voucher_redemptions"),
    ("voucher_redemption_allocations", "bookings"),
    ("booking_guests", "bookings"),
    ("booking_modifications", "bookings"),
    ("booking_history", "bookings"),
    ("payments", "bookings"),
    ("invoices", "bookings"),
    ("customer_ledger_payments", "customer_ledgers"),
    ("night_audit_details", "night_audit_runs"),
    ("room_changes", "bookings"),
    ("room_changes", "rooms"),
    ("user_guests", "guests"),
    ("guest_complimentary_credits", "guests"),
    ("guest_complimentary_credits", "room_types"),
    ("room_rates", "rate_plans"),
    ("room_rates", "room_types"),
    ("room_type_amenities", "amenities"),
    ("room_type_amenities", "room_types"),
    ("loyalty_tiers", "loyalty_programs"),
    ("loyalty_memberships", "guests"),
    ("loyalty_memberships", "loyalty_programs"),
    ("loyalty_memberships", "loyalty_tiers"),
    ("points_transactions", "loyalty_memberships"),
    ("reward_catalog", "loyalty_programs"),
    ("reward_redemptions", "loyalty_memberships"),
    ("reward_redemptions", "reward_catalog"),
    ("corporate_account_contacts", "corporate_accounts"),
    ("booking_services", "bookings"),
    ("booking_services", "services"),
    ("room_history", "rooms"),
    ("room_status_change_log", "rooms"),
    ("loyalty_members", "guests"),
    ("loyalty_accounts", "loyalty_members"),
    ("loyalty_accounts", "loyalty_tiers"),
    ("loyalty_rewards", "loyalty_tiers"),
    ("loyalty_transactions", "loyalty_members"),
    ("loyalty_transactions", "loyalty_accounts"),
    ("loyalty_redemptions", "loyalty_members"),
    ("loyalty_redemptions", "loyalty_rewards"),
    ("loyalty_redemptions", "loyalty_transactions"),
    ("housekeeping_tasks", "rooms"),
    ("guest_documents", "guests"),
    ("guest_notes", "guests"),
    ("guest_preferences", "guests"),
    ("guest_reviews", "guests"),
    ("self_checkin_events", "bookings"),
    ("night_audit_posted_nights", "bookings"),
];

pub async fn preview_export_counts(pool: &DbPool) -> Result<ExportPreview, ApiError> {
    let tables = transferable_export_tables(pool).await?;
    let manifest = build_backup_manifest(&tables)?;

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

/// The transferable tables in the order the v3 document emits them —
/// alphabetical by schema-qualified key, matching the previous `BTreeMap`
/// serialization order.
async fn transferable_export_tables(pool: &DbPool) -> Result<Vec<TransferTable>, ApiError> {
    let mut tables: Vec<TransferTable> = DataTransferRepository::transfer_tables(pool)
        .await?
        .into_iter()
        .filter(|table| is_transferable_key(&table.table.key()))
        .collect();
    tables.sort_by_key(|table| table.table.key());
    Ok(tables)
}

/// The lowercased `config::Environment` for `source.environment`, falling
/// back to `"development"` when config was never initialized (unit tests and
/// bare export calls must not panic on `config::get()`).
fn backup_environment() -> String {
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

/// The `manifest` block of a v3 export: one entity descriptor per
/// transferable table (name, primary key, exported columns — no row counts;
/// those land in `integrity`) plus every [`EXCLUDED_TABLES`] entry so nothing
/// is silently omitted. `tables` must be the export's sorted list so the
/// manifest order matches the `tables` payload order.
fn build_backup_manifest(tables: &[TransferTable]) -> Result<BackupManifest, ApiError> {
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

    Ok(BackupManifest {
        entities,
        exclusions,
    })
}

/// Everything a v3 document emits before the streamed `tables` payload.
/// `export_id` identifies this exact file — it also lands on the audit row so
/// a download can be tied to its event.
struct ExportHeader {
    export_id: Uuid,
    exported_at: String,
    source: BackupSource,
    manifest: BackupManifest,
}

fn build_export_header(tables: &[TransferTable]) -> Result<ExportHeader, ApiError> {
    Ok(ExportHeader {
        export_id: Uuid::new_v4(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        source: BackupSource {
            environment: backup_environment(),
            database_provider: "postgresql".to_string(),
        },
        manifest: build_backup_manifest(tables)?,
    })
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
        "{{\"format\":\"hotel-backup\",\"version\":3,\"kind\":\"business-data\",\"exportId\":{export_id},\"exportedAt\":{exported_at},\"applicationVersion\":{application_version},\"source\":{source},\"manifest\":{manifest},\"tables\":{{"
    ))
}

/// `},"integrity":{…}}` — closes the tables object, writes the trailer, and
/// closes the document.
fn export_doc_suffix(integrity: &BackupIntegrity) -> Result<String, ApiError> {
    let integrity =
        serde_json::to_string(integrity).map_err(|error| ApiError::Internal(error.to_string()))?;
    Ok(format!("}},\"integrity\":{integrity}}}"))
}

/// The shared export generator: emits the v3 `hotel-backup` document as a
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
    audit_user_id: Option<i64>,
) -> futures_core::stream::BoxStream<'static, Result<Bytes, ApiError>> {
    Box::pin(async_stream::try_stream! {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        let header = build_export_header(&tables)?;
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
/// with database size. [`stream_export`] emits the v3 `hotel-backup`
/// document: the header and manifest go out immediately, then each table's
/// rows are pulled through a SQL cursor and written in bounded batches, and
/// the `integrity` trailer closes the document so a truncated download is
/// detectable.
pub async fn export_booking_data_body(pool: &DbPool, user_id: i64) -> Result<Body, ApiError> {
    let tables = transferable_export_tables(pool).await?;
    Ok(Body::from_stream(stream_export(
        pool.clone(),
        tables,
        Some(user_id),
    )))
}

/// Collect a full export into one in-memory v3 document.
///
/// Test-only counterpart to [`export_booking_data_body`]: it buffers the
/// output of the same [`stream_export`] generator, so the streamed and
/// materialized shapes can never drift — the equivalence test scrubs the
/// per-run fields (`exportId`, `exportedAt`, `completedAt`) and compares the
/// rest byte for byte. Never wire this to a handler: buffering is exactly
/// what the streamed path exists to avoid.
#[allow(dead_code)] // used by tests/data_transfer_export.rs
pub async fn export_booking_data(pool: &DbPool) -> Result<String, ApiError> {
    let tables = transferable_export_tables(pool).await?;
    let body = Body::from_stream(stream_export(pool.clone(), tables, None));
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    String::from_utf8(bytes.to_vec()).map_err(|error| ApiError::Internal(error.to_string()))
}

pub async fn import_booking_data(
    pool: &DbPool,
    import_user_id: i64,
    request: ImportRequest,
) -> Result<Value, ApiError> {
    let ImportRequest { mode, data, tables } = request;
    match data {
        TransferPayload::V1(data) => {
            import_legacy_booking_data(pool, import_user_id, mode, *data, tables).await
        }
        TransferPayload::V2(data) => import_full_data(pool, mode, data, tables).await,
    }
}

async fn import_legacy_booking_data(
    pool: &DbPool,
    import_user_id: i64,
    mode: ImportMode,
    data: BookingDataExport,
    tables: Vec<String>,
) -> Result<Value, ApiError> {
    let is_overwrite = mode == ImportMode::Overwrite;

    let mut generated_columns = base_generated_columns();
    let existing_user_ids = DataTransferRepository::existing_user_ids(pool).await?;
    let table_columns = DataTransferRepository::table_columns(pool, ALL_IMPORT_TABLES).await?;
    let required_columns =
        DataTransferRepository::required_columns(pool, ALL_IMPORT_TABLES).await?;
    let user_fk_columns = DataTransferRepository::user_fk_columns(pool, ALL_IMPORT_TABLES).await?;
    for (table, columns) in
        DataTransferRepository::generated_columns(pool, ALL_IMPORT_TABLES).await?
    {
        generated_columns.entry(table).or_default().extend(columns);
    }

    let empty_skip = HashSet::new();
    let empty_columns = HashSet::new();
    // Foreign-key-safe insert order; the import loop and overwrite clear both
    // derive from this so a table never lands before its parents.
    let tables_and_data: Vec<(&str, &[Value])> = vec![
        ("amenities", &data.amenities),
        ("booking_channels", &data.booking_channels),
        ("companies", &data.companies),
        ("corporate_accounts", &data.corporate_accounts),
        (
            "corporate_account_contacts",
            &data.corporate_account_contacts,
        ),
        ("email_templates", &data.email_templates),
        ("guests", &data.guests),
        ("promotions", &data.promotions),
        ("vouchers", &data.vouchers),
        ("guest_documents", &data.guest_documents),
        ("guest_notes", &data.guest_notes),
        ("guest_preferences", &data.guest_preferences),
        ("loyalty_programs", &data.loyalty_programs),
        ("loyalty_program_rules", &data.loyalty_program_rules),
        ("loyalty_tiers", &data.loyalty_tiers),
        ("loyalty_memberships", &data.loyalty_memberships),
        ("loyalty_members", &data.loyalty_members),
        ("loyalty_accounts", &data.loyalty_accounts),
        ("loyalty_rewards", &data.loyalty_rewards),
        ("night_audit_runs", &data.night_audit_runs),
        ("night_audit_details", &data.night_audit_details),
        ("points_transactions", &data.points_transactions),
        ("rate_plans", &data.rate_plans),
        ("reward_catalog", &data.reward_catalog),
        ("room_status_transitions", &data.room_status_transitions),
        ("room_types", &data.room_types),
        ("promotion_room_types", &data.promotion_room_types),
        (
            "guest_complimentary_credits",
            &data.guest_complimentary_credits,
        ),
        ("room_rates", &data.room_rates),
        ("room_type_amenities", &data.room_type_amenities),
        ("rooms", &data.rooms),
        ("bookings", &data.bookings),
        ("voucher_redemptions", &data.voucher_redemptions),
        (
            "voucher_redemption_allocations",
            &data.voucher_redemption_allocations,
        ),
        ("booking_guests", &data.booking_guests),
        ("booking_history", &data.booking_history),
        ("booking_modifications", &data.booking_modifications),
        ("customer_ledgers", &data.customer_ledgers),
        ("customer_ledger_payments", &data.customer_ledger_payments),
        ("guest_reviews", &data.guest_reviews),
        ("housekeeping_tasks", &data.housekeeping_tasks),
        ("invoices", &data.invoices),
        ("maintenance_tickets", &data.maintenance_tickets),
        ("night_audit_posted_nights", &data.night_audit_posted_nights),
        ("payments", &data.payments),
        ("loyalty_transactions", &data.loyalty_transactions),
        ("reward_redemptions", &data.reward_redemptions),
        ("loyalty_redemptions", &data.loyalty_redemptions),
        ("room_changes", &data.room_changes),
        ("room_history", &data.room_history),
        ("room_status_change_log", &data.room_status_change_log),
        ("self_checkin_events", &data.self_checkin_events),
        ("services", &data.services),
        ("booking_services", &data.booking_services),
        ("system_settings", &data.system_settings),
        ("user_guests", &data.user_guests),
    ];
    let mut selected_tables = selected_import_tables(&tables, &tables_and_data)?;
    if is_overwrite {
        expand_overwrite_clear_tables(&mut selected_tables);
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    if is_overwrite {
        // Clear selected tables in reverse (child-before-parent) order. The UI
        // sends this list explicitly so an overwrite can intentionally restore
        // a table to empty rows.
        let clear_tables: Vec<&str> = tables_and_data
            .iter()
            .rev()
            .filter(|(table, _)| selected_tables.contains(*table))
            .map(|(table, _)| *table)
            .collect();
        if let Err(error) = DataTransferRepository::clear_tables(&mut tx, &clear_tables).await {
            let error_detail = import_error_detail(&error);
            let message = format!(
                "Overwrite failed while clearing selected data: {}. Include dependent tables in the overwrite selection or remove the blocked references before retrying. No changes were saved.",
                error_detail
            );
            log::warn!("{}", message);
            let _ = tx.rollback().await;
            return Err(ApiError::BadRequest(message));
        }
        log::info!(
            "Phase 1: cleared {} table(s) for overwrite",
            clear_tables.len()
        );
    }

    let room_references =
        RoomReferenceResolver::build(&mut tx, &selected_tables, &data.rooms).await?;
    validate_room_references(
        &mut tx,
        &selected_tables,
        &tables_and_data,
        &room_references,
    )
    .await?;

    DataTransferRepository::align_status_constraints(&mut tx).await?;
    DataTransferRepository::set_user_triggers(&mut tx, TABLES_WITH_TRIGGERS, false).await?;

    let mut counts = serde_json::Map::new();

    for (table, rows) in tables_and_data {
        if !selected_tables.contains(table) {
            continue;
        }

        let skip = generated_columns.get(table).unwrap_or(&empty_skip);
        let mut inserted = 0usize;

        for (row_index, row) in rows.iter().enumerate() {
            let Some(obj) = row.as_object() else {
                let message = format!(
                    "Import failed for table {} row {} because the row is not a JSON object. No changes were saved.",
                    table,
                    row_index + 1
                );
                log::warn!("{}", message);
                let _ = tx.rollback().await;
                return Err(ApiError::BadRequest(message));
            };
            let remapped_row;
            let obj = if room_reference_columns(table).is_some() {
                remapped_row = remap_room_references(table, obj, &room_references)?;
                &remapped_row
            } else {
                obj
            };

            match DataTransferRepository::insert_json_row(
                &mut tx,
                table,
                obj,
                ImportRowPolicy {
                    skip_columns: skip,
                    valid_columns: table_columns.get(table),
                    required_columns: required_columns.get(table),
                    user_fk_columns: user_fk_columns.get(table).unwrap_or(&empty_columns),
                    audit_user_fk_columns: AUDIT_USER_FK_COLUMNS,
                    existing_user_ids: &existing_user_ids,
                    fallback_user_id: import_user_id,
                },
            )
            .await
            {
                Ok(rows_affected) => {
                    if rows_affected > 0 {
                        inserted += 1;
                    }
                }
                Err(error) => {
                    let error_detail = import_error_detail(&error);
                    let message = format!(
                        "Import failed for table {} row {}{}: {}. No changes were saved.",
                        table,
                        row_index + 1,
                        row_reference(obj),
                        error_detail
                    );
                    log::warn!("{}", message);
                    let _ = tx.rollback().await;
                    return Err(ApiError::BadRequest(message));
                }
            }
        }

        counts.insert(table.into(), Value::Number(inserted.into()));
        if inserted > 0 {
            log::info!("Inserted {} rows into {}", inserted, table);
        }
    }

    DataTransferRepository::set_user_triggers(&mut tx, TABLES_WITH_TRIGGERS, true).await?;
    let sequence_reset_tables: Vec<&str> = TABLE_INSERT_ORDER
        .iter()
        .copied()
        .filter(|table| !COMPOSITE_PK_TABLES.contains(table))
        .collect();
    DataTransferRepository::reset_sequences(&mut tx, &sequence_reset_tables).await?;

    tx.commit().await.map_err(ApiError::from)?;

    let response = serde_json::json!({
        "success": true,
        "mode": if is_overwrite { "overwrite" } else { "import" },
        "records_imported": counts,
    });

    Ok(response)
}

async fn import_full_data(
    pool: &DbPool,
    mode: ImportMode,
    data: FullDataExport,
    requested_tables: Vec<String>,
) -> Result<Value, ApiError> {
    if data.version != "2.0" {
        return Err(ApiError::BadRequest(format!(
            "Unsupported schema-driven transfer version '{}'",
            data.version
        )));
    }
    let descriptors = DataTransferRepository::transfer_tables(pool).await?;
    let descriptor_by_name: HashMap<String, TransferTable> = descriptors
        .into_iter()
        .map(|descriptor| (descriptor.table.key(), descriptor))
        .collect();

    for table in data.tables.keys() {
        QualifiedTable::parse(table)?;
        if !is_transferable_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{table}' is not permitted: only the business-data table set can be imported"
            )));
        }
        if !descriptor_by_name.contains_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{table}' does not exist in the destination schema"
            )));
        }
    }

    let mut selected: HashSet<String> = if requested_tables.is_empty() {
        data.tables.keys().cloned().collect()
    } else {
        requested_tables.into_iter().collect()
    };
    for table in &selected {
        QualifiedTable::parse(table)?;
        if !is_transferable_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{table}' is not permitted: only the business-data table set can be imported"
            )));
        }
        if !data.tables.contains_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Selected transfer table '{table}' is missing from the import file"
            )));
        }
        if !descriptor_by_name.contains_key(table) {
            return Err(ApiError::BadRequest(format!(
                "Unknown transfer table '{table}' was requested"
            )));
        }
    }

    let dependencies: HashMap<String, HashSet<String>> = descriptor_by_name
        .iter()
        .map(|(name, descriptor)| (name.clone(), descriptor.dependencies.clone()))
        .collect();
    if mode == ImportMode::Overwrite {
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

    if mode == ImportMode::Overwrite {
        let clear_tables: Vec<_> = ordered_tables.iter().rev().cloned().collect();
        DataTransferRepository::clear_transfer_tables(&mut tx, &clear_tables).await?;
    }

    let mut counts = serde_json::Map::new();
    for table in &ordered_tables {
        let name = table.table.key();
        let rows = data.tables.get(&name).map(Vec::as_slice).unwrap_or(&[]);
        let mut inserted = 0_u64;
        for (row_index, row) in rows.iter().enumerate() {
            let object = row.as_object().ok_or_else(|| {
                ApiError::BadRequest(format!(
                    "Import failed for table {name} row {} because the row is not a JSON object",
                    row_index + 1
                ))
            })?;
            inserted += DataTransferRepository::insert_transfer_row(&mut tx, table, object).await?;
        }
        counts.insert(name, Value::Number(inserted.into()));
    }

    // Deferring moved the foreign-key checks to COMMIT. Force them now, while
    // the transaction is still ours to roll back, so a violation fails the
    // import instead of surfacing as a failed commit after the handler has
    // already decided the import succeeded.
    //
    // This must also come before the ALTER TABLE statements below: PostgreSQL
    // refuses to alter a table that still has pending trigger events, so
    // re-enabling triggers while the deferred checks were outstanding failed
    // the whole import with "cannot ALTER TABLE ... because it has pending
    // trigger events".
    sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            ApiError::BadRequest(format!(
                "Import failed referential-integrity checks: {error}. Tables outside the transferable set may still reference the data being overwritten."
            ))
        })?;

    DataTransferRepository::set_transfer_triggers(&mut tx, &ordered_tables, true).await?;
    DataTransferRepository::restore_foreign_keys(&mut tx, &relaxed).await?;
    DataTransferRepository::reset_transfer_sequences(&mut tx, &ordered_tables).await?;

    tx.commit().await.map_err(ApiError::from)?;

    Ok(serde_json::json!({
        "success": true,
        "mode": if mode == ImportMode::Overwrite { "overwrite" } else { "import" },
        "records_imported": counts,
    }))
}

fn expand_full_overwrite_tables(
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

fn base_generated_columns() -> HashMap<String, HashSet<String>> {
    [
        (
            "bookings",
            ["nights", "total_guests", "tourism_billable_amount"].as_slice(),
        ),
        ("invoices", ["balance_due"].as_slice()),
        ("customer_ledgers", ["balance_due"].as_slice()),
    ]
    .into_iter()
    .map(|(table, columns)| {
        (
            table.to_string(),
            columns.iter().map(|column| (*column).to_string()).collect(),
        )
    })
    .collect()
}

fn row_reference(row: &serde_json::Map<String, Value>) -> String {
    for key in [
        "id",
        "booking_number",
        "invoice_number",
        "room_number",
        "company_name",
        "full_name",
        "audit_date",
    ] {
        if let Some(value) = row.get(key) {
            return format!(" ({key}: {})", format_reference_value(value));
        }
    }

    String::new()
}

fn format_reference_value(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

struct RoomReferenceResolver {
    imported_room_ids: HashMap<i64, i64>,
}

impl RoomReferenceResolver {
    async fn build(
        tx: &mut DbTransaction<'_>,
        selected_tables: &HashSet<String>,
        imported_rooms: &[Value],
    ) -> Result<Self, ApiError> {
        let mut imported_room_ids = HashMap::new();
        if !selected_tables.contains("rooms") {
            return Ok(Self { imported_room_ids });
        }

        let room_refs = imported_room_refs(imported_rooms);
        let room_numbers: Vec<String> = room_refs
            .iter()
            .filter_map(|(_, room_number)| room_number.clone())
            .collect();
        let existing_by_number =
            DataTransferRepository::room_ids_by_number(tx, &room_numbers).await?;

        for (imported_id, room_number) in room_refs {
            let resolved_id = room_number
                .as_ref()
                .and_then(|number| existing_by_number.get(number))
                .copied()
                .unwrap_or(imported_id);
            imported_room_ids.insert(imported_id, resolved_id);
        }

        Ok(Self { imported_room_ids })
    }

    fn resolve_room_id(&self, room_id: i64) -> i64 {
        self.imported_room_ids
            .get(&room_id)
            .copied()
            .unwrap_or(room_id)
    }

    fn contains_imported_room_id(&self, room_id: i64) -> bool {
        self.imported_room_ids.contains_key(&room_id)
    }
}

fn imported_room_refs(imported_rooms: &[Value]) -> Vec<(i64, Option<String>)> {
    imported_rooms
        .iter()
        .filter_map(|row| {
            let obj = row.as_object()?;
            let id = obj.get("id").and_then(value_as_i64)?;
            let room_number = obj
                .get("room_number")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some((id, room_number))
        })
        .collect()
}

async fn validate_room_references(
    tx: &mut DbTransaction<'_>,
    selected_tables: &HashSet<String>,
    tables_and_data: &[(&str, &[Value])],
    room_references: &RoomReferenceResolver,
) -> Result<(), ApiError> {
    let mut room_ids = Vec::new();
    let mut seen = HashSet::new();
    for (table, rows) in tables_and_data {
        if !selected_tables.contains(*table) {
            continue;
        }
        let Some(columns) = room_reference_columns(table) else {
            continue;
        };

        for row in *rows {
            let Some(obj) = row.as_object() else {
                continue;
            };
            for column in columns {
                if let Some(room_id) = obj.get(*column).and_then(value_as_i64) {
                    let resolved_room_id = room_references.resolve_room_id(room_id);
                    if seen.insert(resolved_room_id) {
                        room_ids.push(resolved_room_id);
                    }
                }
            }
        }
    }

    let existing_room_ids = DataTransferRepository::existing_ids(tx, "rooms", &room_ids).await?;
    for (table, rows) in tables_and_data {
        if !selected_tables.contains(*table) {
            continue;
        };
        let Some(columns) = room_reference_columns(table) else {
            continue;
        };

        for (row_index, row) in rows.iter().enumerate() {
            let Some(obj) = row.as_object() else {
                continue;
            };
            for column in columns {
                let Some(room_id) = obj.get(*column).and_then(value_as_i64) else {
                    continue;
                };
                let resolved_room_id = room_references.resolve_room_id(room_id);
                if !room_references.contains_imported_room_id(room_id)
                    && !existing_room_ids.contains(&resolved_room_id)
                {
                    return Err(ApiError::BadRequest(format!(
                        "Import failed for table {} row {}{}: {} references room id {}, but that room is not present in the import file and does not exist in this database. Include Rooms in the import file, import a full backup, or create the missing room before retrying. No changes were saved.",
                        table,
                        row_index + 1,
                        row_reference(obj),
                        column,
                        room_id
                    )));
                }
            }
        }
    }

    Ok(())
}

fn remap_room_references(
    table: &str,
    row: &serde_json::Map<String, Value>,
    room_references: &RoomReferenceResolver,
) -> Result<serde_json::Map<String, Value>, ApiError> {
    let Some(columns) = room_reference_columns(table) else {
        return Ok(row.clone());
    };

    let mut remapped = row.clone();
    let mut changed = false;
    for column in columns {
        let Some(room_id_value) = row.get(*column) else {
            continue;
        };
        let Some(room_id) = value_as_i64(room_id_value) else {
            continue;
        };
        let resolved_room_id = room_references.resolve_room_id(room_id);
        if resolved_room_id != room_id {
            remapped.insert(
                (*column).to_string(),
                Value::Number(resolved_room_id.into()),
            );
            changed = true;
        }
    }

    if changed {
        Ok(remapped)
    } else {
        Ok(row.clone())
    }
}

fn room_reference_columns(table: &str) -> Option<&'static [&'static str]> {
    ROOM_REFERENCE_COLUMNS
        .iter()
        .find_map(|(candidate, columns)| (*candidate == table).then_some(*columns))
}

fn value_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn import_error_detail(error: &ApiError) -> String {
    match error {
        ApiError::BadRequest(message)
        | ApiError::Conflict(message)
        | ApiError::Database(message) => message.clone(),
        _ => error.to_string(),
    }
}

fn selected_import_tables(
    requested_tables: &[String],
    tables_and_data: &[(&str, &[Value])],
) -> Result<HashSet<String>, ApiError> {
    if requested_tables.is_empty() {
        return Ok(tables_and_data
            .iter()
            .filter(|(_, rows)| !rows.is_empty())
            .map(|(table, _)| (*table).to_string())
            .collect());
    }

    let known_tables: HashSet<&str> = tables_and_data.iter().map(|(table, _)| *table).collect();
    let mut selected = HashSet::new();

    for table in requested_tables {
        if !known_tables.contains(table.as_str()) {
            return Err(ApiError::BadRequest(format!(
                "Unknown import table '{}' was requested",
                table
            )));
        }
        selected.insert(table.clone());
    }

    Ok(selected)
}

fn expand_overwrite_clear_tables(selected_tables: &mut HashSet<String>) {
    let mut changed = true;
    while changed {
        changed = false;

        for (child, parent) in OVERWRITE_DELETE_DEPENDENCIES {
            if selected_tables.contains(*parent) && selected_tables.insert((*child).to_string()) {
                changed = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ALL_IMPORT_TABLES, COMPOSITE_PK_TABLES, EXCLUDED_TABLES, Environment,
        KNOWN_EXCLUSION_REASONS, QualifiedTable, RoomReferenceResolver, TABLE_INSERT_ORDER,
        TransferTable, backup_environment, base_generated_columns, build_backup_manifest,
        build_export_header, environment_name, expand_overwrite_clear_tables, export_columns,
        export_doc_prefix, export_doc_suffix, imported_room_refs, remap_room_references,
        selected_import_tables,
    };
    use crate::models::BackupIntegrity;
    use serde_json::{Value, json};
    use std::collections::{BTreeMap, HashMap, HashSet};

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
    fn repository_allowlist_mirrors_table_insert_order() {
        // `repositories::data_transfer::KNOWN_TABLES` is a hand-maintained
        // mirror of the allowlist (a SQL-injection tripwire for interpolated
        // table names); the two must never drift apart.
        assert_eq!(
            crate::repositories::data_transfer::KNOWN_TABLES,
            TABLE_INSERT_ORDER,
            "repositories::KNOWN_TABLES must stay identical to TABLE_INSERT_ORDER"
        );
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
    fn composite_pk_tables_are_part_of_the_order_but_excluded_from_sequence_reset() {
        let sequence_reset: Vec<&str> = TABLE_INSERT_ORDER
            .iter()
            .copied()
            .filter(|table| !COMPOSITE_PK_TABLES.contains(table))
            .collect();
        for table in COMPOSITE_PK_TABLES {
            assert!(
                TABLE_INSERT_ORDER.contains(table),
                "{table} should be transferred"
            );
            assert!(
                !sequence_reset.contains(table),
                "{table} has no serial id and must be skipped on sequence reset"
            );
        }
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

    #[test]
    fn base_generated_columns_include_pg19_booking_virtual_column() {
        let generated_columns = base_generated_columns();
        let booking_columns = generated_columns
            .get("bookings")
            .expect("bookings generated columns should be listed");

        assert!(booking_columns.contains("nights"));
        assert!(booking_columns.contains("total_guests"));
        assert!(booking_columns.contains("tourism_billable_amount"));
    }

    #[test]
    fn selected_import_tables_uses_explicit_table_list_even_when_rows_are_empty() {
        let empty_rows: Vec<Value> = vec![];
        let guest_rows = vec![json!({"id": 1})];
        let tables_and_data = vec![
            ("guests", guest_rows.as_slice()),
            ("loyalty_rewards", empty_rows.as_slice()),
        ];

        let selected = selected_import_tables(
            &["guests".to_string(), "loyalty_rewards".to_string()],
            &tables_and_data,
        )
        .expect("explicit table selection should be accepted");

        assert!(selected.contains("guests"));
        assert!(selected.contains("loyalty_rewards"));
    }

    #[test]
    fn selected_import_tables_keeps_legacy_non_empty_payload_behavior() {
        let empty_rows: Vec<Value> = vec![];
        let guest_rows = vec![json!({"id": 1})];
        let tables_and_data = vec![
            ("guests", guest_rows.as_slice()),
            ("loyalty_rewards", empty_rows.as_slice()),
        ];

        let selected =
            selected_import_tables(&[], &tables_and_data).expect("legacy selection should work");

        assert!(selected.contains("guests"));
        assert!(!selected.contains("loyalty_rewards"));
    }

    #[test]
    fn overwrite_clear_expands_through_fk_blocking_dependents() {
        let mut selected = HashSet::from(["loyalty_tiers".to_string()]);

        expand_overwrite_clear_tables(&mut selected);

        assert!(selected.contains("loyalty_tiers"));
        assert!(selected.contains("loyalty_rewards"));
        assert!(selected.contains("loyalty_redemptions"));
        assert!(selected.contains("loyalty_accounts"));
        assert!(selected.contains("loyalty_transactions"));
        assert!(selected.contains("loyalty_memberships"));
        assert!(selected.contains("points_transactions"));
        assert!(!selected.contains("payments"));
    }

    #[test]
    fn overwrite_clear_expands_through_promotion_dependents() {
        let mut selected = HashSet::from(["promotions".to_string()]);

        expand_overwrite_clear_tables(&mut selected);

        for table in [
            "promotions",
            "promotion_room_types",
            "vouchers",
            "voucher_redemptions",
            "voucher_redemption_allocations",
        ] {
            assert!(selected.contains(table), "{table} should be cleared");
        }
        assert!(!selected.contains("bookings"));
    }

    #[test]
    fn imported_room_refs_collect_ids_and_room_numbers() {
        let rows = vec![
            json!({"id": 1094, "room_number": "101"}),
            json!({"id": "1095", "room_number": "102"}),
            json!({"room_number": "missing-id"}),
        ];

        let refs = imported_room_refs(&rows);

        assert_eq!(
            refs,
            vec![
                (1094, Some("101".to_string())),
                (1095, Some("102".to_string()))
            ]
        );
    }

    #[test]
    fn remap_room_references_uses_resolved_room_id() {
        let resolver = RoomReferenceResolver {
            imported_room_ids: HashMap::from([(1094, 7)]),
        };
        let row = serde_json::Map::from_iter([
            ("id".to_string(), json!(2)),
            ("room_id".to_string(), json!(1094)),
        ]);

        let remapped =
            remap_room_references("housekeeping_tasks", &row, &resolver).expect("row should remap");

        assert_eq!(remapped.get("room_id"), Some(&json!(7)));
        assert_eq!(remapped.get("id"), Some(&json!(2)));
    }

    #[test]
    fn remap_room_references_remaps_multiple_room_columns() {
        let resolver = RoomReferenceResolver {
            imported_room_ids: HashMap::from([(1094, 7), (1095, 8)]),
        };
        let row = serde_json::Map::from_iter([
            ("from_room_id".to_string(), json!(1094)),
            ("to_room_id".to_string(), json!(1095)),
        ]);

        let remapped =
            remap_room_references("room_changes", &row, &resolver).expect("row should remap");

        assert_eq!(remapped.get("from_room_id"), Some(&json!(7)));
        assert_eq!(remapped.get("to_room_id"), Some(&json!(8)));
    }

    #[test]
    fn remap_room_references_leaves_unmapped_room_id() {
        let resolver = RoomReferenceResolver {
            imported_room_ids: HashMap::new(),
        };
        let row = serde_json::Map::from_iter([("room_id".to_string(), json!(1094))]);

        let remapped =
            remap_room_references("bookings", &row, &resolver).expect("row should remain valid");

        assert_eq!(remapped.get("room_id"), Some(&json!(1094)));
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
    fn manifest_builder_lists_every_exclusion_with_its_reason() {
        let manifest = build_backup_manifest(&[]).expect("manifest should build");

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

        let manifest = build_backup_manifest(&[table]).expect("manifest should build");
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
        let header = build_export_header(&[transfer_table("amenities", &["id", "name"], &["id"])])
            .expect("header should build");
        let prefix = export_doc_prefix(&header).expect("prefix should render");

        assert!(
            prefix.starts_with(
                "{\"format\":\"hotel-backup\",\"version\":3,\"kind\":\"business-data\",\"exportId\":\""
            ),
            "prefix must open with the v3 header: {prefix}"
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
    fn empty_export_document_is_valid_v3_json() {
        let header = build_export_header(&[]).expect("header should build");
        let prefix = export_doc_prefix(&header).expect("prefix should render");
        let suffix = export_doc_suffix(&BackupIntegrity {
            entities: 0,
            rows: 0,
            entity_rows: BTreeMap::new(),
            completed_at: chrono::Utc::now().to_rfc3339(),
        })
        .expect("suffix should render");

        let parsed: crate::models::BackupFile = serde_json::from_str(&format!("{prefix}{suffix}"))
            .expect("an empty export must parse as a v3 document");
        assert_eq!(parsed.format, "hotel-backup");
        assert_eq!(parsed.version, 3);
        assert_eq!(parsed.kind, "business-data");
        assert_eq!(parsed.export_id, header.export_id);
        assert_eq!(parsed.application_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(parsed.source.database_provider, "postgresql");
        assert_eq!(parsed.manifest.exclusions.len(), EXCLUDED_TABLES.len());
        assert!(parsed.tables.is_empty());
        assert_eq!(parsed.integrity.rows, 0);
    }
}
