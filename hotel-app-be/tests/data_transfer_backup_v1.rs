//! Deeper end-to-end coverage for the `hotel-backup` v1 pipeline that the
//! sibling suites do not exercise:
//!
//! - special-type round-trips (`uuid`, `numeric`, `timestamptz`, `bool`,
//!   `date`, `text[]`, enums, `NULL` through `guests`; `jsonb` through
//!   `email_templates`; `bytea` through a scratch table — no transferable
//!   table has a `bytea` column, so the export cursor and the import row
//!   insert are driven directly against `_dt_backup_roundtrip` inside a
//!   rolled-back transaction),
//! - foreign-key preservation (a `guest_notes` row still points at its
//!   re-imported `guests` parent id),
//! - `restore` mode clearing the selection plus expanded dependents,
//! - the missing-`users`-reference policy (audit columns remap to the
//!   importing admin; a required non-audit reference skips the row and lands
//!   in `relationshipProblems`),
//! - malformed/unsupported inputs (truncated JSON, `version: 99`, wrong
//!   `format`, an entity this schema does not have, a file carrying the
//!   excluded `public.users`),
//! - job lifecycle (`running` -> `succeeded`/`failed` with progress, and the
//!   staged file deleted on both paths),
//! - preview diff accuracy on single- and composite-primary-key tables, and
//! - the super-admin gate on every import endpoint, over real HTTP.
//!
//! Fixture rows use `920_94x`/`920_9 4xx` sentinel ids and are deleted at the
//! end of each test — the job commits through its own transaction, so
//! pre-clean + post-clean keeps the shared dev database unchanged. Runs only
//! with `DATABASE_URL` set.

use axum::body::Body;
use hotel_app_be::models::ImportJobStatus;
use serde_json::{Map, Value, json};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::collections::HashSet;

/// These tests commit real rows through the job pipeline — they cannot share
/// one rolled-back transaction like `data_transfer_import`'s repository-level
/// tests. Several touch the same tables (`amenities` especially), and tests
/// in one binary run on parallel threads, so every fixture-bearing test
/// holds this lock for its whole body: a snapshot taken by one test can
/// never interleave with another test's insert or cleanup.
static FIXTURE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping PostgreSQL data-transfer v1 test because DATABASE_URL is not set");
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

/// One entity in a fixture document: qualified name, primary-key columns
/// (for the manifest descriptor), and the file's rows.
struct V1Entity<'a> {
    name: &'a str,
    primary_key: &'a [&'a str],
    rows: Vec<Value>,
}

/// Serialize a v1 `hotel-backup` document whose manifest and integrity
/// trailer agree with the `tables` payload — preview cross-checks both, so a
/// fixture that lies about its own contents would produce trailer warnings
/// rather than the signal under test.
fn v1_document(entities: &[V1Entity]) -> Vec<u8> {
    let mut tables = Map::new();
    let mut entity_rows = Map::new();
    let mut manifest_entities = Vec::new();
    let mut total = 0_u64;
    for entity in entities {
        let columns: Vec<String> = entity
            .rows
            .iter()
            .flat_map(|row| {
                row.as_object()
                    .into_iter()
                    .flatten()
                    .map(|(key, _)| key.clone())
            })
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        manifest_entities.push(json!({
            "name": entity.name,
            "primaryKey": entity.primary_key,
            "columns": columns,
        }));
        entity_rows.insert(entity.name.to_string(), (entity.rows.len() as u64).into());
        total += entity.rows.len() as u64;
        tables.insert(entity.name.to_string(), Value::Array(entity.rows.clone()));
    }

    serde_json::to_vec(&json!({
        "format": "hotel-backup",
        "version": 1,
        "kind": "business-data",
        "exportId": "11111111-2222-3333-4444-555555555555",
        "exportedAt": "2026-09-14T12:00:00Z",
        "applicationVersion": env!("CARGO_PKG_VERSION"),
        "source": {"environment": "development", "databaseProvider": "postgresql"},
        "manifest": {"entities": manifest_entities, "exclusions": []},
        "tables": tables,
        "integrity": {
            "entities": entities.len(),
            "rows": total,
            "entityRows": entity_rows,
            "completedAt": "2026-09-14T12:00:01Z"
        }
    }))
    .expect("v1 fixture serializes")
}

/// Poll the registry until the job leaves `running` (or time out).
async fn wait_for_job(job_id: uuid::Uuid) -> ImportJobStatus {
    use hotel_app_be::models::ImportJobState;
    use hotel_app_be::modules::data_transfer::jobs::import_job_status;
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

/// The staged file the registry/job machinery would have left behind.
fn staged_file_path(upload_id: uuid::Uuid) -> std::path::PathBuf {
    hotel_app_be::modules::data_transfer::jobs::staged_upload_dir()
        .join(format!("upload-{upload_id}.json"))
}

/// An existing user id — the missing-reference policy remaps dangling audit
/// columns to the importing admin, which must satisfy `REFERENCES users(id)`.
async fn any_user_id(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("the dev database has at least one user")
}

/// `uuid`, `numeric`, `timestamptz`, `bool`, `date`, `text[]`, enums and
/// `NULL` on `guests` plus `jsonb` on `email_templates`: the row the export
/// emits must equal what the database stores, and the re-imported row must
/// equal it again — `row_to_json` text on both sides of the pipeline.
#[tokio::test]
async fn special_types_survive_export_and_reimport() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::service::export_booking_data_body;
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM email_templates WHERE id = 920941002")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    sqlx::query("DELETE FROM guests WHERE id = 920941001")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    // Every exotic column on `guests` set at once: multi-byte UTF-8, a leap
    // date, a quoted array element, enum labels, microsecond timestamps, and
    // NULLs on the nullable columns the INSERT omits.
    sqlx::query(
        "INSERT INTO guests (id, uuid, nick_name, first_name, last_name, email, phone, \
            date_of_birth, nationality, id_type, id_number, language_preference, \
            communication_preference, marketing_opt_in, notes, tags, total_stays, \
            total_spend, average_rating, is_blacklisted, blacklist_reason, is_active, \
            guest_type, discount_percentage, tourism_type, created_at, updated_at) \
         OVERRIDING SYSTEM VALUE VALUES (\
            920941001, '019a4f20-7c01-7b9e-9f01-920941001001', 'dt-roundtrip', \
            'Röund', 'Trip—€', 'dt-roundtrip@example.invalid', '+60123456789', \
            '1988-02-29', 'Malaysian', 'passport', 'A12345678', 'ms', 'sms', \
            true, NULL, ARRAY['α-vip', 'quote \"me\"']::text[], 7, 123456.78, \
            4.50, true, 'repeat ÷ offender', true, 'member', 15, 'foreign', \
            '2026-01-02T03:04:05.123456+00:00'::timestamptz, \
            '2026-02-03T04:05:06.654321+00:00'::timestamptz)",
    )
    .execute(&pool)
    .await
    .expect("guest fixture must insert");

    // `jsonb` coverage: nested arrays/objects/null through a nullable column.
    sqlx::query(
        "INSERT INTO email_templates (id, code, name, subject, body_html, body_text, \
            variables, is_active, created_at, updated_at) \
         OVERRIDING SYSTEM VALUE VALUES (\
            920941002, 'dt_roundtrip', 'DT Roundtrip', 'Subj €', '<p>x</p>', 'x', \
            '{\"nested\":{\"arr\":[1,2.5,null,true,\"x\"],\"obj\":{\"k\":\"v\"}},\
              \"empty\":{},\"null\":null}'::jsonb, \
            false, '2026-03-04T05:06:07.765432+00:00'::timestamptz, \
            '2026-03-04T05:06:07.765432+00:00'::timestamptz)",
    )
    .execute(&pool)
    .await
    .expect("email template fixture must insert");

    // Ground truth: the stored rows exactly as PostgreSQL sees them.
    let stored_guest: Value = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM guests WHERE id = 920941001) t",
    )
    .fetch_one(&pool)
    .await
    .expect("guest row_to_json must run");
    let stored_template: Value = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM email_templates WHERE id = 920941002) t",
    )
    .fetch_one(&pool)
    .await
    .expect("template row_to_json must run");

    // The real export path — the fixture rows must appear verbatim.
    let body = export_booking_data_body(&pool, 0, hotel_app_be::models::ExportScope::Full, None)
        .await
        .expect("streamed export must build");
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .expect("export body must collect");
    let document: Value = serde_json::from_slice(&bytes).expect("export must be valid JSON");
    let exported_guest = document["tables"]["public.guests"]
        .as_array()
        .expect("guests must be an array")
        .iter()
        .find(|row| row["id"].as_i64() == Some(920_941_001))
        .cloned()
        .expect("the export must carry the fixture guest");
    let exported_template = document["tables"]["public.email_templates"]
        .as_array()
        .expect("email_templates must be an array")
        .iter()
        .find(|row| row["id"].as_i64() == Some(920_941_002))
        .cloned()
        .expect("the export must carry the fixture template");
    assert_eq!(
        exported_guest, stored_guest,
        "the exported guest row must equal the stored row"
    );
    assert_eq!(
        exported_template, stored_template,
        "the exported template row must equal the stored row"
    );

    // Cleaned state: delete both rows, then re-import the exported payload
    // through the staged pipeline.
    sqlx::query("DELETE FROM email_templates WHERE id = 920941002")
        .execute(&pool)
        .await
        .expect("cleaning the template fixture must run");
    sqlx::query("DELETE FROM guests WHERE id = 920941001")
        .execute(&pool)
        .await
        .expect("cleaning the guest fixture must run");

    let file = v1_document(&[
        V1Entity {
            name: "public.email_templates",
            primary_key: &["id"],
            rows: vec![exported_template],
        },
        V1Entity {
            name: "public.guests",
            primary_key: &["id"],
            rows: vec![exported_guest],
        },
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the round-trip document must stage");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        any_user_id(&pool).await,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("a confirmed execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "the round-trip import failed: {:?}",
        status.error
    );
    assert_eq!(status.result.as_ref().map(|r| r.inserted), Some(2));

    let reloaded_guest: Value = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM guests WHERE id = 920941001) t",
    )
    .fetch_one(&pool)
    .await
    .expect("the re-imported guest must exist");
    let reloaded_template: Value = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM email_templates WHERE id = 920941002) t",
    )
    .fetch_one(&pool)
    .await
    .expect("the re-imported template must exist");
    assert_eq!(
        reloaded_guest, stored_guest,
        "every guest column must round-trip byte-identical"
    );
    assert_eq!(
        reloaded_template, stored_template,
        "every template column (jsonb included) must round-trip byte-identical"
    );

    sqlx::query("DELETE FROM email_templates WHERE id = 920941002")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
    sqlx::query("DELETE FROM guests WHERE id = 920941001")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// `bytea` is not on any transferable table — the schema keeps it only on
