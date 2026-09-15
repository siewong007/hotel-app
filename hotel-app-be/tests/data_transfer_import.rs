//! Regression tests for the schema-driven full-database import.
//!
//! `users` and `guests` reference each other in the V1 baseline
//! (`fk_users_guest` against `guests_created_by_fkey`), so the selected table
//! graph is cyclic on every database this product has ever shipped. Ordering
//! used to reject that outright, which made `POST /api/data-transfer/import`
//! return 400 for every full export -- including restores driven from the Data
//! Transfer admin page.
//!
//! These tests run inside a transaction that is always rolled back, so they are
//! safe against the shared test database and against other test binaries
//! running concurrently. Runs only with `DATABASE_URL` set.

use hotel_app_be::repositories::data_transfer::{DataTransferRepository, transfer_order};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::collections::{HashMap, HashSet};

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!(
                "Skipping PostgreSQL data-transfer import test because DATABASE_URL is not set"
            );
            return None;
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some(pool)
}

/// The live catalog is cyclic, so this is the exact call that used to fail the
/// whole import with 400 "Selected transfer tables contain a circular
/// foreign-key dependency".
#[tokio::test]
async fn every_transferable_table_can_be_ordered_despite_the_users_guests_cycle() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let descriptors = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");

    let names: Vec<String> = descriptors
        .iter()
        .map(|descriptor| descriptor.table.key())
        .collect();
    let dependencies: HashMap<String, HashSet<String>> = descriptors
        .iter()
        .map(|descriptor| (descriptor.table.key(), descriptor.dependencies.clone()))
        .collect();

    // Prove the fixture is actually cyclic, or this test would pass on a
    // schema that never exercised the bug.
    assert!(
        dependencies["public.users"].contains("public.guests")
            && dependencies["public.guests"].contains("public.users"),
        "expected the users <-> guests cycle; got users={:?} guests={:?}",
        dependencies["public.users"],
        dependencies["public.guests"]
    );

    let order = transfer_order(&names, &dependencies).expect("a cyclic catalog must still order");

    let mut sorted_order = order.clone();
    sorted_order.sort();
    let mut sorted_names = names.clone();
    sorted_names.sort();
    assert_eq!(
        sorted_order, sorted_names,
        "ordering must emit every selected table exactly once"
    );

    // Edges outside the cycle must still be honoured, otherwise the import
    // would insert children before their parents for no reason.
    let position = |table: &str| order.iter().position(|name| name == table);
    let (bookings, rooms) = (position("public.bookings"), position("public.rooms"));
    if let (Some(bookings), Some(rooms)) = (bookings, rooms) {
        assert!(
            rooms < bookings,
            "rooms must still be inserted before bookings; got {order:?}"
        );
    }
}

