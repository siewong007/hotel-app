//! Data-transfer persistence helpers

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::Value;

use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::models::ConflictPolicy;

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
    /// Column names in `information_schema` ordinal order — the order
    /// `SELECT` projects them and therefore the key order of every exported
    /// row. The manifest reports this list (minus credential columns).
    pub ordered_columns: Vec<String>,
    pub generated_columns: HashSet<String>,
    pub primary_key_columns: Vec<String>,
    pub dependencies: HashSet<String>,
}

/// A foreign key that an import temporarily made deferrable, so it can be put
/// back exactly as it was once the rows are in.
#[derive(Debug, Clone)]
pub struct RelaxedForeignKey {
    table: QualifiedTable,
    constraint: String,
}

/// One column of a foreign-key constraint: `child.column -> parent.parent_column`.
/// The service layer filters these (transferable child, non-transferable parent)
/// to find the references a backup file can dangle.
#[derive(Debug, Clone)]
pub struct ForeignKeyRef {
    pub child: QualifiedTable,
    pub column: String,
    pub parent: QualifiedTable,
    pub parent_column: String,
}

/// What happened to one row under the import's conflict policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertRowOutcome {
    /// A new row landed.
    Inserted,
    /// `on_conflict = update` overwrote the existing row.
    Updated,
    /// The row was not applied (empty payload or `on_conflict = skip` hit an
    /// existing row).
    Skipped,
}

/// Which Rust value type the preview binds for a batched
/// `WHERE pk = ANY($1)` existence check. `Text` falls back to a `::text`
/// comparison for keys that do not share a single typed form.
#[derive(Debug)]
pub enum PkLookup {
    Int(Vec<i64>),
    Uuid(Vec<uuid::Uuid>),
    Text(Vec<String>),
}

