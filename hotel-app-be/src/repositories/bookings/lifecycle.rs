//! Booking lifecycle handlers (CRUD, check-in/out, status
//! transitions) plus their shared private helpers.

use crate::core::auth::AuthService;
use crate::core::db::{DbPool, DbTransaction, decimal_to_db, hotel_today};
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::core::settings_cache;
use crate::models::*;
use crate::repositories::booking::BookingRepository;
use crate::repositories::bookings_queries::*;
use crate::services::audit::AuditLog;
use crate::services::booking as booking_svc;
use crate::services::payments;
use crate::utils::date::{parse_date_flexible, parse_datetime_flexible};
use crate::utils::pagination::normalize_pagination;
use crate::utils::sanitization::Sanitizer;
use axum::{
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Json,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use rust_decimal::Decimal;
use sqlx::Row;

fn sanitize_ota_reference(value: Option<&str>) -> Option<String> {
    value.and_then(|raw| {
        let sanitized = Sanitizer::sanitize_text(raw);
        let trimmed = sanitized.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.chars().take(100).collect())
        }
    })
}

pub async fn record_booking_history(
    pool: &DbPool,
    booking_id: i64,
    previous_status: Option<&str>,
    new_status: &str,
    changed_by: Option<i64>,
    change_reason: Option<&str>,
    metadata: serde_json::Value,
) {
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

/// Details recorded when a guest completes self check-in.
pub struct SelfCheckinEventValues<'a> {
    pub booking_id: i64,
    pub guest_id: i64,
    pub ekyc_verification_id: i64,
    pub user_id: i64,
    pub source: &'a str,
    pub device_type: Option<&'a String>,
    pub checkin_location: Option<&'a String>,
}

pub async fn record_self_checkin_event_tx(
    tx: &mut DbTransaction<'_>,
    values: SelfCheckinEventValues<'_>,
) -> Result<DateTime<Utc>, ApiError> {
    let SelfCheckinEventValues {
        booking_id,
        guest_id,
        ekyc_verification_id,
        user_id,
        source,
        device_type,
        checkin_location,
    } = values;
    let checked_in_at = Utc::now();
    let event_data = serde_json::json!({
        "source": source,
        "guest_id": guest_id,
        "ekyc_verification_id": ekyc_verification_id,
    })
    .to_string();

    let query = r#"
            INSERT INTO self_checkin_events (
                booking_id, guest_id, ekyc_verification_id, user_id, checked_in_at,
                room_key_issued, digital_key_sent, device_type, checkin_location,
                event_type, source, event_data, created_at
            )
            VALUES ($1, $2, $3, $4, $5, true, true, $6, $7, 'auto_checkin', $8, $9, CURRENT_TIMESTAMP)
            RETURNING checked_in_at
        "#;

    sqlx::query_scalar(query)
        .bind(booking_id)
        .bind(guest_id)
        .bind(ekyc_verification_id)
        .bind(user_id)
        .bind(checked_in_at)
        .bind(device_type)
        .bind(checkin_location)
        .bind(source)
        .bind(event_data)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
}