/// Deferring is what actually makes a cyclic restore possible: with the
/// constraints immediate, no insert order satisfies both directions at once.
/// The rows here populate both sides of the cycle, which is the case ordering
/// alone can never solve.
#[tokio::test]
async fn relaxed_foreign_keys_allow_cyclic_rows_and_are_restored_afterwards() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let descriptors = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");
    let cycle: Vec<_> = descriptors
        .iter()
        .filter(|descriptor| {
            matches!(
                descriptor.table.key().as_str(),
                "public.users" | "public.guests"
            )
        })
        .cloned()
        .collect();
    assert_eq!(cycle.len(), 2, "expected both cycle tables in the catalog");

    let mut tx = pool.begin().await.expect("begin");

    let relaxed = DataTransferRepository::relax_foreign_keys(&mut tx, &cycle)
        .await
        .expect("relaxing the cycle's foreign keys must succeed");
    assert!(
        !relaxed.is_empty(),
        "fk_users_guest is immediate in the baseline, so something must have been relaxed"
    );

    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *tx)
        .await
        .expect("deferring constraints must succeed");

    // Insert the child before the parent in BOTH directions. Either statement
    // alone violates an immediate foreign key; both together are only legal
    // because the checks are deferred to the end of the transaction.
    let guest_id: i64 = 920_931_001;
    let user_id: i64 = 920_931_002;

    sqlx::query(
        "INSERT INTO guests (id, nick_name, created_by, updated_by) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $3)",
    )
    .bind(guest_id)
    .bind(format!("transfer-cycle-{guest_id}"))
    .bind(user_id) // references a user that does not exist yet
    .execute(&mut *tx)
    .await
    .expect("deferred foreign keys must permit a forward reference to users");

    sqlx::query(
        "INSERT INTO users (id, username, email, password_hash, guest_id) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(user_id)
    .bind(format!("transfer-cycle-{user_id}"))
    .bind(format!("transfer-cycle-{user_id}@no-email.invalid"))
    .bind("not-a-real-hash")
    .bind(guest_id)
    .execute(&mut *tx)
    .await
    .expect("the closing half of the cycle must insert too");

    // Nothing is skipped: forcing the checks proves the rows are consistent.
    sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut *tx)
        .await
        .expect("the deferred foreign keys must validate once both rows exist");

    DataTransferRepository::restore_foreign_keys(&mut tx, &relaxed)
        .await
        .expect("restoring the foreign keys must succeed");

    // An import must leave the schema exactly as it found it, or the next
    // pg_dump convergence check reports permanent drift.
    let still_deferrable: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_constraint \
         WHERE contype = 'f' AND condeferrable AND conname = 'fk_users_guest'",
    )
    .fetch_one(&mut *tx)
    .await
    .expect("reading constraint state must succeed");
    assert_eq!(
        still_deferrable, 0,
        "fk_users_guest must be immediate again once the import finishes"
    );

    tx.rollback().await.expect("rollback");
}

/// Credential, role and session tables must never enter through the import:
/// the catalog validation used to accept any `public` table, so a
/// `settings:manage` holder could have imported a forged `is_super_admin`
/// user. A staged file carrying `public.users` rows is imported with the
/// entity reported as unsupported and the rows never written; naming the
/// table in the `tables` selection is rejected outright.
#[tokio::test]
async fn staged_import_never_writes_credential_tables() {
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{BackupImportMode, ImportExecuteRequest, ImportJobState};
    use hotel_app_be::services::data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let file = serde_json::to_vec(&serde_json::json!({
        "format": "hotel-backup",
        "version": 1,
        "kind": "business-data",
        "exportId": "11111111-2222-3333-4444-555555555555",
        "exportedAt": "2026-09-14T12:00:00Z",
        "applicationVersion": "0.2.0",
        "source": {"environment": "development", "databaseProvider": "postgresql"},
        "manifest": {"entities": [], "exclusions": []},
        "tables": {
            "public.amenities": [],
            "public.users": [{
                "id": 999_999_991_i64,
                "username": "forged-admin-920931",
                "email": "forged@example.invalid",
                "password_hash": "x",
                "is_super_admin": true
            }]
        },
        "integrity": {
            "entities": 2,
            "rows": 1,
            "entityRows": {"public.amenities": 0, "public.users": 1},
            "completedAt": "2026-09-14T12:00:01Z"
        }
    }))
    .expect("v1 fixture serializes");

    let upload = data_transfer_jobs::stage_backup_upload(axum::body::Body::from(file))
        .await
        .expect("staging a well-formed v1 body must succeed");

    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id)
        .await
        .expect("preview must answer for a staged upload");
    assert!(
        preview
            .warnings
            .iter()
            .any(|warning| warning.contains("public.users")),
        "the preview must warn that public.users is excluded: {:?}",
        preview.warnings
    );

    // Selecting the table by name is rejected before a job spawns.
    let rejected = data_transfer_jobs::start_import_job(
        &pool,
        1,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: None,
            tables: vec!["public.users".to_string()],
            confirm: true,
        },
    )
    .await;
    assert!(
        matches!(&rejected, Err(ApiError::BadRequest(message)) if message.contains("not permitted")),
        "a selection naming public.users must be rejected outright: {rejected:?}"
    );

    // Running the file as-is must leave the forged row unwritten.
    let job = data_transfer_jobs::start_import_job(
        &pool,
        1,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: None,
            tables: vec![],
            confirm: true,
        },
    )
    .await
    .expect("a confirmed execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "import job failed: {:?}",
        status.error
    );
    let result = status.result.expect("a succeeded job carries its result");
    assert!(
        result
            .report
            .unsupported_entities
            .iter()
            .any(|entity| entity == "public.users"),
        "public.users must be reported as unsupported: {:?}",
        result.report.unsupported_entities
    );

    let forged: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE username = 'forged-admin-920931'")
            .fetch_one(&pool)
            .await
            .expect("user existence check must run");
    assert_eq!(
        forged, 0,
        "a forged is_super_admin user must never be written"
    );
}