/// excluded passkey tables — so this drives the pipeline's two ends directly
/// against a scratch table: the streamed export's cursor (`row_to_json` emits
/// `\x…` hex text) and the job's `jsonb_populate_record` insert (which must
/// decode it back). `numeric`, `uuid`, `timestamptz`, `bool`, `jsonb` and
/// `NULL` ride along on the same row. Everything happens inside a
/// transaction that rolls back, so the scratch table never persists.
///
/// Note the fidelity bound this test respects: v1 rows keep their raw JSON
/// text until `insert_transfer_row` converts each into a `Map<String,
/// Value>`, and `Value` numbers are f64 — a `numeric` with more significant
/// digits than f64 carries (~15) would not survive. Every schema `numeric`
/// is at most `numeric(12,2)`, which always round-trips; the fixture stays
/// inside that bound.
#[tokio::test]
async fn bytea_and_friends_round_trip_through_pipeline_primitives() {
    use hotel_app_be::models::ConflictPolicy;
    use hotel_app_be::modules::data_transfer::repository::{
        DataTransferRepository, InsertRowOutcome, QualifiedTable, TransferTable,
    };

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    let mut tx = pool.begin().await.expect("begin");

    sqlx::query(
        "CREATE TABLE public._dt_backup_roundtrip (\
            id bigint PRIMARY KEY, blob bytea, amount numeric(12,2), uid uuid, \
            at timestamptz, flag boolean, payload jsonb, note text)",
    )
    .execute(&mut *tx)
    .await
    .expect("scratch table must create");
    sqlx::query(
        "INSERT INTO public._dt_backup_roundtrip \
            (id, blob, amount, uid, at, flag, payload, note) \
         VALUES (1, '\\x00deadbeefcafeff00'::bytea, 98765432.10, \
            '019a4f20-7c01-7b9e-9f01-000000000042'::uuid, \
            '2026-06-07T08:09:10.112233+00:00'::timestamptz, false, \
            '{\"k\":[1,null,\"x\"]}'::jsonb, NULL)",
    )
    .execute(&mut *tx)
    .await
    .expect("fixture row must insert");

    let columns: Vec<String> = [
        "id", "blob", "amount", "uid", "at", "flag", "payload", "note",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    let descriptor = TransferTable {
        table: QualifiedTable {
            schema: "public".to_string(),
            name: "_dt_backup_roundtrip".to_string(),
        },
        is_partitioned: false,
        columns: columns.iter().cloned().collect::<HashSet<_>>(),
        ordered_columns: columns,
        generated_columns: HashSet::new(),
        primary_key_columns: vec!["id".to_string()],
        dependencies: HashSet::new(),
    };

    // Export end: the same cursor the streamed writer uses.
    DataTransferRepository::declare_export_cursor(
        &mut tx,
        &descriptor,
        &descriptor.ordered_columns,
    )
    .await
    .expect("export cursor must declare");
    let fetched = DataTransferRepository::fetch_export_cursor(&mut tx, 10)
        .await
        .expect("cursor fetch must run");
    DataTransferRepository::close_export_cursor(&mut tx)
        .await
        .expect("cursor must close");
    assert_eq!(fetched.len(), 1);
    let exported: Map<String, Value> =
        serde_json::from_str(&fetched[0]).expect("the exported row must be a JSON object");
    let blob = exported["blob"].as_str().expect("bytea must emit as text");
    assert_eq!(
        blob, "\\x00deadbeefcafeff00",
        "bytea must serialize as \\x… hex text"
    );

    // Import end: the row is gone, the file's row lands through the job's
    // insert helper under the strictest policy.
    sqlx::query("DELETE FROM public._dt_backup_roundtrip")
        .execute(&mut *tx)
        .await
        .expect("clear must run");
    let outcome = DataTransferRepository::insert_transfer_row(
        &mut tx,
        &descriptor,
        &exported,
        ConflictPolicy::Fail,
    )
    .await
    .expect("re-insert must succeed");
    assert_eq!(outcome, InsertRowOutcome::Inserted);

    let reloaded: Value = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM public._dt_backup_roundtrip WHERE id = 1) t",
    )
    .fetch_one(&mut *tx)
    .await
    .expect("the re-inserted row must exist");
    assert_eq!(
        reloaded,
        Value::Object(exported),
        "bytea/numeric/uuid/timestamptz/bool/jsonb/NULL must all survive exactly"
    );

    tx.rollback().await.expect("rollback");
}

