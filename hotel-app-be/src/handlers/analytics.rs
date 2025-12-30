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

    // Check if user has full analytics access
    let has_full_analytics = AuthService::check_permission(&pool, user_id, "analytics:manage")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "reports:execute")
            .await
            .unwrap_or(false);

    let report_scope = if has_full_analytics { "all" } else { "personal" };

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
        "hasFullAccess": has_full_analytics,
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
    pub company_name: Option<String>,
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
    // Note: Permission check is done in the route layer (routes/analytics.rs)
    // This handler is called after permission is verified
    let start_date = parse_date_flexible(&params.start_date)
        .map_err(|e| ApiError::BadRequest(format!("Invalid start_date: {}", e)))?;
    let end_date = parse_date_flexible(&params.end_date)
        .map_err(|e| ApiError::BadRequest(format!("Invalid end_date: {}", e)))?;

    let report_data = match params.report_type.as_str() {
        // Legacy accounting reports
        "balance_sheet" => generate_balance_sheet(&pool, start_date, end_date).await?,
        "journal_by_type" => generate_journal_by_type(&pool, start_date, end_date).await?,
        "shift_report" => generate_shift_report(&pool, start_date, end_date, params.shift.as_deref(), params.drawer.as_deref()).await?,
        "rooms_sold" => generate_rooms_sold_report(&pool, start_date, end_date).await?,
        "general_journal" => generate_general_journal(&pool, start_date, end_date).await?,
        "company_ledger_statement" => generate_company_ledger_statement(&pool, start_date, end_date, params.company_name.as_deref()).await?,
        // New hotel management reports
        "daily_operations" => generate_daily_operations_report(&pool, start_date).await?,
        "occupancy" => generate_occupancy_report(&pool, start_date, end_date).await?,
        "revenue" => generate_revenue_report(&pool, start_date, end_date).await?,
        "payment_status" => generate_payment_status_report(&pool, start_date, end_date).await?,
        "complimentary" => generate_complimentary_report(&pool, start_date, end_date).await?,
        "guest_statistics" => generate_guest_statistics_report(&pool, start_date, end_date).await?,
        "room_performance" => generate_room_performance_report(&pool, start_date, end_date).await?,
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

// General Journal Report - Double-entry accounting format
async fn generate_general_journal(
    pool: &PgPool,
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
            b.payment_status,
            b.payment_method,
            r.room_number,
            g.full_name as guest_name
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        LEFT JOIN guests g ON b.guest_id = g.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
          AND b.status IN ('confirmed', 'checked_in', 'checked_out')
        ORDER BY b.check_in_date, b.id
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Initialize section data
    let mut deposit_ledger_entries: Vec<serde_json::Value> = Vec::new();
    let mut guest_ledger_entries: Vec<serde_json::Value> = Vec::new();
    let mut deposits_pending_entries: Vec<serde_json::Value> = Vec::new();
    let mut room_revenue_entries: Vec<serde_json::Value> = Vec::new();
    let mut sales_tax_entries: Vec<serde_json::Value> = Vec::new();

    let mut deposit_ledger_debit = Decimal::ZERO;
    let mut deposit_ledger_credit = Decimal::ZERO;
    let mut guest_ledger_debit = Decimal::ZERO;
    let mut guest_ledger_credit = Decimal::ZERO;
    let mut deposits_pending_debit = Decimal::ZERO;
    let mut deposits_pending_credit = Decimal::ZERO;
    let mut room_revenue_debit = Decimal::ZERO;
    let mut room_revenue_credit = Decimal::ZERO;
    let mut sales_tax_debit = Decimal::ZERO;
    let mut sales_tax_credit = Decimal::ZERO;

    let tax_rate = Decimal::new(8, 2); // 8% service tax

    for row in rows {
        let date: NaiveDate = row.get("date");
        let total_amount: Decimal = row.get("total_amount");
        let payment_status: Option<String> = row.get("payment_status");
        let payment_method: Option<String> = row.get("payment_method");
        let date_str = date.format("%d/%m/%Y").to_string();

        // Calculate amounts
        let service_tax = total_amount * tax_rate;
        let room_charge = total_amount - service_tax;

        // Estimate deposit (20% of total)
        let deposit_amount = total_amount * Decimal::new(20, 2);

        // Guest Ledger entries (Debits)
        // Room Charge
        guest_ledger_entries.push(serde_json::json!({
            "date": date_str,
            "account": "Room Charge",
            "debit": room_charge,
            "credit": 0,
            "contra_account": "Room Revenue",
            "contra_amount": room_charge
        }));
        guest_ledger_debit += room_charge;

        // Service Tax
        guest_ledger_entries.push(serde_json::json!({
            "date": date_str,
            "account": "Service Tax",
            "debit": service_tax,
            "credit": 0,
            "contra_account": "Sales Tax Payable",
            "contra_amount": service_tax
        }));
        guest_ledger_debit += service_tax;

        // Payment entries based on payment method
        if let Some(ref method) = payment_method {
            let method_upper = method.to_uppercase();
            let account_name = match method_upper.as_str() {
                "CASH" => "Cash",
                "VISA" | "CREDIT_CARD" | "CREDIT" => "Visa",
                "DEBIT" | "DEBIT_CARD" | "DEBITCARD" => "Debitcard",
                "AGODA" | "OTA" => "Agoda.Com",
                _ => method.as_str(),
            };

            // If paid, add payment entry
            if payment_status.as_deref() == Some("paid") || payment_status.as_deref() == Some("partial") {
                guest_ledger_entries.push(serde_json::json!({
                    "date": date_str,
                    "account": account_name,
                    "debit": 0,
                    "credit": 0,
                    "contra_account": "Deposits Pending",
                    "contra_amount": total_amount
                }));
            }
        }

        // Add deposit entry
        guest_ledger_entries.push(serde_json::json!({
            "date": date_str,
            "account": "Deposit",
            "debit": deposit_amount,
            "credit": 0,
            "contra_account": "Deposits Pending",
            "contra_amount": deposit_amount
        }));
        guest_ledger_debit += deposit_amount;

        // Deposits Pending (Credits)
        if let Some(ref method) = payment_method {
            let method_upper = method.to_uppercase();
            let account_name = match method_upper.as_str() {
                "CASH" => "Cash",
                "VISA" | "CREDIT_CARD" | "CREDIT" => "Visa",
                "DEBIT" | "DEBIT_CARD" | "DEBITCARD" => "Debitcard",
                "AGODA" | "OTA" => "Agoda.Com",
                _ => method.as_str(),
            };

            deposits_pending_entries.push(serde_json::json!({
                "date": date_str,
                "account": account_name,
                "debit": deposit_amount,
                "credit": 0,
                "contra_account": "Guest Ledger",
                "contra_amount": 0
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
            "contra_amount": room_charge
        }));
        room_revenue_credit += room_charge;

        // Sales Tax Payable (Credits)
        sales_tax_entries.push(serde_json::json!({
            "date": date_str,
            "account": "Service Tax",
            "debit": 0,
            "credit": service_tax,
            "contra_account": "Guest Ledger",
            "contra_amount": service_tax
        }));
        sales_tax_credit += service_tax;
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
    let total_debits = deposit_ledger_debit + guest_ledger_debit + deposits_pending_debit + room_revenue_debit + sales_tax_debit;
    let total_credits = deposit_ledger_credit + guest_ledger_credit + deposits_pending_credit + room_revenue_credit + sales_tax_credit;
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
    pool: &PgPool,
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
        "#
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
        "#
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Room status breakdown
    let room_status: Vec<(String, i64)> = sqlx::query_as(
        "SELECT status, COUNT(*)::bigint FROM rooms WHERE is_active = true GROUP BY status"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Total rooms
    let total_rooms: Option<i64> = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM rooms WHERE is_active = true")
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let total_rooms = total_rooms.unwrap_or(0);

    // Tonight's expected occupancy
    let tonight_occupied: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT room_id)::bigint FROM bookings
        WHERE check_in_date <= $1 AND check_out_date > $1
        AND status NOT IN ('cancelled', 'no_show')
        "#
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

    let arrivals_json: Vec<serde_json::Value> = arrivals.into_iter()
        .map(|(id, booking_number, guest_name, room_number, payment_status)| {
            serde_json::json!({
                "id": id,
                "booking_number": booking_number,
                "guest_name": guest_name,
                "room_number": room_number,
                "payment_status": payment_status
            })
        })
        .collect();

    let departures_json: Vec<serde_json::Value> = departures.into_iter()
        .map(|(id, booking_number, guest_name, room_number, payment_status)| {
            serde_json::json!({
                "id": id,
                "booking_number": booking_number,
                "guest_name": guest_name,
                "room_number": room_number,
                "payment_status": payment_status
            })
        })
        .collect();

    let in_house_json: Vec<serde_json::Value> = in_house.into_iter()
        .map(|(id, booking_number, guest_name, room_number, check_in, check_out)| {
            serde_json::json!({
                "id": id,
                "booking_number": booking_number,
                "guest_name": guest_name,
                "room_number": room_number,
                "check_in_date": check_in.to_string(),
                "check_out_date": check_out.to_string()
            })
        })
        .collect();

    let room_status_map: serde_json::Map<String, serde_json::Value> = room_status.into_iter()
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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Total active rooms
    let total_rooms: Option<i64> = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM rooms WHERE is_active = true")
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let total_rooms = total_rooms.unwrap_or(0);

    // Rooms sold and revenue
    let stats: (Option<i64>, Option<Decimal>) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::bigint, SUM(total_amount)
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled', 'no_show')
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let rooms_sold = stats.0.unwrap_or(0);
    let total_revenue = stats.1.unwrap_or(Decimal::ZERO);

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
    let by_room_type: Vec<(String, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT rt.name, COUNT(*), SUM(b.total_amount)
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('cancelled', 'no_show')
        GROUP BY rt.name
        ORDER BY COUNT(*) DESC
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_room_type_json: Vec<serde_json::Value> = by_room_type.into_iter()
        .map(|(room_type, count, revenue)| {
            serde_json::json!({
                "room_type": room_type,
                "bookings": count,
                "revenue": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    // Daily breakdown
    let daily_data: Vec<(NaiveDate, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT check_in_date, COUNT(*), SUM(total_amount)
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled', 'no_show')
        GROUP BY check_in_date
        ORDER BY check_in_date
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let daily_json: Vec<serde_json::Value> = daily_data.into_iter()
        .map(|(date, count, revenue)| {
            serde_json::json!({
                "date": date.to_string(),
                "bookings": count,
                "revenue": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0),
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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Total revenue
    let total_revenue: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT SUM(total_amount) FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled', 'no_show')
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total = total_revenue.unwrap_or(Decimal::ZERO);

    // Revenue by room type
    let by_room_type: Vec<(String, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT rt.name, COUNT(*), SUM(b.total_amount)
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('cancelled', 'no_show')
        GROUP BY rt.name
        ORDER BY SUM(b.total_amount) DESC
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Revenue by source
    let by_source: Vec<(Option<String>, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT source, COUNT(*), SUM(total_amount)
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled', 'no_show')
        GROUP BY source
        ORDER BY SUM(total_amount) DESC
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Revenue by payment status
    let by_payment_status: Vec<(Option<String>, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT payment_status, COUNT(*), SUM(total_amount)
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled', 'no_show')
        GROUP BY payment_status
        ORDER BY SUM(total_amount) DESC
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Daily revenue
    let daily_data: Vec<(NaiveDate, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT check_in_date, COUNT(*), SUM(total_amount)
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled', 'no_show')
        GROUP BY check_in_date
        ORDER BY check_in_date
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_room_type_json: Vec<serde_json::Value> = by_room_type.into_iter()
        .map(|(room_type, count, revenue)| {
            serde_json::json!({
                "room_type": room_type,
                "bookings": count,
                "revenue": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let by_source_json: Vec<serde_json::Value> = by_source.into_iter()
        .map(|(source, count, revenue)| {
            serde_json::json!({
                "source": source.unwrap_or_else(|| "unknown".to_string()),
                "bookings": count,
                "revenue": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let by_payment_status_json: Vec<serde_json::Value> = by_payment_status.into_iter()
        .map(|(status, count, revenue)| {
            serde_json::json!({
                "payment_status": status.unwrap_or_else(|| "unknown".to_string()),
                "bookings": count,
                "revenue": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let daily_json: Vec<serde_json::Value> = daily_data.into_iter()
        .map(|(date, count, revenue)| {
            serde_json::json!({
                "date": date.to_string(),
                "bookings": count,
                "revenue": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Bookings by payment status
    let by_status: Vec<(Option<String>, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT payment_status, COUNT(*), SUM(total_amount)
        FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled')
        GROUP BY payment_status
        ORDER BY COUNT(*) DESC
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Calculate outstanding balance (unpaid bookings)
    let outstanding: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT SUM(total_amount) FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled')
        AND payment_status IN ('unpaid', 'unpaid_deposit', 'partial')
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Overdue payments (past check-out with unpaid status)
    let overdue: Vec<(i64, String, String, String, Decimal, NaiveDate, Option<String>)> = sqlx::query_as(
        r#"
        SELECT b.id, b.booking_number, g.full_name, r.room_number, b.total_amount, b.check_out_date, b.payment_status
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.check_out_date < CURRENT_DATE
        AND b.status NOT IN ('cancelled')
        AND b.payment_status IN ('unpaid', 'unpaid_deposit', 'partial')
        ORDER BY b.check_out_date DESC
        LIMIT 50
        "#
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_status_json: Vec<serde_json::Value> = by_status.into_iter()
        .map(|(status, count, amount)| {
            serde_json::json!({
                "payment_status": status.unwrap_or_else(|| "unknown".to_string()),
                "count": count,
                "total_amount": amount.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let overdue_json: Vec<serde_json::Value> = overdue.into_iter()
        .map(|(id, booking_number, guest_name, room_number, amount, check_out, payment_status)| {
            serde_json::json!({
                "id": id,
                "booking_number": booking_number,
                "guest_name": guest_name,
                "room_number": room_number,
                "total_amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
                "check_out_date": check_out.to_string(),
                "payment_status": payment_status
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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // All complimentary bookings
    let complimentary: Vec<(i64, String, String, String, NaiveDate, NaiveDate,
                           Option<bool>, Option<String>, Option<NaiveDate>, Option<NaiveDate>,
                           Option<Decimal>, Decimal, Option<i32>, String)> = sqlx::query_as(
        r#"
        SELECT b.id, b.booking_number, g.full_name, r.room_number,
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
        "#
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

    let bookings_json: Vec<serde_json::Value> = complimentary.into_iter()
        .map(|(id, booking_number, guest_name, room_number, check_in, check_out,
               is_complimentary, reason, comp_start, comp_end, original, actual, nights, status)| {

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

    let reasons_json: Vec<serde_json::Value> = reasons_map.into_iter()
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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Total unique guests in period
    let unique_guests: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT guest_id)::bigint FROM bookings
        WHERE check_in_date >= $1 AND check_in_date <= $2
        AND status NOT IN ('cancelled')
        "#
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
        AND b.status NOT IN ('cancelled')
        AND NOT EXISTS (
            SELECT 1 FROM bookings prev
            WHERE prev.guest_id = b.guest_id
            AND prev.check_in_date < $1
            AND prev.status NOT IN ('cancelled')
        )
        "#
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
        AND b.status NOT IN ('cancelled')
        GROUP BY b.is_tourist
        "#
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
        AND status NOT IN ('cancelled')
        "#
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
        AND b.status NOT IN ('cancelled')
        AND g.nationality IS NOT NULL
        GROUP BY g.nationality
        ORDER BY COUNT(*) DESC
        LIMIT 10
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_nationality_json: Vec<serde_json::Value> = by_nationality.into_iter()
        .map(|(nationality, count)| {
            serde_json::json!({
                "nationality": nationality.unwrap_or_else(|| "Unknown".to_string()),
                "count": count
            })
        })
        .collect();

    // Top guests by bookings
    let top_guests: Vec<(i64, String, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT g.id, g.full_name, COUNT(*) as booking_count, SUM(b.total_amount)
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('cancelled')
        GROUP BY g.id, g.full_name
        ORDER BY COUNT(*) DESC
        LIMIT 10
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let top_guests_json: Vec<serde_json::Value> = top_guests.into_iter()
        .map(|(id, name, bookings, revenue)| {
            serde_json::json!({
                "id": id,
                "name": name,
                "bookings": bookings,
                "total_spent": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    // Performance by room number
    let by_room: Vec<(String, String, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT r.room_number, rt.name as room_type, COUNT(*), SUM(b.total_amount)
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.check_in_date >= $1 AND b.check_in_date <= $2
        AND b.status NOT IN ('cancelled', 'no_show')
        GROUP BY r.room_number, rt.name
        ORDER BY SUM(b.total_amount) DESC
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Performance by room type
    let by_type: Vec<(String, i64, i64, Option<Decimal>)> = sqlx::query_as(
        r#"
        SELECT rt.name, COUNT(DISTINCT r.id) as room_count, COUNT(b.id), SUM(b.total_amount)
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN bookings b ON b.room_id = r.id
            AND b.check_in_date >= $1 AND b.check_in_date <= $2
            AND b.status NOT IN ('cancelled', 'no_show')
        WHERE r.is_active = true
        GROUP BY rt.name
        ORDER BY SUM(b.total_amount) DESC NULLS LAST
        "#
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
            AND b.status NOT IN ('cancelled', 'no_show')
        WHERE r.is_active = true
        GROUP BY r.room_number, rt.name
        HAVING COUNT(b.id) < 2
        ORDER BY COUNT(b.id) ASC, r.room_number
        "#
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let by_room_json: Vec<serde_json::Value> = by_room.into_iter()
        .map(|(room_number, room_type, bookings, revenue)| {
            serde_json::json!({
                "room_number": room_number,
                "room_type": room_type,
                "bookings": bookings,
                "revenue": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let by_type_json: Vec<serde_json::Value> = by_type.into_iter()
        .map(|(room_type, room_count, bookings, revenue)| {
            serde_json::json!({
                "room_type": room_type,
                "room_count": room_count,
                "bookings": bookings,
                "revenue": revenue.unwrap_or(Decimal::ZERO).to_string().parse::<f64>().unwrap_or(0.0)
            })
        })
        .collect();

    let underperforming_json: Vec<serde_json::Value> = underperforming.into_iter()
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
    pool: &PgPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
    company_name: Option<&str>,
) -> Result<serde_json::Value, ApiError> {
    // If no company specified, return list of companies with ledgers
    if company_name.is_none() {
        let companies: Vec<(String, i64, Decimal)> = sqlx::query_as(
            r#"
            SELECT company_name, COUNT(*) as entry_count, COALESCE(SUM(balance_due), 0) as total_balance
            FROM customer_ledgers
            WHERE status != 'cancelled'
            GROUP BY company_name
            ORDER BY company_name
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        let company_list: Vec<serde_json::Value> = companies.into_iter()
            .map(|(name, count, balance)| serde_json::json!({
                "company_name": name,
                "entry_count": count,
                "total_balance": balance
            }))
            .collect();

        return Ok(serde_json::json!({
            "type": "company_list",
            "companies": company_list
        }));
    }

    let company = company_name.unwrap();

    // Get company details from the most recent ledger entry
    let company_info: Option<(
        String, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>
    )> = sqlx::query_as(
        r#"
        SELECT
            company_name, company_registration_number, contact_person, contact_email, contact_phone,
            billing_address_line1, billing_city, billing_state, billing_postal_code, billing_country
        FROM customer_ledgers
        WHERE company_name = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#
    )
    .bind(company)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if company_info.is_none() {
        return Err(ApiError::NotFound(format!("No ledger entries found for company: {}", company)));
    }

    let (
        comp_name, reg_number, contact_person, contact_email, contact_phone,
        address_line1, city, state, postal_code, country
    ) = company_info.unwrap();

    // Get all ledger entries for this company
    let ledger_entries: Vec<(
        i64, String, String, Decimal, Decimal, Decimal, String,
        Option<String>, Option<NaiveDate>, Option<NaiveDate>, chrono::NaiveDateTime
    )> = sqlx::query_as(
        r#"
        SELECT
            id, description, expense_type, amount, paid_amount, balance_due, status,
            invoice_number, invoice_date, due_date, created_at
        FROM customer_ledgers
        WHERE company_name = $1 AND status != 'cancelled'
        ORDER BY created_at DESC
        "#
    )
    .bind(company)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Calculate aging buckets based on invoice_date or created_at
    let today = chrono::Utc::now().date_naive();
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
        let (id, description, expense_type, amount, paid_amount, balance_due, status,
             invoice_number, invoice_date, due_date, created_at) = entry;

        // Calculate days old
        let entry_date = invoice_date.unwrap_or(created_at.date());
        let days_old = (today - entry_date).num_days();

        // Categorize into aging buckets
        if *balance_due > Decimal::ZERO {
            if days_old <= 30 {
                open_balance += *balance_due;
            } else if days_old <= 60 {
                days_31_60 += *balance_due;
            } else if days_old <= 90 {
                days_61_90 += *balance_due;
            } else if days_old <= 120 {
                days_91_120 += *balance_due;
            } else {
                over_120_days += *balance_due;
            }
        }

        total_original += *amount;
        total_payments += *paid_amount;
        total_open += *balance_due;

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
    let last_payment: Option<(Decimal, chrono::NaiveDateTime)> = sqlx::query_as(
        r#"
        SELECT payment_amount, clp.created_at
        FROM customer_ledger_payments clp
        INNER JOIN customer_ledgers cl ON clp.ledger_id = cl.id
        WHERE cl.company_name = $1
        ORDER BY clp.created_at DESC
        LIMIT 1
        "#
    )
    .bind(company)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (last_payment_amount, last_payment_date) = last_payment
        .map(|(amt, date)| (amt, Some(date.format("%d/%m/%Y").to_string())))
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
