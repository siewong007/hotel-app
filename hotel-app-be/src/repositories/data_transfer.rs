//! Data-transfer persistence helpers

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;

pub struct DataTransferRepository;

pub struct ImportRowPolicy<'a> {
    pub skip_columns: &'a HashSet<String>,
    pub valid_columns: Option<&'a HashSet<String>>,
    pub required_columns: Option<&'a HashSet<String>>,
    pub user_fk_columns: &'a HashSet<String>,
    pub audit_user_fk_columns: &'a [&'a str],
    pub existing_user_ids: &'a HashSet<i64>,
    pub fallback_user_id: i64,
}

impl DataTransferRepository {
    pub async fn count_table(pool: &DbPool, table: &str) -> Result<i64, ApiError> {
        let count = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {}", table))
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(count)
    }

    pub async fn export_table(pool: &DbPool, table: &str) -> Result<Vec<Value>, ApiError> {
        // Most tables have a serial `id`; composite-keyed tables are ordered by
        // their primary-key columns instead so export stays deterministic.
        let order_by = match table {
            "room_type_amenities" => "room_type_id, amenity_id",
            "room_status_transitions" => "from_status, to_status",
            _ => "id",
        };
        Self::export_query(
            pool,
            &format!("SELECT * FROM {} ORDER BY {}", table, order_by),
        )
        .await
    }

    pub async fn export_query(pool: &DbPool, query: &str) -> Result<Vec<Value>, ApiError> {
        let rows: Vec<(Value,)> =
            sqlx::query_as(&format!("SELECT row_to_json(t) FROM ({}) t", query))
                .fetch_all(pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows.into_iter().map(|row| row.0).collect())
    }

