//! Data-transfer workflows

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::constants::ImportMode;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{BookingDataExport, ImportRequest};
use crate::repositories::data_transfer::{DataTransferRepository, ImportRowPolicy};

const BASE_MANAGED_TABLES: &[&str] = &[
    "night_audit_details",
    "night_audit_runs",
    "customer_ledger_payments",
    "customer_ledgers",
    "room_changes",
    "booking_history",
    "booking_modifications",
    "booking_guests",
    "invoices",
    "payments",
    "bookings",
    "guest_complimentary_credits",
    "companies",
    "user_guests",
    "guests",
];

const ROOM_DEPENDENT_TABLES: &[&str] = &[
    "room_status_change_log",
    "room_history",
    "room_rates",
    "room_type_amenities",
    "room_status_transitions",
    "rooms",
    "room_types",
];

const ALL_IMPORT_TABLES: &[&str] = &[
    "room_types",
    "rooms",
    "guests",
    "user_guests",
    "guest_complimentary_credits",
    "companies",
    "bookings",
    "payments",
    "invoices",
    "booking_guests",
    "booking_modifications",
    "booking_history",
    "night_audit_runs",
    "night_audit_details",
    "customer_ledgers",
    "customer_ledger_payments",
    "room_changes",
];

const SEQUENCE_RESET_TABLES: &[&str] = &[
    "room_types",
    "rooms",
    "guests",
    "user_guests",
    "guest_complimentary_credits",
    "companies",
    "bookings",
    "payments",
    "invoices",
    "booking_guests",
    "night_audit_runs",
    "night_audit_details",
    "customer_ledgers",
    "customer_ledger_payments",
    "room_changes",
];

const TABLES_WITH_TRIGGERS: &[&str] = &[
    "bookings",
    "rooms",
    "guests",
    "customer_ledgers",
    "payments",
];

const AUDIT_USER_FK_COLUMNS: &[&str] = &[
    "created_by",
    "updated_by",
    "cancelled_by",
    "posted_by",
    "modified_by",
    "run_by",
    "changed_by",
    "processed_by",
    "cashier_id",
    "void_by",
    "delivered_by",
    "inspected_by",
    "assigned_to",
    "reported_by",
    "linked_by",
    "verified_by",
    "response_by",
];

pub async fn export_booking_data(pool: &DbPool) -> Result<BookingDataExport, ApiError> {
    Ok(BookingDataExport {
        version: "1.0".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        guests: export_table(pool, "guests").await?,
        guest_complimentary_credits: export_table(pool, "guest_complimentary_credits").await?,
        companies: export_table(pool, "companies").await?,
        bookings: export_table(pool, "bookings").await?,
        payments: export_table(pool, "payments").await?,
        invoices: export_table(pool, "invoices").await?,
        booking_guests: export_table(pool, "booking_guests").await?,
        booking_modifications: export_table(pool, "booking_modifications").await?,
        booking_history: export_table(pool, "booking_history").await?,
        night_audit_runs: export_table(pool, "night_audit_runs").await?,
        night_audit_details: export_table(pool, "night_audit_details").await?,
        customer_ledgers: export_table(pool, "customer_ledgers").await?,
        customer_ledger_payments: export_table(pool, "customer_ledger_payments").await?,
        room_changes: export_table(pool, "room_changes").await?,
        user_guests: export_table(pool, "user_guests").await?,
        room_types: export_table(pool, "room_types").await?,
        rooms: export_table(pool, "rooms").await?,
    })
}

