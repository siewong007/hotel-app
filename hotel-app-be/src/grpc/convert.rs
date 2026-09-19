//! Protobuf ↔ domain-model conversions shared by the gRPC adapters.
//!
//! Three contracts from the Phase 1 mapping
//! (`docs/architecture/grpc-migration/phase-1-contract.md`) are enforced here so
//! every service converts identically:
//!
//! - **Resource names**: `rooms/42`, `bookings/100`, … — thin strings over
//!   the int64 keys REST uses in URLs. `parse_name` validates the expected
//!   collection prefix so `rooms/abc` or `guests/5` where a room is expected
//!   fails fast with INVALID_ARGUMENT.
//! - **Money**: `Money.amount_minor` ↔ the database's major-unit
//!   `numeric(…,2)` `Decimal`/`f64` columns (×100/÷100, exact at 2dp).
//! - **Dates vs instants**: `google.type.Date` ↔ `NaiveDate` business dates;
//!   `google.protobuf.Timestamp` ↔ `DateTime<Utc>` true instants. REST's
//!   "YYYY-MM-DD" *strings* on status inputs stay strings internally —
//!   adapters convert proto Dates to that exact format so the service layer
//!   sees the identical input REST would send.

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Utc};
use prost_types::{ListValue, Struct, Timestamp, Value, value::Kind};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use tonic::Status;

use super::pb::google::r#type as gtype;
use super::pb::hotel::common::v1 as common;

// ── Resource names ─────────────────────────────────────────────────────

/// Parses `"{collection}/{id}"` into the int64 id. An empty name is allowed
/// for optional references and maps to `None`.
pub fn parse_name(name: &str, collection: &str) -> Result<Option<i64>, Status> {
    if name.is_empty() {
        return Ok(None);
    }
    let id = name
        .strip_prefix(collection)
        .and_then(|s| s.strip_prefix('/'))
        .and_then(|s| s.parse::<i64>().ok())
        .ok_or_else(|| {
            Status::invalid_argument(format!(
                "invalid resource name '{name}', expected '{collection}/{{id}}'"
            ))
        })?;
    Ok(Some(id))
}

/// Parses `"{collection}/{id}"` where the reference is required.
pub fn require_name(name: &str, collection: &str) -> Result<i64, Status> {
    parse_name(name, collection)?.ok_or_else(|| {
        Status::invalid_argument(format!(
            "missing resource name, expected '{collection}/{{id}}'"
        ))
    })
}

pub fn room_name(id: i64) -> String {
    format!("rooms/{id}")
}
pub fn room_type_name(id: i64) -> String {
    format!("roomTypes/{id}")
}
pub fn booking_name(id: i64) -> String {
    format!("bookings/{id}")
}
pub fn guest_name(id: i64) -> String {
    format!("guests/{id}")
}
pub fn user_name(id: i64) -> String {
    format!("users/{id}")
}
pub fn task_name(id: i64) -> String {
    format!("housekeepingTasks/{id}")
}
pub fn ticket_name(id: i64) -> String {
    format!("maintenanceTickets/{id}")
}
pub fn review_name(id: i64) -> String {
    format!("reviews/{id}")
}

// ── Money ──────────────────────────────────────────────────────────────

/// DB major-unit `Decimal` → `Money` minor units. `numeric(…,2)` values make
/// the ×100 exact; `round` guards the 4-dp columns by matching how every
/// other display path treats sub-cent residue.
pub fn money(amount: &Decimal, currency: &str) -> common::Money {
    common::Money {
        amount_minor: (amount * Decimal::from(100))
            .round()
            .to_i64()
            .unwrap_or_default(),
        currency_code: currency.to_string(),
    }
}

pub fn opt_money(amount: Option<&Decimal>, currency: &str) -> Option<common::Money> {
    amount.map(|a| money(a, currency))
}

/// `Money` → f64 major units for the legacy REST input models
/// (`f64` prices). `None`/zero-value input maps to `None` so optional
/// price fields behave like absent JSON fields.
pub fn money_to_f64(m: Option<&common::Money>) -> Option<f64> {
    m.map(|m| m.amount_minor as f64 / 100.0)
}

/// `Money` → major-unit `Decimal` for the maintenance cost inputs
/// (exact: minor units ÷ 100 at 2dp).
pub fn money_to_decimal(m: Option<&common::Money>) -> Option<Decimal> {
    m.map(|m| Decimal::new(m.amount_minor, 2))
}

// ── Decimal (google.type.Decimal, non-money exact numerics) ────────────

pub fn decimal(d: &Decimal) -> gtype::Decimal {
    gtype::Decimal {
        value: d.to_string(),
    }
}

pub fn opt_decimal(d: Option<&Decimal>) -> Option<gtype::Decimal> {
    d.map(decimal)
}

/// `google.type.Decimal` → `rust_decimal::Decimal` for inputs.
pub fn decimal_from_pb(d: Option<&gtype::Decimal>) -> Result<Option<Decimal>, Status> {
    d.map(|d| {
        d.value
            .parse::<Decimal>()
            .map_err(|_| Status::invalid_argument(format!("invalid decimal value '{}'", d.value)))
    })
    .transpose()
}

// ── Instants (google.protobuf.Timestamp ↔ DateTime<Utc>) ───────────────