    pub async fn clear_tables(tx: &mut DbTransaction<'_>, tables: &[&str]) -> Result<(), ApiError> {
        for table in tables {
            sqlx::query(&format!("DELETE FROM {}", table))
                .execute(&mut **tx)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        Ok(())
    }

    pub async fn existing_user_ids(pool: &DbPool) -> Result<HashSet<i64>, ApiError> {
        let user_ids = sqlx::query_scalar::<_, i64>("SELECT id FROM users")
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?
            .into_iter()
            .collect();

        Ok(user_ids)
    }

    pub async fn table_columns(
        pool: &DbPool,
        table_names: &[&str],
    ) -> Result<HashMap<String, HashSet<String>>, ApiError> {
        let mut table_columns = HashMap::new();

        for table_name in table_names {
            let cols: Vec<(String,)> = sqlx::query_as(
                "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
            )
            .bind(*table_name)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

            table_columns.insert(
                (*table_name).to_string(),
                cols.into_iter().map(|row| row.0).collect(),
            );
        }

        Ok(table_columns)
    }

    pub async fn required_columns(
        pool: &DbPool,
        table_names: &[&str],
    ) -> Result<HashMap<String, HashSet<String>>, ApiError> {
        let mut required_columns = HashMap::new();

        for table_name in table_names {
            let cols: Vec<(String,)> = sqlx::query_as(
                "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' AND is_nullable = 'NO'",
            )
            .bind(*table_name)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

            required_columns.insert(
                (*table_name).to_string(),
                cols.into_iter().map(|row| row.0).collect(),
            );
        }

        Ok(required_columns)
    }

    pub async fn user_fk_columns(
        pool: &DbPool,
        table_names: &[&str],
    ) -> Result<HashMap<String, HashSet<String>>, ApiError> {
        let mut user_fk_columns = HashMap::new();

        for table_name in table_names {
            let cols: Vec<(String,)> = sqlx::query_as(
                r#"
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON ccu.constraint_name = tc.constraint_name
                 AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_schema = 'public'
                  AND tc.table_name = $1
                  AND ccu.table_schema = 'public'
                  AND ccu.table_name = 'users'
                "#,
            )
            .bind(*table_name)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

            user_fk_columns.insert(
                (*table_name).to_string(),
                cols.into_iter().map(|row| row.0).collect(),
            );
        }

        Ok(user_fk_columns)
    }

    pub async fn generated_columns(
        pool: &DbPool,
        table_names: &[&str],
    ) -> Result<HashMap<String, HashSet<String>>, ApiError> {
        let mut generated_columns = HashMap::new();

        for table_name in table_names {
            let cols: Vec<(String,)> = sqlx::query_as(
                "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' AND is_generated <> 'NEVER'",
            )
            .bind(*table_name)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

            generated_columns.insert(
                (*table_name).to_string(),
                cols.into_iter().map(|row| row.0).collect(),
            );
        }

        Ok(generated_columns)
    }

    pub async fn set_user_triggers(
        tx: &mut DbTransaction<'_>,
        tables: &[&str],
        enabled: bool,
    ) -> Result<(), ApiError> {
        let action = if enabled { "ENABLE" } else { "DISABLE" };
        for table in tables {
            sqlx::query(&format!("ALTER TABLE {} {} TRIGGER USER", table, action))
                .execute(&mut **tx)
                .await
                .map_err(ApiError::from)?;
        }

        Ok(())
    }

    pub async fn align_status_constraints(tx: &mut DbTransaction<'_>) -> Result<(), ApiError> {
        let statements = [
            "ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check",
            "UPDATE bookings SET status = 'voided' WHERE status = 'cancelled'",
            "UPDATE bookings SET status = 'comp_void' WHERE status = 'comp_cancelled'",
            r#"
            ALTER TABLE bookings
                ADD CONSTRAINT bookings_status_check
                CHECK (status IN (
                    'pending', 'confirmed', 'checked_in', 'auto_checked_in', 'checked_out',
                    'no_show', 'completed', 'comp_void',
                    'partial_complimentary', 'fully_complimentary', 'voided'
                ))
            "#,
            "ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check",
            "UPDATE bookings SET payment_status = 'void' WHERE payment_status = 'cancelled'",
            r#"
            ALTER TABLE bookings
                ADD CONSTRAINT bookings_payment_status_check
                CHECK (payment_status IN (
                    'unpaid', 'unpaid_deposit', 'paid_rate', 'partial', 'paid', 'refunded', 'void'
                ))
            "#,
            "ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check",
            "UPDATE payments SET status = 'void' WHERE status = 'cancelled'",
            r#"
            ALTER TABLE payments
                ADD CONSTRAINT payments_status_check
                CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'void'))
            "#,
            "ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check",
            "UPDATE invoices SET status = 'void' WHERE status = 'cancelled'",
            r#"
            ALTER TABLE invoices
                ADD CONSTRAINT invoices_status_check
                CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void', 'refunded'))
            "#,
            "ALTER TABLE customer_ledgers DROP CONSTRAINT IF EXISTS valid_status",
            "ALTER TABLE customer_ledgers DROP CONSTRAINT IF EXISTS customer_ledgers_status_check",
            "UPDATE customer_ledgers SET status = 'void' WHERE status = 'cancelled'",
            r#"
            ALTER TABLE customer_ledgers
                ADD CONSTRAINT valid_status
                CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'void'))
            "#,
        ];

        for statement in statements {
            sqlx::query(statement)
                .execute(&mut **tx)
                .await
                .map_err(ApiError::from)?;
        }

        Ok(())
    }

    pub async fn insert_json_row(
        tx: &mut DbTransaction<'_>,
        table: &str,
        row: &serde_json::Map<String, Value>,
        policy: ImportRowPolicy<'_>,
    ) -> Result<u64, ApiError> {
        let prepared = prepare_import_row(table, row, &policy)?;

        if prepared.columns.is_empty() {
            return Ok(0);
        }

        let column_list = prepared
            .columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let quoted_table = quote_identifier(table);

        let insert_sql = format!(
            "INSERT INTO {quoted_table} ({column_list}) SELECT {column_list} FROM jsonb_populate_record(NULL::{quoted_table}, $1::jsonb) ON CONFLICT DO NOTHING"
        );

        sqlx::query(&insert_sql)
            .bind(Value::Object(prepared.values))
            .execute(&mut **tx)
            .await
            .map(|result| result.rows_affected())
            .map_err(ApiError::from)
    }

    pub async fn reset_sequences(
        tx: &mut DbTransaction<'_>,
        tables: &[&str],
    ) -> Result<(), ApiError> {
        for table in tables {
            let reset_sql = reset_sequence_sql(table);
            sqlx::query(&reset_sql)
                .execute(&mut **tx)
                .await
                .map_err(ApiError::from)?;
        }

        Ok(())
    }
}

