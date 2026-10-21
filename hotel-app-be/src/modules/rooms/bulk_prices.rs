//! Bulk room-type price updates.
//!
//! Staff change `base_price`, `weekday_rate` and `weekend_rate` for many room
//! types at once. The preview endpoint and the update endpoint share one pure
//! computation ([`compute_changes`]), so what staff confirm is exactly what is
//! written. The update runs in a single transaction: the target rows are
//! locked `FOR UPDATE`, written, and the audit row is inserted in the same
//! transaction (all-or-nothing). The most recent bulk change can be reverted
//! once, provided no price moved since.

use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use std::collections::BTreeMap;
use std::str::FromStr;

/// A change above this many percent (on any field) needs explicit confirmation.
pub const LARGE_CHANGE_PERCENT: i64 = 30;
const MAX_REASON_CHARS: usize = 500;
const MIN_REASON_CHARS: usize = 3;
/// Upper bound on a resulting price; mirrors the `numeric(10,2)` column.
const MAX_PRICE: i64 = 99_999_999;

pub const ACTION_UPDATED: &str = "room_prices_bulk_updated";
pub const ACTION_REVERTED: &str = "room_prices_bulk_reverted";

pub const FIELD_BASE: &str = "base_price";
pub const FIELD_WEEKDAY: &str = "weekday_rate";
pub const FIELD_WEEKEND: &str = "weekend_rate";
const ALL_FIELDS: [&str; 3] = [FIELD_BASE, FIELD_WEEKDAY, FIELD_WEEKEND];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PriceMethod {
    /// Every selected field becomes `value`.
    SetExact,
    /// `value` is a signed percentage (`-10` lowers by 10%).
    Percent,
    /// `value` is a signed RM amount (`-5` lowers by RM 5).
    Amount,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BulkPriceRequest {
    /// Room types to change; omitted or empty means every room type.
    #[serde(default)]
    pub room_type_ids: Vec<i64>,
    /// Subset of `base_price`, `weekday_rate`, `weekend_rate`.
    pub fields: Vec<String>,
    pub method: PriceMethod,
    pub value: f64,
    /// Optional rounding step: 1, 5 or 10 (nearest RM).
    #[serde(default)]
    pub round_to: Option<u32>,
    /// Required for the update and revert endpoints; ignored by preview.
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub confirm_large_change: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FieldChange {
    pub field: String,
    pub old_price: Decimal,
    pub new_price: Decimal,
    pub delta: Decimal,
    /// `None` when the old price was zero.
    pub delta_percent: Option<Decimal>,
    pub changed: bool,
    pub large: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RoomTypePriceChange {
    pub room_type_id: i64,
    pub code: String,
    pub name: String,
    pub changes: Vec<FieldChange>,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BulkPricePreview {
    pub rows: Vec<RoomTypePriceChange>,
    pub changed_room_types: usize,
    pub changed_fields: usize,
    pub requires_confirmation: bool,
    pub large_change_percent: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BulkPriceResult {
    pub batch_id: String,
    pub preview: BulkPricePreview,
}

#[derive(Debug, Clone, Serialize)]
pub struct LastBulkPriceChange {
    pub batch_id: String,
    pub action: String,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub created_at: DateTime<Utc>,
    pub reason: Option<String>,
    pub room_types: usize,
    /// True only for an update that has not been reverted.
    pub can_revert: bool,
}

/// Current prices of one room type.
#[derive(Debug, Clone)]
pub struct PriceRow {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub base_price: Decimal,
    pub weekday_rate: Option<Decimal>,
    pub weekend_rate: Option<Decimal>,
}

impl PriceRow {
    fn field(&self, field: &str) -> Option<Decimal> {
        match field {
            FIELD_BASE => Some(self.base_price),
            FIELD_WEEKDAY => self.weekday_rate,
            FIELD_WEEKEND => self.weekend_rate,
            _ => None,
        }
    }
}

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError::BadRequest(msg.into())
}

fn db_err(e: sqlx::Error) -> ApiError {
    ApiError::Database(e.to_string())
}

fn parse_decimal(value: f64) -> Result<Decimal, ApiError> {
    if !value.is_finite() {
        return Err(bad("Value must be a finite number"));
    }
    Decimal::from_str(&format!("{value}")).map_err(|_| bad("Value is out of range"))
}

fn validate_fields(fields: &[String]) -> Result<Vec<&'static str>, ApiError> {
    let mut out: Vec<&'static str> = Vec::new();
    for name in fields {
        let known = ALL_FIELDS
            .iter()
            .find(|f| **f == name.as_str())
            .ok_or_else(|| bad(format!("Unknown price field '{name}'")))?;
        if !out.contains(known) {
            out.push(known);
        }
    }
    if out.is_empty() {
        return Err(bad("Choose at least one price field"));
    }
    Ok(out)
}

fn round_money(d: Decimal) -> Decimal {
    d.round_dp_with_strategy(2, rust_decimal::RoundingStrategy::MidpointAwayFromZero)
}

/// Pure price computation shared by preview, update and tests.
pub fn compute_changes(
    rows: &[PriceRow],
    req: &BulkPriceRequest,
) -> Result<BulkPricePreview, ApiError> {
    let fields = validate_fields(&req.fields)?;
    let value = parse_decimal(req.value)?;
    let step = match req.round_to {
        None => None,
        Some(s @ (1 | 5 | 10)) => Some(Decimal::from(s)),
        Some(_) => return Err(bad("Rounding must be 1, 5 or 10")),
    };
    match req.method {
        PriceMethod::SetExact => {
            if value <= Decimal::ZERO {
                return Err(bad("The new price must be greater than zero"));
            }
        }
        PriceMethod::Percent => {
            if value <= Decimal::from(-100) {
                return Err(bad("A decrease cannot be 100% or more"));
            }
        }
        PriceMethod::Amount => {}
    }
    let limit = Decimal::from(LARGE_CHANGE_PERCENT);
    let max_price = Decimal::from(MAX_PRICE);

    let mut out_rows = Vec::with_capacity(rows.len());
    let mut changed_fields = 0usize;
    let mut changed_types = 0usize;
    let mut requires_confirmation = false;

    for row in rows {
        let mut changes = Vec::new();
        for field in &fields {
            // weekday/weekend fall back to base when unset; leave them unset.
            let Some(old) = row.field(field) else {
                continue;
            };
            let mut new = match req.method {
                PriceMethod::SetExact => value,
                PriceMethod::Percent => old * (Decimal::ONE + value / Decimal::from(100)),
                PriceMethod::Amount => old + value,
            };
            new = round_money(new);
            if let Some(step) = step {
                new = round_money((new / step).round() * step);
            }
            if new <= Decimal::ZERO {
                return Err(bad(format!(
                    "{} {} would become zero or negative",
                    row.code, field
                )));
            }
            if new > max_price {
                return Err(bad(format!("{} {} is too large", row.code, field)));
            }
            let delta = new - old;
            let delta_percent = if old > Decimal::ZERO {
                Some(round_money(delta / old * Decimal::from(100)))
            } else {
                None
            };
            let changed = delta != Decimal::ZERO;
            let large = delta_percent.is_some_and(|p| p.abs() > limit);
            if changed {
                changed_fields += 1;
            }
            requires_confirmation |= large;
            changes.push(FieldChange {
                field: (*field).to_string(),
                old_price: old,
                new_price: new,
                delta,
                delta_percent,
                changed,
                large,
            });
        }
        let changed = changes.iter().any(|c| c.changed);
        if changed {
            changed_types += 1;
        }
        out_rows.push(RoomTypePriceChange {
            room_type_id: row.id,
            code: row.code.clone(),
            name: row.name.clone(),
            changes,
            changed,
        });
    }

    Ok(BulkPricePreview {
        rows: out_rows,
        changed_room_types: changed_types,
        changed_fields,
        requires_confirmation,
        large_change_percent: LARGE_CHANGE_PERCENT,
    })
}

fn clean_reason(reason: &Option<String>) -> Result<String, ApiError> {
    let cleaned = Sanitizer::sanitize_text(reason.as_deref().unwrap_or(""))
        .trim()
        .to_string();
    let len = cleaned.chars().count();
    if len < MIN_REASON_CHARS {
        return Err(bad("A reason is required"));
    }
    if len > MAX_REASON_CHARS {
        return Err(bad(format!(
            "Reason must be at most {MAX_REASON_CHARS} characters"
        )));
    }
    Ok(cleaned)
}

async fn fetch_rows(
    conn: &mut PgConnection,
    ids: &[i64],
    lock: bool,
) -> Result<Vec<PriceRow>, ApiError> {
    let rows = if lock {
        sqlx::query(
            "SELECT id, code, name, base_price, weekday_rate, weekend_rate \
             FROM room_types \
             WHERE (cardinality($1::bigint[]) = 0 OR id = ANY($1)) \
             ORDER BY sort_order, id FOR UPDATE",
        )
        .bind(ids)
        .fetch_all(conn)
        .await
    } else {
        sqlx::query(
            "SELECT id, code, name, base_price, weekday_rate, weekend_rate \
             FROM room_types \
             WHERE (cardinality($1::bigint[]) = 0 OR id = ANY($1)) \
             ORDER BY sort_order, id",
        )
        .bind(ids)
        .fetch_all(conn)
        .await
    }
    .map_err(db_err)?;
    rows.iter()
        .map(|r| {
            Ok(PriceRow {
                id: r.try_get("id").map_err(db_err)?,
                code: r.try_get("code").map_err(db_err)?,
                name: r.try_get("name").map_err(db_err)?,
                base_price: r.try_get("base_price").map_err(db_err)?,
                weekday_rate: r.try_get("weekday_rate").map_err(db_err)?,
                weekend_rate: r.try_get("weekend_rate").map_err(db_err)?,
            })
        })
        .collect()
}

fn ensure_all_found(rows: &[PriceRow], ids: &[i64]) -> Result<(), ApiError> {
    if rows.is_empty() {
        return Err(ApiError::NotFound("No room types to update".into()));
    }
    if let Some(missing) = ids.iter().find(|id| !rows.iter().any(|r| r.id == **id)) {
        return Err(ApiError::NotFound(format!("Room type {missing} not found")));
    }
    Ok(())
}

fn dedup_ids(ids: &[i64]) -> Vec<i64> {
    let mut v = ids.to_vec();
    v.sort_unstable();
    v.dedup();
    v
}

/// Dry run: nothing is written and no lock is taken.
pub async fn preview(pool: &DbPool, req: &BulkPriceRequest) -> Result<BulkPricePreview, ApiError> {
    let ids = dedup_ids(&req.room_type_ids);
    let mut conn = pool.acquire().await.map_err(db_err)?;
    let rows = fetch_rows(&mut conn, &ids, false).await?;
    ensure_all_found(&rows, &ids)?;
    compute_changes(&rows, req)
}

async fn write_prices(
    tx: &mut DbTransaction<'_>,
    id: i64,
    values: &[(&str, Decimal)],
) -> Result<(), ApiError> {
    let pick = |name: &str| values.iter().find(|(f, _)| *f == name).map(|(_, v)| *v);
    sqlx::query(
        "UPDATE room_types SET \
            base_price = COALESCE($2, base_price), \
            weekday_rate = COALESCE($3, weekday_rate), \
            weekend_rate = COALESCE($4, weekend_rate), \
            updated_at = CURRENT_TIMESTAMP \
         WHERE id = $1",
    )
    .bind(id)
    .bind(pick(FIELD_BASE))
    .bind(pick(FIELD_WEEKDAY))
    .bind(pick(FIELD_WEEKEND))
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(())
}

fn audit_rows(preview: &BulkPricePreview) -> Value {
    Value::Array(
        preview
            .rows
            .iter()
            .filter(|r| r.changed)
            .map(|r| {
                let mut old = BTreeMap::new();
                let mut new = BTreeMap::new();
                for c in r.changes.iter().filter(|c| c.changed) {
                    old.insert(c.field.clone(), c.old_price.to_string());
                    new.insert(c.field.clone(), c.new_price.to_string());
                }
                json!({"room_type_id": r.room_type_id, "code": r.code, "name": r.name, "old": old, "new": new})
            })
            .collect(),
    )
}

/// Apply the change in one transaction and audit it.
pub async fn apply(
    pool: &DbPool,
    user_id: i64,
    req: &BulkPriceRequest,
) -> Result<BulkPriceResult, ApiError> {
    let reason = clean_reason(&req.reason)?;
    let ids = dedup_ids(&req.room_type_ids);
    let mut tx = pool.begin().await.map_err(db_err)?;
    let rows = fetch_rows(&mut tx, &ids, true).await?;
    ensure_all_found(&rows, &ids)?;
    let preview = compute_changes(&rows, req)?;
    if preview.requires_confirmation && !req.confirm_large_change {
        return Err(bad(format!(
            "A change of more than {LARGE_CHANGE_PERCENT}% needs explicit confirmation"
        )));
    }
    if preview.changed_fields == 0 {
        return Err(bad("These settings would not change any price"));
    }
    for row in preview.rows.iter().filter(|r| r.changed) {
        let values: Vec<(&str, Decimal)> = row
            .changes
            .iter()
            .filter(|c| c.changed)
            .map(|c| (c.field.as_str(), c.new_price))
            .collect();
        write_prices(&mut tx, row.room_type_id, &values).await?;
    }
    let batch_id = uuid::Uuid::new_v4().to_string();
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(user_id),
            action: ACTION_UPDATED,
            resource_type: "room_type",
            details: Some(json!({
                "batch_id": batch_id,
                "method": req.method,
                "value": parse_decimal(req.value)?.to_string(),
                "round_to": req.round_to,
                "fields": validate_fields(&req.fields)?,
                "scope": if ids.is_empty() { "all" } else { "selected" },
                "reason": reason,
                "confirmed_large_change": preview.requires_confirmation,
                "rows": audit_rows(&preview),
            })),
            ..Default::default()
        },
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(BulkPriceResult { batch_id, preview })
}

struct LastRow {
    action: String,
    user_id: Option<i64>,
    username: Option<String>,
    details: Value,
    created_at: DateTime<Utc>,
}

async fn fetch_last(conn: &mut PgConnection) -> Result<Option<LastRow>, ApiError> {
    let row = sqlx::query(
        "SELECT a.action, a.user_id, u.username, a.details, a.created_at \
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id \
         WHERE a.action IN ($1, $2) \
         ORDER BY a.created_at DESC, a.id DESC LIMIT 1",
    )
    .bind(ACTION_UPDATED)
    .bind(ACTION_REVERTED)
    .fetch_optional(conn)
    .await
    .map_err(db_err)?;
    row.map(|r| {
        Ok(LastRow {
            action: r.try_get("action").map_err(db_err)?,
            user_id: r.try_get("user_id").map_err(db_err)?,
            username: r.try_get("username").map_err(db_err)?,
            details: r
                .try_get::<Option<Value>, _>("details")
                .map_err(db_err)?
                .unwrap_or(Value::Null),
            created_at: r.try_get("created_at").map_err(db_err)?,
        })
    })
    .transpose()
}

fn last_to_view(last: &LastRow) -> LastBulkPriceChange {
    let key = if last.action == ACTION_REVERTED {
        "reverts_batch_id"
    } else {
        "batch_id"
    };
    LastBulkPriceChange {
        batch_id: last
            .details
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        action: last.action.clone(),
        user_id: last.user_id,
        username: last.username.clone(),
        created_at: last.created_at,
        reason: last
            .details
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_string),
        room_types: last
            .details
            .get("rows")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        can_revert: last.action == ACTION_UPDATED,
    }
}

/// The latest bulk update/revert, for the "last change" note in the dialog.
pub async fn last_change(pool: &DbPool) -> Result<Option<LastBulkPriceChange>, ApiError> {
    let mut conn = pool.acquire().await.map_err(db_err)?;
    Ok(fetch_last(&mut conn).await?.as_ref().map(last_to_view))
}

fn dec(v: &Value) -> Option<Decimal> {
    v.as_str().and_then(|s| Decimal::from_str(s).ok())
}

/// Undo the most recent bulk update (one level), if nothing moved since.
pub async fn revert_last(
    pool: &DbPool,
    user_id: i64,
    reason: &Option<String>,
) -> Result<LastBulkPriceChange, ApiError> {
    let reason = clean_reason(reason)?;
    let mut tx = pool.begin().await.map_err(db_err)?;
    // Lock every room type first so concurrent bulk operations serialise, then
    // read the audit head: a second revert sees the first one's audit row.
    let current = fetch_rows(&mut tx, &[], true).await?;
    let last = fetch_last(&mut tx)
        .await?
        .filter(|l| l.action == ACTION_UPDATED)
        .ok_or_else(|| ApiError::Conflict("There is no bulk price update to revert".into()))?;
    let batch_id = last
        .details
        .get("batch_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let rows = last
        .details
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::Internal("Bulk update audit entry is malformed".into()))?;

    let mut restore: Vec<(i64, Vec<(&'static str, Decimal)>)> = Vec::new();
    for entry in rows {
        let id = entry
            .get("room_type_id")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let Some(row) = current.iter().find(|r| r.id == id) else {
            return Err(ApiError::Conflict(
                "A room type from that update no longer exists".into(),
            ));
        };
        let mut values = Vec::new();
        for field in ALL_FIELDS {
            let (Some(old), Some(new)) = (
                entry.get("old").and_then(|o| o.get(field)).and_then(dec),
                entry.get("new").and_then(|o| o.get(field)).and_then(dec),
            ) else {
                continue;
            };
            if row.field(field) != Some(new) {
                return Err(ApiError::Conflict(format!(
                    "{} {} was changed after the bulk update; revert is no longer safe",
                    row.code, field
                )));
            }
            values.push((field, old));
        }
        restore.push((id, values));
    }
    for (id, values) in &restore {
        write_prices(&mut tx, *id, values).await?;
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(user_id),
            action: ACTION_REVERTED,
            resource_type: "room_type",
            details: Some(json!({
                "reverts_batch_id": batch_id,
                "reason": reason,
                "rows": rows,
            })),
            ..Default::default()
        },
    )
    .await?;
    let view = fetch_last(&mut tx).await?.as_ref().map(last_to_view);
    tx.commit().await.map_err(db_err)?;
    view.ok_or_else(|| ApiError::Internal("Revert audit entry missing".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: i64, base: i64, wd: Option<i64>, we: Option<i64>) -> PriceRow {
        PriceRow {
            id,
            code: format!("T{id}"),
            name: format!("Type {id}"),
            base_price: Decimal::from(base),
            weekday_rate: wd.map(Decimal::from),
            weekend_rate: we.map(Decimal::from),
        }
    }

    fn req(method: PriceMethod, value: f64, fields: &[&str]) -> BulkPriceRequest {
        BulkPriceRequest {
            room_type_ids: vec![],
            fields: fields.iter().map(|s| s.to_string()).collect(),
            method,
            value,
            round_to: None,
            reason: Some("test".into()),
            confirm_large_change: false,
        }
    }

    fn price(p: &BulkPricePreview, row: usize, col: usize) -> Decimal {
        p.rows[row].changes[col].new_price
    }

    #[test]
    fn percent_increase_applies_to_all_selected_fields() {
        let rows = [row(1, 100, Some(100), Some(110))];
        let p = compute_changes(&rows, &req(PriceMethod::Percent, 10.0, &ALL_FIELDS)).unwrap();
        assert_eq!(price(&p, 0, 0), Decimal::from(110));
        assert_eq!(price(&p, 0, 1), Decimal::from(110));
        assert_eq!(price(&p, 0, 2), Decimal::from(121));
        assert_eq!(p.changed_room_types, 1);
        assert_eq!(p.changed_fields, 3);
        assert!(!p.requires_confirmation);
    }

    #[test]
    fn amount_decrease_and_exact_set() {
        let rows = [row(1, 100, Some(100), None)];
        let p = compute_changes(&rows, &req(PriceMethod::Amount, -5.5, &[FIELD_BASE])).unwrap();
        assert_eq!(price(&p, 0, 0), Decimal::new(9450, 2));
        let p = compute_changes(&rows, &req(PriceMethod::SetExact, 120.0, &ALL_FIELDS)).unwrap();
        // weekend is unset and stays unset
        assert_eq!(p.rows[0].changes.len(), 2);
        assert_eq!(price(&p, 0, 1), Decimal::from(120));
    }

    #[test]
    fn rounding_to_nearest_step() {
        let rows = [row(1, 95, None, None)];
        let mut r = req(PriceMethod::Percent, 7.0, &[FIELD_BASE]); // 101.65
        r.round_to = Some(5);
        let p = compute_changes(&rows, &r).unwrap();
        assert_eq!(price(&p, 0, 0), Decimal::from(100));
        r.round_to = Some(7);
        assert!(compute_changes(&rows, &r).is_err());
    }

    #[test]
    fn rejects_zero_negative_and_bad_input() {
        let rows = [row(1, 95, None, None)];
        assert!(compute_changes(&rows, &req(PriceMethod::Amount, -95.0, &[FIELD_BASE])).is_err());
        assert!(compute_changes(&rows, &req(PriceMethod::Amount, -200.0, &[FIELD_BASE])).is_err());
        assert!(compute_changes(&rows, &req(PriceMethod::Percent, -100.0, &[FIELD_BASE])).is_err());
        assert!(compute_changes(&rows, &req(PriceMethod::SetExact, 0.0, &[FIELD_BASE])).is_err());
        assert!(
            compute_changes(&rows, &req(PriceMethod::SetExact, f64::NAN, &[FIELD_BASE])).is_err()
        );
        assert!(compute_changes(&rows, &req(PriceMethod::SetExact, 10.0, &[])).is_err());
        assert!(
            compute_changes(
                &rows,
                &req(PriceMethod::SetExact, 10.0, &["extra_bed_charge"])
            )
            .is_err()
        );
    }

    #[test]
    fn large_change_guard_triggers_above_thirty_percent_only() {
        let rows = [row(1, 100, None, None)];
        let p = compute_changes(&rows, &req(PriceMethod::Percent, 30.0, &[FIELD_BASE])).unwrap();
        assert!(!p.requires_confirmation);
        let p = compute_changes(&rows, &req(PriceMethod::Percent, 30.5, &[FIELD_BASE])).unwrap();
        assert!(p.requires_confirmation);
        let p = compute_changes(&rows, &req(PriceMethod::Percent, -31.0, &[FIELD_BASE])).unwrap();
        assert!(p.requires_confirmation && p.rows[0].changes[0].large);
    }

    #[test]
    fn unchanged_rows_are_flagged_unchanged() {
        let rows = [row(1, 100, None, None)];
        let p = compute_changes(&rows, &req(PriceMethod::Percent, 0.0, &[FIELD_BASE])).unwrap();
        assert_eq!(p.changed_fields, 0);
        assert!(!p.rows[0].changed);
    }

    #[test]
    fn reason_is_required_and_trimmed() {
        assert!(clean_reason(&None).is_err());
        assert!(clean_reason(&Some("  ab ".into())).is_err());
        assert_eq!(
            clean_reason(&Some("  peak season ".into())).unwrap(),
            "peak season"
        );
        assert!(clean_reason(&Some("x".repeat(501))).is_err());
    }
}
