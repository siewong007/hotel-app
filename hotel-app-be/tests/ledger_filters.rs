//! Unit tests for the Customer Ledger list filter predicates.
//!
//! These exercise the exact SQL fragments built by
//! `repositories::ledger::{invoice_state_clause, balance_state_clause,
//! ui_status_clause}` — the predicates behind the "Uninvoiced / Outstanding /
//! Invoiced / Paid / Overdue / Voided" filter buttons in the UI.
//!
//! The production SQLite `customer_ledgers` table predates the city-ledger
//! columns these filters reference (`amount`, `balance_due`, `paid_amount`,
//! `invoice_number`, `void_at`), so the tests apply the fragments to a
//! purpose-built table with exactly those columns. The fragments are
//! database-agnostic, so this validates the same logic that runs against
//! PostgreSQL in production.
//!
//! Run with: cargo test --features sqlite --no-default-features

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::repositories::ledger::{
        balance_state_clause, invoice_state_clause, ui_status_clause,
    };
    use sqlx::SqlitePool;
    use sqlx::sqlite::SqlitePoolOptions;

    // Row ids and their intended derived classification (mirrors the frontend
    // `getLedgerUiStatus`, which is strictly balance-first):
    //
    //   1  paid             — settled, nothing outstanding
    //   2  partial          — was paid, then a charge re-opened an invoiced balance
    //   3  overdue          — outstanding, due date in the past
    //   4  invoiced         — outstanding, invoice issued, not yet due
    //   5  ready_to_invoice — outstanding, no invoice number yet
    //   6  voided           — void_at set
    //   7  overdue          — status already marked overdue, no due date
    const PAST: &str = "2020-01-01"; // before today's date('now')
    const FUTURE: &str = "2030-01-01"; // after today's date('now')

    async fn setup() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory pool");

        sqlx::query(
            "CREATE TABLE customer_ledgers (
                 id INTEGER PRIMARY KEY,
                 status TEXT,
                 balance_due REAL,
                 paid_amount REAL,
                 invoice_number TEXT,
                 due_date TEXT,
                 void_at TEXT
             )",
        )
        .execute(&pool)
        .await
        .expect("create table");

        // (id, status, balance_due, paid_amount, invoice_number, due_date, void_at)
        let rows: &[(
            i64,
            &str,
            f64,
            f64,
            Option<&str>,
            Option<&str>,
            Option<&str>,
        )] = &[
            (1, "paid", 0.0, 100.0, Some("INV1"), Some(PAST), None),
            (2, "paid", 50.0, 100.0, Some("INV2"), Some(FUTURE), None),
            (3, "pending", 100.0, 0.0, Some("INV3"), Some(PAST), None),
            (4, "pending", 100.0, 0.0, Some("INV4"), Some(FUTURE), None),
            (5, "pending", 100.0, 0.0, None, Some(FUTURE), None),
            (
                6,
                "cancelled",
                100.0,
                0.0,
                Some("INV6"),
                Some(FUTURE),
                Some(PAST),
            ),
            (7, "overdue", 120.0, 0.0, Some("INV7"), None, None),
        ];
        for (id, status, balance, paid, inv, due, void) in rows {
            sqlx::query(
                "INSERT INTO customer_ledgers
                 (id, status, balance_due, paid_amount, invoice_number, due_date, void_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .bind(id)
            .bind(status)
            .bind(balance)
            .bind(paid)
            .bind(inv)
            .bind(due)
            .bind(void)
            .execute(&pool)
            .await
            .expect("insert row");
        }
        pool
    }

    /// Run `SELECT id ... WHERE 1=1 {clause}` binding `value` at `?1`,
    /// returning the matched ids sorted ascending.
    async fn matched(pool: &SqlitePool, clause: &str, value: Option<&str>) -> Vec<i64> {
        let sql = format!("SELECT id FROM customer_ledgers WHERE 1=1 {clause} ORDER BY id");
        sqlx::query_scalar(&sql)
            .bind(value)
            .fetch_all(pool)
            .await
            .expect("run filter query")
    }

    // Same placeholder for the null-check and equality checks under SQLite.
    fn ui_clause() -> String {
        ui_status_clause("?1", "?1", "date('now')")
    }

    #[tokio::test]
    async fn ui_status_paid_is_balance_first_not_status_first() {
        let pool = setup().await;
        let clause = ui_clause();
        // Row 2 has status='paid' but a re-opened balance — it must NOT count as
        // paid (the original bug returned it here), and row 1 must.
        assert_eq!(
            matched(&pool, &clause, Some("paid")).await,
            vec![1],
            "only the fully-settled row is 'paid'; a re-opened balance is excluded"
        );
        // The re-opened row is partial, not paid.
        assert_eq!(
            matched(&pool, &clause, Some("partial")).await,
            vec![2],
            "the re-opened (status='paid', balance>0, paid>0) row is 'partial'"
        );
    }

    #[tokio::test]
    async fn ui_status_overdue_invoiced_ready_voided() {
        let pool = setup().await;
        let clause = ui_clause();
        assert_eq!(
            matched(&pool, &clause, Some("overdue")).await,
            vec![3, 7],
            "outstanding with a past due date or stored overdue status is overdue"
        );
        assert_eq!(
            matched(&pool, &clause, Some("invoiced")).await,
            vec![4],
            "outstanding, invoice issued, not yet due, unpaid is 'invoiced'"
        );
        assert_eq!(
            matched(&pool, &clause, Some("ready_to_invoice")).await,
            vec![5],
            "outstanding with no invoice number is 'ready_to_invoice'"
        );
        assert_eq!(
            matched(&pool, &clause, Some("voided")).await,
            vec![6],
            "a row with void_at set is voided"
        );
    }

    #[tokio::test]
    async fn ui_status_null_returns_all() {
        let pool = setup().await;
        assert_eq!(
            matched(&pool, &ui_clause(), None).await,
            vec![1, 2, 3, 4, 5, 6, 7],
            "no ui_status filter (the 'All' button) returns every row"
        );
    }

    #[tokio::test]
    async fn invoice_state_filter() {
        let pool = setup().await;
        let clause = invoice_state_clause("?1", "?1");
        assert_eq!(
            matched(&pool, &clause, Some("uninvoiced")).await,
            vec![5],
            "only the row with no invoice number is uninvoiced"
        );
        assert_eq!(
            matched(&pool, &clause, Some("invoiced")).await,
            vec![1, 2, 3, 4, 7],
            "rows with an invoice number, excluding the voided one, are invoiced"
        );
    }

    #[tokio::test]
    async fn balance_state_filter() {
        let pool = setup().await;
        let clause = balance_state_clause("?1", "?1", "date('now')");
        // Row 3 is overdue (past due date) — it must NOT appear under Outstanding;
        // it belongs to the dedicated Overdue bucket only.
        assert_eq!(
            matched(&pool, &clause, Some("outstanding")).await,
            vec![5],
            "only current, non-void, not-yet-invoiced rows with a positive balance are outstanding"
        );
        assert_eq!(
            matched(&pool, &clause, Some("clear")).await,
            vec![1],
            "only the fully-settled row is clear"
        );
    }
}
