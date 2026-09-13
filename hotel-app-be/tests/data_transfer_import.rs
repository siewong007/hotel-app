//! Regression tests for the schema-driven full-database import.
//!
//! `users` and `guests` reference each other in the V1 baseline
//! (`fk_users_guest` against `guests_created_by_fkey`), so the selected table
//! graph is cyclic on every database this product has ever shipped. Ordering
//! used to reject that outright, which made `POST /api/data-transfer/import`
//! return 400 for every full export -- including restores driven from the Data
//! Transfer admin page.
//!
//! These tests run inside a transaction that is always rolled back, so they are
//! safe against the shared test database and against other test binaries
//! running concurrently. Runs only with `DATABASE_URL` set.

use hotel_app_be::repositories::data_transfer::{DataTransferRepository, transfer_order};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::collections::{HashMap, HashSet};

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!(
                "Skipping PostgreSQL data-transfer import test because DATABASE_URL is not set"
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

/// The live catalog is cyclic, so this is the exact call that used to fail the
/// whole import with 400 "Selected transfer tables contain a circular
/// foreign-key dependency".
#[tokio::test]
async fn every_transferable_table_can_be_ordered_despite_the_users_guests_cycle() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let descriptors = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");

    let names: Vec<String> = descriptors
        .iter()
        .map(|descriptor| descriptor.table.key())
        .collect();
    let dependencies: HashMap<String, HashSet<String>> = descriptors
        .iter()
        .map(|descriptor| (descriptor.table.key(), descriptor.dependencies.clone()))
        .collect();

    // Prove the fixture is actually cyclic, or this test would pass on a
    // schema that never exercised the bug.
    assert!(
        dependencies["public.users"].contains("public.guests")
            && dependencies["public.guests"].contains("public.users"),
        "expected the users <-> guests cycle; got users={:?} guests={:?}",
        dependencies["public.users"],
        dependencies["public.guests"]
    );

    let order = transfer_order(&names, &dependencies).expect("a cyclic catalog must still order");

    let mut sorted_order = order.clone();
    sorted_order.sort();
    let mut sorted_names = names.clone();
    sorted_names.sort();
    assert_eq!(
        sorted_order, sorted_names,
        "ordering must emit every selected table exactly once"
    );

    // Edges outside the cycle must still be honoured, otherwise the import
    // would insert children before their parents for no reason.
    let position = |table: &str| order.iter().position(|name| name == table);
    let (bookings, rooms) = (position("public.bookings"), position("public.rooms"));
    if let (Some(bookings), Some(rooms)) = (bookings, rooms) {
        assert!(
            rooms < bookings,
            "rooms must still be inserted before bookings; got {order:?}"
        );
    }
}

/// Deferring is what actually makes a cyclic restore possible: with the
/// constraints immediate, no insert order satisfies both directions at once.
/// The rows here populate both sides of the cycle, which is the case ordering
/// alone can never solve.
#[tokio::test]
async fn relaxed_foreign_keys_allow_cyclic_rows_and_are_restored_afterwards() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let descriptors = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");
    let cycle: Vec<_> = descriptors
        .iter()
        .filter(|descriptor| {
            matches!(
                descriptor.table.key().as_str(),
                "public.users" | "public.guests"
            )
        })
        .cloned()
        .collect();
    assert_eq!(cycle.len(), 2, "expected both cycle tables in the catalog");

    let mut tx = pool.begin().await.expect("begin");

    let relaxed = DataTransferRepository::relax_foreign_keys(&mut tx, &cycle)
        .await
        .expect("relaxing the cycle's foreign keys must succeed");
    assert!(
        !relaxed.is_empty(),
        "fk_users_guest is immediate in the baseline, so something must have been relaxed"
    );

    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *tx)
        .await
        .expect("deferring constraints must succeed");

    // Insert the child before the parent in BOTH directions. Either statement
    // alone violates an immediate foreign key; both together are only legal
    // because the checks are deferred to the end of the transaction.
    let guest_id: i64 = 920_931_001;
    let user_id: i64 = 920_931_002;

    sqlx::query(
        "INSERT INTO guests (id, nick_name, created_by, updated_by) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $3)",
    )
    .bind(guest_id)
    .bind(format!("transfer-cycle-{guest_id}"))
    .bind(user_id) // references a user that does not exist yet
    .execute(&mut *tx)
    .await
    .expect("deferred foreign keys must permit a forward reference to users");

    sqlx::query(
        "INSERT INTO users (id, username, email, password_hash, guest_id) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(user_id)
    .bind(format!("transfer-cycle-{user_id}"))
    .bind(format!("transfer-cycle-{user_id}@no-email.invalid"))
    .bind("not-a-real-hash")
    .bind(guest_id)
    .execute(&mut *tx)
    .await
    .expect("the closing half of the cycle must insert too");

    // Nothing is skipped: forcing the checks proves the rows are consistent.
    sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut *tx)
        .await
        .expect("the deferred foreign keys must validate once both rows exist");

    DataTransferRepository::restore_foreign_keys(&mut tx, &relaxed)
        .await
        .expect("restoring the foreign keys must succeed");

    // An import must leave the schema exactly as it found it, or the next
    // pg_dump convergence check reports permanent drift.
    let still_deferrable: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_constraint \
         WHERE contype = 'f' AND condeferrable AND conname = 'fk_users_guest'",
    )
    .fetch_one(&mut *tx)
    .await
    .expect("reading constraint state must succeed");
    assert_eq!(
        still_deferrable, 0,
        "fk_users_guest must be immediate again once the import finishes"
    );

    tx.rollback().await.expect("rollback");
}