/// A `guest_notes` row imported with its `guests` parent keeps referencing
/// the parent's preserved id after the round trip — no renumbering, no
/// dangling child.
#[tokio::test]
async fn foreign_keys_survive_export_and_reimport() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM guest_notes WHERE id = 920942011")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    sqlx::query("DELETE FROM guests WHERE id = 920942001")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    sqlx::query(
        "INSERT INTO guests (id, uuid, nick_name) OVERRIDING SYSTEM VALUE \
         VALUES (920942001, '019a4f20-7c01-7b9e-9f01-920942001001', 'dt-fk-parent')",
    )
    .execute(&pool)
    .await
    .expect("guest fixture must insert");
    sqlx::query(
        "INSERT INTO guest_notes (id, guest_id, content) OVERRIDING SYSTEM VALUE \
         VALUES (920942011, 920942001, 'dt-fk-child')",
    )
    .execute(&pool)
    .await
    .expect("note fixture must insert");

    // The file carries parent + child rows exactly as the export writes them.
    let guest_row: Value = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM guests WHERE id = 920942001) t",
    )
    .fetch_one(&pool)
    .await
    .expect("guest row must read");
    let note_row: Value = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM guest_notes WHERE id = 920942011) t",
    )
    .fetch_one(&pool)
    .await
    .expect("note row must read");

    // Cleaned state: both rows gone — the child first.
    sqlx::query("DELETE FROM guest_notes WHERE id = 920942011")
        .execute(&pool)
        .await
        .expect("note cleanup must run");
    sqlx::query("DELETE FROM guests WHERE id = 920942001")
        .execute(&pool)
        .await
        .expect("guest cleanup must run");

    let file = v1_document(&[
        V1Entity {
            name: "public.guest_notes",
            primary_key: &["id"],
            rows: vec![note_row],
        },
        V1Entity {
            name: "public.guests",
            primary_key: &["id"],
            rows: vec![guest_row],
        },
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the FK document must stage");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        any_user_id(&pool).await,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "parent+child import failed: {:?}",
        status.error
    );

    // The child's reference resolves to the preserved parent id — a real FK,
    // not a coincidental number.
    let linked: Option<i64> = sqlx::query_scalar(
        "SELECT n.guest_id FROM guest_notes n \
         JOIN guests g ON g.id = n.guest_id WHERE n.id = 920942011",
    )
    .fetch_optional(&pool)
    .await
    .expect("the join probe must run");
    assert_eq!(
        linked,
        Some(920_942_001),
        "the note must still reference the re-imported guest id"
    );

    sqlx::query("DELETE FROM guest_notes WHERE id = 920942011")
        .execute(&pool)
        .await
        .expect("note cleanup must run");
    sqlx::query("DELETE FROM guests WHERE id = 920942001")
        .execute(&pool)
        .await
        .expect("guest cleanup must run");
}

