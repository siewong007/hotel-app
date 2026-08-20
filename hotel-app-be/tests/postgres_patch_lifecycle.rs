use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, PgPool};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Output, Stdio};
use tokio::process::Command;
use tokio::time::{Duration, timeout};

const POSTGRES_SCHEMA: &str = include_str!("../database/postgres/migrations/0001_v1_baseline.sql");
const POSTGRES_SEED: &str = include_str!("../database/postgres/seed.sql");

const DOCUMENTED_V1_DOWNGRADE: &str = r#"
DELETE FROM hotel_schema_revisions WHERE generation = 1 AND version > 1;

DROP INDEX IF EXISTS uq_users_google_subject;
ALTER TABLE users DROP COLUMN IF EXISTS google_subject;

DROP INDEX IF EXISTS uq_payments_booking_idempotency;
DROP INDEX IF EXISTS uq_ledger_payments_ledger_idempotency;
DROP INDEX IF EXISTS idx_customer_ledger_payments_receipt_unique;
ALTER TABLE payments
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS idempotency_fingerprint;
ALTER TABLE customer_ledger_payments
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS idempotency_fingerprint;
CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique
    ON customer_ledger_payments (lower(TRIM(BOTH FROM receipt_number)))
    WHERE receipt_number IS NOT NULL AND TRIM(BOTH FROM receipt_number) <> ''::text;

ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (
    status::text = ANY (
        ARRAY[
            'pending'::character varying,
            'confirmed'::character varying,
            'checked_in'::character varying,
            'auto_checked_in'::character varying,
            'checked_out'::character varying,
            'no_show'::character varying,
            'completed'::character varying,
            'comp_void'::character varying,
            'partial_complimentary'::character varying,
            'fully_complimentary'::character varying,
            'voided'::character varying
        ]::text[]
    )
);
"#;

#[derive(Clone)]
struct TestDatabase {
    name: String,
    user: String,
    url: String,
}

struct DisposableDatabases {
    admin_url: String,
    names: Vec<String>,
    user: String,
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
        let user: String = sqlx::query_scalar("SELECT current_user")
            .fetch_one(&mut admin)
            .await
            .expect("read PostgreSQL database user");

        Self {
            admin_url,
            names: Vec::new(),
            user,
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
            .execute(format!("CREATE DATABASE {}", quote_ident(&name)).as_str())
            .await
            .expect("create disposable PostgreSQL database");
        self.names.push(name.clone());
        TestDatabase {
            name,
            user: self.user.clone(),
            url,
        }
    }

