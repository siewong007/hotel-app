//! The append-only guard on `audit_logs` must hold for its partitions too.
//!
//! `audit_logs` is RANGE-partitioned by month, and PostgreSQL fires a
//! statement-level trigger only for the table a statement names, so the
//! original guard (one statement trigger on the parent) let an UPDATE, DELETE
//! or TRUNCATE that named `audit_logs_<month>` or `audit_logs_default` through.
//! The schema now guards three ways: the statement trigger on the parent, a
//! row trigger PostgreSQL clones onto every partition, and a per-partition
//! TRUNCATE trigger that `ensure_audit_logs_truncate_guards()` adds (patch
//! 0017).
//!
//! Every probe runs inside a transaction that is rolled back, so a missing
//! guard cannot destroy audit history in the shared database even when an
//! assertion fails. Requires `DATABASE_URL` (PostgreSQL); the tests skip
//! without it.

use std::collections::HashSet;

use hotel_app_be::modules::data_transfer::repository::{
    DataTransferRepository, QualifiedTable, TransferTable,
};
use hotel_app_be::repositories::audit::AuditRepository;
use sqlx::{PgPool, Postgres, Transaction, postgres::PgPoolOptions};

const GUARD_MESSAGE: &str = "audit_logs is append-only";

/// One marker row in a month no other suite writes to, and one in a month no
/// partition covers, which lands in the DEFAULT partition.
const SEED_PROBE_ROWS: &str = r#"
    INSERT INTO public.audit_logs (action, resource_type, details, created_at)
    VALUES ('append_only_partition_probe', 'audit_guard_test', '{"probe":"month"}', '2097-03-15T12:00:00Z'),
           ('append_only_partition_probe', 'audit_guard_test', '{"probe":"default"}', '1999-01-15T12:00:00Z')
"#;

const PROBE_ROWS: &str = r#"
    SELECT tableoid::regclass::text, details::text
    FROM public.audit_logs
    WHERE action = 'append_only_partition_probe'
    ORDER BY 1
"#;

/// Statements that must fail while `app.allow_audit_mutation` is off: each
/// verb against the month partition, the DEFAULT partition and the parent.
const REJECTED_STATEMENTS: &[&str] = &[
    "DELETE FROM public.audit_logs_2097_03 WHERE action = 'append_only_partition_probe'",
    r#"UPDATE public.audit_logs_2097_03 SET details = '{"tampered":true}' WHERE action = 'append_only_partition_probe'"#,
    "TRUNCATE public.audit_logs_2097_03",
    "DELETE FROM public.audit_logs_default WHERE action = 'append_only_partition_probe'",
    r#"UPDATE public.audit_logs_default SET details = '{"tampered":true}' WHERE action = 'append_only_partition_probe'"#,
    "TRUNCATE public.audit_logs_default",
    "DELETE FROM public.audit_logs WHERE action = 'append_only_partition_probe'",
    r#"UPDATE public.audit_logs SET details = '{"tampered":true}' WHERE action = 'append_only_partition_probe'"#,
    "TRUNCATE public.audit_logs",
];

// Partition DDL and TRUNCATE take strong locks on audit_logs, so the tests in
// this file run one at a time, same pattern as tests/invoice_numbering.rs.
fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        eprintln!("Skipping PostgreSQL audit append-only test because DATABASE_URL is not set");
        return None;
    };
    let guard = pg_serial_lock().lock_owned().await;
    // Deliberately no `SET app.allow_audit_mutation = 'on'` hook, unlike the
    // other suites: these tests need the guard closed unless one opens it.
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some((pool, guard))
}

/// Sets the escape hatch for this transaction only, whatever the server or
/// role default is.
async fn set_escape_hatch(tx: &mut Transaction<'_, Postgres>, open: bool) {
    let statement = if open {
        "SET LOCAL app.allow_audit_mutation = 'on'"
    } else {
        "SET LOCAL app.allow_audit_mutation = 'off'"
    };
    sqlx::query(statement)
        .execute(&mut **tx)
        .await
        .expect("set the audit escape hatch");
}

