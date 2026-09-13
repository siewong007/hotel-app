use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, PgPool};
use std::fs::OpenOptions;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Output, Stdio};
use tokio::process::Command;
use tokio::time::{Duration, timeout};

const POSTGRES_SCHEMA: &str = include_str!("../database/postgres/migrations/0001_v1_baseline.sql");
const POSTGRES_SEED: &str = include_str!("../database/postgres/seed.sql");


#[derive(Clone)]
struct TestDatabase {
    name: String,
    url: String,
}

struct DisposableDatabases {
    admin_url: String,
    names: Vec<String>,
}

impl DisposableDatabases {
    async fn connect(configured_url: &str) -> Self {
        let (admin_url, _) = database_urls(configured_url, "unused")
            .expect("DATABASE_URL must include a database path");
        let mut admin = PgConnection::connect(&admin_url)
            .await
            .expect("connect to PostgreSQL admin database");
        let server_version_num: i32 =
            sqlx::query_scalar("SELECT current_setting('server_version_num')::integer")
                .fetch_one(&mut admin)
                .await
                .expect("read PostgreSQL server version");
        assert_eq!(
            server_version_num, 190000,
            "patch lifecycle tests require PostgreSQL 19"
        );
        Self {
            admin_url,
            names: Vec::new(),
        }
    }

    async fn create(&mut self, label: &str) -> TestDatabase {
        let name = format!("hotel_patch_{label}_{}", uuid::Uuid::new_v4().simple());
        let (_, url) = database_urls(&self.admin_url, &name)
            .expect("admin DATABASE_URL must include a database path");
        let mut admin = PgConnection::connect(&self.admin_url)
            .await
            .expect("connect to PostgreSQL admin database");
        admin
            .execute(sqlx::AssertSqlSafe(format!(
                "CREATE DATABASE {}",
                quote_ident(&name)
            )))
            .await
            .expect("create disposable PostgreSQL database");
        self.names.push(name.clone());
        TestDatabase { name, url }
    }

    async fn cleanup(&mut self) {
        let mut admin = PgConnection::connect(&self.admin_url)
            .await
            .expect("connect to PostgreSQL admin database for cleanup");
        while let Some(name) = self.names.last().cloned() {
            admin
                .execute(sqlx::AssertSqlSafe(format!(
                    "DROP DATABASE IF EXISTS {} WITH (FORCE)",
                    quote_ident(&name)
                )))
                .await
                .expect("drop disposable PostgreSQL database");
            self.names.pop();
        }
    }
}

fn database_url_or_skip() -> Option<String> {
    match std::env::var("DATABASE_URL") {
        Ok(database_url) if !database_url.is_empty() => Some(database_url),
        _ => {
            eprintln!("skipping PostgreSQL patch lifecycle test; set DATABASE_URL to run it");
            None
        }
    }
}

impl Drop for DisposableDatabases {
    fn drop(&mut self) {
        for name in &self.names {
            let mut removed = false;
            for attempt in 1..=2 {
                let result = StdCommand::new("psql")
                    .arg(&self.admin_url)
                    .args(["-X", "-v", "ON_ERROR_STOP=1", "-c"])
                    .arg(format!(
                        "DROP DATABASE IF EXISTS {} WITH (FORCE)",
                        quote_ident(name)
                    ))
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
                match result {
                    Ok(status) if status.success() => {
                        removed = true;
                        break;
                    }
                    Ok(status) => eprintln!(
                        "disposable database cleanup attempt {attempt} failed for {name}: {status}"
                    ),
                    Err(error) => eprintln!(
                        "disposable database cleanup attempt {attempt} failed for {name}: {error}"
                    ),
                }
            }
            if !removed {
                eprintln!("disposable database cleanup exhausted retries for {name}");
            }
        }
    }
}

struct TemporaryCatalog {
    path: PathBuf,
}