/// `mode: "restore"` clears the selected transferable table before loading
/// the file — and a `tables` filter still expands to dependents
/// (`expand_full_overwrite_tables`), so `team_members` and `team_roles` are
/// wiped along with `teams` even though `tables` names only the parent.
///
/// Shared-database safety: a restore genuinely deletes everything not in the
/// file, so the fixture file itself carries a snapshot of all three tables'
/// pre-existing rows — the test leaves a populated database populated. The
/// `teams` family is used because no other test binary writes to it; a
/// restore's whole-table clear could otherwise race another binary's seed.
#[tokio::test]
async fn restore_clears_the_selection_and_expanded_dependents() {
    use hotel_app_be::models::{BackupImportMode, ImportExecuteRequest, ImportJobState};
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM team_members WHERE team_id = ANY('{920943001,920943002,920943003}')")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    sqlx::query("DELETE FROM team_roles WHERE team_id = ANY('{920943001,920943002,920943003}')")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    sqlx::query("DELETE FROM teams WHERE id IN (920943001, 920943002, 920943003)")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    // The file keeps every row already in the database — restore then swaps
    // like-for-like and the test never destroys another fixture's data.
    let pre_teams: Vec<Value> =
        sqlx::query_scalar("SELECT row_to_json(t) FROM (SELECT * FROM teams ORDER BY id) t")
            .fetch_all(&pool)
            .await
            .expect("teams snapshot must read");
    let pre_members: Vec<Value> = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM team_members ORDER BY team_id, user_id) t",
    )
    .fetch_all(&pool)
    .await
    .expect("team_members snapshot must read");
    let pre_role_links: Vec<Value> = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (SELECT * FROM team_roles ORDER BY team_id, role_id) t",
    )
    .fetch_all(&pool)
    .await
    .expect("team_roles snapshot must read");
    let pre_team_ids: Vec<i64> = pre_teams
        .iter()
        .filter_map(|row| row["id"].as_i64())
        .collect();

    // Seeded extras the file does not carry — restore must delete them. The
    // dependent row rides the expanded clear: `team_members` depends on
    // `teams`, which is what the `tables` selection names.
    sqlx::query(
        "INSERT INTO teams (id, code, name) OVERRIDING SYSTEM VALUE \
         VALUES (920943003, 'dt_restore_extra', 'DT Restore Extra')",
    )
    .execute(&pool)
    .await
    .expect("extra team must insert");
    let member_user = any_user_id(&pool).await;
    sqlx::query("INSERT INTO team_members (team_id, user_id) VALUES (920943003, $1)")
        .bind(member_user)
        .execute(&pool)
        .await
        .expect("dependent fixture must insert");

    let mut team_rows = pre_teams.clone();
    team_rows.extend([
        json!({"id": 920_943_001_i64, "code": "dt_restore_a", "name": "DT Restore A"}),
        json!({"id": 920_943_002_i64, "code": "dt_restore_b", "name": "DT Restore B"}),
    ]);
    let file = v1_document(&[
        V1Entity {
            name: "public.teams",
            primary_key: &["id"],
            rows: team_rows,
        },
        V1Entity {
            name: "public.team_members",
            primary_key: &["team_id", "user_id"],
            rows: pre_members.clone(),
        },
        V1Entity {
            name: "public.team_roles",
            primary_key: &["team_id", "role_id"],
            rows: pre_role_links.clone(),
        },
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the restore document must stage");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        member_user,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Restore,
            on_conflict: None,
            // Only the parent is named — the dependents enter the clear set
            // purely through expansion.
            tables: vec!["public.teams".to_string()],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "restore job failed: {:?}",
        status.error
    );

    // Exactly the file's rows remain: pre-existing rows came back through the
    // file, the seeded extra is gone.
    let mut expected_ids = pre_team_ids.clone();
    expected_ids.extend([920_943_001, 920_943_002]);
    expected_ids.sort_unstable();
    let remaining: Vec<i64> = sqlx::query_scalar("SELECT id FROM teams ORDER BY id")
        .fetch_all(&pool)
        .await
        .expect("teams must read");
    assert_eq!(
        remaining, expected_ids,
        "restore must leave exactly the file's rows"
    );

    // The expanded dependents were cleared and reloaded from the file — the
    // extra member row pointing at the deleted team did not survive.
    let member_rows: Vec<(i64, i64)> =
        sqlx::query_as("SELECT team_id, user_id FROM team_members ORDER BY 1, 2")
            .fetch_all(&pool)
            .await
            .expect("team_members must read");
    let mut expected_members: Vec<(i64, i64)> = pre_members
        .iter()
        .map(|row| {
            (
                row["team_id"].as_i64().expect("member row has a team"),
                row["user_id"].as_i64().expect("member row has a user"),
            )
        })
        .collect();
    expected_members.sort_unstable();
    assert_eq!(
        member_rows, expected_members,
        "team_members must hold exactly the file's rows — the seeded extra is cleared"
    );

    // Both expanded dependents show up in the report with their reloaded rows.
    let result = status.result.expect("a succeeded job carries its result");
    for (name, expected) in [
        ("public.team_members", expected_members.len() as u64),
        ("public.team_roles", pre_role_links.len() as u64),
    ] {
        let entity = result
            .report
            .entities
            .iter()
            .find(|entity| entity.entity == name)
            .unwrap_or_else(|| panic!("the cleared dependent {name} must appear in the report"));
        assert_eq!(
            entity.inserted, expected,
            "{name} must report its reloaded rows"
        );
    }

    sqlx::query("DELETE FROM teams WHERE id IN (920943001, 920943002)")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// File rows referencing a `users.id` this database never had: audit columns
/// (`teams.created_by`/`updated_by`) remap to the importing admin; a
/// required, non-audit reference (`user_guests.user_id`) skips the row and is
/// counted in `relationshipProblems` — preview and job report both.
#[tokio::test]
async fn missing_user_refs_remap_or_skip_and_are_reported() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM user_guests WHERE id IN (920944011, 920944012)")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    sqlx::query("DELETE FROM teams WHERE id = 920944001")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    let admin_id = any_user_id(&pool).await;
    let missing_user: i64 = 920_944_997;
    let absent: bool = sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(missing_user)
        .fetch_one(&pool)
        .await
        .expect("missing-user probe must run");
    assert!(absent, "the fixture user id must not exist");
    // Seed our own guest — a fresh baseline+seed database has none.
    sqlx::query(
        "INSERT INTO guests (id, nick_name) OVERRIDING SYSTEM VALUE \
         VALUES (920944013, 'dt-missing-refs') \
         ON CONFLICT (id) DO UPDATE SET nick_name = EXCLUDED.nick_name",
    )
    .execute(&pool)
    .await
    .expect("guest fixture must insert");
    let real_guest: i64 = 920_944_013;

    let file = v1_document(&[
        V1Entity {
            name: "public.teams",
            primary_key: &["id"],
            rows: vec![json!({
                "id": 920_944_001_i64,
                "code": "dt_remap_team",
                "name": "DT Remap Team",
                "created_by": missing_user,
                "updated_by": missing_user
            })],
        },
        V1Entity {
            name: "public.user_guests",
            primary_key: &["id"],
            rows: vec![
                // Required non-audit ref to a missing user — must be skipped.
                json!({
                    "id": 920_944_011_i64,
                    "user_id": missing_user,
                    "guest_id": real_guest
                }),
                // Same table, resolvable refs — must insert normally.
                json!({
                    "id": 920_944_012_i64,
                    "user_id": admin_id,
                    "guest_id": real_guest,
                    "linked_by": admin_id
                }),
            ],
        },
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the missing-ref document must stage");

    // Preview flags the unresolvable row before anything writes.
    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id, None)
        .await
        .expect("preview must answer");
    let user_guests = preview
        .entities
        .iter()
        .find(|entity| entity.name == "public.user_guests")
        .expect("user_guests must appear in the preview");
    assert_eq!(user_guests.skipped, Some(1));
    assert_eq!(user_guests.new, Some(2));
    let problem = preview
        .relationship_problems
        .iter()
        .find(|problem| problem.entity == "public.user_guests")
        .expect("the required missing-user reference must be reported");
    assert_eq!(problem.rows, 1);
    assert!(
        problem.reason.contains("user_id") && problem.reason.contains("public.users"),
        "the reason must name the column and the missing parent: {:?}",
        problem.reason
    );
    assert!(
        preview
            .warnings
            .iter()
            .any(|warning| warning.contains("reassigned") || warning.contains("cleared")),
        "the audit-column remaps must produce a warning: {:?}",
        preview.warnings
    );

    let job = data_transfer_jobs::start_import_job(
        &pool,
        admin_id,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "the missing-ref job failed: {:?}",
        status.error
    );

    // Audit columns survive attribution — remapped to the importing admin.
    let (created_by, updated_by): (Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT created_by, updated_by FROM teams WHERE id = 920944001")
            .fetch_one(&pool)
            .await
            .expect("the remapped team must exist");
    assert_eq!(created_by, Some(admin_id));
    assert_eq!(updated_by, Some(admin_id));

    // The unresolvable row was skipped and counted; the resolvable one landed.
    let dangling: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_guests WHERE id = 920944011)")
            .fetch_one(&pool)
            .await
            .expect("probe must run");
    assert!(!dangling, "a row needing a missing user must be skipped");
    let applied: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_guests WHERE id = 920944012)")
            .fetch_one(&pool)
            .await
            .expect("probe must run");
    assert!(applied, "the resolvable row must insert");

    let result = status.result.expect("succeeded job carries a result");
    let outcome = result
        .report
        .entities
        .iter()
        .find(|entity| entity.entity == "public.user_guests")
        .expect("user_guests must be in the report");
    assert_eq!((outcome.inserted, outcome.skipped), (1, 1));
    assert!(
        result
            .report
            .relationship_problems
            .iter()
            .any(|problem| problem.entity == "public.user_guests" && problem.rows == 1),
        "the job report must carry the skipped reference: {:?}",
        result.report.relationship_problems
    );

    sqlx::query("DELETE FROM user_guests WHERE id = 920944012")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
    sqlx::query("DELETE FROM teams WHERE id = 920944001")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
    sqlx::query("DELETE FROM guests WHERE id = 920944013")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// Inputs that must fail cleanly, never silently import: truncated JSON
/// (stages, then preview/execute refuse it), `version: 99`, a wrong `format`
/// marker, and an entity this schema does not have (a `validationErrors`
/// entry — and at execute, an `unsupportedEntities` report row, not rows).
#[tokio::test]
async fn malformed_and_mismatched_documents_fail_cleanly() {
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    let admin_id = any_user_id(&pool).await;
    let execute = |upload_id: uuid::Uuid| {
        data_transfer_jobs::start_import_job(
            &pool,
            admin_id,
            ImportExecuteRequest {
                upload_id,
                mode: BackupImportMode::Merge,
                on_conflict: Some(ConflictPolicy::Skip),
                tables: vec![],
                confirm: true,
            passphrase: None,
            },
        )
    };

    // Truncated JSON: the upload guard only demands a leading `{`, so it
    // stages — preview must refuse it (400) and the job must fail.
    let truncated = data_transfer_jobs::stage_backup_upload(Body::from(
        br#"{"format":"hotel-backup","version":1,"tables":{"public.amenities":[{"#.to_vec(),
    ))
    .await
    .expect("a truncated object still stages");
    let preview = data_transfer_jobs::preview_import(&pool, truncated.upload_id, None).await;
    assert!(
        matches!(preview, Err(ApiError::BadRequest(_))),
        "a truncated document must fail preview with BadRequest: {preview:?}"
    );
    let job = execute(truncated.upload_id)
        .await
        .expect("execute registers the job");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Failed,
        "an unparseable file must fail the job"
    );
    assert!(
        !staged_file_path(truncated.upload_id).exists(),
        "the staged file must be removed even when the job fails"
    );

    // version: 99 — parses as a v1-shaped document but is not understood.
    let mut v99 = serde_json::from_slice::<Value>(&v1_document(&[V1Entity {
        name: "public.amenities",
        primary_key: &["id"],
        rows: vec![],
    }]))
    .expect("fixture parses");
    v99["version"] = json!(99);
    let upload =
        data_transfer_jobs::stage_backup_upload(Body::from(serde_json::to_vec(&v99).unwrap()))
            .await
            .expect("a version-99 document still stages");
    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id, None)
        .await
        .expect("preview answers with the document's own errors");
    assert!(
        preview
            .validation_errors
            .iter()
            .any(|error| error.contains("version 99")),
        "preview must report the unsupported version: {:?}",
        preview.validation_errors
    );
    let job = execute(upload.upload_id).await.expect("execute registers");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(status.status, ImportJobState::Failed);
    assert!(
        status
            .error
            .as_deref()
            .is_some_and(|error| error.contains("version 99")),
        "the job error must name the version: {:?}",
        status.error
    );

    // Wrong format marker — same path.
    let mut wrong_format = serde_json::from_slice::<Value>(&v1_document(&[V1Entity {
        name: "public.amenities",
        primary_key: &["id"],
        rows: vec![],
    }]))
    .expect("fixture parses");
    wrong_format["format"] = json!("not-a-backup");
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(
        serde_json::to_vec(&wrong_format).unwrap(),
    ))
    .await
    .expect("a wrong-format document still stages");
    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id, None)
        .await
        .expect("preview answers");
    assert!(
        preview
            .validation_errors
            .iter()
            .any(|error| error.contains("not-a-backup")),
        "preview must report the format marker: {:?}",
        preview.validation_errors
    );
    let job = execute(upload.upload_id).await.expect("execute registers");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(status.status, ImportJobState::Failed);

    // An entity that is not in this schema at all: preview reports a
    // validation error rather than silently dropping it; execute still
    // completes and reports it under `unsupportedEntities`.
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(v1_document(&[V1Entity {
        name: "public.no_such_table",
        primary_key: &["id"],
        rows: vec![json!({"id": 1})],
    }])))
    .await
    .expect("an unknown-entity document still stages");
    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id, None)
        .await
        .expect("preview answers");
    assert!(
        preview
            .validation_errors
            .iter()
            .any(|error| error.contains("public.no_such_table") && error.contains("does not exist")),
        "preview must flag the unknown entity: {:?}",
        preview.validation_errors
    );
    let job = execute(upload.upload_id).await.expect("execute registers");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "unknown entities must not fail the job — they are reported, not imported"
    );
    let result = status.result.expect("succeeded job carries a result");
    assert!(
        result
            .report
            .unsupported_entities
            .iter()
            .any(|entity| entity == "public.no_such_table"),
        "the job report must list the unknown entity: {:?}",
        result.report.unsupported_entities
    );
}

