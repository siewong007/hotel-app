//! Regression tests for the persisted status vocabulary.

const POSTGRES_SCHEMA: &str = include_str!("../database/schema.sql");
const POSTGRES_DATA: &str = include_str!("../database/data.sql");
const SQLITE_DATA: &str = include_str!("../database/sqlite_data.sql");

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

fn is_communications_lifecycle_status(block: &str) -> bool {
    // Campaigns and individual deliveries can be deliberately stopped. Their
    // `cancelled` terminal state is not one of the legacy reservation/payment
    // values this regression guard is designed to remove.
    block.contains("'draft', 'scheduled', 'running', 'completed', 'cancelled', 'failed'")
        || block.contains("'queued', 'sending', 'sent', 'failed', 'suppressed', 'cancelled'")
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
            is_communications_lifecycle_status(&block)
                || (!block.contains("cancelled") && !block.contains("comp_cancelled")),
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
            POSTGRES_SCHEMA.contains(expected) || SQLITE_DATA.contains(expected),
            "missing legacy status normalization: {expected}"
        );
    }
}

#[test]
fn postgres_schema_requires_pg19_and_uses_native_uuidv7() {
    assert!(
        POSTGRES_SCHEMA.contains("server_version_num < 190000"),
        "schema must reject PostgreSQL versions older than 19"
    );
    assert!(
        POSTGRES_SCHEMA.contains("AS 'SELECT pg_catalog.uuidv7()';"),
        "gen_uuidv7() must delegate to PostgreSQL 19's native UUIDv7 function"
    );
    assert!(
        POSTGRES_SCHEMA.contains("ALTER COLUMN id SET DEFAULT gen_uuidv7()")
            && POSTGRES_SCHEMA.contains("ALTER COLUMN uuid       SET DEFAULT gen_uuidv7()"),
        "UUID defaults must use the project's native UUIDv7 wrapper"
    );
}

#[test]
fn postgres_schema_uses_pg19_partition_split_and_drops_redundant_indexes() {
    assert!(
        POSTGRES_SCHEMA.contains("SPLIT PARTITION audit_logs_default"),
        "late audit partitions must use PostgreSQL 19 SPLIT PARTITION"
    );
    assert!(
        POSTGRES_SCHEMA.contains(
            "INTO (PARTITION public.%I FOR VALUES FROM (%L) TO (%L), PARTITION public.audit_logs_default DEFAULT)"
        ),
        "partition split targets must remain in public when the function pins pg_catalog first"
    );
    assert!(
        POSTGRES_SCHEMA.contains("CREATE INDEX IF NOT EXISTS idx_audit_logs_details_trgm")
            && POSTGRES_SCHEMA.contains("ON audit_logs USING gin ((details::text) gin_trgm_ops)"),
        "audit detail substring search needs a matching trigram expression index"
    );

    for index_name in [
        "idx_users_uuid",
        "idx_passkeys_credential_id",
        "idx_user_sessions_session_id",
        "idx_system_settings_key",
        "idx_email_templates_code",
        "idx_night_audit_runs_audit_date",
        "idx_guests_uuid",
        "idx_corporate_accounts_registration",
        "idx_loyalty_memberships_member_number",
        "idx_bookings_number",
        "idx_bookings_uuid",
        "idx_invoices_number",
        "idx_customer_ledgers_invoice",
        "idx_loyalty_members_guest",
        "idx_loyalty_members_number",
    ] {
        assert!(
            POSTGRES_SCHEMA.contains(&format!("DROP INDEX IF EXISTS {index_name};")),
            "schema must remove redundant index {index_name}"
        );
        assert!(
            !POSTGRES_SCHEMA.lines().any(|line| {
                let line = line.trim();
                line.starts_with("CREATE") && line.contains("INDEX") && line.contains(index_name)
            }),
            "schema must not recreate redundant index {index_name}"
        );
    }
}