struct PreparedImportRow {
    columns: Vec<String>,
    values: serde_json::Map<String, Value>,
}

fn prepare_import_row(
    table: &str,
    row: &serde_json::Map<String, Value>,
    policy: &ImportRowPolicy<'_>,
) -> Result<PreparedImportRow, ApiError> {
    let mut columns = Vec::new();
    let mut values = serde_json::Map::new();

    for (key, value) in row {
        if policy.skip_columns.contains(key)
            || policy.valid_columns.is_some_and(|cols| !cols.contains(key))
        {
            continue;
        }

        let mut import_value = value.clone();
        if policy.user_fk_columns.contains(key) {
            import_value = normalize_user_fk_value(
                table,
                key,
                value,
                policy.required_columns,
                policy.audit_user_fk_columns,
                policy.existing_user_ids,
                policy.fallback_user_id,
            )?;
        }

        columns.push(key.clone());
        values.insert(key.clone(), import_value);
    }

    Ok(PreparedImportRow { columns, values })
}

fn normalize_user_fk_value(
    table: &str,
    column: &str,
    value: &Value,
    required_columns: Option<&HashSet<String>>,
    audit_user_fk_columns: &[&str],
    existing_user_ids: &HashSet<i64>,
    fallback_user_id: i64,
) -> Result<Value, ApiError> {
    let Some(user_id) = value_as_i64(value) else {
        return Ok(value.clone());
    };

    if existing_user_ids.contains(&user_id) {
        return Ok(value.clone());
    }

    let is_required = required_columns.is_some_and(|columns| columns.contains(column));
    if is_required {
        if audit_user_fk_columns.contains(&column) {
            return Ok(Value::Number(fallback_user_id.into()));
        }

        return Err(ApiError::BadRequest(format!(
            "{}.{} references user id {}, but that user does not exist in this database",
            table, column, user_id
        )));
    }

    Ok(Value::Null)
}

