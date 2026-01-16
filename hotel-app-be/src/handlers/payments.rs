//! Payment handlers
//!
//! Handles payments, invoices, and billing.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::NaiveDateTime;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use sqlx::Row;

use crate::core::db::{DbPool, DbRow, decimal_to_db};
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::*;
use crate::models::row_mappers;

/// Create a payment for a booking
pub async fn create_payment_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<PaymentRequest>,
) -> Result<Json<Payment>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Get booking details to calculate amounts
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let booking_query = r#"
        SELECT b.id, b.room_id, b.check_in_date, b.check_out_date, r.room_number
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.id = ?1
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let booking_query = r#"
        SELECT b.id, b.room_id, b.check_in_date, b.check_out_date, r.room_number
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.id = $1
    "#;

    let booking_row = sqlx::query(booking_query)
        .bind(request.booking_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let booking_id: i64 = booking_row.get("id");
    let room_id: i64 = booking_row.get("room_id");
    let check_in: NaiveDateTime = booking_row.get("check_in_date");
    let check_out: NaiveDateTime = booking_row.get("check_out_date");
    let _room_number: String = booking_row.get("room_number");

    // Get room type configuration
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let room_type_query = r#"
        SELECT rt.base_price, rt.keycard_deposit_amount, rt.service_charge_percentage
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = ?1
    "#;
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let room_type_query = r#"
        SELECT rt.base_price, rt.keycard_deposit_amount, rt.service_charge_percentage
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
    "#;

    let room_type_row = sqlx::query(room_type_query)
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let base_price = row_mappers::get_decimal(&room_type_row, "base_price");
    let keycard_deposit = row_mappers::get_decimal(&room_type_row, "keycard_deposit_amount");
    let service_charge_pct = row_mappers::get_decimal(&room_type_row, "service_charge_percentage");

    // Calculate number of nights
    let nights = (check_out.date() - check_in.date()).num_days();
    let subtotal = base_price * Decimal::from(nights);

    // Calculate service charge
    let service_charge = (subtotal * service_charge_pct) / Decimal::from(100);

    // Tax (0 for now, but can be configured)
    let tax_amount = Decimal::ZERO;

    // Total = subtotal + service charge + tax + keycard deposit
    let total = subtotal + service_charge + tax_amount + keycard_deposit;

    // Create payment record
    let payment = sqlx::query_as::<_, Payment>(
        r#"
        INSERT INTO payments (
            booking_id, user_id, payment_method, payment_status,
            subtotal, service_charge, tax_amount, keycard_deposit, total_amount,
            transaction_reference, payment_gateway,
            card_last_four, card_brand, bank_name, account_reference, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
        "#,
    )
    .bind(booking_id)
    .bind(user_id)
    .bind(request.payment_method.to_string())
    .bind(PaymentStatus::Completed.to_string())
    .bind(subtotal)
    .bind(service_charge)
    .bind(tax_amount)
    .bind(keycard_deposit)
    .bind(total)
    .bind(&request.transaction_reference)
    .bind(match &request.payment_method {
        PaymentMethod::Card => Some("card_processor"),
        PaymentMethod::Duitnow => Some("duitnow"),
        PaymentMethod::OnlineBanking => Some("online_banking"),
        _ => None,
    })
    .bind(&request.card_last_four)
    .bind(&request.card_brand)
    .bind(&request.bank_name)
    .bind(&request.account_reference)
    .bind(&request.notes)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create keycard deposit record
    if keycard_deposit > Decimal::ZERO {
        sqlx::query(
            r#"
            INSERT INTO keycard_deposits (booking_id, payment_id, deposit_amount, deposit_status)
            VALUES ($1, $2, $3, 'held')
            "#,
        )
        .bind(booking_id)
        .bind(payment.id)
        .bind(keycard_deposit)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    Ok(Json(payment))
}

/// Get payment for a booking
pub async fn get_payment_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(booking_id): Path<i64>,
) -> Result<Json<Option<Payment>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let payment = sqlx::query_as::<_, Payment>(
        "SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(payment))
}

/// Calculate payment summary for a booking (before actual payment)
pub async fn calculate_payment_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(booking_id): Path<i64>,
) -> Result<Json<PaymentSummary>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    // Get booking and room details
    let (room_id, check_in, check_out): (i64, NaiveDateTime, NaiveDateTime) = sqlx::query_as(
        "SELECT room_id, check_in_date, check_out_date FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get pricing configuration
    let (base_price, keycard_deposit, service_charge_pct): (Decimal, Decimal, Decimal) =
        sqlx::query_as(
            r#"
        SELECT rt.base_price, rt.keycard_deposit_amount, rt.service_charge_percentage
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#,
        )
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Calculate amounts
    let nights = (check_out.date() - check_in.date()).num_days();
    let subtotal = base_price * Decimal::from(nights);
    let service_charge = (subtotal * service_charge_pct) / Decimal::from(100);
    let tax_amount = Decimal::ZERO;
    let total = subtotal + service_charge + tax_amount + keycard_deposit;

    Ok(Json(PaymentSummary {
        subtotal,
        service_charge,
        service_charge_percentage: service_charge_pct,
        tax_amount,
        tax_percentage: Decimal::ZERO,
        keycard_deposit,
        total_amount: total,
        payment_method: None,
    }))
}

