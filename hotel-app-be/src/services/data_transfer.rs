//! Data-transfer workflows

use std::collections::HashMap;

use serde_json::Value;

use crate::constants::ImportMode;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{BookingDataExport, ImportRequest};
use crate::repositories::data_transfer::DataTransferRepository;

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

const TABLES_WITH_TRIGGERS: &[&str] = &[
    "bookings",
    "rooms",
    "guests",
    "customer_ledgers",
    "payments",
];

const USER_FK_COLUMNS: &[&str] = &[
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

pub async fn import_booking_data(pool: &DbPool, request: ImportRequest) -> Result<Value, ApiError> {
    let data = request.data;
    let is_overwrite = request.mode == ImportMode::Overwrite;
    let managed_tables = managed_tables(data.rooms.is_empty());

    if is_overwrite {
        DataTransferRepository::clear_tables(pool, &managed_tables).await?;
        log::info!("Phase 1: All managed tables cleared");
    }

    let generated_columns: HashMap<&str, Vec<&str>> = HashMap::from([
        ("bookings", vec!["nights", "total_guests"]),
        ("invoices", vec!["balance_due"]),
        ("customer_ledgers", vec!["balance_due"]),
    ]);
    let existing_user_ids = DataTransferRepository::existing_user_ids(pool).await;
    let table_columns = DataTransferRepository::table_columns(pool, ALL_IMPORT_TABLES).await;

    DataTransferRepository::set_user_triggers(pool, TABLES_WITH_TRIGGERS, false).await;

    let empty_skip = Vec::new();
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
    let mut errors = serde_json::Map::new();

    for (table, rows) in tables_and_data {
        let skip = generated_columns.get(table).unwrap_or(&empty_skip);
        let mut inserted = 0usize;
        let mut failed = 0usize;
        let mut last_error = String::new();

        for row in rows {
            let Some(obj) = row.as_object() else {
                continue;
            };

            match DataTransferRepository::insert_json_row(
                pool,
                table,
                obj,
                skip,
                table_columns.get(table),
                USER_FK_COLUMNS,
                &existing_user_ids,
            )
            .await
            {
                Ok(rows_affected) => {
                    if rows_affected > 0 {
                        inserted += 1;
                    }
                }
                Err(error) => {
                    failed += 1;
                    last_error = error.to_string();
                    log::warn!("Failed to insert row into {}: {}", table, error);
                }
            }
        }

        counts.insert(table.into(), Value::Number(inserted.into()));
        if failed > 0 {
            errors.insert(
                table.into(),
                serde_json::json!({
                    "failed": failed,
                    "last_error": last_error,
                }),
            );
            log::warn!(
                "Table {}: {} inserted, {} failed. Last error: {}",
                table,
                inserted,
                failed,
                last_error
            );
        }
        if inserted > 0 {
            log::info!("Inserted {} rows into {}", inserted, table);
        }
    }

    DataTransferRepository::set_user_triggers(pool, TABLES_WITH_TRIGGERS, true).await;
    DataTransferRepository::reset_sequences(pool, ALL_IMPORT_TABLES).await;

    let mut response = serde_json::json!({
        "success": true,
        "mode": if is_overwrite { "overwrite" } else { "import" },
        "records_imported": counts,
    });
    if !errors.is_empty() {
        response["errors"] = Value::Object(errors);
    }

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