fn value_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn reset_sequence_sql(table: &str) -> String {
    let quoted_table = quote_identifier(table);
    let table_regclass = quote_literal(&format!("public.{table}"));
    let table_name = quote_literal(table);
    let max_id_query = quote_literal(&format!("SELECT MAX(id)::bigint FROM {quoted_table}"));

    format!(
        r#"
        DO $$
        DECLARE
            sequence_name text;
            max_id bigint;
        BEGIN
            SELECT COALESCE(
                pg_get_serial_sequence({table_regclass}, 'id'),
                (
                    SELECT substring(column_default FROM 'nextval\(''([^'']+)''::regclass\)')
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = {table_name}
                      AND column_name = 'id'
                )
            ) INTO sequence_name;

            IF sequence_name IS NULL THEN
                RETURN;
            END IF;

            EXECUTE {max_id_query} INTO max_id;

            IF max_id IS NULL THEN
                PERFORM setval(sequence_name::regclass, 1, false);
            ELSE
                PERFORM setval(sequence_name::regclass, GREATEST(max_id, 1), true);
            END IF;
        END $$;
        "#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prepare_import_row_skips_generated_and_unknown_columns() {
        let row = serde_json::Map::from_iter([
            ("id".to_string(), json!(1)),
            ("nights".to_string(), json!(2)),
            ("unknown".to_string(), json!("ignored")),
        ]);
        let skip_columns = HashSet::from(["nights".to_string()]);
        let valid_columns = HashSet::from(["id".to_string(), "nights".to_string()]);
        let empty_user_fk_columns = HashSet::new();
        let existing_user_ids = HashSet::new();
        let policy = ImportRowPolicy {
            skip_columns: &skip_columns,
            valid_columns: Some(&valid_columns),
            required_columns: None,
            user_fk_columns: &empty_user_fk_columns,
            audit_user_fk_columns: &[],
            existing_user_ids: &existing_user_ids,
            fallback_user_id: 42,
        };
        let prepared = prepare_import_row("bookings", &row, &policy).expect("row should prepare");

        assert_eq!(prepared.columns, vec!["id"]);
        assert_eq!(prepared.values.get("id"), Some(&json!(1)));
        assert!(!prepared.values.contains_key("nights"));
        assert!(!prepared.values.contains_key("unknown"));
    }

    #[test]
    fn prepare_import_row_nulls_missing_nullable_user_reference() {
        let row = serde_json::Map::from_iter([("created_by".to_string(), json!(1000))]);
        let user_fk_columns = HashSet::from(["created_by".to_string()]);
        let skip_columns = HashSet::new();
        let required_columns = HashSet::new();
        let existing_user_ids = HashSet::from([7]);
        let policy = ImportRowPolicy {
            skip_columns: &skip_columns,
            valid_columns: None,
            required_columns: Some(&required_columns),
            user_fk_columns: &user_fk_columns,
            audit_user_fk_columns: &["created_by"],
            existing_user_ids: &existing_user_ids,
            fallback_user_id: 7,
        };
        let prepared = prepare_import_row("guests", &row, &policy)
            .expect("nullable user reference should be nulled");

        assert_eq!(prepared.values.get("created_by"), Some(&Value::Null));
    }

    #[test]
    fn prepare_import_row_remaps_missing_required_audit_user_reference() {
        let row = serde_json::Map::from_iter([("modified_by".to_string(), json!(1000))]);
        let required_columns = HashSet::from(["modified_by".to_string()]);
        let user_fk_columns = HashSet::from(["modified_by".to_string()]);
        let skip_columns = HashSet::new();
        let existing_user_ids = HashSet::from([7]);
        let policy = ImportRowPolicy {
            skip_columns: &skip_columns,
            valid_columns: None,
            required_columns: Some(&required_columns),
            user_fk_columns: &user_fk_columns,
            audit_user_fk_columns: &["modified_by"],
            existing_user_ids: &existing_user_ids,
            fallback_user_id: 7,
        };
        let prepared = prepare_import_row("booking_modifications", &row, &policy)
            .expect("required audit user reference should be remapped");

        assert_eq!(prepared.values.get("modified_by"), Some(&json!(7)));
    }

    #[test]
    fn prepare_import_row_rejects_missing_required_non_audit_user_reference() {
        let row = serde_json::Map::from_iter([("user_id".to_string(), json!(1000))]);
        let required_columns = HashSet::from(["user_id".to_string()]);
        let user_fk_columns = HashSet::from(["user_id".to_string()]);
        let skip_columns = HashSet::new();
        let existing_user_ids = HashSet::from([7]);
        let policy = ImportRowPolicy {
            skip_columns: &skip_columns,
            valid_columns: None,
            required_columns: Some(&required_columns),
            user_fk_columns: &user_fk_columns,
            audit_user_fk_columns: &["created_by"],
            existing_user_ids: &existing_user_ids,
            fallback_user_id: 7,
        };
        let result = prepare_import_row("user_guests", &row, &policy);

        assert!(result.is_err());
    }

    #[test]
    fn reset_sequence_sql_falls_back_to_nextval_default_when_sequence_is_not_owned() {
        let sql = reset_sequence_sql("payments");

        assert!(sql.contains("pg_get_serial_sequence('public.payments', 'id')"));
        assert!(sql.contains("substring(column_default FROM"));
        assert!(sql.contains("table_name = 'payments'"));
        assert!(sql.contains("EXECUTE 'SELECT MAX(id)::bigint FROM \"payments\"' INTO max_id"));
        assert!(sql.contains("PERFORM setval(sequence_name::regclass, GREATEST(max_id, 1), true)"));
        assert!(sql.contains("IF sequence_name IS NULL THEN"));
    }

    #[test]
    fn reset_sequence_sql_quotes_table_names() {
        let sql = reset_sequence_sql("odd'table");

        assert!(sql.contains("pg_get_serial_sequence('public.odd''table', 'id')"));
        assert!(sql.contains("table_name = 'odd''table'"));
        assert!(sql.contains("FROM \"odd''table\""));
    }
}