#[test]
fn postgres_permission_constraint_accepts_seeded_refund_action() {
    assert!(
        POSTGRES_DATA.contains("'void', 'refund',"),
        "seed data action constraint must accept the payments:refund permission"
    );

    let validation_blocks = POSTGRES_DATA
        .split("p.action NOT IN (")
        .skip(1)
        .map(|sql| sql.split(')').next().expect("action allowlist must close"))
        .collect::<Vec<_>>();
    assert!(
        !validation_blocks.is_empty(),
        "seed data must validate system permission actions"
    );
    for block in validation_blocks {
        assert!(
            block.contains("'refund'"),
            "system permission validation must accept the seeded refund action: {block}"
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
            let server_version_num: i32 =
                sqlx::query_scalar("SELECT current_setting('server_version_num')::integer")
                    .fetch_one(&pool)
                    .await?;
            assert!(
                server_version_num >= 190000,
                "schema smoke requires PostgreSQL 19+, got server_version_num={server_version_num}"
            );

            // `sqlx::raw_sql` runs the script over the simple-query protocol, which
            // (unlike `psql -f`) does not understand psql meta-commands such as
            // `\set ON_ERROR_STOP on`. Strip backslash-command lines before sending.
            let server_schema: String = POSTGRES_SCHEMA
                .lines()
                .filter(|line| !line.trim_start().starts_with('\\'))
                .collect::<Vec<_>>()
                .join("\n");
            sqlx::raw_sql(&server_schema).execute(&pool).await?;
            seed_legacy_status_rows(&pool).await?;
            sqlx::raw_sql(&server_schema).execute(&pool).await?;

            let booking_statuses: Vec<(String, Option<String>)> = sqlx::query_as(
                "SELECT status, payment_status FROM bookings WHERE id IN (970301, 970302) ORDER BY id",
            )
            .fetch_all(&pool)
            .await?;
            assert_eq!(
                booking_statuses,
                vec![
                    // Booking 970301's only payment is normalized to `void`, which
                    // fires `sync_booking_payment_status` and recomputes the booking
                    // to `unpaid` (no completed payments) — the legacy `cancelled`
                    // value is gone, which is what this smoke test guards.
                    ("voided".to_string(), Some("unpaid".to_string())),
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

            let redundant_indexes: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname IN (
                      'idx_users_uuid',
                      'idx_passkeys_credential_id',
                      'idx_user_sessions_session_id',
                      'idx_system_settings_key',
                      'idx_email_templates_code',
                      'idx_night_audit_runs_audit_date',
                      'idx_guests_uuid',
                      'idx_corporate_accounts_registration',
                      'idx_loyalty_memberships_member_number',
                      'idx_bookings_number',
                      'idx_bookings_uuid',
                      'idx_invoices_number',
                      'idx_customer_ledgers_invoice',
                      'idx_loyalty_members_guest',
                      'idx_loyalty_members_number'
                  )
                "#,
            )
            .fetch_one(&pool)
            .await?;
            assert_eq!(redundant_indexes, 0);

            let audit_details_trgm_exists: bool = sqlx::query_scalar(
                "SELECT to_regclass('public.idx_audit_logs_details_trgm') IS NOT NULL",
            )
            .fetch_one(&pool)
            .await?;
            assert!(
                audit_details_trgm_exists,
                "pg_trgm-backed audit detail index should exist in the PostgreSQL smoke image"
            );

            sqlx::query(
                r#"
                INSERT INTO audit_logs (action, resource_type, details, created_at)
                VALUES ('pg19_partition_test', 'schema_smoke', '{"source":"default"}', '2099-07-15T12:00:00Z')
                "#,
            )
            .execute(&pool)
            .await?;

            let before_split: String = sqlx::query_scalar(
                r#"
                SELECT tableoid::regclass::text
                FROM audit_logs
                WHERE action = 'pg19_partition_test'
                "#,
            )
            .fetch_one(&pool)
            .await?;
            assert_eq!(before_split, "audit_logs_default");

            sqlx::query("SELECT ensure_audit_logs_partition(DATE '2099-07-01')")
                .execute(&pool)
                .await?;
            // A second call verifies that the helper remains idempotent after
            // PostgreSQL 19 has split and recreated the DEFAULT partition.
            sqlx::query("SELECT ensure_audit_logs_partition(DATE '2099-07-01')")
                .execute(&pool)
                .await?;

            let after_split: String = sqlx::query_scalar(
                r#"
                SELECT tableoid::regclass::text
                FROM audit_logs
                WHERE action = 'pg19_partition_test'
                "#,
            )
            .fetch_one(&pool)
            .await?;
            assert_eq!(after_split, "audit_logs_2099_07");

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
