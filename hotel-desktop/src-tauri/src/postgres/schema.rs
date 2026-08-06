use super::{command_output_details, PostgresError, PATH_SEP};
use std::path::Path;
use std::process::Stdio;

const PAYMENT_IDEMPOTENCY_SCHEMA_CURRENT: &str = r#"
SELECT CASE WHEN
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'idempotency_key'
          AND data_type = 'character varying'
          AND character_maximum_length = 160
          AND is_nullable = 'YES'
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'idempotency_fingerprint'
          AND data_type = 'character varying'
          AND character_maximum_length = 64
          AND is_nullable = 'YES'
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customer_ledger_payments'
          AND column_name = 'idempotency_key'
          AND data_type = 'character varying'
          AND character_maximum_length = 160
          AND is_nullable = 'YES'
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customer_ledger_payments'
          AND column_name = 'idempotency_fingerprint'
          AND data_type = 'character varying'
          AND character_maximum_length = 64
          AND is_nullable = 'YES'
    )
    AND pg_get_indexdef(to_regclass('public.idx_customer_ledger_payments_receipt_unique')) =
        'CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique ON public.customer_ledger_payments USING btree (ledger_id, lower(TRIM(BOTH FROM receipt_number))) WHERE ((receipt_number IS NOT NULL) AND (TRIM(BOTH FROM receipt_number) <> ''''::text))'
    AND pg_get_indexdef(to_regclass('public.uq_ledger_payments_ledger_idempotency')) =
        'CREATE UNIQUE INDEX uq_ledger_payments_ledger_idempotency ON public.customer_ledger_payments USING btree (ledger_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (TRIM(BOTH FROM idempotency_key) <> ''''::text))'
    AND pg_get_indexdef(to_regclass('public.uq_payments_booking_idempotency')) =
        'CREATE UNIQUE INDEX uq_payments_booking_idempotency ON public.payments USING btree (booking_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (TRIM(BOTH FROM idempotency_key) <> ''''::text))'
THEN 1 ELSE 0 END;
"#;

const PAYMENT_IDEMPOTENCY_UPGRADE: &str = r#"
BEGIN;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS idempotency_key character varying(160),
    ADD COLUMN IF NOT EXISTS idempotency_fingerprint character varying(64);
ALTER TABLE public.payments
    ALTER COLUMN idempotency_key TYPE character varying(160),
    ALTER COLUMN idempotency_key DROP NOT NULL,
    ALTER COLUMN idempotency_fingerprint TYPE character varying(64),
    ALTER COLUMN idempotency_fingerprint DROP NOT NULL;

ALTER TABLE public.customer_ledger_payments
    ADD COLUMN IF NOT EXISTS idempotency_key character varying(160),
    ADD COLUMN IF NOT EXISTS idempotency_fingerprint character varying(64);
ALTER TABLE public.customer_ledger_payments
    ALTER COLUMN idempotency_key TYPE character varying(160),
    ALTER COLUMN idempotency_key DROP NOT NULL,
    ALTER COLUMN idempotency_fingerprint TYPE character varying(64),
    ALTER COLUMN idempotency_fingerprint DROP NOT NULL;

DROP INDEX IF EXISTS public.idx_customer_ledger_payments_receipt_unique;
CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique
    ON public.customer_ledger_payments USING btree
    (ledger_id, lower(TRIM(BOTH FROM receipt_number)))
    WHERE receipt_number IS NOT NULL AND TRIM(BOTH FROM receipt_number) <> ''::text;

DROP INDEX IF EXISTS public.uq_ledger_payments_ledger_idempotency;
CREATE UNIQUE INDEX uq_ledger_payments_ledger_idempotency
    ON public.customer_ledger_payments USING btree (ledger_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND TRIM(BOTH FROM idempotency_key) <> ''::text;

DROP INDEX IF EXISTS public.uq_payments_booking_idempotency;
CREATE UNIQUE INDEX uq_payments_booking_idempotency
    ON public.payments USING btree (booking_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND TRIM(BOTH FROM idempotency_key) <> ''::text;

COMMIT;
"#;

pub(super) struct PsqlConnection {
    pub(super) host: String,
    pub(super) port: u16,
    pub(super) user: String,
    pub(super) database: String,
    pub(super) password: String,
}

impl PsqlConnection {
    pub(super) fn new(
        host: impl Into<String>,
        port: u16,
        user: impl Into<String>,
        database: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            user: user.into(),
            database: database.into(),
            password: password.into(),
        }
    }
}

/// Bring an existing desktop V1 database up to the payment-idempotency shape
/// bundled in the current V1 baseline. This deliberately remains a narrow,
/// same-generation compatibility upgrade rather than a second migration.
pub(super) async fn apply_v1_payment_idempotency_upgrade(
    psql_path: &Path,
    connection: &PsqlConnection,
) -> Result<(), PostgresError> {
    let current = run_psql(
        psql_path,
        connection,
        "psql inspect V1 payment idempotency schema",
        &["-tAc", PAYMENT_IDEMPOTENCY_SCHEMA_CURRENT],
    )
    .await?;

    if String::from_utf8_lossy(&current.stdout).trim() == "1" {
        return Ok(());
    }

    run_psql(
        psql_path,
        connection,
        "psql upgrade V1 payment idempotency schema",
        &["-v", "ON_ERROR_STOP=1", "-c", PAYMENT_IDEMPOTENCY_UPGRADE],
    )
    .await?;
    Ok(())
}

async fn run_psql(
    psql_path: &Path,
    connection: &PsqlConnection,
    label: &str,
    arguments: &[&str],
) -> Result<std::process::Output, PostgresError> {
    if psql_path.components().count() > 1 && !psql_path.exists() {
        return Err(PostgresError::BinaryNotFound(
            psql_path.to_string_lossy().to_string(),
        ));
    }

    let pgsql_bin = psql_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty());
    let mut command = tokio::process::Command::new(psql_path);
    command.args([
        "-h",
        &connection.host,
        "-p",
        &connection.port.to_string(),
        "-U",
        &connection.user,
        "-d",
        &connection.database,
    ]);
    command
        .args(arguments)
        .env("PGPASSWORD", &connection.password)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(pgsql_bin) = pgsql_bin {
        let current_path = std::env::var("PATH").unwrap_or_default();
        command
            .env(
                "PATH",
                format!(
                    "{}{}{}",
                    pgsql_bin.to_string_lossy(),
                    PATH_SEP,
                    current_path
                ),
            )
            .current_dir(pgsql_bin);
    }

    #[cfg(windows)]
    command.creation_flags(super::CREATE_NO_WINDOW);

    let output = command.output().await?;
    if !output.status.success() {
        let details = command_output_details(label, &output);
        log::error!("{} failed: {}", label, details);
        return Err(PostgresError::MigrationFailed(format!(
            "{} failed: {}",
            label, details
        )));
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::{apply_v1_payment_idempotency_upgrade, PsqlConnection};
    use std::path::{Path, PathBuf};
    use std::process::Stdio;

    fn live_connection(database_env: &str) -> Option<(PathBuf, PsqlConnection)> {
        let database = std::env::var(database_env).ok()?;
        let psql_path = std::env::var_os("DESKTOP_TEST_PSQL")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("psql"));
        let connection = PsqlConnection {
            host: std::env::var("DESKTOP_TEST_PGHOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("DESKTOP_TEST_PGPORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(5432),
            user: std::env::var("DESKTOP_TEST_PGUSER").unwrap_or_else(|_| "postgres".to_string()),
            database,
            password: std::env::var("DESKTOP_TEST_PGPASSWORD").unwrap_or_default(),
        };
        Some((psql_path, connection))
    }

    async fn scalar(psql_path: &Path, connection: &PsqlConnection, sql: &str) -> String {
        let output = tokio::process::Command::new(psql_path)
            .args([
                "-h",
                &connection.host,
                "-p",
                &connection.port.to_string(),
                "-U",
                &connection.user,
                "-d",
                &connection.database,
                "-tAc",
                sql,
            ])
            .env("PGPASSWORD", &connection.password)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .expect("psql catalog query must run");
        assert!(
            output.status.success(),
            "psql catalog query failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[tokio::test]
    async fn existing_v1_payment_schema_upgrade_is_idempotent_on_live_postgres() {
        let Some((psql_path, connection)) = live_connection("DESKTOP_TEST_V1_DATABASE") else {
            return;
        };

        apply_v1_payment_idempotency_upgrade(&psql_path, &connection)
            .await
            .expect("first V1 compatibility upgrade must succeed");

        let receipt_index_oid = scalar(
            &psql_path,
            &connection,
            "SELECT indexrelid::text FROM pg_index JOIN pg_class ON pg_class.oid = indexrelid JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'idx_customer_ledger_payments_receipt_unique';",
        )
        .await;

        apply_v1_payment_idempotency_upgrade(&psql_path, &connection)
            .await
            .expect("second V1 compatibility upgrade must succeed");

        assert_eq!(
            scalar(
                &psql_path,
                &connection,
                "SELECT string_agg(table_name || '.' || column_name || '=' || data_type || '(' || character_maximum_length || '),nullable=' || is_nullable, E'\\n' ORDER BY table_name, column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('payments', 'customer_ledger_payments') AND column_name IN ('idempotency_key', 'idempotency_fingerprint');",
            )
            .await,
            "customer_ledger_payments.idempotency_fingerprint=character varying(64),nullable=YES\ncustomer_ledger_payments.idempotency_key=character varying(160),nullable=YES\npayments.idempotency_fingerprint=character varying(64),nullable=YES\npayments.idempotency_key=character varying(160),nullable=YES"
        );

        let index_definitions = scalar(
            &psql_path,
            &connection,
            "SELECT string_agg(indexname || '=' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_customer_ledger_payments_receipt_unique', 'uq_ledger_payments_ledger_idempotency', 'uq_payments_booking_idempotency');",
        )
        .await;
        assert_eq!(
            index_definitions,
            "idx_customer_ledger_payments_receipt_unique=CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique ON public.customer_ledger_payments USING btree (ledger_id, lower(TRIM(BOTH FROM receipt_number))) WHERE ((receipt_number IS NOT NULL) AND (TRIM(BOTH FROM receipt_number) <> ''::text))\nuq_ledger_payments_ledger_idempotency=CREATE UNIQUE INDEX uq_ledger_payments_ledger_idempotency ON public.customer_ledger_payments USING btree (ledger_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (TRIM(BOTH FROM idempotency_key) <> ''::text))\nuq_payments_booking_idempotency=CREATE UNIQUE INDEX uq_payments_booking_idempotency ON public.payments USING btree (booking_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (TRIM(BOTH FROM idempotency_key) <> ''::text))"
        );
        assert_eq!(
            scalar(
                &psql_path,
                &connection,
                "SELECT indexrelid::text FROM pg_index JOIN pg_class ON pg_class.oid = indexrelid JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'idx_customer_ledger_payments_receipt_unique';",
            )
            .await,
            receipt_index_oid,
            "the second upgrade must not rebuild an already-current receipt index"
        );
    }

    #[tokio::test]
    async fn v1_payment_schema_upgrade_propagates_ddl_failures() {
        let Some((psql_path, connection)) = live_connection("DESKTOP_TEST_EMPTY_DATABASE") else {
            return;
        };

        let error = apply_v1_payment_idempotency_upgrade(&psql_path, &connection)
            .await
            .expect_err("an empty database must not hide failed V1 DDL");
        assert!(error.to_string().contains("payments"));
    }
}