/// A file carrying `public.users` rows is content-sniffed as a SYSTEM-tier
/// document no matter what `kind` it declares: the preview warns it is a
/// full-system backup and the diff lists the protected entity honestly. The
/// forged `is_super_admin` row never lands, though — the execute route gates
/// system-tier files on super admin + step-up (data_transfer_permissions.rs),
/// and once `users` rows are written they can never be deleted again because
/// `audit_logs` is append-only. The benign half of a mixed file still imports
/// through the ordinary job path.
#[tokio::test]
async fn protected_entities_preview_as_system_tier_and_stay_route_gated() {
    use axum::http::StatusCode;
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    let Some(fixture) = AuthFixture::new().await else {
        return;
    };
    sqlx::query("DELETE FROM amenities WHERE id = 920945001")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    let file = v1_document(&[
        V1Entity {
            name: "public.amenities",
            primary_key: &["id"],
            rows: vec![json!({"id": 920_945_001_i64, "name": "dt-real-row", "category": "ok"})],
        },
        V1Entity {
            name: "public.users",
            primary_key: &["id"],
            rows: vec![json!({
                "id": 920_945_999_i64,
                "username": "forged-admin",
                "email": "forged@example.invalid",
                "password_hash": "x",
                "is_super_admin": true
            })],
        },
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the mixed document must stage");

    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id, None)
        .await
        .expect("preview must answer");
    assert!(
        preview
            .warnings
            .iter()
            .any(|warning| warning.contains("full-system backup")),
        "preview must warn that the file is a credential store: {:?}",
        preview.warnings
    );
    assert!(
        preview
            .entities
            .iter()
            .any(|entity| entity.name == "public.users"),
        "a system-tier file previews the protected set it would write: {:?}",
        preview.entities.iter().map(|e| &e.name).collect::<Vec<_>>()
    );

    // Through the real route, even a super admin without a fresh step-up
    // token is turned away — the forged row never reaches `users`.
    let status = fixture
        .request(
            "POST",
            "/api/data-transfer/import/execute",
            Some(&fixture.admin_auth),
            format!(
                "{{\"uploadId\":\"{}\",\"mode\":\"merge\",\"confirm\":true}}",
                upload.upload_id
            )
            .as_bytes(),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a system-tier file demands step-up re-authentication"
    );
    let forged: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = 920945999)")
            .fetch_one(&pool)
            .await
            .expect("probe must run");
    assert!(!forged, "no protected-table row may ever be imported ungated");

    // The same entity list without the protected half is business-tier and
    // flows through the job path untouched.
    let benign = v1_document(&[V1Entity {
        name: "public.amenities",
        primary_key: &["id"],
        rows: vec![json!({"id": 920_945_001_i64, "name": "dt-real-row", "category": "ok"})],
    }]);
    let benign_upload = data_transfer_jobs::stage_backup_upload(Body::from(benign))
        .await
        .expect("the business-tier document must stage");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        any_user_id(&pool).await,
        ImportExecuteRequest {
            upload_id: benign_upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "the business-tier file must still import: {:?}",
        status.error
    );
    let applied: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM amenities WHERE id = 920945001)")
            .fetch_one(&pool)
            .await
            .expect("probe must run");
    assert!(applied, "the transferable row must have imported");

    sqlx::query("DELETE FROM amenities WHERE id = 920945001")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// Column-level exclusion is enforced on the way IN as well as on the way out:
/// export never emits `bookings.pre_checkin_token`, and the import strips the
/// key even when a crafted file carries it — a hostile backup must not be able
/// to set a live guest-portal bearer token.
#[tokio::test]
async fn credential_columns_cannot_be_written_by_an_import() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM bookings WHERE id = 920947001")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    // Self-contained fixtures — a fresh baseline+seed database seeds room_types
    // and rooms but no guests, and the test must not depend on seed contents.
    sqlx::query(
        "INSERT INTO room_types (id, code, name, base_price) OVERRIDING SYSTEM VALUE \
         VALUES (920947021, 'DTCRED', 'DT Cred Fixture', 100.00) \
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, \
         base_price = EXCLUDED.base_price",
    )
    .execute(&pool)
    .await
    .expect("room_type fixture must insert");
    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) OVERRIDING SYSTEM VALUE \
         VALUES (920947022, 'DT-CRED', 920947021, 'available') \
         ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, \
         room_type_id = EXCLUDED.room_type_id, status = EXCLUDED.status",
    )
    .execute(&pool)
    .await
    .expect("room fixture must insert");
    sqlx::query(
        "INSERT INTO guests (id, nick_name) OVERRIDING SYSTEM VALUE \
         VALUES (920947011, 'dt-cred-guest') \
         ON CONFLICT (id) DO UPDATE SET nick_name = EXCLUDED.nick_name",
    )
    .execute(&pool)
    .await
    .expect("guest fixture must insert");
    let guest_id: i64 = 920_947_011;
    let room_id: i64 = 920_947_022;

    let file = v1_document(&[V1Entity {
        name: "public.bookings",
        primary_key: &["id"],
        rows: vec![json!({
            "id": 920_947_001_i64,
            "booking_number": "BK-CRED-FILTER",
            "guest_id": guest_id,
            "room_id": room_id,
            "check_in_date": "2031-02-01",
            "check_out_date": "2031-02-03",
            "room_rate": 100.00,
            "subtotal": 200.00,
            "total_amount": 200.00,
            "status": "confirmed",
            "pre_checkin_token": "forged-bearer-token",
            "pre_checkin_token_expires_at": "2031-01-01T00:00:00Z"
        })],
    }]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the crafted document must stage");

    let job = data_transfer_jobs::start_import_job(
        &pool,
        any_user_id(&pool).await,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "the booking row must import: {:?}",
        status.error
    );

    let (imported, token, expires): (bool, Option<String>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as(
            "SELECT TRUE, pre_checkin_token, pre_checkin_token_expires_at \
             FROM bookings WHERE id = 920947001",
        )
        .fetch_one(&pool)
        .await
        .expect("probe must run");
    assert!(imported, "the booking row itself must have imported");
    assert!(
        token.is_none(),
        "pre_checkin_token must be stripped from imported rows"
    );
    assert!(
        expires.is_none(),
        "pre_checkin_token_expires_at must be stripped from imported rows"
    );

    sqlx::query("DELETE FROM bookings WHERE id = 920947001")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
    sqlx::query("DELETE FROM guests WHERE id = 920947011")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
    sqlx::query("DELETE FROM rooms WHERE id = 920947022")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
    sqlx::query("DELETE FROM room_types WHERE id = 920947021")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// Preview diff exactness: one file row whose key exists plus one whose key
/// does not, on a single-column-PK table (`amenities`, batched `= ANY($1)`)
/// and on a composite-PK table (`promotion_channels`, per-row
/// `row_exists_by_columns`). Counts must be exactly `existing=1, new=1` each.
#[tokio::test]
async fn preview_diff_counts_new_and_existing_exactly() {
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM amenities WHERE id = 920946001")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    sqlx::query(
        "INSERT INTO amenities (id, name, category) OVERRIDING SYSTEM VALUE \
                 VALUES (920946001, 'dt-diff-seeded', 'seed')",
    )
    .execute(&pool)
    .await
    .expect("seeded amenity must insert");
    let promotion_id: i64 = sqlx::query_scalar("SELECT id FROM promotions ORDER BY id LIMIT 1")
        .fetch_one(&pool)
        .await
        .expect("the dev database has promotions");
    let channel_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM booking_channels ORDER BY id LIMIT 2")
            .fetch_all(&pool)
            .await
            .expect("the dev database has booking channels");
    assert!(channel_ids.len() >= 2, "need two booking channels");
    // Snapshot whatever the pre-clean displaces so cleanup can restore the
    // dev database byte-for-byte — this is a shared database.
    let displaced_channels: Vec<Value> = sqlx::query_scalar(
        "SELECT row_to_json(t) FROM (\
             SELECT * FROM promotion_channels \
             WHERE promotion_id = $1 AND booking_channel_id = ANY($2)\
         ) t",
    )
    .bind(promotion_id)
    .bind(&channel_ids)
    .fetch_all(&pool)
    .await
    .expect("composite fixture snapshot must read");
    sqlx::query(
        "DELETE FROM promotion_channels WHERE promotion_id = $1 AND booking_channel_id = ANY($2)",
    )
    .bind(promotion_id)
    .bind(&channel_ids)
    .execute(&pool)
    .await
    .expect("composite fixture pre-clean must run");
    sqlx::query(
        "INSERT INTO promotion_channels (promotion_id, booking_channel_id) VALUES ($1, $2)",
    )
    .bind(promotion_id)
    .bind(channel_ids[0])
    .execute(&pool)
    .await
    .expect("seeded composite row must insert");

    let file = v1_document(&[
        V1Entity {
            name: "public.amenities",
            primary_key: &["id"],
            rows: vec![
                // Same key as the seeded row -> existing.
                json!({"id": 920_946_001_i64, "name": "dt-diff-seeded", "category": "seed"}),
                // Novel key -> new.
                json!({"id": 920_946_002_i64, "name": "dt-diff-new", "category": "new"}),
            ],
        },
        V1Entity {
            name: "public.promotion_channels",
            primary_key: &["promotion_id", "booking_channel_id"],
            rows: vec![
                json!({"promotion_id": promotion_id, "booking_channel_id": channel_ids[0]}),
                json!({"promotion_id": promotion_id, "booking_channel_id": channel_ids[1]}),
            ],
        },
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the diff document must stage");
    let preview = data_transfer_jobs::preview_import(&pool, upload.upload_id, None)
        .await
        .expect("preview must answer");

    let amenities = preview
        .entities
        .iter()
        .find(|entity| entity.name == "public.amenities")
        .expect("amenities must be in the preview");
    assert_eq!(
        (amenities.rows, amenities.existing, amenities.new),
        (2, Some(1), Some(1)),
        "the single-PK diff must split existing/new exactly"
    );
    let channels = preview
        .entities
        .iter()
        .find(|entity| entity.name == "public.promotion_channels")
        .expect("promotion_channels must be in the preview");
    assert_eq!(
        (channels.rows, channels.existing, channels.new),
        (2, Some(1), Some(1)),
        "the composite-PK diff must split existing/new exactly"
    );
    assert_eq!(preview.total_rows, 4);
    assert!(
        preview.relationship_problems.is_empty(),
        "every reference resolves — no problems expected: {:?}",
        preview.relationship_problems
    );

    data_transfer_jobs::delete_staged_upload(upload.upload_id)
        .await
        .expect("the previewed upload deletes cleanly");
    sqlx::query(
        "DELETE FROM promotion_channels WHERE promotion_id = $1 AND booking_channel_id = ANY($2)",
    )
    .bind(promotion_id)
    .bind(&channel_ids)
    .execute(&pool)
    .await
    .expect("composite fixture cleanup must run");
    if !displaced_channels.is_empty() {
        sqlx::query(
            "INSERT INTO promotion_channels \
             SELECT * FROM jsonb_populate_recordset(NULL::promotion_channels, $1::jsonb)",
        )
        .bind(serde_json::Value::Array(displaced_channels))
        .execute(&pool)
        .await
        .expect("displaced promotion_channels rows must be restored");
    }
    sqlx::query("DELETE FROM amenities WHERE id = 920946001")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// Job lifecycle: the registry reports `running` before the spawned task can
/// have made progress (the test runtime is single-threaded, so the job cannot
/// interleave between `start_import_job` returning and the status read), then
/// transitions to `succeeded` with the progress fields populated — and the
/// staged file is gone afterwards.
#[tokio::test]
async fn job_reports_running_then_succeeded_and_removes_the_staged_file() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM amenities WHERE id IN (920947001, 920947002)")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    let file = v1_document(&[V1Entity {
        name: "public.amenities",
        primary_key: &["id"],
        rows: vec![
            json!({"id": 920_947_001_i64, "name": "dt-job-a", "category": "job"}),
            json!({"id": 920_947_002_i64, "name": "dt-job-b", "category": "job"}),
        ],
    }]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the document must stage");

    let job = data_transfer_jobs::start_import_job(
        &pool,
        any_user_id(&pool).await,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("execute must return a job id");

    // The job is registered as running before `tokio::spawn` returns — and a
    // `#[tokio::test]` runtime is current-thread, so the spawned task cannot
    // have polled yet. This read is deterministic, not racy.
    let initial = data_transfer_jobs::import_job_status(job.job_id)
        .expect("a just-registered job must be queryable");
    assert_eq!(initial.status, ImportJobState::Running);
    assert_eq!(initial.progress.rows_applied, 0);

    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "the job failed: {:?}",
        status.error
    );
    assert_eq!(status.progress.total_rows, 2);
    assert_eq!(
        status.progress.rows_applied, 2,
        "a finished job reports all rows applied"
    );
    assert!(status.result.is_some());
    assert!(
        !staged_file_path(upload.upload_id).exists(),
        "the staged file must be deleted once the job completes"
    );

    sqlx::query("DELETE FROM amenities WHERE id IN (920947001, 920947002)")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// Two rows carrying the SAME primary key inside one file: under `skip` the
/// first inserts, the second hits `ON CONFLICT DO NOTHING` and is counted as
/// skipped — not an error, not a second row.
#[tokio::test]
async fn in_file_duplicate_ids_skip_the_second_row() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM amenities WHERE id = 920948001")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");

    let file = v1_document(&[V1Entity {
        name: "public.amenities",
        primary_key: &["id"],
        rows: vec![
            json!({"id": 920_948_001_i64, "name": "dt-dup-first", "category": "first"}),
            json!({"id": 920_948_001_i64, "name": "dt-dup-second", "category": "second"}),
        ],
    }]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the duplicate document must stage");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        any_user_id(&pool).await,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Succeeded,
        "in-file duplicates under skip must not fail: {:?}",
        status.error
    );
    let outcome = status
        .result
        .as_ref()
        .expect("result")
        .report
        .entities
        .iter()
        .find(|entity| entity.entity == "public.amenities")
        .expect("amenities must be in the report");
    assert_eq!((outcome.inserted, outcome.skipped), (1, 1));
    let stored: String = sqlx::query_scalar("SELECT category FROM amenities WHERE id = 920948001")
        .fetch_one(&pool)
        .await
        .expect("the winning row must exist");
    assert_eq!(stored, "first", "the first duplicate wins under skip");

    sqlx::query("DELETE FROM amenities WHERE id = 920948001")
        .execute(&pool)
        .await
        .expect("fixture cleanup must run");
}