impl TemporaryCatalog {
    fn copy_committed() -> Self {
        let source = postgres_dir().join("patches");
        let path = std::env::temp_dir().join(format!(
            "hotel-app-patch-lifecycle-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir(&path).expect("create temporary patch catalog");
        for entry in std::fs::read_dir(source).expect("read committed patch catalog") {
            let entry = entry.expect("read patch catalog entry");
            std::fs::copy(entry.path(), path.join(entry.file_name()))
                .expect("copy patch catalog entry");
        }
        Self { path }
    }

    /// A synthetic two-patch catalog: controls plus two patches that each
    /// create an observable sentinel table. Used to prove the runner still
    /// applies, records and skips patches against a database whose committed
    /// catalog is empty.
    fn with_synthetic_patches() -> Self {
        let catalog = Self::copy_committed();
        let mut manifest = String::from("# generation\tversion\tname\tchecksum\tfile\n");
        for (version, name) in [(2, "sentinel-a"), (3, "sentinel-b")] {
            let file = format!("{version:04}_{name}.sql").replace('-', "_");
            let patch_source = format!(
                "CREATE TABLE public.patch_sentinel_{name}(id integer);\n",
            )
            .replace('-', "_");
            std::fs::write(catalog.path.join(&file), &patch_source)
                .expect("write synthetic patch");
            let checksum = hex::encode(Sha256::digest(patch_source.as_bytes()));
            manifest.push_str(&format!(
                "1\t{version}\t{name}\tsha256:{checksum}\t{file}\n"
            ));
        }
        std::fs::write(catalog.path.join("manifest.tsv"), manifest)
            .expect("write synthetic manifest");
        catalog
    }

    fn with_failing_patch() -> Self {
        let catalog = Self::copy_committed();

        let next_version = committed_manifest_versions()
            .last()
            .map(|version| version + 1)
            .unwrap_or(2);
        let file = format!("{next_version:04}_injected_failure.sql");
        let patch_source = "CREATE TABLE patch_failure_sentinel(id integer); SELECT 1 / 0;\n";
        std::fs::write(catalog.path.join(&file), patch_source)
            .expect("write injected failing patch");
        let checksum = hex::encode(Sha256::digest(patch_source.as_bytes()));
        writeln!(
            OpenOptions::new()
                .append(true)
                .open(catalog.path.join("manifest.tsv"))
                .expect("open temporary patch manifest"),
            "1\t{next_version}\tinjected-failure\tsha256:{checksum}\t{file}"
        )
        .expect("append injected patch manifest row");

        catalog
    }

    /// A synthetic catalog whose first patch sleeps inside the advisory-lock
    /// transaction, so a second runner can be observed waiting on the lock.
    fn with_sleeping_patch() -> Self {
        let catalog = Self::copy_committed();
        let patch_source = "SELECT pg_sleep(5);\nCREATE TABLE public.sleeping_sentinel(id integer);\n";
        let file = "0002_sleeping_patch.sql";
        std::fs::write(catalog.path.join(file), patch_source)
            .expect("write lock-holding temporary patch");
        let checksum = hex::encode(Sha256::digest(patch_source.as_bytes()));
        std::fs::write(
            catalog.path.join("manifest.tsv"),
            format!("# generation\tversion\tname\tchecksum\tfile\n1\t2\tsleeping-patch\tsha256:{checksum}\t{file}\n"),
        )
        .expect("write sleeping-patch manifest");
        catalog
    }
}

impl Drop for TemporaryCatalog {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// The versions the committed manifest lists, in manifest order.
///
/// Derived rather than hardcoded so that adding a real patch cannot silently
/// turn a fixture into a duplicate version, or leave an expectation checking
/// only a prefix of the catalog.
fn committed_manifest_versions() -> Vec<i32> {
    let manifest = std::fs::read_to_string(postgres_dir().join("patches/manifest.tsv"))
        .expect("committed manifest must be readable");
    manifest
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
        .map(|line| {
            line.split('\t')
                .nth(1)
                .expect("manifest row must have a version field")
                .parse()
                .expect("manifest version must be an integer")
        })
        .collect()
}

fn postgres_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("database/postgres")
}

fn run_make_schema_drift_harness(
    label: &str,
    baseline_url: Option<&str>,
    target_url: Option<&str>,
    command_line: bool,
) -> (Output, String) {
    let temporary_root = std::env::temp_dir().join(format!(
        "hotel-make-schema-drift-{label}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    let reporter_dir = temporary_root.join("hotel-app-be/database/postgres");
    std::fs::create_dir_all(&reporter_dir).expect("create fake schema drift reporter directory");
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("backend directory must have a repository parent")
            .join("Makefile"),
        temporary_root.join("Makefile"),
    )
    .expect("copy Makefile for schema drift harness");
    let reporter = reporter_dir.join("report-schema-drift.sh");
    std::fs::write(
        &reporter,
        "#!/usr/bin/env bash\nprintf 'baseline=<%s> target=<%s>\\n' \"$BASELINE_DATABASE_URL\" \"$TARGET_DATABASE_URL\" > \"$CAPTURE_FILE\"\n",
    )
    .expect("write fake schema drift reporter");
    let mut permissions = std::fs::metadata(&reporter)
        .expect("read fake reporter metadata")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&reporter, permissions).expect("make fake reporter executable");
    let capture_file = temporary_root.join("capture");

    let mut make = StdCommand::new("make");
    make.args(["--no-print-directory", "db-schema-drift"])
        .current_dir(&temporary_root)
        .env("CAPTURE_FILE", &capture_file)
        .env_remove("BASELINE_DATABASE_URL")
        .env_remove("TARGET_DATABASE_URL");
    for (name, value) in [
        ("BASELINE_DATABASE_URL", baseline_url),
        ("TARGET_DATABASE_URL", target_url),
    ] {
        if let Some(value) = value {
            if command_line {
                make.arg(format!("{name}={value}"));
            } else {
                make.env(name, value);
            }
        }
    }
    let output = make.output().expect("start schema drift Make harness");
    let capture = std::fs::read_to_string(capture_file).unwrap_or_default();
    std::fs::remove_dir_all(temporary_root).expect("remove schema drift Make harness");
    (output, capture)
}

fn quote_ident(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn database_urls(database_url: &str, database_name: &str) -> Option<(String, String)> {
    let scheme_end = database_url.find("://")? + 3;
    let path_start = database_url[scheme_end..].find('/')? + scheme_end;
    let prefix = &database_url[..=path_start];
    let suffix_start = database_url[path_start + 1..]
        .find(['?', '#'])
        .map(|index| path_start + 1 + index)
        .unwrap_or(database_url.len());
    let suffix = &database_url[suffix_start..];
    Some((
        format!("{prefix}postgres{suffix}"),
        format!("{prefix}{database_name}{suffix}"),
    ))
}

fn psql_script_for_sqlx(script: &str) -> String {
    script
        .lines()
        .filter(|line| !line.trim_start().starts_with('\\'))
        .collect::<Vec<_>>()
        .join("\n")
}

async fn install_v1(database: &TestDatabase) -> PgPool {
    let pool = PgPool::connect(&database.url)
        .await
        .expect("connect to disposable PostgreSQL database");
    for script in [POSTGRES_SCHEMA, POSTGRES_SEED] {
        sqlx::raw_sql(sqlx::AssertSqlSafe(&*psql_script_for_sqlx(script)))
            .execute(&pool)
            .await
            .expect("install PostgreSQL V1 baseline and seed");
    }
    pool
}

fn patch_command(database: &TestDatabase, catalog_dir: Option<&Path>) -> Command {
    let mut command = Command::new(postgres_dir().join("apply-patches.sh"));
    command.env("DATABASE_URL", &database.url);
    if let Some(catalog_dir) = catalog_dir {
        command.env("PATCH_CATALOG_DIR", catalog_dir);
    }
    command
}

async fn run_patches(database: &TestDatabase, catalog_dir: Option<&Path>) -> Output {
    let mut command = patch_command(database, catalog_dir);
    command
        .output()
        .await
        .expect("start PostgreSQL patch runner")
}

async fn schema_inventory(database: &TestDatabase) -> String {
    let output = Command::new("psql")
        .arg(&database.url)
        .args(["-XAt", "-q", "-v", "ON_ERROR_STOP=1", "-f"])
        .arg(postgres_dir().join("schema-inventory.sql"))
        .output()
        .await
        .expect("run schema inventory");
    assert!(
        output.status.success(),
        "schema inventory failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("schema inventory output must be UTF-8")
}

async fn wait_for_advisory_lock(pool: &PgPool, application_name: &str, granted: bool) {
    timeout(Duration::from_secs(10), async {
        loop {
            let lock_is_present: bool = sqlx::query_scalar(
                r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_locks AS lock_row
                    JOIN pg_stat_activity AS activity ON activity.pid = lock_row.pid
                    WHERE activity.application_name = $1
                      AND lock_row.locktype = 'advisory'
                      AND lock_row.granted = $2
                )
                "#,
            )
            .bind(application_name)
            .bind(granted)
            .fetch_one(pool)
            .await
            .expect("query PostgreSQL patch advisory lock state");
            if lock_is_present {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "timed out waiting for advisory lock held by {application_name} with granted={granted}"
        )
    });
}

fn assert_runner_succeeded(output: &Output) {
    assert!(
        output.status.success(),
        "PostgreSQL patch runner failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn assert_runner_failed_with(output: &Output, expected_diagnostic: &str) {
    assert!(
        !output.status.success(),
        "PostgreSQL patch runner succeeded"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains(expected_diagnostic),
        "expected runner failure containing {expected_diagnostic:?}, got: {stderr}"
    );
}

type RevisionSnapshot = Vec<(i32, String, String, String)>;
type ObjectSnapshot = Vec<(String, String, String, String)>;

async fn revision_snapshot(pool: &PgPool) -> RevisionSnapshot {
    sqlx::query_as(
        r#"
        SELECT version, name, checksum, applied_at::text
        FROM hotel_schema_revisions
        WHERE generation = 1 AND version > 1
        ORDER BY version
        "#,
    )
    .fetch_all(pool)
    .await
    .expect("read patch revision snapshot")
}

async fn object_snapshot(pool: &PgPool) -> ObjectSnapshot {
    sqlx::query_as(
        r#"
        SELECT kind, name, object_identity, definition
        FROM (
            SELECT
                'column'::text AS kind,
                table_row.relname || '.' || attribute_row.attname AS name,
                attribute_row.attrelid::text || ':' || attribute_row.attnum::text AS object_identity,
                format_type(attribute_row.atttypid, attribute_row.atttypmod) ||
                    CASE WHEN attribute_row.attnotnull THEN ' NOT NULL' ELSE ' NULL' END AS definition
            FROM pg_attribute AS attribute_row
            JOIN pg_class AS table_row ON table_row.oid = attribute_row.attrelid
            JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
            WHERE schema_row.nspname = 'public'
              AND NOT attribute_row.attisdropped
              AND (table_row.relname, attribute_row.attname) IN (
                  ('users', 'google_subject'),
                  ('payments', 'idempotency_key'),
                  ('payments', 'idempotency_fingerprint'),
                  ('customer_ledger_payments', 'idempotency_key'),
                  ('customer_ledger_payments', 'idempotency_fingerprint'),
                  ('refresh_tokens', 'client_timezone'),
                  ('promotions', 'internal_code'),
                  ('promotions', 'objective'),
                  ('email_campaigns', 'segment_id')
              )
            UNION ALL
            SELECT
                'index', index_row.relname, index_row.oid::text, pg_get_indexdef(index_row.oid)
            FROM pg_class AS index_row
            JOIN pg_namespace AS schema_row ON schema_row.oid = index_row.relnamespace
            WHERE schema_row.nspname = 'public'
              AND index_row.relname IN (
                  'uq_users_google_subject',
                  'idx_customer_ledger_payments_receipt_unique',
                  'uq_ledger_payments_ledger_idempotency',
                  'uq_payments_booking_idempotency',
                  'promotions_internal_code_key',
                  'idx_email_campaigns_segment',
                  'idx_guest_segments_active'
              )
            UNION ALL
            SELECT
                'constraint', constraint_row.conname, constraint_row.oid::text,
                pg_get_constraintdef(constraint_row.oid)
            FROM pg_constraint AS constraint_row
            JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
            JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
            WHERE schema_row.nspname = 'public'
              AND (table_row.relname, constraint_row.conname) IN (
                  ('bookings', 'bookings_status_check'),
                  ('bookings', 'bookings_no_room_date_overlap'),
                  ('promotions', 'promotions_status_check'),
                  ('guest_segments', 'guest_segments_rules_shape'),
                  ('guest_segments', 'guest_segments_slug_key'),
                  ('email_campaigns', 'email_campaigns_segment_id_fkey')
              )
            UNION ALL
            SELECT
                'function', routine_row.proname, routine_row.oid::text,
                pg_get_functiondef(routine_row.oid)
            FROM pg_proc AS routine_row
            JOIN pg_namespace AS schema_row ON schema_row.oid = routine_row.pronamespace
            WHERE schema_row.nspname = 'public'
              AND routine_row.proname = 'sync_room_status_with_booking'
              AND routine_row.pronargs = 0
        ) AS objects
        ORDER BY kind, name
        "#,
    )
    .fetch_all(pool)
    .await
    .expect("read patched object snapshot")
}

fn object_definitions(objects: &ObjectSnapshot) -> Vec<(&str, &str, &str)> {
    objects
        .iter()
        .map(|(kind, name, _, definition)| (kind.as_str(), name.as_str(), definition.as_str()))
        .collect()
}

/// The `(version, name, checksum)` rows a manifest expects to record, in
/// manifest order. Derived from the catalog rather than hardcoded so the
/// expectation follows whichever catalog the runner was given — including an
/// empty committed manifest, which must record no patch revisions at all.
fn manifest_revision_entries(catalog_dir: &Path) -> Vec<(i32, String, String)> {
    std::fs::read_to_string(catalog_dir.join("manifest.tsv"))
        .expect("catalog manifest must be readable")
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
        .map(|line| {
            let fields: Vec<&str> = line.split('\t').collect();
            assert_eq!(fields.len(), 5, "manifest row must have five fields: {line}");
            (
                fields[1].parse().expect("manifest version must be an integer"),
                fields[2].to_owned(),
                fields[3].to_owned(),
            )
        })
        .collect()
}

fn assert_expected_revisions(revisions: &RevisionSnapshot, catalog_dir: &Path) {
    assert_eq!(
        revisions
            .iter()
            .map(|(version, name, checksum, _)| (*version, name.as_str(), checksum.as_str()))
            .collect::<Vec<_>>(),
        manifest_revision_entries(catalog_dir)
            .iter()
            .map(|(version, name, checksum)| (*version, name.as_str(), checksum.as_str()))
            .collect::<Vec<_>>()
    );
}

fn assert_expected_objects(objects: &ObjectSnapshot) {
    let definitions = object_definitions(objects);
    assert_eq!(definitions.len(), 23);
    for expected in [
        (
            "column",
            "customer_ledger_payments.idempotency_fingerprint",
            "character varying(64) NULL",
        ),
        (
            "column",
            "customer_ledger_payments.idempotency_key",
            "character varying(160) NULL",
        ),
        (
            "column",
            "payments.idempotency_fingerprint",
            "character varying(64) NULL",
        ),
        (
            "column",
            "payments.idempotency_key",
            "character varying(160) NULL",
        ),
        (
            "column",
            "users.google_subject",
            "character varying(255) NULL",
        ),
        ("column", "refresh_tokens.client_timezone", "text NULL"),
        (
            "column",
            "promotions.internal_code",
            "character varying(64) NULL",
        ),
        (
            "column",
            "promotions.objective",
            "character varying(24) NULL",
        ),
        ("column", "email_campaigns.segment_id", "bigint NULL"),
    ] {
        assert!(
            definitions.contains(&expected),
            "missing final catalog object: {expected:?}"
        );
    }
    for name in [
        "idx_customer_ledger_payments_receipt_unique",
        "uq_ledger_payments_ledger_idempotency",
        "uq_payments_booking_idempotency",
        "uq_users_google_subject",
        "promotions_internal_code_key",
    ] {
        assert!(
            definitions
                .iter()
                .any(|(kind, object_name, definition)| *kind == "index"
                    && *object_name == name
                    && definition.starts_with("CREATE UNIQUE INDEX")),
            "missing final unique index {name}"
        );
    }
    // Every object that encodes the booking-status vocabulary must accept the
    // two pending statuses, not just the CHECK constraint: the exclusion
    // constraint is what actually refuses a double booking, and the trigger
    // function is what reserves and releases the room.
    for name in ["bookings_status_check", "bookings_no_room_date_overlap"] {
        assert!(
            definitions.iter().any(|(kind, object_name, definition)| {
                *kind == "constraint"
                    && *object_name == name
                    && definition.contains("'pending_payment'::character varying")
                    && definition.contains("'pending_confirmation'::character varying")
            }),
            "{name} must cover both pending statuses"
        );
    }
    assert!(
        definitions.iter().any(|(kind, name, definition)| {
            *kind == "constraint"
                && *name == "promotions_status_check"
                && definition.contains("'cancelled'::character varying")
        }),
        "promotions_status_check must accept the cancelled status"
    );
    for name in ["idx_email_campaigns_segment", "idx_guest_segments_active"] {
        assert!(
            definitions.iter().any(|(kind, object_name, definition)| {
                *kind == "index" && *object_name == name && definition.starts_with("CREATE INDEX")
            }),
            "missing final index {name}"
        );
    }
    for name in [
        "guest_segments_rules_shape",
        "guest_segments_slug_key",
        "email_campaigns_segment_id_fkey",
    ] {
        assert!(
            definitions
                .iter()
                .any(|(kind, object_name, _)| *kind == "constraint" && *object_name == name),
            "missing final constraint {name}"
        );
    }
    assert!(
        definitions.iter().any(|(kind, name, definition)| {
            *kind == "function"
                && *name == "sync_room_status_with_booking"
                && definition
                    .matches(
                        "IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')",
                    )
                    .count()
                    == 2
        }),
        "the room-sync trigger must treat both pending statuses as room-holding"
    );
}

#[tokio::test]
async fn postgres_v1_patches_apply_record_and_skip_idempotently() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let fresh = databases.create("fresh").await;
    let fresh_pool = install_v1(&fresh).await;

    // The committed catalog is empty after the V1 fold: the runner must be a
    // clean no-op, and the database must still carry every formerly-patched
    // object because the baseline now ships them directly.
    let empty_run = run_patches(&fresh, None).await;
    assert_runner_succeeded(&empty_run);
    assert_expected_revisions(
        &revision_snapshot(&fresh_pool).await,
        &postgres_dir().join("patches"),
    );
    assert_expected_objects(&object_snapshot(&fresh_pool).await);

    // A future same-generation change re-opens the catalog at version 2: it
    // must apply, record its revision, and skip cleanly on rerun.
    let synthetic = TemporaryCatalog::with_synthetic_patches();
    let first_run = run_patches(&fresh, Some(&synthetic.path)).await;
    assert_runner_succeeded(&first_run);
    let first_revisions = revision_snapshot(&fresh_pool).await;
    assert_expected_revisions(&first_revisions, &synthetic.path);
    for sentinel in ["patch_sentinel_sentinel_a", "patch_sentinel_sentinel_b"] {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(format!("public.{sentinel}"))
            .fetch_one(&fresh_pool)
            .await
            .expect("check synthetic sentinel table");
        assert!(exists, "{sentinel} must exist after the synthetic catalog ran");
    }

    let second_run = run_patches(&fresh, Some(&synthetic.path)).await;
    assert_runner_succeeded(&second_run);
    assert_eq!(revision_snapshot(&fresh_pool).await, first_revisions);

    fresh_pool.close().await;
    drop(synthetic);
    databases.cleanup().await;
}

#[tokio::test]
async fn schema_drift_report_is_read_only() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let baseline = databases.create("drift_baseline").await;
    let target = databases.create("drift_target").await;
    let baseline_pool = install_v1(&baseline).await;
    let target_pool = install_v1(&target).await;

    let baseline_revisions = revision_snapshot(&baseline_pool).await;
    let target_revisions = revision_snapshot(&target_pool).await;
    let baseline_objects = object_snapshot(&baseline_pool).await;
    let target_objects = object_snapshot(&target_pool).await;

    let baseline_inventory = schema_inventory(&baseline).await;
    let target_inventory = schema_inventory(&target).await;
    assert_eq!(baseline_inventory, target_inventory);
    assert!(baseline_inventory.lines().all(|line| {
        let fields = line.split('\t').collect::<Vec<_>>();
        fields.len() == 3 && BASE64.decode(fields[2]).is_ok()
    }));
    for expected_identity in [
        "table\tpublic.audit_logs\t",
        "table\tpublic.audit_logs_default\t",
        "view\tpublic.booking_summary\t",
        "column\tpublic.bookings.nights\t",
        "constraint\tpublic.bookings.bookings_status_check\t",
        "index\tpublic.bookings_pkey\t",
        "function\tpublic.auto_check_in_reservations(p_date date)\t",
    ] {
        assert!(
            baseline_inventory
                .lines()
                .any(|line| line.starts_with(expected_identity)),
            "schema inventory is missing {expected_identity:?}"
        );
    }

    let no_drift = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env("BASELINE_DATABASE_URL", &baseline.url)
        .env("TARGET_DATABASE_URL", &target.url)
        .output()
        .await
        .expect("start schema drift reporter for matching databases");
    assert_eq!(
        no_drift.status.code(),
        Some(0),
        "expected no drift, got stdout={} stderr={}",
        String::from_utf8_lossy(&no_drift.stdout),
        String::from_utf8_lossy(&no_drift.stderr)
    );
    assert!(no_drift.stdout.is_empty());

    sqlx::query("CREATE TABLE public.audit_extra_table(id bigint PRIMARY KEY)")
        .execute(&target_pool)
        .await
        .expect("create target-only drift table");
    let target_drift_inventory = schema_inventory(&target).await;

    let output = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env("BASELINE_DATABASE_URL", &baseline.url)
        .env("TARGET_DATABASE_URL", &target.url)
        .output()
        .await
        .expect("start schema drift reporter");
    assert_eq!(
        output.status.code(),
        Some(2),
        "expected reported drift, got stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).expect("drift report must be UTF-8");
    assert!(stdout.starts_with("--- baseline\n+++ target\n"));
    assert!(
        stdout.contains("audit_extra_table"),
        "drift report did not name the target-only table: {stdout}"
    );

    assert_eq!(revision_snapshot(&baseline_pool).await, baseline_revisions);
    assert_eq!(revision_snapshot(&target_pool).await, target_revisions);
    assert_eq!(object_snapshot(&baseline_pool).await, baseline_objects);
    assert_eq!(object_snapshot(&target_pool).await, target_objects);
    assert_eq!(schema_inventory(&baseline).await, baseline_inventory);
    assert_eq!(schema_inventory(&target).await, target_drift_inventory);
    let extra_table_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public.audit_extra_table') IS NOT NULL")
            .fetch_one(&target_pool)
            .await
            .expect("check target-only table after drift reporting");
    assert!(extra_table_exists);

    baseline_pool.close().await;
    target_pool.close().await;
    databases.cleanup().await;
}

#[tokio::test]
async fn schema_drift_report_normalizes_session_settings_and_tracks_view_options() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let baseline = databases.create("drift_settings_baseline").await;
    let target = databases.create("drift_settings_target").await;
    let baseline_pool = PgPool::connect(&baseline.url)
        .await
        .expect("connect to baseline settings database");
    let target_pool = PgPool::connect(&target.url)
        .await
        .expect("connect to target settings database");
    let fixture = r#"
        CREATE TABLE public.inventory_probe (
            id bigint PRIMARY KEY,
            happened_at timestamptz DEFAULT TIMESTAMPTZ '2026-08-21 00:00:00+00'
        );
        CREATE VIEW public.inventory_probe_view AS
        SELECT id, happened_at FROM public.inventory_probe;
    "#;
    sqlx::raw_sql(fixture)
        .execute(&baseline_pool)
        .await
        .expect("create baseline inventory fixture");
    sqlx::raw_sql(fixture)
        .execute(&target_pool)
        .await
        .expect("create target inventory fixture");
    baseline_pool
        .execute(sqlx::AssertSqlSafe(format!(
            "ALTER DATABASE {} SET TimeZone TO 'UTC'",
            quote_ident(&baseline.name)
        )))
        .await
        .expect("set baseline database time zone");
    target_pool
        .execute(sqlx::AssertSqlSafe(format!(
            "ALTER DATABASE {} SET TimeZone TO 'Asia/Kuala_Lumpur'",
            quote_ident(&target.name)
        )))
        .await
        .expect("set target database time zone");

    let no_drift = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env("BASELINE_DATABASE_URL", &baseline.url)
        .env("TARGET_DATABASE_URL", &target.url)
        .output()
        .await
        .expect("compare schemas under different database time zones");
    assert_eq!(
        no_drift.status.code(),
        Some(0),
        "database time zones must not create schema drift: {}",
        String::from_utf8_lossy(&no_drift.stdout)
    );

    target_pool
        .execute("ALTER VIEW public.inventory_probe_view SET (security_barrier = true)")
        .await
        .expect("set target-only view security option");
    let view_drift = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env("BASELINE_DATABASE_URL", &baseline.url)
        .env("TARGET_DATABASE_URL", &target.url)
        .output()
        .await
        .expect("compare schemas after view option drift");
    assert_eq!(view_drift.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&view_drift.stdout).contains("public.inventory_probe_view"));

    baseline_pool.close().await;
    target_pool.close().await;
    databases.cleanup().await;
}

#[tokio::test]
async fn schema_drift_report_tracks_table_and_partition_reloptions() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let baseline = databases.create("drift_reloptions_baseline").await;
    let target = databases.create("drift_reloptions_target").await;
    let baseline_pool = install_v1(&baseline).await;
    let target_pool = install_v1(&target).await;
    let fixture = r#"
        CREATE TABLE public.inventory_reloptions_probe(id bigint);
        CREATE TABLE public.inventory_partition_probe(id bigint, bucket integer)
            PARTITION BY RANGE (bucket);
        CREATE TABLE public.inventory_partition_probe_0
            PARTITION OF public.inventory_partition_probe
            FOR VALUES FROM (0) TO (10);
    "#;
    sqlx::raw_sql(fixture)
        .execute(&baseline_pool)
        .await
        .expect("create baseline reloptions fixture");
    sqlx::raw_sql(fixture)
        .execute(&target_pool)
        .await
        .expect("create target reloptions fixture");
    baseline_pool
        .execute(
            "ALTER TABLE public.inventory_reloptions_probe SET (fillfactor = 100, autovacuum_enabled = true)",
        )
        .await
        .expect("set baseline reloptions in canonical test order");
    target_pool
        .execute(
            "ALTER TABLE public.inventory_reloptions_probe SET (autovacuum_enabled = true, fillfactor = 100)",
        )
        .await
        .expect("set target reloptions in reverse order");
    assert_eq!(
        schema_inventory(&baseline).await,
        schema_inventory(&target).await
    );
    let no_drift = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env("BASELINE_DATABASE_URL", &baseline.url)
        .env("TARGET_DATABASE_URL", &target.url)
        .output()
        .await
        .expect("compare equivalent table reloptions in different catalog order");
    assert_eq!(no_drift.status.code(), Some(0));

    sqlx::raw_sql(
        r#"
        ALTER TABLE public.inventory_reloptions_probe SET (fillfactor = 70);
        ALTER TABLE public.inventory_partition_probe_0 SET (fillfactor = 80);
        "#,
    )
    .execute(&target_pool)
    .await
    .expect("set target-only table and partition reloptions");
    let baseline_revisions = revision_snapshot(&baseline_pool).await;
    let target_revisions = revision_snapshot(&target_pool).await;
    let baseline_inventory = schema_inventory(&baseline).await;
    let target_inventory = schema_inventory(&target).await;
    let target_reloptions: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT relname, COALESCE(array_to_string(reloptions, ','), '')
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname IN ('inventory_reloptions_probe', 'inventory_partition_probe_0')
        ORDER BY relname
        "#,
    )
    .fetch_all(&target_pool)
    .await
    .expect("snapshot target table reloptions");