async fn reconcile_room_status_after_booking_release(
    pool: &DbPool,
    room_id: i64,
    released_booking_id: i64,
) -> Result<(), ApiError> {
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
                  AND status IN ('reserved', 'confirmed', 'pending', 'pending_payment', 'pending_confirmation')
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

    let current_status_query = "SELECT status FROM rooms WHERE id = $1";

    let current_status: Option<String> = sqlx::query_scalar(current_status_query)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let status = if current_status.as_deref() == Some("reserved_dirty") {
        match status.as_str() {
            "reserved" => "reserved_dirty".to_string(),
            "available" => "dirty".to_string(),
            _ => status,
        }
    } else {
        status
    };

    let status_notes = match status.as_str() {
        "occupied" => "Room status reconciled: current stay remains",
        "reserved" => "Room status reconciled: upcoming reservation remains",
        "reserved_dirty" => "Room status reconciled: upcoming reservation remains, cleaning needed",
        "dirty" => "Room released; cleaning still needed",
        _ => "Room released after booking update",
    };

    let update_query = r#"
        UPDATE rooms
        SET status = $1, status_notes = $2
        WHERE id = $3
          AND (status = 'reserved_dirty' OR status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning'))
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

    let owns_booking_query = "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2 UNION SELECT 1 FROM users u WHERE u.id = $1 AND u.guest_id = $2)";

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

    let timeline_sql = r#"
        SELECT id::text AS id, 'booking_history' AS source, 'status_change' AS event_type,
               'Status changed to ' || new_status AS title,
               change_reason AS description, previous_status AS status_from, new_status AS status_to,
               NULL::text AS amount, changed_by AS actor_id, NULL::jsonb AS old_metadata, metadata, created_at
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
               price_adjustment::text AS amount, modified_by AS actor_id, old_value AS old_metadata, new_value AS metadata, modified_at AS created_at
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
               amount::text AS amount, created_by AS actor_id, NULL::jsonb AS old_metadata, metadata, created_at
        FROM payments
        WHERE booking_id = $1
        UNION ALL
        SELECT id::text AS id, 'invoices' AS source, 'invoice' AS event_type,
               'Invoice ' || invoice_number AS title,
               notes AS description, NULL::text AS status_from, status AS status_to,
               total_amount::text AS amount, created_by AS actor_id, NULL::jsonb AS old_metadata, NULL::jsonb AS metadata, created_at
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
            let metadata = row
                .try_get::<Option<serde_json::Value>, _>("metadata")
                .ok()
                .flatten();
            let old_metadata = row
                .try_get::<Option<serde_json::Value>, _>("old_metadata")
                .ok()
                .flatten();

            let source: String = row.try_get("source").unwrap_or_default();
            let event_type: String = row.try_get("event_type").unwrap_or_default();
            let base_title: String = row.try_get("title").unwrap_or_default();
            let base_description: Option<String> = row.try_get("description").ok();
            let (title, description) = describe_booking_modification_event(
                &source,
                &event_type,
                base_title,
                base_description,
                old_metadata.as_ref(),
                metadata.as_ref(),
            );

            BookingTimelineEntry {
                id: row.try_get("id").unwrap_or_default(),
                source,
                event_type,
                title,
                description,
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

fn describe_booking_modification_event(
    source: &str,
    event_type: &str,
    base_title: String,
    base_description: Option<String>,
    old_metadata: Option<&serde_json::Value>,
    metadata: Option<&serde_json::Value>,
) -> (String, Option<String>) {
    if source != "booking_modifications" || event_type != "date_change" {
        return (base_title, base_description);
    }

    let Some(old_value) = old_metadata else {
        return (base_title, base_description);
    };
    let Some(new_value) = metadata else {
        return (base_title, base_description);
    };

    let Some(old_check_in) = timeline_json_string(old_value, "check_in_date") else {
        return (base_title, base_description);
    };
    let Some(old_check_out) = timeline_json_string(old_value, "check_out_date") else {
        return (base_title, base_description);
    };
    let Some(new_check_in) = timeline_json_string(new_value, "check_in_date") else {
        return (base_title, base_description);
    };
    let Some(new_check_out) = timeline_json_string(new_value, "check_out_date") else {
        return (base_title, base_description);
    };

    let old_check_out_date = NaiveDate::parse_from_str(&old_check_out, "%Y-%m-%d").ok();
    let new_check_out_date = NaiveDate::parse_from_str(&new_check_out, "%Y-%m-%d").ok();
    let same_arrival = old_check_in == new_check_in;

    let (title, verb) = match (same_arrival, old_check_out_date, new_check_out_date) {
        (true, Some(old_date), Some(new_date)) if new_date > old_date => {
            ("Stay extended".to_string(), "Extended")
        }
        (true, Some(old_date), Some(new_date)) if new_date < old_date => {
            ("Stay shortened".to_string(), "Shortened")
        }
        _ => (base_title, "Changed"),
    };

    let derived_description = format!(
        "{} from {} to {}.",
        verb,
        format_timeline_date_range(&old_check_in, &old_check_out),
        format_timeline_date_range(&new_check_in, &new_check_out)
    );

    let description = match base_description {
        Some(reason) if !reason.trim().is_empty() => {
            Some(format!("{} {}", derived_description, reason.trim()))
        }
        _ => Some(derived_description),
    };

    (title, description)
}

fn timeline_json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
}

fn format_timeline_date_range(check_in: &str, check_out: &str) -> String {
    format!(
        "{} - {}",
        format_timeline_date(check_in),
        format_timeline_date(check_out)
    )
}

fn format_timeline_date(value: &str) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|date| {
            let month = MONTHS[(date.month() - 1) as usize];
            format!("{} {}, {}", month, date.day(), date.year())
        })
        .unwrap_or_else(|_| value.to_string())
}

#[cfg(test)]
mod timeline_description_tests {
    use super::*;

    #[test]
    fn date_change_extension_describes_old_and_new_stay_ranges() {
        let old_value = serde_json::json!({
            "check_in_date": "2026-06-09",
            "check_out_date": "2026-06-12",
        });
        let new_value = serde_json::json!({
            "check_in_date": "2026-06-09",
            "check_out_date": "2026-06-18",
        });

        let (title, description) = describe_booking_modification_event(
            "booking_modifications",
            "date_change",
            "Dates updated".to_string(),
            None,
            Some(&old_value),
            Some(&new_value),
        );

        assert_eq!(title, "Stay extended");
        assert_eq!(
            description.as_deref(),
            Some("Extended from Jun 9, 2026 - Jun 12, 2026 to Jun 9, 2026 - Jun 18, 2026.")
        );
    }