/// A commit-time constraint failure must roll back EVERY entity, including
/// the ones that inserted cleanly earlier in the same transaction — zero
/// partial rows survive a failed import.
#[tokio::test]
async fn failed_import_rolls_back_every_entity() {
    use hotel_app_be::models::{
        BackupImportMode, ConflictPolicy, ImportExecuteRequest, ImportJobState,
    };
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let _fixture = FIXTURE_LOCK.lock().await;
    sqlx::query("DELETE FROM guest_notes WHERE id = 920949011")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    sqlx::query("DELETE FROM amenities WHERE id = 920949001")
        .execute(&pool)
        .await
        .expect("fixture pre-clean must run");
    let absent_guest: bool =
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM guests WHERE id = 920949997)")
            .fetch_one(&pool)
            .await
            .expect("guest probe must run");
    assert!(absent_guest, "the dangling guest id must not exist");

    // `amenities` sorts first and its row inserts without issue; the
    // `guest_notes` row references a guest in neither the file nor the
    // database, so it detonates at the deferred-constraint check — after the
    // amenity row already inserted inside the same transaction.
    let file = v1_document(&[
        V1Entity {
            name: "public.amenities",
            primary_key: &["id"],
            rows: vec![json!({"id": 920_949_001_i64, "name": "dt-rollback", "category": "x"})],
        },
        V1Entity {
            name: "public.guest_notes",
            primary_key: &["id"],
            rows: vec![
                json!({"id": 920_949_011_i64, "guest_id": 920_949_997_i64, "content": "dangling"}),
            ],
        },
    ]);
    let upload = data_transfer_jobs::stage_backup_upload(Body::from(file))
        .await
        .expect("the rollback document must stage");
    let job = data_transfer_jobs::start_import_job(
        &pool,
        any_user_id(&pool).await,
        ImportExecuteRequest {
            upload_id: upload.upload_id,
            mode: BackupImportMode::Merge,
            on_conflict: Some(ConflictPolicy::Skip),
            tables: vec![],
            confirm: true,
            passphrase: None,
        },
    )
    .await
    .expect("execute must return a job id");
    let status = wait_for_job(job.job_id).await;
    assert_eq!(
        status.status,
        ImportJobState::Failed,
        "a dangling reference must fail at commit"
    );

    // The clean entity's earlier insert is gone too — the whole transaction
    // rolled back, nothing partial committed.
    let amenity_survived: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM amenities WHERE id = 920949001)")
            .fetch_one(&pool)
            .await
            .expect("probe must run");
    assert!(!amenity_survived, "the earlier entity's row must roll back");
    let note_survived: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM guest_notes WHERE id = 920949011)")
            .fetch_one(&pool)
            .await
            .expect("probe must run");
    assert!(!note_survived, "the failing row must not persist");
    assert!(
        !staged_file_path(upload.upload_id).exists(),
        "the staged file must be removed after a failed job"
    );
}

// ---------------------------------------------------------------------------
// HTTP-level authorization: every import endpoint sits behind
// `settings:manage` AND `users.is_super_admin` — the guard lives in
// `routes::data_transfer`, so this drives the real router with session-bound
// JWTs.
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET: &str = "hotel-app-be-dt-backup-v1-secret-32chars";
const ADMIN_ACTOR_ID: i64 = 920_950_001;
const PRIVILEGED_ACTOR_ID: i64 = 920_950_002;
const PLAIN_ACTOR_ID: i64 = 920_950_003;

struct AuthFixture {
    pool: PgPool,
    app: axum::Router,
    admin_auth: String,
    privileged_auth: String,
    plain_auth: String,
}

impl AuthFixture {
    async fn new() -> Option<Self> {
        use hotel_app_be::{AuthService, core, routes};

        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping data-transfer auth tests because DATABASE_URL is not set");
                return None;
            }
        };
        unsafe {
            std::env::set_var("JWT_SECRET", TEST_JWT_SECRET);
        }
        core::config::init_from_env().expect("test app configuration must initialize");
        AuthService::init_jwt_secret(TEST_JWT_SECRET)
            .expect("test JWT secret must satisfy production validation");

        let pool = PgPoolOptions::new()
            .max_connections(3)
            // Deleting a `users` fixture fires `audit_logs`'s ON DELETE SET
            // NULL into an append-only table; test pools opt out
            // session-locally, exactly like guest_booking_isolation's.
            .after_connect(|conn, _| {
                Box::pin(async move {
                    sqlx::query("SET app.allow_audit_mutation = 'on'")
                        .execute(conn)
                        .await
                        .map(|_| ())
                })
            })
            .connect(&database_url)
            .await
            .expect("auth test database must connect");

        Self::cleanup(&pool).await;
        // Three actors: an admin (blanket `data_transfer:*` grants through the
        // role), a `settings:manage` holder with no data-transfer permission —
        // the assertion that the legacy gate no longer opens this surface —
        // and a login with no roles at all.
        Self::upsert_actor(&pool, ADMIN_ACTOR_ID, "dt_backup_admin", true).await;
        Self::upsert_actor(&pool, PRIVILEGED_ACTOR_ID, "dt_backup_privileged", false).await;
        Self::upsert_actor(&pool, PLAIN_ACTOR_ID, "dt_backup_plain", false).await;
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = 'admin' \
             ON CONFLICT (user_id, role_id) DO NOTHING",
        )
        .bind(ADMIN_ACTOR_ID)
        .execute(&pool)
        .await
        .expect("role grant must insert");
        // `settings:manage` directly — no role — so the actor provably holds
        // the legacy data-transfer gate and nothing else.
        sqlx::query(
            "INSERT INTO user_permissions (user_id, permission_id) \
             SELECT $1, id FROM permissions WHERE name = 'settings:manage' \
             ON CONFLICT (user_id, permission_id) DO NOTHING",
        )
        .bind(PRIVILEGED_ACTOR_ID)
        .execute(&pool)
        .await
        .expect("permission grant must insert");
        core::rbac_cache::invalidate_all();

        let admin_auth = Self::bearer(&pool, ADMIN_ACTOR_ID, "dt_backup_admin", "admin").await;
        let privileged_auth =
            Self::bearer(&pool, PRIVILEGED_ACTOR_ID, "dt_backup_privileged", "admin").await;
        let plain_auth = Self::bearer(&pool, PLAIN_ACTOR_ID, "dt_backup_plain", "staff").await;

        Some(Self {
            app: routes::create_router(pool.clone()),
            pool,
            admin_auth,
            privileged_auth,
            plain_auth,
        })
    }

    async fn upsert_actor(pool: &PgPool, id: i64, username: &str, super_admin: bool) {
        sqlx::query(
            "INSERT INTO users \
             (id, username, email, full_name, user_type, is_active, is_verified, \
              is_locked, is_super_admin) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, 'DT Backup Actor', 'staff', true, true, false, $4) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, email = EXCLUDED.email, \
                 is_active = true, is_verified = true, is_locked = false, \
                 is_super_admin = EXCLUDED.is_super_admin, deleted_at = NULL",
        )
        .bind(id)
        .bind(username)
        .bind(format!("{username}@hotel.local"))
        .bind(super_admin)
        .execute(pool)
        .await
        .expect("actor fixture must be inserted");
    }

    /// An active session plus its session-bound access token — the
    /// `enforce_active_session` middleware checks `sid` against
    /// `refresh_tokens`, so a bare signed JWT is not enough.
    async fn bearer(pool: &PgPool, user_id: i64, username: &str, role: &str) -> String {
        use hotel_app_be::AuthService;

        let refresh_token = AuthService::generate_refresh_token();
        let session_id = AuthService::store_refresh_token(
            pool,
            user_id,
            &refresh_token,
            1,
            Some("127.0.0.1"),
            Some("dt-backup-v1-test"),
            None,
        )
        .await
        .expect("session fixture must be inserted");
        let token = AuthService::generate_session_jwt(
            user_id,
            username.to_string(),
            vec![role.to_string()],
            session_id,
        )
        .expect("test access token must encode");
        format!("Bearer {token}")
    }

    /// Hit an endpoint with a given `Authorization` header value (`None` =
    /// unauthenticated), returning only the status. `body` is raw bytes —
    /// `Body` is not `Clone`, so the table of endpoints carries `Vec<u8>`.
    async fn request(
        &self,
        method: &str,
        uri: &str,
        authorization: Option<&str>,
        body: &[u8],
    ) -> axum::http::StatusCode {
        use axum::http::{Request, header};
        use tower::ServiceExt;

        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(authorization) = authorization {
            builder = builder.header(header::AUTHORIZATION, authorization);
        }
        if method == "POST" {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        let response = self
            .app
            .clone()
            .oneshot(
                builder
                    .body(Body::from(body.to_vec()))
                    .expect("request must build"),
            )
            .await
            .expect("router response must complete");
        response.status()
    }

    async fn cleanup(pool: &PgPool) {
        for user_id in [ADMIN_ACTOR_ID, PRIVILEGED_ACTOR_ID, PLAIN_ACTOR_ID] {
            sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .expect("session cleanup must run");
            sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .expect("role cleanup must run");
        }
        sqlx::query("DELETE FROM users WHERE id = ANY($1)")
            .bind([ADMIN_ACTOR_ID, PRIVILEGED_ACTOR_ID, PLAIN_ACTOR_ID])
            .execute(pool)
            .await
            .expect("actor cleanup must run");
        hotel_app_be::core::rbac_cache::invalidate_all();
    }
}

