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

/// The streamed export body must carry the same `FullDataExport` payload the
/// old buffered endpoint returned — the frontend and import path both parse
/// that shape. Guards the cursor/FETCH framing (envelope, per-table arrays,
/// row batches) against drift. Runs only with `DATABASE_URL` set.
#[tokio::test]
async fn streamed_export_matches_materialized_export() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let body = hotel_app_be::services::data_transfer::export_booking_data_body(&pool, 0)
        .await
        .expect("streamed export must build");
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .expect("streamed export body must collect");
    let streamed: serde_json::Value =
        serde_json::from_slice(&bytes).expect("streamed export must be valid JSON");

    assert_eq!(streamed["version"], "2.0");
    let tables = streamed["tables"]
        .as_object()
        .expect("streamed export must carry a tables object");
    assert!(
        tables.contains_key("public.bookings"),
        "streamed export lost public.bookings"
    );

    // Every table present in the streamed file must round-trip through the
    // materialized path with identical row content.
    let materialized = hotel_app_be::services::data_transfer::export_booking_data(&pool)
        .await
        .expect("materialized export must succeed");
    let expected = serde_json::to_value(&materialized).expect("export must serialize");
    let expected_tables = expected["tables"].as_object().unwrap();
    assert_eq!(tables.len(), expected_tables.len());
    for (name, rows) in tables {
        assert_eq!(
            rows, &expected_tables[name],
            "streamed export diverged on table {name}"
        );
    }
}