impl TransferTable {
    /// The `FROM` target for reads and deletes: partitioned parents route
    /// through the parent, ordinary tables are pinned with `ONLY` so
    /// inheritance children never leak into a backup or an overwrite clear.
    pub(crate) fn source(&self) -> String {
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

/// Whether `start` can reach itself through the still-unresolved dependency
/// edges -- that is, whether it sits on a cycle rather than merely behind one.
fn reaches_itself(start: &str, unresolved: &HashMap<String, BTreeSet<String>>) -> bool {
    let mut stack: Vec<&str> = unresolved
        .get(start)
        .into_iter()
        .flatten()
        .map(String::as_str)
        .collect();
    let mut seen: HashSet<&str> = HashSet::new();
    while let Some(table) = stack.pop() {
        if table == start {
            return true;
        }
        if !seen.insert(table) {
            continue;
        }
        if let Some(dependencies) = unresolved.get(table) {
            stack.extend(dependencies.iter().map(String::as_str));
        }
    }
    false
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
        let mut ready: Vec<String> = unresolved
            .iter()
            .filter(|(_, dependencies)| dependencies.is_empty())
            .map(|(table, _)| table.clone())
            .collect();
        // `unresolved` is a HashMap, so without this the relative order of
        // independent tables changes between runs and the result is untestable.
        ready.sort();
        if ready.is_empty() {
            // A cycle. `users.guest_id` references `guests` while
            // `guests.created_by` references `users`, both since the V1
            // baseline, so this is the ordinary shape of this schema rather
            // than a corrupt selection -- refusing here made every full import
            // impossible. No order satisfies a cycle, so break it
            // deterministically; the import defers the constraints for exactly
            // this reason (see `relax_foreign_keys`). Taking the table with the
            // fewest outstanding dependencies keeps the result as close to
            // parents-before-children as a cycle allows.
            // Only a table that is genuinely *on* a cycle may be forced out.
            // Picking any blocked table would emit children before parents --
            // `bookings` is blocked by `guests` without being part of the
            // `users` <-> `guests` cycle, and releasing it first would order it
            // ahead of its own parent for no reason.
            let victim = unresolved
                .keys()
                .filter(|table| reaches_itself(table, &unresolved))
                .min_by(|left, right| {
                    unresolved[*left]
                        .len()
                        .cmp(&unresolved[*right].len())
                        .then_with(|| left.cmp(right))
                })
                .cloned()
                .expect("no table has zero dependencies, so some table is on a cycle");
            ready.push(victim);
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

/// Columns inside transferable tables that carry live credential material and
/// must never travel in either direction: the export cursor omits them from
/// the projection, and every import path drops the keys here so a crafted file
/// cannot write them either. `bookings.pre_checkin_token` is the guest
/// portal's bearer token — a leaked or hostile file carrying it would hand out
/// working pre-check-in links (the token alone authenticates the lookup).
pub(crate) const NEVER_TRANSFERRED_COLUMNS: &[(&str, &str)] = &[
    ("bookings", "pre_checkin_token"),
    ("bookings", "pre_checkin_token_expires_at"),
];

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
                let (ordered_columns, generated_columns) =
                    columns.get(&key).cloned().unwrap_or_default();
                TransferTable {
                    table,
                    is_partitioned,
                    columns: ordered_columns.iter().cloned().collect(),
                    ordered_columns,
                    generated_columns,
                    primary_key_columns: primary_keys.get(&key).cloned().unwrap_or_default(),
                    dependencies: dependencies.get(&key).cloned().unwrap_or_default(),
                }
            })
            .collect())
    }

    /// Per-table `(columns in ordinal order, generated columns)` — the
    /// ordinal list preserves the projection order of `SELECT <cols>` so the
    /// export manifest can describe row shape exactly.
    async fn transfer_columns(
        pool: &DbPool,
        tables: &[QualifiedTable],
    ) -> Result<HashMap<String, (Vec<String>, HashSet<String>)>, ApiError> {
        let mut metadata = HashMap::new();
        for table in tables {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT column_name, is_generated FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
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
            -- `constraint` is a reserved word; it cannot be used as an unquoted alias.
            FROM pg_constraint foreign_key
            JOIN pg_class child ON child.oid = foreign_key.conrelid
            JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
            JOIN pg_class parent ON parent.oid = foreign_key.confrelid
            JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
            WHERE foreign_key.contype = 'f'
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
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM {}",
            table.source()
        )))
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    fn export_order_by(table: &TransferTable) -> String {
        if table.primary_key_columns.is_empty() {
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
        }
    }

    #[allow(dead_code)] // used by tests/data_transfer_export.rs
    pub async fn export_transfer_table(
        pool: &DbPool,
        table: &TransferTable,
        columns: &[String],
    ) -> Result<Vec<Value>, ApiError> {
        Self::export_query(
            pool,
            &format!(
                "SELECT {} FROM {}{}",
                Self::export_column_list(table, columns)?,
                table.source(),
                Self::export_order_by(table)
            ),
        )
        .await
    }

    /// The quoted, comma-joined column list every export read projects.
    /// Column names come from catalog introspection (never request data), so
    /// quoting them is sufficient — the service's credential exclusions have
    /// already been applied by the caller.
    fn export_column_list(table: &TransferTable, columns: &[String]) -> Result<String, ApiError> {
        if columns.is_empty() {
            return Err(ApiError::Internal(format!(
                "{} has no exportable columns",
                table.table.key()
            )));
        }
        Ok(columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", "))
    }

    /// Open a SQL cursor over one transferable table's `row_to_json` payload.
    ///
    /// `export_transfer_table` materializes a whole table in memory before a
    /// single byte reaches the client; for a full-database backup that meant
    /// the request sat silent long enough for edge proxies to cut it, and peak
    /// RSS scaled with database size. The cursor lets the caller `FETCH`
    /// bounded batches instead: first byte goes out immediately, memory stays
    /// flat, and each `FETCH` is its own statement under the 120s
    /// `statement_timeout`. The cursor lives inside `tx` — the caller's
    /// transaction gives the whole export one consistent snapshot.
    ///
    /// `columns` is the projection — the service passes its exportable-column
    /// list so credential material (for example `bookings.pre_checkin_token`)
    /// never enters the payload at all.
    pub async fn declare_export_cursor(
        tx: &mut DbTransaction<'_>,
        table: &TransferTable,
        columns: &[String],
    ) -> Result<(), ApiError> {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DECLARE data_transfer_export_cursor NO SCROLL CURSOR FOR SELECT row_to_json(t)::text FROM (SELECT {} FROM {}{}) t",
            Self::export_column_list(table, columns)?,
            table.source(),
            Self::export_order_by(table)
        )))
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    /// Pull the next batch of rows from [`Self::declare_export_cursor`]. An
    /// empty result means the table is exhausted; close the cursor or let the
    /// transaction end before declaring the next one.
    pub async fn fetch_export_cursor(
        tx: &mut DbTransaction<'_>,
        limit: i64,
    ) -> Result<Vec<String>, ApiError> {
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "FETCH FORWARD {limit} FROM data_transfer_export_cursor"
        )))
        .fetch_all(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn close_export_cursor(tx: &mut DbTransaction<'_>) -> Result<(), ApiError> {
        sqlx::query("CLOSE data_transfer_export_cursor")
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn clear_transfer_tables(
        tx: &mut DbTransaction<'_>,
        tables: &[TransferTable],
    ) -> Result<(), ApiError> {
        for table in tables {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DELETE FROM {}",
                table.source()
            )))
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        }
        Ok(())
    }

    /// Insert one file row into `table` under `conflict_policy`:
    /// `Skip` keeps the existing row (`ON CONFLICT DO NOTHING`), `Fail` issues
    /// a plain `INSERT` so the first duplicate aborts the transaction, and
    /// `Update` rewrites every non-key column present in the row
    /// (`ON CONFLICT (pk) DO UPDATE SET col = EXCLUDED.col`). Tables without a
    /// primary key — or a row carrying only key columns — have nothing to
    /// update, so `Update` degrades to `DO NOTHING` there; a non-PK unique
    /// violation still aborts the import, which is what `update` should do.
    pub async fn insert_transfer_row(
        tx: &mut DbTransaction<'_>,
        table: &TransferTable,
        row: &serde_json::Map<String, Value>,
        conflict_policy: ConflictPolicy,
    ) -> Result<InsertRowOutcome, ApiError> {
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
                table.columns.contains(*column)
                    && !table.generated_columns.contains(*column)
                    && !NEVER_TRANSFERRED_COLUMNS
                        .contains(&(table.table.name.as_str(), column.as_str()))
            })
            .map(|(column, value)| (column.clone(), value.clone()))
            .collect();
        if values.is_empty() {
            return Ok(InsertRowOutcome::Skipped);
        }
        let columns = values
            .keys()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let quoted = table.table.quoted();
        let insert = format!(
            "INSERT INTO {quoted} ({columns}) OVERRIDING SYSTEM VALUE SELECT {columns} FROM jsonb_populate_record(NULL::{quoted}, $1::jsonb)"
        );

        // `xmax = 0` on the returned row is the standard "this was an insert,
        // not an update" discriminator for `ON CONFLICT DO UPDATE` — a fresh
        // tuple has no lock/version marker, a conflicted update carries the
        // transaction's.
        let set_columns: Vec<&String> = values
            .keys()
            .filter(|column| {
                !table.primary_key_columns.contains(*column)
                    && !table.generated_columns.contains(*column)
            })
            .collect();
        if conflict_policy == ConflictPolicy::Update
            && !table.primary_key_columns.is_empty()
            && !set_columns.is_empty()
        {
            let target = table
                .primary_key_columns
                .iter()
                .map(|column| quote_identifier(column))
                .collect::<Vec<_>>()
                .join(", ");
            let set_list = set_columns
                .iter()
                .map(|column| {
                    let quoted_column = quote_identifier(column);
                    format!("{quoted_column} = EXCLUDED.{quoted_column}")
                })
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "{insert} ON CONFLICT ({target}) DO UPDATE SET {set_list} RETURNING (xmax = 0)"
            );
            let inserted: bool = sqlx::query_scalar(sqlx::AssertSqlSafe(&*sql))
                .bind(Value::Object(values))
                .fetch_one(&mut **tx)
                .await
                .map_err(import_write_error)?;
            return Ok(if inserted {
                InsertRowOutcome::Inserted
            } else {
                InsertRowOutcome::Updated
            });
        }

        let sql = match conflict_policy {
            ConflictPolicy::Fail => insert,
            _ => format!("{insert} ON CONFLICT DO NOTHING"),
        };
        let affected = sqlx::query(sqlx::AssertSqlSafe(&*sql))
            .bind(Value::Object(values))
            .execute(&mut **tx)
            .await
            .map_err(import_write_error)?
            .rows_affected();
        Ok(if affected > 0 {
            InsertRowOutcome::Inserted
        } else {
            InsertRowOutcome::Skipped
        })
    }

    pub async fn set_transfer_triggers(
        tx: &mut DbTransaction<'_>,
        tables: &[TransferTable],
        enabled: bool,
    ) -> Result<(), ApiError> {
        let action = if enabled { "ENABLE" } else { "DISABLE" };
        for table in tables {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "ALTER TABLE {} {action} TRIGGER USER",
                table.table.quoted()
            )))
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        }
        Ok(())
    }

    /// Make every immediate foreign key on `tables` deferrable for the rest of
    /// the transaction, returning the ones actually changed.
    ///
    /// `DISABLE TRIGGER USER` does not touch the system triggers that enforce
    /// referential integrity, and `SET CONSTRAINTS ALL DEFERRED` only moves
    /// constraints that are already declared DEFERRABLE -- none of this
    /// schema's are. So foreign keys were checked per statement throughout an
    /// import, which no insert order can satisfy across a cycle like
    /// `users.guest_id` -> `guests` -> `guests.created_by` -> `users`.
    ///
    /// Deferring moves the check to COMMIT; it does not skip it. The import
    /// forces the checks with `SET CONSTRAINTS ALL IMMEDIATE` before it
    /// finishes, so bad data still fails the import.
    pub async fn relax_foreign_keys(
        tx: &mut DbTransaction<'_>,
        tables: &[TransferTable],
    ) -> Result<Vec<RelaxedForeignKey>, ApiError> {
        let keys: Vec<String> = tables.iter().map(|table| table.table.key()).collect();
        let rows: Vec<(String, String, String)> = sqlx::query_as(
            r#"
            SELECT namespace.nspname, child.relname, foreign_key.conname
            FROM pg_constraint foreign_key
            JOIN pg_class child ON child.oid = foreign_key.conrelid
            JOIN pg_namespace namespace ON namespace.oid = child.relnamespace
            WHERE foreign_key.contype = 'f'
              AND NOT foreign_key.condeferrable
              AND namespace.nspname || '.' || child.relname = ANY($1)
            ORDER BY 1, 2, 3
            "#,
        )
        .bind(&keys)
        .fetch_all(&mut **tx)
        .await
        .map_err(ApiError::from)?;

        let relaxed: Vec<RelaxedForeignKey> = rows
            .into_iter()
            .map(|(schema, name, constraint)| RelaxedForeignKey {
                table: QualifiedTable { schema, name },
                constraint,
            })
            .collect();

        for key in &relaxed {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "ALTER TABLE {} ALTER CONSTRAINT {} DEFERRABLE INITIALLY DEFERRED",
                key.table.quoted(),
                quote_identifier(&key.constraint)
            )))
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        }
        Ok(relaxed)
    }

    /// Return the foreign keys from [`Self::relax_foreign_keys`] to immediate
    /// checking, so an import leaves the schema exactly as it found it.
    ///
    /// Only constraints that were immediate to begin with are passed back here,
    /// so a genuinely DEFERRABLE constraint keeps its declared behaviour. A
    /// rollback restores these on its own -- this is the success path.
    pub async fn restore_foreign_keys(
        tx: &mut DbTransaction<'_>,
        relaxed: &[RelaxedForeignKey],
    ) -> Result<(), ApiError> {
        for key in relaxed {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "ALTER TABLE {} ALTER CONSTRAINT {} NOT DEFERRABLE INITIALLY IMMEDIATE",
                key.table.quoted(),
                quote_identifier(&key.constraint)
            )))
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
                sqlx::query(sqlx::AssertSqlSafe(&*reset_sql))
                    .bind(sequence)
                    .execute(&mut **tx)
                    .await
                    .map_err(ApiError::from)?;
            }
        }
        Ok(())
    }

    #[allow(dead_code)] // used by tests/data_transfer_export.rs
    pub async fn export_query(pool: &DbPool, query: &str) -> Result<Vec<Value>, ApiError> {
        // `export_query` doesn't take a table name directly, but its only
        // caller today (`export_table`) already validates the table before
        // building the query string passed in here.
        let rows: Vec<(Value,)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT row_to_json(t) FROM ({}) t",
            query
        )))
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows.into_iter().map(|row| row.0).collect())
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

    /// Every foreign-key column declared on the given child tables, resolved
    /// to its parent table and column. Unfiltered by parent: the service
    /// decides which parents sit outside the transferable set.
    pub async fn foreign_key_refs(
        pool: &DbPool,
        children: &[QualifiedTable],
    ) -> Result<Vec<ForeignKeyRef>, ApiError> {
        let keys: Vec<String> = children.iter().map(QualifiedTable::key).collect();
        let rows: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
            r#"
            SELECT child_namespace.nspname, child.relname, child_attribute.attname,
                   parent_namespace.nspname, parent.relname, parent_attribute.attname
            FROM pg_constraint foreign_key
            JOIN pg_class child ON child.oid = foreign_key.conrelid
            JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
            JOIN pg_class parent ON parent.oid = foreign_key.confrelid
            JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
            JOIN unnest(foreign_key.conkey) WITH ORDINALITY child_key(attnum, position) ON true
            JOIN pg_attribute child_attribute
              ON child_attribute.attrelid = child.oid AND child_attribute.attnum = child_key.attnum
            JOIN unnest(foreign_key.confkey) WITH ORDINALITY parent_key(attnum, position)
              ON parent_key.position = child_key.position
            JOIN pg_attribute parent_attribute
              ON parent_attribute.attrelid = parent.oid AND parent_attribute.attnum = parent_key.attnum
            WHERE foreign_key.contype = 'f'
              AND child_namespace.nspname || '.' || child.relname = ANY($1)
            ORDER BY 1, 2, 3
            "#,
        )
        .bind(&keys)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(rows
            .into_iter()
            .map(
                |(child_schema, child, column, parent_schema, parent, parent_column)| {
                    ForeignKeyRef {
                        child: QualifiedTable {
                            schema: child_schema,
                            name: child,
                        },
                        column,
                        parent: QualifiedTable {
                            schema: parent_schema,
                            name: parent,
                        },
                        parent_column,
                    }
                },
            )
            .collect())
    }

    /// The `information_schema.columns.udt_name` of one column — the import
    /// preview picks its batched `PkLookup` binding type from this declared
    /// type, never from the file's value shapes (a `varchar` key column
    /// holding all-numeric ids must still bind `text[]`).
    pub async fn column_udt_name(
        pool: &DbPool,
        table: &QualifiedTable,
        column: &str,
    ) -> Result<Option<String>, ApiError> {
        sqlx::query_scalar::<_, String>(
            "SELECT udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
        )
        .bind(&table.schema)
        .bind(&table.name)
        .bind(column)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    /// The existing values of `column` on `table`, rendered as text so the
    /// service can compare them against JSON row values of any type.
    /// Identifiers come from catalog introspection, never request data.
    pub async fn existing_key_values(
        pool: &DbPool,
        table: &QualifiedTable,
        column: &str,
    ) -> Result<HashSet<String>, ApiError> {
        let values: Vec<Option<String>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT {}::text FROM {}",
            quote_identifier(column),
            table.quoted()
        )))
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(values.into_iter().flatten().collect())
    }

    /// Which of `values` currently exist in `table.column`, compared as
    /// `::text` so JSON-normalized keys match any column type. Unlike
    /// [`Self::existing_key_values`] this probes only the given candidates —
    /// the preview's transferable-parent check uses it in chunks. The parent
    /// is queried without `ONLY` so references to partitioned parents see
    /// rows living in partitions, exactly like the foreign key itself does.
    pub async fn existing_values_any(
        pool: &DbPool,
        table: &QualifiedTable,
        column: &str,
        values: &[String],
    ) -> Result<HashSet<String>, ApiError> {
        if values.is_empty() {
            return Ok(HashSet::new());
        }
        let quoted_column = quote_identifier(column);
        let found: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT {quoted_column}::text FROM {} WHERE {quoted_column}::text = ANY($1)",
            table.quoted()
        )))
        .bind(values)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(found.into_iter().collect())
    }

    /// Batched primary-key existence check for the import-preview diff.
    /// Returns the matched keys as canonical text (`5`, lowercase uuid…) so
    /// the caller can compare them against normalized file values. Only
    /// single-column primary keys take this path; composite keys go through
    /// [`Self::row_exists_by_columns`].
    pub async fn existing_pk_values(
        pool: &DbPool,
        table: &TransferTable,
        lookup: &PkLookup,
    ) -> Result<HashSet<String>, ApiError> {
        let Some(column) = table.primary_key_columns.first() else {
            return Ok(HashSet::new());
        };
        let quoted_column = quote_identifier(column);
        let source = table.source();
        match lookup {
            PkLookup::Int(ids) => {
                if ids.is_empty() {
                    return Ok(HashSet::new());
                }
                let found: Vec<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                    "SELECT {quoted_column} FROM {source} WHERE {quoted_column} = ANY($1)"
                )))
                .bind(ids)
                .fetch_all(pool)
                .await
                .map_err(ApiError::from)?;
                Ok(found.into_iter().map(|id| id.to_string()).collect())
            }
            PkLookup::Uuid(ids) => {
                if ids.is_empty() {
                    return Ok(HashSet::new());
                }
                let found: Vec<uuid::Uuid> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                    "SELECT {quoted_column} FROM {source} WHERE {quoted_column} = ANY($1)"
                )))
                .bind(ids)
                .fetch_all(pool)
                .await
                .map_err(ApiError::from)?;
                Ok(found.into_iter().map(|id| id.to_string()).collect())
            }
            PkLookup::Text(keys) => {
                if keys.is_empty() {
                    return Ok(HashSet::new());
                }
                let found: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                    "SELECT {quoted_column}::text FROM {source} WHERE {quoted_column}::text = ANY($1)"
                )))
                .bind(keys)
                .fetch_all(pool)
                .await
                .map_err(ApiError::from)?;
                Ok(found.into_iter().collect())
            }
        }
    }

    /// Per-row existence probe for composite primary keys (small tables, so a
    /// query per row is affordable). Every value binds as text and compares
    /// through `::text` — the columns are a varchar/bigid mix the service
    /// cannot type reliably without a second catalog pass.
    pub async fn row_exists_by_columns(
        pool: &DbPool,
        table: &TransferTable,
        keys: &[(String, String)],
    ) -> Result<bool, ApiError> {
        if keys.is_empty() {
            return Ok(false);
        }
        let predicates = keys
            .iter()
            .enumerate()
            .map(|(index, (column, _))| {
                format!("{}::text = ${}", quote_identifier(column), index + 1)
            })
            .collect::<Vec<_>>()
            .join(" AND ");
        let mut query = sqlx::query_scalar::<_, bool>(sqlx::AssertSqlSafe(format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE {predicates})",
            table.source()
        )));
        for (_, value) in keys {
            query = query.bind(value);
        }
        query.fetch_one(pool).await.map_err(ApiError::from)
    }
}