/// Every import endpoint must deny unauthenticated callers (401) and
/// authenticated users without `data_transfer:import` (403) — including a
/// user who still holds the legacy `settings:manage` permission, proving the
/// old gate no longer opens this surface. The admin (blanket grants) reaches
/// the handlers: unknown ids answer 404.
#[tokio::test]
async fn import_endpoints_require_authentication_and_data_transfer_import() {
    use axum::http::StatusCode;

    // The fixture seeds users/roles/sessions — hold the lock across fixture
    // creation too, not just the request phase.
    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fixture) = AuthFixture::new().await else {
        return;
    };
    let job_id = uuid::Uuid::new_v4();
    let upload_id = uuid::Uuid::new_v4();

    // (method, path, body bytes) — the five import endpoints.
    let endpoints: Vec<(&str, String, Vec<u8>)> = vec![
        (
            "POST",
            "/api/data-transfer/import/uploads".to_string(),
            b"{}".to_vec(),
        ),
        (
            "POST",
            "/api/data-transfer/import/preview".to_string(),
            format!("{{\"uploadId\":\"{upload_id}\"}}").into_bytes(),
        ),
        (
            "POST",
            "/api/data-transfer/import/execute".to_string(),
            format!("{{\"uploadId\":\"{upload_id}\",\"mode\":\"merge\",\"confirm\":true}}")
                .into_bytes(),
        ),
        (
            "GET",
            format!("/api/data-transfer/import/jobs/{job_id}"),
            Vec::new(),
        ),
        (
            "DELETE",
            format!("/api/data-transfer/import/uploads/{upload_id}"),
            Vec::new(),
        ),
    ];

    // Unauthenticated: no Authorization header at all -> 401 on every route.
    for (method, uri, body) in &endpoints {
        let status = fixture.request(method, uri, None, body).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{method} {uri} must reject an unauthenticated request with 401"
        );
    }

    // Authenticated but holding no permissions -> 403.
    for (method, uri, body) in &endpoints {
        let status = fixture
            .request(method, uri, Some(&fixture.plain_auth), body)
            .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{method} {uri} must reject a permission-less user with 403"
        );
    }

    // Holds `settings:manage` but no `data_transfer:*` permission -> 403 on
    // every import endpoint. This is the regression that matters: the legacy
    // settings gate must not keep opening data transfer.
    for (method, uri, body) in &endpoints {
        let status = fixture
            .request(method, uri, Some(&fixture.privileged_auth), body)
            .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{method} {uri} must reject a settings:manage-only user with 403"
        );
    }

    // The admin role carries the `data_transfer:*` grants — unknown ids then
    // answer 404, proving the request reached the handler rather than dying
    // in auth.
    let status = fixture
        .request(
            "GET",
            &format!("/api/data-transfer/import/jobs/{job_id}"),
            Some(&fixture.admin_auth),
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let status = fixture
        .request(
            "DELETE",
            &format!("/api/data-transfer/import/uploads/{upload_id}"),
            Some(&fixture.admin_auth),
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let status = fixture
        .request(
            "POST",
            "/api/data-transfer/import/preview",
            Some(&fixture.admin_auth),
            format!("{{\"uploadId\":\"{upload_id}\"}}").as_bytes(),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // A malformed execute request gets the real 400. The staged file must be
    // business-tier: an unknown or protected-set upload fails closed into the
    // system tier, where the step-up gate answers 401 before `confirm` is read.
    use hotel_app_be::modules::data_transfer::jobs as data_transfer_jobs;
    let staged = data_transfer_jobs::stage_backup_upload(Body::from(v1_document(&[
        V1Entity {
            name: "public.amenities",
            primary_key: &["id"],
            rows: vec![json!({"id": 920_945_777_i64, "name": "dt-gate-row", "category": "ok"})],
        },
    ])))
    .await
    .expect("business-tier upload must stage");
    let status = fixture
        .request(
            "POST",
            "/api/data-transfer/import/execute",
            Some(&fixture.admin_auth),
            format!(
                "{{\"uploadId\":\"{}\",\"mode\":\"merge\",\"confirm\":false}}",
                staged.upload_id
            )
            .as_bytes(),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "confirm=false must be a 400 past the auth gate"
    );

    let response = {
        use axum::http::{Request, header};
        use tower::ServiceExt;
        fixture
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/data-transfer/import/uploads")
                    .header(header::AUTHORIZATION, fixture.admin_auth.as_str())
                    .body(Body::from(v1_document(&[V1Entity {
                        name: "public.amenities",
                        primary_key: &["id"],
                        rows: vec![],
                    }])))
                    .expect("request must build"),
            )
            .await
            .expect("router response must complete")
    };
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("upload response must read");
    let upload: Value = serde_json::from_slice(&bytes).expect("upload response must parse");
    let staged_id = upload["uploadId"]
        .as_str()
        .expect("uploadId must be present");

    let status = fixture
        .request(
            "DELETE",
            &format!("/api/data-transfer/import/uploads/{staged_id}"),
            Some(&fixture.admin_auth),
            &[],
        )
        .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "the super-admin can discard a staged upload"
    );

    AuthFixture::cleanup(&fixture.pool).await;
}
