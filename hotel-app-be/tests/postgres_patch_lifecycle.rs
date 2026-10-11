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

    /// A synthetic catalog that extends the committed one with two patches
    /// that each create an observable sentinel table. Used to prove the
    /// runner applies, records and skips patches past the committed head —
    /// keeping the committed rows lets the runner skip revisions a database
    /// already recorded instead of colliding with them.
    fn with_synthetic_patches() -> Self {
        let catalog = Self::copy_committed();
        let mut manifest = std::fs::read_to_string(postgres_dir().join("patches/manifest.tsv"))
            .expect("committed manifest must be readable");
        if manifest.trim().is_empty() {
            manifest = "# generation\tversion\tname\tchecksum\tfile\n".to_string();
        } else if !manifest.ends_with('\n') {
            manifest.push('\n');
        }
        let first_version = committed_manifest_versions()
            .last()
            .map(|version| version + 1)
            .unwrap_or(2);
        for (offset, name) in ["sentinel-a", "sentinel-b"].into_iter().enumerate() {
            let version = first_version + offset as i32;
            let file = format!("{version:04}_{name}.sql").replace('-', "_");
            let patch_source = format!("CREATE TABLE public.patch_sentinel_{name}(id integer);\n",)
                .replace('-', "_");
            std::fs::write(catalog.path.join(&file), &patch_source).expect("write synthetic patch");
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

    /// The committed catalog cut back to versions up to `max_version`, as a
    /// database deployed before a later patch existed would have run it.
    fn truncated_at(max_version: i32) -> Self {
        let catalog = Self::copy_committed();
        let manifest = std::fs::read_to_string(postgres_dir().join("patches/manifest.tsv"))
            .expect("committed manifest must be readable");
        let kept: String = manifest
            .lines()
            .filter(|line| {
                line.starts_with('#')
                    || line.trim().is_empty()
                    || line
                        .split('\t')
                        .nth(1)
                        .and_then(|version| version.parse::<i32>().ok())
                        .is_some_and(|version| version <= max_version)
            })
            .map(|line| format!("{line}\n"))
            .collect();
        std::fs::write(catalog.path.join("manifest.tsv"), kept).expect("write truncated manifest");
        catalog
    }

    /// A synthetic catalog whose first patch sleeps inside the advisory-lock
    /// transaction, so a second runner can be observed waiting on the lock.
    fn with_sleeping_patch() -> Self {
        let catalog = Self::copy_committed();
        let patch_source =
            "SELECT pg_sleep(5);\nCREATE TABLE public.sleeping_sentinel(id integer);\n";
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
            assert_eq!(
                fields.len(),
                5,
                "manifest row must have five fields: {line}"
            );
            (
                fields[1]
                    .parse()
                    .expect("manifest version must be an integer"),
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
                    == 1
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
        assert!(
            exists,
            "{sentinel} must exist after the synthetic catalog ran"
        );
    }

    let second_run = run_patches(&fresh, Some(&synthetic.path)).await;
    assert_runner_succeeded(&second_run);
    assert_eq!(revision_snapshot(&fresh_pool).await, first_revisions);

    fresh_pool.close().await;
    drop(synthetic);
    databases.cleanup().await;
}

/// The SQL/PGQ graph every V1 database installed before patch 0015 carries,
/// exactly as the previous baseline created it.
const PRE_0015_HOTEL_GRAPH: &str = r#"
CREATE PROPERTY GRAPH public.hotel_graph
    VERTEX TABLES (
        public.companies KEY (id) LABEL company PROPERTIES (company_name, id),
        public.guests KEY (id) LABEL guest PROPERTIES (email, id, nick_name),
        public.rooms KEY (id) LABEL room PROPERTIES (id, room_number),
        public.users KEY (id) LABEL staff PROPERTIES (id, username)
    )
    EDGE TABLES (
        public.bookings KEY (id) SOURCE KEY (guest_id) REFERENCES guests (id) DESTINATION KEY (room_id) REFERENCES rooms (id) LABEL stayed_in PROPERTIES (check_in_date, check_out_date, id, status),
        public.user_guests KEY (id) SOURCE KEY (user_id) REFERENCES users (id) DESTINATION KEY (guest_id) REFERENCES guests (id) LABEL manages PROPERTIES (id, relationship_type)
    );
"#;

async fn property_graph_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM pg_catalog.pg_class WHERE relkind = 'g'")
        .fetch_one(pool)
        .await
        .expect("count property graphs")
}

#[tokio::test]
async fn postgres_v1_catalog_drops_the_reverted_hotel_property_graph() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let database = databases.create("graph").await;
    let pool = install_v1(&database).await;

    // Rebuild a database installed from the previous baseline. Only a server
    // that still ships SQL/PGQ (19beta3 and earlier) can hold the graph; from
    // 19beta4 on the statement does not parse, and this test then proves that
    // patch 0015 still applies on a server without SQL/PGQ.
    let server_has_pgq: bool =
        sqlx::query_scalar("SELECT to_regclass('pg_catalog.pg_propgraph_element') IS NOT NULL")
            .fetch_one(&pool)
            .await
            .expect("probe for the SQL/PGQ catalogs");
    if server_has_pgq {
        sqlx::raw_sql(sqlx::AssertSqlSafe(PRE_0015_HOTEL_GRAPH))
            .execute(&pool)
            .await
            .expect("recreate the pre-0015 property graph");
        assert_eq!(property_graph_count(&pool).await, 1);
    } else {
        eprintln!("server has no SQL/PGQ; checking that patch 0015 applies without it");
    }

    let first_run = run_patches(&database, None).await;
    assert_runner_succeeded(&first_run);
    // A 19beta3 pg_dump replays CREATE PROPERTY GRAPH, which 19beta4 and later
    // reject, so a converged database must not hold any graph at all.
    assert_eq!(
        property_graph_count(&pool).await,
        0,
        "the patch catalog must leave no property graph behind"
    );
    let revisions = revision_snapshot(&pool).await;
    assert!(
        revisions
            .iter()
            .any(|(version, name, _, _)| *version == 15 && name == "drop-hotel-property-graph"),
        "patch 0015 must record its revision: {revisions:?}"
    );

    let second_run = run_patches(&database, None).await;
    assert_runner_succeeded(&second_run);
    assert_eq!(revision_snapshot(&pool).await, revisions);

    pool.close().await;
    databases.cleanup().await;
}

/// `ensure_audit_logs_partition` exactly as every V1 database installed before
/// patch 0016 defines it: pg_get_functiondef output, SPLIT PARTITION included.
const PRE_0016_AUDIT_PARTITION_FUNCTION: &str = r#"CREATE OR REPLACE FUNCTION public.ensure_audit_logs_partition(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    start_date date := date_trunc('month', p_month)::date;
    end_date   date := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
    part_name  text := format('audit_logs_%s', to_char(start_date, 'YYYY_MM'));
