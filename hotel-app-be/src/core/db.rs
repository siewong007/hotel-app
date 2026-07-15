use super::config::DatabaseConfig;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const SQLITE_SCHEMA: &str = include_str!("../../database/sqlite_schema.sql");
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const SQLITE_DATA: &str = include_str!("../../database/sqlite_data.sql");

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
#[derive(Debug)]
struct SqliteSchemaSection<'a> {
    version: i64,
    name: &'a str,
    sql: String,
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
fn sqlite_schema_sections(schema: &str) -> Result<Vec<SqliteSchemaSection<'_>>, sqlx::Error> {
    const MARKER: &str = "-- @migration ";
    let mut sections = Vec::new();
    let mut current: Option<SqliteSchemaSection<'_>> = None;

    for line in schema.lines() {
        if let Some(metadata) = line.strip_prefix(MARKER) {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            let (version, name) = metadata.split_once(' ').ok_or_else(|| {
                sqlx::Error::Protocol(format!("invalid SQLite schema marker: {line}"))
            })?;
            let version = version.parse::<i64>().map_err(|_| {
                sqlx::Error::Protocol(format!("invalid SQLite schema version: {version}"))
            })?;
            if sections
                .last()
                .is_some_and(|section| section.version >= version)
            {
                return Err(sqlx::Error::Protocol(format!(
                    "SQLite schema versions must be strictly increasing: {version}"
                )));
            }
            current = Some(SqliteSchemaSection {
                version,
                name,
                sql: String::new(),
            });
        } else if let Some(section) = current.as_mut() {
            section.sql.push_str(line);
            section.sql.push('\n');
        }
    }

    if let Some(section) = current {
        sections.push(section);
    }
    if sections.is_empty() {
        return Err(sqlx::Error::Protocol(
            "sqlite_schema.sql contains no migration sections".to_string(),
        ));
    }
    Ok(sections)
}

/// Applies the two authoritative SQLite resources.
///
/// Successful versions from the former SQLx migration ledger are imported so
/// existing databases continue at the next pending section instead of replaying
/// historical table rewrites. Each new schema section is transactional. The
/// data resource is intentionally rerunnable and executes only after the schema
/// is current.
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn apply_sqlite_resources(pool: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS hotel_schema_versions (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    let legacy_ledger_exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = '_sqlx_migrations'
        )
        "#,
    )
    .fetch_one(pool)
    .await?;
    if legacy_ledger_exists {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO hotel_schema_versions (version, name, applied_at)
            SELECT version, description, COALESCE(installed_on, datetime('now'))
            FROM _sqlx_migrations
            WHERE success = 1
            "#,
        )
        .execute(pool)
        .await?;
    }

    for section in sqlite_schema_sections(SQLITE_SCHEMA)? {
        let is_applied: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM hotel_schema_versions WHERE version = ?1)",
        )
        .bind(section.version)
        .fetch_one(pool)
        .await?;
        if is_applied {
            continue;
        }

        let mut transaction = pool.begin().await?;
        sqlx::raw_sql(&section.sql)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("INSERT INTO hotel_schema_versions (version, name) VALUES (?1, ?2)")
            .bind(section.version)
            .bind(section.name)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
    }

    let mut transaction = pool.begin().await?;
    sqlx::raw_sql(SQLITE_DATA)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    Ok(())
}

// Type aliases for database pool based on feature flags
// Use mutual exclusion to ensure only one database type is active
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub type DbPool = sqlx::SqlitePool;

#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
pub type DbPool = sqlx::Pool<sqlx::Postgres>;

// Fallback: if both features are enabled, prefer PostgreSQL (for backwards compatibility)
#[cfg(all(feature = "sqlite", feature = "postgres"))]
pub type DbPool = sqlx::Pool<sqlx::Postgres>;

// Re-export the correct Row type
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub type DbRow = sqlx::sqlite::SqliteRow;

#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
pub type DbRow = sqlx::postgres::PgRow;

#[cfg(all(feature = "sqlite", feature = "postgres"))]
pub type DbRow = sqlx::postgres::PgRow;

// Re-export the active sqlx `Database` so query helpers can be generic over an
// executor (`&DbPool` or `&mut DbTransaction`) under either feature flag.
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub type DbDatabase = sqlx::Sqlite;

#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
pub type DbDatabase = sqlx::Postgres;

