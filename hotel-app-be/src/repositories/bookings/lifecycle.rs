//! Booking lifecycle handlers (CRUD, check-in/out, status
//! transitions) plus their shared private helpers.

use crate::core::auth::AuthService;
use crate::core::db::{DbPool, DbTransaction, decimal_to_db};
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::core::settings_cache;
use crate::models::*;
use crate::repositories::booking::BookingRepository;
use crate::repositories::bookings_queries::*;
use crate::services::audit::AuditLog;
use crate::services::booking as booking_svc;
use crate::services::payments;
use crate::utils::date::parse_date_flexible;
use crate::utils::pagination::normalize_pagination;
use crate::utils::sanitization::Sanitizer;
use axum::{
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Json,
};
use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;
use sqlx::Row;

pub async fn record_booking_history(
    pool: &DbPool,
    booking_id: i64,
    previous_status: Option<&str>,
    new_status: &str,
    changed_by: Option<i64>,
    change_reason: Option<&str>,
    metadata: serde_json::Value,
) {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let result = sqlx::query(
        r#"
        INSERT INTO booking_history (
            booking_id, previous_status, new_status, changed_by, change_reason, metadata
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(booking_id)
    .bind(previous_status)
    .bind(new_status)
    .bind(changed_by)
    .bind(change_reason)
    .bind(metadata.to_string())
    .execute(pool)
    .await;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let result = sqlx::query(
        r#"
        INSERT INTO booking_history (
            booking_id, previous_status, new_status, changed_by, change_reason, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(booking_id)
    .bind(previous_status)
    .bind(new_status)
    .bind(changed_by)
    .bind(change_reason)
    .bind(metadata)
    .execute(pool)
    .await;

    if let Err(e) = result {
        log::warn!(
            "Failed to record booking history for booking {}: {}",
            booking_id,
            e
        );
    }
}

pub async fn record_booking_history_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
    previous_status: Option<&str>,
    new_status: &str,
    changed_by: Option<i64>,
    change_reason: Option<&str>,
    metadata: serde_json::Value,
) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    sqlx::query(
        r#"
        INSERT INTO booking_history (
            booking_id, previous_status, new_status, changed_by, change_reason, metadata
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(booking_id)
    .bind(previous_status)
    .bind(new_status)
    .bind(changed_by)
    .bind(change_reason)
    .bind(metadata.to_string())
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    sqlx::query(
        r#"
        INSERT INTO booking_history (
            booking_id, previous_status, new_status, changed_by, change_reason, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(booking_id)
    .bind(previous_status)
    .bind(new_status)
    .bind(changed_by)
    .bind(change_reason)
    .bind(metadata)
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

async fn reconcile_room_status_after_booking_release(
    pool: &DbPool,
    room_id: i64,
    released_booking_id: i64,
) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let status_query = r#"
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = ?1 AND id != ?2
                  AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
                  AND check_in_date <= date('now')
                  AND check_out_date >= date('now')
            ) THEN 'occupied'
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = ?1 AND id != ?2
                  AND status IN ('reserved', 'confirmed', 'pending')
                  AND check_out_date > date('now')
            ) THEN 'reserved'
            ELSE 'available'
        END
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let status_query = r#"
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = $1 AND id != $2
                  AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
                  AND check_in_date <= CURRENT_DATE
                  AND check_out_date >= CURRENT_DATE
            ) THEN 'occupied'
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = $1 AND id != $2
                  AND status IN ('reserved', 'confirmed', 'pending')
                  AND check_out_date > CURRENT_DATE
            ) THEN 'reserved'
            ELSE 'available'
        END
    "#;

    let status: String = sqlx::query_scalar(status_query)
        .bind(room_id)
        .bind(released_booking_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let status_notes = match status.as_str() {
        "occupied" => "Room status reconciled: current stay remains",
        "reserved" => "Room status reconciled: upcoming reservation remains",
        _ => "Room released after booking update",
    };

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_query = r#"
        UPDATE rooms
        SET status = ?1, status_notes = ?2
        WHERE id = ?3
          AND status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning')
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_query = r#"
        UPDATE rooms
        SET status = $1, status_notes = $2
        WHERE id = $3
          AND status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning')
    "#;

    sqlx::query(update_query)
        .bind(&status)
        .bind(status_notes)
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

fn billable_nights(check_in: NaiveDate, check_out: NaiveDate) -> i32 {
    std::cmp::max((check_out - check_in).num_days() as i32, 1)
}

async fn canonical_tourism_tax_for_guest(
    pool: &DbPool,
    guest_id: i64,
    check_in: NaiveDate,
    check_out: NaiveDate,
) -> Result<(bool, Decimal), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let tourism_type_query = "SELECT tourism_type FROM guests WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let tourism_type_query = "SELECT tourism_type::text FROM guests WHERE id = $1";

    let tourism_type: Option<String> = sqlx::query_scalar(tourism_type_query)
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .flatten();

    let is_tourist = tourism_type.as_deref() == Some("foreign");
    let tourism_tax_amount = if is_tourist {
        let rate =
            settings_cache::get_positive_decimal(pool, "tourism_tax_rate", Decimal::from(10)).await;
        rate * Decimal::from(billable_nights(check_in, check_out))
    } else {
        Decimal::ZERO
    };

    Ok((is_tourist, tourism_tax_amount))
}

pub async fn get_booking_timeline_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Vec<BookingTimelineEntry>>, ApiError> {
    let booking = booking_svc::fetch_booking_by_id(&pool, booking_id).await?;

    let has_booking_access = AuthService::check_permission(&pool, user_id, "bookings:read")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let owns_booking_query =
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = ?1 AND ug.guest_id = ?2)";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let owns_booking_query =
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2)";

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let owns_booking: bool = sqlx::query_scalar::<_, i32>(owns_booking_query)
        .bind(user_id)
        .bind(booking.guest_id)
        .fetch_one(&pool)
        .await
        .map(|v| v != 0)
        .unwrap_or(false);

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let owns_booking: bool = sqlx::query_scalar::<_, bool>(owns_booking_query)
        .bind(user_id)
        .bind(booking.guest_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(false);

    if !has_booking_access && !owns_booking {
        return Err(ApiError::Forbidden(
            "You don't have permission to view this booking timeline".to_string(),
        ));
    }

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let timeline_sql = r#"
        SELECT CAST(id AS TEXT) AS id, 'booking_history' AS source, 'status_change' AS event_type,
               'Status changed to ' || new_status AS title,
               change_reason AS description, previous_status AS status_from, new_status AS status_to,
               NULL AS amount, changed_by AS actor_id, metadata, created_at
        FROM booking_history
        WHERE booking_id = ?1
        UNION ALL
        SELECT CAST(id AS TEXT) AS id, 'booking_modifications' AS source, modification_type AS event_type,
               CASE modification_type
                   WHEN 'rate_change' THEN 'Rate updated'
                   WHEN 'date_change' THEN 'Dates updated'
                   WHEN 'room_change' THEN 'Room changed'
                   WHEN 'check_in' THEN 'Guest checked in'
                   WHEN 'voided' THEN 'Booking voided'
                   ELSE 'Booking updated'
               END AS title,
               reason AS description, NULL AS status_from, NULL AS status_to,
               CAST(price_adjustment AS TEXT) AS amount, modified_by AS actor_id, new_value AS metadata, modified_at AS created_at
        FROM booking_modifications
        WHERE booking_id = ?1
        UNION ALL
        SELECT CAST(id AS TEXT) AS id, 'payments' AS source, COALESCE(payment_type, 'booking') AS event_type,
               CASE
                   WHEN COALESCE(payment_type, '') = 'refund' THEN 'Refund recorded'
                   WHEN status = 'failed' THEN 'Payment failed'
                   ELSE 'Payment recorded'
               END AS title,
               notes AS description, NULL AS status_from, status AS status_to,
               CAST(amount AS TEXT) AS amount, processed_by AS actor_id, NULL AS metadata, created_at
        FROM payments
        WHERE booking_id = ?1
        UNION ALL
        SELECT CAST(id AS TEXT) AS id, 'invoices' AS source, 'invoice' AS event_type,
               'Invoice ' || invoice_number AS title,
               notes AS description, NULL AS status_from, status AS status_to,
               CAST(total_amount AS TEXT) AS amount, created_by AS actor_id, NULL AS metadata, created_at
        FROM invoices
        WHERE booking_id = ?1
        ORDER BY created_at ASC
    "#;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let timeline_sql = r#"
        SELECT id::text AS id, 'booking_history' AS source, 'status_change' AS event_type,
               'Status changed to ' || new_status AS title,
               change_reason AS description, previous_status AS status_from, new_status AS status_to,
               NULL::text AS amount, changed_by AS actor_id, metadata, created_at
        FROM booking_history
        WHERE booking_id = $1
        UNION ALL
        SELECT id::text AS id, 'booking_modifications' AS source, modification_type AS event_type,
               CASE modification_type
                   WHEN 'rate_change' THEN 'Rate updated'
                   WHEN 'date_change' THEN 'Dates updated'
                   WHEN 'room_change' THEN 'Room changed'
                   WHEN 'check_in' THEN 'Guest checked in'
                   WHEN 'voided' THEN 'Booking voided'
                   ELSE 'Booking updated'
               END AS title,
               reason AS description, NULL::text AS status_from, NULL::text AS status_to,
               price_adjustment::text AS amount, modified_by AS actor_id, new_value AS metadata, modified_at AS created_at
        FROM booking_modifications
        WHERE booking_id = $1
        UNION ALL
        SELECT id::text AS id, 'payments' AS source, COALESCE(payment_type, 'booking') AS event_type,
               CASE
                   WHEN COALESCE(payment_type, '') = 'refund' THEN 'Refund recorded'
                   WHEN status = 'failed' THEN 'Payment failed'
                   ELSE 'Payment recorded'
               END AS title,
               notes AS description, NULL::text AS status_from, status AS status_to,
               amount::text AS amount, created_by AS actor_id, metadata, created_at
        FROM payments
        WHERE booking_id = $1
        UNION ALL
        SELECT id::text AS id, 'invoices' AS source, 'invoice' AS event_type,
               'Invoice ' || invoice_number AS title,
               notes AS description, NULL::text AS status_from, status AS status_to,
               total_amount::text AS amount, created_by AS actor_id, NULL::jsonb AS metadata, created_at
        FROM invoices
        WHERE booking_id = $1
        ORDER BY created_at ASC
    "#;

    let rows = sqlx::query(timeline_sql)
        .bind(booking_id)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let timeline = rows
        .iter()
        .map(|row| {
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let metadata = row
                .try_get::<Option<String>, _>("metadata")
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok());
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let metadata = row
                .try_get::<Option<serde_json::Value>, _>("metadata")
                .ok()
                .flatten();

            BookingTimelineEntry {
                id: row.try_get("id").unwrap_or_default(),
                source: row.try_get("source").unwrap_or_default(),
                event_type: row.try_get("event_type").unwrap_or_default(),
                title: row.try_get("title").unwrap_or_default(),
                description: row.try_get("description").ok(),
                status_from: row.try_get("status_from").ok(),
                status_to: row.try_get("status_to").ok(),
                amount: row.try_get("amount").ok(),
                actor_id: row.try_get("actor_id").ok(),
                metadata,
                created_at: row
                    .try_get("created_at")
                    .unwrap_or_else(|_| chrono::Utc::now()),
            }
        })
        .collect();

    Ok(Json(timeline))
}

/// Auto-create a `customer_ledgers` room-charge row for a company-billing
/// booking on checkout. Idempotent: returns Ok(()) without inserting if a
/// non-reversal `room_charge` row already exists for the booking.
async fn auto_post_company_ledger(
    pool: &DbPool,
    booking: &Booking,
    company_name: &str,
    check_in: NaiveDate,
    check_out: NaiveDate,
    user_id: i64,
) -> Result<(), ApiError> {
    let booking_id = booking.id;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM customer_ledgers \
         WHERE booking_id = $1 AND post_type = 'room_charge' \
         AND COALESCE(is_reversal, false) = false)",
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let exists: bool = sqlx::query_scalar::<_, i32>(
        "SELECT EXISTS(SELECT 1 FROM customer_ledgers \
         WHERE booking_id = ?1 AND post_type = 'room_charge' \
         AND COALESCE(is_reversal, 0) = 0)",
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .map(|v| v != 0)
    .unwrap_or(false);

    if exists {
        return Ok(());
    }

    let nights = std::cmp::max((check_out - check_in).num_days(), 1);

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let detail: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT r.room_number, g.full_name FROM bookings b \
         LEFT JOIN rooms r ON b.room_id = r.id \
         LEFT JOIN guests g ON b.guest_id = g.id WHERE b.id = $1",
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let detail: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT r.room_number, g.full_name FROM bookings b \
         LEFT JOIN rooms r ON b.room_id = r.id \
         LEFT JOIN guests g ON b.guest_id = g.id WHERE b.id = ?1",
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let (room_number, guest_name) = detail.unwrap_or((None, None));

    let description = format!(
        "Room {} - {} ({} night{}: {} to {})",
        room_number.as_deref().unwrap_or(""),
        guest_name.as_deref().unwrap_or(""),
        nights,
        if nights > 1 { "s" } else { "" },
        check_in,
        check_out,
    );

    let default_terms_days =
        settings_cache::get_positive_i32(pool, "default_payment_terms_days", 30).await as i64;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let terms_days: i64 = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT payment_terms_days FROM companies WHERE company_name = $1 LIMIT 1",
    )
    .bind(company_name)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .flatten()
    .map(i64::from)
    .unwrap_or(default_terms_days);
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let terms_days: i64 = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT payment_terms_days FROM companies WHERE company_name = ?1 LIMIT 1",
    )
    .bind(company_name)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .flatten()
    .unwrap_or(default_terms_days);

    let today = chrono::Local::now().date_naive();
    let due_date = today + chrono::Duration::days(terms_days);

    // Reuse the booking's existing invoice number when one already exists,
    // so a single booking has a single invoice number across `invoices` and
    // `customer_ledgers`. Only generate a new one if neither table has one yet.
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let existing_invoice: Option<String> = sqlx::query_scalar(
        "SELECT invoice_number FROM invoices \
         WHERE booking_id = $1 AND invoice_number IS NOT NULL \
         ORDER BY created_at LIMIT 1",
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let existing_invoice: Option<String> = sqlx::query_scalar(
        "SELECT invoice_number FROM invoices \
         WHERE booking_id = ?1 AND invoice_number IS NOT NULL \
         ORDER BY created_at LIMIT 1",
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let invoice_number = match existing_invoice {
        Some(n) => Some(n),
        None => crate::services::invoice_numbers::next_invoice_number(pool)
            .await
            .ok(),
    };

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    sqlx::query(
        r#"
        INSERT INTO customer_ledgers (
            company_name, description, expense_type, amount,
            booking_id, post_type, posting_date, transaction_date,
            invoice_date, due_date, room_number,
            folio_type, transaction_type,
            created_by, updated_by, cashier_id,
            invoice_number
        )
        VALUES ($1, $2, 'accommodation', $3,
                $4, 'room_charge', CURRENT_DATE, CURRENT_DATE,
                CURRENT_DATE, $5, $6,
                'city_ledger', 'debit',
                $7, $7, $7,
                $8)
        "#,
    )
    .bind(company_name)
    .bind(&description)
    .bind(booking.total_amount)
    .bind(booking_id)
    .bind(due_date)
    .bind(&room_number)
    .bind(user_id)
    .bind(&invoice_number)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    sqlx::query(
        r#"
        INSERT INTO customer_ledgers (
            company_name, description, expense_type, amount,
            booking_id, post_type, posting_date, transaction_date,
            invoice_date, due_date, room_number,
            folio_type, transaction_type,
            created_by, updated_by, cashier_id,
            invoice_number
        )
        VALUES (?1, ?2, 'accommodation', ?3,
                ?4, 'room_charge', date('now'), date('now'),
                date('now'), ?5, ?6,
                'city_ledger', 'debit',
                ?7, ?7, ?7,
                ?8)
        "#,
    )
    .bind(company_name)
    .bind(&description)
    .bind(booking.total_amount.to_string())
    .bind(booking_id)
    .bind(due_date.to_string())
    .bind(&room_number)
    .bind(user_id)
    .bind(&invoice_number)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    log::info!(
        "Auto-posted company ledger for booking {} ({}, amount {})",
        booking_id,
        company_name,
        booking.total_amount
    );
    Ok(())
}

pub async fn get_bookings_handler(
    State(pool): State<DbPool>,
    Query(params): Query<BookingPaginationParams>,
) -> Result<Json<PaginatedResponse<Vec<BookingWithDetails>>>, ApiError> {
    let pagination = normalize_pagination(params.page, params.page_size, 50, 500);
    let (total, bookings) = BookingRepository::find_paginated_with_details(
        &pool,
        &params,
        GET_BOOKINGS_BASE_QUERY,
        pagination,
    )
    .await?;

    Ok(Json(PaginatedResponse {
        data: bookings,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    }))
}

fn decimal_to_f64(value: Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}

async fn booking_revenue_for_date(pool: &DbPool, date: NaiveDate) -> Result<f64, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let row = sqlx::query(
        r#"
        SELECT COALESCE(SUM(total_amount), 0) AS revenue
        FROM bookings
        WHERE status != 'voided' AND date(created_at) = date(?1)
        "#,
    )
    .bind(date.to_string())
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let row = sqlx::query(
        r#"
        SELECT COALESCE(SUM(total_amount), 0) AS revenue
        FROM bookings
        WHERE status != 'voided' AND created_at::date = $1
        "#,
    )
    .bind(date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(decimal_to_f64(row_mappers::get_decimal(&row, "revenue")))
}

pub async fn get_booking_stats_handler(
    State(pool): State<DbPool>,
) -> Result<Json<BookingStats>, ApiError> {
    let today = chrono::Local::now().date_naive();

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE status != 'voided'")
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

    let checked_in: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE status = 'checked_in'")
            .fetch_one(&pool)
            .await
            .unwrap_or(0);

    let confirmed: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE status = 'confirmed'")
            .fetch_one(&pool)
            .await
            .unwrap_or(0);

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let today_check_ins: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE status IN ('pending', 'confirmed') AND date(check_in_date) = ?"
    ).bind(today).fetch_one(&pool).await.unwrap_or(0);

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let today_check_ins: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE status IN ('pending', 'confirmed') AND check_in_date::date = $1"
    ).bind(today).fetch_one(&pool).await.unwrap_or(0);

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let today_check_outs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed') AND date(check_out_date) = ?"
    ).bind(today).fetch_one(&pool).await.unwrap_or(0);

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let today_check_outs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed') AND check_out_date::date = $1"
    ).bind(today).fetch_one(&pool).await.unwrap_or(0);

    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE status IN ('pending', 'confirmed')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE status IN ('pending', 'confirmed', 'checked_in', 'auto_checked_in')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    let total_revenue = sqlx::query(
        "SELECT COALESCE(SUM(total_amount), 0) AS revenue FROM bookings WHERE status != 'voided'",
    )
    .fetch_one(&pool)
    .await
    .map(|row| decimal_to_f64(row_mappers::get_decimal(&row, "revenue")))
    .unwrap_or(0.0);

    let mut revenue_last_7_days = Vec::with_capacity(7);
    for days_ago in (0..7).rev() {
        let date = today - Duration::days(days_ago);
        let revenue = booking_revenue_for_date(&pool, date).await.unwrap_or(0.0);
        revenue_last_7_days.push(BookingRevenuePoint { date, revenue });
    }

    Ok(Json(BookingStats {
        total,
        checked_in,
        confirmed,
        today_check_ins,
        today_check_outs,
        pending,
        active,
        total_revenue,
        revenue_last_7_days,
    }))
}