/// Creates the probe month the way partition upkeep does, guard included,
/// then writes the two marker rows.
async fn seed_probe_rows(tx: &mut Transaction<'_, Postgres>) {
    sqlx::query("SELECT public.ensure_audit_logs_partition(DATE '2097-03-01')")
        .execute(&mut **tx)
        .await
        .expect("create the probe month partition");
    sqlx::query("SELECT public.ensure_audit_logs_truncate_guards()")
        .execute(&mut **tx)
        .await
        .expect("guard the probe month partition");
    sqlx::query(SEED_PROBE_ROWS)
        .execute(&mut **tx)
        .await
        .expect("insert the probe audit rows");
}

async fn probe_rows(tx: &mut Transaction<'_, Postgres>) -> Vec<(String, String)> {
    sqlx::query_as(PROBE_ROWS)
        .fetch_all(&mut **tx)
        .await
        .expect("read the probe audit rows")
}

fn seeded_rows() -> Vec<(String, String)> {
    vec![
        (
            "audit_logs_2097_03".to_owned(),
            r#"{"probe": "month"}"#.to_owned(),
        ),
        (
            "audit_logs_default".to_owned(),
            r#"{"probe": "default"}"#.to_owned(),
        ),
    ]
}

#[tokio::test]
async fn partition_direct_update_delete_and_truncate_are_rejected() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };
    let mut tx = pool.begin().await.expect("begin the probe transaction");
    set_escape_hatch(&mut tx, false).await;
    seed_probe_rows(&mut tx).await;
    let before = probe_rows(&mut tx).await;

    let mut accepted = Vec::new();
    let mut wrong_errors = Vec::new();
    for statement in REJECTED_STATEMENTS {
        sqlx::query("SAVEPOINT probe")
            .execute(&mut *tx)
            .await
            .expect("set the probe savepoint");
        match sqlx::query(*statement).execute(&mut *tx).await {
            Ok(result) => accepted.push(format!("{statement} ({} rows)", result.rows_affected())),
            Err(error) if error.to_string().contains(GUARD_MESSAGE) => {}
            Err(error) => wrong_errors.push(format!("{statement}: {error}")),
        }
        sqlx::query("ROLLBACK TO SAVEPOINT probe")
            .execute(&mut *tx)
            .await
            .expect("roll back to the probe savepoint");
    }
    let after = probe_rows(&mut tx).await;
    tx.rollback()
        .await
        .expect("roll back the probe transaction");

    assert_eq!(
        before,
        seeded_rows(),
        "the probe rows must land in both partitions"
    );
    assert!(
        accepted.is_empty(),
        "the append-only guard let these statements through: {accepted:#?}"
    );
    assert!(
        wrong_errors.is_empty(),
        "these statements failed for a reason other than the guard: {wrong_errors:#?}"
    );
    assert_eq!(after, seeded_rows(), "no audit row may change");
}

#[tokio::test]
async fn escape_hatch_still_lets_fixture_cleanup_change_partition_rows() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };
    let mut tx = pool.begin().await.expect("begin the probe transaction");
    set_escape_hatch(&mut tx, true).await;
    seed_probe_rows(&mut tx).await;

    // A BEFORE ROW trigger that returns NULL skips its row without an error,
    // so these counts are what prove the escape hatch still works.
    let updated = sqlx::query(
        r#"UPDATE public.audit_logs_2097_03 SET details = '{"probe":"updated"}' WHERE action = 'append_only_partition_probe'"#,
    )
    .execute(&mut *tx)
    .await
    .expect("update a month-partition row with the escape hatch open")
    .rows_affected();
    let deleted = sqlx::query(
        "DELETE FROM public.audit_logs WHERE action = 'append_only_partition_probe' AND created_at < '2000-01-01'",
    )
    .execute(&mut *tx)
    .await
    .expect("delete a DEFAULT-partition row through the parent with the escape hatch open")
    .rows_affected();
    let remaining = probe_rows(&mut tx).await;
    sqlx::query("TRUNCATE public.audit_logs_2097_03")
        .execute(&mut *tx)
        .await
        .expect("truncate a partition with the escape hatch open");
    let after_truncate: i64 = sqlx::query_scalar("SELECT count(*) FROM public.audit_logs_2097_03")
        .fetch_one(&mut *tx)
        .await
        .expect("count the truncated partition");
    tx.rollback()
        .await
        .expect("roll back the probe transaction");

    assert_eq!(
        updated, 1,
        "the escape hatch must let a partition row be updated"
    );
    assert_eq!(
        deleted, 1,
        "the escape hatch must let a partition row be deleted"
    );
    assert_eq!(
        remaining,
        vec![(
            "audit_logs_2097_03".to_owned(),
            r#"{"probe": "updated"}"#.to_owned()
        )]
    );
    assert_eq!(
        after_truncate, 0,
        "the escape hatch must let a partition be truncated"
    );
}

