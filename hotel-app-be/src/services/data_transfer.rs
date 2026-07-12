//! Data-transfer workflows

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::constants::ImportMode;
use crate::core::db::{DbPool, DbTransaction};
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
    "loyalty_program_rules",
    "loyalty_tiers",
    "loyalty_memberships",
    "loyalty_members",
    "loyalty_accounts",
    "loyalty_rewards",
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
    "loyalty_transactions",
    "reward_redemptions",
    "loyalty_redemptions",
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

const ROOM_REFERENCE_COLUMNS: &[(&str, &[&str])] = &[
    ("bookings", &["room_id"]),
    ("room_history", &["room_id"]),
    ("housekeeping_tasks", &["room_id"]),
    ("maintenance_tickets", &["room_id"]),
    ("room_changes", &["from_room_id", "to_room_id"]),
    ("room_status_change_log", &["room_id"]),
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

/// Child -> parent relationships where deleting the parent either deletes the
/// child too (`CASCADE`) or is blocked until the child is removed
/// (`NO ACTION`/`RESTRICT`). Overwrite expands through this graph so old export
/// files that predate newer dependent tables can still clear a selected parent
/// without hitting FK violations mid-transaction.
const OVERWRITE_DELETE_DEPENDENCIES: &[(&str, &str)] = &[
    ("rooms", "room_types"),
    ("bookings", "companies"),
    ("bookings", "guests"),
    ("bookings", "rooms"),
    ("bookings", "booking_channels"),
    ("booking_guests", "bookings"),
    ("booking_modifications", "bookings"),
    ("booking_history", "bookings"),
    ("payments", "bookings"),
    ("invoices", "bookings"),
    ("customer_ledger_payments", "customer_ledgers"),
    ("night_audit_details", "night_audit_runs"),
    ("room_changes", "bookings"),
    ("room_changes", "rooms"),
    ("user_guests", "guests"),
    ("guest_complimentary_credits", "guests"),
    ("guest_complimentary_credits", "room_types"),
    ("room_rates", "rate_plans"),
    ("room_rates", "room_types"),
    ("room_type_amenities", "amenities"),
    ("room_type_amenities", "room_types"),
    ("loyalty_tiers", "loyalty_programs"),
    ("loyalty_memberships", "guests"),
    ("loyalty_memberships", "loyalty_programs"),
    ("loyalty_memberships", "loyalty_tiers"),
    ("points_transactions", "loyalty_memberships"),
    ("reward_catalog", "loyalty_programs"),
    ("reward_redemptions", "loyalty_memberships"),
    ("reward_redemptions", "reward_catalog"),
    ("corporate_account_contacts", "corporate_accounts"),
    ("booking_services", "bookings"),
    ("booking_services", "services"),
    ("room_history", "rooms"),
    ("room_status_change_log", "rooms"),
    ("loyalty_members", "guests"),
    ("loyalty_accounts", "loyalty_members"),
    ("loyalty_accounts", "loyalty_tiers"),
    ("loyalty_rewards", "loyalty_tiers"),
    ("loyalty_transactions", "loyalty_members"),
    ("loyalty_transactions", "loyalty_accounts"),
    ("loyalty_redemptions", "loyalty_members"),
    ("loyalty_redemptions", "loyalty_rewards"),
    ("loyalty_redemptions", "loyalty_transactions"),
    ("housekeeping_tasks", "rooms"),
    ("guest_documents", "guests"),
    ("guest_notes", "guests"),
    ("guest_preferences", "guests"),
    ("guest_reviews", "guests"),
    ("self_checkin_events", "bookings"),
    ("night_audit_posted_nights", "bookings"),
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
        loyalty_members: export_table(pool, "loyalty_members").await?,
        loyalty_accounts: export_table(pool, "loyalty_accounts").await?,
        points_transactions: export_table(pool, "points_transactions").await?,
        loyalty_transactions: export_table(pool, "loyalty_transactions").await?,
        reward_catalog: export_table(pool, "reward_catalog").await?,
        loyalty_rewards: export_table(pool, "loyalty_rewards").await?,
        reward_redemptions: export_table(pool, "reward_redemptions").await?,
        loyalty_redemptions: export_table(pool, "loyalty_redemptions").await?,
        loyalty_program_rules: export_table(pool, "loyalty_program_rules").await?,
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
    let ImportRequest { mode, data, tables } = request;
    let is_overwrite = mode == ImportMode::Overwrite;

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
        ("loyalty_program_rules", &data.loyalty_program_rules),
        ("loyalty_tiers", &data.loyalty_tiers),
        ("loyalty_memberships", &data.loyalty_memberships),
        ("loyalty_members", &data.loyalty_members),
        ("loyalty_accounts", &data.loyalty_accounts),
        ("loyalty_rewards", &data.loyalty_rewards),
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
        ("loyalty_transactions", &data.loyalty_transactions),
        ("reward_redemptions", &data.reward_redemptions),
        ("loyalty_redemptions", &data.loyalty_redemptions),
        ("room_changes", &data.room_changes),
        ("room_history", &data.room_history),
        ("room_status_change_log", &data.room_status_change_log),
        ("self_checkin_events", &data.self_checkin_events),
        ("services", &data.services),
        ("booking_services", &data.booking_services),
        ("system_settings", &data.system_settings),
        ("user_guests", &data.user_guests),
    ];
    let mut selected_tables = selected_import_tables(&tables, &tables_and_data)?;
    if is_overwrite {
        expand_overwrite_clear_tables(&mut selected_tables);
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    if is_overwrite {
        // Clear selected tables in reverse (child-before-parent) order. The UI
        // sends this list explicitly so an overwrite can intentionally restore
        // a table to empty rows.
        let clear_tables: Vec<&str> = tables_and_data
            .iter()
            .rev()
            .filter(|(table, _)| selected_tables.contains(*table))
            .map(|(table, _)| *table)
            .collect();
        if let Err(error) = DataTransferRepository::clear_tables(&mut tx, &clear_tables).await {
            let error_detail = import_error_detail(&error);
            let message = format!(
                "Overwrite failed while clearing selected data: {}. Include dependent tables in the overwrite selection or remove the blocked references before retrying. No changes were saved.",
                error_detail
            );
            log::warn!("{}", message);
            let _ = tx.rollback().await;
            return Err(ApiError::BadRequest(message));
        }
        log::info!(
            "Phase 1: cleared {} table(s) for overwrite",
            clear_tables.len()
        );
    }

    let room_references =
        RoomReferenceResolver::build(&mut tx, &selected_tables, &data.rooms).await?;
    validate_room_references(
        &mut tx,
        &selected_tables,
        &tables_and_data,
        &room_references,
    )
    .await?;

    DataTransferRepository::align_status_constraints(&mut tx).await?;
    DataTransferRepository::set_user_triggers(&mut tx, TABLES_WITH_TRIGGERS, false).await?;

    let mut counts = serde_json::Map::new();

    for (table, rows) in tables_and_data {
        if !selected_tables.contains(table) {
            continue;
        }

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
            let remapped_row;
            let obj = if room_reference_columns(table).is_some() {
                remapped_row = remap_room_references(table, obj, &room_references)?;
                &remapped_row
            } else {
                obj
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

struct RoomReferenceResolver {
    imported_room_ids: HashMap<i64, i64>,
}

impl RoomReferenceResolver {
    async fn build(
        tx: &mut DbTransaction<'_>,
        selected_tables: &HashSet<String>,
        imported_rooms: &[Value],
    ) -> Result<Self, ApiError> {
        let mut imported_room_ids = HashMap::new();
        if !selected_tables.contains("rooms") {
            return Ok(Self { imported_room_ids });
        }

        let room_refs = imported_room_refs(imported_rooms);
        let room_numbers: Vec<String> = room_refs
            .iter()
            .filter_map(|(_, room_number)| room_number.clone())
            .collect();
        let existing_by_number =
            DataTransferRepository::room_ids_by_number(tx, &room_numbers).await?;

        for (imported_id, room_number) in room_refs {
            let resolved_id = room_number
                .as_ref()
                .and_then(|number| existing_by_number.get(number))
                .copied()
                .unwrap_or(imported_id);
            imported_room_ids.insert(imported_id, resolved_id);
        }

        Ok(Self { imported_room_ids })
    }

    fn resolve_room_id(&self, room_id: i64) -> i64 {
        self.imported_room_ids
            .get(&room_id)
            .copied()
            .unwrap_or(room_id)
    }

    fn contains_imported_room_id(&self, room_id: i64) -> bool {
        self.imported_room_ids.contains_key(&room_id)
    }
}

fn imported_room_refs(imported_rooms: &[Value]) -> Vec<(i64, Option<String>)> {
    imported_rooms
        .iter()
        .filter_map(|row| {
            let obj = row.as_object()?;
            let id = obj.get("id").and_then(value_as_i64)?;
            let room_number = obj
                .get("room_number")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some((id, room_number))
        })
        .collect()
}

async fn validate_room_references(
    tx: &mut DbTransaction<'_>,
    selected_tables: &HashSet<String>,
    tables_and_data: &[(&str, &[Value])],
    room_references: &RoomReferenceResolver,
) -> Result<(), ApiError> {
    let mut room_ids = Vec::new();
    let mut seen = HashSet::new();
    for (table, rows) in tables_and_data {
        if !selected_tables.contains(*table) {
            continue;
        }
        let Some(columns) = room_reference_columns(table) else {
            continue;
        };

        for row in *rows {
            let Some(obj) = row.as_object() else {
                continue;
            };
            for column in columns {
                if let Some(room_id) = obj.get(*column).and_then(value_as_i64) {
                    let resolved_room_id = room_references.resolve_room_id(room_id);
                    if seen.insert(resolved_room_id) {
                        room_ids.push(resolved_room_id);
                    }
                }
            }
        }
    }

    let existing_room_ids = DataTransferRepository::existing_ids(tx, "rooms", &room_ids).await?;
    for (table, rows) in tables_and_data {
        if !selected_tables.contains(*table) {
            continue;
        };
        let Some(columns) = room_reference_columns(table) else {
            continue;
        };

        for (row_index, row) in rows.iter().enumerate() {
            let Some(obj) = row.as_object() else {
                continue;
            };
            for column in columns {
                let Some(room_id) = obj.get(*column).and_then(value_as_i64) else {
                    continue;
                };
                let resolved_room_id = room_references.resolve_room_id(room_id);
                if !room_references.contains_imported_room_id(room_id)
                    && !existing_room_ids.contains(&resolved_room_id)
                {
                    return Err(ApiError::BadRequest(format!(
                        "Import failed for table {} row {}{}: {} references room id {}, but that room is not present in the import file and does not exist in this database. Include Rooms in the import file, import a full backup, or create the missing room before retrying. No changes were saved.",
                        table,
                        row_index + 1,
                        row_reference(obj),
                        column,
                        room_id
                    )));
                }
            }
        }
    }

    Ok(())
}

fn remap_room_references(
    table: &str,
    row: &serde_json::Map<String, Value>,
    room_references: &RoomReferenceResolver,
) -> Result<serde_json::Map<String, Value>, ApiError> {
    let Some(columns) = room_reference_columns(table) else {
        return Ok(row.clone());
    };

    let mut remapped = row.clone();
    let mut changed = false;
    for column in columns {
        let Some(room_id_value) = row.get(*column) else {
            continue;
        };
        let Some(room_id) = value_as_i64(room_id_value) else {
            continue;
        };
        let resolved_room_id = room_references.resolve_room_id(room_id);
        if resolved_room_id != room_id {
            remapped.insert(
                (*column).to_string(),
                Value::Number(resolved_room_id.into()),
            );
            changed = true;
        }
    }

    if changed {
        Ok(remapped)
    } else {
        Ok(row.clone())
    }
}

fn room_reference_columns(table: &str) -> Option<&'static [&'static str]> {
    ROOM_REFERENCE_COLUMNS
        .iter()
        .find_map(|(candidate, columns)| (*candidate == table).then_some(*columns))
}

fn value_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
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

fn selected_import_tables(
    requested_tables: &[String],
    tables_and_data: &[(&str, &[Value])],
) -> Result<HashSet<String>, ApiError> {
    if requested_tables.is_empty() {
        return Ok(tables_and_data
            .iter()
            .filter(|(_, rows)| !rows.is_empty())
            .map(|(table, _)| (*table).to_string())
            .collect());
    }

    let known_tables: HashSet<&str> = tables_and_data.iter().map(|(table, _)| *table).collect();
    let mut selected = HashSet::new();

    for table in requested_tables {
        if !known_tables.contains(table.as_str()) {
            return Err(ApiError::BadRequest(format!(
                "Unknown import table '{}' was requested",
                table
            )));
        }
        selected.insert(table.clone());
    }

    Ok(selected)
}

fn expand_overwrite_clear_tables(selected_tables: &mut HashSet<String>) {
    let mut changed = true;
    while changed {
        changed = false;

        for (child, parent) in OVERWRITE_DELETE_DEPENDENCIES {
            if selected_tables.contains(*parent) && selected_tables.insert((*child).to_string()) {
                changed = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ALL_IMPORT_TABLES, COMPOSITE_PK_TABLES, RoomReferenceResolver, TABLE_INSERT_ORDER,
        base_generated_columns, expand_overwrite_clear_tables, imported_room_refs,
        remap_room_references, selected_import_tables,
    };
    use serde_json::{Value, json};
    use std::collections::{HashMap, HashSet};

    #[test]
    fn table_insert_order_is_unique_and_covers_known_tables() {
        let unique: HashSet<_> = TABLE_INSERT_ORDER.iter().collect();
        assert_eq!(
            unique.len(),
            TABLE_INSERT_ORDER.len(),
            "TABLE_INSERT_ORDER must not contain duplicates"
        );
        // The full-backup set the API exports/imports.
        assert_eq!(TABLE_INSERT_ORDER.len(), 51);
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
    fn base_generated_columns_include_pg19_booking_virtual_column() {
        let generated_columns = base_generated_columns();
        let booking_columns = generated_columns
            .get("bookings")
            .expect("bookings generated columns should be listed");

        assert!(booking_columns.contains("nights"));
        assert!(booking_columns.contains("total_guests"));
        assert!(booking_columns.contains("tourism_billable_amount"));
    }

    #[test]
    fn selected_import_tables_uses_explicit_table_list_even_when_rows_are_empty() {
        let empty_rows: Vec<Value> = vec![];
        let guest_rows = vec![json!({"id": 1})];
        let tables_and_data = vec![
            ("guests", guest_rows.as_slice()),
            ("loyalty_rewards", empty_rows.as_slice()),
        ];

        let selected = selected_import_tables(
            &["guests".to_string(), "loyalty_rewards".to_string()],
            &tables_and_data,
        )
        .expect("explicit table selection should be accepted");

        assert!(selected.contains("guests"));
        assert!(selected.contains("loyalty_rewards"));
    }

    #[test]
    fn selected_import_tables_keeps_legacy_non_empty_payload_behavior() {
        let empty_rows: Vec<Value> = vec![];
        let guest_rows = vec![json!({"id": 1})];
        let tables_and_data = vec![
            ("guests", guest_rows.as_slice()),
            ("loyalty_rewards", empty_rows.as_slice()),
        ];

        let selected =
            selected_import_tables(&[], &tables_and_data).expect("legacy selection should work");

        assert!(selected.contains("guests"));
        assert!(!selected.contains("loyalty_rewards"));
    }

    #[test]
    fn overwrite_clear_expands_through_fk_blocking_dependents() {
        let mut selected = HashSet::from(["loyalty_tiers".to_string()]);

        expand_overwrite_clear_tables(&mut selected);

        assert!(selected.contains("loyalty_tiers"));
        assert!(selected.contains("loyalty_rewards"));
        assert!(selected.contains("loyalty_redemptions"));
        assert!(selected.contains("loyalty_accounts"));
        assert!(selected.contains("loyalty_transactions"));
        assert!(selected.contains("loyalty_memberships"));
        assert!(selected.contains("points_transactions"));
        assert!(!selected.contains("payments"));
    }

    #[test]
    fn imported_room_refs_collect_ids_and_room_numbers() {
        let rows = vec![
            json!({"id": 1094, "room_number": "101"}),
            json!({"id": "1095", "room_number": "102"}),
            json!({"room_number": "missing-id"}),
        ];

        let refs = imported_room_refs(&rows);

        assert_eq!(
            refs,
            vec![
                (1094, Some("101".to_string())),
                (1095, Some("102".to_string()))
            ]
        );
    }

    #[test]
    fn remap_room_references_uses_resolved_room_id() {
        let resolver = RoomReferenceResolver {
            imported_room_ids: HashMap::from([(1094, 7)]),
        };
        let row = serde_json::Map::from_iter([
            ("id".to_string(), json!(2)),
            ("room_id".to_string(), json!(1094)),
        ]);

        let remapped =
            remap_room_references("housekeeping_tasks", &row, &resolver).expect("row should remap");

        assert_eq!(remapped.get("room_id"), Some(&json!(7)));
        assert_eq!(remapped.get("id"), Some(&json!(2)));
    }

    #[test]
    fn remap_room_references_remaps_multiple_room_columns() {
        let resolver = RoomReferenceResolver {
            imported_room_ids: HashMap::from([(1094, 7), (1095, 8)]),
        };
        let row = serde_json::Map::from_iter([
            ("from_room_id".to_string(), json!(1094)),
            ("to_room_id".to_string(), json!(1095)),
        ]);

        let remapped =
            remap_room_references("room_changes", &row, &resolver).expect("row should remap");

        assert_eq!(remapped.get("from_room_id"), Some(&json!(7)));
        assert_eq!(remapped.get("to_room_id"), Some(&json!(8)));
    }

    #[test]
    fn remap_room_references_leaves_unmapped_room_id() {
        let resolver = RoomReferenceResolver {
            imported_room_ids: HashMap::new(),
        };
        let row = serde_json::Map::from_iter([("room_id".to_string(), json!(1094))]);

        let remapped =
            remap_room_references("bookings", &row, &resolver).expect("row should remain valid");

        assert_eq!(remapped.get("room_id"), Some(&json!(1094)));
    }
}