pub async fn get_my_bookings_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let user_email: String = sqlx::query_scalar(GET_USER_EMAIL_QUERY)
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let rows = sqlx::query(GET_USER_BOOKINGS_QUERY)
        .bind(&user_email)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let bookings: Vec<BookingWithDetails> = rows
        .iter()
        .map(row_mappers::row_to_booking_with_details)
        .collect();

    Ok(Json(bookings))
}

pub async fn create_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<BookingInput>,
) -> Result<Json<Booking>, ApiError> {
    let check_in = parse_date_flexible(&input.check_in_date)
        .map_err(|_| ApiError::BadRequest("Invalid check-in date. Use YYYY-MM-DD".to_string()))?;
    let check_out = parse_date_flexible(&input.check_out_date)
        .map_err(|_| ApiError::BadRequest("Invalid check-out date. Use YYYY-MM-DD".to_string()))?;

    if check_out < check_in {
        return Err(ApiError::BadRequest(
            "Check-out date must be on or after check-in date".to_string(),
        ));
    }

    // Start a transaction to prevent race conditions:
    // The FOR UPDATE lock on the room row + conflict check + insert must be atomic
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let row = sqlx::query(
        r#"
        SELECT r.id, r.room_number, rt.name as room_type,
               COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
               true as available,
               rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1 AND r.is_active = true
        FOR UPDATE OF r
        "#,
    )
    .bind(input.room_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    let room = Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available: row.get(4),
        description: row.get(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
        notes: None,
        is_smoking: None,
    };

    // Only block rooms that are under maintenance or out of order
    let room_status = room.status.as_deref().unwrap_or("available");
    if room_status == "maintenance" || room_status == "out_of_order" {
        return Err(ApiError::BadRequest(format!(
            "Room is not available - currently {}",
            room_status.replace("_", " ")
        )));
    }

    // Only check for ACTIVE bookings that would conflict
    // Active statuses: reserved, confirmed, checked_in, auto_checked_in, pending
    // Inactive statuses (don't block): voided, checked_out, completed
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = ?1 AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending') AND status != 'voided'
            AND ((check_in_date <= ?2 AND check_out_date > ?2)
                OR (check_in_date < ?3 AND check_out_date >= ?3)
                OR (check_in_date >= ?2 AND check_out_date <= ?3))
        )
    "#;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1 AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending') AND status != 'voided'
            AND ((check_in_date <= $2 AND check_out_date > $2)
                OR (check_in_date < $3 AND check_out_date >= $3)
                OR (check_in_date >= $2 AND check_out_date <= $3))
        )
    "#;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let conflict: bool = sqlx::query_scalar::<_, i32>(conflict_query)
        .bind(input.room_id)
        .bind(check_in)
        .bind(check_out)
        .fetch_one(&mut *tx)
        .await
        .map(|v| v != 0)
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let conflict: bool = sqlx::query_scalar::<_, bool>(conflict_query)
        .bind(input.room_id)
        .bind(check_in)
        .bind(check_out)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if conflict {
        return Err(ApiError::BadRequest(
            "Room is already booked for these dates".to_string(),
        ));
    }

    let (is_tourist, tourism_tax_amount) =
        canonical_tourism_tax_for_guest(&pool, input.guest_id, check_in, check_out).await?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let hotel_today: NaiveDate = {
        let today_str: String = sqlx::query_scalar("SELECT date('now', 'localtime')")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        NaiveDate::parse_from_str(&today_str, "%Y-%m-%d")
            .map_err(|e| ApiError::Database(e.to_string()))?
    };

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let hotel_today: NaiveDate = sqlx::query_scalar("SELECT CURRENT_DATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let nights = (check_out - check_in).num_days() as i32;
    let is_hourly = nights == 0; // Same-day check-in/check-out = hourly booking
    let billable_nights = if is_hourly { 1 } else { nights }; // Charge 1 night for hourly
    let room_rate = input
        .room_rate_override
        .map(|r| Decimal::from_f64_retain(r).unwrap_or(room.price_per_night))
        .unwrap_or(room.price_per_night);
    // The configured room price is tax-inclusive (final price)
    // Store total_amount as the configured price × nights without adding additional tax
    // For hourly bookings (same-day), charge 1 night at the standard rate
    // If daily_rates provided, sum them for subtotal; otherwise use room_rate * nights
    let subtotal = if let Some(ref daily_rates) = input.daily_rates {
        if let Some(obj) = daily_rates.as_object() {
            let sum: f64 = obj.values().filter_map(|v| v.as_f64()).sum();
            Decimal::from_f64_retain(sum).unwrap_or(room_rate * Decimal::from(billable_nights))
        } else {
            room_rate * Decimal::from(billable_nights)
        }
    } else {
        room_rate * Decimal::from(billable_nights)
    };
    let tax_amount = Decimal::ZERO; // Tax is calculated on frontend using hotel settings rate
    let total_amount = subtotal; // Configured price is the final price
    let daily_rates_json = input.daily_rates.clone();

    // Use provided booking_number for online bookings, or auto-generate for walk-ins
    let booking_number = match &input.booking_number {
        Some(bn) if !bn.trim().is_empty() => bn.trim().to_string(),
        _ => booking_svc::generate_booking_number_for_date(hotel_today),
    };

    let source = input
        .source
        .clone()
        .unwrap_or_else(|| "walk_in".to_string());

    // Sanitize user-provided text fields
    let booking_remarks = input
        .booking_remarks
        .as_deref()
        .map(Sanitizer::sanitize_notes);
    let special_requests = input
        .special_requests
        .as_deref()
        .map(Sanitizer::sanitize_notes);

    let deposit_paid = input.deposit_paid.unwrap_or(false);
    let deposit_amount_f64 = input.deposit_amount;
    let payment_status = input
        .payment_status
        .clone()
        .unwrap_or_else(|| "unpaid".to_string());

    // Get the override rate value if provided (to store in rate_override_weekday)
    let rate_override_value = input.room_rate_override;

    // SQLite version: INSERT then SELECT
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let booking: Booking = {
        use rust_decimal::prelude::ToPrimitive;
        sqlx::query(
            r#"
            INSERT INTO bookings (
                booking_number, guest_id, room_id, check_in_date, check_out_date,
                room_rate, subtotal, tax_amount, total_amount, status, payment_status, payment_method, remarks, created_by, adults, source,
                deposit_paid, deposit_amount, deposit_paid_at, rate_override_weekday, rate_override_weekend, special_requests, post_type, daily_rates, cleaning_preference
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'confirmed', ?10, ?11, ?12, ?13, 1, ?14, ?15, ?16, CASE WHEN ?15 THEN datetime('now') ELSE NULL END, ?17, ?17, ?18, ?19, ?20, ?21)
            "#
        )
        .bind(&booking_number)
        .bind(input.guest_id)
        .bind(input.room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(room_rate.to_f64().unwrap_or(0.0))
        .bind(subtotal.to_f64().unwrap_or(0.0))
        .bind(tax_amount.to_f64().unwrap_or(0.0))
        .bind(total_amount.to_f64().unwrap_or(0.0))
        .bind(&payment_status)
        .bind(input.payment_method.as_deref())
        .bind(booking_remarks.as_deref())
        .bind(user_id)
        .bind(&source)
        .bind(if deposit_paid { 1i32 } else { 0i32 })
        .bind(deposit_amount_f64)
        .bind(rate_override_value)
        .bind(special_requests.as_deref())
        .bind(if is_hourly { Some("hourly") } else { None::<&str> })
        .bind(daily_rates_json.as_ref().map(|v| v.to_string()))
        .bind(input.cleaning_preference.map(|b| if b { 1i32 } else { 0i32 }))
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        // Fetch the created booking
        let row = sqlx::query(r#"SELECT * FROM bookings WHERE booking_number = ?1"#)
            .bind(&booking_number)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        row_mappers::row_to_booking(&row)
    };

    // PostgreSQL version: INSERT with RETURNING
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let booking: Booking = {
        let deposit_amount =
            deposit_amount_f64.map(|d| Decimal::from_f64_retain(d).unwrap_or(Decimal::ZERO));
        let rate_override_decimal = rate_override_value.and_then(Decimal::from_f64_retain);
        sqlx::query_as(
            r#"
            INSERT INTO bookings (
                booking_number, guest_id, room_id, check_in_date, check_out_date,
                room_rate, subtotal, tax_amount, total_amount, status, payment_status, payment_method, remarks, created_by, adults, source,
                deposit_paid, deposit_amount, deposit_paid_at, rate_override_weekday, rate_override_weekend, special_requests,
                is_tourist, tourism_tax_amount, extra_bed_count, extra_bed_charge, post_type, daily_rates, cleaning_preference
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11, $12, $13, 1, $14, $15, $16, CASE WHEN $15 THEN CURRENT_TIMESTAMP ELSE NULL END, $17, $17, $18,
                $19, $20, $21, $22, $23, $24, $25)
            RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, payment_method, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, daily_rates, created_at, updated_at, post_type
            "#
        )
        .bind(&booking_number)
        .bind(input.guest_id)
        .bind(input.room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(room_rate)
        .bind(subtotal)
        .bind(tax_amount)
        .bind(total_amount)
        .bind(&payment_status)
        .bind(input.payment_method.as_deref())
        .bind(booking_remarks.as_deref())
        .bind(user_id)
        .bind(&source)
        .bind(deposit_paid)
        .bind(deposit_amount)
        .bind(rate_override_decimal)
        .bind(special_requests.as_deref())
        .bind(is_tourist)
        .bind(tourism_tax_amount)
        .bind(input.extra_bed_count)
        .bind(input.extra_bed_charge.map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO)))
        .bind(if is_hourly { Some("hourly") } else { None::<&str> })
        .bind(&daily_rates_json)
        .bind(input.cleaning_preference)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    };

    // A confirmed booking reserves the room; only check-in makes it occupied.
    let room_status = "reserved";
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_room_query = "UPDATE rooms SET status = ?1, status_notes = ?2 WHERE id = ?3";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_room_query = "UPDATE rooms SET status = $1, status_notes = $2 WHERE id = $3";

    sqlx::query(update_room_query)
        .bind(room_status)
        .bind(format!(
            "Booking #{} - {}",
            booking.booking_number,
            if check_in == hotel_today {
                "Reservation arriving today"
            } else {
                "Future reservation"
            }
        ))
        .bind(input.room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Record payment if deposit was paid during booking creation
    if let Some(amount_paid) = input.amount_paid
        && amount_paid > 0.0
    {
        let payment_amount = Decimal::from_f64_retain(amount_paid).unwrap_or(Decimal::ZERO);
        let payment_method_str = input.payment_method.as_deref().unwrap_or("Cash");
        let _ = sqlx::query(
                r#"
                INSERT INTO payments (uuid, booking_id, amount, payment_method, payment_type, status, notes, created_by)
                VALUES (gen_random_uuid(), $1, $2, $3, 'deposit', 'completed', 'Deposit paid at booking', $4)
                "#,
            )
            .bind(booking.id)
            .bind(crate::core::db::decimal_to_db(payment_amount))
            .bind(payment_method_str)
            .bind(user_id)
            .execute(&mut *tx)
            .await;
    }

    // Commit the transaction - all conflict check + insert + room update are now atomic
    tx.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // If a deposit row was inserted above, recompute payment_status so the
    // stored column reflects the new running total (e.g. partial vs unpaid).
    if matches!(input.amount_paid, Some(a) if a > 0.0) {
        crate::handlers::payments::recompute_payment_status(&pool, booking.id).await?;
    }

    // Log booking creation (outside transaction - non-critical)
    let _ =
        AuditLog::log_booking_created(&pool, user_id, booking.id, input.guest_id, input.room_id)
            .await;
    record_booking_history(
        &pool,
        booking.id,
        None,
        &booking.status,
        Some(user_id),
        Some("Booking created"),
        serde_json::json!({
            "guest_id": booking.guest_id,
            "room_id": booking.room_id,
            "check_in_date": booking.check_in_date.to_string(),
            "check_out_date": booking.check_out_date.to_string(),
            "total_amount": booking.total_amount.to_string(),
            "source": &booking.source,
            "payment_status": &booking.payment_status,
        }),
    )
    .await;

    Ok(Json(booking))
}

pub async fn get_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<BookingWithDetails>, ApiError> {
    let row = sqlx::query(GET_BOOKING_BY_ID_QUERY)
        .bind(booking_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let booking = row_mappers::row_to_booking_with_details(&row);

    let has_booking_access = AuthService::check_permission(&pool, user_id, "bookings:read")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    let owns_booking = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug INNER JOIN bookings b ON ug.guest_id = b.guest_id WHERE ug.user_id = $1 AND b.id = $2)"
    )
    .bind(user_id)
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_booking_access && !owns_booking {
        return Err(ApiError::Unauthorized(
            "You don't have permission to view this booking".to_string(),
        ));
    }

    Ok(Json(booking))
}

pub async fn update_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(input): Json<BookingUpdateInput>,
) -> Result<Json<Booking>, ApiError> {
    let existing_booking = booking_svc::fetch_booking_by_id(&pool, booking_id).await?;

    let has_booking_update = AuthService::check_permission(&pool, user_id, "bookings:update")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let owns_booking_query =
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = ?1 AND ug.guest_id = ?2)";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let owns_booking_query =
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2)";

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let owns_booking: bool = sqlx::query_scalar::<_, i32>(owns_booking_query)
        .bind(user_id)
        .bind(existing_booking.guest_id)
        .fetch_one(&pool)
        .await
        .map(|v| v != 0)
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let owns_booking: bool = sqlx::query_scalar::<_, bool>(owns_booking_query)
        .bind(user_id)
        .bind(existing_booking.guest_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_booking_update && !owns_booking {
        return Err(ApiError::Forbidden(
            "You don't have permission to modify this booking".to_string(),
        ));
    }

    let new_room_id = if let Some(ref room_id_str) = input.room_id {
        room_id_str
            .parse::<i64>()
            .map_err(|_| ApiError::BadRequest("Invalid room".to_string()))?
    } else {
        existing_booking.room_id
    };

    let new_status = input
        .status
        .as_ref()
        .unwrap_or(&existing_booking.status)
        .clone();
    if matches!(new_status.as_str(), "cancelled" | "comp_cancelled") {
        return Err(ApiError::BadRequest(
            "Use 'voided' for booking status or 'comp_void' for complimentary voids; 'cancelled' is no longer accepted.".to_string(),
        ));
    }
    if input.payment_status.as_deref() == Some("cancelled") {
        return Err(ApiError::BadRequest(
            "Use 'void' for payment status; 'cancelled' is no longer accepted.".to_string(),
        ));
    }

    let check_in = if let Some(ref date_str) = input.check_in_date {
        parse_date_flexible(date_str).map_err(|_| {
            ApiError::BadRequest("Invalid check-in date. Use YYYY-MM-DD".to_string())
        })?
    } else {
        existing_booking.check_in_date
    };

    let check_out = if let Some(ref date_str) = input.check_out_date {
        parse_date_flexible(date_str).map_err(|_| {
            ApiError::BadRequest("Invalid check-out date. Use YYYY-MM-DD".to_string())
        })?
    } else {
        existing_booking.check_out_date
    };

    if (input.check_in_date.is_some() || input.check_out_date.is_some()) && check_out < check_in {
        return Err(ApiError::BadRequest(
            "Check-out date must be on or after check-in date".to_string(),
        ));
    }

    // Check for room conflicts when room or dates change (skip for non-active statuses)
    let room_changed = input.room_id.is_some() && new_room_id != existing_booking.room_id;
    let dates_changed = input.check_in_date.is_some() || input.check_out_date.is_some();
    let is_inactive_status = matches!(
        new_status.as_str(),
        "voided" | "checked_out" | "late_checkout"
    );
    if (room_changed || dates_changed) && !is_inactive_status {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let conflict_query = r#"
            SELECT EXISTS(
                SELECT 1 FROM bookings
                WHERE room_id = ?1 AND id != ?4
                AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending') AND status != 'voided'
                AND ((check_in_date <= ?2 AND check_out_date > ?2)
                    OR (check_in_date < ?3 AND check_out_date >= ?3)
                    OR (check_in_date >= ?2 AND check_out_date <= ?3))
            )
        "#;

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let conflict_query = r#"
            SELECT EXISTS(
                SELECT 1 FROM bookings
                WHERE room_id = $1 AND id != $4
                AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending') AND status != 'voided'
                AND ((check_in_date <= $2 AND check_out_date > $2)
                    OR (check_in_date < $3 AND check_out_date >= $3)
                    OR (check_in_date >= $2 AND check_out_date <= $3))
            )
        "#;

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let conflict: bool = sqlx::query_scalar::<_, i32>(conflict_query)
            .bind(new_room_id)
            .bind(check_in)
            .bind(check_out)
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .map(|v| v != 0)
            .map_err(|e| ApiError::Database(e.to_string()))?;

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let conflict: bool = sqlx::query_scalar::<_, bool>(conflict_query)
            .bind(new_room_id)
            .bind(check_in)
            .bind(check_out)
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        if conflict {
            return Err(ApiError::BadRequest(
                "Room is already booked for these dates".to_string(),
            ));
        }
    }

    // Determine post_type based on dates: hourly if check_in == check_out
    let post_type = if check_in == check_out {
        Some("hourly".to_string())
    } else {
        None // Normal stay
    };

    // bookings.payment_status is now derived from the payments table — every
    // SELECT in bookings_queries.rs overrides it, and recompute_payment_status
    // is called at the end of this handler to keep the stored copy in sync.
    // Ignore any caller-supplied payment_status (used to be a manual dropdown
    // that drifted from reality). Preserve the existing stored value verbatim
    // so the UPDATE below is a no-op for this column; the recompute at the
    // bottom of the handler will replace it with the canonical value.
    let new_payment_status = existing_booking
        .payment_status
        .clone()
        .unwrap_or_else(|| "unpaid".to_string());

    // Handle deposit fields
    let deposit_paid = input.deposit_paid;
    let deposit_amount_f64 = input.deposit_amount;

    // Handle daily_rates, room rate override, or date change - recalculate totals.
    //
    // When dates change without an explicit daily_rates payload, rebuild
    // daily_rates to match the new [check_in, check_out) range, preserving any
    // existing per-night values and filling new nights with the booking's
    // room_rate. Without this, shrinking a stay leaves orphan keys (over-charge
    // on the invoice) and extending leaves missing keys (under-charge).
    let mut daily_rates_json = input.daily_rates.clone();
    if daily_rates_json.is_none()
        && (input.check_in_date.is_some() || input.check_out_date.is_some())
        && check_in < check_out
        && let Some(existing_dr) = existing_booking
            .daily_rates
            .as_ref()
            .and_then(|v| v.as_object())
        && !existing_dr.is_empty()
    {
        let fallback_rate: f64 = existing_booking
            .room_rate
            .to_string()
            .parse()
            .unwrap_or(0.0);
        let mut new_dr = serde_json::Map::new();
        let mut date = check_in;
        while date < check_out {
            let key = date.format("%Y-%m-%d").to_string();
            let value = existing_dr
                .get(&key)
                .cloned()
                .unwrap_or_else(|| serde_json::json!(fallback_rate));
            new_dr.insert(key, value);
            match date.succ_opt() {
                Some(next) => date = next,
                None => break,
            }
        }
        daily_rates_json = Some(serde_json::Value::Object(new_dr));
    }

    let (new_room_rate, new_subtotal, new_total_amount) = if let Some(ref dr) = daily_rates_json {
        // Daily rates available (caller-supplied or rebuilt) - sum them for subtotal
        if let Some(obj) = dr.as_object() {
            let sum: f64 = obj
                .values()
                .filter_map(|v| {
                    v.as_f64()
                        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
                })
                .sum();
            let subtotal = Decimal::from_f64_retain(sum).unwrap_or(Decimal::ZERO);
            let room_rate = if let Some(rate_override) = input.room_rate_override {
                Decimal::from_f64_retain(rate_override).unwrap_or(existing_booking.room_rate)
            } else {
                existing_booking.room_rate
            };
            (Some(room_rate), Some(subtotal), Some(subtotal))
        } else {
            (None, None, None)
        }
    } else if let Some(rate_override) = input.room_rate_override {
        let nights = std::cmp::max((check_out - check_in).num_days() as i32, 1);
        let room_rate =
            Decimal::from_f64_retain(rate_override).unwrap_or(existing_booking.room_rate);
        let subtotal = room_rate * Decimal::from(nights);
        let total_amount = subtotal; // Tax is calculated on frontend using hotel settings rate
        (Some(room_rate), Some(subtotal), Some(total_amount))
    } else if input.check_out_date.is_some() || input.check_in_date.is_some() {
        // Dates changed without explicit rate override - recalculate using existing room rate
        let nights = std::cmp::max((check_out - check_in).num_days() as i32, 1);
        let room_rate = existing_booking.room_rate;
        let subtotal = room_rate * Decimal::from(nights);
        let total_amount = subtotal;
        (None, Some(subtotal), Some(total_amount))
    } else {
        (None, None, None)
    };

    let (canonical_is_tourist, canonical_tourism_tax_amount) =
        canonical_tourism_tax_for_guest(&pool, existing_booking.guest_id, check_in, check_out)
            .await?;

    // SQLite version: UPDATE then SELECT
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let booking: Booking = {
        use rust_decimal::prelude::ToPrimitive;
        sqlx::query(
            r#"UPDATE bookings SET
                room_id = ?1, status = ?2, check_in_date = ?3, check_out_date = ?4,
                post_type = ?5, payment_status = ?6,
                deposit_paid = COALESCE(?8, deposit_paid),
                deposit_amount = COALESCE(?9, deposit_amount),
                deposit_paid_at = CASE WHEN ?8 = 1 AND deposit_paid_at IS NULL THEN datetime('now') ELSE deposit_paid_at END,
                company_id = COALESCE(?10, company_id),
                company_name = COALESCE(?11, company_name),
                payment_note = COALESCE(?12, payment_note),
                remarks = COALESCE(?13, remarks),
                source = COALESCE(?14, source),
                payment_method = ?15,
                room_rate = COALESCE(?16, room_rate),
                subtotal = COALESCE(?17, subtotal),
                total_amount = COALESCE(?18, total_amount),
                rate_override_weekday = COALESCE(?19, rate_override_weekday),
                rate_override_weekend = COALESCE(?19, rate_override_weekend),
                special_requests = COALESCE(?20, special_requests),
                is_tourist = ?21,
                tourism_tax_amount = ?22,
                extra_bed_count = COALESCE(?23, extra_bed_count),
                extra_bed_charge = COALESCE(?24, extra_bed_charge),
                daily_rates = COALESCE(?25, daily_rates),
                cleaning_preference = COALESCE(?26, cleaning_preference),
                actual_check_out = CASE WHEN ?2 = 'checked_out' AND actual_check_out IS NULL THEN datetime('now') ELSE actual_check_out END,
                updated_at = datetime('now')
            WHERE id = ?7"#
        )
        .bind(&new_room_id)
        .bind(&new_status)
        .bind(check_in)
        .bind(check_out)
        .bind(&post_type)
        .bind(&new_payment_status)
        .bind(booking_id)
        .bind(deposit_paid.map(|b| if b { 1i32 } else { 0i32 }))
        .bind(deposit_amount_f64)
        .bind(input.company_id)
        .bind(&input.company_name)
        .bind(&input.payment_note)
        .bind(&input.remarks)
        .bind(&input.source)
        .bind(&input.payment_method)
        .bind(new_room_rate.map(|r| r.to_f64().unwrap_or(0.0)))
        .bind(new_subtotal.map(|s| s.to_f64().unwrap_or(0.0)))
        .bind(new_total_amount.map(|t| t.to_f64().unwrap_or(0.0)))
        .bind(input.room_rate_override)
        .bind(&input.special_requests)
        .bind(if canonical_is_tourist { 1i32 } else { 0i32 })
        .bind(canonical_tourism_tax_amount.to_f64().unwrap_or(0.0))
        .bind(input.extra_bed_count)
        .bind(input.extra_bed_charge)
        .bind(daily_rates_json.as_ref().map(|v| v.to_string()))
        .bind(input.cleaning_preference.map(|b| if b { 1i32 } else { 0i32 }))
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        let row = sqlx::query("SELECT * FROM bookings WHERE id = ?1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        row_mappers::row_to_booking(&row)
    };

    // PostgreSQL version: UPDATE with RETURNING
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let booking: Booking = {
        let deposit_amount =
            deposit_amount_f64.map(|d| Decimal::from_f64_retain(d).unwrap_or(Decimal::ZERO));
        let rate_override_decimal = input.room_rate_override.and_then(Decimal::from_f64_retain);
        sqlx::query_as(
            r#"UPDATE bookings SET
                room_id = $1, status = $2, check_in_date = $3, check_out_date = $4,
                post_type = $5, payment_status = $6,
                deposit_paid = COALESCE($8, deposit_paid),
                deposit_amount = COALESCE($9, deposit_amount),
                deposit_paid_at = CASE WHEN $8 = true AND deposit_paid_at IS NULL THEN CURRENT_TIMESTAMP ELSE deposit_paid_at END,
                company_id = COALESCE($10, company_id),
                company_name = COALESCE($11, company_name),
                payment_note = COALESCE($12, payment_note),
                remarks = COALESCE($13, remarks),
                source = COALESCE($14, source),
                payment_method = $15,
                room_rate = COALESCE($16, room_rate),
                subtotal = COALESCE($17, subtotal),
                total_amount = COALESCE($18, total_amount),
                rate_override_weekday = COALESCE($19, rate_override_weekday),
                rate_override_weekend = COALESCE($19, rate_override_weekend),
                special_requests = COALESCE($20, special_requests),
                is_tourist = $21,
                tourism_tax_amount = $22,
                extra_bed_count = COALESCE($23, extra_bed_count),
                extra_bed_charge = COALESCE($24, extra_bed_charge),
                daily_rates = COALESCE($25, daily_rates),
                cleaning_preference = COALESCE($26, cleaning_preference),
                actual_check_out = CASE WHEN $2 = 'checked_out' AND actual_check_out IS NULL THEN CURRENT_TIMESTAMP ELSE actual_check_out END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
            RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, payment_method, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, daily_rates, created_at, updated_at, post_type"#
        )
        .bind(new_room_id)
        .bind(&new_status)
        .bind(check_in)
        .bind(check_out)
        .bind(&post_type)
        .bind(&new_payment_status)
        .bind(booking_id)
        .bind(deposit_paid)
        .bind(deposit_amount)
        .bind(input.company_id)
        .bind(&input.company_name)
        .bind(&input.payment_note)
        .bind(&input.remarks)
        .bind(&input.source)
        .bind(&input.payment_method)
        .bind(new_room_rate)
        .bind(new_subtotal)
        .bind(new_total_amount)
        .bind(rate_override_decimal)
        .bind(&input.special_requests)
        .bind(canonical_is_tourist)
        .bind(canonical_tourism_tax_amount)
        .bind(input.extra_bed_count)
        .bind(input.extra_bed_charge.map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO)))
        .bind(&daily_rates_json)
        .bind(input.cleaning_preference)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    };

    let old_status = existing_booking.status.as_str();
    let updated_status = booking.status.as_str();

    if new_room_id != existing_booking.room_id {
        if let Err(e) =
            reconcile_room_status_after_booking_release(&pool, existing_booking.room_id, booking_id)
                .await
        {
            log::warn!(
                "Failed to reconcile old room {} after moving booking {}: {}",
                existing_booking.room_id,
                booking_id,
                e
            );
        }

        if updated_status == "confirmed" || updated_status == "pending" {
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let _ = sqlx::query("UPDATE rooms SET status = ?1 WHERE id = ?2")
                .bind("reserved")
                .bind(new_room_id)
                .execute(&pool)
                .await;
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let _ = sqlx::query("UPDATE rooms SET status = $1 WHERE id = $2")
                .bind("reserved")
                .bind(new_room_id)
                .execute(&pool)
                .await;
        }
    }

    if old_status != updated_status {
        record_booking_history(
            &pool,
            booking_id,
            Some(old_status),
            updated_status,
            Some(user_id),
            input.remarks.as_deref().or(input.payment_note.as_deref()),
            serde_json::json!({
                "room_id": booking.room_id,
                "payment_status": &booking.payment_status,
                "balance_affecting_total": booking.total_amount.to_string(),
            }),
        )
        .await;

        match updated_status {
            "voided" => {
                if let Err(e) =
                    reconcile_room_status_after_booking_release(&pool, new_room_id, booking_id)
                        .await
                {
                    log::warn!(
                        "Failed to reconcile room {} after voiding booking {}: {}",
                        new_room_id,
                        booking_id,
                        e
                    );
                }

                // Void all linked payments so they don't appear in night audit.
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let void_payments = sqlx::query(
                    "UPDATE payments SET status = 'void' WHERE booking_id = ?1 AND status != 'void'"
                )
                .bind(booking_id)
                .execute(&pool)
                .await;
                #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
                let void_payments = sqlx::query(
                    "UPDATE payments SET status = 'void' WHERE booking_id = $1 AND status != 'void'"
                )
                .bind(booking_id)
                .execute(&pool)
                .await;
                if let Err(e) = void_payments {
                    log::warn!(
                        "Failed to void payments for voided booking {}: {}",
                        booking_id,
                        e
                    );
                } else {
                    // Void payments no longer count toward total_paid —
                    // resync so the stored chip flips back to 'voided'/'unpaid'.
                    let _ = crate::handlers::payments::recompute_payment_status(&pool, booking_id)
                        .await;
                }
            }
            "checked_out" | "completed" => {
                // Always set room to 'dirty' on checkout - staff needs to clean before next guest
                // The upcoming reservation will be shown on the dirty room card
                log::info!(
                    "Setting room {} to dirty after checkout (booking {})",
                    new_room_id,
                    booking_id
                );
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let result = sqlx::query("UPDATE rooms SET status = 'dirty' WHERE id = ?1")
                    .bind(new_room_id)
                    .execute(&pool)
                    .await;
                #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
                let result = sqlx::query("UPDATE rooms SET status = 'dirty' WHERE id = $1")
                    .bind(new_room_id)
                    .execute(&pool)
                    .await;
                match result {
                    Ok(r) => log::info!(
                        "Room {} set to dirty, rows affected: {}",
                        new_room_id,
                        r.rows_affected()
                    ),
                    Err(e) => log::error!("Failed to set room {} to dirty: {}", new_room_id, e),
                }

                // Generate an invoice number for this checked-out booking. Best-effort:
                // failure here must not block the checkout itself.
                if let Err(e) = crate::services::payments::ensure_invoice_for_booking(
                    &pool, booking_id, user_id,
                )
                .await
                {
                    log::warn!(
                        "Failed to create invoice for checked-out booking {}: {}",
                        booking_id,
                        e
                    );
                }

                // Auto-post company room charges to customer_ledgers on checkout.
                //
                // Why: when a booking with company billing transitions to
                // checked_out, the receivable must land on the city ledger so
                // it shows on the company's account. Doing this server-side
                // ensures every checkout path (Bookings page, Rooms grid,
                // future paths) gets the same behavior — prior to this only
                // the Rooms-grid frontend handler created the row, so checkouts
                // initiated from the Bookings page silently skipped it.
                //
                // Idempotent: skip if a non-reversal room_charge row already
                // exists for this booking. Skip silently when company info is
                // missing or total_amount is non-positive.
                if let Some(co_name) = booking.company_name.as_deref()
                    && !co_name.trim().is_empty()
                    && booking.total_amount > rust_decimal::Decimal::ZERO
                    && let Err(e) = auto_post_company_ledger(
                        &pool, &booking, co_name, check_in, check_out, user_id,
                    )
                    .await
                {
                    log::warn!(
                        "Failed to auto-post company ledger for booking {}: {}",
                        booking_id,
                        e
                    );
                }
            }
            "checked_in" | "auto_checked_in" => {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let _ = sqlx::query("UPDATE rooms SET status = 'occupied' WHERE id = ?1")
                    .bind(new_room_id)
                    .execute(&pool)
                    .await;
                #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
                let _ = sqlx::query("UPDATE rooms SET status = 'occupied' WHERE id = $1")
                    .bind(new_room_id)
                    .execute(&pool)
                    .await;
            }
            _ => {}
        }

        // Back-fill night audit postings when a booking enters a "stayed" status.
        // Handles edits that advance a back-dated booking past a closed audit.
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        if matches!(
            updated_status,
            "checked_in" | "auto_checked_in" | "checked_out" | "late_checkout" | "completed"
        ) && let Err(e) =
            crate::services::night_audit::backfill_booking_posted_nights(&pool, booking_id, user_id)
                .await
        {
            log::warn!(
                "Failed to backfill posted nights for booking {}: {}",
                booking_id,
                e
            );
        }
    }

    // Sync customer_ledgers.amount when the booking total changes.
    //
    // Why: company-billing bookings auto-create a room-charge ledger row at
    // checkout (RoomManagementPage.handleCheckOut) using the booking's
    // total_amount at that moment. If the booking is later edited (dates,
    // daily_rates, rate override), the ledger row's amount drifts and the
    // ledger UI shows a balance that no longer matches the receipt. We apply
    // the delta — not the raw new total — so any extras already on the row
    // (e.g. late-checkout penalty) are preserved. Skip rows that are paid,
    // partial-with-too-much-already-paid, or void to respect DB
    // constraints (positive_amount, paid_amount <= amount).
    if let Some(new_total) = new_total_amount {
        let delta = new_total - existing_booking.total_amount;
        if !delta.is_zero() {
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let sync_res = sqlx::query(
                r#"UPDATE customer_ledgers
                    SET amount = amount + CAST(?1 AS REAL)
                  WHERE booking_id = ?2
                    AND status IN ('pending', 'partial')
                    AND post_type = 'room_charge'
                    AND amount + CAST(?1 AS REAL) > 0
                    AND amount + CAST(?1 AS REAL) >= paid_amount"#,
            )
            .bind(delta.to_string())
            .bind(booking_id)
            .execute(&pool)
            .await;

            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let sync_res = sqlx::query(
                r#"UPDATE customer_ledgers
                    SET amount = amount + $1
                  WHERE booking_id = $2
                    AND status IN ('pending', 'partial')
                    AND post_type = 'room_charge'
                    AND amount + $1 > 0
                    AND amount + $1 >= paid_amount"#,
            )
            .bind(delta)
            .bind(booking_id)
            .execute(&pool)
            .await;

            match sync_res {
                Ok(r) if r.rows_affected() > 0 => log::info!(
                    "Synced customer_ledgers.amount by delta {} on {} row(s) for booking {}",
                    delta,
                    r.rows_affected(),
                    booking_id
                ),
                Ok(_) => {}
                Err(e) => log::warn!(
                    "Failed to sync customer_ledgers.amount for booking {}: {}",
                    booking_id,
                    e
                ),
            }
        }
    }

    // Log booking update
    let changes = serde_json::json!({
        "room_id": if new_room_id != existing_booking.room_id { Some(new_room_id) } else { None },
        "status": if old_status != updated_status { Some(&new_status) } else { None },
        "check_in_date": &input.check_in_date,
        "check_out_date": &input.check_out_date,
        "payment_status": &input.payment_status,
    });
    let _ = AuditLog::log_booking_updated(&pool, user_id, booking.id, changes).await;

    // Record in booking_modifications audit trail
    let modification_type = if old_status != updated_status {
        "status_change"
    } else if new_room_rate.is_some() {
        "rate_change"
    } else if input.check_in_date.is_some() || input.check_out_date.is_some() {
        "date_change"
    } else if new_room_id != existing_booking.room_id {
        "room_change"
    } else {
        "general_update"
    };
    let old_value = serde_json::json!({
        "status": &existing_booking.status,
        "room_id": existing_booking.room_id,
        "room_rate": existing_booking.room_rate.to_string(),
        "check_in_date": existing_booking.check_in_date.to_string(),
        "check_out_date": existing_booking.check_out_date.to_string(),
        "payment_status": &existing_booking.payment_status,
        "total_amount": existing_booking.total_amount.to_string(),
    });
    let new_value = serde_json::json!({
        "status": &booking.status,
        "room_id": booking.room_id,
        "room_rate": booking.room_rate.to_string(),
        "check_in_date": booking.check_in_date.to_string(),
        "check_out_date": booking.check_out_date.to_string(),
        "payment_status": &booking.payment_status,
        "total_amount": booking.total_amount.to_string(),
    });
    let price_adj = new_total_amount
        .map(|t| t - existing_booking.total_amount)
        .unwrap_or(rust_decimal::Decimal::ZERO);
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, price_adjustment, modified_by) VALUES ($1, $2, $3, $4, $5, $6)"
    )
    .bind(booking_id)
    .bind(modification_type)
    .bind(&old_value)
    .bind(&new_value)
    .bind(crate::core::db::decimal_to_db(price_adj))
    .bind(user_id)
    .execute(&pool)
    .await
    .ok();

    // total_amount may have changed (rate override, dates, daily_rates rebuild,
    // tourism tax, extra bed) — re-derive payment_status against the unchanged
    // sum of completed payments so the chip reflects reality.
    let _ = crate::handlers::payments::recompute_payment_status(&pool, booking_id).await;

    Ok(Json(booking))
}