/// A violation must still fail the import rather than commit. Deferring moves
/// the check; it must not lose it.
#[tokio::test]
async fn deferred_foreign_keys_still_reject_a_dangling_reference() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let descriptors = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");
    let guests: Vec<_> = descriptors
        .iter()
        .filter(|descriptor| descriptor.table.key() == "public.guests")
        .cloned()
        .collect();
    assert_eq!(guests.len(), 1, "expected public.guests in the catalog");

    let mut tx = pool.begin().await.expect("begin");
    DataTransferRepository::relax_foreign_keys(&mut tx, &guests)
        .await
        .expect("relax");
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *tx)
        .await
        .expect("defer");

    sqlx::query(
        "INSERT INTO guests (id, nick_name, created_by) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)",
    )
    .bind(920_931_003_i64)
    .bind("transfer-cycle-dangling")
    .bind(920_931_999_i64) // no such user, and none will be inserted
    .execute(&mut *tx)
    .await
    .expect("the insert itself is deferred, so it succeeds here");

    let forced = sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut *tx)
        .await;
    assert!(
        forced.is_err(),
        "a dangling created_by must still be caught when the checks are forced"
    );

    tx.rollback().await.expect("rollback");
}

// ----- Staged upload → preview → execute → poll pipeline. ------------------
// Unlike the transaction-scoped tests above, the import job commits through
// its own transaction on the pool, so these tests clean their fixture rows up
// explicitly at the end.

fn v1_document(table: &str, rows: serde_json::Value) -> Vec<u8> {
    let row_count = rows.as_array().map_or(0, Vec::len);
    serde_json::to_vec(&serde_json::json!({
        "format": "hotel-backup",
        "version": 1,
        "kind": "business-data",
        "exportId": "11111111-2222-3333-4444-555555555555",
        "exportedAt": "2026-09-14T12:00:00Z",
        "applicationVersion": "0.2.0",
        "source": {"environment": "development", "databaseProvider": "postgresql"},
        "manifest": {
            "entities": [{"name": table, "primaryKey": ["id"], "columns": ["id", "name", "category"]}],
            "exclusions": []
        },
        "tables": {table: rows},
        "integrity": {
            "entities": 1,
            "rows": row_count,
            "entityRows": {table: row_count},
            "completedAt": "2026-09-14T12:00:01Z"
        }
    }))
    .expect("v1 fixture serializes")
}

/// A minimal `BookingDataExport` (v1) — every field without `serde(default)`
/// must be present even when empty.
fn legacy_v1_fixture() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
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
        "room_changes": [],
        "amenities": [
            {"id": 920_999_022_i64, "name": "transfer-test-v1-a", "category": "v1"}
        ]
    }))
    .expect("v1 fixture serializes")
}

