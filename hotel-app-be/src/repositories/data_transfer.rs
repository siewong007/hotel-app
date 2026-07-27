//! Data-transfer persistence helpers

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::Value;

use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;

pub struct DataTransferRepository;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QualifiedTable {
    pub schema: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct TransferTable {
    pub table: QualifiedTable,
    pub is_partitioned: bool,
    pub columns: HashSet<String>,
    pub generated_columns: HashSet<String>,
    pub primary_key_columns: Vec<String>,
    pub dependencies: HashSet<String>,
}

impl TransferTable {
    fn source(&self) -> String {
        if self.is_partitioned {
            self.table.quoted()
        } else {
            format!("ONLY {}", self.table.quoted())
        }
    }
}

impl QualifiedTable {
    pub fn parse(key: &str) -> Result<Self, ApiError> {
        let Some((schema, name)) = key.split_once('.') else {
            return Err(ApiError::BadRequest(format!(
                "Transfer table '{key}' must be schema-qualified"
            )));
        };
        if key.matches('.').count() != 1 || !is_identifier(schema) || !is_identifier(name) {
            return Err(ApiError::BadRequest(format!(
                "Invalid transfer table '{key}'"
            )));
        }

        Ok(Self {
            schema: schema.to_string(),
            name: name.to_string(),
        })
    }

    pub fn key(&self) -> String {
        format!("{}.{}", self.schema, self.name)
    }

