use std::env;

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

/// Creates a database connection pool based on the enabled feature
pub async fn create_pool() -> Result<DbPool, sqlx::Error> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        let db_path = env::var("DATABASE_PATH")
            .unwrap_or_else(|_| "./hotel_data.db".to_string());

        // Create database file if it doesn't exist
        let db_url = format!("sqlite:{}?mode=rwc", db_path);
        log::info!("Connecting to SQLite database: {}", db_path);

        let pool = sqlx::SqlitePool::connect(&db_url).await?;

        // Run migrations for SQLite
        sqlx::migrate!("./database/sqlite_migrations")
            .run(&pool)
            .await?;

        Ok(pool)
    }

    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        let database_url = env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set in environment variables");

        log::info!("Connecting to PostgreSQL database");
        sqlx::Pool::<sqlx::Postgres>::connect(&database_url).await
    }
}

/// Helper to generate UUIDs (needed for SQLite since it doesn't have uuid_generate_v4())
pub fn generate_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
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