    let output = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env("BASELINE_DATABASE_URL", &baseline.url)
        .env("TARGET_DATABASE_URL", &target.url)
        .output()
        .await
        .expect("compare schemas after table reloption drift");
    assert_eq!(output.status.code(), Some(2));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("public.inventory_reloptions_probe"));
    assert!(stdout.contains("public.inventory_partition_probe_0"));

    assert_eq!(revision_snapshot(&baseline_pool).await, baseline_revisions);
    assert_eq!(revision_snapshot(&target_pool).await, target_revisions);
    assert_eq!(schema_inventory(&baseline).await, baseline_inventory);
    assert_eq!(schema_inventory(&target).await, target_inventory);
    assert_eq!(
        sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT relname, COALESCE(array_to_string(reloptions, ','), '')
            FROM pg_class
            WHERE relnamespace = 'public'::regnamespace
              AND relname IN ('inventory_reloptions_probe', 'inventory_partition_probe_0')
            ORDER BY relname
            "#,
        )
        .fetch_all(&target_pool)
        .await
        .expect("read target table reloptions after reporting"),
        target_reloptions
    );

    baseline_pool.close().await;
    target_pool.close().await;
    databases.cleanup().await;
}

#[tokio::test]
async fn schema_drift_report_tracks_public_window_functions_only() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let baseline = databases.create("drift_window_baseline").await;
    let target = databases.create("drift_window_target").await;
    let baseline_pool = install_v1(&baseline).await;
    let target_pool = install_v1(&target).await;
    let baseline_revisions = revision_snapshot(&baseline_pool).await;
    let target_revisions = revision_snapshot(&target_pool).await;
    let baseline_inventory = schema_inventory(&baseline).await;

    sqlx::raw_sql(
        r#"
        CREATE FUNCTION public.inventory_window_probe()
        RETURNS bigint
        AS 'window_row_number'
        LANGUAGE internal
        WINDOW
        IMMUTABLE
        PARALLEL SAFE;

        CREATE PROCEDURE public.inventory_ignored_procedure()
        LANGUAGE sql
        AS 'SELECT 1';

        CREATE AGGREGATE public.inventory_ignored_aggregate(bigint) (
            SFUNC = int8pl,
            STYPE = bigint,
            INITCOND = '0'
        );
        "#,
    )
    .execute(&target_pool)
    .await
    .expect("create target-only window function and excluded routine kinds");
    let target_inventory = schema_inventory(&target).await;
    let target_routines: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT proname, prokind::text
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname LIKE 'inventory_%'
        ORDER BY proname
        "#,
    )
    .fetch_all(&target_pool)
    .await
    .expect("snapshot target routine kinds");

    let output = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env("BASELINE_DATABASE_URL", &baseline.url)
        .env("TARGET_DATABASE_URL", &target.url)
        .output()
        .await
        .expect("compare schemas after window function drift");
    assert_eq!(output.status.code(), Some(2));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("public.inventory_window_probe()"));
    assert!(!stdout.contains("inventory_ignored_procedure"));
    assert!(!stdout.contains("inventory_ignored_aggregate"));
    assert!(
        baseline_inventory.contains("function\tpublic.auto_check_in_reservations(p_date date)")
    );

    assert_eq!(revision_snapshot(&baseline_pool).await, baseline_revisions);
    assert_eq!(revision_snapshot(&target_pool).await, target_revisions);
    assert_eq!(schema_inventory(&baseline).await, baseline_inventory);
    assert_eq!(schema_inventory(&target).await, target_inventory);
    assert_eq!(
        sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT proname, prokind::text
            FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace
              AND proname LIKE 'inventory_%'
            ORDER BY proname
            "#,
        )
        .fetch_all(&target_pool)
        .await
        .expect("read target routine kinds after reporting"),
        target_routines
    );

    baseline_pool.close().await;
    target_pool.close().await;
    databases.cleanup().await;
}

