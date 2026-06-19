//! Booking channel persistence.

use rust_decimal::Decimal;
use sqlx::Row;

use crate::core::db::{DbPool, DbRow, decimal_to_db};
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{BookingChannel, BookingChannelInput, BookingChannelUpdate};

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
        _ => unreachable!("commission type was validated"),
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
        created_at: row
            .try_get("created_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
        updated_at: row
            .try_get("updated_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
    }
}

pub async fn list(pool: &DbPool) -> Result<Vec<BookingChannel>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT id, name, channel_type, default_commission_type,
               default_commission_value, default_commission_scope, is_active,
               created_at, updated_at
        FROM booking_channels
        ORDER BY is_active DESC, name ASC
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(rows.iter().map(row_to_channel).collect())
}

pub async fn create(pool: &DbPool, input: BookingChannelInput) -> Result<BookingChannel, ApiError> {
    let name = normalize_name(&input.name)?;
    let channel_type = validate_channel_type(normalize_token(input.channel_type, "ota"))?;
    let commission_type = normalize_token(input.default_commission_type, "none");
    let commission_value = input.default_commission_value.unwrap_or(Decimal::ZERO);
    let commission_scope = normalize_token(input.default_commission_scope, "per_booking");
    let (commission_type, commission_value, commission_scope) =
        validate_commission(commission_type, commission_value, commission_scope)?;
    let is_active = input.is_active.unwrap_or(true);

    let query = crate::sql_query!(
        postgres: r#"
        INSERT INTO booking_channels
            (name, channel_type, default_commission_type, default_commission_value,
             default_commission_scope, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, channel_type, default_commission_type,
                  default_commission_value, default_commission_scope, is_active,
                  created_at, updated_at
        "#,
        sqlite: r#"
        INSERT INTO booking_channels
            (name, channel_type, default_commission_type, default_commission_value,
             default_commission_scope, is_active)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        RETURNING id, name, channel_type, default_commission_type,
                  default_commission_value, default_commission_scope, is_active,
                  created_at, updated_at
        "#
    );

    let row = sqlx::query(query)
        .bind(name)
        .bind(channel_type)
        .bind(commission_type)
        .bind(decimal_to_db(commission_value))
        .bind(commission_scope)
        .bind(is_active)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row_to_channel(&row))
}

pub async fn update(
    pool: &DbPool,
    id: i64,
    input: BookingChannelUpdate,
) -> Result<BookingChannel, ApiError> {
    let current_query = crate::sql_query!(
        postgres: r#"
        SELECT id, name, channel_type, default_commission_type,
               default_commission_value, default_commission_scope, is_active,
               created_at, updated_at
        FROM booking_channels
        WHERE id = $1
        "#,
        sqlite: r#"
        SELECT id, name, channel_type, default_commission_type,
               default_commission_value, default_commission_scope, is_active,
               created_at, updated_at
        FROM booking_channels
        WHERE id = ?1
        "#
    );

    let current = sqlx::query(current_query)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .map(|row| row_to_channel(&row))
        .ok_or_else(|| ApiError::NotFound("Booking channel not found".to_string()))?;

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

    let query = crate::sql_query!(
        postgres: r#"
        UPDATE booking_channels
        SET name = $1,
            channel_type = $2,
            default_commission_type = $3,
            default_commission_value = $4,
            default_commission_scope = $5,
            is_active = $6,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING id, name, channel_type, default_commission_type,
                  default_commission_value, default_commission_scope, is_active,
                  created_at, updated_at
        "#,
        sqlite: r#"
        UPDATE booking_channels
        SET name = ?1,
            channel_type = ?2,
            default_commission_type = ?3,
            default_commission_value = ?4,
            default_commission_scope = ?5,
            is_active = ?6,
            updated_at = datetime('now')
        WHERE id = ?7
        RETURNING id, name, channel_type, default_commission_type,
                  default_commission_value, default_commission_scope, is_active,
                  created_at, updated_at
        "#
    );

    let row = sqlx::query(query)
        .bind(name)
        .bind(channel_type)
        .bind(commission_type)
        .bind(decimal_to_db(commission_value))
        .bind(commission_scope)
        .bind(is_active)
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row_to_channel(&row))
}

pub async fn deactivate(pool: &DbPool, id: i64) -> Result<BookingChannel, ApiError> {
    update(
        pool,
        id,
        BookingChannelUpdate {
            name: None,
            channel_type: None,
            default_commission_type: None,
            default_commission_value: None,
            default_commission_scope: None,
            is_active: Some(false),
        },
    )
    .await
}
