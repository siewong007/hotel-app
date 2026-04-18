//! Shared test helpers

/// Create a fresh in-memory SQLite pool with all migrations applied.
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

    sqlx::migrate!("./database/sqlite_migrations")
        .run(&pool)
        .await
        .expect("Failed to run SQLite migrations on in-memory database");

    pool
}
