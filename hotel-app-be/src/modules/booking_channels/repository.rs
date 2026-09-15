//! Booking channel, pricing-rule, commission-rule, and mapping persistence.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

use crate::core::db::{DbPool, DbRow, decimal_to_db, opt_decimal_to_db};
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{
    BookingChannel, BookingChannelInput, BookingChannelUpdate, ChannelCommissionRule,
    ChannelCommissionRuleValues, ChannelMappings, ChannelPricingRule, ChannelPricingRuleValues,
    ChannelRatePlanMapping, ChannelRatePlanMappingInput, ChannelRoomTypeMapping,
    ChannelRoomTypeMappingInput,
};

const VALID_CHANNEL_TYPES: &[&str] = &[
    "direct",
    "ota",
    "corporate",
    "walk_in",
    "phone",
    "website",
    "channel_manager",
    "other",
];

const VALID_COMMISSION_TYPES: &[&str] = &["none", "percentage", "fixed_amount"];
const VALID_COMMISSION_SCOPES: &[&str] = &["per_booking", "per_night"];
const VALID_INTEGRATION_MODES: &[&str] = &["manual", "channel_manager", "api"];

const CHANNEL_COLUMNS: &str = "id, name, channel_type, default_commission_type,
        default_commission_value, default_commission_scope, is_active,
        abbreviation, code, integration_mode, created_at, updated_at";

const RULE_COLUMNS: &str = "id, channel_id, room_type_id, rate_plan_id, rule_type,
        value, effective_from, effective_to, min_price, max_price, priority,
        is_active, reason, created_by, updated_by, created_at, updated_at";

const COMMISSION_RULE_COLUMNS: &str = "id, channel_id, commission_type, value, scope,
        effective_from, effective_to, priority, is_active, reason,
        created_by, updated_by, created_at, updated_at";

fn normalize_token(value: Option<String>, default_value: &str) -> String {
    value
        .unwrap_or_else(|| default_value.to_string())
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_")
}

fn normalize_name(name: &str) -> Result<String, ApiError> {
    let cleaned = name.trim();
    if cleaned.is_empty() {
        return Err(ApiError::BadRequest(
            "Booking channel name is required".to_string(),
        ));
    }
    if cleaned.len() > 120 {
        return Err(ApiError::BadRequest(
            "Booking channel name must be 120 characters or fewer".to_string(),
        ));
    }
    Ok(cleaned.to_string())
}

fn normalize_optional_text(value: Option<String>, max_len: usize, field: &str) -> Result<Option<String>, ApiError> {
    match value {
        Some(raw) => {
            let cleaned = raw.trim();
            if cleaned.is_empty() {
                return Ok(None);
            }
            if cleaned.len() > max_len {
                return Err(ApiError::BadRequest(format!(
                    "{field} must be {max_len} characters or fewer"
                )));
            }
            Ok(Some(cleaned.to_string()))
        }
        None => Ok(None),
    }
}

fn validate_channel_type(value: String) -> Result<String, ApiError> {
    if VALID_CHANNEL_TYPES.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid channel_type '{}'",
            value
        )))
    }
}

fn validate_integration_mode(value: String) -> Result<String, ApiError> {
    if VALID_INTEGRATION_MODES.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid integration_mode '{value}'"
        )))
    }
}

fn validate_commission_scope(value: String) -> Result<String, ApiError> {
    if VALID_COMMISSION_SCOPES.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid default_commission_scope '{}'",
            value
        )))
    }
}