#[cfg(all(feature = "sqlite", feature = "postgres"))]
pub type DbDatabase = sqlx::Postgres;

/// A database transaction over the active backend. Lets callers run several
/// writes atomically and pass `&mut *tx` to executor-generic query helpers.
pub type DbTransaction<'c> = sqlx::Transaction<'c, DbDatabase>;

/// Creates a database connection pool based on the enabled feature
pub async fn create_pool(config: &DatabaseConfig) -> Result<DbPool, sqlx::Error> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        use sqlx::ConnectOptions;
        use sqlx::sqlite::{
            SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
        };
        use std::str::FromStr;
        use std::time::Duration;

        // Create database file if it doesn't exist (mode=rwc).
        let db_url = format!("sqlite:{}?mode=rwc", config.sqlite_path);
        log::info!("Connecting to SQLite database: {}", config.sqlite_path);

        // Explicit pragmas rather than relying on sqlx URL defaults: WAL journaling
        // with NORMAL synchronous (safe under WAL, far fewer fsyncs than the default
        // FULL), a generous page cache and mmap window, and in-memory temp tables.
        // This is the single biggest lever for the embedded desktop write path.
        let connect_opts = SqliteConnectOptions::from_str(&db_url)?
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(config.busy_timeout_secs))
            .foreign_keys(true)
            .pragma("cache_size", "-65536") // 64 MiB page cache (negative value = KiB)
            .pragma("mmap_size", "268435456") // 256 MiB memory-mapped I/O
            .pragma("temp_store", "MEMORY")
            .log_slow_statements(
                log::LevelFilter::Warn,
                Duration::from_millis(config.slow_statement_ms),
            );

        let pool = SqlitePoolOptions::new()
            .max_connections(config.max_connections)
            .min_connections(config.min_connections)
            .acquire_timeout(Duration::from_secs(config.acquire_timeout_secs))
            .connect_with(connect_opts)
            .await?;

        apply_sqlite_resources(&pool).await?;

        Ok(pool)
    }

    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        use sqlx::ConnectOptions;
        use sqlx::Executor;
        use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
        use std::str::FromStr;
        use std::time::Duration;

        let database_url = config
            .url
            .as_deref()
            .expect("DATABASE_URL must be validated at startup");

        log::info!("Connecting to PostgreSQL database");

        // Log any statement slower than the threshold at WARN so slow queries are
        // visible even without inspecting pg_stat_statements.
        let connect_opts = PgConnectOptions::from_str(database_url)?.log_slow_statements(
            log::LevelFilter::Warn,
            Duration::from_millis(config.slow_statement_ms),
        );

        // Pool tuning (all env-overridable). min_connections defaults to 0 so the
        // pool is created lazily and startup never blocks on opening connections;
        // sqlx eagerly establishes (and awaits) any non-zero floor inside
        // connect_with, so a warm floor must stay opt-in. test_before_acquire(false)
        // drops a ping round-trip per checkout; max_lifetime bounds how long a
        // pooled connection can hold a stale `SET timezone` after a runtime change.
        //
        // Set session timezone on every connection so ::date extractions are timezone-correct.
        // sqlx defaults sessions to UTC, which breaks (ts AT TIME ZONE $tz)::date comparisons.
        // Read the hotel timezone from system_settings on each new connection.
        PgPoolOptions::new()
            .max_connections(config.max_connections)
            .min_connections(config.min_connections)
            .acquire_timeout(Duration::from_secs(config.acquire_timeout_secs))
            .idle_timeout(Duration::from_secs(config.idle_timeout_secs))
            .max_lifetime(Duration::from_secs(config.max_lifetime_secs))
            .test_before_acquire(false)
            .after_connect(|conn, _meta| {
                Box::pin(async move {
                    let tz: Option<String> = sqlx::query_scalar(
                        "SELECT value FROM system_settings WHERE key = 'timezone'",
                    )
                    .fetch_optional(&mut *conn)
                    .await?;
                    let tz = tz.unwrap_or_else(|| "UTC".to_string());
                    // Validate timezone is a safe identifier (alphanumeric, underscores, slashes, +/-)
                    // to prevent SQL injection via the system_settings table
                    if !tz.chars().all(|c| {
                        c.is_alphanumeric() || c == '/' || c == '_' || c == '+' || c == '-'
                    }) {
                        log::warn!("Invalid timezone value in system_settings: {}", tz);
                        conn.execute("SET timezone = 'UTC'").await?;
                    } else {
                        // Use sqlx::query to parameterize - PostgreSQL SET doesn't support $1 params,
                        // so we validate the input above and use format! safely
                        conn.execute(format!("SET timezone = '{}'", tz).as_str())
                            .await?;
                    }
                    Ok(())
                })
            })
            .connect_with(connect_opts)
            .await
    }
}