    #[test]
    fn date_change_shortening_describes_old_and_new_stay_ranges() {
        let old_value = serde_json::json!({
            "check_in_date": "2026-06-09",
            "check_out_date": "2026-06-18",
        });
        let new_value = serde_json::json!({
            "check_in_date": "2026-06-09",
            "check_out_date": "2026-06-12",
        });

        let (title, description) = describe_booking_modification_event(
            "booking_modifications",
            "date_change",
            "Dates updated".to_string(),
            None,
            Some(&old_value),
            Some(&new_value),
        );

        assert_eq!(title, "Stay shortened");
        assert_eq!(
            description.as_deref(),
            Some("Shortened from Jun 9, 2026 - Jun 18, 2026 to Jun 9, 2026 - Jun 12, 2026.")
        );
    }
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

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM customer_ledgers \
         WHERE booking_id = $1 AND post_type = 'room_charge' \
         AND COALESCE(is_reversal, false) = false)",
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if exists {
        return Ok(());
    }

    let nights = std::cmp::max((check_out - check_in).num_days(), 1);

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

    let today = hotel_today(pool).await?;
    let due_date = today + chrono::Duration::days(terms_days);

    // Reuse the booking's existing invoice number when one already exists,
    // so a single booking has a single invoice number across `invoices` and
    // `customer_ledgers`. Only generate a new one if neither table has one yet.
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

    let invoice_number = match existing_invoice {
        Some(n) => Some(n),
        None => crate::services::invoice_numbers::next_invoice_number(pool)
            .await
            .ok(),
    };

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
    let (total, mut bookings) = BookingRepository::find_paginated_with_details(
        &pool,
        &params,
        GET_BOOKINGS_BASE_QUERY,
        pagination,
    )
    .await?;
    crate::services::auto_checkin::attach_booking_ekyc_summaries(&pool, &mut bookings).await?;

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

fn checkout_balance_due(total_amount: Decimal, total_paid: Decimal) -> Decimal {
    if total_amount > total_paid {
        total_amount - total_paid
    } else {
        Decimal::ZERO
    }
}

fn booking_has_company_billing(
    booking: &Booking,
    input: &BookingUpdateInput,
    final_company_id: Option<i64>,
) -> bool {
    final_company_id.is_some()
        || input
            .company_name
            .as_deref()
            .or(booking.company_name.as_deref())
            .map(|name| !name.trim().is_empty())
            .unwrap_or(false)
}

async fn completed_booking_payment_total(
    pool: &DbPool,
    booking_id: i64,
) -> Result<Decimal, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT COALESCE(SUM(amount) FILTER (
            WHERE status = 'completed'
              AND COALESCE(payment_type, 'booking') != 'refund'
        ), 0) AS total_paid
        FROM payments
        WHERE booking_id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row_mappers::get_decimal(&row, "total_paid"))
}

async fn ensure_checkout_balance_resolved(
    pool: &DbPool,
    booking_id: i64,
    existing_booking: &Booking,
    input: &BookingUpdateInput,
    new_status: &str,
    new_total_amount: Option<Decimal>,
) -> Result<(), ApiError> {
    let is_checkout_transition = matches!(new_status, "checked_out" | "completed")
        && !matches!(
            existing_booking.status.as_str(),
            "checked_out" | "completed"
        );
    if !is_checkout_transition {
        return Ok(());
    }

    let total_amount = new_total_amount.unwrap_or(existing_booking.total_amount);
    let total_paid = completed_booking_payment_total(pool, booking_id).await?;
    let balance_due = checkout_balance_due(total_amount, total_paid);
    let final_company_id = input.company_id.or(existing_booking.company_id);

    if balance_due > Decimal::ZERO
        && !booking_has_company_billing(existing_booking, input, final_company_id)
    {
        return Err(ApiError::BadRequest(format!(
            "Collect full payment before checkout. Balance due: {}",
            balance_due.round_dp(2)
        )));
    }

    Ok(())
}

#[cfg(test)]
mod checkout_payment_guard_tests {
    use super::*;

    #[test]
    fn checkout_balance_due_is_zero_when_paid_or_overpaid() {
        assert_eq!(
            checkout_balance_due(Decimal::new(10000, 2), Decimal::new(10000, 2)),
            Decimal::ZERO
        );
        assert_eq!(
            checkout_balance_due(Decimal::new(10000, 2), Decimal::new(12500, 2)),
            Decimal::ZERO
        );
    }

    #[test]
    fn checkout_balance_due_returns_remaining_unpaid_amount() {
        assert_eq!(
            checkout_balance_due(Decimal::new(10000, 2), Decimal::new(2500, 2)),
            Decimal::new(7500, 2)
        );
    }
}

