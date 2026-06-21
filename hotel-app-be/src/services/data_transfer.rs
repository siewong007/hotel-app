//! Data-transfer workflows

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::constants::ImportMode;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{BookingDataExport, ExportPreview, ImportRequest};
use crate::repositories::data_transfer::{DataTransferRepository, ImportRowPolicy};

/// Every transferable table in foreign-key-safe **insert** order (parents
/// before children). Clearing for overwrite walks this in reverse. This is the
/// single source of truth — the export struct, the import row loop, the
/// overwrite clear, and column introspection all derive from it.
const TABLE_INSERT_ORDER: &[&str] = &[
    // configuration / roots
    "amenities",
    "booking_channels",
    "companies",
    "corporate_accounts",
    "corporate_account_contacts",
    "email_templates",
    "guests",
    "guest_documents",
    "guest_notes",
    "guest_preferences",
    "loyalty_programs",
    "loyalty_tiers",
    "loyalty_memberships",
    "night_audit_runs",
    "night_audit_details",
    "points_transactions",
    "rate_plans",
    "reward_catalog",
    "room_status_transitions",
    "room_types",
    "guest_complimentary_credits",
    "room_rates",
    "room_type_amenities",
    "rooms",
    "bookings",
    "booking_guests",
    "booking_history",
    "booking_modifications",
    "customer_ledgers",
    "customer_ledger_payments",
    "guest_reviews",
    "housekeeping_tasks",
    "invoices",
    "maintenance_tickets",
    "night_audit_posted_nights",
    "payments",
    "reward_redemptions",
    "room_changes",
    "room_history",
    "room_status_change_log",
    "self_checkin_events",
    "services",
    "booking_services",
    "system_settings",
    "user_guests",
];

const ALL_IMPORT_TABLES: &[&str] = TABLE_INSERT_ORDER;

/// Tables keyed by a composite primary key (no serial `id`): excluded from
/// sequence resets, and exported with an explicit key order.
const COMPOSITE_PK_TABLES: &[&str] = &["room_type_amenities", "room_status_transitions"];

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

pub async fn preview_export_counts(pool: &DbPool) -> Result<ExportPreview, ApiError> {
    let mut counts = HashMap::new();
    let mut total_records = 0_i64;

    for table in ALL_IMPORT_TABLES {
        let count = DataTransferRepository::count_table(pool, table).await?;
        counts.insert((*table).to_string(), count);
        total_records += count;
    }

    Ok(ExportPreview {
        generated_at: chrono::Utc::now().to_rfc3339(),
        counts,
        total_records,
    })
}

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

        // ----- Extended full-backup tables -----
        system_settings: export_table(pool, "system_settings").await?,
        rate_plans: export_table(pool, "rate_plans").await?,
        room_rates: export_table(pool, "room_rates").await?,
        amenities: export_table(pool, "amenities").await?,
        room_type_amenities: export_table(pool, "room_type_amenities").await?,
        services: export_table(pool, "services").await?,
        booking_services: export_table(pool, "booking_services").await?,
        booking_channels: export_table(pool, "booking_channels").await?,
        room_status_transitions: export_table(pool, "room_status_transitions").await?,
        room_history: export_table(pool, "room_history").await?,
        room_status_change_log: export_table(pool, "room_status_change_log").await?,
        email_templates: export_table(pool, "email_templates").await?,
        loyalty_programs: export_table(pool, "loyalty_programs").await?,
        loyalty_tiers: export_table(pool, "loyalty_tiers").await?,
        loyalty_memberships: export_table(pool, "loyalty_memberships").await?,
        points_transactions: export_table(pool, "points_transactions").await?,
        reward_catalog: export_table(pool, "reward_catalog").await?,
        reward_redemptions: export_table(pool, "reward_redemptions").await?,
        corporate_accounts: export_table(pool, "corporate_accounts").await?,
        corporate_account_contacts: export_table(pool, "corporate_account_contacts").await?,
        housekeeping_tasks: export_table(pool, "housekeeping_tasks").await?,
        maintenance_tickets: export_table(pool, "maintenance_tickets").await?,
        guest_documents: export_table(pool, "guest_documents").await?,
        guest_notes: export_table(pool, "guest_notes").await?,
        guest_preferences: export_table(pool, "guest_preferences").await?,
        guest_reviews: export_table(pool, "guest_reviews").await?,
        self_checkin_events: export_table(pool, "self_checkin_events").await?,
        night_audit_posted_nights: export_table(pool, "night_audit_posted_nights").await?,
    })
}

