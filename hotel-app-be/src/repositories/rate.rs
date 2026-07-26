//! Rate plan repository for database operations.

use crate::core::db::{DbPool, decimal_to_db};
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{
    RatePlan, RatePlanCreateValues, RatePlanUpdateValues, RoomRate, RoomRateCreateValues,
    RoomRateUpdateValues, RoomRateWithDetails, RoomType,
};
use chrono::NaiveDate;

pub struct RateRepository;

impl RateRepository {
    pub async fn create_rate_plan(
        pool: &DbPool,
        user_id: i64,
        values: &RatePlanCreateValues,
    ) -> Result<RatePlan, ApiError> {
        {
            let row = sqlx::query(
                r#"
                INSERT INTO rate_plans (
                    name, code, description, plan_type, adjustment_type, adjustment_value,
                    valid_from, valid_to, applies_monday, applies_tuesday, applies_wednesday,
                    applies_thursday, applies_friday, applies_saturday, applies_sunday,
                    min_nights, max_nights, min_advance_booking, max_advance_booking,
                    blackout_dates, is_active, priority, created_by
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
                RETURNING *
                "#,
            )
            .bind(&values.name)
            .bind(&values.code)
            .bind(&values.description)
            .bind(&values.plan_type)
            .bind(&values.adjustment_type)
            .bind(values.adjustment_value)
            .bind(values.valid_from)
            .bind(values.valid_to)
            .bind(values.applies_monday)
            .bind(values.applies_tuesday)
            .bind(values.applies_wednesday)
            .bind(values.applies_thursday)
            .bind(values.applies_friday)
            .bind(values.applies_saturday)
            .bind(values.applies_sunday)
            .bind(values.min_nights)
            .bind(values.max_nights)
            .bind(values.min_advance_booking)
            .bind(values.max_advance_booking)
            // blackout_dates is jsonb; a bare Vec<String> would bind as TEXT[] and fail at prepare time
            .bind(values.blackout_dates.as_ref().map(sqlx::types::Json))
            .bind(values.is_active)
            .bind(values.priority)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;

            Ok(row_mappers::row_to_rate_plan(&row))
        }
    }

    pub async fn list_rate_plans(pool: &DbPool) -> Result<Vec<RatePlan>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, code, description, plan_type, adjustment_type, adjustment_value,
                   valid_from, valid_to, applies_monday, applies_tuesday, applies_wednesday,
                   applies_thursday, applies_friday, applies_saturday, applies_sunday,
                   min_nights, max_nights, min_advance_booking, max_advance_booking,
                   is_active, priority, created_at, updated_at
            FROM rate_plans
            ORDER BY priority DESC, name ASC
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(rows.iter().map(row_mappers::row_to_rate_plan).collect())
    }

    pub async fn find_rate_plan(pool: &DbPool, rate_plan_id: i64) -> Result<RatePlan, ApiError> {
        sqlx::query(
            "SELECT id, name, code, description, plan_type, adjustment_type, adjustment_value, \
             valid_from, valid_to, applies_monday, applies_tuesday, applies_wednesday, \
             applies_thursday, applies_friday, applies_saturday, applies_sunday, \
             min_nights, max_nights, min_advance_booking, max_advance_booking, \
             is_active, priority, created_at, updated_at \
             FROM rate_plans WHERE id = $1",
        )
            .bind(rate_plan_id)
            .fetch_one(pool)
            .await
            .map(|row| row_mappers::row_to_rate_plan(&row))
            .map_err(map_not_found)
    }