/// Generate an invoice for a booking
pub async fn generate_invoice_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(booking_id): Path<i64>,
) -> Result<Json<Invoice>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Check if invoice already exists
    if let Some(existing) =
        sqlx::query_as::<_, Invoice>("SELECT * FROM invoices WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    {
        return Ok(Json(existing));
    }

    // Get booking details with user info
    let booking_details: (
        i64,
        i64,
        String,
        String,
        Option<String>,
        NaiveDateTime,
        NaiveDateTime,
        i64,
        String,
        String,
    ) = sqlx::query_as(
        r#"
        SELECT b.id, b.guest_id, u.full_name, u.email, u.phone,
               b.check_in_date, b.check_out_date,
               r.id as room_id, r.room_number, rt.name as room_type
        FROM bookings b
        JOIN users u ON b.guest_id = u.id
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (
        _bid,
        _guest_id,
        customer_name,
        customer_email,
        customer_phone,
        check_in,
        check_out,
        room_id,
        room_number,
        room_type,
    ) = booking_details;

    // Get payment if exists
    let payment = sqlx::query_as::<_, Payment>(
        "SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Calculate amounts (same as payment)
    let (base_price, keycard_deposit, service_charge_pct): (Decimal, Decimal, Decimal) =
        sqlx::query_as(
            r#"
        SELECT rt.base_price, rt.keycard_deposit_amount, rt.service_charge_percentage
        FROM rooms r
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#,
        )
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let nights = (check_out.date() - check_in.date()).num_days() as i32;
    let subtotal = base_price * Decimal::from(nights);
    let service_charge = (subtotal * service_charge_pct) / Decimal::from(100);
    let tax_amount = Decimal::ZERO;
    let total = subtotal + service_charge + tax_amount + keycard_deposit;

    // Build line items
    let line_items = serde_json::json!([
        {
            "description": format!("Room {} ({}) - {} night(s)", room_number, room_type, nights),
            "quantity": nights,
            "unit_price": base_price,
            "total": subtotal
        },
        {
            "description": format!("Service Charge ({}%)", service_charge_pct),
            "quantity": 1,
            "unit_price": service_charge,
            "total": service_charge
        },
        {
            "description": "Keycard Deposit (Refundable)",
            "quantity": 1,
            "unit_price": keycard_deposit,
            "total": keycard_deposit
        }
    ]);

    // Generate invoice number
    let invoice_number: String = sqlx::query_scalar("SELECT generate_invoice_number()")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create invoice
    let invoice = sqlx::query_as::<_, Invoice>(
        r#"
        INSERT INTO invoices (
            invoice_number, booking_id, payment_id, user_id,
            subtotal, service_charge, service_charge_percentage,
            tax_amount, tax_percentage, keycard_deposit, total_amount,
            line_items, customer_name, customer_email, customer_phone,
            room_number, room_type, check_in_date, check_out_date,
            number_of_nights, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING *
        "#,
    )
    .bind(&invoice_number)
    .bind(booking_id)
    .bind(payment.as_ref().map(|p| p.id))
    .bind(user_id)
    .bind(subtotal)
    .bind(service_charge)
    .bind(service_charge_pct)
    .bind(tax_amount)
    .bind(Decimal::ZERO)
    .bind(keycard_deposit)
    .bind(total)
    .bind(&line_items)
    .bind(&customer_name)
    .bind(&customer_email)
    .bind(&customer_phone)
    .bind(&room_number)
    .bind(&room_type)
    .bind(check_in)
    .bind(check_out)
    .bind(nights)
    .bind(if payment.is_some() { "paid" } else { "draft" })
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(invoice))
}

/// Get invoice preview with all details
pub async fn get_invoice_preview_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(booking_id): Path<i64>,
) -> Result<Json<InvoicePreview>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    // Get or generate invoice
    let invoice = sqlx::query_as::<_, Invoice>("SELECT * FROM invoices WHERE booking_id = $1")
        .bind(booking_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let invoice = match invoice {
        Some(inv) => inv,
        None => {
            // Generate if doesn't exist
            let response = generate_invoice_handler(
                State(pool.clone()),
                headers.clone(),
                Path(booking_id),
            )
            .await?;
            response.0
        }
    };

    // Get payment
    let payment = sqlx::query_as::<_, Payment>(
        "SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get booking details
    let booking_details = serde_json::json!({
        "booking_id": booking_id,
        "check_in": invoice.check_in_date,
        "check_out": invoice.check_out_date,
        "nights": invoice.number_of_nights,
        "room": format!("{} ({})", invoice.room_number.as_ref().unwrap_or(&"N/A".to_string()), invoice.room_type.as_ref().unwrap_or(&"N/A".to_string()))
    });

    Ok(Json(InvoicePreview {
        invoice,
        payment,
        booking_details,
    }))
}

/// Get all invoices for a user
pub async fn get_user_invoices_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<Invoice>>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let invoices =
        sqlx::query_as::<_, Invoice>("SELECT * FROM invoices WHERE user_id = $1 ORDER BY invoice_date DESC")
            .bind(user_id)
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(invoices))
}