/// Map a failed import write to the structured error surface: a uniqueness
/// violation (the `fail` conflict policy, or a non-PK unique index under
/// `skip`/`update`) is a client-visible conflict, not an opaque 500.
fn import_write_error(error: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(db_error) = &error
        && db_error.code().as_deref() == Some("23505")
    {
        return ApiError::Conflict(format!(
            "A row in the import conflicts with existing data ({})",
            db_error.constraint().unwrap_or("unique constraint")
        ));
    }
    ApiError::from(error)
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// `users` and `guests` reference each other in the V1 baseline, so every
    /// full import selected a cyclic graph and was rejected outright. Ordering
    /// must now succeed and still account for every selected table; the import
    /// defers the constraints so the unavoidable violation inside the cycle is
    /// checked at COMMIT instead of per statement.
    #[test]
    fn breaks_the_users_guests_cycle_instead_of_refusing_to_order() {
        let selected = vec![
            "public.bookings".to_string(),
            "public.guests".to_string(),
            "public.users".to_string(),
        ];
        let dependencies = HashMap::from([
            (
                "public.guests".to_string(),
                HashSet::from(["public.users".to_string()]),
            ),
            (
                "public.users".to_string(),
                HashSet::from(["public.guests".to_string()]),
            ),
            (
                "public.bookings".to_string(),
                HashSet::from(["public.guests".to_string()]),
            ),
        ]);

        let order = transfer_order(&selected, &dependencies).expect("a cycle must still order");

        let mut sorted = order.clone();
        sorted.sort();
        assert_eq!(
            sorted, selected,
            "every selected table must be emitted once"
        );
        // The cycle is broken, but edges outside it are still honoured.
        let position = |table: &str| order.iter().position(|name| name == table).unwrap();
        assert!(
            position("public.guests") < position("public.bookings"),
            "acyclic edges must still order parents first; got {order:?}"
        );
    }

    /// A second call must produce the same order, or an import that works once
    /// fails the next time for no visible reason.
    #[test]
    fn cycle_breaking_is_deterministic() {
        let selected = vec!["public.guests".to_string(), "public.users".to_string()];
        let dependencies = HashMap::from([
            (
                "public.guests".to_string(),
                HashSet::from(["public.users".to_string()]),
            ),
            (
                "public.users".to_string(),
                HashSet::from(["public.guests".to_string()]),
            ),
        ]);

        let first = transfer_order(&selected, &dependencies).expect("cycle must order");
        for _ in 0..16 {
            let again = transfer_order(&selected, &dependencies).expect("cycle must order");
            assert_eq!(first, again, "cycle breaking must not vary between runs");
        }
    }

    #[test]
    fn partitioned_parent_is_read_and_cleared_through_its_routing_table() {
        let parent = TransferTable {
            table: QualifiedTable::parse("public.audit_logs").unwrap(),
            is_partitioned: true,
            columns: HashSet::new(),
            ordered_columns: Vec::new(),
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