#[tokio::test]
async fn every_audit_partition_carries_the_row_and_truncate_guards() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };
    // The daily upkeep: this month and the next two, then the TRUNCATE guards.
    AuditRepository::ensure_upcoming_partitions(&pool)
        .await
        .expect("run the audit partition upkeep");

    // pg_get_triggerdef qualifies names only when the search_path hides them.
    let parent_triggers: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT tgname::text, replace(pg_get_triggerdef(oid), 'public.', '')
        FROM pg_trigger
        WHERE tgrelid = 'public.audit_logs'::regclass AND NOT tgisinternal
        ORDER BY 1
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("read the audit_logs triggers");
    let partitions: Vec<(String, bool, bool)> = sqlx::query_as(
        r#"
        SELECT partition_table.relname::text,
               EXISTS (
                   SELECT 1
                   FROM pg_trigger AS clone
                   JOIN pg_trigger AS origin ON origin.oid = clone.tgparentid
                   WHERE clone.tgrelid = partition_table.oid
                     AND clone.tgenabled = 'O'
                     AND origin.tgrelid = 'public.audit_logs'::regclass
                     AND origin.tgname = 'trg_audit_logs_append_only_row'
               ),
               EXISTS (
                   SELECT 1
                   FROM pg_trigger AS guard
                   WHERE guard.tgrelid = partition_table.oid
                     AND guard.tgname = 'trg_audit_logs_no_truncate'
                     AND guard.tgenabled = 'O'
                     -- BEFORE | TRUNCATE, statement level
                     AND guard.tgtype = 34
                     AND guard.tgfoid = 'public.prevent_audit_log_mutation()'::regprocedure
               )
        FROM pg_inherits AS link
        JOIN pg_class AS partition_table ON partition_table.oid = link.inhrelid
        WHERE link.inhparent = 'public.audit_logs'::regclass
        ORDER BY 1
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("read the audit partition guards");

    // A partition made by ensure_audit_logs_partition alone gets the cloned
    // row guard at once; the helper then adds its TRUNCATE guard, once.
    let mut tx = pool.begin().await.expect("begin the probe transaction");
    sqlx::query("SELECT public.ensure_audit_logs_partition(DATE '2097-03-01')")
        .execute(&mut *tx)
        .await
        .expect("create the probe month partition");
    let new_partition_row_guard: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'public.audit_logs_2097_03'::regclass
              AND tgname = 'trg_audit_logs_append_only_row'
              AND tgparentid <> 0
        )
        "#,
    )
    .fetch_one(&mut *tx)
    .await
    .expect("read the new partition's row guard");
    let added: i32 = sqlx::query_scalar("SELECT public.ensure_audit_logs_truncate_guards()")
        .fetch_one(&mut *tx)
        .await
        .expect("guard the new partition");
    let new_partition_truncate_guard: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'public.audit_logs_2097_03'::regclass
              AND tgname = 'trg_audit_logs_no_truncate'
        )
        "#,
    )
    .fetch_one(&mut *tx)
    .await
    .expect("read the new partition's TRUNCATE guard");
    let added_again: i32 = sqlx::query_scalar("SELECT public.ensure_audit_logs_truncate_guards()")
        .fetch_one(&mut *tx)
        .await
        .expect("rerun the guard helper");
    tx.rollback()
        .await
        .expect("roll back the probe transaction");

    assert_eq!(
        parent_triggers,
        vec![
            (
                "trg_audit_logs_append_only".to_owned(),
                "CREATE TRIGGER trg_audit_logs_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation()".to_owned()
            ),
            (
                "trg_audit_logs_append_only_row".to_owned(),
                "CREATE TRIGGER trg_audit_logs_append_only_row BEFORE DELETE OR UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()".to_owned()
            ),
        ]
    );
    assert!(
        partitions
            .iter()
            .any(|(name, _, _)| name == "audit_logs_default"),
        "audit_logs must keep its DEFAULT partition: {partitions:?}"
    );
    assert!(
        partitions.len() >= 4,
        "upkeep must leave this month and the next two next to the DEFAULT partition: {partitions:?}"
    );
    let unguarded: Vec<_> = partitions
        .iter()
        .filter(|(_, row_guard, truncate_guard)| !row_guard || !truncate_guard)
        .collect();
    assert!(
        unguarded.is_empty(),
        "partitions missing a guard (name, row, truncate): {unguarded:?}"
    );
    assert!(
        new_partition_row_guard,
        "a new partition must get the cloned row guard"
    );
    assert!(added >= 1, "the helper must guard the new partition");
    assert!(new_partition_truncate_guard);
    assert_eq!(added_again, 0, "the guard helper must be idempotent");
}