pub async fn import_booking_data(
    pool: &DbPool,
    import_user_id: i64,
    request: ImportRequest,
) -> Result<Value, ApiError> {
    let data = request.data;
    let is_overwrite = request.mode == ImportMode::Overwrite;
    let managed_tables = managed_tables(data.rooms.is_empty());

    let mut generated_columns = base_generated_columns();
    let existing_user_ids = DataTransferRepository::existing_user_ids(pool).await?;
    let table_columns = DataTransferRepository::table_columns(pool, ALL_IMPORT_TABLES).await?;
    let required_columns =
        DataTransferRepository::required_columns(pool, ALL_IMPORT_TABLES).await?;
    let user_fk_columns = DataTransferRepository::user_fk_columns(pool, ALL_IMPORT_TABLES).await?;
    for (table, columns) in
        DataTransferRepository::generated_columns(pool, ALL_IMPORT_TABLES).await?
    {
        generated_columns.entry(table).or_default().extend(columns);
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    if is_overwrite {
        DataTransferRepository::clear_tables(&mut tx, &managed_tables).await?;
        log::info!("Phase 1: All managed tables cleared");
    }

    DataTransferRepository::align_status_constraints(&mut tx).await?;
    DataTransferRepository::set_user_triggers(&mut tx, TABLES_WITH_TRIGGERS, false).await?;

    let empty_skip = HashSet::new();
    let empty_columns = HashSet::new();
    let tables_and_data: Vec<(&str, &[Value])> = vec![
        ("room_types", &data.room_types),
        ("rooms", &data.rooms),
        ("guests", &data.guests),
        ("user_guests", &data.user_guests),
        (
            "guest_complimentary_credits",
            &data.guest_complimentary_credits,
        ),
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

    let mut counts = serde_json::Map::new();

    for (table, rows) in tables_and_data {
        let skip = generated_columns.get(table).unwrap_or(&empty_skip);
        let mut inserted = 0usize;

        for (row_index, row) in rows.iter().enumerate() {
            let Some(obj) = row.as_object() else {
                let message = format!(
                    "Import failed for table {} row {} because the row is not a JSON object. No changes were saved.",
                    table,
                    row_index + 1
                );
                log::warn!("{}", message);
                let _ = tx.rollback().await;
                return Err(ApiError::BadRequest(message));
            };

            match DataTransferRepository::insert_json_row(
                &mut tx,
                table,
                obj,
                ImportRowPolicy {
                    skip_columns: skip,
                    valid_columns: table_columns.get(table),
                    required_columns: required_columns.get(table),
                    user_fk_columns: user_fk_columns.get(table).unwrap_or(&empty_columns),
                    audit_user_fk_columns: AUDIT_USER_FK_COLUMNS,
                    existing_user_ids: &existing_user_ids,
                    fallback_user_id: import_user_id,
                },
            )
            .await
            {
                Ok(rows_affected) => {
                    if rows_affected > 0 {
                        inserted += 1;
                    }
                }
                Err(error) => {
                    let error_detail = import_error_detail(&error);
                    let message = format!(
                        "Import failed for table {} row {}{}: {}. No changes were saved.",
                        table,
                        row_index + 1,
                        row_reference(obj),
                        error_detail
                    );
                    log::warn!("{}", message);
                    let _ = tx.rollback().await;
                    return Err(ApiError::BadRequest(message));
                }
            }
        }

        counts.insert(table.into(), Value::Number(inserted.into()));
        if inserted > 0 {
            log::info!("Inserted {} rows into {}", inserted, table);
        }
    }

    DataTransferRepository::set_user_triggers(&mut tx, TABLES_WITH_TRIGGERS, true).await?;
    DataTransferRepository::reset_sequences(&mut tx, SEQUENCE_RESET_TABLES).await?;

    tx.commit().await.map_err(ApiError::from)?;

    let response = serde_json::json!({
        "success": true,
        "mode": if is_overwrite { "overwrite" } else { "import" },
        "records_imported": counts,
    });

    Ok(response)
}

async fn export_table(pool: &DbPool, table: &str) -> Result<Vec<Value>, ApiError> {
    DataTransferRepository::export_table(pool, table).await
}

fn managed_tables(skip_rooms: bool) -> Vec<&'static str> {
    let mut tables = BASE_MANAGED_TABLES.to_vec();
    if !skip_rooms {
        tables.extend_from_slice(ROOM_DEPENDENT_TABLES);
    }
    tables
}

fn base_generated_columns() -> HashMap<String, HashSet<String>> {
    [
        (
            "bookings",
            ["nights", "total_guests", "tourism_billable_amount"].as_slice(),
        ),
        ("invoices", ["balance_due"].as_slice()),
        ("customer_ledgers", ["balance_due"].as_slice()),
    ]
    .into_iter()
    .map(|(table, columns)| {
        (
            table.to_string(),
            columns.iter().map(|column| (*column).to_string()).collect(),
        )
    })
    .collect()
}

fn row_reference(row: &serde_json::Map<String, Value>) -> String {
    for key in [
        "id",
        "booking_number",
        "invoice_number",
        "room_number",
        "company_name",
        "full_name",
        "audit_date",
    ] {
        if let Some(value) = row.get(key) {
            return format!(" ({key}: {})", format_reference_value(value));
        }
    }

    String::new()
}

fn format_reference_value(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

fn import_error_detail(error: &ApiError) -> String {
    match error {
        ApiError::BadRequest(message)
        | ApiError::Conflict(message)
        | ApiError::Database(message) => message.clone(),
        _ => error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::base_generated_columns;

    #[test]
    fn base_generated_columns_include_pg18_booking_virtual_column() {
        let generated_columns = base_generated_columns();
        let booking_columns = generated_columns
            .get("bookings")
            .expect("bookings generated columns should be listed");

        assert!(booking_columns.contains("nights"));
        assert!(booking_columns.contains("total_guests"));
        assert!(booking_columns.contains("tourism_billable_amount"));
    }
}