#[tokio::test]
async fn schema_drift_report_rejects_missing_whitespace_and_equal_urls() {
    let reporter = postgres_dir().join("report-schema-drift.sh");
    for (label, baseline_url, target_url, expected_diagnostic) in [
        ("missing", None, None, "BASELINE_DATABASE_URL is required"),
        (
            "whitespace",
            Some(" \t "),
            Some(" \t "),
            "BASELINE_DATABASE_URL is required",
        ),
        (
            "equal",
            Some("postgresql://hotel:secret@invalid/equal"),
            Some("postgresql://hotel:secret@invalid/equal"),
            "database URLs must be distinct",
        ),
        (
            "option-shaped",
            Some("--version"),
            Some("--help"),
            "baseline schema inventory failed",
        ),
    ] {
        let mut command = Command::new(&reporter);
        command
            .env_remove("BASELINE_DATABASE_URL")
            .env_remove("TARGET_DATABASE_URL");
        if let Some(baseline_url) = baseline_url {
            command.env("BASELINE_DATABASE_URL", baseline_url);
        }
        if let Some(target_url) = target_url {
            command.env("TARGET_DATABASE_URL", target_url);
        }
        let output = command
            .output()
            .await
            .unwrap_or_else(|error| panic!("start schema drift reporter for {label}: {error}"));
        assert_eq!(output.status.code(), Some(1), "{label} input must fail");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains(expected_diagnostic),
            "{label} input reported an unexpected diagnostic: {stderr}"
        );
        assert!(!stderr.contains("postgresql://"));
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn schema_drift_make_target_preserves_urls_and_rejects_unsafe_inputs() {
    let baseline_url = "postgresql://hotel:base$word@localhost/baseline?token=$base";
    let target_url = "postgresql://hotel:target$word@localhost/target?token=$target";
    for (label, command_line) in [("environment", false), ("command-line", true)] {
        let (output, capture) = run_make_schema_drift_harness(
            label,
            Some(baseline_url),
            Some(target_url),
            command_line,
        );
        assert!(
            output.status.success(),
            "{label} Make invocation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            capture,
            format!("baseline=<{baseline_url}> target=<{target_url}>\n")
        );
    }

    for (label, baseline_url, target_url, diagnostic) in [
        (
            "missing-baseline",
            None,
            Some(target_url),
            "BASELINE_DATABASE_URL is required",
        ),
        (
            "missing-target",
            Some(baseline_url),
            None,
            "TARGET_DATABASE_URL is required",
        ),
        (
            "whitespace-baseline",
            Some(" \t "),
            Some(target_url),
            "BASELINE_DATABASE_URL is required",
        ),
        (
            "whitespace-target",
            Some(baseline_url),
            Some(" \t "),
            "TARGET_DATABASE_URL is required",
        ),
        (
            "equal",
            Some(baseline_url),
            Some(baseline_url),
            "database URLs must be distinct",
        ),
    ] {
        for command_line in [false, true] {
            let (output, capture) =
                run_make_schema_drift_harness(label, baseline_url, target_url, command_line);
            assert!(!output.status.success(), "{label} Make input must fail");
            assert!(
                String::from_utf8_lossy(&output.stderr).contains(diagnostic),
                "{label} Make input reported an unexpected diagnostic: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(capture.is_empty(), "{label} must not invoke the reporter");
        }
    }
}

#[tokio::test]
async fn schema_drift_report_propagates_tool_failures_and_removes_temp_files() {
    let temporary_root = std::env::temp_dir().join(format!(
        "hotel-schema-drift-failure-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    let command_dir = temporary_root.join("bin");
    let inventory_dir = temporary_root.join("inventory");
    std::fs::create_dir_all(&command_dir).expect("create fake command directory");
    std::fs::create_dir(&inventory_dir).expect("create temporary inventory directory");
    let capture_file = temporary_root.join("psql-calls");
    let fake_psql = command_dir.join("psql");
    std::fs::write(
        &fake_psql,
        "#!/usr/bin/env bash\nprintf 'called\\n' >> \"$CAPTURE_FILE\"\nif [[ ${FAIL_PSQL:-} == 1 ]]; then\n  printf 'injected psql failure\\n' >&2\n  exit 17\nfi\nprintf 'same-inventory\\n'\n",
    )
    .expect("write fake psql");
    let fake_diff = command_dir.join("diff");
    std::fs::write(
        &fake_diff,
        "#!/usr/bin/env bash\nprintf 'injected diff failure\\n' >&2\nexit 7\n",
    )
    .expect("write fake diff");
    for command in [&fake_psql, &fake_diff] {
        let mut permissions = std::fs::metadata(command)
            .expect("read fake command metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(command, permissions).expect("make fake command executable");
    }
    let path = format!(
        "{}:{}",
        command_dir.display(),
        std::env::var("PATH").expect("PATH must be set")
    );

    let output = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env(
            "BASELINE_DATABASE_URL",
            "postgresql://hotel:baseline-secret@invalid/baseline",
        )
        .env(
            "TARGET_DATABASE_URL",
            "postgresql://hotel:target-secret@invalid/target",
        )
        .env("CAPTURE_FILE", &capture_file)
        .env("FAIL_PSQL", "1")
        .env("PATH", path)
        .env("TMPDIR", &inventory_dir)
        .output()
        .await
        .expect("start schema drift reporter with failing psql");

    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        std::fs::read_to_string(&capture_file).expect("read fake psql calls"),
        "called\n"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("injected psql failure"));
    assert!(stderr.contains("baseline schema inventory failed"));
    assert!(!stderr.contains("baseline-secret"));
    assert!(!stderr.contains("target-secret"));
    assert!(
        std::fs::read_dir(&inventory_dir)
            .expect("read temporary inventory directory")
            .next()
            .is_none(),
        "schema inventory temp files must be removed after psql failure"
    );

    std::fs::write(&capture_file, "").expect("reset fake psql calls");
    let path = format!(
        "{}:{}",
        command_dir.display(),
        std::env::var("PATH").expect("PATH must be set")
    );
    let output = Command::new(postgres_dir().join("report-schema-drift.sh"))
        .env("BASELINE_DATABASE_URL", "postgresql://unused/baseline")
        .env("TARGET_DATABASE_URL", "postgresql://unused/target")
        .env("CAPTURE_FILE", &capture_file)
        .env("PATH", path)
        .env("TMPDIR", &inventory_dir)
        .output()
        .await
        .expect("start schema drift reporter with failing diff");
    assert_eq!(output.status.code(), Some(7));
    assert_eq!(
        std::fs::read_to_string(&capture_file).expect("read fake psql calls"),
        "called\ncalled\n"
    );
    assert!(String::from_utf8_lossy(&output.stderr).contains("injected diff failure"));
    assert!(
        std::fs::read_dir(&inventory_dir)
            .expect("read temporary inventory directory")
            .next()
            .is_none(),
        "schema inventory temp files must be removed after diff failure"
    );

    std::fs::remove_dir_all(temporary_root).expect("remove schema drift test directory");
}

#[tokio::test]
async fn postgres_v1_patch_failures_roll_back() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;

    let checksum_conflict = databases.create("checksum").await;
    let checksum_pool = install_v1(&checksum_conflict).await;
    let conflict_catalog = TemporaryCatalog::with_synthetic_patches();
    sqlx::query(
        r#"
        INSERT INTO hotel_schema_revisions (generation, version, name, checksum)
        VALUES (1, 2, 'sentinel-a', 'sha256:0000000000000000000000000000000000000000000000000000000000000000')
        "#,
    )
    .execute(&checksum_pool)
    .await
    .expect("insert conflicting patch revision");
    let checksum_output = run_patches(&checksum_conflict, Some(&conflict_catalog.path)).await;
    assert_runner_failed_with(&checksum_output, "patch 1.2 checksum mismatch");
    let sentinel_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public.patch_sentinel_sentinel_a') IS NOT NULL")
            .fetch_one(&checksum_pool)
            .await
            .expect("check sentinel table after checksum conflict");
    assert!(!sentinel_exists);

    let empty = databases.create("empty").await;
    let empty_pool = PgPool::connect(&empty.url)
        .await
        .expect("connect to empty disposable database");
    let empty_output = run_patches(&empty, Some(&conflict_catalog.path)).await;
    assert_runner_failed_with(
        &empty_output,
        "relation \"public.hotel_schema_revisions\" does not exist",
    );
    let public_relation_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM pg_class AS relation
        JOIN pg_namespace AS schema_row ON schema_row.oid = relation.relnamespace
        WHERE schema_row.nspname = 'public'
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        "#,
    )
    .fetch_one(&empty_pool)
    .await
    .expect("check empty database after rejected patch run");
    assert_eq!(public_relation_count, 0);

    let injected_failure = databases.create("rollback").await;
    let rollback_pool = install_v1(&injected_failure).await;
    let temporary_catalog = TemporaryCatalog::with_failing_patch();
    let rollback_output = run_patches(&injected_failure, Some(&temporary_catalog.path)).await;
    assert_runner_failed_with(&rollback_output, "division by zero");
    let sentinel_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public.patch_failure_sentinel') IS NOT NULL")
            .fetch_one(&rollback_pool)
            .await
            .expect("check injected patch DDL rollback");
    // The injected patch takes the first version after the committed catalog,
    // so this must follow the catalog rather than name a fixed version.
    let injected_version = committed_manifest_versions()
        .last()
        .map(|version| version + 1)
        .unwrap_or(2);
    let injected_revision_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM hotel_schema_revisions WHERE generation = 1 AND version = $1)",
    )
    .bind(injected_version)
    .fetch_one(&rollback_pool)
    .await
    .expect("check injected patch metadata rollback");
    assert!(!sentinel_exists);
    assert!(
        !injected_revision_exists,
        "a failed patch must leave no revision row behind"
    );

    checksum_pool.close().await;
    empty_pool.close().await;
    rollback_pool.close().await;
    drop(conflict_catalog);
    drop(temporary_catalog);
    databases.cleanup().await;
}