BEGIN
    -- Schema-qualify the DDL: the pinned search_path puts pg_catalog first, so
    -- an unqualified CREATE TABLE would (illegally) target the system catalog.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = part_name AND relnamespace = 'public'::regnamespace
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM public.audit_logs_default
            WHERE created_at >= start_date::timestamptz
              AND created_at < end_date::timestamptz
            LIMIT 1
        ) THEN
            -- PostgreSQL 19 can split the DEFAULT partition in place. Unlike a
            -- late CREATE/ATTACH, this moves already-arrived rows into the new
            -- month while copying the parent's indexes and triggers.
            EXECUTE format(
                'ALTER TABLE public.audit_logs SPLIT PARTITION audit_logs_default INTO (PARTITION public.%I FOR VALUES FROM (%L) TO (%L), PARTITION public.audit_logs_default DEFAULT)',
                part_name, start_date, end_date
            );
        ELSE
            EXECUTE format(
                'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END IF;
    END IF;
END;
$function$
"#;

/// The function comment those databases carry.
const PRE_0016_AUDIT_PARTITION_COMMENT: &str = "COMMENT ON FUNCTION public.ensure_audit_logs_partition(p_month date) IS 'Idempotently creates the monthly audit_logs partition covering the given month. PostgreSQL 19 SPLIT PARTITION moves matching rows out of the DEFAULT partition when a month is created late. Pre-create months during maintenance because splitting takes exclusive locks and can move data.'";

async fn audit_partition_function(pool: &PgPool) -> (String, Option<String>) {
    sqlx::query_as(
        r#"
        SELECT pg_get_functiondef(routine_row.oid), obj_description(routine_row.oid, 'pg_proc')
        FROM pg_proc AS routine_row
        WHERE routine_row.oid = to_regprocedure('public.ensure_audit_logs_partition(date)')
        "#,
    )
    .fetch_one(pool)
    .await
    .expect("read ensure_audit_logs_partition")
}

#[tokio::test]
async fn postgres_v1_catalog_rebuilds_the_audit_partition_function_without_split() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let database = databases.create("split").await;
    let pool = install_v1(&database).await;
    // Patch 0021 replaces 0016's definition on every database, so the catalog
    // head, not the baseline, is what a pre-0016 database must converge onto.
    let fresh = databases.create("split_fresh").await;
    let fresh_pool = install_v1(&fresh).await;
    assert_runner_succeeded(&run_patches(&fresh, None).await);
    let catalog_head = audit_partition_function(&fresh_pool).await;
    fresh_pool.close().await;

    // Rebuild a database installed before patch 0016.
    for statement in [
        PRE_0016_AUDIT_PARTITION_FUNCTION,
        PRE_0016_AUDIT_PARTITION_COMMENT,
    ] {
        sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
            .execute(&pool)
            .await
            .expect("restore the pre-0016 audit partition function");
    }
    let (old_definition, _) = audit_partition_function(&pool).await;
    assert!(old_definition.contains("SPLIT PARTITION audit_logs_default"));

    let output = run_patches(&database, None).await;
    assert_runner_succeeded(&output);
    assert_eq!(
        audit_partition_function(&pool).await,
        catalog_head,
        "patches 0016 and 0021 must converge onto the fresh-install definition and comment"
    );

    // The converged function moves a late month's rows on every 19 build,
    // including those without SPLIT PARTITION.
    sqlx::query(
        r#"
        INSERT INTO audit_logs (action, resource_type, created_at)
        VALUES ('late_month', 'patch_0016', '2098-03-03T00:00:00Z'),
               ('other_month', 'patch_0016', '2098-05-05T00:00:00Z')
        "#,
    )
    .execute(&pool)
    .await
    .expect("insert audit rows into the DEFAULT partition");
    sqlx::query("SELECT public.ensure_audit_logs_partition(DATE '2098-03-01')")
        .execute(&pool)
        .await
        .expect("create a late audit partition");
    let placement: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT action::text, tableoid::regclass::text
        FROM audit_logs
        WHERE resource_type = 'patch_0016'
        ORDER BY action
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("read audit row placement");
    assert_eq!(
        placement,
        vec![
            ("late_month".to_owned(), "audit_logs_2098_03".to_owned()),
            ("other_month".to_owned(), "audit_logs_default".to_owned()),
        ]
    );

    pool.close().await;
    databases.cleanup().await;
}

#[tokio::test]
async fn postgres_v1_catalog_refuses_a_drifted_audit_partition_function() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let database = databases.create("split_drift").await;
    let pool = install_v1(&database).await;

    sqlx::raw_sql(
        r#"
        CREATE OR REPLACE FUNCTION public.ensure_audit_logs_partition(p_month date)
        RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public'
        AS $$ BEGIN NULL; END; $$
        "#,
    )
    .execute(&pool)
    .await
    .expect("install a drifted audit partition function");

    let output = run_patches(&database, None).await;
    assert_runner_failed_with(
        &output,
        "ensure_audit_logs_partition(date) has incompatible definition",
    );
    let recorded: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM hotel_schema_revisions WHERE generation = 1 AND version = 16)",
    )
    .fetch_one(&pool)
    .await
    .expect("read patch 0016 revision");
    assert!(!recorded, "a refused patch must not record its revision");

    pool.close().await;
    databases.cleanup().await;
}

const PATCH_0021: &str =
    include_str!("../database/postgres/patches/0021_audit_partition_move_rows.sql");