pub fn ts(dt: &DateTime<Utc>) -> Timestamp {
    Timestamp {
        seconds: dt.timestamp(),
        nanos: dt.timestamp_subsec_nanos() as i32,
    }
}

pub fn opt_ts(dt: &Option<DateTime<Utc>>) -> Option<Timestamp> {
    dt.as_ref().map(ts)
}

/// Proto timestamp → RFC 3339 string, for the couple of REST inputs that
/// take a string datetime.
pub fn ts_to_rfc3339(t: Option<&Timestamp>) -> Result<Option<String>, Status> {
    t.map(|t| {
        DateTime::from_timestamp(t.seconds, t.nanos as u32)
            .map(|dt| dt.to_rfc3339())
            .ok_or_else(|| Status::invalid_argument("invalid timestamp value"))
    })
    .transpose()
}

/// Proto timestamp → `DateTime<Utc>` for inputs stored as timestamptz.
pub fn ts_to_datetime(t: Option<&Timestamp>) -> Result<Option<DateTime<Utc>>, Status> {
    t.map(|t| {
        DateTime::from_timestamp(t.seconds, t.nanos as u32)
            .ok_or_else(|| Status::invalid_argument("invalid timestamp value"))
    })
    .transpose()
}

// ── Business dates (google.type.Date ↔ NaiveDate) ──────────────────────

pub fn date(d: &NaiveDate) -> gtype::Date {
    gtype::Date {
        year: d.format("%Y").to_string().parse().unwrap_or_default(),
        month: d.format("%m").to_string().parse().unwrap_or_default(),
        day: d.format("%d").to_string().parse().unwrap_or_default(),
    }
}

pub fn opt_date(d: &Option<NaiveDate>) -> Option<gtype::Date> {
    d.as_ref().map(date)
}

/// Proto Date → NaiveDate. An absent field maps to `None`; a present but
/// invalid calendar date (e.g. Feb 30) is INVALID_ARGUMENT.
pub fn date_from_pb(d: Option<&gtype::Date>) -> Result<Option<NaiveDate>, Status> {
    d.map(|d| {
        NaiveDate::from_ymd_opt(d.year, d.month as u32, d.day as u32).ok_or_else(|| {
            Status::invalid_argument(format!(
                "invalid date {:04}-{:02}-{:02}",
                d.year, d.month, d.day
            ))
        })
    })
    .transpose()
}

/// Proto Date → the "YYYY-MM-DD" string shape REST status inputs carry.
pub fn date_to_ymd(d: Option<&gtype::Date>) -> Result<Option<String>, Status> {
    Ok(date_from_pb(d)?.map(|nd| nd.format("%Y-%m-%d").to_string()))
}

// ── JSON ↔ google.protobuf.Value ───────────────────────────────────────

/// serde_json ↔ prost `Value`. Covers every JSON shape (unlike Struct,
/// which only holds objects) so `items_used`/`images` round-trip whatever
/// REST accepted.
pub fn json_to_value(v: &serde_json::Value) -> Value {
    let kind = match v {
        serde_json::Value::Null => Kind::NullValue(0),
        serde_json::Value::Bool(b) => Kind::BoolValue(*b),
        serde_json::Value::Number(n) => Kind::NumberValue(n.as_f64().unwrap_or_default()),
        serde_json::Value::String(s) => Kind::StringValue(s.clone()),
        serde_json::Value::Array(items) => Kind::ListValue(ListValue {
            values: items.iter().map(json_to_value).collect(),
        }),
        serde_json::Value::Object(map) => Kind::StructValue(Struct {
            fields: map
                .iter()
                .map(|(k, v)| (k.clone(), json_to_value(v)))
                .collect::<BTreeMap<_, _>>(),
        }),
    };
    Value { kind: Some(kind) }
}

pub fn value_to_json(v: &Value) -> serde_json::Value {
    match &v.kind {
        None | Some(Kind::NullValue(_)) => serde_json::Value::Null,
        Some(Kind::BoolValue(b)) => (*b).into(),
        Some(Kind::NumberValue(n)) => serde_json::Number::from_f64(*n)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Some(Kind::StringValue(s)) => s.clone().into(),
        Some(Kind::ListValue(l)) => {
            serde_json::Value::Array(l.values.iter().map(value_to_json).collect())
        }
        Some(Kind::StructValue(s)) => serde_json::Value::Object(
            s.fields
                .iter()
                .map(|(k, v)| (k.clone(), value_to_json(v)))
                .collect(),
        ),
    }
}

// ── Offset pagination ──────────────────────────────────────────────────

/// AIP offset pagination over an already-materialized `Vec`. `page_token` is
/// the decimal offset; `page_size <= 0` returns everything (matching REST,
/// which returns full arrays on these endpoints). Returns `(page_items,
/// next_page_token)`.
pub fn paginate<T: Clone>(items: &[T], page_size: i32, page_token: &str) -> (Vec<T>, String) {
    let offset: usize = page_token.parse().unwrap_or(0);
    let slice: Vec<T> = items.iter().skip(offset).cloned().collect();
    if page_size <= 0 {
        return (slice, String::new());
    }
    let size = page_size as usize;
    let next = if slice.len() > size {
        (offset + size).to_string()
    } else {
        String::new()
    };
    (slice.into_iter().take(size).collect(), next)
}
