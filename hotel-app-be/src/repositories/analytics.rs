//! Analytics and reporting repository
//!
//! Query-heavy report generation for analytics dashboards.

use crate::core::db::{DbPool, DbRow};
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::ReportQuery;
use crate::models::row_mappers;
use crate::utils::date::parse_date_flexible;
use crate::utils::report_labels::payment_account_label;
use chrono::{Local, NaiveDate};
use rust_decimal::Decimal;
use sqlx::Row;

#[allow(dead_code)]
pub async fn websocket_status() -> Result<serde_json::Value, ApiError> {
    Ok(serde_json::json!({
        "status": "available",
        "protocol": "ws",
        "endpoint": "/ws",
        "message": "WebSocket server is running"
    }))
}

fn decimal_to_f64(value: Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}

fn row_i64(row: &DbRow, col: &str) -> i64 {
    row.try_get::<i64, _>(col)
        .or_else(|_| row.try_get::<i32, _>(col).map(i64::from))
        .unwrap_or(0)
}

fn row_i32(row: &DbRow, col: &str) -> i32 {
    row.try_get::<i32, _>(col)
        .or_else(|_| row.try_get::<i64, _>(col).map(|value| value as i32))
        .unwrap_or(0)
}

pub async fn occupancy_report(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    let total_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let occupied_rooms: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT room_id) FROM bookings
        WHERE status NOT IN ('voided')
        AND check_in_date <= date('now')
        AND check_out_date > date('now')
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let occupied_rooms: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT room_id) FROM bookings
        WHERE status NOT IN ('voided')
        AND check_in_date <= CURRENT_DATE
        AND check_out_date > CURRENT_DATE
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let occupancy_rate = if total_rooms > 0 {
        (occupied_rooms as f64 / total_rooms as f64) * 100.0
    } else {
        0.0
    };

    // Count only rooms with status 'available' (excludes maintenance, cleaning, out_of_order, etc.)
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let available_rooms: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM rooms WHERE status = 'available' AND is_active = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let available_rooms: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM rooms WHERE status = 'available' AND is_active = true",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let revenue_row = sqlx::query(
        r#"
        SELECT COALESCE(CAST(SUM(total_amount) AS TEXT), '0') as revenue FROM bookings
        WHERE status NOT IN ('voided')
        AND check_in_date <= date('now')
        AND check_out_date > date('now')
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let revenue = row_mappers::get_decimal(&revenue_row, "revenue");

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let revenue: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(total_amount), 0) FROM bookings
        WHERE status NOT IN ('voided')
        AND check_in_date <= CURRENT_DATE
        AND check_out_date > CURRENT_DATE
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(serde_json::json!({
        "totalRooms": total_rooms,
        "occupiedRooms": occupied_rooms,
        "occupancyRate": occupancy_rate,
        "availableRooms": available_rooms,
        "utilization": occupancy_rate,
        "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
    }))
}