    async fn cleanup(&mut self) {
        let mut admin = PgConnection::connect(&self.admin_url)
            .await
            .expect("connect to PostgreSQL admin database for cleanup");
        while let Some(name) = self.names.last().cloned() {
            admin
                .execute(
                    format!(
                        "DROP DATABASE IF EXISTS {} WITH (FORCE)",
                        quote_ident(&name)
                    )
                    .as_str(),
                )
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

    fn update_patch_checksum(&self, file: &str) -> String {
        let patch_bytes = std::fs::read(self.path.join(file)).expect("read temporary patch");
        let checksum = format!("sha256:{}", hex::encode(Sha256::digest(patch_bytes)));
        let manifest_path = self.path.join("manifest.tsv");
        let manifest =
            std::fs::read_to_string(&manifest_path).expect("read temporary patch manifest");
        let mut updated = false;
        let manifest = manifest
            .lines()
            .map(|line| {
                let mut fields = line.split('\t').map(str::to_owned).collect::<Vec<_>>();
                if fields.len() == 5 && fields[4] == file {
                    fields[3] = checksum.clone();
                    updated = true;
                    fields.join("\t")
                } else {
                    line.to_owned()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(updated, "temporary manifest has no row for {file}");
        std::fs::write(manifest_path, format!("{manifest}\n"))
            .expect("update temporary patch checksum");
        checksum
    }

    fn with_failing_patch() -> Self {
        let catalog = Self::copy_committed();

        let patch_source = "CREATE TABLE patch_failure_sentinel(id integer); SELECT 1 / 0;\n";
        std::fs::write(catalog.path.join("0005_injected_failure.sql"), patch_source)
            .expect("write injected failing patch");
        let checksum = hex::encode(Sha256::digest(patch_source.as_bytes()));
        writeln!(
            OpenOptions::new()
                .append(true)
                .open(catalog.path.join("manifest.tsv"))
                .expect("open temporary patch manifest"),
            "1\t5\tinjected-failure\tsha256:{checksum}\t0005_injected_failure.sql"
        )
        .expect("append injected patch manifest row");

        catalog
    }

    fn with_sleeping_google_subject_patch() -> (Self, String) {
        let catalog = Self::copy_committed();
        let file = "0002_google_subject.sql";
        let patch_path = catalog.path.join(file);
        let patch_source =
            std::fs::read_to_string(&patch_path).expect("read temporary google-subject patch");
        std::fs::write(patch_path, format!("SELECT pg_sleep(5);\n{patch_source}"))
            .expect("write lock-holding temporary patch");
        let checksum = catalog.update_patch_checksum(file);
        (catalog, checksum)
    }
}

impl Drop for TemporaryCatalog {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn postgres_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("database/postgres")
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
        sqlx::raw_sql(&psql_script_for_sqlx(script))
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
        WHERE generation = 1 AND version BETWEEN 2 AND 4
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
                  ('customer_ledger_payments', 'idempotency_fingerprint')
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
                  'uq_payments_booking_idempotency'
              )
            UNION ALL
            SELECT
                'constraint', constraint_row.conname, constraint_row.oid::text,
                pg_get_constraintdef(constraint_row.oid)
            FROM pg_constraint AS constraint_row
            JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
            JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
            WHERE schema_row.nspname = 'public'
              AND table_row.relname = 'bookings'
              AND constraint_row.conname = 'bookings_status_check'
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

fn assert_expected_revisions(revisions: &RevisionSnapshot, google_subject_checksum: &str) {
    assert_eq!(revisions.len(), 3);
    assert_eq!(
        revisions
            .iter()
            .map(|(version, name, checksum, _)| (*version, name.as_str(), checksum.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (2, "google-subject", google_subject_checksum,),
            (
                3,
                "payment-idempotency",
                "sha256:4e3e36411f1b7e013a4ee122404126f5e767d4560dd02e657791675243b78d36",
            ),
            (
                4,
                "booking-status-vocabulary",
                "sha256:abc4424b4bd33ed76dcc0eedc533096e4f982f0c5401ca62404dc67cbac05ff7",
            ),
        ]
    );
}

fn assert_expected_objects(objects: &ObjectSnapshot) {
    let definitions = object_definitions(objects);
    assert_eq!(definitions.len(), 10);
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
    assert!(definitions.iter().any(|(kind, name, definition)| {
        *kind == "constraint"
            && *name == "bookings_status_check"
            && definition.contains("'pending_payment'::character varying")
            && definition.contains("'pending_confirmation'::character varying")
    }));
}

async fn schema_dump(database: &TestDatabase) -> String {
    let dump_args = [
        "--schema-only",
        "--no-owner",
        "--no-privileges",
        "--restrict-key=0123456789abcdef0123456789abcdef",
    ];
    let local_output = Command::new("pg_dump")
        .args(dump_args)
        .env("PGDATABASE", &database.url)
        .output()
        .await
        .expect("start pg_dump");
    let output = if local_output.status.success() {
        local_output
    } else {
        let containers = Command::new("docker")
            .args([
                "ps",
                "--filter",
                "ancestor=postgres:19beta2",
                "--format",
                "{{.ID}}",
            ])
            .output()
            .await
            .expect("locate PostgreSQL 19 container for pg_dump");
        let container_id = String::from_utf8_lossy(&containers.stdout)
            .lines()
            .next()
            .expect("a PostgreSQL 19 pg_dump is required")
            .to_owned();
        let mut command = Command::new("docker");
        command
            .args([
                "exec",
                &container_id,
                "pg_dump",
                "-U",
                &database.user,
                "-d",
                &database.name,
            ])
            .args(dump_args);
        command
            .output()
            .await
            .expect("run PostgreSQL 19 pg_dump in server container")
    };
    assert!(
        output.status.success(),
        "pg_dump failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("pg_dump output must be UTF-8")
}

fn normalize_schema_dump(dump: &str, database_names: &[&str]) -> String {
    dump.lines()
        .filter(|line| {
            !line.starts_with("-- Dumped from database version")
                && !line.starts_with("-- Dumped by pg_dump version")
                && !line.starts_with("-- Started on")
                && !line.starts_with("-- Completed on")
        })
        .map(|line| {
            database_names.iter().fold(line.to_owned(), |line, name| {
                line.replace(name, "<database>")
            })
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn postgres_v1_patches_converge_and_are_idempotent() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;
    let fresh = databases.create("fresh").await;
    let upgrade = databases.create("upgrade").await;
    let fresh_pool = install_v1(&fresh).await;
    let upgrade_pool = install_v1(&upgrade).await;

    sqlx::raw_sql(DOCUMENTED_V1_DOWNGRADE)
        .execute(&upgrade_pool)
        .await
        .expect("apply documented old V1 downgrade");

    let first_run = run_patches(&upgrade, None).await;
    assert_runner_succeeded(&first_run);
    let first_revisions = revision_snapshot(&upgrade_pool).await;
    let first_objects = object_snapshot(&upgrade_pool).await;
    assert_expected_revisions(
        &first_revisions,
        "sha256:25db31d1c54440cde9344145637a7a088c3973b8ccf9e503aade1941d1dc2650",
    );
    assert_expected_objects(&first_objects);

    let second_run = run_patches(&upgrade, None).await;
    assert_runner_succeeded(&second_run);
    assert_eq!(revision_snapshot(&upgrade_pool).await, first_revisions);
    assert_eq!(object_snapshot(&upgrade_pool).await, first_objects);

    let fresh_dump =
        normalize_schema_dump(&schema_dump(&fresh).await, &[&fresh.name, &upgrade.name]);
    let upgrade_dump =
        normalize_schema_dump(&schema_dump(&upgrade).await, &[&fresh.name, &upgrade.name]);
    assert!(fresh_dump.contains("CREATE TABLE public.bookings"));
    assert!(upgrade_dump.contains("CREATE TABLE public.bookings"));
    assert_eq!(upgrade_dump, fresh_dump);

    fresh_pool.close().await;
    upgrade_pool.close().await;
    databases.cleanup().await;
}

#[tokio::test]
async fn postgres_v1_patch_failures_roll_back() {
    let Some(database_url) = database_url_or_skip() else {
        return;
    };
    let mut databases = DisposableDatabases::connect(&database_url).await;

    let checksum_conflict = databases.create("checksum").await;
    let checksum_pool = install_v1(&checksum_conflict).await;
    sqlx::raw_sql(DOCUMENTED_V1_DOWNGRADE)
        .execute(&checksum_pool)
        .await
        .expect("apply documented old V1 downgrade");
    sqlx::query(
        r#"
        INSERT INTO hotel_schema_revisions (generation, version, name, checksum)
        VALUES (1, 2, 'google-subject', 'sha256:0000000000000000000000000000000000000000000000000000000000000000')
        "#,
    )
    .execute(&checksum_pool)
    .await
    .expect("insert conflicting patch revision");
    let checksum_output = run_patches(&checksum_conflict, None).await;
    assert_runner_failed_with(&checksum_output, "patch 1.2 checksum mismatch");
    let google_subject_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'google_subject')",
    )
    .fetch_one(&checksum_pool)
    .await
    .expect("check google_subject after checksum conflict");
    assert!(!google_subject_exists);

    let empty = databases.create("empty").await;
    let empty_pool = PgPool::connect(&empty.url)
        .await
        .expect("connect to empty disposable database");
    let empty_output = run_patches(&empty, None).await;
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
    let revision_five_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM hotel_schema_revisions WHERE generation = 1 AND version = 5)",
    )
    .fetch_one(&rollback_pool)
    .await
    .expect("check injected patch metadata rollback");
    assert!(!sentinel_exists);
    assert!(!revision_five_exists);

    checksum_pool.close().await;
    empty_pool.close().await;
    rollback_pool.close().await;
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
    sqlx::raw_sql(DOCUMENTED_V1_DOWNGRADE)
        .execute(&pool)
        .await
        .expect("apply documented old V1 downgrade");

    let (temporary_catalog, google_subject_checksum) =
        TemporaryCatalog::with_sleeping_google_subject_patch();
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
    assert_expected_revisions(&revisions, &google_subject_checksum);
    let revision_counts: Vec<(i32, i64)> = sqlx::query_as(
        r#"
        SELECT version, COUNT(*)
        FROM hotel_schema_revisions
        WHERE generation = 1 AND version BETWEEN 2 AND 4
        GROUP BY version
        ORDER BY version
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("count concurrent patch revisions");
    assert_eq!(revision_counts, vec![(2, 1), (3, 1), (4, 1)]);

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
