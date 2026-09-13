//! Regression tests for the schema-driven full-database export.
//!
//! `transfer_tables` introspects `pg_class`/`pg_constraint` and is the first
//! thing both `GET /api/data-transfer/export` and its preview call, so a
//! malformed catalog query fails the whole export with a 500 while every
//! compile-time gate stays green. Runs only with `DATABASE_URL` set.

use hotel_app_be::repositories::data_transfer::DataTransferRepository;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!(
                "Skipping PostgreSQL data-transfer export test because DATABASE_URL is not set"
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

/// The catalog introspection behind every export must actually execute.
/// `FROM pg_constraint constraint` compiled fine and failed at runtime with
/// `syntax error at or near "constraint"` -- `constraint` is a reserved word.
#[tokio::test]
async fn transfer_tables_introspects_the_live_catalog() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let tables = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");

    let bookings = tables
        .iter()
        .find(|table| table.table.key() == "public.bookings")
        .expect("public.bookings must be transferable");

    assert!(
        bookings.columns.contains("id"),
        "column introspection returned nothing for bookings"
    );
    assert_eq!(bookings.primary_key_columns, vec!["id".to_string()]);
    // Proves the foreign-key query ran: bookings has FKs to rooms and guests.
    assert!(
        bookings.dependencies.contains("public.rooms"),
        "foreign-key introspection lost bookings -> rooms; got {:?}",
        bookings.dependencies
    );

    // The row read itself must survive `row_to_json` over every column type.
    let rows = DataTransferRepository::export_transfer_table(&pool, bookings)
        .await
        .expect("exporting bookings must succeed");
    let count = DataTransferRepository::count_transfer_table(&pool, bookings)
        .await
        .expect("counting bookings must succeed");
    assert_eq!(rows.len() as i64, count);
}