/// `sql` with every `--` comment stripped, so prose that mentions a statement
/// cannot satisfy or fail a check on the executable SQL.
fn sql_code(sql: &str) -> String {
    sql.lines()
        .map(|line| line.split("--").next().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn patch_0021_moves_late_audit_months_without_split_or_the_escape_hatch() {
    let code = sql_code(PATCH_0021);
    for reverted in ["SPLIT PARTITION", "MERGE PARTITIONS"] {
        assert!(
            !code.contains(reverted),
            "patch 0021 must not run {reverted}; PostgreSQL 19 Beta 4 and later reject it"
        );
    }
    // A late month detaches the default, creates the month, moves only its
    // rows and reattaches the default. Every target stays in public because
    // the function pins pg_catalog first on its search_path.
    for statement in [
        "ALTER TABLE public.audit_logs DETACH PARTITION public.audit_logs_default",
        "CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)",
        "DELETE FROM public.audit_logs_default",
        "INSERT INTO public.audit_logs OVERRIDING SYSTEM VALUE",
        "ALTER TABLE public.audit_logs ATTACH PARTITION public.audit_logs_default DEFAULT",
    ] {
        assert!(
            code.contains(statement),
            "patch 0021 must run {statement:?}"
        );
    }
    // The append-only escape hatch exists for test-fixture cleanup only; the
    // new function body must not open it (the COMMENT may name it).
    let move_start = PATCH_0021
        .find("$fn_move$")
        .expect("patch 0021 must carry the new definition")
        + "$fn_move$".len();
    let move_end = PATCH_0021[move_start..]
        .find("$fn_move$")
        .expect("the new definition must close")
        + move_start;
    assert!(
        !sql_code(&PATCH_0021[move_start..move_end]).contains("allow_audit_mutation"),
        "ensure_audit_logs_partition must not touch app.allow_audit_mutation"
    );
    // The guard expects exactly the definition 0016 installed (and the
    // baseline still carries), so the two must not drift apart.
    let rebuild_start = PATCH_0021
        .find("$fn_rebuild$")
        .expect("patch 0021 must carry 0016's definition")
        + "$fn_rebuild$".len();
    let rebuild_end = PATCH_0021[rebuild_start..]
        .find("$fn_rebuild$")
        .expect("0016's definition must close")
        + rebuild_start;
    let patch_0016 = std::fs::read_to_string(
        postgres_dir().join("patches/0016_audit_partition_without_split.sql"),
    )
    .expect("read patch 0016");
    assert!(
        patch_0016.contains(&format!(
            "$fn_current${}$fn_current$",
            &PATCH_0021[rebuild_start..rebuild_end]
        )),
        "patch 0021 must guard on exactly the definition patch 0016 installs"
    );
}

async fn audit_partition_revision_recorded(pool: &PgPool) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM hotel_schema_revisions WHERE generation = 1 AND version = 21)",
    )
    .fetch_one(pool)
    .await
    .expect("read patch 0021 revision")
}

#[tokio::test]
async fn postgres_v1_catalog_moves_late_audit_months_without_rebuilding_the_default() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let fresh = databases.create("audit_move_fresh").await;
    let fresh_pool = install_v1(&fresh).await;
    let baseline = audit_partition_function(&fresh_pool).await;
    assert_runner_succeeded(&run_patches(&fresh, None).await);
    let catalog_head = audit_partition_function(&fresh_pool).await;
    assert_ne!(
        catalog_head, baseline,
        "patch 0021 must replace the baseline (0016) definition on a fresh install"
    );
    assert!(audit_partition_revision_recorded(&fresh_pool).await);

    // A database deployed through patch 0020: 0016's rebuild definition.
    let database = databases.create("audit_move").await;
    let pool = install_v1(&database).await;
    let deployed = TemporaryCatalog::truncated_at(20);
    assert_runner_succeeded(&run_patches(&database, Some(&deployed.path)).await);
    assert_eq!(audit_partition_function(&pool).await, baseline);
    assert!(!audit_partition_revision_recorded(&pool).await);

    let first_run = run_patches(&database, None).await;
    assert_runner_succeeded(&first_run);
    assert_eq!(
        audit_partition_function(&pool).await,
        catalog_head,
        "patch 0021 must converge a deployed database onto the fresh-install definition"
    );
    assert_eq!(
        schema_inventory(&database).await,
        schema_inventory(&fresh).await,
        "an upgraded database must match a fresh install of the new catalog"
    );
    let revisions = revision_snapshot(&pool).await;
    assert!(
        revisions
            .iter()
            .any(|(version, name, _, _)| *version == 21 && name == "audit-partition-move-rows"),
        "patch 0021 must record its revision: {revisions:?}"
    );

    // Re-runs are no-ops: the runner skips the recorded revision, and the
    // patch body itself accepts its own definition.
    assert_runner_succeeded(&run_patches(&database, None).await);
    assert_eq!(revision_snapshot(&pool).await, revisions);
    sqlx::raw_sql(sqlx::AssertSqlSafe(PATCH_0021))
        .execute(&pool)
        .await
        .expect("re-running patch 0021's body must be a no-op");
    assert_eq!(audit_partition_function(&pool).await, catalog_head);

    // Rows for months without a partition land in the DEFAULT one. Creating
    // March late must move the March row only and keep the default table.
    sqlx::query(
        r#"
        INSERT INTO audit_logs (action, resource_type, details, created_at)
        VALUES ('late_month', 'patch_0021', '{"n":1}', '2098-03-03T00:00:00Z'),
               ('late_month_end', 'patch_0021', '{"n":2}', '2098-03-31T23:59:59Z'),
               ('other_month', 'patch_0021', '{"n":3}', '2098-04-01T00:00:00Z')
        "#,
    )
    .execute(&pool)
    .await
    .expect("insert audit rows into the DEFAULT partition");
    let audit_rows = r#"
        SELECT action::text, tableoid::regclass::text, audit_logs::text
        FROM audit_logs
        WHERE resource_type = 'patch_0021'
        ORDER BY action
    "#;
    let default_oid = "SELECT 'public.audit_logs_default'::regclass::oid::bigint";
    let before: Vec<(String, String, String)> = sqlx::query_as(audit_rows)
        .fetch_all(&pool)
        .await
        .expect("read audit rows before the move");
    let default_before: i64 = sqlx::query_scalar(default_oid)
        .fetch_one(&pool)
        .await
        .expect("read the DEFAULT partition oid");

    let mut transaction = pool.begin().await.expect("begin");
    sqlx::query("SELECT public.ensure_audit_logs_partition(DATE '2098-03-01')")
        .execute(&mut *transaction)
        .await
        .expect("create a late audit partition");
    let escape_hatch: Option<String> =
        sqlx::query_scalar("SELECT current_setting('app.allow_audit_mutation', true)")
            .fetch_one(&mut *transaction)
            .await
            .expect("read the escape hatch");
    assert_ne!(
        escape_hatch.as_deref(),
        Some("on"),
        "moving late audit rows must not enable app.allow_audit_mutation"
    );
    transaction.commit().await.expect("commit the move");
    // Idempotent once the month exists and the default is attached again.
    sqlx::query("SELECT public.ensure_audit_logs_partition(DATE '2098-03-01')")
        .execute(&pool)
        .await
        .expect("re-run for an existing month");

    let after: Vec<(String, String, String)> = sqlx::query_as(audit_rows)
        .fetch_all(&pool)
        .await
        .expect("read audit rows after the move");
    assert_eq!(
        after
            .iter()
            .map(|(action, partition, _)| (action.as_str(), partition.as_str()))
            .collect::<Vec<_>>(),
        [
            ("late_month", "audit_logs_2098_03"),
            ("late_month_end", "audit_logs_2098_03"),
            ("other_month", "audit_logs_default"),
        ]
    );
    // Every column value, id and created_at included, survives the move.
    assert_eq!(
        after.iter().map(|(_, _, row)| row).collect::<Vec<_>>(),
        before.iter().map(|(_, _, row)| row).collect::<Vec<_>>()
    );
    // The default is detached and reattached, not dropped and rebuilt (0016).
    assert_eq!(
        sqlx::query_scalar::<_, i64>(default_oid)
            .fetch_one(&pool)
            .await
            .expect("read the DEFAULT partition oid"),
        default_before
    );
    let default_bound: String = sqlx::query_scalar(
        "SELECT pg_get_expr(relpartbound, oid) FROM pg_class \
         WHERE oid = 'public.audit_logs_default'::regclass AND relispartition",
    )
    .fetch_one(&pool)
    .await
    .expect("the DEFAULT partition must be attached again");
    assert_eq!(default_bound, "DEFAULT");

    // audit_logs stays append-only after the move.
    for statement in [
        "UPDATE audit_logs SET action = 'tampered' WHERE resource_type = 'patch_0021'",
        "DELETE FROM audit_logs WHERE resource_type = 'patch_0021'",
    ] {
        let error = sqlx::query(statement)
            .execute(&pool)
            .await
            .expect_err("audit_logs must refuse UPDATE and DELETE after the move");
        assert!(
            error.to_string().contains("append-only"),
            "unexpected error for {statement}: {error}"
        );
    }
    let moved_rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_logs WHERE resource_type = 'patch_0021'")
            .fetch_one(&pool)
            .await
            .expect("count audit rows");
    assert_eq!(moved_rows, 3);

    pool.close().await;
    fresh_pool.close().await;
    drop(deployed);
    databases.cleanup().await;
}

