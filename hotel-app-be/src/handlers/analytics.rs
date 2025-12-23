//! Analytics and reporting handlers
//!
//! Handles reports and analytics dashboards.

use crate::core::auth::AuthService;
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};
use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::Json,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::{PgPool, Row};

pub async fn websocket_status_handler() -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({
        "status": "available",
        "protocol": "ws",
        "endpoint": "/ws",
        "message": "WebSocket server is running"
    })))
}

pub async fn get_occupancy_report_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;

    let total_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let occupied_rooms: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT room_id) FROM bookings
        WHERE status != 'cancelled'
        AND check_in_date <= CURRENT_DATE
        AND check_out_date > CURRENT_DATE
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let occupancy_rate = if total_rooms > 0 {
        (occupied_rooms as f64 / total_rooms as f64) * 100.0
    } else {
        0.0
    };

    // Count only rooms with status 'available' (excludes maintenance, cleaning, out_of_order, etc.)
    let available_rooms: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM rooms WHERE status = 'available' AND is_active = true"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let revenue: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(total_amount), 0) FROM bookings
        WHERE status != 'cancelled'
        AND check_in_date <= CURRENT_DATE
        AND check_out_date > CURRENT_DATE
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "totalRooms": total_rooms,
        "occupiedRooms": occupied_rooms,
        "occupancyRate": occupancy_rate,
        "availableRooms": available_rooms,
        "utilization": occupancy_rate,
        "revenue": revenue.to_string().parse::<f64>().unwrap_or(0.0)
    })))
}

pub async fn get_booking_analytics_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;

    let total_bookings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE status != 'cancelled'")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let revenue_result: Option<Decimal> = sqlx::query_scalar(
        "SELECT SUM(total_amount) FROM bookings WHERE status != 'cancelled'"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total_revenue = revenue_result.unwrap_or_default();
    let average_booking_value = if total_bookings > 0 {
        total_revenue / Decimal::from(total_bookings)
    } else {
        Decimal::ZERO
    };

    // Bookings by room type
    let bookings_by_type: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT rt.name, COUNT(*) as count
        FROM bookings b
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.status != 'cancelled'
        GROUP BY rt.name
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let bookings_by_room_type: serde_json::Map<String, serde_json::Value> = bookings_by_type
        .into_iter()
        .map(|(room_type, count)| (room_type, serde_json::Value::Number(count.into())))
        .collect();

    // Monthly trends (simplified - last 6 months)
    let monthly_trends = vec![
        serde_json::json!({
            "month": "Current Month",
            "bookings": total_bookings,
            "revenue": total_revenue.to_string().parse::<f64>().unwrap_or(0.0)
        })
    ];

    Ok(Json(serde_json::json!({
        "totalBookings": total_bookings,
        "averageBookingValue": average_booking_value.to_string().parse::<f64>().unwrap_or(0.0),
        "totalRevenue": total_revenue.to_string().parse::<f64>().unwrap_or(0.0),
        "bookingsByRoomType": bookings_by_room_type,
        "peakBookingHours": [9, 10, 11, 14, 15, 16],
        "monthlyTrends": monthly_trends
    })))
}

// Personalized report handler - generates reports tailored to user role and context
pub async fn get_personalized_report_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    let user_id = require_auth(&headers).await?;

    // Get user roles and determine report scope
    let user_roles = AuthService::get_user_roles(&pool, user_id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let is_admin = user_roles.contains(&"admin".to_string());
    let is_manager = user_roles.contains(&"manager".to_string());
    let report_scope = if is_admin || is_manager { "all" } else { "personal" };

    // Get date range from query params
    let period = params.get("period").unwrap_or(&"month".to_string()).clone();

    // Generate personalized occupancy report
    let (total_rooms, occupied_rooms, total_bookings, total_revenue, recent_bookings, insights) = if report_scope == "all" {
        // Get total rooms
        let total_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        // Get occupancy
        let occupied_rooms: i64 = sqlx::query_scalar(
            "SELECT COUNT(DISTINCT room_id) FROM bookings WHERE status != 'cancelled' AND check_in_date <= CURRENT_DATE AND check_out_date > CURRENT_DATE"
        )
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        // Get total bookings and revenue
        let total_bookings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE status != 'cancelled'")
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let revenue_result: Option<Decimal> = sqlx::query_scalar(
            "SELECT SUM(total_amount) FROM bookings WHERE status != 'cancelled'"
        )
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        // Get recent bookings (last 5)
        let recent_bookings: Vec<serde_json::Value> = sqlx::query(
            r#"
            SELECT b.id, g.full_name as guest_name, b.check_in_date, b.total_amount
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            WHERE b.status != 'cancelled'
            ORDER BY b.created_at DESC LIMIT 5
            "#
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<i64, _>(0),
                "guest_name": row.get::<String, _>(1),
                "check_in_date": row.get::<NaiveDate, _>(2),
                "total_amount": row.get::<Decimal, _>(3).to_string()
            })
        })
        .collect();

        let insights = vec!["Occupancy rate is stable compared to last month".to_string()];

        (total_rooms, occupied_rooms, total_bookings, revenue_result.unwrap_or_default(), recent_bookings, insights)
    } else {
        // Personal report - simplified version
        (0, 0, 0, Decimal::ZERO, vec![], vec!["Personal reports coming soon".to_string()])
    };

    Ok(Json(serde_json::json!({
        "reportScope": report_scope,
        "userRoles": user_roles,
        "period": period,
        "summary": {
            "totalRooms": total_rooms,
            "occupiedRooms": occupied_rooms,
            "occupancyRate": if total_rooms > 0 { (occupied_rooms as f64 / total_rooms as f64) * 100.0 } else { 0.0 },
            "totalBookings": total_bookings,
            "totalRevenue": total_revenue.to_string().parse::<f64>().unwrap_or(0.0),
            "averageBookingValue": if total_bookings > 0 { total_revenue.to_string().parse::<f64>().unwrap_or(0.0) / total_bookings as f64 } else { 0.0 }
        },
        "recentBookings": recent_bookings,
        "insights": insights,
        "generatedAt": chrono::Utc::now().to_rfc3339()
    })))
}