#[cfg(all(test, feature = "sqlite", not(feature = "postgres")))]
mod sqlite_resource_tests {
    use super::{SQLITE_SCHEMA, apply_sqlite_resources, sqlite_schema_sections};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn memory_pool() -> sqlx::SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create SQLite test pool")
    }

    #[test]
    fn schema_resource_has_strictly_ordered_legacy_versions() {
        let sections = sqlite_schema_sections(SQLITE_SCHEMA).expect("parse SQLite schema sections");
        let versions: Vec<i64> = sections.iter().map(|section| section.version).collect();
        assert_eq!(versions, (1..=28).collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn resources_create_and_reseed_a_fresh_database_idempotently() {
        let pool = memory_pool().await;

        apply_sqlite_resources(&pool)
            .await
            .expect("apply resources to fresh database");
        apply_sqlite_resources(&pool)
            .await
            .expect("reapply resources");

        let applied_versions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM hotel_schema_versions")
                .fetch_one(&pool)
                .await
                .expect("count applied versions");
        assert_eq!(applied_versions, 28);

        let daily_rates_type: Option<String> = sqlx::query_scalar(
            "SELECT type FROM pragma_table_info('bookings') WHERE name = 'daily_rates'",
        )
        .fetch_optional(&pool)
        .await
        .expect("inspect bookings.daily_rates");
        assert_eq!(daily_rates_type.as_deref(), Some("TEXT"));

        let seeded_rewards: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM loyalty_rewards WHERE name IN ('Late checkout', 'Room upgrade request', 'Dining credit')",
        )
        .fetch_one(&pool)
        .await
        .expect("count seeded rewards");
        assert_eq!(seeded_rewards, 3);
    }

    #[tokio::test]
    async fn successful_legacy_sqlx_versions_are_imported_without_schema_replay() {
        let pool = memory_pool().await;
        sqlx::raw_sql(SQLITE_SCHEMA)
            .execute(&pool)
            .await
            .expect("create schema representing an existing database");
        sqlx::raw_sql(
            r#"
            CREATE TABLE _sqlx_migrations (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TEXT,
                success INTEGER NOT NULL
            );
            WITH RECURSIVE versions(version) AS (
                VALUES (1)
                UNION ALL
                SELECT version + 1 FROM versions WHERE version < 28
            )
            INSERT INTO _sqlx_migrations (version, description, installed_on, success)
            SELECT version, 'legacy migration', datetime('now'), 1 FROM versions;
            "#,
        )
        .execute(&pool)
        .await
        .expect("seed legacy SQLx migration ledger");

        apply_sqlite_resources(&pool)
            .await
            .expect("adopt existing migrated database");

        let imported_versions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM hotel_schema_versions")
                .fetch_one(&pool)
                .await
                .expect("count imported versions");
        assert_eq!(imported_versions, 28);
    }
}

/// Helper to generate UUIDs for application-generated primary keys.
///
/// Emits a time-ordered UUIDv7 to match the PostgreSQL `gen_uuidv7()` column
/// defaults (migration 018) — v7's leading timestamp bits give much better
/// btree insert locality than the random v4 we used before, and SQLite (where
/// the application generates the value) gets the same benefit. Use this for PK/UUID
/// columns; for values that must stay unpredictable (tokens, the random tail
/// of a booking number) keep an explicit `Uuid::new_v4()`.
pub fn generate_uuid() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// Helper to get current timestamp as ISO 8601 string
pub fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Helper to convert arrays to JSON strings for SQLite storage
pub fn array_to_json<T: serde::Serialize>(arr: &[T]) -> String {
    serde_json::to_string(arr).unwrap_or_else(|_| "[]".to_string())
}

/// Helper to parse JSON strings back to arrays
pub fn json_to_array<T: serde::de::DeserializeOwned>(json: &str) -> Vec<T> {
    serde_json::from_str(json).unwrap_or_default()
}

