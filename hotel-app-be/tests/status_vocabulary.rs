//! Regression tests for the persisted status vocabulary.

const POSTGRES_SCHEMA: &str = include_str!("../database/schema.sql");
const SQLITE_VOID_MIGRATION: &str =
    include_str!("../database/sqlite_migrations/012_void_status_names.sql");

fn status_check_blocks(sql: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current: Option<String> = None;
    let mut paren_depth = 0i32;

    for line in sql.lines() {
        let trimmed = line.trim();
        if current.is_none() && trimmed.contains("CHECK") && trimmed.contains("status") {
            paren_depth = trimmed.matches('(').count() as i32 - trimmed.matches(')').count() as i32;
            current = Some(format!("{trimmed}\n"));
            if paren_depth <= 0 {
                blocks.push(current.take().unwrap());
            }
            continue;
        }

        if let Some(block) = current.as_mut() {
            paren_depth += trimmed.matches('(').count() as i32;
            paren_depth -= trimmed.matches(')').count() as i32;
            block.push_str(trimmed);
            block.push('\n');
            if paren_depth <= 0 {
                blocks.push(current.take().unwrap());
            }
        }
    }

    blocks
}

#[test]
fn active_postgres_status_constraints_do_not_accept_cancelled() {
    let blocks = status_check_blocks(POSTGRES_SCHEMA);
    assert!(
        !blocks.is_empty(),
        "schema guard should find status check constraints"
    );

    for block in blocks {
        assert!(
            !block.contains("cancelled") && !block.contains("comp_cancelled"),
            "active status constraint still accepts legacy cancelled status:\n{block}"
        );
    }
}

#[test]
fn legacy_cancelled_values_are_migrated_to_void_names() {
    for expected in [
        "UPDATE bookings SET status = 'voided' WHERE status = 'cancelled'",
        "UPDATE bookings SET status = 'comp_void' WHERE status = 'comp_cancelled'",
        "UPDATE bookings SET payment_status = 'void' WHERE payment_status = 'cancelled'",
        "UPDATE payments SET status = 'void' WHERE status = 'cancelled'",
        "UPDATE invoices SET status = 'void' WHERE status = 'cancelled'",
        "UPDATE ekyc_verifications SET status = 'void' WHERE status = 'cancelled'",
    ] {
        assert!(
            POSTGRES_SCHEMA.contains(expected) || SQLITE_VOID_MIGRATION.contains(expected),
            "missing legacy status normalization: {expected}"
        );
    }
}

#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
mod postgres_smoke {
    use super::POSTGRES_SCHEMA;
    use sqlx::{Connection, Executor, PgConnection, PgPool, Row};

    fn quote_ident(identifier: &str) -> String {
        format!("\"{}\"", identifier.replace('"', "\"\""))
    }

    fn disposable_database_urls(database_url: &str) -> Option<(String, String, String)> {
        let scheme_end = database_url.find("://")? + 3;
        let path_start = database_url[scheme_end..].find('/')? + scheme_end;
        let prefix = &database_url[..=path_start];
        let suffix_start = database_url[path_start + 1..]
            .find(['?', '#'])
            .map(|idx| path_start + 1 + idx)
            .unwrap_or(database_url.len());
        let suffix = &database_url[suffix_start..];
        let db_name = format!("hotel_schema_smoke_{}", uuid::Uuid::new_v4().simple());
        let admin_url = format!("{prefix}postgres{suffix}");
        let temp_url = format!("{prefix}{db_name}{suffix}");
        Some((admin_url, temp_url, db_name))
    }