    pub fn quoted(&self) -> String {
        format!(
            "{}.{}",
            quote_identifier(&self.schema),
            quote_identifier(&self.name)
        )
    }
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

pub fn transfer_order(
    selected: &[String],
    dependencies: &HashMap<String, HashSet<String>>,
) -> Result<Vec<String>, ApiError> {
    let selected: BTreeSet<String> = selected.iter().cloned().collect();
    let mut unresolved: HashMap<String, BTreeSet<String>> = selected
        .iter()
        .map(|table| {
            (
                table.clone(),
                dependencies
                    .get(table)
                    .into_iter()
                    .flatten()
                    .filter(|dependency| selected.contains(*dependency))
                    .cloned()
                    .collect(),
            )
        })
        .collect();
    let mut ordered = Vec::with_capacity(selected.len());

    while !unresolved.is_empty() {
        let ready: Vec<String> = unresolved
            .iter()
            .filter(|(_, dependencies)| dependencies.is_empty())
            .map(|(table, _)| table.clone())
            .collect();
        if ready.is_empty() {
            return Err(ApiError::BadRequest(
                "Selected transfer tables contain a circular foreign-key dependency".to_string(),
            ));
        }

        for table in ready {
            unresolved.remove(&table);
            for dependencies in unresolved.values_mut() {
                dependencies.remove(&table);
            }
            ordered.push(table);
        }
    }

    Ok(ordered)
}

/// Whitelist of tables the data-transfer subsystem is allowed to reference in
/// dynamically-built SQL (`format!`-interpolated table names). Mirrors
/// `services::data_transfer::TABLE_INSERT_ORDER` — the single source of truth
/// for which tables are transferable. Every caller today only ever passes
/// literal table names from that fixed list, so this check is a no-op in
/// normal operation; it exists so a future caller that sources a table name
/// from request data can't reopen SQL injection via table interpolation.
const KNOWN_TABLES: &[&str] = &[
    "amenities",
    "booking_channels",
    "companies",
    "corporate_accounts",
    "corporate_account_contacts",
    "email_templates",
    "guests",
    "promotions",
    "vouchers",
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
    "promotion_room_types",
    "guest_complimentary_credits",
    "room_rates",
    "room_type_amenities",
    "rooms",
    "bookings",
    "voucher_redemptions",
    "voucher_redemption_allocations",
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

fn ensure_known_table(table: &str) -> Result<(), ApiError> {
    if KNOWN_TABLES.contains(&table) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Unknown table '{}' is not permitted for data-transfer operations",
            table
        )))
    }
}

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
    pub async fn transfer_tables(pool: &DbPool) -> Result<Vec<TransferTable>, ApiError> {
        let table_rows: Vec<(String, String, String)> = sqlx::query_as(
            r#"
            SELECT namespace.nspname, class.relname, class.relkind::text
            FROM pg_class class
            JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
            WHERE class.relkind IN ('r', 'p')
              AND namespace.nspname <> 'information_schema'
              AND namespace.nspname !~ '^pg_'
              AND (class.relkind = 'p' OR NOT EXISTS (
                  SELECT 1 FROM pg_inherits WHERE inhrelid = class.oid
              ))
            ORDER BY namespace.nspname, class.relname
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;

        let tables: Vec<(QualifiedTable, bool)> = table_rows
            .into_iter()
            .map(|(schema, name, relkind)| (QualifiedTable { schema, name }, relkind == "p"))
            .collect();
        let table_names: Vec<QualifiedTable> =
            tables.iter().map(|(table, _)| table.clone()).collect();
        let known: HashSet<String> = table_names.iter().map(QualifiedTable::key).collect();
        let columns = Self::transfer_columns(pool, &table_names).await?;
        let primary_keys = Self::transfer_primary_keys(pool, &table_names).await?;
        let dependencies = Self::transfer_dependencies(pool, &known).await?;

        Ok(tables
            .into_iter()
            .map(|(table, is_partitioned)| {
                let key = table.key();
                let (columns, generated_columns) = columns
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| (HashSet::new(), HashSet::new()));
                TransferTable {
                    table,
                    is_partitioned,
                    columns,
                    generated_columns,
                    primary_key_columns: primary_keys.get(&key).cloned().unwrap_or_default(),
                    dependencies: dependencies.get(&key).cloned().unwrap_or_default(),
                }
            })
            .collect())
    }

    async fn transfer_columns(
        pool: &DbPool,
        tables: &[QualifiedTable],
    ) -> Result<HashMap<String, (HashSet<String>, HashSet<String>)>, ApiError> {
        let mut metadata = HashMap::new();
        for table in tables {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT column_name, is_generated FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
            )
            .bind(&table.schema)
            .bind(&table.name)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
            metadata.insert(
                table.key(),
                (
                    rows.iter().map(|(column, _)| column.clone()).collect(),
                    rows.into_iter()
                        .filter(|(_, generated)| generated != "NEVER")
                        .map(|(column, _)| column)
                        .collect(),
                ),
            );
        }
        Ok(metadata)
    }

    async fn transfer_dependencies(
        pool: &DbPool,
        known: &HashSet<String>,
    ) -> Result<HashMap<String, HashSet<String>>, ApiError> {
        let rows: Vec<(String, String, String, String)> = sqlx::query_as(
            r#"
            SELECT child_namespace.nspname, child.relname, parent_namespace.nspname, parent.relname
            FROM pg_constraint constraint
            JOIN pg_class child ON child.oid = constraint.conrelid
            JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
            JOIN pg_class parent ON parent.oid = constraint.confrelid
            JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
            WHERE constraint.contype = 'f'
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;

        let mut dependencies: HashMap<String, HashSet<String>> = HashMap::new();
        for (child_schema, child_name, parent_schema, parent_name) in rows {
            let child = format!("{child_schema}.{child_name}");
            let parent = format!("{parent_schema}.{parent_name}");
            if child != parent && known.contains(&child) && known.contains(&parent) {
                dependencies.entry(child).or_default().insert(parent);
            }
        }
        Ok(dependencies)
    }

    async fn transfer_primary_keys(
        pool: &DbPool,
        tables: &[QualifiedTable],
    ) -> Result<HashMap<String, Vec<String>>, ApiError> {
        let mut primary_keys = HashMap::new();
        for table in tables {
            let columns: Vec<(String,)> = sqlx::query_as(
                r#"
                SELECT attribute.attname
                FROM pg_index index
                JOIN pg_class class ON class.oid = index.indrelid
                JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
                JOIN unnest(index.indkey) WITH ORDINALITY key(attnum, position) ON true
                JOIN pg_attribute attribute ON attribute.attrelid = class.oid AND attribute.attnum = key.attnum
                WHERE index.indisprimary AND namespace.nspname = $1 AND class.relname = $2
                ORDER BY key.position
                "#,
            )
            .bind(&table.schema)
            .bind(&table.name)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
            primary_keys.insert(
                table.key(),
                columns.into_iter().map(|(column,)| column).collect(),
            );
        }
        Ok(primary_keys)
    }

    pub async fn count_transfer_table(
        pool: &DbPool,
        table: &TransferTable,
    ) -> Result<i64, ApiError> {
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", table.source()))
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn export_transfer_table(
        pool: &DbPool,
        table: &TransferTable,
    ) -> Result<Vec<Value>, ApiError> {
        let order_by = if table.primary_key_columns.is_empty() {
            String::new()
        } else {
            format!(
                " ORDER BY {}",
                table
                    .primary_key_columns
                    .iter()
                    .map(|column| quote_identifier(column))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        Self::export_query(pool, &format!("SELECT * FROM {}{order_by}", table.source())).await
    }

    pub async fn clear_transfer_tables(
        tx: &mut DbTransaction<'_>,
        tables: &[TransferTable],
    ) -> Result<(), ApiError> {
        for table in tables {
            sqlx::query(&format!("DELETE FROM {}", table.source()))
                .execute(&mut **tx)
                .await
                .map_err(ApiError::from)?;
        }
        Ok(())
    }

    pub async fn insert_transfer_row(
        tx: &mut DbTransaction<'_>,
        table: &TransferTable,
        row: &serde_json::Map<String, Value>,
    ) -> Result<u64, ApiError> {
        if let Some(column) = row.keys().find(|column| !table.columns.contains(*column)) {
            return Err(ApiError::BadRequest(format!(
                "{}.{} does not exist in the destination schema",
                table.table.key(),
                column
            )));
        }
        let values: serde_json::Map<String, Value> = row
            .iter()
            .filter(|(column, _)| {
                table.columns.contains(*column) && !table.generated_columns.contains(*column)
            })
            .map(|(column, value)| (column.clone(), value.clone()))
            .collect();
        if values.is_empty() {
            return Ok(0);
        }
        let columns = values
            .keys()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let quoted = table.table.quoted();
        let sql = format!(
            "INSERT INTO {quoted} ({columns}) OVERRIDING SYSTEM VALUE SELECT {columns} FROM jsonb_populate_record(NULL::{quoted}, $1::jsonb) ON CONFLICT DO NOTHING"
        );
        sqlx::query(&sql)
            .bind(Value::Object(values))
            .execute(&mut **tx)
            .await
            .map(|result| result.rows_affected())
            .map_err(ApiError::from)
    }

    pub async fn set_transfer_triggers(
        tx: &mut DbTransaction<'_>,
        tables: &[TransferTable],
        enabled: bool,
    ) -> Result<(), ApiError> {
        let action = if enabled { "ENABLE" } else { "DISABLE" };
        for table in tables {
            sqlx::query(&format!(
                "ALTER TABLE {} {action} TRIGGER USER",
                table.table.quoted()
            ))
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        }
        Ok(())
    }

    pub async fn reset_transfer_sequences(
        tx: &mut DbTransaction<'_>,
        tables: &[TransferTable],
    ) -> Result<(), ApiError> {
        for table in tables {
            for column in &table.columns {
                let sequence: Option<String> =
                    sqlx::query_scalar("SELECT pg_get_serial_sequence($1, $2)")
                        .bind(table.table.key())
                        .bind(column)
                        .fetch_one(&mut **tx)
                        .await
                        .map_err(ApiError::from)?;
                let Some(sequence) = sequence else {
                    continue;
                };
                let source = table.source();
                let quoted_column = quote_identifier(column);
                let reset_sql = format!(
                    "SELECT setval($1::regclass, COALESCE((SELECT MAX({quoted_column})::bigint FROM {source}), 1), EXISTS (SELECT 1 FROM {source}))"
                );
                sqlx::query(&reset_sql)
                    .bind(sequence)
                    .execute(&mut **tx)
                    .await
                    .map_err(ApiError::from)?;
            }
        }
        Ok(())
    }

    pub async fn export_query(pool: &DbPool, query: &str) -> Result<Vec<Value>, ApiError> {
        // `export_query` doesn't take a table name directly, but its only
        // caller today (`export_table`) already validates the table before
        // building the query string passed in here.
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

    pub async fn existing_ids(
        tx: &mut DbTransaction<'_>,
        table: &str,
        ids: &[i64],
    ) -> Result<HashSet<i64>, ApiError> {
        ensure_known_table(table)?;
        if ids.is_empty() {
            return Ok(HashSet::new());
        }

        let quoted_table = quote_identifier(table);

        let existing_ids = sqlx::query_scalar::<_, i64>(&format!(
            "SELECT id FROM {quoted_table} WHERE id = ANY($1)"
        ))
        .bind(ids)
        .fetch_all(&mut **tx)
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .collect();

        Ok(existing_ids)
    }

    pub async fn room_ids_by_number(
        tx: &mut DbTransaction<'_>,
        room_numbers: &[String],
    ) -> Result<HashMap<String, i64>, ApiError> {
        if room_numbers.is_empty() {
            return Ok(HashMap::new());
        }

        let rows = sqlx::query_as::<_, (String, i64)>(
            "SELECT room_number, id FROM rooms WHERE room_number = ANY($1)",
        )
        .bind(room_numbers)
        .fetch_all(&mut **tx)
        .await
        .map_err(ApiError::from)?;

        Ok(rows.into_iter().collect())
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
            ensure_known_table(table)?;
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
            "INSERT INTO {quoted_table} ({column_list}) OVERRIDING SYSTEM VALUE SELECT {column_list} FROM jsonb_populate_record(NULL::{quoted_table}, $1::jsonb) ON CONFLICT DO NOTHING"
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
    fn promotion_tables_are_allowed_by_the_dynamic_sql_whitelist() {
        for table in [
            "promotions",
            "promotion_room_types",
            "vouchers",
            "voucher_redemptions",
            "voucher_redemption_allocations",
        ] {
            assert!(ensure_known_table(table).is_ok(), "{table} should be known");
        }

        assert!(ensure_known_table("promotion_secrets").is_err());
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

    #[test]
    fn orders_parents_before_children_and_rejects_invalid_qualified_names() {
        let order = transfer_order(
            &[
                "public.user_sessions".to_string(),
                "public.users".to_string(),
            ],
            &HashMap::from([(
                "public.user_sessions".to_string(),
                HashSet::from(["public.users".to_string()]),
            )]),
        )
        .expect("acyclic dependencies should order");

        assert_eq!(order, vec!["public.users", "public.user_sessions"]);
        assert!(QualifiedTable::parse("public.users").is_ok());
        assert!(QualifiedTable::parse("public.users; DROP TABLE users").is_err());
        assert!(QualifiedTable::parse("users").is_err());
    }

    #[test]
    fn partitioned_parent_is_read_and_cleared_through_its_routing_table() {
        let parent = TransferTable {
            table: QualifiedTable::parse("public.audit_logs").unwrap(),
            is_partitioned: true,
            columns: HashSet::new(),
            generated_columns: HashSet::new(),
            primary_key_columns: vec!["id".to_string()],
            dependencies: HashSet::new(),
        };
        let ordinary = TransferTable {
            table: QualifiedTable::parse("public.users").unwrap(),
            is_partitioned: false,
            ..parent.clone()
        };

        assert_eq!(parent.source(), "\"public\".\"audit_logs\"");
        assert_eq!(ordinary.source(), "ONLY \"public\".\"users\"");
    }
}
