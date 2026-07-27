//! Regression tests for the persisted status vocabulary.

const POSTGRES_SCHEMA: &str = include_str!("../database/postgres/migrations/0001_v1_baseline.sql");
const POSTGRES_SEED: &str = include_str!("../database/postgres/seed.sql");

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
    block.contains("email_campaigns_status_check")
        || block.contains("email_deliveries_status_check")
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
fn postgres_schema_requires_pg19_and_uses_native_uuidv7() {
    assert!(
        POSTGRES_SCHEMA.contains("server_version_num < 190000"),
        "schema must reject PostgreSQL versions older than 19"
    );
    assert!(
        POSTGRES_SCHEMA.contains("AS $$SELECT pg_catalog.uuidv7()$$;"),
        "gen_uuidv7() must delegate to PostgreSQL 19's native UUIDv7 function"
    );
    assert!(
        POSTGRES_SCHEMA.contains("id uuid DEFAULT public.gen_uuidv7() NOT NULL")
            && POSTGRES_SCHEMA.contains("uuid uuid DEFAULT public.gen_uuidv7() NOT NULL"),
        "UUID defaults must use the project's native UUIDv7 wrapper"
    );
}

#[test]
fn postgres_schema_uses_identity_columns_not_serial_sequences() {
    assert!(
        !POSTGRES_SCHEMA.contains("CREATE SEQUENCE"),
        "baseline must declare identity columns, not standalone serial sequences"
    );
    assert!(
        !POSTGRES_SCHEMA.contains("DEFAULT nextval"),
        "baseline must not use serial-style nextval defaults"
    );
    assert!(
        POSTGRES_SCHEMA.matches("ADD GENERATED ALWAYS AS IDENTITY").count() >= 70,
        "every bigint surrogate key must be a GENERATED ALWAYS identity column"
    );
    assert!(
        !POSTGRES_SCHEMA.contains("timestamp without time zone"),
        "all persisted timestamps must be timestamptz"
    );
    assert!(
        !POSTGRES_SCHEMA.contains(" STORED"),
        "generated columns are virtual in the PostgreSQL 19 baseline"
    );
}

#[test]
fn postgres_schema_defines_the_hotel_property_graph() {
    assert!(
        POSTGRES_SCHEMA.contains("CREATE PROPERTY GRAPH public.hotel_graph"),
        "baseline must define the SQL/PGQ hotel_graph property graph"
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
        POSTGRES_SCHEMA.contains("CREATE INDEX idx_audit_logs_details_trgm")
            && POSTGRES_SCHEMA.contains(
                "ON ONLY public.audit_logs USING gin (((details)::text) public.gin_trgm_ops)"
            ),
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
        POSTGRES_SEED.contains("'void', 'refund',"),
        "seed data action constraint must accept the payments:refund permission"
    );

    let validation_blocks = POSTGRES_SEED
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

#[test]
fn postgres_initialization_has_only_baseline_and_seed() {
    let postgres_dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("database/postgres");
    assert!(
        postgres_dir
            .join("migrations/0001_v1_baseline.sql")
            .is_file()
    );
    assert!(postgres_dir.join("seed.sql").is_file());
    assert!(!postgres_dir.join("data.sql").exists());
    assert!(!postgres_dir.join("patches").exists());
    assert!(!postgres_dir.join("upgrade").exists());
}

mod postgres_smoke {
    use super::{POSTGRES_SCHEMA, POSTGRES_SEED};
    use sqlx::{Connection, Executor, PgConnection, PgPool};

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

    fn psql_script_for_sqlx(script: &str) -> String {
        script
            .lines()
            .filter(|line| !line.trim_start().starts_with('\\'))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[tokio::test]
    async fn postgres_v1_lifecycle_builds_the_final_schema() {
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

            // The simple-query protocol does not understand psql meta-commands.
            for script in [POSTGRES_SCHEMA, POSTGRES_SEED] {
                sqlx::raw_sql(&psql_script_for_sqlx(script))
                    .execute(&pool)
                    .await?;
            }

            let revision_checksum: String = sqlx::query_scalar(
                "SELECT checksum FROM hotel_schema_revisions WHERE generation = 1 AND version = 1",
            )
            .fetch_one(&pool)
            .await?;
            assert_eq!(
                revision_checksum,
                "sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d"
            );

            let cancellable_column_exists: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'promotions' AND column_name = 'is_cancellable')",
            )
            .fetch_one(&pool)
            .await?;
            assert!(cancellable_column_exists);

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

        result.expect("V1 migration, data, and seed should build the final schema");
    }
}