#[allow(dead_code)]
pub async fn delete_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let booking_row = booking_svc::fetch_booking_by_id(&pool, booking_id).await?;

    let guest_id: i64 = booking_row.guest_id;
    let room_id: i64 = booking_row.room_id;
    let status: String = booking_row.status.clone();
    let is_complimentary: Option<bool> = booking_row.is_complimentary;
    let check_in_date: NaiveDate = booking_row.check_in_date;
    let check_out_date: NaiveDate = booking_row.check_out_date;

    let has_booking_delete = AuthService::check_permission(&pool, user_id, "bookings:delete")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let owns_booking: bool = sqlx::query_scalar::<_, i32>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = ?1 AND ug.guest_id = ?2)",
    )
    .bind(user_id)
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .map(|v| v != 0)
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let owns_booking: bool = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2)",
    )
    .bind(user_id)
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_booking_delete && !owns_booking {
        return Err(ApiError::Forbidden(
            "You don't have permission to delete this booking".to_string(),
        ));
    }

    if status == "voided" {
        return Err(ApiError::BadRequest(
            "Booking is already voided".to_string(),
        ));
    }

    if matches!(status.as_str(), "checked_out" | "completed") {
        return Err(ApiError::BadRequest(format!(
            "Cannot void booking with status: {}",
            status
        )));
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_booking_query = r#"
        UPDATE bookings
        SET status = 'voided',
            updated_at = datetime('now'),
            cancelled_at = datetime('now'),
            cancelled_by = ?2
        WHERE id = ?1
          AND status != 'voided'
          AND status NOT IN ('checked_out', 'completed')
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_booking_query = r#"
        UPDATE bookings
        SET status = 'voided',
            updated_at = CURRENT_TIMESTAMP,
            cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by = $2
        WHERE id = $1
          AND status != 'voided'
          AND status NOT IN ('checked_out', 'completed')
    "#;

    let result = sqlx::query(update_booking_query)
        .bind(booking_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() != 1 {
        return Err(ApiError::BadRequest("Booking cannot be voided".to_string()));
    }

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_room_query = "UPDATE rooms SET status = 'available' WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_room_query = "UPDATE rooms SET status = 'available' WHERE id = $1";

    sqlx::query(update_room_query)
        .bind(room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let void_payments_query =
        "UPDATE payments SET status = 'void' WHERE booking_id = ?1 AND status != 'void'";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let void_payments_query =
        "UPDATE payments SET status = 'void' WHERE booking_id = $1 AND status != 'void'";

    sqlx::query(void_payments_query)
        .bind(booking_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    payments::recompute_payment_status_tx(&mut tx, booking_id).await?;

    // If the booking was complimentary, convert the nights to room-type specific credits.
    let mut nights_credited = 0;
    if is_complimentary == Some(true) {
        let nights = (check_out_date - check_in_date).num_days().max(0) as i32;

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let room_type_query = "SELECT room_type_id FROM rooms WHERE id = ?1";
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let room_type_query = "SELECT room_type_id FROM rooms WHERE id = $1";

        let room_type_id: Option<i64> = sqlx::query_scalar(room_type_query)
            .bind(room_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
            .flatten();

        if let Some(rt_id) = room_type_id {
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let credit_query = r#"
                INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at, updated_at)
                VALUES (?1, ?2, ?3, 'Refunded from voided complimentary booking', datetime('now'), datetime('now'))
                ON CONFLICT (guest_id, room_type_id)
                DO UPDATE SET nights_available = guest_complimentary_credits.nights_available + ?3,
                              updated_at = datetime('now')
            "#;
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let credit_query = r#"
                INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at, updated_at)
                VALUES ($1, $2, $3, 'Refunded from voided complimentary booking', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (guest_id, room_type_id)
                DO UPDATE SET nights_available = guest_complimentary_credits.nights_available + $3,
                              updated_at = CURRENT_TIMESTAMP
            "#;

            sqlx::query(credit_query)
                .bind(guest_id)
                .bind(rt_id)
                .bind(nights)
                .execute(&mut *tx)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;
            nights_credited = nights;
        }
    }

    AuditLog::log_booking_voided_tx(&mut tx, user_id, booking_id).await?;
    record_booking_history_tx(
        &mut tx,
        booking_id,
        Some(&status),
        "voided",
        Some(user_id),
        Some("Booking voided"),
        serde_json::json!({
            "room_id": room_id,
            "guest_id": guest_id,
            "check_in_date": check_in_date.to_string(),
            "check_out_date": check_out_date.to_string(),
        }),
    )
    .await?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
    .bind(booking_id)
    .bind("voided")
    .bind(serde_json::json!({
        "status": &status,
        "check_in_date": check_in_date.to_string(),
        "check_out_date": check_out_date.to_string()
    }).to_string())
    .bind(serde_json::json!({"status": "voided"}).to_string())
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(booking_id)
    .bind("voided")
    .bind(serde_json::json!({
        "status": &status,
        "check_in_date": check_in_date.to_string(),
        "check_out_date": check_out_date.to_string()
    }))
    .bind(serde_json::json!({"status": "voided"}))
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await.map_err(ApiError::from)?;

    Ok(Json(serde_json::json!({
        "message": "Booking voided successfully",
        "booking_id": booking_id,
        "complimentary_nights_credited": nights_credited
    })))
}

#[allow(dead_code)]
pub async fn manual_checkin_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(checkin_data): Json<Option<CheckInRequest>>,
) -> Result<Json<Booking>, ApiError> {
    let booking = booking_svc::fetch_booking_by_id(&pool, booking_id).await?;

    let has_checkin_permission = AuthService::check_permission(&pool, user_id, "bookings:update")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    let created_booking = booking.created_by == Some(user_id);

    if !has_checkin_permission && !created_booking {
        return Err(ApiError::Unauthorized(
            "You don't have permission to check in this booking".to_string(),
        ));
    }

    if booking.status != "confirmed" && booking.status != "pending" {
        return Err(ApiError::BadRequest(format!(
            "Cannot check in booking with status: {}",
            booking.status
        )));
    }

    // Check if room is ready for check-in (only block maintenance/out_of_order)
    // Note: Dirty/cleaning rooms are allowed for check-in - room will be set to occupied
    let room_status: Option<String> = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
        .bind(booking.room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if let Some(status) = room_status
        && (status == "maintenance" || status == "out_of_order")
    {
        return Err(ApiError::BadRequest(format!(
            "Cannot check in - room is currently under {}.",
            status.replace("_", " ")
        )));
    }

    if let Some(ref checkin) = checkin_data
        && let Some(ref guest_update) = checkin.guest_update
    {
        let mut updates = vec!["updated_at = CURRENT_TIMESTAMP".to_string()];
        let mut params: Vec<String> = vec![];

        if let Some(ref v) = guest_update.first_name {
            updates.push(format!("first_name = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.last_name {
            updates.push(format!("last_name = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.email {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                // Set to NULL for empty email
                updates.push("email = NULL".to_string());
            } else {
                // Validate email format before updating
                let email_regex =
                    regex::Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
                if email_regex.is_match(trimmed) {
                    updates.push(format!("email = ${}", params.len() + 1));
                    params.push(trimmed.to_string());
                }
                // Invalid email format - skip the update silently
            }
        }
        if let Some(ref v) = guest_update.phone {
            updates.push(format!("phone = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.ic_number {
            updates.push(format!("ic_number = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.nationality {
            updates.push(format!("nationality = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.address_line1 {
            updates.push(format!("address_line1 = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.city {
            updates.push(format!("city = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.state_province {
            updates.push(format!("state_province = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.postal_code {
            updates.push(format!("postal_code = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = guest_update.country {
            updates.push(format!("country = ${}", params.len() + 1));
            params.push(v.clone());
        }

        if !params.is_empty() {
            let query = format!(
                "UPDATE guests SET {} WHERE id = ${}",
                updates.join(", "),
                params.len() + 1
            );
            let mut q = sqlx::query(&query);
            for p in &params {
                q = q.bind(p);
            }
            q = q.bind(booking.guest_id);
            if let Err(e) = q.execute(&pool).await {
                log::warn!(
                    "Failed to update guest {} during check-in: {}",
                    booking.guest_id,
                    e
                );
            }
        }
    }

    // Apply booking_update fields if provided (market_code, payment_method, special_requests, etc.)
    if let Some(ref checkin) = checkin_data
        && let Some(ref booking_update) = checkin.booking_update
    {
        let mut updates = vec![];
        let mut params: Vec<String> = vec![];

        if let Some(ref v) = booking_update.market_code {
            updates.push(format!("market_code = ${}", params.len() + 1));
            params.push(v.clone());
        }
        // Note: rate_code column does not exist in bookings table - skip it
        if let Some(ref v) = booking_update.payment_method {
            updates.push(format!("payment_method = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = booking_update.special_requests {
            updates.push(format!("special_requests = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = booking_update.remarks {
            updates.push(format!("remarks = ${}", params.len() + 1));
            params.push(v.clone());
        }
        if let Some(ref v) = booking_update.company_name {
            updates.push(format!("company_name = ${}", params.len() + 1));
            params.push(v.clone());
        }

        if !params.is_empty() {
            let query = format!(
                "UPDATE bookings SET {} WHERE id = ${}",
                updates.join(", "),
                params.len() + 1
            );
            let mut q = sqlx::query(&query);
            for p in &params {
                q = q.bind(p);
            }
            q = q.bind(booking_id);
            if let Err(e) = q.execute(&pool).await {
                log::warn!(
                    "Failed to update booking {} fields during check-in: {}",
                    booking_id,
                    e
                );
            }
        }
    }

    let updated_booking: Booking = sqlx::query_as(
        r#"
        UPDATE bookings SET status = 'checked_in', actual_check_in = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1
        RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, payment_method, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, daily_rates, created_at, updated_at
        "#
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Record payment if provided during check-in
    if let Some(ref checkin) = checkin_data
        && let Some(ref payment) = checkin.payment_record
        && payment.amount > 0.0
    {
        let pay_amount = Decimal::from_f64_retain(payment.amount).unwrap_or(Decimal::ZERO);
        let pay_type = payment.payment_type.as_deref().unwrap_or("booking");
        if let Err(e) = sqlx::query(
                    r#"INSERT INTO payments (uuid, booking_id, amount, payment_method, payment_type, status, notes, created_by)
                       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'completed', $5, $6)"#
                )
                .bind(booking_id)
                .bind(crate::core::db::decimal_to_db(pay_amount))
                .bind(&payment.payment_method)
                .bind(pay_type)
                .bind(&payment.notes)
                .bind(user_id)
                .execute(&pool)
                .await
                {
                    log::warn!("Failed to record check-in payment for booking {}: {}", booking_id, e);
                } else {
                    let _ = crate::handlers::payments::recompute_payment_status(
                        &pool, booking_id,
                    )
                    .await;
                }
    }

    // Only update room status for current/future bookings (skip back-dated)
    let today = chrono::Local::now().date_naive();
    if booking.check_out_date >= today
        && let Err(e) = sqlx::query("UPDATE rooms SET status = 'occupied' WHERE id = $1")
            .bind(booking.room_id)
            .execute(&pool)
            .await
    {
        log::warn!(
            "Failed to update room {} to occupied during check-in: {}",
            booking.room_id,
            e
        );
    }

    // Back-fill night audit postings for any past nights whose audit already closed.
    // Covers same-day walk-ins created after their own 00:00 audit ran.
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    if let Err(e) =
        crate::services::night_audit::backfill_booking_posted_nights(&pool, booking_id, user_id)
            .await
    {
        log::warn!(
            "Failed to backfill posted nights for booking {}: {}",
            booking_id,
            e
        );
    }

    // Log check-in
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "booking_checkin",
        "booking",
        Some(booking_id),
        Some(serde_json::json!({"guest_id": booking.guest_id, "room_id": booking.room_id})),
        None,
        None,
    )
    .await;
    record_booking_history(
        &pool,
        booking_id,
        Some(&booking.status),
        "checked_in",
        Some(user_id),
        Some("Guest checked in"),
        serde_json::json!({
            "guest_id": booking.guest_id,
            "room_id": booking.room_id,
            "payment_recorded": checkin_data
                .as_ref()
                .and_then(|data| data.payment_record.as_ref())
                .map(|p| p.amount)
                .unwrap_or(0.0),
        }),
    )
    .await;

    // Record in booking_modifications audit trail
    if let Err(e) = sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(booking_id)
    .bind("check_in")
    .bind(serde_json::json!({"status": &booking.status, "guest_id": booking.guest_id, "room_id": booking.room_id}))
    .bind(serde_json::json!({"status": "checked_in", "guest_id": booking.guest_id, "room_id": booking.room_id}))
    .bind(user_id)
    .execute(&pool)
    .await
    {
        log::warn!("Failed to record check-in audit trail for booking {}: {}", booking_id, e);
    }

    Ok(Json(updated_booking))
}

pub async fn pre_checkin_update_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
    Json(update_data): Json<PreCheckInUpdateRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let booking_row = sqlx::query("SELECT id, guest_id, status FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest_id: i64 = booking_row.get(1);
    let status: String = booking_row.get(2);

    if status != "pending" && status != "confirmed" {
        return Err(ApiError::BadRequest(format!(
            "Cannot pre-check-in booking with status: {}",
            status
        )));
    }

    let first_name = update_data.guest_update.first_name.as_deref().unwrap_or("");
    let last_name = update_data.guest_update.last_name.as_deref().unwrap_or("");

    // Normalize email: empty string becomes None, validate format if present
    let email: Option<String> = match &update_data.guest_update.email {
        Some(e) if e.trim().is_empty() => None,
        Some(e) => {
            let trimmed = e.trim();
            let email_regex =
                regex::Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
            if email_regex.is_match(trimmed) {
                Some(trimmed.to_string())
            } else {
                None // Invalid format, set to NULL
            }
        }
        None => None,
    };

    sqlx::query(
        r#"
        UPDATE guests
        SET first_name = $1, last_name = $2, email = $3, phone = $4, ic_number = $5, nationality = $6,
            address_line1 = $7, city = $8, state_province = $9, postal_code = $10, country = $11,
            title = $12, alt_phone = $13, updated_at = CURRENT_TIMESTAMP
        WHERE id = $14
        "#
    )
    .bind(first_name)
    .bind(last_name)
    .bind(&email)
    .bind(&update_data.guest_update.phone)
    .bind(&update_data.guest_update.ic_number)
    .bind(&update_data.guest_update.nationality)
    .bind(&update_data.guest_update.address_line1)
    .bind(&update_data.guest_update.city)
    .bind(&update_data.guest_update.state_province)
    .bind(&update_data.guest_update.postal_code)
    .bind(&update_data.guest_update.country)
    .bind(&update_data.guest_update.title)
    .bind(&update_data.guest_update.alt_phone)
    .bind(guest_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        "UPDATE bookings SET market_code = $1, pre_checkin_completed = true, pre_checkin_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2"
    )
    .bind(&update_data.market_code)
    .bind(booking_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Pre-check-in information updated successfully"
    })))
}

/// Reactivate a voided booking
/// Changes status from 'voided' to 'confirmed' and reserves the room
#[allow(dead_code)]
pub async fn reactivate_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Booking>, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let existing_query = "SELECT id, guest_id, room_id, status, check_in_date, check_out_date FROM bookings WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let existing_query = "SELECT id, guest_id, room_id, status, check_in_date, check_out_date FROM bookings WHERE id = $1";

    let existing_row = sqlx::query(existing_query)
        .bind(booking_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest_id: i64 = existing_row.get("guest_id");
    let room_id: i64 = existing_row.get("room_id");
    let status: String = existing_row.get("status");
    let check_in: NaiveDate = existing_row.get("check_in_date");
    let check_out: NaiveDate = existing_row.get("check_out_date");

    if status != "voided" {
        return Err(ApiError::BadRequest(format!(
            "Cannot reactivate booking with status: {}. Only voided bookings can be reactivated.",
            status
        )));
    }

    // Check permissions
    let has_booking_update = AuthService::check_permission(&pool, user_id, "bookings:update")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    if !has_booking_update {
        return Err(ApiError::Forbidden(
            "You don't have permission to reactivate this booking".to_string(),
        ));
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = ?1
              AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending')
              AND status != 'voided'
              AND id != ?4
              AND ((check_in_date <= ?2 AND check_out_date > ?2)
                  OR (check_in_date < ?3 AND check_out_date >= ?3)
                  OR (check_in_date >= ?2 AND check_out_date <= ?3))
        )
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1
              AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending')
              AND status != 'voided'
              AND id != $4
              AND ((check_in_date <= $2 AND check_out_date > $2)
                  OR (check_in_date < $3 AND check_out_date >= $3)
                  OR (check_in_date >= $2 AND check_out_date <= $3))
        )
    "#;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let conflict: bool = sqlx::query_scalar::<_, i32>(conflict_query)
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(booking_id)
        .fetch_one(&mut *tx)
        .await
        .map(|v| v != 0)
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let conflict: bool = sqlx::query_scalar::<_, bool>(conflict_query)
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(booking_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if conflict {
        return Err(ApiError::BadRequest(
            "Cannot reactivate booking - room is already booked for these dates".to_string(),
        ));
    }

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let reactivate_query = r#"
        UPDATE bookings
        SET status = 'confirmed',
            updated_at = datetime('now'),
            booking_remarks = COALESCE(booking_remarks, '') || ' | Reactivated from voided status'
        WHERE id = ?1
          AND status = 'voided'
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let reactivate_query = r#"
        UPDATE bookings
        SET status = 'confirmed',
            updated_at = CURRENT_TIMESTAMP,
            remarks = COALESCE(remarks, '') || ' | Reactivated from voided status'
        WHERE id = $1
          AND status = 'voided'
    "#;

    let result = sqlx::query(reactivate_query)
        .bind(booking_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() != 1 {
        return Err(ApiError::BadRequest(
            "Booking cannot be reactivated".to_string(),
        ));
    }

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_room_query = "UPDATE rooms SET status = ?1 WHERE id = ?2";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_room_query = "UPDATE rooms SET status = $1 WHERE id = $2";

    sqlx::query(update_room_query)
        .bind("reserved")
        .bind(room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    AuditLog::log_event_tx(
        &mut tx,
        Some(user_id),
        "booking_reactivated",
        "booking",
        Some(booking_id),
        Some(serde_json::json!({"guest_id": guest_id, "room_id": room_id, "previous_status": "voided"})),
        None,
        None,
    )
    .await?;
    record_booking_history_tx(
        &mut tx,
        booking_id,
        Some("voided"),
        "confirmed",
        Some(user_id),
        Some("Booking reactivated"),
        serde_json::json!({
            "guest_id": guest_id,
            "room_id": room_id,
            "check_in_date": check_in.to_string(),
            "check_out_date": check_out.to_string(),
        }),
    )
    .await?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
    .bind(booking_id)
    .bind("reactivation")
    .bind(serde_json::json!({"status": "voided"}).to_string())
    .bind(serde_json::json!({"status": "confirmed"}).to_string())
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(booking_id)
    .bind("reactivation")
    .bind(serde_json::json!({"status": "voided"}))
    .bind(serde_json::json!({"status": "confirmed"}))
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await.map_err(ApiError::from)?;

    let booking = booking_svc::fetch_booking_by_id(&pool, booking_id).await?;

    Ok(Json(booking))
}

pub async fn user_owns_booking(
    pool: &DbPool,
    user_id: i64,
    guest_id: i64,
) -> Result<bool, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let query =
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = ?1 AND ug.guest_id = ?2)";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let query =
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2)";

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let owns_booking = sqlx::query_scalar::<_, i32>(query)
        .bind(user_id)
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map(|value| value != 0)
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let owns_booking = sqlx::query_scalar::<_, bool>(query)
        .bind(user_id)
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(owns_booking)
}

pub async fn void_booking_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
    user_id: i64,
) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_booking_query = r#"
        UPDATE bookings
        SET status = 'voided',
            updated_at = datetime('now'),
            cancelled_at = datetime('now'),
            cancelled_by = ?2
        WHERE id = ?1
          AND status != 'voided'
          AND status NOT IN ('checked_out', 'completed')
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_booking_query = r#"
        UPDATE bookings
        SET status = 'voided',
            updated_at = CURRENT_TIMESTAMP,
            cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by = $2
        WHERE id = $1
          AND status != 'voided'
          AND status NOT IN ('checked_out', 'completed')
    "#;

    let result = sqlx::query(update_booking_query)
        .bind(booking_id)
        .bind(user_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() != 1 {
        return Err(ApiError::BadRequest("Booking cannot be voided".to_string()));
    }

    Ok(())
}

pub async fn release_room_tx(tx: &mut DbTransaction<'_>, room_id: i64) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_room_query = "UPDATE rooms SET status = 'available' WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_room_query = "UPDATE rooms SET status = 'available' WHERE id = $1";

    sqlx::query(update_room_query)
        .bind(room_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

pub async fn void_booking_payments_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let void_payments_query =
        "UPDATE payments SET status = 'void' WHERE booking_id = ?1 AND status != 'void'";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let void_payments_query =
        "UPDATE payments SET status = 'void' WHERE booking_id = $1 AND status != 'void'";

    sqlx::query(void_payments_query)
        .bind(booking_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

pub async fn restore_complimentary_credits_tx(
    tx: &mut DbTransaction<'_>,
    booking: &Booking,
) -> Result<i32, ApiError> {
    let mut nights_credited = 0;
    if booking.is_complimentary == Some(true) {
        let nights = (booking.check_out_date - booking.check_in_date)
            .num_days()
            .max(0) as i32;

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let room_type_query = "SELECT room_type_id FROM rooms WHERE id = ?1";
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let room_type_query = "SELECT room_type_id FROM rooms WHERE id = $1";

        let room_type_id: Option<i64> = sqlx::query_scalar(room_type_query)
            .bind(booking.room_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
            .flatten();

        if let Some(room_type_id) = room_type_id {
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let credit_query = r#"
                INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at, updated_at)
                VALUES (?1, ?2, ?3, 'Refunded from voided complimentary booking', datetime('now'), datetime('now'))
                ON CONFLICT (guest_id, room_type_id)
                DO UPDATE SET nights_available = guest_complimentary_credits.nights_available + ?3,
                              updated_at = datetime('now')
            "#;
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let credit_query = r#"
                INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at, updated_at)
                VALUES ($1, $2, $3, 'Refunded from voided complimentary booking', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (guest_id, room_type_id)
                DO UPDATE SET nights_available = guest_complimentary_credits.nights_available + $3,
                              updated_at = CURRENT_TIMESTAMP
            "#;

            sqlx::query(credit_query)
                .bind(booking.guest_id)
                .bind(room_type_id)
                .bind(nights)
                .execute(&mut **tx)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

            nights_credited = nights;
        }
    }

    Ok(nights_credited)
}

pub async fn record_booking_void_modification_tx(
    tx: &mut DbTransaction<'_>,
    booking: &Booking,
    user_id: i64,
) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
    .bind(booking.id)
    .bind("voided")
    .bind(serde_json::json!({
        "status": &booking.status,
        "check_in_date": booking.check_in_date.to_string(),
        "check_out_date": booking.check_out_date.to_string()
    }).to_string())
    .bind(serde_json::json!({"status": "voided"}).to_string())
    .bind(user_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(booking.id)
    .bind("voided")
    .bind(serde_json::json!({
        "status": &booking.status,
        "check_in_date": booking.check_in_date.to_string(),
        "check_out_date": booking.check_out_date.to_string()
    }))
    .bind(serde_json::json!({"status": "voided"}))
    .bind(user_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Manual check-in: transaction-scoped helpers
//
// Each helper runs on the caller's transaction so the whole check-in commits
// atomically (see `services::bookings::manual_checkin`). The core transition
// (`checkin_booking_tx`) is guarded by `status IN ('confirmed','pending')` and
// requires exactly one affected row, so a concurrent check-in cannot win twice.
// ---------------------------------------------------------------------------

/// Read a room's current status on the check-in transaction (used to block
/// check-in into a room under maintenance / out of order).
pub async fn fetch_room_status_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
) -> Result<Option<String>, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let query = "SELECT status FROM rooms WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let query = "SELECT status FROM rooms WHERE id = $1";

    sqlx::query_scalar(query)
        .bind(room_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
}

/// Apply optional guest-profile edits supplied at check-in. PostgreSQL-flavoured
/// dynamic update (the column set is variable). No-op when nothing changes.
pub async fn apply_guest_update_tx(
    tx: &mut DbTransaction<'_>,
    guest_id: i64,
    guest_update: &GuestUpdateInput,
) -> Result<(), ApiError> {
    let mut updates = vec!["updated_at = CURRENT_TIMESTAMP".to_string()];
    let mut params: Vec<String> = vec![];

    if let Some(ref v) = guest_update.first_name {
        updates.push(format!("first_name = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.last_name {
        updates.push(format!("last_name = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.email {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            updates.push("email = NULL".to_string());
        } else {
            let email_regex =
                regex::Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
            if email_regex.is_match(trimmed) {
                updates.push(format!("email = ${}", params.len() + 1));
                params.push(trimmed.to_string());
            }
            // POLICY: an optional, malformed email on the check-in guest patch is
            // intentionally ignored (the rest of the check-in still proceeds) — a
            // front-desk typo must not block a guest's arrival. This is distinct
            // from required-field validation, which rejects up front. An empty
            // string clears the email to NULL; a well-formed value updates it.
        }
    }
    if let Some(ref v) = guest_update.phone {
        updates.push(format!("phone = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.ic_number {
        updates.push(format!("ic_number = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.nationality {
        updates.push(format!("nationality = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.address_line1 {
        updates.push(format!("address_line1 = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.city {
        updates.push(format!("city = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.state_province {
        updates.push(format!("state_province = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.postal_code {
        updates.push(format!("postal_code = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = guest_update.country {
        updates.push(format!("country = ${}", params.len() + 1));
        params.push(v.clone());
    }

    // Only the timestamp bump means no real field change was requested.
    if params.is_empty() {
        return Ok(());
    }

    let query = format!(
        "UPDATE guests SET {} WHERE id = ${}",
        updates.join(", "),
        params.len() + 1
    );
    let mut q = sqlx::query(&query);
    for p in &params {
        q = q.bind(p);
    }
    q = q.bind(guest_id);
    q.execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

/// Apply optional booking-level edits supplied at check-in (market code,
/// payment method, requests, remarks, company). PostgreSQL-flavoured dynamic
/// update. No-op when nothing changes.
pub async fn apply_booking_field_update_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
    booking_update: &BookingUpdateInput,
) -> Result<(), ApiError> {
    let mut updates: Vec<String> = vec![];
    let mut params: Vec<String> = vec![];

    if let Some(ref v) = booking_update.market_code {
        updates.push(format!("market_code = ${}", params.len() + 1));
        params.push(v.clone());
    }
    // Note: rate_code column does not exist in bookings table - skip it.
    if let Some(ref v) = booking_update.payment_method {
        updates.push(format!("payment_method = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = booking_update.special_requests {
        updates.push(format!("special_requests = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = booking_update.remarks {
        updates.push(format!("remarks = ${}", params.len() + 1));
        params.push(v.clone());
    }
    if let Some(ref v) = booking_update.company_name {
        updates.push(format!("company_name = ${}", params.len() + 1));
        params.push(v.clone());
    }

    if params.is_empty() {
        return Ok(());
    }

    let query = format!(
        "UPDATE bookings SET {} WHERE id = ${}",
        updates.join(", "),
        params.len() + 1
    );
    let mut q = sqlx::query(&query);
    for p in &params {
        q = q.bind(p);
    }
    q = q.bind(booking_id);
    q.execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

/// Atomically transition a booking to `checked_in`, stamping the actual
/// check-in timestamp. Guarded by `status IN ('confirmed','pending')` and
/// requires exactly one affected row, so a concurrent check-in (or any other
/// transition that already moved the row) collapses to a clean `BadRequest`
/// instead of a double check-in. Returns the refreshed booking row.
pub async fn checkin_booking_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<Booking, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_query = r#"
        UPDATE bookings
        SET status = 'checked_in',
            actual_check_in = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?1
          AND status IN ('confirmed', 'pending')
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_query = r#"
        UPDATE bookings
        SET status = 'checked_in',
            actual_check_in = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status IN ('confirmed', 'pending')
    "#;

    let result = sqlx::query(update_query)
        .bind(booking_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() != 1 {
        return Err(ApiError::BadRequest(
            "Booking cannot be checked in".to_string(),
        ));
    }

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let select_query = "SELECT * FROM bookings WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let select_query = "SELECT * FROM bookings WHERE id = $1";

    let row = sqlx::query(select_query)
        .bind(booking_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row_mappers::row_to_booking(&row))
}

/// Record an optional payment captured during check-in.
pub async fn record_checkin_payment_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
    payment: &CheckInPaymentRecord,
    user_id: i64,
) -> Result<(), ApiError> {
    let pay_amount = Decimal::from_f64_retain(payment.amount).unwrap_or(Decimal::ZERO);
    let pay_type = payment.payment_type.as_deref().unwrap_or("booking");

    // The two schemas diverge: PostgreSQL keys payments by `uuid` + `created_by`
    // and stores free text in `notes`; SQLite uses `payment_number` + `processed_by`
    // and `description`. The bind order is identical — only the column list differs.
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let insert_query = r#"
        INSERT INTO payments (payment_number, booking_id, amount, payment_method, payment_type, status, description, processed_by)
        VALUES (?1, ?2, ?3, ?4, ?5, 'completed', ?6, ?7)
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let insert_query = r#"
        INSERT INTO payments (uuid, booking_id, amount, payment_method, payment_type, status, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7)
    "#;

    sqlx::query(insert_query)
        .bind(crate::core::db::generate_uuid())
        .bind(booking_id)
        .bind(decimal_to_db(pay_amount))
        .bind(&payment.payment_method)
        .bind(pay_type)
        .bind(&payment.notes)
        .bind(user_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

/// Set the room to `occupied` as part of check-in.
pub async fn set_room_occupied_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let query = "UPDATE rooms SET status = 'occupied' WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let query = "UPDATE rooms SET status = 'occupied' WHERE id = $1";

    sqlx::query(query)
        .bind(room_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

/// Record the check-in in the `booking_modifications` audit trail.
pub async fn record_checkin_modification_tx(
    tx: &mut DbTransaction<'_>,
    booking: &Booking,
    user_id: i64,
) -> Result<(), ApiError> {
    let old_value = serde_json::json!({
        "status": &booking.status,
        "guest_id": booking.guest_id,
        "room_id": booking.room_id,
    });
    let new_value = serde_json::json!({
        "status": "checked_in",
        "guest_id": booking.guest_id,
        "room_id": booking.room_id,
    });

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
    .bind(booking.id)
    .bind("check_in")
    .bind(old_value.to_string())
    .bind(new_value.to_string())
    .bind(user_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(booking.id)
    .bind("check_in")
    .bind(old_value)
    .bind(new_value)
    .bind(user_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

#[derive(Debug, Clone)]
pub struct BookingReactivationCandidate {
    pub guest_id: i64,
    pub room_id: i64,
    pub status: String,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
}

pub async fn find_reactivation_candidate(
    pool: &DbPool,
    booking_id: i64,
) -> Result<BookingReactivationCandidate, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let query = "SELECT guest_id, room_id, status, check_in_date, check_out_date FROM bookings WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let query = "SELECT guest_id, room_id, status, check_in_date, check_out_date FROM bookings WHERE id = $1";

    let row = sqlx::query(query)
        .bind(booking_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    Ok(BookingReactivationCandidate {
        guest_id: row.get("guest_id"),
        room_id: row.get("room_id"),
        status: row.get("status"),
        check_in: row.get("check_in_date"),
        check_out: row.get("check_out_date"),
    })
}

pub async fn has_reactivation_conflict(
    pool: &DbPool,
    booking_id: i64,
    room_id: i64,
    check_in: NaiveDate,
    check_out: NaiveDate,
) -> Result<bool, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = ?1
              AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending')
              AND status != 'voided'
              AND id != ?4
              AND ((check_in_date <= ?2 AND check_out_date > ?2)
                  OR (check_in_date < ?3 AND check_out_date >= ?3)
                  OR (check_in_date >= ?2 AND check_out_date <= ?3))
        )
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1
              AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending')
              AND status != 'voided'
              AND id != $4
              AND ((check_in_date <= $2 AND check_out_date > $2)
                  OR (check_in_date < $3 AND check_out_date >= $3)
                  OR (check_in_date >= $2 AND check_out_date <= $3))
        )
    "#;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let conflict = sqlx::query_scalar::<_, i32>(conflict_query)
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .map(|value| value != 0)
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let conflict = sqlx::query_scalar::<_, bool>(conflict_query)
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(conflict)
}

pub async fn confirm_reactivated_booking_and_reserve_room(
    pool: &DbPool,
    booking_id: i64,
    room_id: i64,
) -> Result<Booking, ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_booking_query = r#"
        UPDATE bookings
        SET status = 'confirmed',
            updated_at = datetime('now'),
            booking_remarks = COALESCE(booking_remarks, '') || ' | Reactivated from voided status'
        WHERE id = ?1 AND status = 'voided'
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_booking_query = r#"
        UPDATE bookings
        SET status = 'confirmed',
            updated_at = CURRENT_TIMESTAMP,
            remarks = COALESCE(remarks, '') || ' | Reactivated from voided status'
        WHERE id = $1 AND status = 'voided'
    "#;

    let result = sqlx::query(update_booking_query)
        .bind(booking_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() != 1 {
        return Err(ApiError::BadRequest(
            "Booking is no longer voided and cannot be reactivated".to_string(),
        ));
    }

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let update_room_query = "UPDATE rooms SET status = ?1 WHERE id = ?2";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let update_room_query = "UPDATE rooms SET status = $1 WHERE id = $2";

    sqlx::query(update_room_query)
        .bind("reserved")
        .bind(room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let select_booking_query = "SELECT * FROM bookings WHERE id = ?1";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let select_booking_query = "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, \
        room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, \
        payment_method, adults, children, special_requests, remarks, source, market_code, \
        discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, \
        pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, \
        is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, \
        original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, \
        company_id, company_name, payment_note, daily_rates, created_at, updated_at, post_type \
        FROM bookings WHERE id = $1";

    let booking_row = sqlx::query(select_booking_query)
        .bind(booking_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let booking = row_mappers::row_to_booking(&booking_row);

    tx.commit().await.map_err(ApiError::from)?;

    Ok(booking)
}

pub async fn record_booking_reactivation_modification(
    pool: &DbPool,
    booking_id: i64,
    user_id: i64,
) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let result = sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
    .bind(booking_id)
    .bind("reactivation")
    .bind(serde_json::json!({"status": "voided"}).to_string())
    .bind(serde_json::json!({"status": "confirmed"}).to_string())
    .bind(user_id)
    .execute(pool)
    .await;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let result = sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(booking_id)
    .bind("reactivation")
    .bind(serde_json::json!({"status": "voided"}))
    .bind(serde_json::json!({"status": "confirmed"}))
    .bind(user_id)
    .execute(pool)
    .await;

    result.map_err(|e| ApiError::Database(e.to_string()))?;
    Ok(())
}