/// Helper to convert Decimal to a bindable type for SQLite
/// SQLite doesn't support Decimal natively, so we store as TEXT
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub fn decimal_to_db(d: rust_decimal::Decimal) -> String {
    d.to_string()
}

#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub fn decimal_to_db(d: rust_decimal::Decimal) -> rust_decimal::Decimal {
    d
}

/// Helper to convert Option<Decimal> to bindable type
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub fn opt_decimal_to_db(d: Option<rust_decimal::Decimal>) -> Option<String> {
    d.map(|v| v.to_string())
}

#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub fn opt_decimal_to_db(d: Option<rust_decimal::Decimal>) -> Option<rust_decimal::Decimal> {
    d
}

use sqlx::Row;

pub trait DbRowExt {
    fn get_decimal(&self, index: usize) -> rust_decimal::Decimal;
    fn get_opt_decimal(&self, index: usize) -> Option<rust_decimal::Decimal>;
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
impl DbRowExt for DbRow {
    fn get_decimal(&self, index: usize) -> rust_decimal::Decimal {
        parse_decimal(&self.get::<String, _>(index))
    }
    fn get_opt_decimal(&self, index: usize) -> Option<rust_decimal::Decimal> {
        self.get::<Option<String>, _>(index)
            .map(|s| parse_decimal(&s))
    }
}

#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
impl DbRowExt for DbRow {
    fn get_decimal(&self, index: usize) -> rust_decimal::Decimal {
        self.get::<rust_decimal::Decimal, _>(index)
    }
    fn get_opt_decimal(&self, index: usize) -> Option<rust_decimal::Decimal> {
        self.get::<Option<rust_decimal::Decimal>, _>(index)
    }
}

/// Helper to parse a string to Decimal (used when reading from SQLite)
pub fn parse_decimal(s: &str) -> rust_decimal::Decimal {
    s.parse().unwrap_or_default()
}

/// Helper to parse Option<String> to Option<Decimal>
pub fn parse_opt_decimal(s: Option<String>) -> Option<rust_decimal::Decimal> {
    s.and_then(|v| v.parse().ok())
}

/// Helper to parse f64 to Decimal (for SQLite which may return REAL)
pub fn f64_to_decimal(f: f64) -> rust_decimal::Decimal {
    rust_decimal::Decimal::from_f64_retain(f).unwrap_or_default()
}

/// Helper to parse Option<f64> to Option<Decimal>
pub fn opt_f64_to_decimal(f: Option<f64>) -> Option<rust_decimal::Decimal> {
    f.and_then(rust_decimal::Decimal::from_f64_retain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct TestCode {
        code: String,
    }

    #[test]
    fn array_json_helpers_round_trip_serializable_values() {
        let values = vec![
            TestCode {
                code: "ABCD-1234".to_string(),
            },
            TestCode {
                code: "WXYZ-9876".to_string(),
            },
        ];

        let json = array_to_json(&values);
        let decoded: Vec<TestCode> = json_to_array(&json);

        assert_eq!(decoded, values);
    }

    #[test]
    fn json_to_array_returns_empty_vec_for_invalid_json() {
        let decoded: Vec<String> = json_to_array("not json");

        assert!(decoded.is_empty());
    }

    #[test]
    fn decimal_parsers_fall_back_safely_for_invalid_values() {
        assert_eq!(parse_decimal("12.34"), Decimal::new(1234, 2));
        assert_eq!(parse_decimal("not-a-decimal"), Decimal::ZERO);
        assert_eq!(
            parse_opt_decimal(Some("9.99".to_string())),
            Some(Decimal::new(999, 2))
        );
        assert_eq!(parse_opt_decimal(Some("invalid".to_string())), None);
        assert_eq!(parse_opt_decimal(None), None);
    }

    #[test]
    fn float_decimal_helpers_preserve_valid_values_and_ignore_none() {
        assert_eq!(f64_to_decimal(12.5), Decimal::new(125, 1));
        assert_eq!(opt_f64_to_decimal(Some(1.25)), Some(Decimal::new(125, 2)));
        assert_eq!(opt_f64_to_decimal(None), None);
    }

    #[test]
    fn generate_uuid_returns_parseable_uuid_string() {
        let uuid = generate_uuid();

        assert!(uuid::Uuid::parse_str(&uuid).is_ok());
    }
}