pub async fn booking_analytics(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    let total_bookings: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE status NOT IN ('voided')")
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let revenue_row = sqlx::query(
        "SELECT CAST(SUM(total_amount) AS TEXT) as revenue FROM bookings WHERE status NOT IN ('voided')"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let total_revenue = row_mappers::get_opt_decimal(&revenue_row, "revenue").unwrap_or_default();

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let revenue_result: Option<Decimal> =
        sqlx::query_scalar("SELECT SUM(total_amount) FROM bookings WHERE status NOT IN ('voided')")
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let total_revenue = revenue_result.unwrap_or_default();

    let average_booking_value = if total_bookings > 0 {
        total_revenue / Decimal::from(total_bookings)
    } else {
        Decimal::ZERO
    };

    // Bookings by room type
    let bookings_by_type_rows = sqlx::query(
        r#"
        SELECT rt.name, COUNT(*) as count
        FROM bookings b
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.status NOT IN ('voided')
        GROUP BY rt.name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let bookings_by_room_type: serde_json::Map<String, serde_json::Value> = bookings_by_type_rows
        .into_iter()
        .map(|row| {
            let room_type: String = row.get("name");
            let count: i64 = row.get("count");
            (room_type, serde_json::Value::Number(count.into()))
        })
        .collect();

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let monthly_trend_rows = sqlx::query(
        r#"
        SELECT
            strftime('%Y-%m', check_in_date) as month_label,
            COUNT(*) as bookings,
            COALESCE(CAST(SUM(total_amount) AS TEXT), '0') as revenue
        FROM bookings
        WHERE status NOT IN ('voided')
          AND date(check_in_date) >= date('now', 'start of month', '-5 months')
        GROUP BY month_label
        ORDER BY month_label
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let monthly_trend_rows = sqlx::query(
        r#"
        SELECT
            to_char(month_start, 'Mon YYYY') as month_label,
            bookings,
            revenue
        FROM (
            SELECT
                date_trunc('month', check_in_date)::date as month_start,
                COUNT(*)::BIGINT as bookings,
                COALESCE(SUM(total_amount), 0) as revenue
            FROM bookings
            WHERE status NOT IN ('voided')
              AND check_in_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')
            GROUP BY month_start
        ) trend
        ORDER BY month_start
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let monthly_trends: Vec<serde_json::Value> = monthly_trend_rows
        .into_iter()
        .map(|row| {
            let month: String = row.get("month_label");
            let bookings = row_i64(&row, "bookings");
            let revenue = decimal_to_f64(row_mappers::get_decimal(&row, "revenue"));
            serde_json::json!({
                "month": month,
                "bookings": bookings,
                "revenue": revenue
            })
        })
        .collect();

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let peak_hour_rows = sqlx::query(
        r#"
        SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as bookings
        FROM bookings
        WHERE status NOT IN ('voided')
          AND created_at IS NOT NULL
        GROUP BY hour
        ORDER BY bookings DESC, hour
        LIMIT 6
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let peak_hour_rows = sqlx::query(
        r#"
        SELECT EXTRACT(HOUR FROM created_at)::INTEGER as hour, COUNT(*)::BIGINT as bookings
        FROM bookings
        WHERE status NOT IN ('voided')
          AND created_at IS NOT NULL
        GROUP BY hour
        ORDER BY bookings DESC, hour
        LIMIT 6
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let peak_booking_hours: Vec<i32> = peak_hour_rows
        .into_iter()
        .map(|row| row_i32(&row, "hour"))
        .collect();

    Ok(serde_json::json!({
        "totalBookings": total_bookings,
        "averageBookingValue": decimal_to_f64(average_booking_value),
        "totalRevenue": decimal_to_f64(total_revenue),
        "bookingsByRoomType": bookings_by_room_type,
        "peakBookingHours": peak_booking_hours,
        "monthlyTrends": monthly_trends
    }))
}

pub async fn benchmark_report(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    let occupancy = occupancy_report(pool).await?;
    let bookings = booking_analytics(pool).await?;

    let total_rooms = occupancy
        .get("totalRooms")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let occupied_rooms = occupancy
        .get("occupiedRooms")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let occupancy_rate = occupancy
        .get("occupancyRate")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);
    let total_revenue = bookings
        .get("totalRevenue")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);
    let total_bookings = bookings
        .get("totalBookings")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let average_booking_value = bookings
        .get("averageBookingValue")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);
    let revenue_per_room = if total_rooms > 0 {
        total_revenue / total_rooms as f64
    } else {
        0.0
    };
    let revenue_per_occupied_room = if occupied_rooms > 0 {
        total_revenue / occupied_rooms as f64
    } else {
        0.0
    };

    let occupancy_target = 70.0;
    let booking_value_target = 150.0;
    let revenue_per_room_target = 100.0;

    let performance_band = if occupancy_rate >= occupancy_target + 10.0 {
        "above_target"
    } else if occupancy_rate >= occupancy_target {
        "on_target"
    } else if occupancy_rate >= occupancy_target - 15.0 {
        "watch"
    } else {
        "below_target"
    };

    Ok(serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "summary": {
            "totalRooms": total_rooms,
            "occupiedRooms": occupied_rooms,
            "occupancyRate": occupancy_rate,
            "totalBookings": total_bookings,
            "totalRevenue": total_revenue,
            "averageBookingValue": average_booking_value,
            "revenuePerRoom": revenue_per_room,
            "revenuePerOccupiedRoom": revenue_per_occupied_room,
            "performanceBand": performance_band
        },
        "benchmarks": [
            {
                "metric": "Occupancy rate",
                "value": occupancy_rate,
                "target": occupancy_target,
                "variance": occupancy_rate - occupancy_target,
                "unit": "percent"
            },
            {
                "metric": "Average booking value",
                "value": average_booking_value,
                "target": booking_value_target,
                "variance": average_booking_value - booking_value_target,
                "unit": "currency"
            },
            {
                "metric": "Revenue per room",
                "value": revenue_per_room,
                "target": revenue_per_room_target,
                "variance": revenue_per_room - revenue_per_room_target,
                "unit": "currency"
            }
        ],
        "source": {
            "occupancy": occupancy,
            "bookingAnalytics": bookings
        }
    }))
}

fn report_period_start(period: &str) -> NaiveDate {
    let today = Local::now().date_naive();
    let days = match period {
        "week" => 7,
        "quarter" => 90,
        "year" => 365,
        _ => 30,
    };
    today - chrono::Duration::days(days)
}

fn recent_booking_json(row: &DbRow) -> serde_json::Value {
    serde_json::json!({
        "id": row_i64(row, "id"),
        "guest_name": row.try_get::<String, _>("guest_name").unwrap_or_else(|_| "Guest".to_string()),
        "room_number": row.try_get::<String, _>("room_number").unwrap_or_else(|_| "-".to_string()),
        "room_type": row.try_get::<String, _>("room_type").unwrap_or_else(|_| "Room".to_string()),
        "check_in": row.try_get::<String, _>("check_in").unwrap_or_default(),
        "check_out": row.try_get::<String, _>("check_out").unwrap_or_default(),
        "total_price": row.try_get::<String, _>("total_price").unwrap_or_else(|_| "0".to_string()),
        "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "unknown".to_string())
    })
}

// Personalized report handler - generates reports tailored to user role and context
pub async fn personalized_report(
    pool: &DbPool,
    user_id: i64,
    has_full_analytics: bool,
    params: std::collections::HashMap<String, String>,
) -> Result<serde_json::Value, ApiError> {
    let report_scope = if has_full_analytics {
        "all"
    } else {
        "personal"
    };
    let period = params.get("period").map(String::as_str).unwrap_or("month");
    let period_start = report_period_start(period);
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let period_start_text = period_start.to_string();

    let user_roles: Vec<String> = sqlx::query(
        r#"
        SELECT r.name
        FROM user_roles ur
        INNER JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = $1
        ORDER BY r.priority DESC, r.name
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>("name").ok())
    .collect();

    let total_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let occupied_rooms: i64 = {
        let mut query = String::from(
            r#"
            SELECT COUNT(DISTINCT b.room_id)
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            WHERE b.status NOT IN ('voided')
              AND b.check_in_date <= date('now')
              AND b.check_out_date > date('now')
            "#,
        );
        if !has_full_analytics {
            query.push_str(
                r#"
              AND (
                  b.created_by = $1
                  OR b.guest_id = (SELECT guest_id FROM users WHERE id = $1)
                  OR LOWER(COALESCE(g.email, '')) = (SELECT LOWER(COALESCE(email, '')) FROM users WHERE id = $1)
              )
                "#,
            );
        }

        let mut sql = sqlx::query_scalar::<_, i64>(&query);
        if !has_full_analytics {
            sql = sql.bind(user_id);
        }
        sql.fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    };

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let occupied_rooms: i64 = {
        let mut query = String::from(
            r#"
            SELECT COUNT(DISTINCT b.room_id)
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            WHERE b.status NOT IN ('voided')
              AND b.check_in_date <= CURRENT_DATE
              AND b.check_out_date > CURRENT_DATE
            "#,
        );
        if !has_full_analytics {
            query.push_str(
                r#"
              AND (
                  b.created_by = $1
                  OR b.guest_id = (SELECT guest_id FROM users WHERE id = $1)
                  OR LOWER(COALESCE(g.email, '')) = (SELECT LOWER(COALESCE(email, '')) FROM users WHERE id = $1)
              )
                "#,
            );
        }

        let mut sql = sqlx::query_scalar::<_, i64>(&query);
        if !has_full_analytics {
            sql = sql.bind(user_id);
        }
        sql.fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    };

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let (total_bookings, total_revenue) = {
        let row = if has_full_analytics {
            sqlx::query(
                r#"
                SELECT COUNT(*) as total_bookings, COALESCE(CAST(SUM(total_amount) AS TEXT), '0') as total_revenue
                FROM bookings
                WHERE status NOT IN ('voided')
                  AND date(check_in_date) >= date($1)
                "#,
            )
            .bind(&period_start_text)
            .fetch_one(pool)
            .await
        } else {
            sqlx::query(
                r#"
                SELECT COUNT(*) as total_bookings, COALESCE(CAST(SUM(b.total_amount) AS TEXT), '0') as total_revenue
                FROM bookings b
                INNER JOIN guests g ON b.guest_id = g.id
                WHERE b.status NOT IN ('voided')
                  AND date(b.check_in_date) >= date($1)
                  AND (
                      b.created_by = $2
                      OR b.guest_id = (SELECT guest_id FROM users WHERE id = $2)
                      OR LOWER(COALESCE(g.email, '')) = (SELECT LOWER(COALESCE(email, '')) FROM users WHERE id = $2)
                  )
                "#,
            )
            .bind(&period_start_text)
            .bind(user_id)
            .fetch_one(pool)
            .await
        }
        .map_err(|e| ApiError::Database(e.to_string()))?;

        (
            row_i64(&row, "total_bookings"),
            row_mappers::get_decimal(&row, "total_revenue"),
        )
    };

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let (total_bookings, total_revenue) = {
        let row = if has_full_analytics {
            sqlx::query(
                r#"
                SELECT COUNT(*)::BIGINT as total_bookings, COALESCE(SUM(total_amount), 0) as total_revenue
                FROM bookings
                WHERE status NOT IN ('voided')
                  AND check_in_date >= $1
                "#,
            )
            .bind(period_start)
            .fetch_one(pool)
            .await
        } else {
            sqlx::query(
                r#"
                SELECT COUNT(*)::BIGINT as total_bookings, COALESCE(SUM(b.total_amount), 0) as total_revenue
                FROM bookings b
                INNER JOIN guests g ON b.guest_id = g.id
                WHERE b.status NOT IN ('voided')
                  AND b.check_in_date >= $1
                  AND (
                      b.created_by = $2
                      OR b.guest_id = (SELECT guest_id FROM users WHERE id = $2)
                      OR LOWER(COALESCE(g.email, '')) = (SELECT LOWER(COALESCE(email, '')) FROM users WHERE id = $2)
                  )
                "#,
            )
            .bind(period_start)
            .bind(user_id)
            .fetch_one(pool)
            .await
        }
        .map_err(|e| ApiError::Database(e.to_string()))?;

        (
            row_i64(&row, "total_bookings"),
            row_mappers::get_decimal(&row, "total_revenue"),
        )
    };

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let recent_booking_rows = if has_full_analytics {
        sqlx::query(
            r#"
            SELECT
                b.id,
                COALESCE(g.full_name, 'Guest') as guest_name,
                r.room_number,
                COALESCE(rt.name, 'Room') as room_type,
                b.check_in_date as check_in,
                b.check_out_date as check_out,
                COALESCE(CAST(b.total_amount AS TEXT), '0') as total_price,
                b.status
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            INNER JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.status NOT IN ('voided')
              AND date(b.check_in_date) >= date($1)
            ORDER BY b.created_at DESC
            LIMIT 5
            "#,
        )
        .bind(&period_start_text)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT
                b.id,
                COALESCE(g.full_name, 'Guest') as guest_name,
                r.room_number,
                COALESCE(rt.name, 'Room') as room_type,
                b.check_in_date as check_in,
                b.check_out_date as check_out,
                COALESCE(CAST(b.total_amount AS TEXT), '0') as total_price,
                b.status
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            INNER JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.status NOT IN ('voided')
              AND date(b.check_in_date) >= date($1)
              AND (
                  b.created_by = $2
                  OR b.guest_id = (SELECT guest_id FROM users WHERE id = $2)
                  OR LOWER(COALESCE(g.email, '')) = (SELECT LOWER(COALESCE(email, '')) FROM users WHERE id = $2)
              )
            ORDER BY b.created_at DESC
            LIMIT 5
            "#,
        )
        .bind(&period_start_text)
        .bind(user_id)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let recent_booking_rows = if has_full_analytics {
        sqlx::query(
            r#"
            SELECT
                b.id,
                COALESCE(g.full_name, b.guest_name, 'Guest') as guest_name,
                r.room_number,
                COALESCE(rt.name, 'Room') as room_type,
                b.check_in_date::text as check_in,
                b.check_out_date::text as check_out,
                COALESCE(b.total_amount, 0)::text as total_price,
                b.status
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            INNER JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.status NOT IN ('voided')
              AND b.check_in_date >= $1
            ORDER BY b.created_at DESC
            LIMIT 5
            "#,
        )
        .bind(period_start)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT
                b.id,
                COALESCE(g.full_name, b.guest_name, 'Guest') as guest_name,
                r.room_number,
                COALESCE(rt.name, 'Room') as room_type,
                b.check_in_date::text as check_in,
                b.check_out_date::text as check_out,
                COALESCE(b.total_amount, 0)::text as total_price,
                b.status
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            INNER JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.status NOT IN ('voided')
              AND b.check_in_date >= $1
              AND (
                  b.created_by = $2
                  OR b.guest_id = (SELECT guest_id FROM users WHERE id = $2)
                  OR LOWER(COALESCE(g.email, '')) = (SELECT LOWER(COALESCE(email, '')) FROM users WHERE id = $2)
              )
            ORDER BY b.created_at DESC
            LIMIT 5
            "#,
        )
        .bind(period_start)
        .bind(user_id)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let recent_bookings: Vec<serde_json::Value> = recent_booking_rows
        .iter()
        .map(recent_booking_json)
        .collect();
    let total_revenue_value = decimal_to_f64(total_revenue);
    let average_booking_value = if total_bookings > 0 {
        total_revenue_value / total_bookings as f64
    } else {
        0.0
    };
    let occupancy_rate = if total_rooms > 0 {
        (occupied_rooms as f64 / total_rooms as f64) * 100.0
    } else {
        0.0
    };

    let insights = if total_bookings == 0 {
        vec![format!(
            "No {} bookings were found for the selected {} period.",
            report_scope, period
        )]
    } else if has_full_analytics {
        vec![
            format!(
                "{} booking(s) generated revenue during this {} period.",
                total_bookings, period
            ),
            format!("Current occupancy is {:.1}%.", occupancy_rate),
        ]
    } else {
        vec![format!(
            "{} booking(s) are linked to your account during this {} period.",
            total_bookings, period
        )]
    };

    Ok(serde_json::json!({
        "reportScope": report_scope,
        "hasFullAccess": has_full_analytics,
        "userRoles": user_roles,
        "period": period,
        "summary": {
            "totalRooms": total_rooms,
            "occupiedRooms": occupied_rooms,
            "occupancyRate": occupancy_rate,
            "totalBookings": total_bookings,
            "totalRevenue": total_revenue_value,
            "averageBookingValue": average_booking_value
        },
        "recentBookings": recent_bookings,
        "insights": insights,
        "generatedAt": chrono::Utc::now().to_rfc3339()
    }))
}

// ============================================================================
// REPORT GENERATION HANDLERS
// ============================================================================

pub async fn generate_report(
    pool: &DbPool,
    params: ReportQuery,
) -> Result<serde_json::Value, ApiError> {
    let start_date = parse_date_flexible(&params.start_date)
        .map_err(|e| ApiError::BadRequest(format!("Invalid start_date: {}", e)))?;
    let end_date = parse_date_flexible(&params.end_date)
        .map_err(|e| ApiError::BadRequest(format!("Invalid end_date: {}", e)))?;

    let report_data = match params.report_type.as_str() {
        // Legacy accounting reports
        "balance_sheet" => generate_balance_sheet(pool, start_date, end_date).await?,
        "journal_by_type" => generate_journal_by_type(pool, start_date, end_date).await?,
        "shift_report" => {
            generate_shift_report(
                pool,
                start_date,
                end_date,
                params.shift.as_deref(),
                params.drawer.as_deref(),
            )
            .await?
        }
        "rooms_sold" => generate_rooms_sold_report(pool, start_date, end_date).await?,
        "general_journal" => generate_general_journal(pool, start_date, end_date).await?,
        "company_ledger_statement" => {
            generate_company_ledger_statement(
                pool,
                start_date,
                end_date,
                params.company_name.as_deref(),
            )
            .await?
        }
        // New hotel management reports
        "daily_operations" => generate_daily_operations_report(pool, start_date).await?,
        "occupancy" => generate_occupancy_report(pool, start_date, end_date).await?,
        "revenue" => generate_revenue_report(pool, start_date, end_date).await?,
        "channel_net_revenue" | "ota_commission" => {
            crate::repositories::channel_net_revenue::generate(pool, &params, start_date, end_date)
                .await?
        }
        "payment_status" => generate_payment_status_report(pool, start_date, end_date).await?,
        "complimentary" => generate_complimentary_report(pool, start_date, end_date).await?,
        "guest_statistics" => generate_guest_statistics_report(pool, start_date, end_date).await?,
        "room_performance" => generate_room_performance_report(pool, start_date, end_date).await?,
        _ => {
            return Err(ApiError::BadRequest(format!(
                "Unknown report type: {}",
                params.report_type
            )));
        }
    };

    Ok(report_data)
}

// Balance Sheet Report
async fn generate_balance_sheet(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Get total room revenue
    let room_revenue_row = sqlx::query(
        "SELECT COALESCE(SUM(total_amount), 0) AS room_revenue FROM bookings
         WHERE check_in_date >= $1 AND check_in_date <= $2 AND status IN ('confirmed', 'checked_in', 'checked_out')"
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    let room_revenue = row_mappers::get_decimal(&room_revenue_row, "room_revenue");

    // Get deposit total (simplified - you'd track actual deposits in production)
    let deposits_row = sqlx::query(
        "SELECT COALESCE(SUM(total_amount * 0.2), 0) AS deposits FROM bookings
         WHERE check_in_date >= $1 AND check_in_date <= $2 AND status IN ('confirmed', 'pending')",
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    let deposits = row_mappers::get_decimal(&deposits_row, "deposits");

    let tax_rate_pct =
        settings_cache::get_positive_decimal(pool, "service_tax_rate", Decimal::new(8, 0)).await;
    let tax_rate = tax_rate_pct / Decimal::new(100, 0);
    let service_tax = room_revenue * tax_rate;

    let accounts = vec![
        serde_json::json!({
            "name": "Guest Ledger",
            "debit": room_revenue,
            "credit": 0,
            "balance": room_revenue
        }),
        serde_json::json!({
            "name": "Deposits Pending",
            "debit": 0,
            "credit": deposits,
            "balance": -deposits
        }),
        serde_json::json!({
            "name": "Room Revenue",
            "debit": 0,
            "credit": room_revenue,
            "balance": -room_revenue
        }),
        serde_json::json!({
            "name": "Sales Tax Payable",
            "debit": 0,
            "credit": service_tax,
            "balance": -service_tax
        }),
    ];

    let total_debit = room_revenue;
    let total_credit = room_revenue + deposits + service_tax;
    let total_balance = total_debit - total_credit;

    Ok(serde_json::json!({
        "accounts": accounts,
        "totalDebit": total_debit,
        "totalCredit": total_credit,
        "totalBalance": total_balance,
    }))
}

// Journal By Type Report
async fn generate_journal_by_type(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    let tax_rate_pct =
        settings_cache::get_positive_decimal(pool, "service_tax_rate", Decimal::new(8, 0)).await;
    let tax_rate = tax_rate_pct / Decimal::new(100, 0);

    let rows = sqlx::query(
        "SELECT
            b.id,
            b.check_in_date as date,
            b.booking_number as folio,
            r.room_number as room,
            b.total_amount,
            b.status,
            g.full_name as guest_name
         FROM bookings b
         JOIN rooms r ON b.room_id = r.id
         LEFT JOIN guests g ON b.guest_id = g.id
         WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
         ORDER BY b.check_in_date, b.id",
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut transactions = Vec::new();
    let mut total_debit = Decimal::ZERO;
    let mut total_credit = Decimal::ZERO;

    for row in rows {
        let amount = row_mappers::get_decimal(&row, "total_amount");
        let folio: Option<String> = row.get("folio");
        let room: String = row.get("room");
        let date: NaiveDate = row.get("date");

        // Debit entry (Room Charge)
        transactions.push(serde_json::json!({
            "date": date.and_hms_opt(8, 0, 0).unwrap().and_utc().to_rfc3339(),
            "folio": folio.clone().unwrap_or_default(),
            "account_code": "100",
            "description": "[Room Charge]",
            "debit": amount,
            "credit": 0,
            "room": room.clone(),
        }));
        total_debit += amount;

        // Credit entry (Service Tax)
        let service_tax = amount * tax_rate;
        transactions.push(serde_json::json!({
            "date": date.and_hms_opt(8, 0, 0).unwrap().and_utc().to_rfc3339(),
            "folio": folio.unwrap_or_default(),
            "account_code": "105",
            "description": "[Service Tax]",
            "debit": 0,
            "credit": service_tax,
            "room": room,
        }));
        total_credit += service_tax;
    }

    Ok(serde_json::json!({
        "transactions": transactions,
        "totalDebit": total_debit,
        "totalCredit": total_credit,
    }))
}

// Shift Report
async fn generate_shift_report(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
    _shift: Option<&str>,
    _drawer: Option<&str>,
) -> Result<serde_json::Value, ApiError> {
    // Get detailed payment records from bookings
    let rows = sqlx::query(
        r#"SELECT
            b.booking_number,
            b.check_in_date,
            b.check_out_date,
            g.full_name as guest_name,
            r.room_number,
            rt.name as room_type,
            b.total_amount,
            b.payment_method,
            b.payment_status,
            b.deposit_amount,
            b.deposit_paid,
            b.status as booking_status,
            b.source,
            b.created_at
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        LEFT JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status IN ('confirmed', 'checked_in', 'checked_out')
        ORDER BY b.check_in_date ASC, b.created_at ASC"#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut payments: Vec<serde_json::Value> = Vec::new();
    let mut total_revenue = Decimal::ZERO;
    let mut total_deposits = Decimal::ZERO;
    let mut payment_by_method: std::collections::HashMap<String, Decimal> =
        std::collections::HashMap::new();

    for row in &rows {
        let booking_number: String = row.get("booking_number");
        let check_in_date: NaiveDate = row.get("check_in_date");
        let guest_name: String = row.get("guest_name");
        let room_number: String = row.get("room_number");
        let room_type: Option<String> = row.get("room_type");
        let total_amount = row_mappers::get_decimal(row, "total_amount");
        let payment_method: Option<String> = row.get("payment_method");
        let payment_status: Option<String> = row.get("payment_status");
        let deposit_amount = row_mappers::get_opt_decimal(row, "deposit_amount");
        let deposit_paid: Option<bool> = row.get("deposit_paid");
        let booking_status: String = row.get("booking_status");
        let source: Option<String> = row.get("source");

        total_revenue += total_amount;
        if let Some(dep) = deposit_amount
            && deposit_paid.unwrap_or(false)
        {
            total_deposits += dep;
        }

        let method = payment_method.clone().unwrap_or_else(|| "cash".to_string());
        *payment_by_method
            .entry(method.clone())
            .or_insert(Decimal::ZERO) += total_amount;

        payments.push(serde_json::json!({
            "booking_number": booking_number,
            "date": check_in_date.format("%Y-%m-%d").to_string(),
            "guest_name": guest_name,
            "room_number": room_number,
            "room_type": room_type.unwrap_or_default(),
            "amount": total_amount,
            "payment_method": payment_method.unwrap_or_else(|| "cash".to_string()),
            "payment_status": payment_status.unwrap_or_else(|| "unpaid".to_string()),
            "deposit_amount": deposit_amount.unwrap_or(Decimal::ZERO),
            "deposit_paid": deposit_paid.unwrap_or(false),
            "booking_status": booking_status,
            "source": source.unwrap_or_else(|| "walk_in".to_string()),
        }));
    }

    // Build payment method summary
    let payment_summary: Vec<serde_json::Value> = payment_by_method
        .iter()
        .map(|(method, amount)| {
            serde_json::json!({
                "method": method,
                "amount": amount,
                "count": payments.iter().filter(|p| p["payment_method"] == *method).count()
            })
        })
        .collect();

    Ok(serde_json::json!({
        "period": {
            "start": start_date.format("%Y-%m-%d").to_string(),
            "end": end_date.format("%Y-%m-%d").to_string(),
        },
        "payments": payments,
        "summary": {
            "total_bookings": payments.len(),
            "total_revenue": total_revenue,
            "total_deposits": total_deposits,
        },
        "by_payment_method": payment_summary,
    }))
}

// Rooms Sold Detail Report
async fn generate_rooms_sold_report(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    let rows = sqlx::query(
        "SELECT
            b.id,
            b.check_in_date,
            b.check_out_date,
            b.adults,
            b.children,
            b.infants,
            b.booking_number,
            NULL::VARCHAR as post_type,
            NULL::VARCHAR as rate_code,
            r.room_number,
            rt.name as room_type,
            g.full_name as guest_name
         FROM bookings b
         JOIN rooms r ON b.room_id = r.id
         JOIN room_types rt ON r.room_type_id = rt.id
         LEFT JOIN guests g ON b.guest_id = g.id
         WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
         ORDER BY b.check_in_date",
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut bookings = Vec::new();
    for row in &rows {
        let check_in: NaiveDate = row.get("check_in_date");
        let check_out: NaiveDate = row.get("check_out_date");
        let post_type: Option<String> = row.get("post_type");
        let is_same_day = post_type.as_deref() == Some("same_day");

        bookings.push(serde_json::json!({
            "check_in_date": check_in.to_string(),
            "check_out_date": check_out.to_string(),
            "room_number": row.get::<String, _>("room_number"),
            "room_type": row.get::<String, _>("room_type"),
            "folio": row.get::<Option<String>, _>("booking_number").unwrap_or_else(|| "".to_string()),
            "guest_name": row.get::<Option<String>, _>("guest_name").unwrap_or_else(|| "Guest".to_string()),
            "post_type": if is_same_day { "Same Day" } else { "Normal Stay" },
            "adult_count": row.get::<i32, _>("adults"),
            "child_count": row.get::<i32, _>("children"),
            "infant_count": row.get::<i32, _>("infants"),
            "rate_plan": row.get::<Option<String>, _>("rate_code").unwrap_or_else(|| "RACK".to_string()),
        }));
    }

    Ok(serde_json::json!({
        "bookings": bookings,
        "total_rooms": rows.len(),
    }))
}

// General Journal Report - Double-entry accounting format
async fn generate_general_journal(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Get all bookings within the date range with payment details
    let rows = sqlx::query(
        r#"
        SELECT
            b.id,
            b.check_in_date as date,
            b.booking_number as folio,
            b.total_amount,
            b.room_rate,
            COALESCE(b.tax_amount, 0) as tax_amount,
            -- PG 18 VIRTUAL generated column (migration 019): tourism_tax_amount
            -- gated on is_tourist, so non-tourist bookings never post tourism tax.
            b.tourism_billable_amount as tourism_tax_amount,
            b.payment_status,
            b.payment_method,
            b.source,
            b.remarks as booking_remarks,
            COALESCE(b.deposit_amount, 0) as deposit_amount,
            b.deposit_paid,
            r.room_number,
            g.full_name as guest_name
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        LEFT JOIN guests g ON b.guest_id = g.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
          AND b.status IN ('confirmed', 'checked_in', 'checked_out')
        ORDER BY b.check_in_date, b.id
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Initialize section data
    let deposit_ledger_entries: Vec<serde_json::Value> = Vec::new();
    let mut guest_ledger_entries: Vec<serde_json::Value> = Vec::new();
    let mut deposits_pending_entries: Vec<serde_json::Value> = Vec::new();
    let mut room_revenue_entries: Vec<serde_json::Value> = Vec::new();
    let mut sales_tax_entries: Vec<serde_json::Value> = Vec::new();

    let deposit_ledger_debit = Decimal::ZERO;
    let deposit_ledger_credit = Decimal::ZERO;
    let mut guest_ledger_debit = Decimal::ZERO;
    let mut guest_ledger_credit = Decimal::ZERO;
    let mut deposits_pending_debit = Decimal::ZERO;
    let deposits_pending_credit = Decimal::ZERO;
    let room_revenue_debit = Decimal::ZERO;
    let mut room_revenue_credit = Decimal::ZERO;
    let sales_tax_debit = Decimal::ZERO;
    let mut sales_tax_credit = Decimal::ZERO;

    for row in rows {
        let date: NaiveDate = row.get("date");
        let total_amount = row_mappers::get_decimal(&row, "total_amount");
        let room_rate = row_mappers::get_decimal(&row, "room_rate");
        let tax_amount = row_mappers::get_decimal(&row, "tax_amount");
        let tourism_tax_amount = row_mappers::get_decimal(&row, "tourism_tax_amount");
        let payment_status: Option<String> = row.get("payment_status");
        let payment_method: Option<String> = row.get("payment_method");
        let source: Option<String> = row.get("source");
        let booking_remarks: Option<String> = row.get("booking_remarks");
        let deposit_amount_val = row_mappers::get_decimal(&row, "deposit_amount");
        let room_number: String = row.get("room_number");
        let date_str = date.format("%d/%m/%Y").to_string();

        // Use actual values from booking instead of hardcoded calculations
        let service_tax = tax_amount;
        let tourism_tax = tourism_tax_amount;
        let room_charge = room_rate;

        // Use actual deposit amount from booking
        let deposit_amount = deposit_amount_val;

        let paid_amount =
            if payment_status.as_deref() == Some("paid") && deposit_amount_val <= Decimal::ZERO {
                total_amount
            } else {
                deposit_amount_val
            };

        // Guest Ledger entries: payments/platforms debit, charges and taxes credit.
        // Room Charge
        guest_ledger_entries.push(serde_json::json!({
            "date": date_str,
            "account": "Room Charge",
            "debit": 0,
            "credit": room_charge,
            "contra_account": "Room Revenue",
            "contra_amount": room_charge,
            "room_number": room_number
        }));
        guest_ledger_credit += room_charge;

        // Service Tax
        guest_ledger_entries.push(serde_json::json!({
            "date": date_str,
            "account": "Service Tax",
            "debit": 0,
            "credit": service_tax,
            "contra_account": "Sales Tax Payable",
            "contra_amount": service_tax,
            "room_number": room_number
        }));
        guest_ledger_credit += service_tax;

        // Tourism Tax (if applicable)
        if tourism_tax > Decimal::ZERO {
            guest_ledger_entries.push(serde_json::json!({
                "date": date_str,
                "account": "Tourism Tax",
                "debit": 0,
                "credit": tourism_tax,
                "contra_account": "Tourism Tax Payable",
                "contra_amount": tourism_tax,
                "room_number": room_number
            }));
            guest_ledger_credit += tourism_tax;
        }

        // Payment entries based on payment method (use actual amount paid)
        if (payment_status.as_deref() == Some("paid")
            || payment_status.as_deref() == Some("partial"))
            && paid_amount > Decimal::ZERO
        {
            let account_name = payment_account_label(
                payment_method.as_deref(),
                source.as_deref(),
                booking_remarks.as_deref(),
            );
            guest_ledger_entries.push(serde_json::json!({
                "date": date_str,
                "account": account_name,
                "debit": paid_amount,
                "credit": 0,
                "contra_account": "Deposits Pending",
                "contra_amount": paid_amount,
                "room_number": room_number
            }));
            guest_ledger_debit += paid_amount;
        }

        // Room card deposit entry (only if deposit exists)
        if deposit_amount > Decimal::ZERO {
            guest_ledger_entries.push(serde_json::json!({
                "date": date_str,
                "account": "Room Card Deposit",
                "debit": deposit_amount,
                "credit": 0,
                "contra_account": "Deposits Pending",
                "contra_amount": deposit_amount,
                "room_number": room_number
            }));
            guest_ledger_debit += deposit_amount;
        }

        // Deposits Pending (Credits)
        if deposit_amount > Decimal::ZERO {
            let account_name = payment_account_label(
                payment_method.as_deref(),
                source.as_deref(),
                booking_remarks.as_deref(),
            );
            deposits_pending_entries.push(serde_json::json!({
                "date": date_str,
                "account": account_name,
                "debit": deposit_amount,
                "credit": 0,
                "contra_account": "Guest Ledger",
                "contra_amount": 0,
                "room_number": room_number
            }));
            deposits_pending_debit += deposit_amount;
        }

        // Room Revenue (Credits)
        room_revenue_entries.push(serde_json::json!({
            "date": date_str,
            "account": "Room Charge",
            "debit": 0,
            "credit": room_charge,
            "contra_account": "Guest Ledger",
            "contra_amount": room_charge,
            "room_number": room_number
        }));
        room_revenue_credit += room_charge;

        // Sales Tax Payable (Credits)
        if service_tax > Decimal::ZERO {
            sales_tax_entries.push(serde_json::json!({
                "date": date_str,
                "account": "Service Tax",
                "debit": 0,
                "credit": service_tax,
                "contra_account": "Guest Ledger",
                "contra_amount": service_tax,
                "room_number": room_number
            }));
            sales_tax_credit += service_tax;
        }

        // Tourism Tax Payable (Credits)
        if tourism_tax > Decimal::ZERO {
            sales_tax_entries.push(serde_json::json!({
                "date": date_str,
                "account": "Tourism Tax",
                "debit": 0,
                "credit": tourism_tax,
                "contra_account": "Guest Ledger",
                "contra_amount": tourism_tax,
                "room_number": room_number
            }));
            sales_tax_credit += tourism_tax;
        }
    }

    let refund_rows = sqlx::query(
        r#"
        SELECT
            (p.created_at::date) as date,
            p.amount,
            r.room_number
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN rooms r ON b.room_id = r.id
        WHERE p.payment_type = 'refund'
          AND p.status = 'refunded'
          AND b.status != 'voided'
          AND p.created_at::date >= $1
          AND p.created_at::date <= $2
        ORDER BY p.created_at, p.id
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    for row in refund_rows {
        let date: NaiveDate = row.get("date");
        let amount = row_mappers::get_decimal(&row, "amount");
        let room_number: String = row.get("room_number");
        guest_ledger_entries.push(serde_json::json!({
            "date": date.format("%d/%m/%Y").to_string(),
            "account": "Deposit Refund",
            "debit": 0,
            "credit": amount,
            "contra_account": "Guest Ledger",
            "contra_amount": 0,
            "room_number": room_number
        }));
        guest_ledger_credit += amount;
    }

    // Build sections array
    let mut sections = Vec::new();

    // Deposit Ledger section
    sections.push(serde_json::json!({
        "name": "Deposit Ledger",
        "entries": deposit_ledger_entries,
        "total_debit": deposit_ledger_debit,
        "total_credit": deposit_ledger_credit,
        "net_amount": deposit_ledger_debit - deposit_ledger_credit
    }));

    // Guest Ledger section
    let guest_net = guest_ledger_debit - guest_ledger_credit;
    sections.push(serde_json::json!({
        "name": "Guest Ledger",
        "entries": guest_ledger_entries,
        "total_debit": guest_ledger_debit,
        "total_credit": guest_ledger_credit,
        "net_amount": guest_net
    }));

    // City Ledger section (empty for now - would come from customer_ledgers)
    sections.push(serde_json::json!({
        "name": "City Ledger",
        "entries": [],
        "total_debit": 0,
        "total_credit": 0,
        "net_amount": 0
    }));

    // Deposits Pending section
    sections.push(serde_json::json!({
        "name": "Deposits Pending",
        "entries": deposits_pending_entries,
        "total_debit": deposits_pending_debit,
        "total_credit": deposits_pending_credit,
        "net_amount": deposits_pending_debit - deposits_pending_credit
    }));

    // Room Revenue section
    sections.push(serde_json::json!({
        "name": "Room Revenue",
        "entries": room_revenue_entries,
        "total_debit": room_revenue_debit,
        "total_credit": room_revenue_credit,
        "net_amount": room_revenue_debit - room_revenue_credit
    }));

    // Sales Tax Payable section
    sections.push(serde_json::json!({
        "name": "Sales Tax Payable",
        "entries": sales_tax_entries,
        "total_debit": sales_tax_debit,
        "total_credit": sales_tax_credit,
        "net_amount": sales_tax_debit - sales_tax_credit
    }));

    // Calculate overall balance
    let total_debits = deposit_ledger_debit
        + guest_ledger_debit
        + deposits_pending_debit
        + room_revenue_debit
        + sales_tax_debit;
    let total_credits = deposit_ledger_credit
        + guest_ledger_credit
        + deposits_pending_credit
        + room_revenue_credit
        + sales_tax_credit;
    let balance = total_debits - total_credits;

    Ok(serde_json::json!({
        "sections": sections,
        "total_debits": total_debits,
        "total_credits": total_credits,
        "balance": balance
    }))
}

// ============================================================================
// NEW HOTEL MANAGEMENT REPORTS
// ============================================================================

// Daily Operations Report - Today's hotel activity snapshot
async fn generate_daily_operations_report(
    pool: &DbPool,
    date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Today's arrivals (expected check-ins)
    let arrivals: Vec<(i64, String, String, String, Option<String>)> = sqlx::query_as(
        r#"
        SELECT b.id, b.booking_number, g.full_name, r.room_number, b.payment_status
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.check_in_date = $1 AND b.status IN ('confirmed', 'pending')
        ORDER BY r.room_number
        "#,
    )
    .bind(date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Today's departures (expected check-outs)
    let departures: Vec<(i64, String, String, String, Option<String>)> = sqlx::query_as(
        r#"
        SELECT b.id, b.booking_number, g.full_name, r.room_number, b.payment_status
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.check_out_date = $1 AND b.status IN ('checked_in', 'auto_checked_in', 'late_checkout')
        ORDER BY r.room_number
        "#
    )
    .bind(date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // In-house guests (currently occupied)
    let in_house: Vec<(i64, String, String, String, NaiveDate, NaiveDate)> = sqlx::query_as(
        r#"
        SELECT b.id, b.booking_number, g.full_name, r.room_number, b.check_in_date, b.check_out_date
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.status IN ('checked_in', 'auto_checked_in')
        ORDER BY r.room_number
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Room status breakdown
    let room_status: Vec<(String, i64)> = sqlx::query_as(
        "SELECT status, COUNT(*)::bigint FROM rooms WHERE is_active = true GROUP BY status",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Total rooms
    let total_rooms: Option<i64> =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM rooms WHERE is_active = true")
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    let total_rooms = total_rooms.unwrap_or(0);

    // Tonight's expected occupancy
    let tonight_occupied: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT room_id)::bigint FROM bookings
        WHERE check_in_date <= $1 AND check_out_date > $1
        AND status NOT IN ('voided')
        "#,
    )
    .bind(date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    let tonight_occupied = tonight_occupied.unwrap_or(0);

    let occupancy_rate = if total_rooms > 0 {
        (tonight_occupied as f64 / total_rooms as f64) * 100.0
    } else {
        0.0
    };

    let arrivals_json: Vec<serde_json::Value> = arrivals
        .into_iter()
        .map(
            |(id, booking_number, guest_name, room_number, payment_status)| {
                serde_json::json!({
                    "id": id,
                    "booking_number": booking_number,
                    "guest_name": guest_name,
                    "room_number": room_number,
                    "payment_status": payment_status
                })
            },
        )
        .collect();

    let departures_json: Vec<serde_json::Value> = departures
        .into_iter()
        .map(
            |(id, booking_number, guest_name, room_number, payment_status)| {
                serde_json::json!({
                    "id": id,
                    "booking_number": booking_number,
                    "guest_name": guest_name,
                    "room_number": room_number,
                    "payment_status": payment_status
                })
            },
        )
        .collect();

    let in_house_json: Vec<serde_json::Value> = in_house
        .into_iter()
        .map(
            |(id, booking_number, guest_name, room_number, check_in, check_out)| {
                serde_json::json!({
                    "id": id,
                    "booking_number": booking_number,
                    "guest_name": guest_name,
                    "room_number": room_number,
                    "check_in_date": check_in.to_string(),
                    "check_out_date": check_out.to_string()
                })
            },
        )
        .collect();

    let room_status_map: serde_json::Map<String, serde_json::Value> = room_status
        .into_iter()
        .map(|(status, count)| (status, serde_json::Value::Number(count.into())))
        .collect();

    Ok(serde_json::json!({
        "date": date.to_string(),
        "arrivals": arrivals_json,
        "arrivals_count": arrivals_json.len(),
        "departures": departures_json,
        "departures_count": departures_json.len(),
        "in_house": in_house_json,
        "in_house_count": in_house_json.len(),
        "room_status": room_status_map,
        "total_rooms": total_rooms,
        "tonight_occupied": tonight_occupied,
        "occupancy_rate": occupancy_rate
    }))
}

// Occupancy Report - Occupancy metrics over a date range
async fn generate_occupancy_report(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Total active rooms
    let total_rooms: Option<i64> =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM rooms WHERE is_active = true")
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    let total_rooms = total_rooms.unwrap_or(0);

    // Rooms sold and revenue
    let stats = sqlx::query(
        r#"
        SELECT COUNT(*)::bigint AS rooms_sold, SUM(total_amount) AS total_revenue
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let rooms_sold = row_i64(&stats, "rooms_sold");
    let total_revenue =
        row_mappers::get_opt_decimal(&stats, "total_revenue").unwrap_or(Decimal::ZERO);

    // Calculate days in range
    let days_in_range = (end_date - start_date).num_days() + 1;
    let available_room_nights = total_rooms * days_in_range;

    // ADR and RevPAR
    let adr = if rooms_sold > 0 {
        total_revenue / Decimal::from(rooms_sold)
    } else {
        Decimal::ZERO
    };

    let revpar = if available_room_nights > 0 {
        total_revenue / Decimal::from(available_room_nights)
    } else {
        Decimal::ZERO
    };

    let occupancy_rate = if available_room_nights > 0 {
        (rooms_sold as f64 / available_room_nights as f64) * 100.0
    } else {
        0.0
    };

    // Occupancy by room type
    let by_room_type = sqlx::query(
        r#"
        SELECT rt.name AS room_type, COUNT(*) AS bookings, SUM(b.total_amount) AS revenue
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('voided')
        GROUP BY rt.name
        ORDER BY COUNT(*) DESC
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_room_type_json: Vec<serde_json::Value> = by_room_type
        .iter()
        .map(|row| {
            let revenue = row_mappers::get_opt_decimal(row, "revenue").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "room_type": row.get::<String, _>("room_type"),
                "bookings": row_i64(row, "bookings"),
                "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    // Daily breakdown
    let daily_data = sqlx::query(
        r#"
        SELECT check_in_date, COUNT(*) AS bookings, SUM(total_amount) AS revenue
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        GROUP BY check_in_date
        ORDER BY check_in_date
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let daily_json: Vec<serde_json::Value> = daily_data
        .iter()
        .map(|row| {
            let date: NaiveDate = row.get("check_in_date");
            let count = row_i64(row, "bookings");
            let revenue = row_mappers::get_opt_decimal(row, "revenue").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "date": date.to_string(),
                "bookings": count,
                "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0),
                "occupancy_rate": if total_rooms > 0 { (count as f64 / total_rooms as f64) * 100.0 } else { 0.0 }
            })
        })
        .collect();

    Ok(serde_json::json!({
        "period": {
            "start": start_date.to_string(),
            "end": end_date.to_string(),
            "days": days_in_range
        },
        "summary": {
            "total_rooms": total_rooms,
            "rooms_sold": rooms_sold,
            "available_room_nights": available_room_nights,
            "occupancy_rate": occupancy_rate,
            "total_revenue": total_revenue.to_string().parse::<f64>().unwrap_or(0.0),
            "adr": adr.to_string().parse::<f64>().unwrap_or(0.0),
            "revpar": revpar.to_string().parse::<f64>().unwrap_or(0.0)
        },
        "by_room_type": by_room_type_json,
        "daily": daily_json
    }))
}

// Revenue Report - Revenue breakdown and analysis
async fn generate_revenue_report(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Total revenue
    let total_revenue_row = sqlx::query(
        r#"
        SELECT SUM(total_amount) AS total_revenue FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total =
        row_mappers::get_opt_decimal(&total_revenue_row, "total_revenue").unwrap_or(Decimal::ZERO);

    // Revenue by room type
    let by_room_type = sqlx::query(
        r#"
        SELECT rt.name AS room_type, COUNT(*) AS bookings, SUM(b.total_amount) AS revenue
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('voided')
        GROUP BY rt.name
        ORDER BY SUM(b.total_amount) DESC
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Revenue by source
    let by_source = sqlx::query(
        r#"
        SELECT source, COUNT(*) AS bookings, SUM(total_amount) AS revenue
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        GROUP BY source
        ORDER BY SUM(total_amount) DESC
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Revenue by payment status
    let by_payment_status = sqlx::query(
        r#"
        SELECT payment_status, COUNT(*) AS bookings, SUM(total_amount) AS revenue
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        GROUP BY payment_status
        ORDER BY SUM(total_amount) DESC
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Daily revenue
    let daily_data = sqlx::query(
        r#"
        SELECT check_in_date, COUNT(*) AS bookings, SUM(total_amount) AS revenue
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        GROUP BY check_in_date
        ORDER BY check_in_date
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_room_type_json: Vec<serde_json::Value> = by_room_type
        .iter()
        .map(|row| {
            let revenue = row_mappers::get_opt_decimal(row, "revenue").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "room_type": row.get::<String, _>("room_type"),
                "bookings": row_i64(row, "bookings"),
                "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let by_source_json: Vec<serde_json::Value> = by_source
        .iter()
        .map(|row| {
            let revenue = row_mappers::get_opt_decimal(row, "revenue").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "source": row.try_get::<Option<String>, _>("source").ok().flatten().unwrap_or_else(|| "unknown".to_string()),
                "bookings": row_i64(row, "bookings"),
                "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let by_payment_status_json: Vec<serde_json::Value> = by_payment_status
        .iter()
        .map(|row| {
            let revenue = row_mappers::get_opt_decimal(row, "revenue").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "payment_status": row.try_get::<Option<String>, _>("payment_status").ok().flatten().unwrap_or_else(|| "unknown".to_string()),
                "bookings": row_i64(row, "bookings"),
                "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let daily_json: Vec<serde_json::Value> = daily_data
        .iter()
        .map(|row| {
            let date: NaiveDate = row.get("check_in_date");
            let revenue = row_mappers::get_opt_decimal(row, "revenue").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "date": date.to_string(),
                "bookings": row_i64(row, "bookings"),
                "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    Ok(serde_json::json!({
        "period": {
            "start": start_date.to_string(),
            "end": end_date.to_string()
        },
        "total_revenue": total.to_string().parse::<f64>().unwrap_or(0.0),
        "by_room_type": by_room_type_json,
        "by_source": by_source_json,
        "by_payment_status": by_payment_status_json,
        "daily": daily_json
    }))
}

// Payment Status Report - Outstanding payments and payment performance
async fn generate_payment_status_report(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Bookings by payment status
    let by_status = sqlx::query(
        r#"
        SELECT payment_status, COUNT(*) AS bookings, SUM(total_amount) AS total_amount
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        GROUP BY payment_status
        ORDER BY COUNT(*) DESC
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Calculate outstanding balance (unpaid bookings)
    let outstanding_row = sqlx::query(
        r#"
        SELECT SUM(total_amount) AS outstanding_balance FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        AND payment_status IN ('unpaid', 'unpaid_deposit', 'partial')
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    let outstanding = row_mappers::get_opt_decimal(&outstanding_row, "outstanding_balance");

    // Overdue payments (past check-out with unpaid status)
    let overdue = sqlx::query(
        r#"
        SELECT b.id, b.booking_number, g.full_name AS guest_name, r.room_number,
               b.total_amount, b.check_out_date, b.payment_status
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.check_out_date < CURRENT_DATE
        AND b.status NOT IN ('voided')
        AND b.payment_status IN ('unpaid', 'unpaid_deposit', 'partial')
        ORDER BY b.check_out_date DESC
        LIMIT 50
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_status_json: Vec<serde_json::Value> = by_status
        .iter()
        .map(|row| {
            let amount = row_mappers::get_opt_decimal(row, "total_amount").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "payment_status": row.try_get::<Option<String>, _>("payment_status").ok().flatten().unwrap_or_else(|| "unknown".to_string()),
                "count": row_i64(row, "bookings"),
                "total_amount": amount.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let overdue_json: Vec<serde_json::Value> = overdue
        .iter()
        .map(|row| {
            let amount = row_mappers::get_decimal(row, "total_amount");
            let check_out: NaiveDate = row.get("check_out_date");
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "booking_number": row.get::<String, _>("booking_number"),
                "guest_name": row.get::<String, _>("guest_name"),
                "room_number": row.get::<String, _>("room_number"),
                "total_amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
                "check_out_date": check_out.to_string(),
                "payment_status": row.try_get::<Option<String>, _>("payment_status").ok().flatten()
            })
        })
        .collect();

    Ok(serde_json::json!({
        "period": {
            "start": start_date.to_string(),
            "end": end_date.to_string()
        },
        "by_status": by_status_json,
        "outstanding_balance": outstanding.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0),
        "overdue": overdue_json,
        "overdue_count": overdue_json.len()
    }))
}

// Complimentary Report - Track complimentary stays
async fn generate_complimentary_report(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // All complimentary bookings
    let complimentary = sqlx::query(
        r#"
        SELECT b.id, b.booking_number, g.full_name AS guest_name, r.room_number,
               b.check_in_date, b.check_out_date,
               b.is_complimentary, b.complimentary_reason,
               b.complimentary_start_date, b.complimentary_end_date,
               b.original_total_amount, b.total_amount, b.complimentary_nights, b.status
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.is_complimentary = true
        ORDER BY b.check_in_date DESC
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Summary stats
    let mut total_complimentary_nights = 0i32;
    let mut total_original_amount = Decimal::ZERO;
    let mut total_actual_amount = Decimal::ZERO;
    let mut partial_count = 0i64;
    let mut full_count = 0i64;
    let mut reasons_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();

    let bookings_json: Vec<serde_json::Value> = complimentary
        .iter()
        .map(|row| {
            let id: i64 = row.get("id");
            let booking_number: String = row.get("booking_number");
            let guest_name: String = row.get("guest_name");
            let room_number: String = row.get("room_number");
            let check_in: NaiveDate = row.get("check_in_date");
            let check_out: NaiveDate = row.get("check_out_date");
            let is_complimentary: Option<bool> = row.try_get("is_complimentary").ok();
            let reason: Option<String> = row.try_get("complimentary_reason").ok();
            let comp_start: Option<NaiveDate> = row.try_get("complimentary_start_date").ok();
            let comp_end: Option<NaiveDate> = row.try_get("complimentary_end_date").ok();
            let original = row_mappers::get_opt_decimal(row, "original_total_amount");
            let actual = row_mappers::get_decimal(row, "total_amount");
            let nights: Option<i32> = row.try_get("complimentary_nights").ok();
            let status: String = row.get("status");

            total_complimentary_nights += nights.unwrap_or(0);
            total_original_amount += original.unwrap_or(Decimal::ZERO);
            total_actual_amount += actual;

            if status == "complimentary" {
                full_count += 1;
            } else if status == "partial_complimentary" {
                partial_count += 1;
            }

            let reason_key = reason.clone().unwrap_or_else(|| "Not specified".to_string());
            *reasons_map.entry(reason_key).or_insert(0) += 1;

            serde_json::json!({
                "id": id,
                "booking_number": booking_number,
                "guest_name": guest_name,
                "room_number": room_number,
                "check_in_date": check_in.to_string(),
                "check_out_date": check_out.to_string(),
                "is_complimentary": is_complimentary,
                "complimentary_reason": reason,
                "complimentary_start_date": comp_start.map(|d| d.to_string()),
                "complimentary_end_date": comp_end.map(|d| d.to_string()),
                "original_amount": original.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0),
                "actual_amount": actual.to_string().parse::<f64>().unwrap_or(0.0),
                "complimentary_nights": nights,
                "status": status
            })
        })
        .collect();

    let discount_given = total_original_amount - total_actual_amount;

    let reasons_json: Vec<serde_json::Value> = reasons_map
        .into_iter()
        .map(|(reason, count)| serde_json::json!({ "reason": reason, "count": count }))
        .collect();

    Ok(serde_json::json!({
        "period": {
            "start": start_date.to_string(),
            "end": end_date.to_string()
        },
        "summary": {
            "total_bookings": bookings_json.len(),
            "partial_complimentary": partial_count,
            "fully_complimentary": full_count,
            "total_complimentary_nights": total_complimentary_nights,
            "original_revenue": total_original_amount.to_string().parse::<f64>().unwrap_or(0.0),
            "actual_revenue": total_actual_amount.to_string().parse::<f64>().unwrap_or(0.0),
            "discount_given": discount_given.to_string().parse::<f64>().unwrap_or(0.0)
        },
        "by_reason": reasons_json,
        "bookings": bookings_json
    }))
}

// Guest Statistics Report - Guest demographics and patterns
async fn generate_guest_statistics_report(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Total unique guests in period
    let unique_guests: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT guest_id)::bigint FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    let unique_guests = unique_guests.unwrap_or(0);

    // New vs returning guests
    let new_guests: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT b.guest_id)::bigint
        FROM bookings b
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('voided')
        AND NOT EXISTS (
            SELECT 1 FROM bookings prev
            WHERE prev.guest_id = b.guest_id
            AND prev.check_in_date < $1
            AND prev.status NOT IN ('voided')
        )
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;
    let new_guests = new_guests.unwrap_or(0);

    let returning_guests = unique_guests - new_guests;

    // Tourist vs non-tourist (is_tourist is in bookings table)
    let tourist_stats: Vec<(Option<bool>, i64)> = sqlx::query_as(
        r#"
        SELECT b.is_tourist, COUNT(DISTINCT b.guest_id)::bigint
        FROM bookings b
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('voided')
        GROUP BY b.is_tourist
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut tourists = 0i64;
    let mut non_tourists = 0i64;
    for (is_tourist, count) in tourist_stats {
        if is_tourist.unwrap_or(false) {
            tourists = count;
        } else {
            non_tourists = count;
        }
    }

    // Average stay duration
    let avg_stay: Option<f64> = sqlx::query_scalar(
        r#"
        SELECT AVG(check_out_date - check_in_date)::float
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('voided')
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Nationality breakdown (if available)
    let by_nationality: Vec<(Option<String>, i64)> = sqlx::query_as(
        r#"
        SELECT g.nationality, COUNT(DISTINCT b.guest_id)
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('voided')
        AND g.nationality IS NOT NULL
        GROUP BY g.nationality
        ORDER BY COUNT(*) DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_nationality_json: Vec<serde_json::Value> = by_nationality
        .into_iter()
        .map(|(nationality, count)| {
            serde_json::json!({
                "nationality": nationality.unwrap_or_else(|| "Unknown".to_string()),
                "count": count
            })
        })
        .collect();

    // Top guests by bookings
    let top_guests = sqlx::query(
        r#"
        SELECT g.id, g.full_name, COUNT(*) AS booking_count, SUM(b.total_amount) AS total_spent
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('voided')
        GROUP BY g.id, g.full_name
        ORDER BY COUNT(*) DESC
        LIMIT 10
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let top_guests_json: Vec<serde_json::Value> = top_guests
        .iter()
        .map(|row| {
            let revenue = row_mappers::get_opt_decimal(row, "total_spent").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "id": row.get::<i64, _>("id"),
                "name": row.get::<String, _>("full_name"),
                "bookings": row_i64(row, "booking_count"),
                "total_spent": revenue.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    Ok(serde_json::json!({
        "period": {
            "start": start_date.to_string(),
            "end": end_date.to_string()
        },
        "summary": {
            "unique_guests": unique_guests,
            "new_guests": new_guests,
            "returning_guests": returning_guests,
            "tourists": tourists,
            "non_tourists": non_tourists,
            "average_stay_nights": avg_stay.unwrap_or(0.0)
        },
        "by_nationality": by_nationality_json,
        "top_guests": top_guests_json
    }))
}

// Room Performance Report - Room and room type analysis
async fn generate_room_performance_report(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Performance by room number
    let by_room = sqlx::query(
        r#"
        SELECT r.room_number, rt.name as room_type, COUNT(*) AS bookings, SUM(b.total_amount) AS revenue
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('voided')
        GROUP BY r.room_number, rt.name
        ORDER BY SUM(b.total_amount) DESC
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Performance by room type
    let by_type = sqlx::query(
        r#"
        SELECT rt.name AS room_type, COUNT(DISTINCT r.id) AS room_count,
               COUNT(b.id) AS bookings, SUM(b.total_amount) AS revenue
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN bookings b ON b.room_id = r.id
            AND b.check_in_date >= $1 AND b.check_in_date <= $2
            AND b.status NOT IN ('voided')
        WHERE r.is_active = true
        GROUP BY rt.name
        ORDER BY SUM(b.total_amount) DESC NULLS LAST
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Underperforming rooms (rooms with 0 or few bookings)
    let underperforming: Vec<(String, String, i64)> = sqlx::query_as(
        r#"
        SELECT r.room_number, rt.name, COUNT(b.id)
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN bookings b ON b.room_id = r.id
            AND b.check_in_date >= $1 AND b.check_in_date <= $2
            AND b.status NOT IN ('voided')
        WHERE r.is_active = true
        GROUP BY r.room_number, rt.name
        HAVING COUNT(b.id) < 2
        ORDER BY COUNT(b.id) ASC, r.room_number
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_room_json: Vec<serde_json::Value> = by_room
        .iter()
        .map(|row| {
            let revenue = row_mappers::get_opt_decimal(row, "revenue").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "room_number": row.get::<String, _>("room_number"),
                "room_type": row.get::<String, _>("room_type"),
                "bookings": row_i64(row, "bookings"),
                "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let by_type_json: Vec<serde_json::Value> = by_type
        .iter()
        .map(|row| {
            let revenue = row_mappers::get_opt_decimal(row, "revenue").unwrap_or(Decimal::ZERO);
            serde_json::json!({
                "room_type": row.get::<String, _>("room_type"),
                "room_count": row_i64(row, "room_count"),
                "bookings": row_i64(row, "bookings"),
                "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let underperforming_json: Vec<serde_json::Value> = underperforming
        .into_iter()
        .map(|(room_number, room_type, bookings)| {
            serde_json::json!({
                "room_number": room_number,
                "room_type": room_type,
                "bookings": bookings
            })
        })
        .collect();

    Ok(serde_json::json!({
        "period": {
            "start": start_date.to_string(),
            "end": end_date.to_string()
        },
        "by_room": by_room_json,
        "by_type": by_type_json,
        "underperforming": underperforming_json
    }))
}

// Company Ledger Statement Report - Per-company account statement
async fn generate_company_ledger_statement(
    pool: &DbPool,
    _start_date: NaiveDate,
    end_date: NaiveDate,
    company_name: Option<&str>,
) -> Result<serde_json::Value, ApiError> {
    // If no company specified, return list of companies with ledgers
    if company_name.is_none() {
        let companies = sqlx::query(
            r#"
            SELECT company_name, COUNT(*) as entry_count, COALESCE(SUM(balance_due), 0) as total_balance
            FROM customer_ledgers
            WHERE status NOT IN ('voided')
            GROUP BY company_name
            ORDER BY company_name
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        let company_list: Vec<serde_json::Value> = companies
            .iter()
            .map(|row| {
                serde_json::json!({
                    "company_name": row.get::<String, _>("company_name"),
                    "entry_count": row_i64(row, "entry_count"),
                    "total_balance": row_mappers::get_decimal(row, "total_balance")
                })
            })
            .collect();

        return Ok(serde_json::json!({
            "type": "company_list",
            "companies": company_list
        }));
    }

    let company =
        company_name.ok_or_else(|| ApiError::BadRequest("Company name is required".to_string()))?;

    // Get company details from the most recent ledger entry
    #[allow(clippy::type_complexity)]
    let company_info: Option<(
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        r#"
        SELECT
            company_name, company_registration_number, contact_person, contact_email, contact_phone,
            billing_address_line1, billing_city, billing_state, billing_postal_code, billing_country
        FROM customer_ledgers
        WHERE company_name = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(company)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (
        comp_name,
        reg_number,
        contact_person,
        contact_email,
        contact_phone,
        address_line1,
        city,
        state,
        postal_code,
        country,
    ) = company_info.ok_or_else(|| {
        ApiError::NotFound(format!("No ledger entries found for company: {}", company))
    })?;

    // Get all ledger entries for this company
    let ledger_entries = sqlx::query(
        r#"
        SELECT
            id, description, expense_type, amount, paid_amount, balance_due, status,
            invoice_number, invoice_date, due_date, created_at
        FROM customer_ledgers
        WHERE company_name = $1 AND status NOT IN ('voided')
        ORDER BY created_at DESC
        "#,
    )
    .bind(company)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Calculate aging buckets based on invoice_date or created_at
    let today = Local::now().date_naive();
    let mut open_balance = Decimal::ZERO;
    let mut days_31_60 = Decimal::ZERO;
    let mut days_61_90 = Decimal::ZERO;
    let mut days_91_120 = Decimal::ZERO;
    let mut over_120_days = Decimal::ZERO;

    let mut transactions: Vec<serde_json::Value> = Vec::new();
    let mut total_original = Decimal::ZERO;
    let mut total_payments = Decimal::ZERO;
    let mut total_open = Decimal::ZERO;

    for entry in &ledger_entries {
        let id: i64 = entry.get("id");
        let description: String = entry.get("description");
        let expense_type: String = entry.get("expense_type");
        let amount = row_mappers::get_decimal(entry, "amount");
        let paid_amount = row_mappers::get_decimal(entry, "paid_amount");
        let balance_due = row_mappers::get_decimal(entry, "balance_due");
        let status: String = entry.get("status");
        let invoice_number: Option<String> = entry.try_get("invoice_number").ok();
        let invoice_date: Option<NaiveDate> = entry.try_get("invoice_date").ok();
        let due_date: Option<NaiveDate> = entry.try_get("due_date").ok();
        let created_at: chrono::NaiveDateTime = entry.get("created_at");

        // Calculate days old
        let entry_date = invoice_date.unwrap_or(created_at.date());
        let days_old = (today - entry_date).num_days();

        // Categorize into aging buckets
        if balance_due > Decimal::ZERO {
            if days_old <= 30 {
                open_balance += balance_due;
            } else if days_old <= 60 {
                days_31_60 += balance_due;
            } else if days_old <= 90 {
                days_61_90 += balance_due;
            } else if days_old <= 120 {
                days_91_120 += balance_due;
            } else {
                over_120_days += balance_due;
            }
        }

        total_original += amount;
        total_payments += paid_amount;
        total_open += balance_due;

        transactions.push(serde_json::json!({
            "id": id,
            "invoice_date": invoice_date.map(|d| d.format("%d/%m/%y").to_string()),
            "voucher": description,
            "invoice": invoice_number,
            "reference": expense_type,
            "original_amount": amount,
            "payments_received": paid_amount,
            "finance_charges": 0,
            "open_amount": balance_due,
            "status": status,
            "due_date": due_date.map(|d| d.format("%d/%m/%y").to_string()),
            "days_old": days_old
        }));
    }

    // Get last payment info
    let last_payment = sqlx::query(
        r#"
        SELECT payment_amount, clp.created_at
        FROM customer_ledger_payments clp
        INNER JOIN customer_ledgers cl ON clp.ledger_id = cl.id
        WHERE cl.company_name = $1
        ORDER BY clp.created_at DESC
        LIMIT 1
        "#,
    )
    .bind(company)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (last_payment_amount, last_payment_date) = last_payment
        .as_ref()
        .map(|row| {
            let amount = row_mappers::get_decimal(row, "payment_amount");
            let date: chrono::NaiveDateTime = row.get("created_at");
            (amount, Some(date.format("%d/%m/%Y").to_string()))
        })
        .unwrap_or((Decimal::ZERO, None));

    Ok(serde_json::json!({
        "type": "company_statement",
        "company": {
            "name": comp_name,
            "registration_number": reg_number,
            "contact_person": contact_person,
            "contact_email": contact_email,
            "contact_phone": contact_phone,
            "address": {
                "line1": address_line1,
                "city": city,
                "state": state,
                "postal_code": postal_code,
                "country": country
            }
        },
        "statement_date": end_date.format("%d/%m/%Y").to_string(),
        "balance_due": total_open,
        "last_payment": {
            "amount": last_payment_amount,
            "date": last_payment_date
        },
        "existing_credit": 0,
        "aging": {
            "open_balance": open_balance,
            "days_31_60": days_31_60,
            "days_61_90": days_61_90,
            "days_91_120": days_91_120,
            "over_120_days": over_120_days
        },
        "transactions": transactions,
        "totals": {
            "original_amount": total_original,
            "payments_received": total_payments,
            "open_amount": total_open
        }
    }))
}
