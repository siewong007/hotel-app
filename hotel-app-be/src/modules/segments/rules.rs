//! Segment rule compilation: stored JSONB rules → a parameterized SQL
//! predicate over the `guests` table (alias `g`).
//!
//! Rules are disjunctive-normal-form: `groups` are OR-ed, each group's
//! `conditions` are AND-ed. Field and operator names come from a whitelist —
//! only VALUES are bound parameters, so user input can never reach the SQL
//! text. `first_param` lets callers embed the clause into a query that already
//! occupies `$1..$first_param-1` (e.g. the campaign audience queries).

use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use sqlx::postgres::PgArguments;
use sqlx::query::Query;

use crate::core::error::ApiError;

#[derive(Debug, Clone)]
pub enum SegmentBind {
    Text(String),
    Texts(Vec<String>),
    Int(i64),
    Ints(Vec<i64>),
    Num(Decimal),
    Bool(bool),
}

#[derive(Debug, Clone)]
pub struct CompiledClause {
    /// Parenthesized predicate over alias `g` with `$N` placeholders.
    pub sql: String,
    pub binds: Vec<SegmentBind>,
}

#[derive(Deserialize)]
struct RawRules {
    groups: Vec<RawGroup>,
}

#[derive(Deserialize)]
struct RawGroup {
    conditions: Vec<RawCondition>,
}

#[derive(Deserialize)]
struct RawCondition {
    field: String,
    op: String,
    #[serde(default)]
    value: Option<JsonValue>,
}

fn invalid(message: &str) -> ApiError {
    ApiError::BadRequest(message.to_string())
}

pub fn parse_rules(rules: &JsonValue) -> Result<(), ApiError> {
    let parsed: RawRules = serde_json::from_value(rules.clone())
        .map_err(|_| invalid("Segment rules must be an object with a groups array"))?;
    if parsed.groups.is_empty() {
        return Err(invalid("Segment needs at least one rule group"));
    }
    if parsed.groups.iter().any(|g| g.conditions.is_empty()) {
        return Err(invalid("Rule groups need at least one condition"));
    }
    Ok(())
}