fn validate_commission(
    commission_type: String,
    value: Decimal,
    scope: String,
) -> Result<(String, Decimal, String), ApiError> {
    if !VALID_COMMISSION_TYPES.contains(&commission_type.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid default_commission_type '{}'",
            commission_type
        )));
    }

    let scope = validate_commission_scope(scope)?;

    match commission_type.as_str() {
        "none" => Ok((commission_type, Decimal::ZERO, scope)),
        "percentage" => {
            if value < Decimal::ZERO || value > Decimal::new(100, 0) {
                return Err(ApiError::BadRequest(
                    "Percentage commission must be between 0 and 100".to_string(),
                ));
            }
            Ok((commission_type, value, scope))
        }
        "fixed_amount" => {
            if value < Decimal::ZERO {
                return Err(ApiError::BadRequest(
                    "Fixed commission must be non-negative".to_string(),
                ));
            }
            Ok((commission_type, value, scope))
        }
        _ => Err(ApiError::BadRequest(
            "Invalid default_commission_type".to_string(),
        )),
    }
}

fn row_to_channel(row: &DbRow) -> BookingChannel {
    BookingChannel {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        channel_type: row
            .try_get("channel_type")
            .unwrap_or_else(|_| "ota".to_string()),
        default_commission_type: row
            .try_get("default_commission_type")
            .unwrap_or_else(|_| "none".to_string()),
        default_commission_value: row_mappers::get_decimal(row, "default_commission_value"),
        default_commission_scope: row
            .try_get("default_commission_scope")
            .unwrap_or_else(|_| "per_booking".to_string()),
        is_active: row_mappers::get_bool(row, "is_active"),
        abbreviation: row.try_get("abbreviation").ok().flatten(),
        code: row.try_get("code").ok().flatten(),
        integration_mode: row
            .try_get("integration_mode")
            .unwrap_or_else(|_| "manual".to_string()),
        created_at: row
            .try_get("created_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
        updated_at: row
            .try_get("updated_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
    }
}

fn row_to_pricing_rule(row: &DbRow) -> ChannelPricingRule {
    ChannelPricingRule {
        id: row.try_get("id").unwrap_or_default(),
        channel_id: row.try_get("channel_id").unwrap_or_default(),
        room_type_id: row.try_get("room_type_id").ok().flatten(),
        rate_plan_id: row.try_get("rate_plan_id").ok().flatten(),
        rule_type: row.try_get("rule_type").unwrap_or_default(),
        value: row_mappers::get_decimal(row, "value"),
        effective_from: row
            .try_get("effective_from")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        effective_to: row.try_get("effective_to").ok().flatten(),
        min_price: row_mappers::get_opt_decimal(row, "min_price"),
        max_price: row_mappers::get_opt_decimal(row, "max_price"),
        priority: row.try_get("priority").unwrap_or_default(),
        is_active: row_mappers::get_bool(row, "is_active"),
        reason: row.try_get("reason").ok().flatten(),
        created_by: row.try_get("created_by").ok().flatten(),
        updated_by: row.try_get("updated_by").ok().flatten(),
        created_at: row
            .try_get("created_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
        updated_at: row
            .try_get("updated_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
    }
}

fn row_to_commission_rule(row: &DbRow) -> ChannelCommissionRule {
    ChannelCommissionRule {
        id: row.try_get("id").unwrap_or_default(),
        channel_id: row.try_get("channel_id").unwrap_or_default(),
        commission_type: row.try_get("commission_type").unwrap_or_default(),
        value: row_mappers::get_decimal(row, "value"),
        scope: row
            .try_get("scope")
            .unwrap_or_else(|_| "per_booking".to_string()),
        effective_from: row
            .try_get("effective_from")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        effective_to: row.try_get("effective_to").ok().flatten(),
        priority: row.try_get("priority").unwrap_or_default(),
        is_active: row_mappers::get_bool(row, "is_active"),
        reason: row.try_get("reason").ok().flatten(),
        created_by: row.try_get("created_by").ok().flatten(),
        updated_by: row.try_get("updated_by").ok().flatten(),
        created_at: row
            .try_get("created_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
        updated_at: row
            .try_get("updated_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
    }
}

pub async fn list(pool: &DbPool) -> Result<Vec<BookingChannel>, ApiError> {
    // Booking channels are hotel-configured reference data (a handful of rows
    // in practice), not user-generated content — this LIMIT is a generous DoS
    // backstop, not a pagination change. No caller expects more rows than this.
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {CHANNEL_COLUMNS} FROM booking_channels
         ORDER BY is_active DESC, name ASC LIMIT 1000"
    )))
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(rows.iter().map(row_to_channel).collect())
}

pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<BookingChannel, ApiError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {CHANNEL_COLUMNS} FROM booking_channels WHERE id = $1"
    )))
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking channel not found".to_string()))?;
    Ok(row_to_channel(&row))
}