/// Credential, role and session tables must never enter through the import:
/// the catalog validation used to accept any `public` table, so a
/// `settings:manage` holder could have imported a forged `is_super_admin`
/// user. The service must reject any file or selection naming a
/// non-transferable table before a single row is written.
#[tokio::test]
async fn full_import_rejects_non_transferable_tables() {
    use hotel_app_be::constants::ImportMode;
    use hotel_app_be::models::{FullDataExport, ImportRequest, TransferPayload};
    use hotel_app_be::services::data_transfer::import_booking_data;
    use std::collections::BTreeMap;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let export = FullDataExport {
        version: "2.0".to_string(),
        exported_at: "2026-09-12T00:00:00Z".to_string(),
        tables: BTreeMap::from([
            ("public.amenities".to_string(), vec![]),
            (
                "public.users".to_string(),
                vec![serde_json::json!({
                    "id": 999_999_991_i64,
                    "username": "forged-admin",
                    "email": "forged@example.invalid",
                    "password_hash": "x",
                    "is_super_admin": true
                })],
            ),
        ]),
    };

    let rejected = import_booking_data(
        &pool,
        1,
        ImportRequest {
            mode: ImportMode::Import,
            data: TransferPayload::V2(export),
            tables: vec![],
        },
    )
    .await;
    assert!(
        matches!(&rejected, Err(hotel_app_be::core::error::ApiError::BadRequest(message)) if message.contains("not permitted")),
        "a file containing public.users must be rejected outright: {rejected:?}"
    );

    // The same applies when the table is only named in the `tables` selection.
    let export = FullDataExport {
        version: "2.0".to_string(),
        exported_at: "2026-09-12T00:00:00Z".to_string(),
        tables: BTreeMap::from([
            ("public.amenities".to_string(), vec![]),
            ("public.users".to_string(), vec![]),
        ]),
    };
    let rejected = import_booking_data(
        &pool,
        1,
        ImportRequest {
            mode: ImportMode::Import,
            data: TransferPayload::V2(export),
            tables: vec!["public.users".to_string()],
        },
    )
    .await;
    assert!(
        matches!(&rejected, Err(hotel_app_be::core::error::ApiError::BadRequest(message)) if message.contains("not permitted")),
        "a selection naming public.users must be rejected outright: {rejected:?}"
    );
}

/// A violation must still fail the import rather than commit. Deferring moves
/// the check; it must not lose it.
#[tokio::test]
async fn deferred_foreign_keys_still_reject_a_dangling_reference() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };

    let descriptors = DataTransferRepository::transfer_tables(&pool)
        .await
        .expect("transfer_tables must run against the live catalog");
    let guests: Vec<_> = descriptors
        .iter()
        .filter(|descriptor| descriptor.table.key() == "public.guests")
        .cloned()
        .collect();
    assert_eq!(guests.len(), 1, "expected public.guests in the catalog");

    let mut tx = pool.begin().await.expect("begin");
    DataTransferRepository::relax_foreign_keys(&mut tx, &guests)
        .await
        .expect("relax");
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *tx)
        .await
        .expect("defer");

    sqlx::query(
        "INSERT INTO guests (id, nick_name, created_by) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)",
    )
    .bind(920_931_003_i64)
    .bind("transfer-cycle-dangling")
    .bind(920_931_999_i64) // no such user, and none will be inserted
    .execute(&mut *tx)
    .await
    .expect("the insert itself is deferred, so it succeeds here");

    let forced = sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut *tx)
        .await;
    assert!(
        forced.is_err(),
        "a dangling created_by must still be caught when the checks are forced"
    );

    tx.rollback().await.expect("rollback");
}