/// Poll the registry until the job leaves `running` (or time out).
async fn wait_for_job(job_id: uuid::Uuid) -> hotel_app_be::models::ImportJobStatus {
    use hotel_app_be::models::ImportJobState;
    use hotel_app_be::services::data_transfer_jobs::import_job_status;
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let status = import_job_status(job_id).expect("registered job must be queryable");
        if status.status != ImportJobState::Running {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "import job did not finish within 30s"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Merge + skip: the file lands, progress/report are queryable, and the
/// staged file is consumed.
#[tokio::test]
async fn staged_v1_upload_previews_executes_and_cleans_up() {
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::services::data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    // The job commits through its own transaction, so fixtures from a failed
    // earlier run can linger — clear them up front instead of asserting on a
    // clean slate.
    sqlx::query("DELETE FROM amenities WHERE id IN (920999001, 920999002)")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    let rows = serde_json::json!([
        {"id": 920_999_001_i64, "name": "transfer-test-amenity-a", "category": "test"},
        {"id": 920_999_002_i64, "name": "transfer-test-amenity-b", "category": "test"}
    ]);
    let body = axum::body::Body::from(v1_document("public.amenities", rows));

    let upload = data_transfer_jobs::stage_backup_upload(body)
        .await
        .expect("staging a well-formed v1 body must succeed");
    assert_eq!(upload.detected_format, "v1");
    assert!(upload.bytes > 0);

    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id)
        .await
        .expect("preview must answer for a staged upload");
    assert_eq!(preview.format, "v1");
    let amenities = preview
        .entities
        .iter()
        .find(|entity| entity.name == "public.amenities")
        .expect("the fixture entity must appear in the preview");
    assert_eq!(amenities.rows, 2);
    assert_eq!(
        amenities.existing,
        Some(0),
        "fixture ids must not collide with the dev database"
    );
    assert_eq!(amenities.new, Some(2));
    assert_eq!(preview.total_rows, 2);

    let job = data_transfer_jobs::start_import_job(
        &pool,
        1,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
        },
    )
    .await
    .expect("a confirmed execute must return a job id");

    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "import job failed: {:?}",
        status.error
    );
    let result = status.result.expect("a succeeded job carries its result");
    assert_eq!(result.inserted, 2);
    let outcome = result
        .report
        .entities
        .iter()
        .find(|entity| entity.entity == "public.amenities")
        .expect("the report must list the imported entity");
    assert_eq!(outcome.inserted, 2);

    // The job deletes its staged file — a second preview/preview-by-id must 404.
    let gone = data_transfer_jobs::preview_import(&pool, upload.upload_id).await;
    assert!(
        matches!(gone, Err(ApiError::NotFound(_))),
        "a consumed upload must not be previewable again: {gone:?}"
    );

    let cleaned = sqlx::query("DELETE FROM amenities WHERE id IN (920999001, 920999002)")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
    assert_eq!(cleaned.rows_affected(), 2);
}