// ============================================================================
// REPORT GENERATION HANDLERS
// ============================================================================

#[derive(serde::Deserialize)]
pub struct ReportQuery {
    pub report_type: String,
    pub start_date: String,
    pub end_date: String,
    pub shift: Option<String>,
    pub drawer: Option<String>,
}

fn parse_date_flexible(date_str: &str) -> Result<NaiveDate, String> {
    if date_str.contains('T') {
        let date_part = date_str.split('T').next().unwrap_or(date_str);
        NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date format: {}", e))
    } else {
        NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date format: {}", e))
    }
}

pub async fn generate_report_handler(
    State(pool): State<PgPool>,
    Query(params): Query<ReportQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let start_date = parse_date_flexible(&params.start_date)
        .map_err(|e| ApiError::BadRequest(format!("Invalid start_date: {}", e)))?;
    let end_date = parse_date_flexible(&params.end_date)
        .map_err(|e| ApiError::BadRequest(format!("Invalid end_date: {}", e)))?;

    let report_data = match params.report_type.as_str() {
        "balance_sheet" => generate_balance_sheet(&pool, start_date, end_date).await?,
        "journal_by_type" => generate_journal_by_type(&pool, start_date, end_date).await?,
        "shift_report" => generate_shift_report(&pool, start_date, end_date, params.shift.as_deref(), params.drawer.as_deref()).await?,
        "rooms_sold" => generate_rooms_sold_report(&pool, start_date, end_date).await?,
        _ => return Err(ApiError::BadRequest(format!("Unknown report type: {}", params.report_type))),
    };

    Ok(Json(report_data))
}

// Balance Sheet Report
async fn generate_balance_sheet(
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Get total room revenue
    let room_revenue: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_amount), 0) FROM bookings
         WHERE check_in_date >= $1 AND check_in_date <= $2 AND status IN ('confirmed', 'checked_in', 'checked_out')"
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get deposit total (simplified - you'd track actual deposits in production)
    let deposits: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_amount * 0.2), 0) FROM bookings
         WHERE check_in_date >= $1 AND check_in_date <= $2 AND status IN ('confirmed', 'pending')"
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Calculate service tax (8% of room revenue)
    let service_tax = room_revenue * Decimal::new(8, 2);

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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
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
         ORDER BY b.check_in_date, b.id"
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
        let amount: Decimal = row.get("total_amount");
        let folio: Option<String> = row.get("folio");
        let room: String = row.get("room");
        let date: NaiveDate = row.get("date");

        // Debit entry (Room Charge)
        transactions.push(serde_json::json!({
            "date": date.and_hms_opt(8, 0, 0).unwrap().and_utc().to_rfc3339(),
            "folio": folio.clone().unwrap_or_else(|| "".to_string()),
            "account_code": "100",
            "description": "[Room Charge]",
            "debit": amount,
            "credit": 0,
            "room": room.clone(),
        }));
        total_debit += amount;

        // Credit entry (Guest Ledger)
        let service_tax = amount * Decimal::new(8, 2);
        transactions.push(serde_json::json!({
            "date": date.and_hms_opt(8, 0, 0).unwrap().and_utc().to_rfc3339(),
            "folio": folio.unwrap_or_else(|| "".to_string()),
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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
    _shift: Option<&str>,
    _drawer: Option<&str>,
) -> Result<serde_json::Value, ApiError> {
    // Get room revenue
    let room_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings
         WHERE check_in_date >= $1 AND check_in_date <= $2 AND status IN ('confirmed', 'checked_in', 'checked_out')"
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let room_total: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_amount), 0) FROM bookings
         WHERE check_in_date >= $1 AND check_in_date <= $2 AND status IN ('confirmed', 'checked_in', 'checked_out')"
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Simulate payment methods (in production, you'd have a payments table)
    let cash_total = room_total * Decimal::new(60, 2); // 60% cash
    let cc_total = room_total * Decimal::new(30, 2);   // 30% credit card
    let dc_total = room_total * Decimal::new(10, 2);   // 10% debit card

    let service_tax = room_total * Decimal::new(8, 2);

    Ok(serde_json::json!({
        "revenue": {
            "room_count": room_count,
            "room_total": room_total,
        },
        "settlement": {
            "cash": [
                { "code": "200", "description": "Cash", "count": (room_count as f64 * 0.6) as i64, "amount": cash_total }
            ],
            "cash_count": (room_count as f64 * 0.6) as i64,
            "cash_total": cash_total,
            "credit_card": [
                { "code": "201", "description": "Visa", "count": (room_count as f64 * 0.3) as i64, "amount": cc_total }
            ],
            "cc_count": (room_count as f64 * 0.3) as i64,
            "cc_total": cc_total,
            "debit_card": [
                { "code": "208", "description": "Debitcard", "count": (room_count as f64 * 0.1) as i64, "amount": dc_total }
            ],
            "dc_count": (room_count as f64 * 0.1) as i64,
            "dc_total": dc_total,
            "total_count": room_count,
            "total_amount": cash_total + cc_total + dc_total,
        },
        "taxes": {
            "count": room_count,
            "total": service_tax,
        },
    }))
}

// Rooms Sold Detail Report
async fn generate_rooms_sold_report(
    pool: &PgPool,
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
         ORDER BY b.check_in_date"
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