pub async fn create(
    pool: &DbPool,
    user_id: i64,
    input: BookingChannelInput,
) -> Result<BookingChannel, ApiError> {
    let name = normalize_name(&input.name)?;
    let channel_type = validate_channel_type(normalize_token(input.channel_type, "ota"))?;
    let commission_type = normalize_token(input.default_commission_type, "none");
    let commission_value = input.default_commission_value.unwrap_or(Decimal::ZERO);
    let commission_scope = normalize_token(input.default_commission_scope, "per_booking");
    let (commission_type, commission_value, commission_scope) =
        validate_commission(commission_type, commission_value, commission_scope)?;
    let is_active = input.is_active.unwrap_or(true);
    let abbreviation = normalize_optional_text(input.abbreviation, 8, "abbreviation")?;
    let code = normalize_optional_text(input.code, 40, "code")?;
    let integration_mode =
        validate_integration_mode(normalize_token(input.integration_mode, "manual"))?;

    let query = format!(
        "INSERT INTO booking_channels
            (name, channel_type, default_commission_type, default_commission_value,
             default_commission_scope, is_active, abbreviation, code, integration_mode, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        RETURNING {CHANNEL_COLUMNS}"
    );

    let row = sqlx::query(sqlx::AssertSqlSafe(query))
        .bind(name)
        .bind(channel_type)
        .bind(commission_type)
        .bind(decimal_to_db(commission_value))
        .bind(commission_scope)
        .bind(is_active)
        .bind(abbreviation)
        .bind(code)
        .bind(integration_mode)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row_to_channel(&row))
}

pub async fn update(
    pool: &DbPool,
    id: i64,
    user_id: i64,
    input: BookingChannelUpdate,
) -> Result<BookingChannel, ApiError> {
    let current = find_by_id(pool, id).await?;

    let name = match input.name {
        Some(value) => normalize_name(&value)?,
        None => current.name,
    };
    let channel_type =
        validate_channel_type(normalize_token(input.channel_type, &current.channel_type))?;
    let commission_type = normalize_token(
        input.default_commission_type,
        &current.default_commission_type,
    );
    let commission_value = input
        .default_commission_value
        .unwrap_or(current.default_commission_value);
    let commission_scope = normalize_token(
        input.default_commission_scope,
        &current.default_commission_scope,
    );
    let (commission_type, commission_value, commission_scope) =
        validate_commission(commission_type, commission_value, commission_scope)?;
    let is_active = input.is_active.unwrap_or(current.is_active);
    let abbreviation = normalize_optional_text(input.abbreviation, 8, "abbreviation")?
        .or(current.abbreviation);
    let code = normalize_optional_text(input.code, 40, "code")?.or(current.code);
    let integration_mode = validate_integration_mode(normalize_token(
        input.integration_mode,
        &current.integration_mode,
    ))?;

    let query = format!(
        "UPDATE booking_channels
        SET name = $1,
            channel_type = $2,
            default_commission_type = $3,
            default_commission_value = $4,
            default_commission_scope = $5,
            is_active = $6,
            abbreviation = $7,
            code = $8,
            integration_mode = $9,
            updated_by = $10,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $11
        RETURNING {CHANNEL_COLUMNS}"
    );

    let row = sqlx::query(sqlx::AssertSqlSafe(query))
        .bind(name)
        .bind(channel_type)
        .bind(commission_type)
        .bind(decimal_to_db(commission_value))
        .bind(commission_scope)
        .bind(is_active)
        .bind(abbreviation)
        .bind(code)
        .bind(integration_mode)
        .bind(user_id)
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row_to_channel(&row))
}

