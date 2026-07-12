//! Tests for invoice number generation
//! (services::invoice_numbers / repositories::invoice_numbers).
//!
//! Format under test: `INV-YYYYMM-XXXX` (4-digit zero-padded sequence,
//! scoped to the current month, shared across the `invoices` and
//! `customer_ledgers` tables) — see services/invoice_numbers.rs module docs.
//!
//! The month segment is derived from `chrono::Local::now()` at call time, so
//! these tests compute the expected prefix the same way rather than
//! hardcoding a calendar month (avoids the test going stale / flaking across
//! month boundaries).

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::repositories::invoice_numbers as repo;
    use hotel_app_be::services::invoice_numbers::next_invoice_number;
    use sqlx::SqlitePool;

    fn current_prefix() -> String {
        let yyyymm = chrono::Local::now().format("%Y%m").to_string();
        format!("INV-{}-", yyyymm)
    }

    async fn insert_invoice(pool: &SqlitePool, invoice_number: &str) {
        sqlx::query(
            "INSERT INTO invoices (invoice_number, subtotal, total_amount, status)
             VALUES (?1, 100.0, 100.0, 'issued')",
        )
        .bind(invoice_number)
        .execute(pool)
        .await
        .expect("seed invoice");
    }

    async fn insert_ledger_with_invoice_number(pool: &SqlitePool, invoice_number: &str) {
        sqlx::query(
            "INSERT INTO customer_ledgers (company_name, description, expense_type, amount, invoice_number)
             VALUES ('Invoice Number Test Co', 'City ledger charge', 'accommodation', 100.0, ?1)",
        )
        .bind(invoice_number)
        .execute(pool)
        .await
        .expect("seed customer_ledger");
    }

    #[tokio::test]
    async fn first_invoice_of_month_starts_at_0001() {
        let pool = super::common::setup_test_db().await;

        let number = next_invoice_number(&pool)
            .await
            .expect("next_invoice_number should succeed with no prior rows");

        assert_eq!(number, format!("{}0001", current_prefix()));
    }

    #[tokio::test]
    async fn sequential_increment_from_prior_invoice() {
        let pool = super::common::setup_test_db().await;
        let prefix = current_prefix();

        insert_invoice(&pool, &format!("{}0001", prefix)).await;

        let number = next_invoice_number(&pool).await.unwrap();
        assert_eq!(number, format!("{}0002", prefix));
    }

    #[tokio::test]
    async fn zero_padding_format_stays_four_digits_past_single_digit_sequence() {
        let pool = super::common::setup_test_db().await;
        let prefix = current_prefix();

        // Seed sequence 9 so the next number rolls from a 1-digit to a
        // 2-digit sequence value, proving the padding is re-applied (not
        // just carried over from the seeded string).
        insert_invoice(&pool, &format!("{}0009", prefix)).await;

        let number = next_invoice_number(&pool).await.unwrap();
        assert_eq!(number, format!("{}0010", prefix));
    }

    #[tokio::test]
    async fn sequence_is_shared_across_invoices_and_customer_ledgers_tables() {
        let pool = super::common::setup_test_db().await;
        let prefix = current_prefix();

        // Only a customer_ledgers row exists this month (no invoices row) —
        // the next invoice number must still continue the sequence, proving
        // the two tables share one counter (module doc: "a number issued for
        // a checkout invoice never collides with one issued for a
        // city-ledger entry in the same month").
        insert_ledger_with_invoice_number(&pool, &format!("{}0003", prefix)).await;

        let number = next_invoice_number(&pool).await.unwrap();
        assert_eq!(number, format!("{}0004", prefix));
    }

    #[tokio::test]
    async fn max_invoice_sequence_returns_none_when_no_matching_rows() {
        let pool = super::common::setup_test_db().await;
        let pattern = format!("{}%", current_prefix());

        let max_seq = repo::max_invoice_sequence(&pool, &pattern).await.unwrap();
        assert_eq!(max_seq, None);
    }

    #[tokio::test]
    async fn max_invoice_sequence_takes_the_max_across_both_tables() {
        let pool = super::common::setup_test_db().await;
        let prefix = current_prefix();
        let pattern = format!("{}%", prefix);

        insert_invoice(&pool, &format!("{}0002", prefix)).await;
        insert_ledger_with_invoice_number(&pool, &format!("{}0005", prefix)).await;

        let max_seq = repo::max_invoice_sequence(&pool, &pattern).await.unwrap();
        assert_eq!(max_seq, Some(5));
    }

    #[tokio::test]
    async fn max_invoice_sequence_ignores_rows_outside_the_month_pattern() {
        let pool = super::common::setup_test_db().await;
        let prefix = current_prefix();
        let pattern = format!("{}%", prefix);

        // A row from a different (fixed, past) month must not affect this
        // month's sequence computation.
        insert_invoice(&pool, "INV-202001-0099").await;

        let max_seq = repo::max_invoice_sequence(&pool, &pattern).await.unwrap();
        assert_eq!(max_seq, None);

        let number = next_invoice_number(&pool).await.unwrap();
        assert_eq!(number, format!("{}0001", prefix));
    }
}