#[tokio::test]
async fn postgres_v1_catalog_refuses_an_unexpected_audit_partition_function_before_0021() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let database = databases.create("audit_move_drift").await;
    let pool = install_v1(&database).await;
    let deployed = TemporaryCatalog::truncated_at(20);
    assert_runner_succeeded(&run_patches(&database, Some(&deployed.path)).await);

    sqlx::raw_sql(
        r#"
        CREATE OR REPLACE FUNCTION public.ensure_audit_logs_partition(p_month date)
        RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public'
        AS $$ BEGIN NULL; END; $$;
        COMMENT ON FUNCTION public.ensure_audit_logs_partition(date) IS 'drifted';
        "#,
    )
    .execute(&pool)
    .await
    .expect("install a drifted audit partition function");
    let drifted = audit_partition_function(&pool).await;

    let output = run_patches(&database, None).await;
    assert_runner_failed_with(
        &output,
        "ensure_audit_logs_partition(date) has incompatible definition",
    );
    assert!(
        !audit_partition_revision_recorded(&pool).await,
        "a refused patch 0021 must not record its revision"
    );
    assert_eq!(
        audit_partition_function(&pool).await,
        drifted,
        "a refused patch 0021 must roll back completely, comment included"
    );

    pool.close().await;
    drop(deployed);
    databases.cleanup().await;
}

/// `prevent_audit_log_mutation()` exactly as the baseline defined it from
/// 2026-09-13 until patch 0022: pg_get_functiondef output, returning NULL for
/// rows. Every database installed from the baseline in that window has it.
const PRE_0022_AUDIT_GUARD_FUNCTION: &str = r#"CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Escape hatch for fixture cleanup only: integration tests set this GUC
    -- per pooled connection so they can purge rows they wrote. Nothing in the
    -- application sets it. A principal that can run SET could equally drop the
    -- trigger, so the GUC widens nothing -- the trigger exists to stop
    -- accidental and application-level mutation, not the database owner.
    IF current_setting('app.allow_audit_mutation', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'audit_logs is append-only: UPDATE and DELETE are forbidden';
    END IF;
    RETURN NULL;
END;
$function$
"#;

/// The function comment those databases carry.
const PRE_0022_AUDIT_GUARD_COMMENT: &str = "COMMENT ON FUNCTION public.prevent_audit_log_mutation() IS 'Row-trigger body that makes audit_logs append-only even for the table owner. REVOKE cannot help here because the application connects as the owner, and owners bypass privilege checks; a BEFORE trigger is the only enforcement that applies.'";

/// Removes what patch 0022 adds on top of the earlier baseline: the row
/// trigger, the partitions' TRUNCATE guards, and the guard helper.
const PRE_0022_TEARDOWN: &str = r#"
DROP TRIGGER trg_audit_logs_append_only_row ON public.audit_logs;
DO $$
DECLARE
    partition_row record;
BEGIN
    FOR partition_row IN
        SELECT inhrelid::regclass AS partition_name
        FROM pg_inherits
        WHERE inhparent = 'public.audit_logs'::regclass
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON %s',
            partition_row.partition_name
        );
    END LOOP;
END;
$$;
DROP FUNCTION public.ensure_audit_logs_truncate_guards();
"#;

/// What production and staging look like before patch 0022: installed before
/// the baseline had any guard, so no guard function and no trigger at all.
const LIVE_PRE_0022_TEARDOWN: &str = r#"
DROP TRIGGER trg_audit_logs_append_only ON public.audit_logs;
DROP FUNCTION public.prevent_audit_log_mutation();
"#;

/// Everything patch 0022 converges: the guard function and the helper with
/// their comments, and every user trigger on audit_logs and its partitions.
async fn audit_guard_snapshot(pool: &PgPool) -> Vec<(String, String)> {
    sqlx::query_as(
        r#"
        SELECT 'function ' || routine_row.oid::regprocedure::text,
               pg_get_functiondef(routine_row.oid) || '-- '
                   || coalesce(obj_description(routine_row.oid, 'pg_proc'), '<no comment>')
        FROM pg_proc AS routine_row
        WHERE routine_row.oid IN (
            to_regprocedure('public.prevent_audit_log_mutation()'),
            to_regprocedure('public.ensure_audit_logs_truncate_guards()')
        )
        UNION ALL
        SELECT 'trigger ' || trigger_row.tgrelid::regclass::text || '.' || trigger_row.tgname,
               pg_get_triggerdef(trigger_row.oid)
                   || ' enabled=' || trigger_row.tgenabled::text
                   || ' cloned=' || (trigger_row.tgparentid <> 0)::text
        FROM pg_trigger AS trigger_row
        WHERE NOT trigger_row.tgisinternal
          AND (
              trigger_row.tgrelid = 'public.audit_logs'::regclass
              OR trigger_row.tgrelid IN (
                  SELECT inhrelid FROM pg_inherits
                  WHERE inhparent = 'public.audit_logs'::regclass
              )
          )
        ORDER BY 1
        "#,
    )
    .fetch_all(pool)
    .await
    .expect("read the audit guard snapshot")
}

/// Runs `statement` in a transaction that is always rolled back and returns
/// its error text, or `Ok` when the guard let it through.
async fn audit_mutation_probe(pool: &PgPool, statement: &str) -> Result<(), String> {
    let mut probe = pool.begin().await.expect("begin the audit mutation probe");
    let result = sqlx::query(sqlx::AssertSqlSafe(statement))
        .execute(&mut *probe)
        .await;
    probe
        .rollback()
        .await
        .expect("roll back the audit mutation probe");
    result.map(|_| ()).map_err(|error| error.to_string())
}