pub async fn deactivate(
    pool: &DbPool,
    id: i64,
    user_id: i64,
) -> Result<BookingChannel, ApiError> {
    update(
        pool,
        id,
        user_id,
        BookingChannelUpdate {
            name: None,
            channel_type: None,
            default_commission_type: None,
            default_commission_value: None,
            default_commission_scope: None,
            is_active: Some(false),
            abbreviation: None,
            code: None,
            integration_mode: None,
        },
    )
    .await
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

pub async fn list_pricing_rules(
    pool: &DbPool,
    channel_id: i64,
) -> Result<Vec<ChannelPricingRule>, ApiError> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {RULE_COLUMNS} FROM channel_pricing_rules
         WHERE channel_id = $1
         ORDER BY priority DESC, effective_from DESC, id DESC
         LIMIT 2000"
    )))
    .bind(channel_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(rows.iter().map(row_to_pricing_rule).collect())
}

/// Active rules for a set of channels overlapping the stay window
/// `[from, last_night]` — one query feeds the whole resolution.
pub async fn active_pricing_rules(
    pool: &DbPool,
    channel_ids: &[i64],
    from: NaiveDate,
    last_night: NaiveDate,
) -> Result<Vec<ChannelPricingRule>, ApiError> {
    if channel_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {RULE_COLUMNS} FROM channel_pricing_rules
         WHERE channel_id = ANY($1)
           AND is_active = true
           AND effective_from <= $3
           AND (effective_to IS NULL OR effective_to >= $2)
         ORDER BY channel_id, priority DESC, id DESC"
    )))
    .bind(channel_ids)
    .bind(from)
    .bind(last_night)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(rows.iter().map(row_to_pricing_rule).collect())
}

pub async fn insert_pricing_rule(
    pool: &DbPool,
    channel_id: i64,
    user_id: i64,
    values: &ChannelPricingRuleValues,
) -> Result<ChannelPricingRule, ApiError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO channel_pricing_rules
            (channel_id, room_type_id, rate_plan_id, rule_type, value,
             effective_from, effective_to, min_price, max_price, priority,
             is_active, reason, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
        RETURNING {RULE_COLUMNS}"
    )))
    .bind(channel_id)
    .bind(values.room_type_id)
    .bind(values.rate_plan_id)
    .bind(&values.rule_type)
    .bind(decimal_to_db(values.value))
    .bind(values.effective_from)
    .bind(values.effective_to)
    .bind(opt_decimal_to_db(values.min_price))
    .bind(opt_decimal_to_db(values.max_price))
    .bind(values.priority)
    .bind(values.is_active)
    .bind(values.reason.as_deref())
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(row_to_pricing_rule(&row))
}

pub async fn update_pricing_rule(
    pool: &DbPool,
    rule_id: i64,
    user_id: i64,
    values: &ChannelPricingRuleValues,
) -> Result<ChannelPricingRule, ApiError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE channel_pricing_rules SET
            room_type_id = $2, rate_plan_id = $3, rule_type = $4, value = $5,
            effective_from = $6, effective_to = $7, min_price = $8,
            max_price = $9, priority = $10, is_active = $11, reason = $12,
            updated_by = $13, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING {RULE_COLUMNS}"
    )))
    .bind(rule_id)
    .bind(values.room_type_id)
    .bind(values.rate_plan_id)
    .bind(&values.rule_type)
    .bind(decimal_to_db(values.value))
    .bind(values.effective_from)
    .bind(values.effective_to)
    .bind(opt_decimal_to_db(values.min_price))
    .bind(opt_decimal_to_db(values.max_price))
    .bind(values.priority)
    .bind(values.is_active)
    .bind(values.reason.as_deref())
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Channel pricing rule not found".to_string()))?;
    Ok(row_to_pricing_rule(&row))
}