    async fn seed_legacy_status_rows(pool: &PgPool) -> Result<(), sqlx::Error> {
        sqlx::raw_sql(
            r#"
            ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
            ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
            ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
            ALTER TABLE customer_ledgers DROP CONSTRAINT IF EXISTS valid_status;

            INSERT INTO guests (id, full_name)
            VALUES (970001, 'Legacy Status Guest');

            INSERT INTO room_types (id, code, name, base_price)
            VALUES (970101, 'LEG', 'Legacy Status Room', 100.00);

            INSERT INTO rooms (id, room_number, room_type_id, status)
            VALUES (970201, 'LEG-201', 970101, 'reserved');

            INSERT INTO bookings (
                id, booking_number, guest_id, room_id, check_in_date, check_out_date,
                room_rate, subtotal, total_amount, status, payment_status
            )
            VALUES
                (970301, 'BK-LEGACY-CANCELLED', 970001, 970201, CURRENT_DATE, CURRENT_DATE + 1, 100.00, 100.00, 100.00, 'cancelled', 'cancelled'),
                (970302, 'BK-LEGACY-COMP-CANCELLED', 970001, 970201, CURRENT_DATE + 2, CURRENT_DATE + 3, 100.00, 100.00, 100.00, 'comp_cancelled', 'paid');

            INSERT INTO payments (booking_id, amount, payment_method, status)
            VALUES (970301, 100.00, 'cash', 'cancelled');

            INSERT INTO customer_ledgers (company_name, description, expense_type, amount, status)
            VALUES ('Legacy Co', 'Legacy status row', 'room_charge', 100.00, 'cancelled');
            "#,
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    #[tokio::test]
    async fn postgres_schema_reruns_and_normalizes_legacy_cancelled_statuses() {
        if std::env::var("HOTEL_RUN_PG_SCHEMA_SMOKE").ok().as_deref() != Some("1") {
            eprintln!("skipping PostgreSQL schema smoke; set HOTEL_RUN_PG_SCHEMA_SMOKE=1");
            return;
        }

        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL is required when HOTEL_RUN_PG_SCHEMA_SMOKE=1");
        let (admin_url, temp_url, db_name) = disposable_database_urls(&database_url)
            .expect("DATABASE_URL must include a database path");
        let db_ident = quote_ident(&db_name);
        let mut admin = PgConnection::connect(&admin_url)
            .await
            .expect("connect to postgres admin database");

        let _ = admin
            .execute(format!("DROP DATABASE IF EXISTS {db_ident} WITH (FORCE)").as_str())
            .await;
        admin
            .execute(format!("CREATE DATABASE {db_ident}").as_str())
            .await
            .expect("create disposable schema smoke database");

        let result = async {
            let pool = PgPool::connect(&temp_url).await?;
            sqlx::raw_sql(POSTGRES_SCHEMA).execute(&pool).await?;
            seed_legacy_status_rows(&pool).await?;
            sqlx::raw_sql(POSTGRES_SCHEMA).execute(&pool).await?;

            let booking_statuses: Vec<(String, Option<String>)> = sqlx::query_as(
                "SELECT status, payment_status FROM bookings WHERE id IN (970301, 970302) ORDER BY id",
            )
            .fetch_all(&pool)
            .await?;
            assert_eq!(
                booking_statuses,
                vec![
                    ("voided".to_string(), Some("void".to_string())),
                    ("comp_void".to_string(), Some("paid".to_string())),
                ]
            );

            let payment_status: String =
                sqlx::query_scalar("SELECT status FROM payments WHERE booking_id = 970301")
                    .fetch_one(&pool)
                    .await?;
            assert_eq!(payment_status, "void");

            let ledger_status: String =
                sqlx::query_scalar("SELECT status FROM customer_ledgers WHERE company_name = 'Legacy Co'")
                    .fetch_one(&pool)
                    .await?;
            assert_eq!(ledger_status, "void");

            let cancelled_constraints: i64 = sqlx::query(
                r#"
                SELECT COUNT(*) AS count
                FROM pg_constraint
                WHERE contype = 'c'
                  AND pg_get_constraintdef(oid) ILIKE '%cancelled%'
                "#,
            )
            .fetch_one(&pool)
            .await?
            .get("count");
            assert_eq!(cancelled_constraints, 0);

            pool.close().await;
            Ok::<(), sqlx::Error>(())
        }
        .await;

        admin
            .execute(format!("DROP DATABASE IF EXISTS {db_ident} WITH (FORCE)").as_str())
            .await
            .expect("drop disposable schema smoke database");

        result.expect("schema should run twice and normalize legacy statuses");
    }
}
