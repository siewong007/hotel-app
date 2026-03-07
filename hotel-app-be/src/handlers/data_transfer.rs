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
    #[serde(default)]
    pub user_guests: Vec<Value>,
    #[serde(default)]
    pub rooms: Vec<Value>,
    #[serde(default)]
    pub room_types: Vec<Value>,
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

    let guests = query_table(&pool, "SELECT * FROM guests ORDER BY id").await?;
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
    let user_guests = query_table(&pool, "SELECT * FROM user_guests ORDER BY id").await?;
    let room_types = query_table(&pool, "SELECT * FROM room_types ORDER BY id").await?;
    let rooms = query_table(&pool, "SELECT * FROM rooms ORDER BY id").await?;

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
        user_guests,
        rooms,
        room_types,
    }))
}

/// Import or overwrite booking-related data
pub async fn import_booking_data_handler(
    State(pool): State<DbPool>,
    Json(request): Json<ImportRequest>,
) -> Result<Json<Value>, ApiError> {
    let data = request.data;
    let is_overwrite = request.mode == ImportMode::Overwrite;

    // Tables managed by this data transfer (in delete order - reverse dependency)
    let mut managed_tables = vec![
        "night_audit_details", "night_audit_runs",
        "customer_ledger_payments", "customer_ledgers",
        "room_changes", "booking_history", "booking_modifications",
        "booking_guests", "invoices", "payments", "bookings",
        "guest_complimentary_credits", "companies",
        "user_guests", "guests",
    ];
    if !data.rooms.is_empty() {
        managed_tables.push("rooms");
        managed_tables.push("room_types");
    }

    if is_overwrite {
        // Phase 1: Delete all data in a transaction
        let mut tx = pool.begin().await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        for table in &managed_tables {
            sqlx::query(&format!("DELETE FROM {}", table))
                .execute(&mut *tx).await
                .map_err(|e| ApiError::Database(e.to_string()))?;
        }
        tx.commit().await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        log::info!("Phase 1: All managed tables cleared");
    }

    // Columns that are GENERATED ALWAYS AS in PostgreSQL and cannot be inserted
    let generated_columns: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::from([
        ("bookings", vec!["nights", "total_guests"]),
        ("customer_ledgers", vec!["balance_due"]),
    ]);

    let mut counts = serde_json::Map::new();

    // Phase 2: Insert data directly on pool (auto-commit per statement)
    // Each INSERT uses ON CONFLICT DO NOTHING; FK violations are caught and skipped
    let empty_skip: Vec<&str> = vec![];
    let tables_and_data: Vec<(&str, &[Value])> = vec![
        ("room_types", &data.room_types),
        ("rooms", &data.rooms),
        ("guests", &data.guests),
        ("user_guests", &data.user_guests),
        ("guest_complimentary_credits", &data.guest_complimentary_credits),
        ("companies", &data.companies),
        ("bookings", &data.bookings),
        ("payments", &data.payments),
        ("invoices", &data.invoices),
        ("booking_guests", &data.booking_guests),
        ("booking_modifications", &data.booking_modifications),
        ("booking_history", &data.booking_history),
        ("night_audit_runs", &data.night_audit_runs),
        ("night_audit_details", &data.night_audit_details),
        ("customer_ledgers", &data.customer_ledgers),
        ("customer_ledger_payments", &data.customer_ledger_payments),
        ("room_changes", &data.room_changes),
    ];

    for (table, rows) in &tables_and_data {
        let skip = generated_columns.get(table).unwrap_or(&empty_skip);
        let mut inserted = 0usize;
        for row in *rows {
            let obj = match row.as_object() {
                Some(o) => o,
                None => continue,
            };

            let columns: Vec<&str> = obj.keys()
                .map(|k| k.as_str())
                .filter(|k| !skip.contains(k))
                .collect();

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

            match sqlx::query(&insert_sql).execute(&pool).await {
                Ok(result) => {
                    if result.rows_affected() > 0 {
                        inserted += 1;
                    }
                }
                Err(e) => {
                    log::warn!("Failed to insert row into {}: {}", table, e);
                }
            }
        }
        counts.insert((*table).into(), Value::Number(inserted.into()));
        if inserted > 0 {
            log::info!("Inserted {} rows into {}", inserted, table);
        }
    }

    // Reset sequences to max id + 1 for each table
    let tables_with_sequences = [
        "room_types", "rooms",
        "guests", "user_guests", "guest_complimentary_credits", "companies", "bookings",
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
        let _ = sqlx::query(&reset_sql).execute(&pool).await;
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "mode": if is_overwrite { "overwrite" } else { "import" },
        "records_imported": counts,
    })))
}