#[tokio::test]
async fn postgres_v1_patch_runners_serialize() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let upgrade = databases.create("concurrent").await;
    let pool = install_v1(&upgrade).await;
    let baseline_definitions = object_definitions(&object_snapshot(&pool).await)
        .into_iter()
        .map(|(kind, name, definition)| (kind.to_owned(), name.to_owned(), definition.to_owned()))
        .collect::<Vec<_>>();

    let temporary_catalog = TemporaryCatalog::with_sleeping_patch();
    let run_id = uuid::Uuid::new_v4().simple().to_string();
    let first_application = format!("hotel_patch_first_{run_id}");
    let second_application = format!("hotel_patch_second_{run_id}");
    let mut first_command = patch_command(&upgrade, Some(&temporary_catalog.path));
    first_command
        .env("PGAPPNAME", &first_application)
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let first_child = first_command.spawn().expect("start first patch runner");
    wait_for_advisory_lock(&pool, &first_application, true).await;

    let mut second_command = patch_command(&upgrade, Some(&temporary_catalog.path));
    second_command
        .env("PGAPPNAME", &second_application)
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let second_child = second_command.spawn().expect("start second patch runner");
    wait_for_advisory_lock(&pool, &second_application, false).await;

    let (first, second) = tokio::join!(
        first_child.wait_with_output(),
        second_child.wait_with_output()
    );
    let first = first.expect("wait for first patch runner");
    let second = second.expect("wait for second patch runner");
    assert_runner_succeeded(&first);
    assert_runner_succeeded(&second);

    let revisions = revision_snapshot(&pool).await;
    assert_expected_revisions(&revisions, &temporary_catalog.path);
    let revision_counts: Vec<(i32, i64)> = sqlx::query_as(
        r#"
        SELECT version, COUNT(*)
        FROM hotel_schema_revisions
        WHERE generation = 1 AND version > 1
        GROUP BY version
        ORDER BY version
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("count concurrent patch revisions");
    assert_eq!(
        revision_counts,
        manifest_revision_entries(&temporary_catalog.path)
            .into_iter()
            .map(|(version, _, _)| (version, 1))
            .collect::<Vec<(i32, i64)>>(),
        "two concurrent runners must record every catalog version exactly once"
    );

    let patched_objects = object_snapshot(&pool).await;
    assert_expected_objects(&patched_objects);
    let patched_definitions = object_definitions(&patched_objects)
        .into_iter()
        .map(|(kind, name, definition)| (kind.to_owned(), name.to_owned(), definition.to_owned()))
        .collect::<Vec<_>>();
    assert_eq!(patched_definitions, baseline_definitions);

    pool.close().await;
    drop(temporary_catalog);
    databases.cleanup().await;
}