pub async fn import_booking_data(
    pool: &DbPool,
    import_user_id: i64,
    request: ImportRequest,
) -> Result<Value, ApiError> {
    let data = request.data;
    let is_overwrite = request.mode == ImportMode::Overwrite;

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

    let empty_skip = HashSet::new();
    let empty_columns = HashSet::new();
    // Foreign-key-safe insert order; the import loop and overwrite clear both
    // derive from this so a table never lands before its parents.
    let tables_and_data: Vec<(&str, &[Value])> = vec![
        ("amenities", &data.amenities),
        ("booking_channels", &data.booking_channels),
        ("companies", &data.companies),
        ("corporate_accounts", &data.corporate_accounts),
        (
            "corporate_account_contacts",
            &data.corporate_account_contacts,
        ),
        ("email_templates", &data.email_templates),
        ("guests", &data.guests),
        ("guest_documents", &data.guest_documents),
        ("guest_notes", &data.guest_notes),
        ("guest_preferences", &data.guest_preferences),
        ("loyalty_programs", &data.loyalty_programs),
        ("loyalty_tiers", &data.loyalty_tiers),
        ("loyalty_memberships", &data.loyalty_memberships),
        ("night_audit_runs", &data.night_audit_runs),
        ("night_audit_details", &data.night_audit_details),
        ("points_transactions", &data.points_transactions),
        ("rate_plans", &data.rate_plans),
        ("reward_catalog", &data.reward_catalog),
        ("room_status_transitions", &data.room_status_transitions),
        ("room_types", &data.room_types),
        (
            "guest_complimentary_credits",
            &data.guest_complimentary_credits,
        ),
        ("room_rates", &data.room_rates),
        ("room_type_amenities", &data.room_type_amenities),
        ("rooms", &data.rooms),
        ("bookings", &data.bookings),
        ("booking_guests", &data.booking_guests),
        ("booking_history", &data.booking_history),
        ("booking_modifications", &data.booking_modifications),
        ("customer_ledgers", &data.customer_ledgers),
        ("customer_ledger_payments", &data.customer_ledger_payments),
        ("guest_reviews", &data.guest_reviews),
        ("housekeeping_tasks", &data.housekeeping_tasks),
        ("invoices", &data.invoices),
        ("maintenance_tickets", &data.maintenance_tickets),
        ("night_audit_posted_nights", &data.night_audit_posted_nights),
        ("payments", &data.payments),
        ("reward_redemptions", &data.reward_redemptions),
        ("room_changes", &data.room_changes),
        ("room_history", &data.room_history),
        ("room_status_change_log", &data.room_status_change_log),
        ("self_checkin_events", &data.self_checkin_events),
        ("services", &data.services),
        ("booking_services", &data.booking_services),
        ("system_settings", &data.system_settings),
        ("user_guests", &data.user_guests),
    ];

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    if is_overwrite {
        // Clear only the tables actually present in this payload, in reverse
        // (child-before-parent) order. This restores exactly what's included
        // and leaves untouched any table the file doesn't carry.
        let clear_tables: Vec<&str> = tables_and_data
            .iter()
            .rev()
            .filter(|(_, rows)| !rows.is_empty())
            .map(|(table, _)| *table)
            .collect();
        DataTransferRepository::clear_tables(&mut tx, &clear_tables).await?;
        log::info!(
            "Phase 1: cleared {} table(s) for overwrite",
            clear_tables.len()
        );
    }

    DataTransferRepository::align_status_constraints(&mut tx).await?;
    DataTransferRepository::set_user_triggers(&mut tx, TABLES_WITH_TRIGGERS, false).await?;

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
    let sequence_reset_tables: Vec<&str> = TABLE_INSERT_ORDER
        .iter()
        .copied()
        .filter(|table| !COMPOSITE_PK_TABLES.contains(table))
        .collect();
    DataTransferRepository::reset_sequences(&mut tx, &sequence_reset_tables).await?;

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
    use super::{
        ALL_IMPORT_TABLES, COMPOSITE_PK_TABLES, TABLE_INSERT_ORDER, base_generated_columns,
    };
    use std::collections::HashSet;

    #[test]
    fn table_insert_order_is_unique_and_covers_known_tables() {
        let unique: HashSet<_> = TABLE_INSERT_ORDER.iter().collect();
        assert_eq!(
            unique.len(),
            TABLE_INSERT_ORDER.len(),
            "TABLE_INSERT_ORDER must not contain duplicates"
        );
        // The full-backup set the API exports/imports.
        assert_eq!(TABLE_INSERT_ORDER.len(), 45);
        // Introspection list and the canonical order must stay in lock-step.
        assert_eq!(ALL_IMPORT_TABLES, TABLE_INSERT_ORDER);
    }

    #[test]
    fn composite_pk_tables_are_part_of_the_order_but_excluded_from_sequence_reset() {
        let sequence_reset: Vec<&str> = TABLE_INSERT_ORDER
            .iter()
            .copied()
            .filter(|table| !COMPOSITE_PK_TABLES.contains(table))
            .collect();
        for table in COMPOSITE_PK_TABLES {
            assert!(
                TABLE_INSERT_ORDER.contains(table),
                "{table} should be transferred"
            );
            assert!(
                !sequence_reset.contains(table),
                "{table} has no serial id and must be skipped on sequence reset"
            );
        }
    }

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