/// Merge + update rewrites non-key columns on a primary-key hit; merge + fail
/// aborts the job on the same file.
#[tokio::test]
async fn staged_v1_merge_update_and_fail_conflict_policies() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::services::data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    sqlx::query("DELETE FROM amenities WHERE id IN (920999011, 920999012)")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    let seed_rows = serde_json::json!([
        {"id": 920_999_011_i64, "name": "transfer-test-update-a", "category": "before"},
        {"id": 920_999_012_i64, "name": "transfer-test-update-b", "category": "before"}
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(axum::body::Body::from(v1_document(
        "public.amenities",
        seed_rows,
    )))
    .await
    .expect("staging");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        1,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
        },
    )
    .await
    .expect("seed execute");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(status.status, ImportJobState::Succeeded);

    // Update: same primary keys, changed columns — both rows must be rewritten.
    let changed_rows = serde_json::json!([
        {"id": 920_999_011_i64, "name": "transfer-test-update-a", "category": "after"},
        {"id": 920_999_012_i64, "name": "transfer-test-update-b", "category": "after"}
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(axum::body::Body::from(v1_document(
        "public.amenities",
        changed_rows,
    )))
    .await
    .expect("staging");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        1,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Update),
            tables: vec![],
            confirm: true,
        },
    )
    .await
    .expect("update execute");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "update job failed: {:?}",
        status.error
    );
    assert_eq!(status.result.as_ref().map(|r| r.updated), Some(2));
    let updated: Vec<String> = sqlx::query_scalar(
        "SELECT category FROM amenities WHERE id IN (920999011, 920999012) ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .expect("reading fixture rows");
    assert_eq!(updated, vec!["after".to_string(), "after".to_string()]);

    // Fail: the same keys under `fail` must abort the job and roll the whole
    // transaction back — no row may change.
    let conflict_rows = serde_json::json!([
        {"id": 920_999_011_i64, "name": "transfer-test-update-a", "category": "never"},
        {"id": 920_999_012_i64, "name": "transfer-test-update-b", "category": "never"}
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(axum::body::Body::from(v1_document(
        "public.amenities",
        conflict_rows,
    )))
    .await
    .expect("staging");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        1,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Fail),
            tables: vec![],
            confirm: true,
        },
    )
    .await
    .expect("fail execute");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Failed,
        "fail policy must abort on the duplicate primary key"
    );
    let unchanged: Vec<String> = sqlx::query_scalar(
        "SELECT category FROM amenities WHERE id IN (920999011, 920999012) ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .expect("reading fixture rows");
    assert_eq!(
        unchanged,
        vec!["after".to_string(), "after".to_string()],
        "a failed job must leave the destination untouched"
    );

    sqlx::query("DELETE FROM amenities WHERE id IN (920999011, 920999012)")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// Every retired export shape is refused, not migrated: the v2 `tables` map,
/// the flat v1 `BookingDataExport`, and `hotel-backup` documents stamped with
/// an earlier version all stage (the upload guard only sniffs), then fail at
/// preview and inside the job with the retired-format error. Nothing they
/// carry ever reaches a table.
#[tokio::test]
async fn retired_backup_formats_are_rejected() {
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::services::data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    // v2: schema-qualified `tables` map.
    let v2 = serde_json::to_vec(&serde_json::json!({
        "version": "2.0",
        "exported_at": "2026-07-27T00:00:00Z",
        "tables": {
            "public.amenities": [
                {"id": 920_999_021_i64, "name": "transfer-test-v2-a", "category": "v2"}
            ]
        }
    }))
    .expect("v2 fixture serializes");
    // The retired structured shape: the current document restamped v3.
    let mut v3 = serde_json::from_slice::<serde_json::Value>(&v1_document(
        "public.amenities",
        serde_json::json!([{"id": 920_999_023_i64, "name": "transfer-test-v3-a", "category": "v3"}]),
    ))
    .expect("fixture parses");
    v3["version"] = serde_json::json!(3);
    let fixtures: Vec<(&str, Vec<u8>)> = vec![
        ("v2", v2),
        ("flat-v1", legacy_v1_fixture()),
        ("hotel-backup-v3", serde_json::to_vec(&v3).expect("v3 fixture serializes")),
    ];

    for (label, bytes) in fixtures {
        let upload = data_transfer_jobs::stage_backup_upload(axum::body::Body::from(bytes))
            .await
            .unwrap_or_else(|error| panic!("{label} must still stage: {error:?}"));
        assert_eq!(
            upload.detected_format, "legacy",
            "{label} must be detected as a retired format"
        );

        let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id).await;
        match preview {
            Err(ApiError::BadRequest(message)) => assert!(
                message.contains("retired"),
                "{label} preview must name the retired format: {message}"
            ),
            other => panic!("{label} preview must reject the retired format: {other:?}"),
        }

        let job = data_transfer_jobs::start_import_job(
            &pool,
            1,
            ImportExecuteRequest {
                upload_id: upload.upload_id,
                mode: BackupImportMode::Merge,
                on_conflict: Some(ConflictPolicy::Skip),
                tables: vec![],
                confirm: true,
            },
        )
        .await
        .expect("execute registers the job even for a doomed file");
        let status = wait_for_job(job.job_id).await;
        assert_eq!(
            status.status,
            ImportJobState::Failed,
            "{label} job must fail, not import"
        );
        assert!(
            status
                .error
                .as_deref()
                .is_some_and(|error| error.contains("retired")),
            "{label} job error must name the retired format: {:?}",
            status.error
        );
    }

    // And the proof nothing slipped through: none of the fixture rows exist.
    let leftover: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM amenities WHERE id IN (920999021, 920999022, 920999023)",
    )
    .fetch_optional(&pool)
    .await
    .expect("reading for leaked fixture rows");
    assert_eq!(leftover, None, "a retired format wrote rows");
}