enum FieldKind {
    /// Direct column expression; text semantics.
    Text(&'static str),
    /// Integer expression (may be a derived subquery).
    Int(&'static str),
    /// Numeric expression.
    Num(&'static str),
    /// Boolean column.
    Bool(&'static str),
    /// `g.tags` text[].
    Tags,
    /// Loyalty tier via member→account join (active members only).
    TierId,
    /// Presence of an active loyalty membership.
    LoyaltyMember,
}

struct FieldSpec {
    kind: FieldKind,
    ops: &'static [&'static str],
}

const TEXT_OPS: &[&str] = &["eq", "ne", "in", "is_set", "is_not_set"];
const NUM_OPS: &[&str] = &["eq", "gte", "lte"];

fn field_spec(field: &str) -> Option<FieldSpec> {
    Some(match field {
        "country" => FieldSpec { kind: FieldKind::Text("g.country"), ops: TEXT_OPS },
        "nationality" => FieldSpec { kind: FieldKind::Text("g.nationality"), ops: TEXT_OPS },
        "language_preference" => FieldSpec { kind: FieldKind::Text("g.language_preference"), ops: TEXT_OPS },
        "communication_preference" => FieldSpec { kind: FieldKind::Text("g.communication_preference"), ops: TEXT_OPS },
        "vip_status" => FieldSpec { kind: FieldKind::Text("g.vip_status"), ops: TEXT_OPS },
        "guest_type" => FieldSpec { kind: FieldKind::Text("g.guest_type::text"), ops: &["eq", "ne", "in"] },
        "marketing_opt_in" => FieldSpec { kind: FieldKind::Bool("g.marketing_opt_in"), ops: &["eq"] },
        "tags" => FieldSpec { kind: FieldKind::Tags, ops: &["contains", "not_contains"] },
        "total_stays" => FieldSpec { kind: FieldKind::Int("g.total_stays"), ops: NUM_OPS },
        "total_spend" => FieldSpec { kind: FieldKind::Num("g.total_spend"), ops: &["gte", "lte"] },
        "age_years" => FieldSpec {
            kind: FieldKind::Int("EXTRACT(YEAR FROM AGE(g.date_of_birth))::int"),
            ops: &["gte", "lte"],
        },
        "days_since_last_stay" => FieldSpec {
            kind: FieldKind::Int(
                "(CURRENT_DATE - (SELECT MAX(b.check_out_date) FROM bookings b \
                 WHERE b.guest_id = g.id AND b.status IN ('checked_out','completed')))",
            ),
            ops: &["gte", "lte"],
        },
        "loyalty_tier_id" => FieldSpec { kind: FieldKind::TierId, ops: &["eq", "in"] },
        "has_loyalty_membership" => FieldSpec { kind: FieldKind::LoyaltyMember, ops: &["eq"] },
        _ => return None,
    })
}

fn text_value(value: &Option<JsonValue>, field: &str) -> Result<String, ApiError> {
    let s = value
        .as_ref()
        .and_then(JsonValue::as_str)
        .ok_or_else(|| invalid(&format!("Field {field} needs a string value")))?;
    if s.is_empty() || s.chars().count() > 200 {
        return Err(invalid(&format!("Field {field} value must be 1-200 characters")));
    }
    Ok(s.to_string())
}

fn int_value(value: &Option<JsonValue>, field: &str) -> Result<i64, ApiError> {
    value
        .as_ref()
        .and_then(JsonValue::as_i64)
        .ok_or_else(|| invalid(&format!("Field {field} needs an integer value")))
}

fn num_value(value: &Option<JsonValue>, field: &str) -> Result<Decimal, ApiError> {
    match value.as_ref() {
        Some(JsonValue::Number(n)) => Decimal::from_str_exact(&n.to_string())
            .map_err(|_| invalid(&format!("Field {field} needs a numeric value"))),
        Some(JsonValue::String(s)) => Decimal::from_str_exact(s)
            .map_err(|_| invalid(&format!("Field {field} needs a numeric value"))),
        _ => Err(invalid(&format!("Field {field} needs a numeric value"))),
    }
}

fn bool_value(value: &Option<JsonValue>, field: &str) -> Result<bool, ApiError> {
    value
        .as_ref()
        .and_then(JsonValue::as_bool)
        .ok_or_else(|| invalid(&format!("Field {field} needs a boolean value")))
}

fn text_list(value: &Option<JsonValue>, field: &str) -> Result<Vec<String>, ApiError> {
    let items = value
        .as_ref()
        .and_then(JsonValue::as_array)
        .ok_or_else(|| invalid(&format!("Field {field} needs a non-empty string array")))?;
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        out.push(
            item.as_str()
                .filter(|s| !s.is_empty() && s.chars().count() <= 200)
                .map(str::to_string)
                .ok_or_else(|| invalid(&format!("Field {field} needs a non-empty string array")))?,
        );
    }
    if out.is_empty() {
        return Err(invalid(&format!("Field {field} needs a non-empty string array")));
    }
    Ok(out)
}

fn int_list(value: &Option<JsonValue>, field: &str) -> Result<Vec<i64>, ApiError> {
    let items = value
        .as_ref()
        .and_then(JsonValue::as_array)
        .ok_or_else(|| invalid(&format!("Field {field} needs a non-empty integer array")))?;
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        out.push(
            item.as_i64()
                .ok_or_else(|| invalid(&format!("Field {field} needs a non-empty integer array")))?,
        );
    }
    if out.is_empty() {
        return Err(invalid(&format!("Field {field} needs a non-empty integer array")));
    }
    Ok(out)
}

fn compile_condition(
    cond: &RawCondition,
    next_param: &mut usize,
    binds: &mut Vec<SegmentBind>,
) -> Result<String, ApiError> {
    let spec = field_spec(&cond.field)
        .ok_or_else(|| invalid(&format!("Unknown segment field: {}", cond.field)))?;
    if !spec.ops.contains(&cond.op.as_str()) {
        return Err(invalid(&format!(
            "Operator {} is not allowed on field {}",
            cond.op, cond.field
        )));
    }
    let param = |next: &mut usize| {
        let p = *next;
        *next += 1;
        format!("${p}")
    };
    let clause = match spec.kind {
        FieldKind::Text(expr) => match cond.op.as_str() {
            "eq" => {
                binds.push(SegmentBind::Text(text_value(&cond.value, &cond.field)?));
                format!("{expr} = {}", param(next_param))
            }
            "ne" => {
                binds.push(SegmentBind::Text(text_value(&cond.value, &cond.field)?));
                format!("({expr} IS NULL OR {expr} <> {})", param(next_param))
            }
            "in" => {
                binds.push(SegmentBind::Texts(text_list(&cond.value, &cond.field)?));
                format!("{expr} = ANY({})", param(next_param))
            }
            "is_set" => format!("({expr} IS NOT NULL AND length(btrim({expr})) > 0)"),
            "is_not_set" => format!("({expr} IS NULL OR length(btrim({expr})) = 0)"),
            _ => unreachable!(),
        },
        FieldKind::Int(expr) | FieldKind::Num(expr) => {
            let cmp = match cond.op.as_str() {
                "eq" => "=",
                "gte" => ">=",
                "lte" => "<=",
                _ => unreachable!(),
            };
            if matches!(spec.kind, FieldKind::Int(_)) {
                binds.push(SegmentBind::Int(int_value(&cond.value, &cond.field)?));
            } else {
                binds.push(SegmentBind::Num(num_value(&cond.value, &cond.field)?));
            }
            format!("{expr} {cmp} {}", param(next_param))
        }
        FieldKind::Bool(expr) => {
            binds.push(SegmentBind::Bool(bool_value(&cond.value, &cond.field)?));
            format!("{expr} = {}", param(next_param))
        }
        FieldKind::Tags => match cond.op.as_str() {
            "contains" => {
                binds.push(SegmentBind::Text(text_value(&cond.value, &cond.field)?));
                format!("{} = ANY(g.tags)", param(next_param))
            }
            "not_contains" => {
                binds.push(SegmentBind::Text(text_value(&cond.value, &cond.field)?));
                format!("NOT ({} = ANY(COALESCE(g.tags, '{{}}'::text[])))", param(next_param))
            }
            _ => unreachable!(),
        },
        FieldKind::TierId => {
            let exists = "EXISTS (SELECT 1 FROM loyalty_members lm \
                          JOIN loyalty_accounts la ON la.member_id = lm.id \
                          WHERE lm.guest_id = g.id AND lm.status = 'active' AND ";
            match cond.op.as_str() {
                "eq" => {
                    binds.push(SegmentBind::Int(int_value(&cond.value, &cond.field)?));
                    format!("{exists}la.current_tier_id = {})", param(next_param))
                }
                "in" => {
                    binds.push(SegmentBind::Ints(int_list(&cond.value, &cond.field)?));
                    format!("{exists}la.current_tier_id = ANY({}))", param(next_param))
                }
                _ => unreachable!(),
            }
        }
        FieldKind::LoyaltyMember => {
            let exists = "EXISTS (SELECT 1 FROM loyalty_members lm \
                          WHERE lm.guest_id = g.id AND lm.status = 'active')";
            if bool_value(&cond.value, &cond.field)? {
                exists.to_string()
            } else {
                format!("NOT {exists}")
            }
        }
    };
    Ok(clause)
}

/// Compiles stored rules into a parenthesized predicate. Returns `Err` for
/// anything outside the whitelist — the same validation runs on write, so a
/// stored row should always compile.
pub fn compile_rules(rules: &JsonValue, first_param: usize) -> Result<CompiledClause, ApiError> {
    parse_rules(rules)?;
    let parsed: RawRules = serde_json::from_value(rules.clone())
        .map_err(|_| invalid("Segment rules must be an object with a groups array"))?;
    let mut binds = Vec::new();
    let mut next = first_param;
    let mut groups_sql = Vec::with_capacity(parsed.groups.len());
    for group in &parsed.groups {
        let mut parts = Vec::with_capacity(group.conditions.len());
        for cond in &group.conditions {
            parts.push(compile_condition(cond, &mut next, &mut binds)?);
        }
        groups_sql.push(format!("({})", parts.join(" AND ")));
    }
    Ok(CompiledClause {
        sql: format!("({})", groups_sql.join(" OR ")),
        binds,
    })
}

/// Applies compiled binds to a query in placeholder order. Callers must bind
/// their own `$1..$first_param-1` parameters first, then call this.
pub fn apply_binds<'q>(
    mut query: Query<'q, sqlx::Postgres, PgArguments>,
    binds: &'q [SegmentBind],
) -> Query<'q, sqlx::Postgres, PgArguments> {
    for bind in binds {
        query = match bind {
            SegmentBind::Text(v) => query.bind(v.clone()),
            SegmentBind::Texts(v) => query.bind(v.clone()),
            SegmentBind::Int(v) => query.bind(*v),
            SegmentBind::Ints(v) => query.bind(v.clone()),
            SegmentBind::Num(v) => query.bind(*v),
            SegmentBind::Bool(v) => query.bind(*v),
        };
    }
    query
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rules(groups: JsonValue) -> JsonValue {
        json!({ "groups": groups })
    }

    fn cond(field: &str, op: &str, value: JsonValue) -> JsonValue {
        json!({ "field": field, "op": op, "value": value })
    }

    #[test]
    fn compiles_eq_condition_with_bind() {
        let clause = compile_rules(
            &rules(json!([{ "conditions": [cond("country", "eq", json!("Malaysia"))] }])),
            1,
        )
        .unwrap();
        assert_eq!(clause.sql, "((g.country = $1))");
        assert!(matches!(clause.binds[0], SegmentBind::Text(ref v) if v == "Malaysia"));
    }

    #[test]
    fn honors_first_param_offset() {
        let clause = compile_rules(
            &rules(json!([{ "conditions": [cond("total_stays", "gte", json!(3))] }])),
            4,
        )
        .unwrap();
        assert_eq!(clause.sql, "((g.total_stays >= $4))");
    }

    #[test]
    fn or_between_groups_and_within() {
        let clause = compile_rules(
            &rules(json!([
                { "conditions": [cond("country", "eq", json!("Malaysia")), cond("total_stays", "gte", json!(2))] },
                { "conditions": [cond("vip_status", "eq", json!("gold"))] }
            ])),
            1,
        )
        .unwrap();
        assert_eq!(
            clause.sql,
            "((g.country = $1 AND g.total_stays >= $2) OR (g.vip_status = $3))"
        );
        assert_eq!(clause.binds.len(), 3);
    }

    #[test]
    fn rejects_unknown_field_and_op() {
        assert!(compile_rules(
            &rules(json!([{ "conditions": [cond("email", "eq", json!("x"))] }])),
            1
        )
        .is_err());
        assert!(compile_rules(
            &rules(json!([{ "conditions": [cond("country", "gte", json!("x"))] }])),
            1
        )
        .is_err());
    }

    #[test]
    fn rejects_empty_groups_and_conditions() {
        assert!(compile_rules(&rules(json!([])), 1).is_err());
        assert!(compile_rules(&rules(json!([{ "conditions": [] }])), 1).is_err());
    }

    #[test]
    fn rejects_wrong_value_types() {
        for (field, op, value) in [
            ("country", "eq", json!(42)),
            ("total_stays", "gte", json!("many")),
            ("marketing_opt_in", "eq", json!("yes")),
            ("tags", "contains", json!([])),
            ("loyalty_tier_id", "in", json!([])),
            ("loyalty_tier_id", "in", json!(["gold"])),
        ] {
            assert!(
                compile_rules(
                    &rules(json!([{ "conditions": [cond(field, op, value.clone())] }])),
                    1
                )
                .is_err(),
                "{field} {op} {value} should be rejected"
            );
        }
    }

    #[test]
    fn tags_and_set_ops_compile() {
        let clause = compile_rules(
            &rules(json!([{ "conditions": [
                cond("tags", "contains", json!("corporate")),
                cond("country", "is_set", JsonValue::Null),
                cond("nationality", "is_not_set", JsonValue::Null)
            ] }])),
            1,
        )
        .unwrap();
        assert!(clause.sql.contains("$1 = ANY(g.tags)"));
        assert!(clause.sql.contains("g.country IS NOT NULL"));
        assert!(clause.sql.contains("g.nationality IS NULL"));
        assert_eq!(clause.binds.len(), 1);
    }

    #[test]
    fn loyalty_clauses_compile() {
        let clause = compile_rules(
            &rules(json!([{ "conditions": [
                cond("loyalty_tier_id", "in", json!([1, 2])),
                cond("has_loyalty_membership", "eq", json!(true)),
                cond("age_years", "gte", json!(60)),
                cond("days_since_last_stay", "gte", json!(180))
            ] }])),
            2,
        )
        .unwrap();
        assert!(clause.sql.contains("la.current_tier_id = ANY($2)"));
        assert!(clause.sql.contains("lm.status = 'active'"));
        assert!(clause.sql.contains("EXTRACT(YEAR FROM AGE(g.date_of_birth))::int >= $3"));
        assert!(clause.sql.contains("MAX(b.check_out_date)"));
        assert!(clause.sql.contains("$4"));
        assert!(matches!(clause.binds[0], SegmentBind::Ints(ref v) if v == &vec![1, 2]));
        assert_eq!(clause.binds.len(), 3);
    }

    #[test]
    fn guest_type_casts_and_spend_binds_decimal() {
        let clause = compile_rules(
            &rules(json!([{ "conditions": [
                cond("guest_type", "in", json!(["member"])),
                cond("total_spend", "lte", json!(500.5))
            ] }])),
            1,
        )
        .unwrap();
        assert!(clause.sql.contains("g.guest_type::text = ANY($1)"));
        assert!(clause.sql.contains("g.total_spend <= $2"));
        assert!(matches!(clause.binds[1], SegmentBind::Num(_)));
    }
}