pub async fn find_pricing_rule(
    pool: &DbPool,
    rule_id: i64,
) -> Result<ChannelPricingRule, ApiError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {RULE_COLUMNS} FROM channel_pricing_rules WHERE id = $1"
    )))
    .bind(rule_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Channel pricing rule not found".to_string()))?;
    Ok(row_to_pricing_rule(&row))
}

pub async fn delete_pricing_rule(pool: &DbPool, rule_id: i64) -> Result<(), ApiError> {
    let result = sqlx::query("DELETE FROM channel_pricing_rules WHERE id = $1")
        .bind(rule_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound(
            "Channel pricing rule not found".to_string(),
        ));
    }
    Ok(())
}

/// Same-scope overlapping rules, for the conflict warning on save.
pub async fn overlapping_pricing_rules(
    pool: &DbPool,
    channel_id: i64,
    room_type_id: Option<i64>,
    rate_plan_id: Option<i64>,
    effective_from: NaiveDate,
    effective_to: Option<NaiveDate>,
    exclude_id: Option<i64>,
) -> Result<Vec<ChannelPricingRule>, ApiError> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {RULE_COLUMNS} FROM channel_pricing_rules
         WHERE channel_id = $1
           AND is_active = true
           AND room_type_id IS NOT DISTINCT FROM $2
           AND rate_plan_id IS NOT DISTINCT FROM $3
           AND effective_from <= COALESCE($4, DATE '9999-12-31')
           AND (effective_to IS NULL OR effective_to >= $5)
           AND ($6::bigint IS NULL OR id <> $6)
         ORDER BY priority DESC, id DESC
         LIMIT 50"
    )))
    .bind(channel_id)
    .bind(room_type_id)
    .bind(rate_plan_id)
    .bind(effective_to)
    .bind(effective_from)
    .bind(exclude_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(rows.iter().map(row_to_pricing_rule).collect())
}

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

pub async fn list_commission_rules(
    pool: &DbPool,
    channel_id: i64,
) -> Result<Vec<ChannelCommissionRule>, ApiError> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {COMMISSION_RULE_COLUMNS} FROM channel_commission_rules
         WHERE channel_id = $1
         ORDER BY priority DESC, effective_from DESC, id DESC
         LIMIT 1000"
    )))
    .bind(channel_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(rows.iter().map(row_to_commission_rule).collect())
}

/// All active commission rules for a channel — the service layer picks the
/// one covering the relevant date.
pub async fn active_commission_rules(
    pool: &DbPool,
    channel_id: i64,
) -> Result<Vec<ChannelCommissionRule>, ApiError> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {COMMISSION_RULE_COLUMNS} FROM channel_commission_rules
         WHERE channel_id = $1 AND is_active = true
         ORDER BY priority DESC, id DESC"
    )))
    .bind(channel_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(rows.iter().map(row_to_commission_rule).collect())
}

pub async fn insert_commission_rule(
    pool: &DbPool,
    channel_id: i64,
    user_id: i64,
    values: &ChannelCommissionRuleValues,
) -> Result<ChannelCommissionRule, ApiError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO channel_commission_rules
            (channel_id, commission_type, value, scope, effective_from,
             effective_to, priority, is_active, reason, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        RETURNING {COMMISSION_RULE_COLUMNS}"
    )))
    .bind(channel_id)
    .bind(&values.commission_type)
    .bind(decimal_to_db(values.value))
    .bind(&values.scope)
    .bind(values.effective_from)
    .bind(values.effective_to)
    .bind(values.priority)
    .bind(values.is_active)
    .bind(values.reason.as_deref())
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(row_to_commission_rule(&row))
}

