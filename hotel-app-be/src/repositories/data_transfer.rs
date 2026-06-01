//! Data-transfer persistence helpers

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::core::db::DbPool;
use crate::core::error::ApiError;

pub struct DataTransferRepository;

impl DataTransferRepository {
    pub async fn export_table(pool: &DbPool, table: &str) -> Result<Vec<Value>, ApiError> {
        Self::export_query(pool, &format!("SELECT * FROM {} ORDER BY id", table)).await
    }

    pub async fn export_query(pool: &DbPool, query: &str) -> Result<Vec<Value>, ApiError> {
        let rows: Vec<(Value,)> =
            sqlx::query_as(&format!("SELECT row_to_json(t) FROM ({}) t", query))
                .fetch_all(pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows.into_iter().map(|row| row.0).collect())
    }

    pub async fn clear_tables(pool: &DbPool, tables: &[&str]) -> Result<(), ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        for table in tables {
            sqlx::query(&format!("DELETE FROM {}", table))
                .execute(&mut *tx)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn existing_user_ids(pool: &DbPool) -> HashSet<i64> {
        sqlx::query_scalar::<_, i64>("SELECT id FROM users")
            .fetch_all(pool)
            .await
            .unwrap_or_default()
            .into_iter()
            .collect()
    }

    pub async fn table_columns(
        pool: &DbPool,
        table_names: &[&str],
    ) -> HashMap<String, HashSet<String>> {
        let mut table_columns = HashMap::new();

        for table_name in table_names {
            let cols: Vec<(String,)> = sqlx::query_as(
                "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
            )
            .bind(*table_name)
            .fetch_all(pool)
            .await
            .unwrap_or_default();

            table_columns.insert(
                (*table_name).to_string(),
                cols.into_iter().map(|row| row.0).collect(),
            );
        }

        table_columns
    }

    pub async fn set_user_triggers(pool: &DbPool, tables: &[&str], enabled: bool) {
        let action = if enabled { "ENABLE" } else { "DISABLE" };
        for table in tables {
            let _ = sqlx::query(&format!("ALTER TABLE {} {} TRIGGER USER", table, action))
                .execute(pool)
                .await;
        }
    }

    pub async fn insert_json_row(
        pool: &DbPool,
        table: &str,
        row: &serde_json::Map<String, Value>,
        skip_columns: &[&str],
        valid_columns: Option<&HashSet<String>>,
        user_fk_columns: &[&str],
        existing_user_ids: &HashSet<i64>,
    ) -> Result<u64, sqlx::Error> {
        let columns: Vec<&str> = row
            .keys()
            .map(|key| key.as_str())
            .filter(|key| !skip_columns.contains(key))
            .filter(|key| valid_columns.is_none_or(|cols| cols.contains(*key)))
            .collect();

        let value_strs = columns
            .iter()
            .map(|column| {
                sql_value_literal(
                    &row[*column],
                    user_fk_columns.contains(column),
                    existing_user_ids,
                )
            })
            .collect::<Vec<_>>();

        let insert_sql = format!(
            "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT DO NOTHING",
            table,
            columns.join(", "),
            value_strs.join(", ")
        );

        sqlx::query(&insert_sql)
            .execute(pool)
            .await
            .map(|result| result.rows_affected())
    }

    pub async fn reset_sequences(pool: &DbPool, tables: &[&str]) {
        for table in tables {
            let seq_name = format!("{}_id_seq", table);
            let reset_sql = format!(
                "SELECT setval('{}', COALESCE((SELECT MAX(id) FROM {}), 0) + 1, false)",
                seq_name, table
            );
            let _ = sqlx::query(&reset_sql).execute(pool).await;
        }
    }
}

fn sql_value_literal(
    value: &Value,
    is_user_fk_column: bool,
    existing_user_ids: &HashSet<i64>,
) -> String {
    if is_user_fk_column
        && let Value::Number(number) = value
        && let Some(id) = number.as_i64()
        && !existing_user_ids.contains(&id)
    {
        return "NULL".to_string();
    }

    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => format!("'{}'", value.replace('\'', "''")),
        Value::Object(_) | Value::Array(_) => {
            format!("'{}'::jsonb", value.to_string().replace('\'', "''"))
        }
    }
}