    pub async fn update_rate_plan(
        pool: &DbPool,
        rate_plan_id: i64,
        values: &RatePlanUpdateValues,
    ) -> Result<RatePlan, ApiError> {
        let mut query_builder =
            sqlx::QueryBuilder::new("UPDATE rate_plans SET updated_at = CURRENT_TIMESTAMP");

        if let Some(name) = &values.name {
            query_builder.push(", name = ");
            query_builder.push_bind(name);
        }

        if let Some(code) = &values.code {
            query_builder.push(", code = ");
            query_builder.push_bind(code);
        }

        if let Some(description) = &values.description {
            query_builder.push(", description = ");
            query_builder.push_bind(description);
        }

        if let Some(plan_type) = &values.plan_type {
            query_builder.push(", plan_type = ");
            query_builder.push_bind(plan_type);
        }

        if let Some(adjustment_type) = &values.adjustment_type {
            query_builder.push(", adjustment_type = ");
            query_builder.push_bind(adjustment_type);
        }

        if let Some(adjustment_value) = values.adjustment_value {
            query_builder.push(", adjustment_value = ");
            query_builder.push_bind(decimal_to_db(adjustment_value));
        }

        if let Some(valid_from) = values.valid_from {
            query_builder.push(", valid_from = ");
            query_builder.push_bind(valid_from);
        }

        if let Some(valid_to) = values.valid_to {
            query_builder.push(", valid_to = ");
            query_builder.push_bind(valid_to);
        }

        if let Some(value) = values.applies_monday {
            query_builder.push(", applies_monday = ");
            query_builder.push_bind(value);
        }

        if let Some(value) = values.applies_tuesday {
            query_builder.push(", applies_tuesday = ");
            query_builder.push_bind(value);
        }

        if let Some(value) = values.applies_wednesday {
            query_builder.push(", applies_wednesday = ");
            query_builder.push_bind(value);
        }

        if let Some(value) = values.applies_thursday {
            query_builder.push(", applies_thursday = ");
            query_builder.push_bind(value);
        }

        if let Some(value) = values.applies_friday {
            query_builder.push(", applies_friday = ");
            query_builder.push_bind(value);
        }

        if let Some(value) = values.applies_saturday {
            query_builder.push(", applies_saturday = ");
            query_builder.push_bind(value);
        }

        if let Some(value) = values.applies_sunday {
            query_builder.push(", applies_sunday = ");
            query_builder.push_bind(value);
        }

        if let Some(min_nights) = values.min_nights {
            query_builder.push(", min_nights = ");
            query_builder.push_bind(min_nights);
        }

        if let Some(max_nights) = values.max_nights {
            query_builder.push(", max_nights = ");
            query_builder.push_bind(max_nights);
        }

        if let Some(min_advance_booking) = values.min_advance_booking {
            query_builder.push(", min_advance_booking = ");
            query_builder.push_bind(min_advance_booking);
        }

        if let Some(max_advance_booking) = values.max_advance_booking {
            query_builder.push(", max_advance_booking = ");
            query_builder.push_bind(max_advance_booking);
        }

        if let Some(is_active) = values.is_active {
            query_builder.push(", is_active = ");
            query_builder.push_bind(is_active);
        }

        if let Some(priority) = values.priority {
            query_builder.push(", priority = ");
            query_builder.push_bind(priority);
        }

        query_builder.push(" WHERE id = ");
        query_builder.push_bind(rate_plan_id);
        query_builder.push(" RETURNING *");

        query_builder
            .build()
            .fetch_one(pool)
            .await
            .map(|row| row_mappers::row_to_rate_plan(&row))
            .map_err(map_not_found)
    }