/// Guardrails around the pipeline: a non-object body is refused at upload, an
/// unconfirmed execute is refused, and a deleted upload cannot be previewed.
#[tokio::test]
async fn staged_upload_guardrails() {
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{BackupImportMode, ImportExecuteRequest};
    use hotel_app_be::services::data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    // Non-JSON-object body → rejected before a byte is written to disk.
    let rejected = data_transfer_jobs::stage_backup_upload(axum::body::Body::from("[1,2,3]")).await;
    assert!(matches!(
        rejected,
        Err(data_transfer_jobs::StageUploadError::BadRequest(_))
    ));

    // A staged file whose object shape parses to nothing recognizable still
    // stores, but preview surfaces the validation error.
    let upload = data_transfer_jobs::stage_backup_upload(axum::body::Body::from(
        br#"{"completely":"unrelated"}"#.to_vec(),
    ))
    .await
    .expect("unknown-but-object content must still stage");
    assert_eq!(upload.detected_format, "unknown");
    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id).await;
    assert!(
        matches!(preview, Err(ApiError::BadRequest(_))),
        "an unparseable staged file must surface a validation error: {preview:?}"
    );

    // confirm=false refuses before a job exists.
    let refused = data_transfer_jobs::start_import_job(
        &pool,
        1,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: None,
            tables: vec![],
            confirm: false,
        },
    )
    .await;
    assert!(
        matches!(refused, Err(ApiError::BadRequest(_))),
        "execute without confirm=true must be refused: {refused:?}"
    );

    // DELETE discards the staged file; previewing it afterwards is a 404.
    data_transfer_jobs::delete_staged_upload(upload.upload_id)
        .await
        .expect("deleting a staged upload");
    let gone = data_transfer_jobs::preview_import(&pool, upload.upload_id).await;
    assert!(matches!(gone, Err(ApiError::NotFound(_))));

    // A never-staged id is a 404 too.
    let missing = data_transfer_jobs::preview_import(&pool, uuid::Uuid::new_v4()).await;
    assert!(matches!(missing, Err(ApiError::NotFound(_))));
}

