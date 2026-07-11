mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    #[tokio::test]
    async fn probe_balance_due_column() {
        let pool = super::common::setup_test_db().await;
        let row = sqlx::query("SELECT amount, paid_amount, status, void_at FROM customer_ledgers LIMIT 1")
            .fetch_optional(&pool)
            .await;
        println!("basic select ok: {:?}", row.is_ok());

        let row2 = sqlx::query("SELECT balance_due FROM customer_ledgers LIMIT 1")
            .fetch_optional(&pool)
            .await;
        println!("balance_due select: {:?}", row2);
        assert!(row2.is_err(), "expected balance_due to not exist -- if this fails, column DOES exist");
    }
}
