//! Data transfer handlers for export/import/overwrite of booking-related data

use axum::{
    extract::State,
    response::Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::core::db::DbPool;
use crate::core::error::ApiError;

/// Represents all booking-related data for export/import
#[derive(Debug, Serialize, Deserialize)]
pub struct BookingDataExport {
    pub version: String,
    pub exported_at: String,
    pub guests: Vec<Value>,
    pub guest_complimentary_credits: Vec<Value>,
    pub companies: Vec<Value>,
    pub bookings: Vec<Value>,
    pub payments: Vec<Value>,
    pub invoices: Vec<Value>,
    pub booking_guests: Vec<Value>,
    pub booking_modifications: Vec<Value>,
    pub booking_history: Vec<Value>,
    pub night_audit_runs: Vec<Value>,
    pub night_audit_details: Vec<Value>,
    pub customer_ledgers: Vec<Value>,
    pub customer_ledger_payments: Vec<Value>,
    pub room_changes: Vec<Value>,
}

/// Import mode
#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub mode: ImportMode,
    pub data: BookingDataExport,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    /// Append new records (skip duplicates by booking_number)
    Import,
    /// Delete all existing booking data and replace with imported data
    Overwrite,
}

/// Export all booking-related data
pub async fn export_booking_data_handler(
    State(pool): State<DbPool>,
) -> Result<Json<BookingDataExport>, ApiError> {
    // Helper to query a table and return as Vec<Value>
    async fn query_table(pool: &DbPool, query: &str) -> Result<Vec<Value>, ApiError> {
        let rows: Vec<(Value,)> = sqlx::query_as(
            &format!("SELECT row_to_json(t) FROM ({}) t", query)
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    let guests = query_table(&pool, "SELECT * FROM guests WHERE deleted_at IS NULL ORDER BY id").await?;
    let guest_complimentary_credits = query_table(&pool, "SELECT * FROM guest_complimentary_credits ORDER BY id").await?;
    let companies = query_table(&pool, "SELECT * FROM companies ORDER BY id").await?;
    let bookings = query_table(&pool, "SELECT * FROM bookings ORDER BY id").await?;
    let payments = query_table(&pool, "SELECT * FROM payments ORDER BY id").await?;
    let invoices = query_table(&pool, "SELECT * FROM invoices ORDER BY id").await?;
    let booking_guests = query_table(&pool, "SELECT * FROM booking_guests ORDER BY id").await?;
    let booking_modifications = query_table(&pool, "SELECT * FROM booking_modifications ORDER BY id").await?;
    let booking_history = query_table(&pool, "SELECT * FROM booking_history ORDER BY id").await?;
    let night_audit_runs = query_table(&pool, "SELECT * FROM night_audit_runs ORDER BY id").await?;
    let night_audit_details = query_table(&pool, "SELECT * FROM night_audit_details ORDER BY id").await?;
    let customer_ledgers = query_table(&pool, "SELECT * FROM customer_ledgers ORDER BY id").await?;
    let customer_ledger_payments = query_table(&pool, "SELECT * FROM customer_ledger_payments ORDER BY id").await?;
    let room_changes = query_table(&pool, "SELECT * FROM room_changes ORDER BY id").await?;

    Ok(Json(BookingDataExport {
        version: "1.0".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        guests,
        guest_complimentary_credits,
        companies,
        bookings,
        payments,
        invoices,
        booking_guests,
        booking_modifications,
        booking_history,
        night_audit_runs,
        night_audit_details,
        customer_ledgers,
        customer_ledger_payments,
        room_changes,
    }))
}

/// Import or overwrite booking-related data
pub async fn import_booking_data_handler(
    State(pool): State<DbPool>,
    Json(request): Json<ImportRequest>,
) -> Result<Json<Value>, ApiError> {
    let data = request.data;
    let is_overwrite = request.mode == ImportMode::Overwrite;

    // Use a transaction for atomicity
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if is_overwrite {
        // Delete in reverse dependency order
        sqlx::query("DELETE FROM night_audit_details").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM night_audit_runs").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM customer_ledger_payments").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM customer_ledgers").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM room_changes").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM booking_history").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM booking_modifications").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM booking_guests").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM invoices").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM payments").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM bookings").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM guest_complimentary_credits").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM companies").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        // For overwrite, also clear guests so imported guests replace them
        sqlx::query("DELETE FROM user_guests").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        sqlx::query("DELETE FROM guests").execute(&mut *tx).await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    let mut counts = serde_json::Map::new();

    // Helper macro for inserting JSON rows into a table
    // For each row, we dynamically build INSERT from the JSON keys
    async fn insert_rows(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, table: &str, rows: &[Value]) -> Result<usize, ApiError> {
        let mut inserted = 0;
        for row in rows {
            let obj = match row.as_object() {
                Some(o) => o,
                None => continue,
            };

            let columns: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
            let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("${}", i)).collect();

            let sql = format!(
                "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT DO NOTHING",
                table,
                columns.join(", "),
                placeholders.join(", ")
            );

            // Build query with dynamic bindings using raw SQL approach
            // We'll use a simpler approach: build a complete SQL statement with literal values
            let mut value_strs: Vec<String> = Vec::new();
            for col in &columns {
                let val = &obj[*col];
                match val {
                    Value::Null => value_strs.push("NULL".to_string()),
                    Value::Bool(b) => value_strs.push(b.to_string()),
                    Value::Number(n) => value_strs.push(n.to_string()),
                    Value::String(s) => value_strs.push(format!("'{}'", s.replace('\'', "''"))),
                    Value::Object(_) | Value::Array(_) => {
                        value_strs.push(format!("'{}'::jsonb", val.to_string().replace('\'', "''")))
                    }
                }
            }

            let insert_sql = format!(
                "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT DO NOTHING",
                table,
                columns.join(", "),
                value_strs.join(", ")
            );

            match sqlx::query(&insert_sql).execute(&mut **tx).await {
                Ok(result) => {
                    if result.rows_affected() > 0 {
                        inserted += 1;
                    }
                }
                Err(e) => {
                    log::warn!("Failed to insert row into {}: {} - SQL: {}", table, e, insert_sql);
                    // Continue with other rows
                }
            }
        }
        Ok(inserted)
    }

    // Insert in dependency order
    let n = insert_rows(&mut tx, "guests", &data.guests).await?;
    counts.insert("guests".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "guest_complimentary_credits", &data.guest_complimentary_credits).await?;
    counts.insert("guest_complimentary_credits".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "companies", &data.companies).await?;
    counts.insert("companies".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "bookings", &data.bookings).await?;
    counts.insert("bookings".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "payments", &data.payments).await?;
    counts.insert("payments".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "invoices", &data.invoices).await?;
    counts.insert("invoices".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "booking_guests", &data.booking_guests).await?;
    counts.insert("booking_guests".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "booking_modifications", &data.booking_modifications).await?;
    counts.insert("booking_modifications".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "booking_history", &data.booking_history).await?;
    counts.insert("booking_history".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "night_audit_runs", &data.night_audit_runs).await?;
    counts.insert("night_audit_runs".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "night_audit_details", &data.night_audit_details).await?;
    counts.insert("night_audit_details".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "customer_ledgers", &data.customer_ledgers).await?;
    counts.insert("customer_ledgers".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "customer_ledger_payments", &data.customer_ledger_payments).await?;
    counts.insert("customer_ledger_payments".into(), Value::Number(n.into()));

    let n = insert_rows(&mut tx, "room_changes", &data.room_changes).await?;
    counts.insert("room_changes".into(), Value::Number(n.into()));

    // Reset sequences to max id + 1 for each table
    let tables_with_sequences = [
        "guests", "guest_complimentary_credits", "companies", "bookings",
        "payments", "invoices", "booking_guests", "booking_modifications",
        "booking_history", "night_audit_runs", "night_audit_details",
        "customer_ledgers", "customer_ledger_payments", "room_changes",
    ];
    for table in &tables_with_sequences {
        let seq_name = format!("{}_id_seq", table);
        let reset_sql = format!(
            "SELECT setval('{}', COALESCE((SELECT MAX(id) FROM {}), 0) + 1, false)",
            seq_name, table
        );
        let _ = sqlx::query(&reset_sql).execute(&mut *tx).await;
    }

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "mode": if is_overwrite { "overwrite" } else { "import" },
        "records_imported": counts,
    })))
}