async fn audit_guard_revision_recorded(pool: &PgPool) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM hotel_schema_revisions WHERE generation = 1 AND version = 22)",
    )
    .fetch_one(pool)
    .await
    .expect("read patch 0022 revision")
}

#[tokio::test]
async fn postgres_v1_catalog_guards_every_audit_partition() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let fresh = databases.create("guard_fresh").await;
    let fresh_pool = install_v1(&fresh).await;
    let baseline = audit_guard_snapshot(&fresh_pool).await;
    assert!(
        baseline
            .iter()
            .any(|(name, _)| name == "trigger audit_logs_default.trg_audit_logs_no_truncate"),
        "the baseline must guard its DEFAULT partition: {baseline:#?}"
    );
    assert_runner_succeeded(&run_patches(&fresh, None).await);
    assert_eq!(
        audit_guard_snapshot(&fresh_pool).await,
        baseline,
        "patch 0022 must be a no-op on a fresh install"
    );
    let fresh_inventory = schema_inventory(&fresh).await;

    // Three starting points, each recorded through revision 21: production and
    // staging (no guard at all), and a baseline install from the 2026-09-13
    // window (statement trigger only), stored with LF or with CRLF bodies.
    for (label, live, line_ending) in [
        ("guard_live", true, "\n"),
        ("guard_lf", false, "\n"),
        ("guard_crlf", false, "\r\n"),
    ] {
        let database = databases.create(label).await;
        let pool = install_v1(&database).await;
        let through_21 = TemporaryCatalog::truncated_at(21);
        assert_runner_succeeded(&run_patches(&database, Some(&through_21.path)).await);
        sqlx::raw_sql(PRE_0022_TEARDOWN)
            .execute(&pool)
            .await
            .expect("remove the patch 0022 guards");
        if live {
            sqlx::raw_sql(LIVE_PRE_0022_TEARDOWN)
                .execute(&pool)
                .await
                .expect("remove the guard entirely, as on production");
            assert_eq!(
                audit_mutation_probe(&pool, "DELETE FROM public.audit_logs").await,
                Ok(()),
                "a live pre-0022 database lets DELETE on audit_logs through"
            );
        } else {
            let old_function = PRE_0022_AUDIT_GUARD_FUNCTION.replace('\n', line_ending);
            for statement in [old_function.as_str(), PRE_0022_AUDIT_GUARD_COMMENT] {
                sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
                    .execute(&pool)
                    .await
                    .expect("restore the pre-0022 guard function");
            }
        }
        assert_eq!(
            audit_mutation_probe(&pool, "TRUNCATE public.audit_logs_default").await,
            Ok(()),
            "a pre-0022 database lets a statement that names a partition skip the guard"
        );
        assert!(!audit_guard_revision_recorded(&pool).await);

        assert_runner_succeeded(&run_patches(&database, None).await);
        assert_eq!(
            audit_guard_snapshot(&pool).await,
            baseline,
            "patch 0022 must converge onto the baseline guards ({label})"
        );
        assert_eq!(
            schema_inventory(&database).await,
            fresh_inventory,
            "an upgraded database must match a fresh install ({label})"
        );
        let revisions = revision_snapshot(&pool).await;
        assert!(
            revisions
                .iter()
                .any(|(version, name, _, _)| *version == 22
                    && name == "audit-logs-append-only-guards"),
            "patch 0022 must record its revision: {revisions:?}"
        );
        // A row in the DEFAULT partition, so the row trigger has work to refuse.
        sqlx::query(
            "INSERT INTO audit_logs (action, resource_type, created_at) \
             VALUES ('guarded', 'patch_0022', '2098-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("append an audit row; the guard must not block INSERT");
        for statement in [
            "DELETE FROM public.audit_logs",
            "UPDATE public.audit_logs SET action = action",
            "TRUNCATE public.audit_logs",
            "DELETE FROM public.audit_logs_default",
            "TRUNCATE public.audit_logs_default",
        ] {
            let refused = audit_mutation_probe(&pool, statement)
                .await
                .expect_err("a patched database must refuse audit mutation");
            assert!(
                refused.contains("audit_logs is append-only"),
                "{label}: {statement}: {refused}"
            );
        }

        // Re-running is a no-op, through the runner and the patch body alike.
        assert_runner_succeeded(&run_patches(&database, None).await);
        assert_eq!(revision_snapshot(&pool).await, revisions);
        sqlx::raw_sql(sqlx::AssertSqlSafe(&*psql_script_for_sqlx(PATCH_0022)))
            .execute(&pool)
            .await
            .expect("re-running patch 0022's body must be a no-op");
        assert_eq!(audit_guard_snapshot(&pool).await, baseline);

        pool.close().await;
        drop(through_21);
    }
    fresh_pool.close().await;
    databases.cleanup().await;
}

const PATCH_0022: &str =
    include_str!("../database/postgres/patches/0022_audit_logs_append_only_guards.sql");

#[tokio::test]
async fn postgres_v1_catalog_refuses_a_drifted_audit_guard_and_rolls_back() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;

    // An unknown guard body is refused before anything changes.
    let drifted_body = databases.create("guard_drift").await;
    let pool = install_v1(&drifted_body).await;
    let through_21 = TemporaryCatalog::truncated_at(21);
    assert_runner_succeeded(&run_patches(&drifted_body, Some(&through_21.path)).await);
    sqlx::raw_sql(PRE_0022_TEARDOWN)
        .execute(&pool)
        .await
        .expect("remove the patch 0022 guards");
    sqlx::raw_sql(
        r#"
        CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
        RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public'
        AS $$ BEGIN RETURN NULL; END; $$
        "#,
    )
    .execute(&pool)
    .await
    .expect("install a drifted audit guard function");
    let before = audit_guard_snapshot(&pool).await;
    assert_runner_failed_with(
        &run_patches(&drifted_body, None).await,
        "prevent_audit_log_mutation() has incompatible definition",
    );
    assert!(!audit_guard_revision_recorded(&pool).await);
    assert_eq!(audit_guard_snapshot(&pool).await, before);
    pool.close().await;

    // A disabled parent trigger is refused after the function was already
    // replaced, and the whole patch rolls back, function included.
    let disabled = databases.create("guard_disabled").await;
    let pool = install_v1(&disabled).await;
    assert_runner_succeeded(&run_patches(&disabled, Some(&through_21.path)).await);
    sqlx::raw_sql(PRE_0022_TEARDOWN)
        .execute(&pool)
        .await
        .expect("remove the patch 0022 guards");
    for statement in [
        PRE_0022_AUDIT_GUARD_FUNCTION,
        PRE_0022_AUDIT_GUARD_COMMENT,
        "ALTER TABLE public.audit_logs DISABLE TRIGGER trg_audit_logs_append_only",
    ] {
        sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
            .execute(&pool)
            .await
            .expect("rebuild a pre-0022 database with a disabled guard");
    }
    let before = audit_guard_snapshot(&pool).await;
    assert_runner_failed_with(
        &run_patches(&disabled, None).await,
        "trg_audit_logs_append_only has incompatible definition",
    );
    assert!(!audit_guard_revision_recorded(&pool).await);
    assert_eq!(
        audit_guard_snapshot(&pool).await,
        before,
        "a refused patch 0022 must roll back completely"
    );
    pool.close().await;

    drop(through_21);
    databases.cleanup().await;
}