    pub async fn delete_rate_plan(pool: &DbPool, rate_plan_id: i64) -> Result<RatePlan, ApiError> {
        let existing = sqlx::query(
            "SELECT id, name, code, description, plan_type, adjustment_type, adjustment_value, \
             valid_from, valid_to, applies_monday, applies_tuesday, applies_wednesday, \
             applies_thursday, applies_friday, applies_saturday, applies_sunday, \
             min_nights, max_nights, min_advance_booking, max_advance_booking, \
             is_active, priority, created_at, updated_at \
             FROM rate_plans WHERE id = $1",
        )
            .bind(rate_plan_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?
            .map(|row| row_mappers::row_to_rate_plan(&row))
            .ok_or_else(|| ApiError::NotFound("Resource not found".to_string()))?;

        let result = sqlx::query("DELETE FROM rate_plans WHERE id = $1")
            .bind(rate_plan_id)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;

        if result.rows_affected() == 0 {
            return Err(ApiError::NotFound("Resource not found".to_string()));
        }

        Ok(existing)
    }

    pub async fn create_room_rate(
        pool: &DbPool,
        values: &RoomRateCreateValues,
    ) -> Result<RoomRate, ApiError> {
        sqlx::query(
            r#"
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            "#,
        )
        .bind(values.rate_plan_id)
        .bind(values.room_type_id)
        .bind(decimal_to_db(values.price))
        .bind(values.effective_from)
        .bind(values.effective_to)
        .fetch_one(pool)
        .await
        .map(|row| row_mappers::row_to_room_rate(&row))
        .map_err(ApiError::from)
    }

    pub async fn list_room_rates(pool: &DbPool) -> Result<Vec<RoomRateWithDetails>, ApiError> {
        let query = room_rate_details_query(None);
        let rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(rows
            .iter()
            .map(row_mappers::row_to_room_rate_with_details)
            .collect())
    }

    pub async fn room_rates_by_plan(
        pool: &DbPool,
        rate_plan_id: i64,
    ) -> Result<Vec<RoomRateWithDetails>, ApiError> {
        let query = room_rate_details_query(Some(" WHERE rr.rate_plan_id = $1"));
        let rows = sqlx::query(&query)
            .bind(rate_plan_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(rows
            .iter()
            .map(row_mappers::row_to_room_rate_with_details)
            .collect())
    }

    pub async fn find_room_rate(
        pool: &DbPool,
        rate_id: i64,
    ) -> Result<RoomRateWithDetails, ApiError> {
        let query = room_rate_details_query(Some(" WHERE rr.id = $1"));
        sqlx::query(&query)
            .bind(rate_id)
            .fetch_one(pool)
            .await
            .map(|row| row_mappers::row_to_room_rate_with_details(&row))
            .map_err(map_not_found)
    }

    pub async fn update_room_rate(
        pool: &DbPool,
        rate_id: i64,
        values: &RoomRateUpdateValues,
    ) -> Result<RoomRate, ApiError> {
        let mut query_builder = sqlx::QueryBuilder::new("UPDATE room_rates SET ");
        let mut has_previous = false;

        if let Some(price) = values.price {
            query_builder.push("price = ");
            query_builder.push_bind(decimal_to_db(price));
            has_previous = true;
        }

        if let Some(effective_from) = values.effective_from {
            if has_previous {
                query_builder.push(", ");
            }
            query_builder.push("effective_from = ");
            query_builder.push_bind(effective_from);
            has_previous = true;
        }

        if let Some(effective_to) = values.effective_to {
            if has_previous {
                query_builder.push(", ");
            }
            query_builder.push("effective_to = ");
            query_builder.push_bind(Some(effective_to));
        }

        query_builder.push(" WHERE id = ");
        query_builder.push_bind(rate_id);
        query_builder.push(" RETURNING *");

        query_builder
            .build()
            .fetch_one(pool)
            .await
            .map(|row| row_mappers::row_to_room_rate(&row))
            .map_err(map_not_found)
    }

    pub async fn delete_room_rate(pool: &DbPool, rate_id: i64) -> Result<RoomRate, ApiError> {
        let existing = sqlx::query(
            "SELECT id, rate_plan_id, room_type_id, price, effective_from, effective_to, created_at \
             FROM room_rates WHERE id = $1",
        )
            .bind(rate_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?
            .map(|row| row_mappers::row_to_room_rate(&row))
            .ok_or_else(|| ApiError::NotFound("Resource not found".to_string()))?;

        let result = sqlx::query("DELETE FROM room_rates WHERE id = $1")
            .bind(rate_id)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;

        if result.rows_affected() == 0 {
            return Err(ApiError::NotFound("Resource not found".to_string()));
        }

        Ok(existing)
    }

    pub async fn active_room_types(pool: &DbPool) -> Result<Vec<RoomType>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, code, description, base_price, weekday_rate, weekend_rate,
                   max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
                   extra_bed_charge, is_active, sort_order, created_at, updated_at
            FROM room_types
            WHERE is_active = true
            ORDER BY sort_order, name
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(rows.iter().map(row_mappers::row_to_room_type).collect())
    }

    pub async fn applicable_rate(
        pool: &DbPool,
        room_type_id: i64,
        date: NaiveDate,
        day_of_week: i32,
    ) -> Result<Option<RoomRateWithDetails>, ApiError> {
        sqlx::query(
            r#"
            SELECT
                rr.id,
                rr.rate_plan_id,
                rp.name as rate_plan_name,
                rp.code as rate_plan_code,
                rp.description as rate_plan_description,
                rr.room_type_id,
                rt.name as room_type_name,
                rt.code as room_type_code,
                rr.price,
                rr.effective_from,
                rr.effective_to,
                rr.created_at
            FROM room_rates rr
            JOIN rate_plans rp ON rr.rate_plan_id = rp.id
            JOIN room_types rt ON rr.room_type_id = rt.id
            WHERE rr.room_type_id = $1
              AND rp.is_active = true
              AND rr.effective_from <= $2
              AND (rr.effective_to IS NULL OR rr.effective_to >= $2)
              AND (rp.valid_from IS NULL OR rp.valid_from <= $2)
              AND (rp.valid_to IS NULL OR rp.valid_to >= $2)
              AND (
                  ($3 = 0 AND rp.applies_monday = true) OR
                  ($3 = 1 AND rp.applies_tuesday = true) OR
                  ($3 = 2 AND rp.applies_wednesday = true) OR
                  ($3 = 3 AND rp.applies_thursday = true) OR
                  ($3 = 4 AND rp.applies_friday = true) OR
                  ($3 = 5 AND rp.applies_saturday = true) OR
                  ($3 = 6 AND rp.applies_sunday = true)
              )
            ORDER BY rp.priority DESC
            LIMIT 1
            "#,
        )
        .bind(room_type_id)
        .bind(date)
        .bind(day_of_week)
        .fetch_optional(pool)
        .await
        .map(|row| row.map(|row| row_mappers::row_to_room_rate_with_details(&row)))
        .map_err(ApiError::from)
    }

    pub async fn find_room_type(pool: &DbPool, room_type_id: i64) -> Result<RoomType, ApiError> {
        sqlx::query(
            "SELECT id, name, code, description, base_price, weekday_rate, weekend_rate, \
             max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds, \
             extra_bed_charge, is_active, sort_order, created_at, updated_at \
             FROM room_types WHERE id = $1",
        )
            .bind(room_type_id)
            .fetch_one(pool)
            .await
            .map(|row| row_mappers::row_to_room_type(&row))
            .map_err(map_not_found)
    }
}

fn room_rate_details_query(where_clause: Option<&str>) -> String {
    let mut query = r#"
        SELECT
            rr.id,
            rr.rate_plan_id,
            rp.name as rate_plan_name,
            rp.code as rate_plan_code,
            rp.description as rate_plan_description,
            rr.room_type_id,
            rt.name as room_type_name,
            rt.code as room_type_code,
            rr.price,
            rr.effective_from,
            rr.effective_to,
            rr.created_at
        FROM room_rates rr
        JOIN rate_plans rp ON rr.rate_plan_id = rp.id
        JOIN room_types rt ON rr.room_type_id = rt.id
    "#
    .to_string();

    if let Some(where_clause) = where_clause {
        query.push_str(where_clause);
    }

    query.push_str(" ORDER BY rp.name, rt.sort_order, rt.name, rr.effective_from DESC");
    query
}

fn map_not_found(error: sqlx::Error) -> ApiError {
    match error {
        sqlx::Error::RowNotFound => ApiError::NotFound("Resource not found".to_string()),
        other => ApiError::Database(other.to_string()),
    }
}