async fn booking_revenue_for_date(pool: &DbPool, date: NaiveDate) -> Result<f64, ApiError> {
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
    let today = hotel_today(&pool).await?;

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

    let today_check_ins: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE status IN ('pending', 'confirmed') AND check_in_date::date = $1"
    ).bind(today).fetch_one(&pool).await.unwrap_or(0);

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

    let mut bookings: Vec<BookingWithDetails> = rows
        .iter()
        .map(row_mappers::row_to_booking_with_details)
        .collect();
    crate::services::auto_checkin::attach_booking_ekyc_summaries(&pool, &mut bookings).await?;

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

    let today: NaiveDate = hotel_today(&mut *tx).await?;

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

    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1 AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending', 'pending_payment', 'pending_confirmation') AND status != 'voided'
            AND ((check_in_date <= $2 AND check_out_date > $2)
                OR (check_in_date < $3 AND check_out_date >= $3)
                OR (check_in_date >= $2 AND check_out_date <= $3))
        )
    "#;

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
        _ => booking_svc::generate_booking_number_for_date(today),
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
    let ota_reference = sanitize_ota_reference(input.ota_reference.as_deref());

    let deposit_paid = input.deposit_paid.unwrap_or(false);
    let deposit_amount_f64 = input.deposit_amount;
    let payment_status = input
        .payment_status
        .clone()
        .unwrap_or_else(|| "unpaid".to_string());

    // Get the override rate value if provided (to store in rate_override_weekday)
    let rate_override_value = input.room_rate_override;

    // PostgreSQL version: INSERT with RETURNING
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
                is_tourist, tourism_tax_amount, extra_bed_count, extra_bed_charge, post_type, daily_rates, cleaning_preference,
                company_id, company_name, booking_channel_id, ota_reference
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11, $12, $13, 1, $14, $15, $16, CASE WHEN $15 THEN CURRENT_TIMESTAMP ELSE NULL END, $17, $17, $18,
                $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
            RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, payment_method, adults, children, special_requests, remarks, source, booking_channel_id, ota_reference, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, daily_rates, created_at, updated_at, post_type, cleaning_preference
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
        .bind(input.company_id)
        .bind(input.company_name.as_deref())
        .bind(input.booking_channel_id)
        .bind(ota_reference.as_deref())
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    };

    // A confirmed booking reserves the room. If housekeeping still needs to
    // clean it, keep that requirement visible and block check-in until cleared.
    let reserved_status = if matches!(room_status, "dirty" | "cleaning" | "reserved_dirty") {
        "reserved_dirty"
    } else {
        "reserved"
    };
    let update_room_query = "UPDATE rooms SET status = $1, status_notes = $2 WHERE id = $3";

    sqlx::query(update_room_query)
        .bind(reserved_status)
        .bind(format!(
            "Booking #{} - {}",
            booking.booking_number,
            if reserved_status == "reserved_dirty" {
                "Reservation created, room needs cleaning before check-in"
            } else if check_in == today {
                "Reservation arriving today"
            } else {
                "Future reservation"
            }
        ))
        .bind(input.room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Record a deposit payment as part of the same transaction as the booking.
    // `record_checkin_payment_tx` handles the database schema despite its
    // historical name, so a failed payment cannot leave a successful booking
    // with its deposit silently missing.
    if let Some(amount_paid) = input.amount_paid
        && amount_paid > 0.0
    {
        let deposit_payment = CheckInPaymentRecord {
            amount: amount_paid,
            payment_method: input
                .payment_method
                .clone()
                .unwrap_or_else(|| "Cash".to_string()),
            payment_type: Some("deposit".to_string()),
            notes: Some("Deposit paid at booking".to_string()),
        };
        record_checkin_payment_tx(&mut tx, booking.id, &deposit_payment, user_id).await?;
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

    let mut booking = row_mappers::row_to_booking_with_details(&row);

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

    crate::services::auto_checkin::attach_booking_ekyc_summaries(
        &pool,
        std::slice::from_mut(&mut booking),
    )
    .await?;

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

    let owns_booking_query =
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2)";

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

    // Optional explicit actual-checkout override. Empty strings are treated as
    // "not provided" so the automatic checkout-transition stamping is preserved.
    let actual_check_out_override: Option<chrono::NaiveDateTime> = match input
        .actual_check_out
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(value) => Some(parse_datetime_flexible(value).map_err(|_| {
            ApiError::BadRequest(
                "Invalid actual checkout date. Use YYYY-MM-DD or an ISO date-time".to_string(),
            )
        })?),
        None => None,
    };

    // Check for room conflicts when room or dates change (skip for non-active statuses)
    let room_changed = input.room_id.is_some() && new_room_id != existing_booking.room_id;
    let dates_changed = input.check_in_date.is_some() || input.check_out_date.is_some();
    let is_inactive_status = matches!(
        new_status.as_str(),
        "voided" | "checked_out" | "late_checkout"
    );
    if (room_changed || dates_changed) && !is_inactive_status {
        let conflict_query = r#"
            SELECT EXISTS(
                SELECT 1 FROM bookings
                WHERE room_id = $1 AND id != $4
                AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending', 'pending_payment', 'pending_confirmation') AND status != 'voided'
                AND ((check_in_date <= $2 AND check_out_date > $2)
                    OR (check_in_date < $3 AND check_out_date >= $3)
                    OR (check_in_date >= $2 AND check_out_date <= $3))
            )
        "#;

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

    let new_room_status_query = "SELECT status FROM rooms WHERE id = $1 AND is_active = true";

    let new_room_status: Option<String> = sqlx::query_scalar(new_room_status_query)
        .bind(new_room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let new_room_status =
        new_room_status.ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    if !is_inactive_status && matches!(new_room_status.as_str(), "maintenance" | "out_of_order") {
        return Err(ApiError::BadRequest(format!(
            "Room is not available - currently {}",
            new_room_status.replace('_', " ")
        )));
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
    let clear_company = input.clear_company.unwrap_or(false);
    let ota_reference = sanitize_ota_reference(input.ota_reference.as_deref());

    ensure_checkout_balance_resolved(
        &pool,
        booking_id,
        &existing_booking,
        &input,
        &new_status,
        new_total_amount,
    )
    .await?;

    // PostgreSQL version: UPDATE with RETURNING
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
                company_id = CASE WHEN $27 = true THEN NULL ELSE COALESCE($10, company_id) END,
                company_name = CASE WHEN $27 = true THEN NULL ELSE COALESCE($11, company_name) END,
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
                actual_check_out = COALESCE($28, CASE WHEN $2 = 'checked_out' AND actual_check_out IS NULL THEN CURRENT_TIMESTAMP ELSE actual_check_out END),
                booking_channel_id = COALESCE($29, booking_channel_id),
                ota_reference = COALESCE($30, ota_reference),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
            RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, payment_method, adults, children, special_requests, remarks, source, booking_channel_id, ota_reference, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, daily_rates, created_at, updated_at, post_type, cleaning_preference"#
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
        .bind(clear_company)
        .bind(actual_check_out_override
            .map(|dt| chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc)))
        .bind(input.booking_channel_id)
        .bind(ota_reference.as_deref())
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
            let reserved_status = if matches!(
                new_room_status.as_str(),
                "dirty" | "cleaning" | "reserved_dirty"
            ) {
                "reserved_dirty"
            } else {
                "reserved"
            };
            let _ = sqlx::query("UPDATE rooms SET status = $1 WHERE id = $2")
                .bind(reserved_status)
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

                if let Err(e) = crate::modules::loyalty::service::reverse_booking_points(
                    &pool,
                    booking_id,
                    Some(user_id),
                    "Booking voided",
                )
                .await
                {
                    log::warn!(
                        "Failed to reverse loyalty points for voided booking {}: {}",
                        booking_id,
                        e
                    );
                }
            }
            "checked_out" | "completed" => {
                let upcoming_reservation_query = r#"
                    SELECT EXISTS(
                        SELECT 1 FROM bookings
                        WHERE room_id = $1 AND id != $2
                          AND status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
                          AND check_out_date >= CURRENT_DATE
                    )
                "#;

                let has_upcoming_reservation =
                    sqlx::query_scalar::<_, bool>(upcoming_reservation_query)
                        .bind(new_room_id)
                        .bind(booking_id)
                        .fetch_one(&pool)
                        .await
                        .unwrap_or(false);

                let next_room_status = if has_upcoming_reservation {
                    "reserved_dirty"
                } else {
                    "dirty"
                };

                // Staff must clean the room before the next guest can check in.
                log::info!(
                    "Setting room {} to {} after checkout (booking {})",
                    new_room_id,
                    next_room_status,
                    booking_id
                );
                let result = sqlx::query("UPDATE rooms SET status = $1 WHERE id = $2")
                    .bind(next_room_status)
                    .bind(new_room_id)
                    .execute(&pool)
                    .await;
                match result {
                    Ok(r) => log::info!(
                        "Room {} set to {}, rows affected: {}",
                        new_room_id,
                        next_room_status,
                        r.rows_affected()
                    ),
                    Err(e) => log::error!(
                        "Failed to set room {} to {}: {}",
                        new_room_id,
                        next_room_status,
                        e
                    ),
                }

                if let Err(e) =
                    crate::services::housekeeping::ensure_checkout_cleaning_task_for_room(
                        &pool,
                        new_room_id,
                        user_id,
                    )
                    .await
                {
                    log::warn!(
                        "Failed to create housekeeping task for checked-out booking {} in room {}: {}",
                        booking_id,
                        new_room_id,
                        e
                    );
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

                if let Err(e) = crate::modules::loyalty::service::award_eligible_booking_points(
                    &pool,
                    booking_id,
                    None,
                    Some(user_id),
                )
                .await
                {
                    log::warn!(
                        "Failed to award loyalty points for checked-out booking {}: {}",
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
                let _ = sqlx::query("UPDATE rooms SET status = 'occupied' WHERE id = $1")
                    .bind(new_room_id)
                    .execute(&pool)
                    .await;
            }
            _ => {}
        }

        // Back-fill night audit postings when a booking enters a "stayed" status.
        // Handles edits that advance a back-dated booking past a closed audit.
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

    let affected_night_audit_dates = booking_night_audit_dates(&pool, booking_id).await?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    let update_booking_query = r#"
        UPDATE bookings
        SET status = 'voided',
            updated_at = CURRENT_TIMESTAMP,
            cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by = $2
        WHERE id = $1
          AND status != 'voided'
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

    let update_room_query = "UPDATE rooms SET status = 'available' WHERE id = $1";

    sqlx::query(update_room_query)
        .bind(room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

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

        let room_type_query = "SELECT room_type_id FROM rooms WHERE id = $1";

        let room_type_id: Option<i64> = sqlx::query_scalar(room_type_query)
            .bind(room_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
            .flatten();

        if let Some(rt_id) = room_type_id {
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
        "complimentary_nights_credited": nights_credited,
        "affected_night_audit_dates": affected_night_audit_dates,
        "night_audit_rerun_required": !affected_night_audit_dates.is_empty()
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

    // All check-in mutations (guest/booking edits, the status flip, the deposit,
    // the payment, and the room status) run inside one transaction so they commit
    // atomically — a failure anywhere rolls the whole check-in back instead of
    // leaving a half-checked-in booking.
    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    // Check if room is ready for check-in. Dirty reservations must be cleaned
    // before the guest can be checked in.
    let room_status: Option<String> = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
        .bind(booking.room_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if let Some(status) = room_status
        && matches!(
            status.as_str(),
            "maintenance" | "out_of_order" | "dirty" | "cleaning" | "reserved_dirty"
        )
    {
        let reason = if matches!(status.as_str(), "dirty" | "cleaning" | "reserved_dirty") {
            "the room must be cleaned before check-in".to_string()
        } else {
            format!("room is currently under {}", status.replace("_", " "))
        };
        return Err(ApiError::BadRequest(format!(
            "Cannot check in - {}.",
            reason
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
            if let Err(e) = q.execute(&mut *tx).await {
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
        if let Some(v) = sanitize_ota_reference(booking_update.ota_reference.as_deref()) {
            updates.push(format!("ota_reference = ${}", params.len() + 1));
            params.push(v);
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
            if let Err(e) = q.execute(&mut *tx).await {
                log::warn!(
                    "Failed to update booking {} fields during check-in: {}",
                    booking_id,
                    e
                );
            }
        }
    }

    // Deposit details (if any) are folded into the same statement that flips the
    // status, so the check-in no longer needs a separate update_booking round-trip.
    let (deposit_paid, deposit_amount, payment_note) = checkin_data
        .as_ref()
        .and_then(|c| c.booking_update.as_ref())
        .map(|b| (b.deposit_paid, b.deposit_amount, b.payment_note.clone()))
        .unwrap_or((None, None, None));
    let deposit_amount =
        deposit_amount.map(|d| Decimal::from_f64_retain(d).unwrap_or(Decimal::ZERO));

    // Compare-and-swap: only flip a booking that is still confirmed/pending. If a
    // concurrent request already checked it in, this matches zero rows and we
    // abort, so a double-click can never produce a second payment/audit entry.
    let updated_booking: Option<Booking> = sqlx::query_as(
        r#"
        UPDATE bookings SET
            status = 'checked_in',
            actual_check_in = CURRENT_TIMESTAMP,
            deposit_paid = COALESCE($2, deposit_paid),
            deposit_amount = COALESCE($3, deposit_amount),
            deposit_paid_at = CASE WHEN $2 = true AND deposit_paid_at IS NULL THEN CURRENT_TIMESTAMP ELSE deposit_paid_at END,
            payment_note = COALESCE($4, payment_note),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
        RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, payment_method, adults, children, special_requests, remarks, source, booking_channel_id, ota_reference, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, daily_rates, created_at, updated_at, post_type, cleaning_preference
        "#
    )
    .bind(booking_id)
    .bind(deposit_paid)
    .bind(crate::core::db::opt_decimal_to_db(deposit_amount))
    .bind(&payment_note)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let updated_booking = updated_booking.ok_or_else(|| {
        ApiError::BadRequest(
            "Booking is no longer eligible for check-in (it may already be checked in)."
                .to_string(),
        )
    })?;

    // Record payment if provided during check-in. A failure here aborts the
    // transaction (returns Err) so we never report a successful check-in with the
    // payment silently dropped — caller can safely retry the whole request.
    let mut payment_recorded = false;
    if let Some(ref checkin) = checkin_data
        && let Some(ref payment) = checkin.payment_record
        && payment.amount > 0.0
    {
        record_checkin_payment_tx(&mut tx, booking_id, payment, user_id).await?;
        payment_recorded = true;
    }

    // Only update room status for current/future bookings (skip back-dated).
    // SAVEPOINT keeps this best-effort: a failed statement would otherwise
    // poison the transaction and the commit below would silently roll back the
    // check-in and any recorded payment (lessons.md 2026-07-10b).
    let today = hotel_today(&mut *tx).await?;
    if booking.check_out_date >= today {
        sqlx::query("SAVEPOINT sp_checkin_room_status")
            .execute(&mut *tx)
            .await?;
        match sqlx::query("UPDATE rooms SET status = 'occupied' WHERE id = $1")
            .bind(booking.room_id)
            .execute(&mut *tx)
            .await
        {
            Ok(_) => {
                sqlx::query("RELEASE SAVEPOINT sp_checkin_room_status")
                    .execute(&mut *tx)
                    .await?;
            }
            Err(e) => {
                log::warn!(
                    "Failed to update room {} to occupied during check-in: {}",
                    booking.room_id,
                    e
                );
                sqlx::query("ROLLBACK TO SAVEPOINT sp_checkin_room_status")
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }

    // Everything above is now durable as a single unit.
    tx.commit().await.map_err(ApiError::from)?;

    // Derived payment-status chip reflects the payment we just inserted. Best-effort
    // and post-commit: a hiccup here must not undo a completed check-in.
    if payment_recorded {
        let _ = crate::handlers::payments::recompute_payment_status(&pool, booking_id).await;
    }

    // Back-fill night audit postings for any past nights whose audit already closed.
    // Covers same-day walk-ins created after their own 00:00 audit ran.
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
        AuditEvent {
            user_id: Some(user_id),
            action: "booking_checkin",
            resource_type: "booking",
            resource_id: Some(booking_id),
            details: Some(serde_json::json!({"guest_id": booking.guest_id, "room_id": booking.room_id})),
            ..Default::default()
        },
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

    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1
              AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending', 'pending_payment', 'pending_confirmation')
              AND status != 'voided'
              AND id != $4
              AND ((check_in_date <= $2 AND check_out_date > $2)
                  OR (check_in_date < $3 AND check_out_date >= $3)
                  OR (check_in_date >= $2 AND check_out_date <= $3))
        )
    "#;

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

    let update_room_query = "UPDATE rooms SET status = $1 WHERE id = $2";

    sqlx::query(update_room_query)
        .bind("reserved")
        .bind(room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(user_id),
            action: "booking_reactivated",
            resource_type: "booking",
            resource_id: Some(booking_id),
            details: Some(serde_json::json!({"guest_id": guest_id, "room_id": room_id, "previous_status": "voided"})),
            ..Default::default()
        },
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
    let query = "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2 UNION SELECT 1 FROM users u WHERE u.id = $1 AND u.guest_id = $2)";

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
    let update_booking_query = r#"
        UPDATE bookings
        SET status = 'voided',
            updated_at = CURRENT_TIMESTAMP,
            cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by = $2
        WHERE id = $1
          AND status != 'voided'
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

pub async fn booking_night_audit_dates(
    pool: &DbPool,
    booking_id: i64,
) -> Result<Vec<NaiveDate>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT DISTINCT audit_date
        FROM (
            SELECT napn.audit_date
            FROM night_audit_posted_nights napn
            WHERE napn.booking_id = $1

            UNION

            SELECT nar.audit_date
            FROM night_audit_details nad
            JOIN night_audit_runs nar ON nar.id = nad.audit_run_id
            WHERE nad.booking_id = $1
              AND nad.record_type = 'booking'
              AND nad.action = 'posted'

            UNION

            SELECT b.posted_date AS audit_date
            FROM bookings b
            WHERE b.id = $1
              AND COALESCE(b.is_posted, false)
              AND b.posted_date IS NOT NULL
        ) posted
        ORDER BY audit_date
        "#,
    )
    .bind(booking_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    rows.into_iter()
        .map(|row| row.try_get::<NaiveDate, _>("audit_date"))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| ApiError::Database(e.to_string()))
}

pub async fn release_room_tx(tx: &mut DbTransaction<'_>, room_id: i64) -> Result<(), ApiError> {
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
    let void_payments_query =
        "UPDATE payments SET status = 'void' WHERE booking_id = $1 AND status != 'void'";

    sqlx::query(void_payments_query)
        .bind(booking_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

/// Void only unfinished payment attempts. Guest self-service cancellation must
/// retain completed payment records for reconciliation and any later refund.
pub async fn void_uncompleted_booking_payments_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<(), ApiError> {
    let void_payments_query = "UPDATE payments SET status = 'void' WHERE booking_id = $1 AND status NOT IN ('void', 'completed')";

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

        let room_type_query = "SELECT room_type_id FROM rooms WHERE id = $1";

        let room_type_id: Option<i64> = sqlx::query_scalar(room_type_query)
            .bind(booking.room_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
            .flatten();

        if let Some(room_type_id) = room_type_id {
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
pub async fn fetch_room_status(pool: &DbPool, room_id: i64) -> Result<Option<String>, ApiError> {
    let query = "SELECT status FROM rooms WHERE id = $1";

    sqlx::query_scalar(query)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
}

pub async fn room_number(pool: &DbPool, room_id: i64) -> Result<String, ApiError> {
    let query = "SELECT room_number FROM rooms WHERE id = $1";

    sqlx::query_scalar(query)
        .bind(room_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
}

pub async fn fetch_room_status_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
) -> Result<Option<String>, ApiError> {
    let query = "SELECT status FROM rooms WHERE id = $1";

    sqlx::query_scalar(query)
        .bind(room_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
}

/// Read the guest's current IC / passport number within the check-in transaction
/// so the caller can enforce that one is on file before completing check-in.
pub async fn fetch_guest_ic_number_tx(
    tx: &mut DbTransaction<'_>,
    guest_id: i64,
) -> Result<Option<String>, ApiError> {
    let query = "SELECT ic_number FROM guests WHERE id = $1";

    sqlx::query_scalar(query)
        .bind(guest_id)
        .fetch_optional(&mut **tx)
        .await
        .map(Option::flatten)
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
    if let Some(v) = booking_update.company_id {
        updates.push(format!("company_id = ${}", params.len() + 1));
        params.push(v.to_string());
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
/// check-in timestamp. Guarded by `status = 'confirmed'` and requires exactly
/// one affected row, so a concurrent check-in (or any other transition that
/// already moved the row) collapses to a clean `BadRequest` instead of a double
/// check-in. A `pending` booking (guest self-service, payment not yet
/// approved/captured) is deliberately NOT check-in-eligible here — the caller
/// (`services::bookings::checkin_booking_flow_for_booking`) rejects it earlier
/// with a "payment required" reason; this guard is the last-line defense.
/// Returns the refreshed booking row.
pub async fn checkin_booking_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<Booking, ApiError> {
    let update_query = r#"
        UPDATE bookings
        SET status = 'checked_in',
            actual_check_in = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status = 'confirmed'
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

    let select_query = "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, \
         room_rate, subtotal, tax_amount, discount_amount, total_amount, currency, status, \
         payment_status, payment_method, adults, children, special_requests, remarks, source, \
         booking_channel_id, ota_reference, market_code, discount_percentage, rate_override_weekday, \
         rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, \
         pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, \
         complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, \
         deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, \
         daily_rates, cleaning_preference, created_at, updated_at \
         FROM bookings WHERE id = $1";

    let row = sqlx::query(select_query)
        .bind(booking_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row_mappers::row_to_booking(&row))
}

/// Atomically transition a booking from a payment-awaiting status to `confirmed`, used when a
/// guest payment is approved/captured. Guarded by payment-awaiting statuses so the
/// call is idempotent: a booking that is already `confirmed` (or beyond)
/// affects zero rows and returns `false` without error, letting the caller
/// still complete the payment. Both `pending` and `confirmed` are inside the
/// PostgreSQL room-overlap EXCLUDE constraint's status set, so this transition
/// cannot trip it. Returns `true` when the row actually moved to `confirmed`.
pub async fn confirm_booking_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<bool, ApiError> {
    let update_query = r#"
            UPDATE bookings
            SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status IN ('pending', 'pending_payment', 'pending_confirmation')
        "#;

    let result = sqlx::query(update_query)
        .bind(booking_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(result.rows_affected() == 1)
}

/// Move an unpaid booking to the staff-review state after a bank-transfer claim.
pub async fn move_booking_to_pending_confirmation_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<bool, ApiError> {
    let query = "UPDATE bookings SET status = 'pending_confirmation', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status IN ('pending', 'pending_payment')";
    Ok(sqlx::query(query)
        .bind(booking_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .rows_affected()
        == 1)
}

/// Return a rejected bank-transfer claim to the payment-awaiting state.
pub async fn move_booking_to_pending_payment_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<bool, ApiError> {
    let query = "UPDATE bookings SET status = 'pending_payment', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'pending_confirmation'";
    Ok(sqlx::query(query)
        .bind(booking_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .rows_affected()
        == 1)
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
    // and `description`. The bind order is identical — only the column list differs.
    let insert_query = r#"
        INSERT INTO payments (uuid, booking_id, amount, payment_method, payment_type, status, notes, created_by)
        VALUES ($1::uuid, $2, $3, $4, $5, 'completed', $6, $7)
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

/// Auto-post the outstanding balance as a completed payment when an online
/// reservation is checked in.
///
/// Online bookings are prepaid (OTA/web), so on arrival we record the amount
/// still owed as a `booking` payment so the folio reflects the collected money
/// and `payment_status` recomputes to `paid`. The remainder is computed in SQL
/// (`total_amount` minus completed non-refund payments) and the row is inserted
/// only when that remainder is positive, so the call is safe to run
/// unconditionally — it no-ops when the booking is already fully paid and never
/// double-charges an existing payment. Returns `true` when a payment row was
/// actually inserted.
pub async fn record_online_checkin_payment_tx(
    tx: &mut DbTransaction<'_>,
    booking: &Booking,
    user_id: i64,
) -> Result<bool, ApiError> {
    // Mirror the explicit check-in payment: fall back to a generic online
    // method when the reservation didn't carry one.
    let payment_method = booking
        .payment_method
        .clone()
        .unwrap_or_else(|| "online_banking".to_string());
    let notes = "Auto-recorded at check-in for online reservation";

    // The completed-non-refund SUM and the `> 0` guard mirror
    // `recompute_booking_payment_status_tx`, keeping the posted amount and the
    // resulting status in agreement.
    let insert_query = r#"
        INSERT INTO payments (uuid, booking_id, amount, payment_method, payment_type, status, notes, created_by)
        SELECT $1::uuid, b.id,
               b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.booking_id = b.id
                     AND p.status = 'completed'
                     AND COALESCE(p.payment_type, 'booking') != 'refund'), 0),
               $2, 'booking', 'completed', $3, $4
        FROM bookings b
        WHERE b.id = $5
          AND b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.booking_id = b.id
                     AND p.status = 'completed'
                     AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0
    "#;

    let result = sqlx::query(insert_query)
        .bind(crate::core::db::generate_uuid())
        .bind(&payment_method)
        .bind(notes)
        .bind(user_id)
        .bind(booking.id)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(result.rows_affected() > 0)
}

/// Set the room to `occupied` as part of check-in.
pub async fn set_room_occupied_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
) -> Result<(), ApiError> {
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
    let conflict_query = r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1
              AND status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending', 'pending_payment', 'pending_confirmation')
              AND status != 'voided'
              AND id != $4
              AND ((check_in_date <= $2 AND check_out_date > $2)
                  OR (check_in_date < $3 AND check_out_date >= $3)
                  OR (check_in_date >= $2 AND check_out_date <= $3))
        )
    "#;

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

    let update_room_query = "UPDATE rooms SET status = $1 WHERE id = $2";

    sqlx::query(update_room_query)
        .bind("reserved")
        .bind(room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

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
