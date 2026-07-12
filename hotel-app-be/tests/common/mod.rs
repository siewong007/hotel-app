//! Shared test helpers

/// Create a fresh in-memory SQLite pool with both authoritative resources applied.
///
/// Only available under the `sqlite` feature. Tests that call this must be
/// gated with `#[cfg(all(feature = "sqlite", not(feature = "postgres")))]`.
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn setup_test_db() -> sqlx::SqlitePool {
    use sqlx::sqlite::SqlitePoolOptions;

    let pool = SqlitePoolOptions::new()
        // Single connection keeps all queries on the same in-memory database.
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("Failed to create in-memory SQLite pool");

    hotel_app_be::core::db::apply_sqlite_resources(&pool)
        .await
        .expect("Failed to apply SQLite resources to in-memory database");

    pool
}