pub async fn update_commission_rule(
    pool: &DbPool,
    rule_id: i64,
    user_id: i64,
    values: &ChannelCommissionRuleValues,
) -> Result<ChannelCommissionRule, ApiError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE channel_commission_rules SET
            commission_type = $2, value = $3, scope = $4, effective_from = $5,
            effective_to = $6, priority = $7, is_active = $8, reason = $9,
            updated_by = $10, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING {COMMISSION_RULE_COLUMNS}"
    )))
    .bind(rule_id)
    .bind(&values.commission_type)
    .bind(decimal_to_db(values.value))
    .bind(&values.scope)
    .bind(values.effective_from)
    .bind(values.effective_to)
    .bind(values.priority)
    .bind(values.is_active)
    .bind(values.reason.as_deref())
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Channel commission rule not found".to_string()))?;
    Ok(row_to_commission_rule(&row))
}

pub async fn delete_commission_rule(pool: &DbPool, rule_id: i64) -> Result<(), ApiError> {
    let result = sqlx::query("DELETE FROM channel_commission_rules WHERE id = $1")
        .bind(rule_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound(
            "Channel commission rule not found".to_string(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Integration mappings (channel-manager readiness)
// ---------------------------------------------------------------------------

pub async fn get_mappings(pool: &DbPool, channel_id: i64) -> Result<ChannelMappings, ApiError> {
    let room_rows = sqlx::query(
        "SELECT m.id, m.channel_id, m.room_type_id, rt.name AS room_type_name,
                m.external_room_id, m.external_room_name, m.is_enabled,
                m.sync_status, m.last_synced_at, m.updated_at
         FROM channel_room_type_mappings m
         JOIN room_types rt ON rt.id = m.room_type_id
         WHERE m.channel_id = $1
         ORDER BY rt.name",
    )
    .bind(channel_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let plan_rows = sqlx::query(
        "SELECT m.id, m.channel_id, m.rate_plan_id, rp.name AS rate_plan_name,
                m.external_rate_plan_id, m.external_rate_plan_name, m.is_enabled,
                m.sync_status, m.last_synced_at, m.updated_at
         FROM channel_rate_plan_mappings m
         JOIN rate_plans rp ON rp.id = m.rate_plan_id
         WHERE m.channel_id = $1
         ORDER BY rp.name",
    )
    .bind(channel_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(ChannelMappings {
        room_types: room_rows
            .iter()
            .map(|row| ChannelRoomTypeMapping {
                id: row.try_get("id").unwrap_or_default(),
                channel_id: row.try_get("channel_id").unwrap_or_default(),
                room_type_id: row.try_get("room_type_id").unwrap_or_default(),
                room_type_name: row.try_get("room_type_name").ok().flatten(),
                external_room_id: row.try_get("external_room_id").ok().flatten(),
                external_room_name: row.try_get("external_room_name").ok().flatten(),
                is_enabled: row_mappers::get_bool(row, "is_enabled"),
                sync_status: row.try_get("sync_status").ok().flatten(),
                last_synced_at: row.try_get("last_synced_at").ok().flatten(),
                updated_at: row
                    .try_get("updated_at")
                    .unwrap_or_else(|_| chrono::Utc::now()),
            })
            .collect(),
        rate_plans: plan_rows
            .iter()
            .map(|row| ChannelRatePlanMapping {
                id: row.try_get("id").unwrap_or_default(),
                channel_id: row.try_get("channel_id").unwrap_or_default(),
                rate_plan_id: row.try_get("rate_plan_id").unwrap_or_default(),
                rate_plan_name: row.try_get("rate_plan_name").ok().flatten(),
                external_rate_plan_id: row
                    .try_get("external_rate_plan_id")
                    .ok()
                    .flatten(),
                external_rate_plan_name: row
                    .try_get("external_rate_plan_name")
                    .ok()
                    .flatten(),
                is_enabled: row_mappers::get_bool(row, "is_enabled"),
                sync_status: row.try_get("sync_status").ok().flatten(),
                last_synced_at: row.try_get("last_synced_at").ok().flatten(),
                updated_at: row
                    .try_get("updated_at")
                    .unwrap_or_else(|_| chrono::Utc::now()),
            })
            .collect(),
    })
}

pub async fn upsert_room_type_mapping(
    pool: &DbPool,
    channel_id: i64,
    user_id: i64,
    input: &ChannelRoomTypeMappingInput,
) -> Result<ChannelRoomTypeMapping, ApiError> {
    let row = sqlx::query(
        "INSERT INTO channel_room_type_mappings
            (channel_id, room_type_id, external_room_id, external_room_name,
             is_enabled, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (channel_id, room_type_id) DO UPDATE SET
            external_room_id = EXCLUDED.external_room_id,
            external_room_name = EXCLUDED.external_room_name,
            is_enabled = EXCLUDED.is_enabled,
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id, channel_id, room_type_id, external_room_id,
                  external_room_name, is_enabled, sync_status, last_synced_at, updated_at",
    )
    .bind(channel_id)
    .bind(input.room_type_id)
    .bind(input.external_room_id.as_deref())
    .bind(input.external_room_name.as_deref())
    .bind(input.is_enabled.unwrap_or(true))
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(ChannelRoomTypeMapping {
        id: row.try_get("id").unwrap_or_default(),
        channel_id: row.try_get("channel_id").unwrap_or_default(),
        room_type_id: row.try_get("room_type_id").unwrap_or_default(),
        room_type_name: None,
        external_room_id: row.try_get("external_room_id").ok().flatten(),
        external_room_name: row.try_get("external_room_name").ok().flatten(),
        is_enabled: row_mappers::get_bool(&row, "is_enabled"),
        sync_status: row.try_get("sync_status").ok().flatten(),
        last_synced_at: row.try_get("last_synced_at").ok().flatten(),
        updated_at: row
            .try_get("updated_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
    })
}

pub async fn upsert_rate_plan_mapping(
    pool: &DbPool,
    channel_id: i64,
    user_id: i64,
    input: &ChannelRatePlanMappingInput,
) -> Result<ChannelRatePlanMapping, ApiError> {
    let row = sqlx::query(
        "INSERT INTO channel_rate_plan_mappings
            (channel_id, rate_plan_id, external_rate_plan_id,
             external_rate_plan_name, is_enabled, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (channel_id, rate_plan_id) DO UPDATE SET
            external_rate_plan_id = EXCLUDED.external_rate_plan_id,
            external_rate_plan_name = EXCLUDED.external_rate_plan_name,
            is_enabled = EXCLUDED.is_enabled,
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id, channel_id, rate_plan_id, external_rate_plan_id,
                  external_rate_plan_name, is_enabled, sync_status, last_synced_at, updated_at",
    )
    .bind(channel_id)
    .bind(input.rate_plan_id)
    .bind(input.external_rate_plan_id.as_deref())
    .bind(input.external_rate_plan_name.as_deref())
    .bind(input.is_enabled.unwrap_or(true))
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(ChannelRatePlanMapping {
        id: row.try_get("id").unwrap_or_default(),
        channel_id: row.try_get("channel_id").unwrap_or_default(),
        rate_plan_id: row.try_get("rate_plan_id").unwrap_or_default(),
        rate_plan_name: None,
        external_rate_plan_id: row.try_get("external_rate_plan_id").ok().flatten(),
        external_rate_plan_name: row
            .try_get("external_rate_plan_name")
            .ok()
            .flatten(),
        is_enabled: row_mappers::get_bool(&row, "is_enabled"),
        sync_status: row.try_get("sync_status").ok().flatten(),
        last_synced_at: row.try_get("last_synced_at").ok().flatten(),
        updated_at: row
            .try_get("updated_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
    })
}

pub async fn delete_room_type_mapping(pool: &DbPool, mapping_id: i64) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM channel_room_type_mappings WHERE id = $1")
        .bind(mapping_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(())
}

pub async fn delete_rate_plan_mapping(pool: &DbPool, mapping_id: i64) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM channel_rate_plan_mappings WHERE id = $1")
        .bind(mapping_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(())
}