#[tokio::test]
async fn postgres_v1_late_audit_month_moves_under_the_partition_guards() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    // Production's path: revision 21, no guard, then patch 0022.
    let database = databases.create("guard_late_month").await;
    let pool = install_v1(&database).await;
    let through_21 = TemporaryCatalog::truncated_at(21);
    assert_runner_succeeded(&run_patches(&database, Some(&through_21.path)).await);
    for teardown in [PRE_0022_TEARDOWN, LIVE_PRE_0022_TEARDOWN] {
        sqlx::raw_sql(teardown)
            .execute(&pool)
            .await
            .expect("rebuild a live pre-0022 database");
    }
    assert_runner_succeeded(&run_patches(&database, None).await);

    sqlx::query(
        r#"
        INSERT INTO audit_logs (action, resource_type, created_at)
        VALUES ('late_month', 'patch_0022', '2097-03-03T00:00:00Z'),
               ('other_month', 'patch_0022', '2097-04-04T00:00:00Z')
        "#,
    )
    .execute(&pool)
    .await
    .expect("append audit rows; the guard must not block INSERT");

    // Patch 0021's move deletes from the detached default. DETACH drops the
    // cloned row trigger there, so the move needs no escape hatch.
    let mut transaction = pool.begin().await.expect("begin");
    sqlx::query("SELECT public.ensure_audit_logs_partition(DATE '2097-03-01')")
        .execute(&mut *transaction)
        .await
        .expect("a late month must still move under the guards");
    let escape_hatch: Option<String> =
        sqlx::query_scalar("SELECT current_setting('app.allow_audit_mutation', true)")
            .fetch_one(&mut *transaction)
            .await
            .expect("read the escape hatch");
    assert_ne!(escape_hatch.as_deref(), Some("on"));
    transaction.commit().await.expect("commit the move");
    // Partition upkeep runs this right after ensure_audit_logs_partition().
    let added: i32 = sqlx::query_scalar("SELECT public.ensure_audit_logs_truncate_guards()")
        .fetch_one(&pool)
        .await
        .expect("guard the new partition");
    assert_eq!(added, 1, "only the new month lacks a TRUNCATE guard");

    let placement: Vec<(String, String)> = sqlx::query_as(
        "SELECT action::text, tableoid::regclass::text FROM audit_logs \
         WHERE resource_type = 'patch_0022' ORDER BY action",
    )
    .fetch_all(&pool)
    .await
    .expect("read audit row placement");
    assert_eq!(
        placement,
        [
            ("late_month", "audit_logs_2097_03"),
            ("other_month", "audit_logs_default"),
        ]
        .map(|(action, table)| (action.to_owned(), table.to_owned()))
        .to_vec()
    );
    let guards: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT tgrelid::regclass::text, tgname::text
        FROM pg_trigger
        WHERE tgrelid IN ('audit_logs_2097_03'::regclass, 'audit_logs_default'::regclass)
          AND NOT tgisinternal
        ORDER BY 1, 2
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("read partition guards");
    assert_eq!(
        guards,
        [
            ("audit_logs_2097_03", "trg_audit_logs_append_only_row"),
            ("audit_logs_2097_03", "trg_audit_logs_no_truncate"),
            ("audit_logs_default", "trg_audit_logs_append_only_row"),
            ("audit_logs_default", "trg_audit_logs_no_truncate"),
        ]
        .map(|(table, trigger)| (table.to_owned(), trigger.to_owned()))
        .to_vec()
    );

    // Every route to change audit history is refused: the parent and each
    // partition, UPDATE, DELETE and TRUNCATE.
    for table in ["audit_logs", "audit_logs_2097_03", "audit_logs_default"] {
        for statement in [
            format!(
                "UPDATE public.{table} SET action = 'tampered' WHERE resource_type = 'patch_0022'"
            ),
            format!("DELETE FROM public.{table} WHERE resource_type = 'patch_0022'"),
            format!("TRUNCATE public.{table}"),
        ] {
            let refused = audit_mutation_probe(&pool, &statement)
                .await
                .expect_err("audit history must be append-only");
            assert!(
                refused.contains("audit_logs is append-only"),
                "{statement}: {refused}"
            );
        }
    }
    // The escape hatch, for one transaction, still changes rows.
    let mut transaction = pool.begin().await.expect("begin");
    sqlx::query("SET LOCAL app.allow_audit_mutation = 'on'")
        .execute(&mut *transaction)
        .await
        .expect("open the escape hatch");
    let deleted = sqlx::query("DELETE FROM public.audit_logs WHERE resource_type = 'patch_0022'")
        .execute(&mut *transaction)
        .await
        .expect("the escape hatch must allow DELETE")
        .rows_affected();
    assert_eq!(deleted, 2);
    transaction.rollback().await.expect("roll back");

    pool.close().await;
    drop(through_21);
    databases.cleanup().await;
}

/// `sync_room_status_with_booking()` exactly as every V1 database installed
/// before patch 0018 defines it: pg_get_functiondef output. It reserved a room
/// for any holding booking, whatever its check-in date.
const PRE_0018_ROOM_SYNC_TRIGGER: &str = r#"CREATE OR REPLACE FUNCTION public.sync_room_status_with_booking()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_current_room_status VARCHAR(20);
    v_next_status VARCHAR(20);
    v_has_other_current_stay BOOLEAN;