/// The preview's batched `pk = ANY($1)` lookup must pick its bind type from
/// the column's declared type, not the file's value shapes: an all-numeric
/// id set on a `varchar` key column used to bind `bigint[]` and fail the
/// preview with a type error. No transferable table currently has a
/// varchar primary key, so this drives the same repository call through a
/// synthetic descriptor pointing at `amenities.name`.
#[tokio::test]
async fn text_key_columns_bind_text_even_for_numeric_keys() {
    use hotel_app_be::repositories::data_transfer::{
        DataTransferRepository, PkLookup, QualifiedTable, TransferTable,
    };

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    sqlx::query("DELETE FROM amenities WHERE id = 920999051")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    let table = QualifiedTable {
        schema: "public".to_string(),
        name: "amenities".to_string(),
    };
    // The declared types drive the binding: int8 -> Int, varchar -> Text.
    let id_udt = DataTransferRepository::column_udt_name(&pool, &table, "id")
        .await
        .expect("the udt lookup must run");
    assert_eq!(id_udt.as_deref(), Some("int8"));
    let name_udt = DataTransferRepository::column_udt_name(&pool, &table, "name")
        .await
        .expect("the udt lookup must run");
    assert_eq!(name_udt.as_deref(), Some("varchar"));

    // A varchar column holding a numeric-looking value — the shape that used
    // to make the file-side sniff choose bigint[] and error the preview.
    sqlx::query(
        "INSERT INTO amenities (id, name, category) OVERRIDING SYSTEM VALUE VALUES (920999051, '920999007', 'transfer-test')",
    )
    .execute(&pool)
    .await
    .expect("fixture insert must run");

    let descriptor = TransferTable {
        table,
        is_partitioned: false,
        columns: HashSet::new(),
        ordered_columns: Vec::new(),
        generated_columns: HashSet::new(),
        primary_key_columns: vec!["name".to_string()],
        dependencies: HashSet::new(),
    };
    let found = DataTransferRepository::existing_pk_values(
        &pool,
        &descriptor,
        &PkLookup::Text(vec!["920999007".to_string(), "absent".to_string()]),
    )
    .await
    .expect("a text[] bind against a varchar column must not error");
    assert!(found.contains("920999007"));
    assert!(!found.contains("absent"));

    sqlx::query("DELETE FROM amenities WHERE id = 920999051")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// A reference into a TRANSFERABLE parent whose key is in neither the file
/// nor the destination inserts cleanly and then fails the deferred
/// foreign-key check at commit — the preview must report it instead of
/// showing an all-new diff, and the job must still fail and roll back.
#[tokio::test]
async fn preview_flags_transferable_parent_keys_absent_from_file_and_database() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::services::data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    sqlx::query("DELETE FROM guest_notes WHERE id = 920999041")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    let guest_absent: bool =
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM guests WHERE id = 920999998)")
            .fetch_one(&pool)
            .await
            .expect("guest probe must run");
    assert!(guest_absent, "the fixture guest id must not exist");

    // guest_notes.guest_id -> guests.id: both transferable, but the file
    // carries only the child and the database has no such guest.
    let rows = serde_json::json!([
        {"id": 920_999_041_i64, "guest_id": 920_999_998_i64, "content": "dangling ref"}
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(axum::body::Body::from(v1_document(
        "public.guest_notes",
        rows,
    )))
    .await
    .expect("staging");

    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id)
        .await
        .expect("preview must answer");
    let notes = preview
        .entities
        .iter()
        .find(|entity| entity.name == "public.guest_notes")
        .expect("the fixture entity must appear in the preview");
    // The row is neither skipped nor pre-existing — it would insert and the
    // job would die at commit, which is what the problem entry must say.
    assert_eq!(notes.new, Some(1));
    assert_eq!(notes.skipped, Some(0));
    let problem = preview
        .relationship_problems
        .iter()
        .find(|problem| problem.entity == "public.guest_notes")
        .expect("the dangling transferable-parent reference must be reported");
    assert_eq!(problem.rows, 1);
    assert!(
        problem.reason.contains("fail") && problem.reason.contains("public.guests"),
        "the reason must name the unresolvable parent: {:?}",
        problem.reason
    );
    assert!(
        preview
            .warnings
            .iter()
            .any(|warning| warning.contains("fail at commit")),
        "a summary warning must accompany the problem entry: {:?}",
        preview.warnings
    );

    // Positive control: a file whose child references a guest that EXISTS in
    // the database reports no such problem. Seed our own guest — a fresh
    // baseline+seed database has none.
    sqlx::query(
        "INSERT INTO guests (id, nick_name) OVERRIDING SYSTEM VALUE \
         VALUES (920999013, 'dt-parent-probe') \
         ON CONFLICT (id) DO UPDATE SET nick_name = EXCLUDED.nick_name",
    )
    .execute(&pool)
    .await
    .expect("guest fixture must insert");
    let real_guest: i64 = 920_999_013;
    let ok_rows = serde_json::json!([
        {"id": 920_999_042_i64, "guest_id": real_guest, "content": "resolvable ref"}
    ]);
    let ok_upload = data_transfer_jobs::stage_backup_upload(axum::body::Body::from(v1_document(
        "public.guest_notes",
        ok_rows,
    )))
    .await
    .expect("staging");
    let ok_preview = data_transfer_jobs::preview_import(&pool, ok_upload.upload_id)
        .await
        .expect("preview must answer");
    assert!(
        !ok_preview
            .relationship_problems
            .iter()
            .any(|problem| problem.entity == "public.guest_notes"),
        "a resolvable reference must not be reported: {:?}",
        ok_preview.relationship_problems
    );
    data_transfer_jobs::delete_staged_upload(ok_upload.upload_id)
        .await
        .expect("the positive-control upload deletes cleanly");

    // And the job itself still fails and rolls back — the preview warns, the
    // commit-time check remains the backstop.
    let job = data_transfer_jobs::start_import_job(
        &pool,
        1,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
        },
    )
    .await
    .expect("execute must accept the confirmed request");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Failed,
        "a reference absent from file and database must fail at commit"
    );
    let rolled_back: bool =
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM guest_notes WHERE id = 920999041)")
            .fetch_one(&pool)
            .await
            .expect("rollback probe must run");
    assert!(rolled_back, "the failed job must leave no partial rows");
    sqlx::query("DELETE FROM guests WHERE id = 920999013")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}
