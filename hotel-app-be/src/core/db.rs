use super::config::DatabaseConfig;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const SQLITE_V1_BASELINE: &str =
    include_str!("../../database/sqlite/migrations/0001_v1_baseline.sql");
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const SQLITE_REQUIRED_DATA: &str = include_str!("../../database/sqlite/data.sql");
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const SQLITE_FRESH_SEED: &str = include_str!("../../database/sqlite/seed.sql");
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const SQLITE_V1_CHECKSUM: &str = "67f448d748de3600298fd75447b48098b966a5aba9305a030be3075f337031f1";

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
fn sqlite_v1_checksum() -> String {
    use sha2::{Digest, Sha256};

    format!("{:x}", Sha256::digest(SQLITE_V1_BASELINE.as_bytes()))
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
async fn sqlite_has_user_tables(pool: &sqlx::SqlitePool) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('hotel_schema_revisions', 'hotel_schema_versions', '_sqlx_migrations'))",
    )
    .fetch_one(pool)
    .await
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
async fn sqlite_v1_invariants_hold(pool: &sqlx::SqlitePool) -> Result<bool, sqlx::Error> {
    let cancellable: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM pragma_table_info('promotions') WHERE name = 'is_cancellable')",
    )
    .fetch_one(pool)
    .await?;
    let online_inventory: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'online_inventory_allocations')",
    )
    .fetch_one(pool)
    .await?;
    Ok(cancellable && online_inventory)
}

/// Applies the immutable SQLite V1 baseline to a genuinely empty database.
///
/// SQLite has no pre-V1 production data to adopt. A non-empty, unversioned
/// database is rejected instead of guessing how it was created or replaying
/// obsolete development migrations over it.
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn apply_sqlite_resources(pool: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    if sqlite_v1_checksum() != SQLITE_V1_CHECKSUM {
        return Err(sqlx::Error::Protocol(
            "SQLite V1 baseline checksum does not match the immutable release artifact".to_string(),
        ));
    }
    let empty_database = !sqlite_has_user_tables(pool).await?;
    let revision_table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hotel_schema_revisions')",
    )
    .fetch_one(pool)
    .await?;
    let recorded_checksum: Option<String> = if revision_table_exists {
        sqlx::query_scalar(
            "SELECT checksum FROM hotel_schema_revisions WHERE generation = 1 AND version = 1",
        )
        .fetch_optional(pool)
        .await?
    } else {
        None
    };

    if let Some(recorded_checksum) = recorded_checksum {
        if recorded_checksum != SQLITE_V1_CHECKSUM {
            return Err(sqlx::Error::Protocol(format!(
                "SQLite V1 checksum mismatch: database records {recorded_checksum}, binary expects {SQLITE_V1_CHECKSUM}"
            )));
        }
    } else {
        if !empty_database {
            return Err(sqlx::Error::Protocol(
                "refusing to initialize a non-empty, unversioned SQLite database; recreate the development database from the V1 baseline"
                    .to_string(),
            ));
        }

        let mut transaction = pool.begin().await?;
        sqlx::query(
            r#"
            CREATE TABLE hotel_schema_revisions (
                generation INTEGER NOT NULL,
                version INTEGER NOT NULL,
                name TEXT NOT NULL,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (generation, version)
            )
            "#,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::raw_sql(SQLITE_V1_BASELINE)
            .execute(&mut *transaction)
            .await?;

        let cancellable: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM pragma_table_info('promotions') WHERE name = 'is_cancellable')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        let online_inventory: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'online_inventory_allocations')",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if !cancellable || !online_inventory {
            return Err(sqlx::Error::Protocol(
                "SQLite V1 baseline did not satisfy required schema invariants".to_string(),
            ));
        }

        sqlx::raw_sql(SQLITE_REQUIRED_DATA)
            .execute(&mut *transaction)
            .await?;
        sqlx::raw_sql(SQLITE_FRESH_SEED)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("INSERT INTO hotel_schema_revisions (generation, version, name, checksum) VALUES (1, 1, 'v1_baseline', ?1)")
            .bind(SQLITE_V1_CHECKSUM)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
    }

    if !sqlite_v1_invariants_hold(pool).await? {
        return Err(sqlx::Error::Protocol(
            "SQLite V1 schema invariants are not satisfied".to_string(),
        ));
    }

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
    use super::{SQLITE_V1_CHECKSUM, apply_sqlite_resources, sqlite_v1_checksum};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn memory_pool() -> sqlx::SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create SQLite test pool")
    }

    #[test]
    fn v1_baseline_checksum_is_immutable() {
        assert_eq!(sqlite_v1_checksum(), SQLITE_V1_CHECKSUM);
    }

    #[tokio::test]
    async fn resources_initialize_once_without_overwriting_customized_data() {
        let pool = memory_pool().await;

        apply_sqlite_resources(&pool)
            .await
            .expect("apply resources to fresh database");

        sqlx::query("UPDATE permissions SET description = 'custom ledger description' WHERE name = 'ledgers:read'")
            .execute(&pool)
            .await
            .expect("customize required record");
        sqlx::query("UPDATE users SET full_name = 'Custom administrator' WHERE username = 'admin'")
            .execute(&pool)
            .await
            .expect("customize bootstrap record");

        apply_sqlite_resources(&pool)
            .await
            .expect("verify existing V1 database");

        let applied_versions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM hotel_schema_revisions WHERE generation = 1")
                .fetch_one(&pool)
                .await
                .expect("count applied versions");
        assert_eq!(applied_versions, 1);

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

        let permission_description: String =
            sqlx::query_scalar("SELECT description FROM permissions WHERE name = 'ledgers:read'")
                .fetch_one(&pool)
                .await
                .expect("read customized required record");
        assert_eq!(permission_description, "custom ledger description");

        let admin_name: String =
            sqlx::query_scalar("SELECT full_name FROM users WHERE username = 'admin'")
                .fetch_one(&pool)
                .await
                .expect("read customized bootstrap record");
        assert_eq!(admin_name, "Custom administrator");
    }

    #[tokio::test]
    async fn non_empty_unversioned_database_is_rejected() {
        let pool = memory_pool().await;
        sqlx::query("CREATE TABLE unexpected_development_table (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .expect("create unversioned table");

        let error = apply_sqlite_resources(&pool)
            .await
            .expect_err("non-empty unversioned database must be rejected");
        assert!(error.to_string().contains("non-empty, unversioned SQLite"));
    }
}

/// Helper to generate UUIDs for application-generated primary keys.
///
/// Emits a time-ordered UUIDv7 to match the PostgreSQL `gen_uuidv7()` column
/// defaults in the PostgreSQL V1 baseline — v7's leading timestamp bits give much better
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