BEGIN
    -- Skip room status changes for back-dated stays that have already ended.
    IF NEW.check_out_date < CURRENT_DATE
       AND NEW.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed') THEN
        RETURN NEW;
    END IF;

    SELECT status INTO v_current_room_status FROM rooms WHERE id = NEW.room_id;

    SELECT EXISTS (
        SELECT 1 FROM bookings
        WHERE room_id = NEW.room_id
          AND id != NEW.id
          AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
          AND check_in_date <= CURRENT_DATE
          AND check_out_date >= CURRENT_DATE
    ) INTO v_has_other_current_stay;

    IF NEW.status IN ('checked_in', 'auto_checked_in', 'late_checkout')
       AND v_current_room_status != 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'occupied',
            'Guest checked in - Booking #' || NEW.id, NULL,
            NEW.check_in_date, NEW.check_out_date);

    ELSIF NEW.status IN ('checked_out', 'completed')
          AND v_current_room_status = 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'dirty',
            'Guest checked out - Needs cleaning - Booking #' || NEW.id,
            NULL, CURRENT_TIMESTAMP, NULL);

    ELSIF NEW.status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
          AND NOT v_has_other_current_stay
          AND v_current_room_status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning', 'reserved_dirty') THEN
        PERFORM update_room_status(NEW.room_id, 'reserved',
            CASE
                WHEN NEW.check_in_date::date = CURRENT_DATE
                    THEN 'Same-day reservation - Booking #' || NEW.id
                ELSE 'Future reservation - Booking #' || NEW.id
            END,
            NULL, NEW.check_in_date, NEW.check_out_date);

    ELSIF NEW.status IN ('no_show', 'voided')
          AND v_current_room_status IN ('occupied', 'reserved') THEN
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = NEW.room_id
                  AND id != NEW.id
                  AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
                  AND check_in_date <= CURRENT_DATE
                  AND check_out_date >= CURRENT_DATE
            ) THEN 'occupied'
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = NEW.room_id
                  AND id != NEW.id
                  AND status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
                  AND check_out_date > CURRENT_DATE
            ) THEN 'reserved'
            ELSE 'available'
        END INTO v_next_status;

        PERFORM update_room_status(NEW.room_id, v_next_status,
            'Booking no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;

    RETURN NEW;
END;
$function$

"#;

/// `sync_all_room_statuses(bigint)` before patch 0018: it treated any holding
/// booking that had not checked out yet as a reservation for today.
const PRE_0018_SYNC_ALL_ROOM_STATUSES: &str = r#"CREATE OR REPLACE FUNCTION public.sync_all_room_statuses(p_user_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(room_id bigint, room_number character varying, old_status character varying, new_status character varying)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_room RECORD;
    v_desired VARCHAR(20);
    v_res_start DATE;
    v_res_end DATE;
BEGIN
    -- Bulk reconciliation of rooms.status against bookings. Mirrors the policy
    -- of the sync_room_status_with_booking() trigger: housekeeping and
    -- maintenance states (dirty, cleaning, reserved_dirty, maintenance,
    -- out_of_order) are never overridden; only the booking-derived states
    -- (available, occupied, reserved) are recomputed.
    FOR v_room IN
        SELECT r.id, r.room_number, r.status
        FROM rooms r
        WHERE r.is_active = true
          AND r.status IN ('available', 'occupied', 'reserved')
        ORDER BY r.id
    LOOP
        v_res_start := NULL;
        v_res_end := NULL;

        IF EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.room_id = v_room.id
              AND b.status IN ('checked_in', 'auto_checked_in', 'late_checkout')
              AND b.check_in_date <= CURRENT_DATE
              AND b.check_out_date >= CURRENT_DATE
        ) THEN
            v_desired := 'occupied';
        ELSE
            SELECT b.check_in_date, b.check_out_date
              INTO v_res_start, v_res_end
              FROM bookings b
             WHERE b.room_id = v_room.id
               AND b.status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
               AND b.check_out_date > CURRENT_DATE
             ORDER BY b.check_in_date
             LIMIT 1;
            IF FOUND THEN
                v_desired := 'reserved';
            ELSE
                v_desired := 'available';
            END IF;
        END IF;

        IF v_desired <> v_room.status THEN
            PERFORM update_room_status(v_room.id, v_desired,
                'Bulk status sync from bookings', p_user_id, v_res_start, v_res_end);
            room_id := v_room.id;
            room_number := v_room.room_number;
            old_status := v_room.status;
            new_status := v_desired;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$function$

"#;

async fn room_hold_functions(pool: &PgPool) -> Vec<(String, String, Option<String>)> {
    sqlx::query_as(
        r#"
        SELECT routine_row.oid::regprocedure::text,
               pg_get_functiondef(routine_row.oid),
               obj_description(routine_row.oid, 'pg_proc')
        FROM pg_proc AS routine_row
        WHERE routine_row.oid IN (
            to_regprocedure('public.reconcile_room_holds(bigint)'),
            to_regprocedure('public.sync_room_status_with_booking()'),
            to_regprocedure('public.sync_all_room_statuses(bigint)')
        )
        ORDER BY 1
        "#,
    )
    .fetch_all(pool)
    .await
    .expect("read the room-hold functions")
}

async fn restore_pre_0018_room_hold_functions(pool: &PgPool) {
    for statement in [
        "DROP FUNCTION public.reconcile_room_holds(bigint)",
        PRE_0018_ROOM_SYNC_TRIGGER,
        PRE_0018_SYNC_ALL_ROOM_STATUSES,
    ] {
        sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
            .execute(pool)
            .await
            .expect("restore the pre-0018 room-hold functions");
    }
}

#[tokio::test]
async fn postgres_v1_catalog_moves_room_holds_to_the_arrival_day() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let database = databases.create("room_hold").await;
    let pool = install_v1(&database).await;
    let baseline = room_hold_functions(&pool).await;
    assert_eq!(
        baseline.len(),
        3,
        "the baseline must define all room-hold functions"
    );

    // Rebuild a database installed before patch 0018.
    restore_pre_0018_room_hold_functions(&pool).await;
    let old = room_hold_functions(&pool).await;
    assert_eq!(old.len(), 2);
    assert!(
        old.iter()
            .all(|(_, definition, _)| !definition.contains("reconcile_room_holds"))
    );

    let first_run = run_patches(&database, None).await;
    assert_runner_succeeded(&first_run);
    assert_eq!(
        room_hold_functions(&pool).await,
        baseline,
        "patch 0018 must converge onto the baseline definitions and comment"
    );
    let revisions = revision_snapshot(&pool).await;
    assert!(
        revisions
            .iter()
            .any(|(version, name, _, _)| *version == 18 && name == "room-hold-arrival-day"),
        "patch 0018 must record its revision: {revisions:?}"
    );

    let second_run = run_patches(&database, None).await;
    assert_runner_succeeded(&second_run);
    assert_eq!(room_hold_functions(&pool).await, baseline);
    assert_eq!(revision_snapshot(&pool).await, revisions);

    pool.close().await;
    databases.cleanup().await;
}