#[tokio::test]
async fn restore_trigger_switch_also_opens_the_cloned_partition_guards() {
    // A data-transfer restore clears the tables it rewrites with the user
    // triggers switched off (`ALTER TABLE ... DISABLE TRIGGER USER`), not
    // through the escape hatch. PostgreSQL applies that switch to the row
    // triggers it cloned onto every partition, so the restore can still clear
    // audit_logs, and switching back on closes every partition again.
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };
    let audit_logs = TransferTable {
        table: QualifiedTable::parse("public.audit_logs").expect("qualify audit_logs"),
        is_partitioned: true,
        columns: HashSet::new(),
        ordered_columns: Vec::new(),
        generated_columns: HashSet::new(),
        primary_key_columns: vec!["id".to_owned(), "created_at".to_owned()],
        dependencies: HashSet::new(),
    };
    let mut tx = pool.begin().await.expect("begin the probe transaction");
    set_escape_hatch(&mut tx, false).await;
    seed_probe_rows(&mut tx).await;

    DataTransferRepository::set_transfer_triggers(
        &mut tx,
        std::slice::from_ref(&audit_logs),
        false,
    )
    .await
    .expect("switch the audit_logs user triggers off");
    let cleared =
        sqlx::query("DELETE FROM public.audit_logs WHERE action = 'append_only_partition_probe'")
            .execute(&mut *tx)
            .await
            .expect("clear the probe rows with the user triggers off")
            .rows_affected();
    DataTransferRepository::set_transfer_triggers(&mut tx, std::slice::from_ref(&audit_logs), true)
        .await
        .expect("switch the audit_logs user triggers back on");

    sqlx::query(SEED_PROBE_ROWS)
        .execute(&mut *tx)
        .await
        .expect("insert the probe audit rows again");
    sqlx::query("SAVEPOINT probe")
        .execute(&mut *tx)
        .await
        .expect("set the probe savepoint");
    let reenabled = sqlx::query(
        "DELETE FROM public.audit_logs_2097_03 WHERE action = 'append_only_partition_probe'",
    )
    .execute(&mut *tx)
    .await;
    sqlx::query("ROLLBACK TO SAVEPOINT probe")
        .execute(&mut *tx)
        .await
        .expect("roll back to the probe savepoint");
    tx.rollback()
        .await
        .expect("roll back the probe transaction");

    assert_eq!(
        cleared, 2,
        "the restore path must still clear partitioned audit rows"
    );
    let error =
        reenabled.expect_err("switching the triggers back on must close the partitions again");
    assert!(error.to_string().contains(GUARD_MESSAGE), "{error}");
}