#[tokio::test]
async fn postgres_v1_catalog_refuses_a_drifted_room_sync_trigger() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let database = databases.create("room_hold_drift").await;
    let pool = install_v1(&database).await;

    restore_pre_0018_room_hold_functions(&pool).await;
    sqlx::raw_sql(
        r#"
        CREATE OR REPLACE FUNCTION public.sync_room_status_with_booking()
        RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public'
        AS $$ BEGIN RETURN NEW; END; $$
        "#,
    )
    .execute(&pool)
    .await
    .expect("install a drifted room-sync trigger function");

    let output = run_patches(&database, None).await;
    assert_runner_failed_with(
        &output,
        "sync_room_status_with_booking() has incompatible definition",
    );
    let recorded: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM hotel_schema_revisions WHERE generation = 1 AND version = 18)",
    )
    .fetch_one(&pool)
    .await
    .expect("read patch 0018 revision");
    assert!(!recorded, "a refused patch must not record its revision");
    let reconcile_exists: bool = sqlx::query_scalar(
        "SELECT to_regprocedure('public.reconcile_room_holds(bigint)') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .expect("probe reconcile_room_holds");
    assert!(
        !reconcile_exists,
        "a refused patch must roll back completely"
    );

    pool.close().await;
    databases.cleanup().await;
}

/// The schema-inventory lines patch 0019 owns, with the column ordinal
/// dropped (the rebuild above re-adds columns after dropped slots).
async fn payment_void_inventory(database: &TestDatabase) -> Vec<String> {
    use base64::Engine as _;
    let lines: Vec<String> = schema_inventory(database)
        .await
        .lines()
        .filter(|line| {
            line.contains("public.payments.void")
                || line.contains("payments_voided_by_fkey")
                || line.contains("idx_payments_void_reversal_date")
        })
        .map(|line| {
            let mut fields: Vec<String> = line.split('\t').map(str::to_string).collect();
            if let Some(last) = fields.last_mut()
                && let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(last.as_bytes())
                && let Ok(decoded) = String::from_utf8(bytes)
            {
                *last = decoded
                    .split(';')
                    .filter(|part| !part.starts_with("ordinal="))
                    .collect::<Vec<_>>()
                    .join(";");
            }
            fields.join("\t")
        })
        .collect();
    assert!(
        lines.len() >= 6,
        "the inventory must list the four void columns, the FK and the index: {lines:?}"
    );
    lines
}

async fn receptionist_has_payments_delete(pool: &PgPool) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM role_permissions rp \
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id \
         WHERE r.name = 'receptionist' AND p.name = 'payments:delete')",
    )
    .fetch_one(pool)
    .await
    .expect("read the receptionist payments:delete grant")
}

#[tokio::test]
async fn postgres_v1_catalog_adds_payment_void_metadata() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let fresh = databases.create("payment_void_fresh").await;
    let upgraded = databases.create("payment_void_upgraded").await;
    let fresh_pool = install_v1(&fresh).await;
    let pool = install_v1(&upgraded).await;
    // Patch 0020 handed "Void payments" back to the front desk.
    assert!(
        receptionist_has_payments_delete(&fresh_pool).await,
        "a fresh install grants receptionists payments:delete (Void payments)"
    );

    // Rebuild a database installed before patch 0019: no void metadata and
    // the front desk still holding payments:delete.
    sqlx::raw_sql(
        r#"
        DROP INDEX public.idx_payments_void_reversal_date;
        ALTER TABLE public.payments
            DROP COLUMN void_reason,
            DROP COLUMN voided_at,
            DROP COLUMN voided_by,
            DROP COLUMN void_reversal_date;
        INSERT INTO public.role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM public.roles r, public.permissions p
        WHERE r.name = 'receptionist' AND p.name = 'payments:delete'
        ON CONFLICT DO NOTHING;
        DELETE FROM public.hotel_schema_revisions WHERE generation = 1 AND version = 19;
        "#,
    )
    .execute(&pool)
    .await
    .expect("rebuild a pre-0019 database");
    assert!(receptionist_has_payments_delete(&pool).await);

    let first_run = run_patches(&upgraded, None).await;
    assert_runner_succeeded(&first_run);
    // 0019 revokes the desk grant and 0020 restores it, so a database
    // upgraded across both ends up where a fresh install starts.
    assert!(
        receptionist_has_payments_delete(&pool).await,
        "patches 0019 + 0020 must leave the receptionist role with payments:delete"
    );
    assert_eq!(
        payment_void_inventory(&upgraded).await,
        payment_void_inventory(&fresh).await,
        "patch 0019 must converge onto the baseline payment void columns, FK, index and comment"
    );
    let revisions = revision_snapshot(&pool).await;
    assert!(
        revisions
            .iter()
            .any(|(version, name, _, _)| *version == 19 && name == "payment-void-reason"),
        "patch 0019 must record its revision: {revisions:?}"
    );

    let second_run = run_patches(&upgraded, None).await;
    assert_runner_succeeded(&second_run);
    assert_eq!(revision_snapshot(&pool).await, revisions);

    pool.close().await;
    fresh_pool.close().await;
    databases.cleanup().await;
}

#[tokio::test]
async fn postgres_v1_catalog_returns_void_payments_to_the_front_desk() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let database = databases.create("reception_void").await;
    let pool = install_v1(&database).await;

    // A database that ran 0019 before 0020 existed: no desk grant, old label.
    sqlx::raw_sql(
        r#"
        DELETE FROM public.role_permissions rp
        USING public.roles r, public.permissions p
        WHERE rp.role_id = r.id AND rp.permission_id = p.id
          AND r.name = 'receptionist' AND p.name IN ('payments:delete', 'payments:approve');
        UPDATE public.permissions SET description = 'Delete payment records'
        WHERE name = 'payments:delete';
        "#,
    )
    .execute(&pool)
    .await
    .expect("rebuild a pre-0020 database");
    assert!(!receptionist_has_payments_delete(&pool).await);

    let first_run = run_patches(&database, None).await;
    assert_runner_succeeded(&first_run);
    assert!(
        receptionist_has_payments_delete(&pool).await,
        "patch 0020 must grant receptionists payments:delete"
    );
    let manage: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM role_permissions rp \
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id \
         WHERE r.name = 'receptionist' AND p.name = 'payments:manage')",
    )
    .fetch_one(&pool)
    .await
    .expect("read receptionist manage/approve grants");
    assert!(!manage, "the front desk must not gain payments:manage");
    let approve: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM role_permissions rp \
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id \
         WHERE r.name = 'receptionist' AND p.name = 'payments:approve')",
    )
    .fetch_one(&pool)
    .await
    .expect("read receptionist approve grant");
    assert!(
        approve,
        "patch 0020 must grant receptionists payments:approve"
    );
    let label: String =
        sqlx::query_scalar("SELECT description FROM permissions WHERE name = 'payments:delete'")
            .fetch_one(&pool)
            .await
            .expect("read the payments:delete label");
    assert!(label.starts_with("Void payments"), "relabelled: {label}");
    let revisions = revision_snapshot(&pool).await;
    assert!(
        revisions
            .iter()
            .any(|(version, name, _, _)| *version == 20 && name == "reception-payment-void"),
        "patch 0020 must record its revision: {revisions:?}"
    );

    let second_run = run_patches(&database, None).await;
    assert_runner_succeeded(&second_run);
    assert_eq!(revision_snapshot(&pool).await, revisions);

    pool.close().await;
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
