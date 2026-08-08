use crate::constants::PaymentMethod;
use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::models::{
    Booking, GuestBankDetails, GuestPaymentConfig, Invoice, InvoicePreview, Payment,
    PaymentActionResponse, PaymentRequest, PaymentSummary, PaymentWorkflowSummary,
    PaypalCreateOrderResponse, PendingPaymentEntry, PendingPaymentPage, RecordPaymentRequest,
    UpdatePaymentRequest,
};
use crate::modules::communications::repository::{CommunicationsRepository, DeliveryValues};
use crate::modules::communications::validation::html_escape;
use crate::repositories::guest_portal::GuestPortalRepository;
use crate::repositories::payment::{PaymentRepository, PendingPaymentValues};
use crate::services::audit::AuditLog;
use rust_decimal::Decimal;
use std::fs;
use std::path::{Path, PathBuf};
use crate::models::AuditEvent;

const PAYMENT_RECEIPT_UPLOAD_DIR: &str = "private_uploads/payment_receipts";
const MAX_PAYMENT_RECEIPT_BYTES: usize = 10 * 1024 * 1024;

#[allow(dead_code)] // Reused by ledger payment validation in the next task.
pub(crate) fn normalized_idempotency_key(value: &str) -> Result<&str, ApiError> {
    let key = value.trim();
    if key.is_empty() || key.len() > 160 {
        return Err(ApiError::BadRequest(
            "Idempotency key must be between 1 and 160 characters".to_string(),
        ));
    }
    Ok(key)
}

pub async fn queue_paid_online_booking_room_assignment(
    pool: &DbPool,
    booking_id: i64,
) -> Result<(), ApiError> {
    let Some(assignment) =
        PaymentRepository::paid_online_booking_room_assignment(pool, booking_id).await?
    else {
        return Ok(());
    };

    let subject = format!(
        "Room {} assigned for booking {}",
        assignment.room_number, assignment.booking_number
    );
    let body_html = format!(
        "<p>Dear {},</p>\
         <p>Your online payment is confirmed and your room has been assigned.</p>\
         <p><strong>Booking:</strong> {}<br>\
         <strong>Room:</strong> {} ({})<br>\
         <strong>Stay:</strong> {} to {}</p>\
         <p>You can also view these details in your guest portal.</p>",
        html_escape(&assignment.guest_name),
        html_escape(&assignment.booking_number),
        html_escape(&assignment.room_number),
        html_escape(&assignment.room_type_name),
        assignment.check_in_date,
        assignment.check_out_date,
    );
    let body_text = format!(
        "Your online payment is confirmed and your room has been assigned.\n\
         Booking: {}\nRoom: {} ({})\nStay: {} to {}",
        assignment.booking_number,
        assignment.room_number,
        assignment.room_type_name,
        assignment.check_in_date,
        assignment.check_out_date,
    );

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    CommunicationsRepository::insert_delivery_tx(
        &mut tx,
        DeliveryValues {
            campaign_id: None,
            kind: "booking_confirmation",
            guest_id: assignment.guest_id,
            topic: "booking_confirmation",
            recipient_email: &assignment.guest_email,
            subject: &subject,
            body_html: &body_html,
            body_text: Some(&body_text),
            voucher_id: None,
            idempotency_key: &format!("online-room-assignment:{}", assignment.booking_id),
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(())
}

async fn try_queue_paid_online_booking_room_assignment(pool: &DbPool, booking_id: i64) {
    if let Err(error) = queue_paid_online_booking_room_assignment(pool, booking_id).await {
        log::error!(
            "Failed to queue room assignment notification for booking {}: {}",
            booking_id,
            error
        );
    }
}

pub async fn recompute_payment_status(pool: &DbPool, booking_id: i64) -> Result<(), ApiError> {
    PaymentRepository::recompute_booking_payment_status(pool, booking_id).await
}

pub async fn recompute_payment_status_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<(), ApiError> {
    PaymentRepository::recompute_booking_payment_status_tx(tx, booking_id).await
}

pub async fn calculate_payment_summary(
    pool: &DbPool,
    booking_id: i64,
) -> Result<PaymentSummary, ApiError> {
    let stay = PaymentRepository::payment_booking_stay(pool, booking_id).await?;
    let pricing = PaymentRepository::room_pricing(pool, stay.room_id).await?;

    let nights = (stay.check_out - stay.check_in).num_days();
    let subtotal = pricing.base_price * Decimal::from(nights);
    let service_charge = (subtotal * pricing.service_charge_percentage) / Decimal::from(100);
    let tax_amount = Decimal::ZERO;
    let total = subtotal + service_charge + tax_amount + pricing.keycard_deposit;

    Ok(PaymentSummary {
        subtotal,
        service_charge,
        service_charge_percentage: pricing.service_charge_percentage,
        tax_amount,
        tax_percentage: Decimal::ZERO,
        keycard_deposit: pricing.keycard_deposit,
        total_amount: total,
        payment_method: None,
    })
}

pub async fn create_payment(
    pool: &DbPool,
    user_id: i64,
    mut request: PaymentRequest,
) -> Result<Payment, ApiError> {
    request.idempotency_key = normalized_idempotency_key(&request.idempotency_key)?.to_string();
    let summary = calculate_payment_summary(pool, request.booking_id).await?;
    let payment_gateway = match &request.payment_method {
        PaymentMethod::Card => Some("card_processor"),
        PaymentMethod::Duitnow => Some("duitnow"),
        PaymentMethod::OnlineBanking => Some("online_banking"),
        _ => None,
    };

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    PaymentRepository::lock_booking_for_payment_tx(&mut tx, request.booking_id).await?;
    let completed_payment = PaymentRepository::create_completed_payment_tx(
        &mut tx,
        user_id,
        &request,
        &summary,
        payment_gateway,
    )
    .await?;
    let payment = completed_payment.payment;
    if !completed_payment.was_inserted {
        tx.commit().await.map_err(ApiError::from)?;
        return Ok(payment);
    }
    recompute_payment_status_tx(&mut tx, payment.booking_id).await?;
    tx.commit().await.map_err(ApiError::from)?;
    try_queue_paid_online_booking_room_assignment(pool, payment.booking_id).await;

    if let Err(err) = crate::modules::loyalty::service::award_eligible_booking_points(
        pool,
        payment.booking_id,
        Some(payment.id),
        Some(user_id),
    )
    .await
    {
        log::warn!(
            "Failed to award loyalty points for payment {} on booking {}: {}",
            payment.id,
            payment.booking_id,
            err
        );
    }

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "payment_created",
            resource_type: "payment",
            resource_id: Some(payment.id),
            details: Some(serde_json::json!({
                "booking_id": payment.booking_id,
                "amount": payment.total_amount,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(payment)
}

pub async fn record_payment(
    pool: &DbPool,
    user_id: i64,
    mut request: RecordPaymentRequest,
) -> Result<serde_json::Value, ApiError> {
    request.idempotency_key = normalized_idempotency_key(&request.idempotency_key)?.to_string();
    let amount = Decimal::from_f64_retain(request.amount)
        .ok_or_else(|| ApiError::BadRequest("Invalid amount".to_string()))?;

    let payment_type = request.payment_type.as_deref().unwrap_or("booking");
    let fingerprint = PaymentRepository::canonical_payment_fingerprint(
        request.booking_id,
        Some(amount),
        &request.payment_method,
        payment_type,
        request.transaction_reference.as_deref(),
        request.notes.as_deref(),
        request.payment_date.as_deref(),
    );

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    PaymentRepository::lock_booking_for_payment_tx(&mut tx, request.booking_id).await?;

    if let Some(transaction_reference) = request
        .transaction_reference
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        PaymentRepository::lock_transaction_references_tx(&mut tx, &[transaction_reference])
            .await?;
        let mut matches =
            PaymentRepository::list_keyed_reference_payments_tx(&mut tx, transaction_reference)
                .await?;
        if matches.len() > 1 {
            return Err(ApiError::Conflict(
                "Transaction reference has multiple existing payment owners".to_string(),
            ));
        }
        if let Some(existing) = matches.pop() {
            if existing.idempotency_fingerprint.as_deref() == Some(fingerprint.as_str()) {
                return Ok(existing.into_response());
            }
            return Err(ApiError::Conflict(
                "Transaction reference was already used with different payment data".to_string(),
            ));
        }
    }

    if let Some(existing) = PaymentRepository::find_idempotent_payment_tx(
        &mut tx,
        request.booking_id,
        &request.idempotency_key,
    )
    .await?
    {
        if existing.idempotency_fingerprint.as_deref() == Some(fingerprint.as_str()) {
            return Ok(existing.into_response());
        }
        return Err(ApiError::Conflict(
            "Idempotency key was already used with different payment data".to_string(),
        ));
    }

    // Whether this payment settles the booking's outstanding balance in full —
    // if so, and the booking is still `pending` (a guest self-service booking
    // awaiting payment), staff recording a desk payment (e.g. cash/card at
    // walk-in check-in) must confirm it, the same as an approved bank-transfer
    // claim or captured PayPal payment would. Without this, a guest who elects
    // to pay in person instead of online would be stuck: the booking never
    // leaves `pending` and check-in now requires `confirmed`.
    let mut settles_balance_in_full = false;

    // A booking room-charge payment can never exceed the outstanding balance.
    // This also blocks recording any payment once the booking is fully settled
    // (balance is zero). Deposit/refund flows are intentionally exempt.
    if payment_type == "booking" {
        if amount <= Decimal::ZERO {
            return Err(ApiError::BadRequest(
                "Payment amount must be positive".to_string(),
            ));
        }

        if let Some(summary) =
            PaymentRepository::workflow_summary_row(&mut *tx, request.booking_id).await?
        {
            // Validate against the full invoiced amount (room + tourism tax +
            // extra bed), not the room-only `total_amount`. Otherwise a booking
            // whose room charge is fully paid would reject collection of the
            // tourism tax / extra bed that the checkout invoice still bills.
            let billable_total = summary.billable_total();
            let balance_due = if billable_total > summary.total_paid {
                billable_total - summary.total_paid
            } else {
                Decimal::ZERO
            };
            // Allow a sub-cent rounding tolerance to match the frontend guard.
            let tolerance = Decimal::new(5, 3); // 0.005
            if amount > balance_due + tolerance {
                return Err(ApiError::BadRequest(format!(
                    "Payment amount cannot exceed the outstanding balance of {balance_due}"
                )));
            }
            settles_balance_in_full = amount + tolerance >= balance_due;
        }
    }

    let created_at_override = request
        .payment_date
        .as_ref()
        .map(|d| format!("{} 12:00:00", d));

    let recorded_payment = PaymentRepository::record_payment(
        &mut tx,
        user_id,
        &request,
        amount,
        payment_type,
        created_at_override.as_deref(),
    )
    .await?;
    if !recorded_payment.was_inserted {
        return Ok(recorded_payment.row.into_response());
    }
    let row = recorded_payment.row;

    recompute_payment_status_tx(&mut tx, request.booking_id).await?;

    if payment_type == "booking" && settles_balance_in_full {
        let confirmed =
            crate::repositories::bookings::confirm_booking_tx(&mut tx, request.booking_id).await?;
        if confirmed {
            crate::repositories::bookings::record_booking_history_tx(
                &mut tx,
                request.booking_id,
                Some("pending"),
                "confirmed",
                Some(user_id),
                Some("Payment recorded in full"),
                serde_json::json!({ "payment_id": row.id }),
            )
            .await?;
        }
    }

    let booking_id = row.booking_id;
    let payment_id = row.id;
    tx.commit().await.map_err(ApiError::from)?;
    try_queue_paid_online_booking_room_assignment(pool, booking_id).await;

    if let Err(err) = crate::modules::loyalty::service::award_eligible_booking_points(
        pool,
        booking_id,
        Some(payment_id),
        Some(user_id),
    )
    .await
    {
        log::warn!(
            "Failed to award loyalty points for payment {} on booking {}: {}",
            payment_id,
            booking_id,
            err
        );
    }

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "payment_recorded",
            resource_type: "payment",
            resource_id: Some(payment_id),
            details: Some(serde_json::json!({
                "booking_id": booking_id,
                "amount": request.amount,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(row.into_response())
}

pub async fn get_all_payments(
    pool: &DbPool,
    booking_id: i64,
) -> Result<Vec<serde_json::Value>, ApiError> {
    Ok(PaymentRepository::list_payment_entries(pool, booking_id)
        .await?
        .into_iter()
        .map(|row| row.into_response())
        .collect())
}

pub async fn get_payment_workflow_summary(
    pool: &DbPool,
    booking_id: i64,
) -> Result<PaymentWorkflowSummary, ApiError> {
    let row = PaymentRepository::workflow_summary_row(pool, booking_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    // Report against the full invoiced amount (room + tourism tax + extra bed)
    // so the summary's balance mirrors what the checkout invoice bills.
    let billable_total = row.billable_total();
    let balance_due = if billable_total > row.total_paid {
        billable_total - row.total_paid
    } else {
        Decimal::ZERO
    };

    let mut warnings = Vec::new();
    if row.has_failed_payment {
        warnings.push("One or more payments failed and need review".to_string());
    }
    if balance_due > Decimal::ZERO {
        warnings.push(format!("Outstanding balance: {}", balance_due));
    }
    if row.deposit_collected > row.deposit_refunded
        && matches!(row.booking_status.as_str(), "checked_out" | "completed")
    {
        warnings.push("Collected deposit has not been fully refunded".to_string());
    }
    if row.total_refunded > row.total_paid {
        warnings.push("Refund total is greater than collected payments".to_string());
    }

    let next_action = if row.booking_status == "voided" {
        "No payment action - booking is voided".to_string()
    } else if row.has_failed_payment {
        "Review failed payment".to_string()
    } else if balance_due > Decimal::ZERO {
        "Collect balance due".to_string()
    } else if row.deposit_collected > row.deposit_refunded
        && matches!(row.booking_status.as_str(), "checked_out" | "completed")
    {
        "Refund deposit".to_string()
    } else {
        "Settled".to_string()
    };

    Ok(PaymentWorkflowSummary {
        booking_id,
        booking_status: row.booking_status,
        payment_status: row.payment_status,
        total_amount: billable_total,
        total_paid: row.total_paid,
        total_refunded: row.total_refunded,
        balance_due,
        deposit_collected: row.deposit_collected,
        deposit_refunded: row.deposit_refunded,
        has_failed_payment: row.has_failed_payment,
        next_action,
        warnings,
    })
}

pub async fn refund_deposit(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
    body: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    let payment_method = body
        .get("payment_method")
        .and_then(|v| v.as_str())
        .unwrap_or("cash")
        .to_string();

    let deposit_amount_f64 = body.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let deposit_amount = Decimal::from_f64_retain(deposit_amount_f64).unwrap_or(Decimal::ZERO);

    if deposit_amount <= Decimal::ZERO {
        return Err(ApiError::BadRequest(
            "No deposit amount provided".to_string(),
        ));
    }

    let row = PaymentRepository::refund_deposit(
        pool,
        user_id,
        booking_id,
        &payment_method,
        deposit_amount,
    )
    .await?;

    recompute_payment_status(pool, booking_id).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "payment_refunded",
            resource_type: "payment",
            resource_id: Some(row.id),
            details: Some(serde_json::json!({
                "booking_id": booking_id,
                "amount": deposit_amount_f64,
                "payment_method": payment_method,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(serde_json::json!({
        "id": row.id,
        "booking_id": row.booking_id,
        "total_amount": row.total_amount,
        "payment_method": row.payment_method,
        "payment_type": row.payment_type,
        "payment_status": row.payment_status,
        "notes": row.notes,
        "created_at": row.created_at,
    }))
}

/// Revert a keycard deposit refund that was recorded by mistake.
///
/// Removes the refund payment row and recomputes the booking's payment status
/// so the deposit is presented as not-yet-refunded again.
pub async fn revert_deposit_refund(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
) -> Result<serde_json::Value, ApiError> {
    let reverted_payment_id = PaymentRepository::revert_deposit_refund(pool, booking_id).await?;

    recompute_payment_status(pool, booking_id).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "payment_refund_reverted",
            resource_type: "payment",
            resource_id: Some(reverted_payment_id),
            details: Some(serde_json::json!({
                "booking_id": booking_id,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(serde_json::json!({
        "booking_id": booking_id,
        "reverted_payment_id": reverted_payment_id,
        "deposit_refunded": false,
    }))
}

pub async fn get_payment(pool: &DbPool, booking_id: i64) -> Result<Option<Payment>, ApiError> {
    PaymentRepository::find_by_booking_id(pool, booking_id).await
}

pub async fn generate_invoice(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
) -> Result<Invoice, ApiError> {
    if let Some(invoice) = PaymentRepository::find_invoice_by_booking_id(pool, booking_id).await? {
        return Ok(invoice);
    }

    let invoice_number = crate::services::invoice_numbers::next_invoice_number(pool).await?;
    let invoice =
        PaymentRepository::create_generated_invoice(pool, user_id, booking_id, &invoice_number)
            .await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "invoice_generated",
            resource_type: "invoice",
            resource_id: Some(invoice.id),
            details: Some(serde_json::json!({
                "booking_id": booking_id,
                "invoice_number": invoice_number,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(invoice)
}

pub async fn get_invoice_preview(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
) -> Result<InvoicePreview, ApiError> {
    let invoice = match PaymentRepository::find_invoice_by_booking_id(pool, booking_id).await? {
        Some(invoice) => invoice,
        None => generate_invoice(pool, user_id, booking_id).await?,
    };

    let payment = PaymentRepository::find_by_booking_id(pool, booking_id).await?;
    let booking_details = serde_json::json!({
        "booking_id": booking_id,
        "check_in": invoice.check_in_date,
        "check_out": invoice.check_out_date,
        "nights": invoice.number_of_nights,
        "room": format!("{} ({})", invoice.room_number.as_ref().unwrap_or(&"N/A".to_string()), invoice.room_type.as_ref().unwrap_or(&"N/A".to_string()))
    });

    Ok(InvoicePreview {
        invoice,
        payment,
        booking_details,
    })
}

pub async fn get_user_invoices(pool: &DbPool, user_id: i64) -> Result<Vec<Invoice>, ApiError> {
    PaymentRepository::find_user_invoices(pool, user_id).await
}

pub async fn update_payment(
    pool: &DbPool,
    user_id: i64,
    payment_id: i64,
    request: UpdatePaymentRequest,
) -> Result<serde_json::Value, ApiError> {
    let booking_id = PaymentRepository::payment_booking_id(pool, payment_id).await?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    PaymentRepository::lock_booking_for_payment_tx(&mut tx, booking_id).await?;
    let row =
        PaymentRepository::update_payment_tx(&mut tx, booking_id, payment_id, &request).await?;
    recompute_payment_status_tx(&mut tx, booking_id).await?;
    tx.commit().await.map_err(ApiError::from)?;
    try_queue_paid_online_booking_room_assignment(pool, row.booking_id).await;
    if let Err(err) = crate::modules::loyalty::service::award_eligible_booking_points(
        pool,
        row.booking_id,
        Some(row.id),
        None,
    )
    .await
    {
        log::warn!(
            "Failed to reconcile loyalty points for updated payment {}: {}",
            payment_id,
            err
        );
    }

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "payment_updated",
            resource_type: "payment",
            resource_id: Some(row.id),
            details: Some(serde_json::json!({
                "booking_id": row.booking_id,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(row.into_response())
}

pub async fn delete_payment(
    pool: &DbPool,
    user_id: i64,
    payment_id: i64,
) -> Result<serde_json::Value, ApiError> {
    let booking_id = PaymentRepository::payment_booking_id(pool, payment_id).await?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    PaymentRepository::lock_booking_for_payment_tx(&mut tx, booking_id).await?;
    PaymentRepository::delete_payment_tx(&mut tx, booking_id, payment_id).await?;
    recompute_payment_status_tx(&mut tx, booking_id).await?;
    tx.commit().await.map_err(ApiError::from)?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "payment_deleted",
            resource_type: "payment",
            resource_id: Some(payment_id),
            details: Some(serde_json::json!({
                "booking_id": booking_id,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(serde_json::json!({
        "success": true,
        "message": "Payment deleted successfully",
        "deleted_id": payment_id
    }))
}

/// Ensure a checkout invoice row exists for a booking, transaction-scoped.
///
/// Idempotent: returns the existing invoice number if one is already linked
/// (via the `invoices` table or a prior `customer_ledgers` posting), otherwise
/// allocates the next number and inserts the invoice row. Every read and the
/// insert run on the caller's transaction so the checkout invoice commits
/// atomically with the company ledger posting.
pub async fn ensure_invoice_for_booking(
    pool: &DbPool,
    booking_id: i64,
    user_id: i64,
) -> Result<String, ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let result = ensure_invoice_for_booking_tx(&mut tx, booking_id, user_id).await;
    if result.is_ok() {
        tx.commit().await.map_err(ApiError::from)?;
    }
    result
}

pub async fn ensure_invoice_for_booking_tx(
    tx: &mut crate::core::db::DbTransaction<'_>,
    booking_id: i64,
    user_id: i64,
) -> Result<String, ApiError> {
    if let Some(invoice_number) =
        PaymentRepository::existing_invoice_number(&mut **tx, booking_id).await?
    {
        return Ok(invoice_number);
    }

    let invoice_number =
        match PaymentRepository::ledger_invoice_number(&mut **tx, booking_id).await? {
            Some(number) => number,
            None => crate::services::invoice_numbers::next_invoice_number(&mut **tx).await?,
        };

    PaymentRepository::insert_checkout_invoice(&mut **tx, booking_id, user_id, &invoice_number)
        .await?;

    Ok(invoice_number)
}

// ===========================================================================
// Guest-portal payments: manual bank-transfer claims + PayPal + staff review
// ===========================================================================

/// Last-resort settlement currency. Only used when a booking's `currency` column
/// is somehow absent/empty (Postgres allows NULL — the column is
/// `varchar(3) DEFAULT 'USD'` with no NOT NULL constraint). The real currency is
/// read from `booking.currency` (populated by the guest-portal `BOOKING_SELECT`).
const DEFAULT_CURRENCY: &str = "USD";

/// The booking's real settlement currency, falling back to [`DEFAULT_CURRENCY`]
/// only when the column is NULL/empty. This threads `bookings.currency` through
/// to the PayPal order amount and the recorded payment so non-USD bookings are
/// charged and recorded in their own currency.
fn booking_currency(booking: &Booking) -> &str {
    match booking.currency.as_deref() {
        Some(c) if !c.trim().is_empty() => c,
        _ => DEFAULT_CURRENCY,
    }
}

/// Public, unauthenticated payment configuration for the guest portal payment
/// panel. The PayPal client id is public by design and only present when the
/// integration is fully configured.
pub fn guest_payment_config() -> GuestPaymentConfig {
    let cfg = crate::core::config::get();
    GuestPaymentConfig {
        paypal_enabled: crate::services::paypal_client::is_enabled(),
        paypal_client_id: cfg.paypal.public_client_id(),
        bank_details: GuestBankDetails {
            bank_name: cfg.bank_details.bank_name.clone(),
            account_name: cfg.bank_details.account_name.clone(),
            account_number: cfg.bank_details.account_number.clone(),
        },
    }
}

/// Guard: a guest may only initiate payment while the booking is still awaiting
/// it (`status = 'pending_payment'`). Anything else (already confirmed/checked-in,
/// cancelled, voided) is a no-op the caller should reject.
fn ensure_booking_awaiting_payment(status: &str) -> Result<(), ApiError> {
    if matches!(status, "pending" | "pending_payment") {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "This booking is not awaiting payment.".to_string(),
        ))
    }
}

/// Guard: reject a new guest payment attempt when the booking already has a
/// `booking`-type payment that is pending, processing, or completed. Prevents
/// duplicate claims / orders (and the resulting double approval) for one booking.
async fn ensure_no_active_booking_payment_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
) -> Result<(), ApiError> {
    if PaymentRepository::has_active_or_completed_booking_payment_tx(tx, booking_id).await? {
        return Err(ApiError::Conflict(
            "A payment for this booking is already pending or completed.".to_string(),
        ));
    }
    Ok(())
}

/// Create a manual bank-transfer payment claim (no proof required). Inserts a
/// `pending` payment for the full booking total; staff later approve/reject it.
pub async fn create_bank_transfer_claim(
    pool: &DbPool,
    booking: &Booking,
) -> Result<PaymentActionResponse, ApiError> {
    let currency = booking_currency(booking);
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    PaymentRepository::lock_booking_for_payment_tx(&mut tx, booking.id).await?;
    let status = PaymentRepository::booking_status_for_payment_tx(&mut tx, booking.id).await?;
    ensure_booking_awaiting_payment(&status)?;
    ensure_no_active_booking_payment_tx(&mut tx, booking.id).await?;

    let payment_id = PaymentRepository::insert_pending_payment_tx(
        &mut tx,
        PendingPaymentValues {
            booking_id: booking.id,
            guest_id: booking.guest_id,
            amount: booking.total_amount,
            currency,
            payment_method: &PaymentMethod::BankTransfer.to_string(),
            payment_gateway: None,
            gateway_order_id: None,
            description: Some("Guest-submitted bank transfer claim (pending staff review)"),
            created_by: None,
        },
    )
    .await?;

    let moved_to_confirmation =
        crate::repositories::bookings::move_booking_to_pending_confirmation_tx(&mut tx, booking.id)
            .await?;
    if moved_to_confirmation {
        crate::repositories::bookings::record_booking_history_tx(
            &mut tx,
            booking.id,
            Some(&booking.status),
            "pending_confirmation",
            None,
            Some("Bank transfer submitted for staff confirmation"),
            serde_json::json!({ "payment_id": payment_id }),
        )
        .await?;
    }

    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: None,
            action: "payment_created",
            resource_type: "payment",
            resource_id: Some(payment_id),
            details: Some(serde_json::json!({
                "booking_id": booking.id,
                "amount": booking.total_amount.to_string(),
                "method": "bank_transfer",
                "source": "guest_portal",
            })),
            ..Default::default()
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;

    Ok(PaymentActionResponse {
        payment_id,
        status: "pending".to_string(),
        booking_status: Some("pending_confirmation".to_string()),
    })
}

/// Create a PayPal order for a booking and return the order id + our internal
/// payment id. Inserts a `pending` PayPal payment first (so the id can be
/// embedded in PayPal's `custom_id`), then records the returned order id.
pub async fn create_paypal_order(
    pool: &DbPool,
    booking: &Booking,
) -> Result<PaypalCreateOrderResponse, ApiError> {
    let currency = booking_currency(booking);
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    PaymentRepository::lock_booking_for_payment_tx(&mut tx, booking.id).await?;
    let status = PaymentRepository::booking_status_for_payment_tx(&mut tx, booking.id).await?;
    ensure_booking_awaiting_payment(&status)?;
    ensure_no_active_booking_payment_tx(&mut tx, booking.id).await?;

    let payment_id = PaymentRepository::insert_pending_payment_tx(
        &mut tx,
        PendingPaymentValues {
            booking_id: booking.id,
            guest_id: booking.guest_id,
            amount: booking.total_amount,
            currency,
            payment_method: &PaymentMethod::Paypal.to_string(),
            payment_gateway: Some("paypal"),
            gateway_order_id: None,
            description: Some("PayPal order (awaiting capture)"),
            created_by: None,
        },
    )
    .await?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: None,
            action: "payment_created",
            resource_type: "payment",
            resource_id: Some(payment_id),
            details: Some(serde_json::json!({
                "booking_id": booking.id,
                "amount": booking.total_amount.to_string(),
                "method": "paypal",
                "source": "guest_portal",
            })),
            ..Default::default()
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;

    let custom_id = format!("{}:{}", booking.id, payment_id);
    // The database record must be committed before PayPal can receive its id in
    // `custom_id`. If PayPal cannot create the external order, immediately move
    // that local record to a terminal state so it cannot block the guest from
    // trying again.
    let order_id = match crate::services::paypal_client::create_order(
        booking.total_amount,
        currency,
        &custom_id,
    )
    .await
    {
        Ok(order_id) => order_id,
        Err(error) => {
            release_failed_paypal_payment(
                pool,
                payment_id,
                "PayPal could not create an order. No payment was captured.",
            )
            .await?;
            return Err(error);
        }
    };

    PaymentRepository::set_payment_gateway_order(pool, payment_id, &order_id).await?;

    Ok(PaypalCreateOrderResponse {
        order_id,
        payment_id,
    })
}

/// Capture a PayPal order and, on `COMPLETED`, complete the payment and confirm
/// the booking atomically. `payment_id` must belong to `booking`.
pub async fn capture_paypal_payment(
    pool: &DbPool,
    booking: &Booking,
    order_id: &str,
    payment_id: i64,
) -> Result<PaymentActionResponse, ApiError> {
    // Validate the payment belongs to this booking before touching PayPal.
    let review = PaymentRepository::get_payment_for_review(pool, payment_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if review.booking_id != booking.id {
        return Err(ApiError::Forbidden(
            "Payment does not belong to this booking.".to_string(),
        ));
    }

    // Capturing an already-completed PayPal order is a normal retry scenario
    // (for example when the browser lost the first response). Return the same
    // successful result rather than attempting a second settlement.
    if review.status == "completed" {
        return Ok(PaymentActionResponse {
            payment_id,
            status: "completed".to_string(),
            booking_status: Some("confirmed".to_string()),
        });
    }
    if review.status != "pending" && review.status != "processing" {
        return Err(ApiError::BadRequest(
            "This PayPal payment is no longer available for capture.".to_string(),
        ));
    }

    let outcome = crate::services::paypal_client::capture_order(order_id).await?;
    if outcome.status != "COMPLETED" {
        release_failed_paypal_payment(
            pool,
            payment_id,
            &format!(
                "PayPal returned {} before completing the payment.",
                outcome.status
            ),
        )
        .await?;
        return Err(ApiError::BadRequest(format!(
            "PayPal payment was not completed (status: {}).",
            outcome.status
        )));
    }

    // custom_id is MANDATORY: PayPal must echo back exactly the
    // "<booking_id>:<payment_id>" we set on the order. A missing or mismatched
    // value means this capture cannot be trusted to settle this payment.
    let expected_custom_id = format!("{}:{}", booking.id, payment_id);
    match outcome.custom_id.as_deref() {
        Some(custom_id) if custom_id == expected_custom_id => {}
        other => {
            log::error!(
                "PayPal capture custom_id mismatch: expected {expected_custom_id}, got {other:?}"
            );
            release_failed_paypal_payment(
                pool,
                payment_id,
                "PayPal order did not match the booking payment.",
            )
            .await?;
            return Err(ApiError::BadRequest(
                "PayPal order does not match this booking.".to_string(),
            ));
        }
    }

    // Verify the money that actually moved against the payment row's stored
    // amount — the amount the PayPal order was created for — not the booking
    // total, which staff may have edited while the order was outstanding.
    // Currency still comes from the booking (payments do not store one).
    if let Err(reason) =
        verify_captured_against_stored(&outcome, &review.amount, booking_currency(booking))
    {
        log::error!("PayPal capture amount/currency mismatch for payment {payment_id}: {reason}");
        // The capture already settled at PayPal — do NOT mark the payment
        // failed: a failed row reopens payment creation and would invite a
        // second charge. Leave it pending and flag it for staff, exactly like
        // the webhook path does on the same disagreement.
        AuditLog::log_event(
            pool,
            AuditEvent {
                user_id: None,
                action: "paypal_capture_conflict",
                resource_type: "payment",
                resource_id: Some(payment_id),
                details: Some(serde_json::json!({
                    "source": "paypal_capture",
                    "order_id": order_id,
                    "booking_id": booking.id,
                    "reason": reason,
                })),
                ..Default::default()
            },
        )
        .await?;
        return Err(ApiError::Conflict(
            "The captured PayPal payment does not match this booking's payment record. It has been flagged for hotel staff to review — please do not pay again.".to_string(),
        ));
    }

    match complete_and_confirm(pool, payment_id, booking.id, None, "payment_captured").await {
        Err(ApiError::BadRequest(_)) => {
            // The webhook reconciliation path can complete this payment between
            // our capture call and this transaction. Losing that race is
            // success, not an error, from the guest's point of view.
            let now = PaymentRepository::get_payment_for_review(pool, payment_id).await?;
            if now.as_ref().is_some_and(|p| p.status == "completed") {
                Ok(PaymentActionResponse {
                    payment_id,
                    status: "completed".to_string(),
                    booking_status: Some("confirmed".to_string()),
                })
            } else {
                Err(ApiError::BadRequest(
                    "This PayPal payment is no longer available for capture.".to_string(),
                ))
            }
        }
        other => other,
    }
}

/// Release a PayPal attempt that definitively did not complete. This is kept
/// separate from network/transport failures: when the outcome is unknown we
/// retain the pending row, because marking it failed could invite a duplicate
/// charge. A concrete non-COMPLETED response, malformed matching data, or a
/// failed order creation can safely become retryable. Returns whether the
/// payment actually transitioned to `failed` (false when a concurrent update
/// already moved it out of pending/processing).
async fn release_failed_paypal_payment(
    pool: &DbPool,
    payment_id: i64,
    reason: &str,
) -> Result<bool, ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let updated = PaymentRepository::mark_payment_failed_tx(&mut tx, payment_id, reason).await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(updated.is_some())
}

/// Compare a PayPal capture's echoed amount/currency against what we expect for
/// the booking. Uses a numeric (`Decimal`) comparison so legitimate string
/// formatting differences (`"100"` vs `"100.00"`) do not trip the check.
/// Returns `Err(reason)` describing the mismatch.
fn verify_captured_amount(
    outcome: &crate::services::paypal_client::PaypalCaptureOutcome,
    expected_amount: Decimal,
    expected_currency: &str,
) -> Result<(), String> {
    let captured_amount = outcome
        .captured_amount
        .as_deref()
        .ok_or_else(|| "PayPal capture response did not include an amount.".to_string())?;
    let captured_currency = outcome
        .captured_currency
        .as_deref()
        .ok_or_else(|| "PayPal capture response did not include a currency.".to_string())?;

    let parsed = Decimal::from_str_exact(captured_amount.trim())
        .map_err(|_| format!("Unparseable captured amount '{captured_amount}'."))?;
    if parsed != expected_amount {
        return Err(format!(
            "Captured amount {parsed} does not match expected {expected_amount}."
        ));
    }
    if !captured_currency.eq_ignore_ascii_case(expected_currency) {
        return Err(format!(
            "Captured currency {captured_currency} does not match expected {expected_currency}."
        ));
    }
    Ok(())
}

/// Verify a capture against the payment row's stored text amount. The stored
/// amount is authoritative for PayPal captures: it is what the order was
/// created for, immune to booking edits made while the order was outstanding.
fn verify_captured_against_stored(
    outcome: &crate::services::paypal_client::PaypalCaptureOutcome,
    stored_amount: &str,
    expected_currency: &str,
) -> Result<(), String> {
    let expected = Decimal::from_str_exact(stored_amount.trim())
        .map_err(|_| "Stored payment amount is unparseable.".to_string())?;
    verify_captured_amount(outcome, expected, expected_currency)
}

/// The webhook event types this system acts on. Everything else is
/// acknowledged and audit-logged by the handler without reaching here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaypalWebhookKind {
    CaptureCompleted,
    CaptureDenied,
}

impl PaypalWebhookKind {
    fn event_type(self) -> &'static str {
        match self {
            Self::CaptureCompleted => "PAYMENT.CAPTURE.COMPLETED",
            Self::CaptureDenied => "PAYMENT.CAPTURE.DENIED",
        }
    }
}

/// A signature-verified PayPal webhook event reduced to the fields this system
/// acts on. `booking_id`/`payment_id` come from the order's `custom_id`
/// (`"<booking_id>:<payment_id>"`) that `create_paypal_order` set.
pub struct PaypalWebhookEvent {
    pub kind: PaypalWebhookKind,
    pub event_id: String,
    pub capture_id: Option<String>,
    pub booking_id: i64,
    pub payment_id: i64,
    pub captured_amount: Option<String>,
    pub captured_currency: Option<String>,
    pub client_ip: Option<String>,
}

/// Outcome of applying a verified PayPal webhook event to local records. Every
/// variant answers HTTP 200 to PayPal — redelivery cannot fix any of the
/// non-`Applied` cases, and the audit trail is the operator-facing flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaypalWebhookApplyOutcome {
    /// The event changed local state (payment completed or marked failed).
    Applied,
    /// Local state already reflected the event (duplicate delivery, or the
    /// synchronous capture path won the race).
    AlreadyApplied,
    /// The event references a payment this system cannot act on; the reason
    /// is in the audit log.
    Ignored,
    /// The event disagrees with local money state in a way that needs staff
    /// review; the reason is in the audit log. Money state is deliberately
    /// left untouched — never guess on a disagreement about funds.
    ConflictFlagged,
}

impl PaypalWebhookApplyOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::AlreadyApplied => "already_applied",
            Self::Ignored => "ignored",
            Self::ConflictFlagged => "conflict_flagged",
        }
    }
}

/// Apply a signature-verified PayPal webhook event to local payment state.
///
/// This is the asynchronous counterpart to `capture_paypal_payment`: it closes
/// the gap where PayPal finished a capture but the synchronous response never
/// reached us (crash, timeout), leaving money moved with the local payment
/// still `pending`. All transitions are idempotent, and any disagreement with
/// local money state is audited and left for staff instead of guessed at.
pub async fn apply_paypal_webhook_event(
    pool: &DbPool,
    event: &PaypalWebhookEvent,
) -> Result<PaypalWebhookApplyOutcome, ApiError> {
    let Some(review) = PaymentRepository::get_payment_for_review(pool, event.payment_id).await?
    else {
        audit_paypal_webhook(
            pool,
            event,
            "paypal_webhook_ignored",
            "No payment with this id exists.",
        )
        .await?;
        return Ok(PaypalWebhookApplyOutcome::Ignored);
    };
    if review.booking_id != event.booking_id {
        log::warn!(
            "PayPal webhook {}: custom_id names booking {} but payment {} belongs to booking {}",
            event.event_id,
            event.booking_id,
            event.payment_id,
            review.booking_id
        );
        audit_paypal_webhook(
            pool,
            event,
            "paypal_webhook_ignored",
            "custom_id booking does not match the payment's booking.",
        )
        .await?;
        return Ok(PaypalWebhookApplyOutcome::Ignored);
    }
    if review.payment_method != PaymentMethod::Paypal.to_string() {
        audit_paypal_webhook(
            pool,
            event,
            "paypal_webhook_ignored",
            "Payment is not a PayPal payment.",
        )
        .await?;
        return Ok(PaypalWebhookApplyOutcome::Ignored);
    }

    match event.kind {
        PaypalWebhookKind::CaptureCompleted => {
            apply_webhook_capture_completed(pool, event, &review).await
        }
        PaypalWebhookKind::CaptureDenied => {
            apply_webhook_capture_denied(pool, event, &review).await
        }
    }
}

/// `PAYMENT.CAPTURE.COMPLETED`: the money already moved at PayPal. Make the
/// local records reflect that via the same completion path the synchronous
/// capture uses, after re-verifying the amount against the booking.
async fn apply_webhook_capture_completed(
    pool: &DbPool,
    event: &PaypalWebhookEvent,
    review: &PendingPaymentEntry,
) -> Result<PaypalWebhookApplyOutcome, ApiError> {
    if review.status == "completed" {
        audit_paypal_webhook(
            pool,
            event,
            "paypal_webhook_duplicate",
            "Payment already completed.",
        )
        .await?;
        return Ok(PaypalWebhookApplyOutcome::AlreadyApplied);
    }
    if review.status != "pending" && review.status != "processing" {
        // Money moved at PayPal but the local row is terminal (for example
        // marked failed after a non-COMPLETED synchronous response). Staff
        // must reconcile; silently un-failing a payment is not this system's
        // call to make.
        audit_paypal_webhook(
            pool,
            event,
            "paypal_webhook_conflict",
            &format!(
                "Capture completed at PayPal but the local payment is '{}'.",
                review.status
            ),
        )
        .await?;
        return Ok(PaypalWebhookApplyOutcome::ConflictFlagged);
    }

    // Verify against the payment row's own amount — the amount the PayPal
    // order was created for — not the booking total, which staff may have
    // edited while the order was outstanding. Currency still comes from the
    // booking (payments do not store one).
    let Ok(expected_amount) = Decimal::from_str_exact(review.amount.trim()) else {
        audit_paypal_webhook(
            pool,
            event,
            "paypal_webhook_conflict",
            "Stored payment amount is unparseable.",
        )
        .await?;
        return Ok(PaypalWebhookApplyOutcome::ConflictFlagged);
    };
    let booking = GuestPortalRepository::find_booking_by_id(pool, event.booking_id).await?;
    let echoed = crate::services::paypal_client::PaypalCaptureOutcome {
        status: "COMPLETED".to_string(),
        // verify_captured_amount ignores custom_id; the ids were already
        // derived from it upstream.
        custom_id: None,
        captured_amount: event.captured_amount.clone(),
        captured_currency: event.captured_currency.clone(),
    };
    if let Err(reason) = verify_captured_amount(&echoed, expected_amount, booking_currency(&booking))
    {
        log::error!(
            "PayPal webhook {} amount mismatch for payment {}: {reason}",
            event.event_id,
            event.payment_id
        );
        // Unlike the synchronous path, the capture has already settled — do
        // NOT mark the payment failed; flag it for staff instead.
        audit_paypal_webhook(pool, event, "paypal_webhook_conflict", &reason).await?;
        return Ok(PaypalWebhookApplyOutcome::ConflictFlagged);
    }

    match complete_and_confirm(pool, event.payment_id, event.booking_id, None, "payment_captured")
        .await
    {
        Ok(_) => {
            audit_paypal_webhook(
                pool,
                event,
                "paypal_webhook_applied",
                "Capture completed; payment completed and booking confirmed.",
            )
            .await?;
            Ok(PaypalWebhookApplyOutcome::Applied)
        }
        Err(ApiError::BadRequest(_)) => {
            // The completion CAS lost a race between our status read and the
            // transaction. Re-read to tell "sync path won" from a real conflict.
            let now = PaymentRepository::get_payment_for_review(pool, event.payment_id).await?;
            if now.as_ref().is_some_and(|p| p.status == "completed") {
                audit_paypal_webhook(
                    pool,
                    event,
                    "paypal_webhook_duplicate",
                    "Payment was completed concurrently.",
                )
                .await?;
                Ok(PaypalWebhookApplyOutcome::AlreadyApplied)
            } else {
                audit_paypal_webhook(
                    pool,
                    event,
                    "paypal_webhook_conflict",
                    "Payment left pending concurrently with a completed capture.",
                )
                .await?;
                Ok(PaypalWebhookApplyOutcome::ConflictFlagged)
            }
        }
        Err(ApiError::Conflict(_)) => {
            // A different completed payment already covers this booking, yet
            // PayPal verified a second settled capture: possible double charge.
            audit_paypal_webhook(
                pool,
                event,
                "paypal_webhook_conflict",
                "Booking already has a different completed payment; possible double capture.",
            )
            .await?;
            Ok(PaypalWebhookApplyOutcome::ConflictFlagged)
        }
        Err(error) => Err(error),
    }
}

/// `PAYMENT.CAPTURE.DENIED`: PayPal definitively refused the capture, so a
/// still-open local payment can safely become retryable (`failed`), exactly
/// like the synchronous path's handling of a non-COMPLETED response.
async fn apply_webhook_capture_denied(
    pool: &DbPool,
    event: &PaypalWebhookEvent,
    review: &PendingPaymentEntry,
) -> Result<PaypalWebhookApplyOutcome, ApiError> {
    match review.status.as_str() {
        "pending" | "processing" => {
            if release_failed_paypal_payment(pool, event.payment_id, "PayPal denied the capture.")
                .await?
            {
                audit_paypal_webhook(
                    pool,
                    event,
                    "paypal_webhook_applied",
                    "Capture denied; payment marked failed.",
                )
                .await?;
                Ok(PaypalWebhookApplyOutcome::Applied)
            } else {
                // The payment left pending/processing between our read and the
                // update — most likely completed concurrently, which now
                // disagrees with a verified denial. Flag it, don't guess.
                audit_paypal_webhook(
                    pool,
                    event,
                    "paypal_webhook_conflict",
                    "Payment changed state concurrently; denial was not applied.",
                )
                .await?;
                Ok(PaypalWebhookApplyOutcome::ConflictFlagged)
            }
        }
        "completed" => {
            audit_paypal_webhook(
                pool,
                event,
                "paypal_webhook_conflict",
                "Capture denied at PayPal but the local payment is completed.",
            )
            .await?;
            Ok(PaypalWebhookApplyOutcome::ConflictFlagged)
        }
        other => {
            audit_paypal_webhook(
                pool,
                event,
                "paypal_webhook_duplicate",
                &format!("Payment already in terminal state '{other}'."),
            )
            .await?;
            Ok(PaypalWebhookApplyOutcome::AlreadyApplied)
        }
    }
}

/// One audit row per webhook delivery outcome, carrying full provenance so
/// staff can trace any decision back to the exact PayPal event.
async fn audit_paypal_webhook(
    pool: &DbPool,
    event: &PaypalWebhookEvent,
    action: &str,
    reason: &str,
) -> Result<(), ApiError> {
    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: None,
            action,
            resource_type: "payment",
            resource_id: Some(event.payment_id),
            details: Some(serde_json::json!({
                "source": "paypal_webhook",
                "event_id": event.event_id,
                "event_type": event.kind.event_type(),
                "capture_id": event.capture_id,
                "booking_id": event.booking_id,
                "reason": reason,
            })),
            ip_address: event.client_ip.clone(),
            user_agent: None,
        },
    )
    .await
}

/// Staff action: approve a pending payment. Completes the payment AND confirms
/// the booking in one transaction.
pub async fn approve_payment(
    pool: &DbPool,
    actor_user_id: i64,
    payment_id: i64,
) -> Result<PaymentActionResponse, ApiError> {
    let review = PaymentRepository::get_payment_for_review(pool, payment_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if review.status != "pending" {
        return Err(ApiError::BadRequest(
            "Only pending payments can be approved.".to_string(),
        ));
    }

    complete_and_confirm(
        pool,
        payment_id,
        review.booking_id,
        Some(actor_user_id),
        "payment_approved",
    )
    .await
}

/// Staff action: request proof for an unresolved bank-transfer claim without
/// rejecting it. The claim remains pending for review; the request is safe to
/// repeat and is restricted by the payments approval permission at the route.
pub async fn request_payment_receipt(
    pool: &DbPool,
    actor_user_id: i64,
    payment_id: i64,
    message: Option<&str>,
) -> Result<(), ApiError> {
    let review = PaymentRepository::get_payment_for_review(pool, payment_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if review.status != "pending"
        || review.payment_method != PaymentMethod::BankTransfer.to_string()
    {
        return Err(ApiError::BadRequest(
            "A receipt can only be requested for a pending bank-transfer claim.".to_string(),
        ));
    }
    let message = message.map(str::trim).filter(|value| !value.is_empty());
    PaymentRepository::request_receipt(pool, payment_id, actor_user_id, message).await?;
    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action: "payment_receipt_requested",
            resource_type: "payment",
            resource_id: Some(payment_id),
            details: Some(serde_json::json!({ "booking_id": review.booking_id, "message": message })),
            ..Default::default()
        },
    )
    .await?;
    queue_payment_receipt_request_notification(
        pool,
        review.guest_id,
        review.guest_name.as_deref(),
        review.booking_number.as_deref(),
        payment_id,
        message,
    )
    .await;
    Ok(())
}

/// Notify the guest each time staff request or re-request proof of a bank transfer.
async fn queue_payment_receipt_request_notification(
    pool: &DbPool,
    guest_id: Option<i64>,
    guest_name: Option<&str>,
    booking_number: Option<&str>,
    payment_id: i64,
    message: Option<&str>,
) {
    let Some(guest_id) = guest_id else { return };
    let email = match CommunicationsRepository::get_guest_email(pool, guest_id).await {
        Ok(Some(email)) => email,
        Ok(None) => return,
        Err(error) => {
            log::error!("Failed to find guest email for payment receipt request: {error}");
            return;
        }
    };
    let booking = booking_number.unwrap_or("your booking");
    let message =
        message.unwrap_or("Please upload a clear receipt showing the transfer reference and date.");
    let subject = format!("Receipt requested for booking {booking}");
    let body_html = format!(
        "<p>Dear {},</p><p>Please upload your bank-transfer receipt for booking <strong>{}</strong> within 24 hours.</p><p>{}</p>",
        html_escape(guest_name.unwrap_or("Guest")),
        html_escape(booking),
        html_escape(message)
    );
    let body_text = format!(
        "Please upload your bank-transfer receipt for booking {booking} within 24 hours.\n{message}"
    );
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            log::error!("Failed to start receipt-request notification transaction: {error}");
            return;
        }
    };
    let idempotency_key = format!(
        "payment-receipt-request:{payment_id}:{}",
        chrono::Utc::now().timestamp_millis()
    );
    if let Err(error) = CommunicationsRepository::insert_delivery_tx(
        &mut tx,
        DeliveryValues {
            campaign_id: None,
            kind: "booking_confirmation",
            guest_id,
            topic: "booking_confirmation",
            recipient_email: &email,
            subject: &subject,
            body_html: &body_html,
            body_text: Some(&body_text),
            voucher_id: None,
            idempotency_key: &idempotency_key,
        },
    )
    .await
    {
        log::error!("Failed to queue payment receipt request notification: {error}");
        return;
    }
    if let Err(error) = tx.commit().await {
        log::error!("Failed to commit payment receipt request notification: {error}");
    }
}

/// Shared completion path: CAS the payment to `completed`, confirm the booking
/// (idempotently), record booking history, recompute the folio payment status,
/// and audit — all in one transaction.
async fn complete_and_confirm(
    pool: &DbPool,
    payment_id: i64,
    booking_id: i64,
    actor_user_id: Option<i64>,
    audit_action: &str,
) -> Result<PaymentActionResponse, ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    PaymentRepository::lock_booking_for_payment_tx(&mut tx, booking_id).await?;
    let status = PaymentRepository::lock_payment_status_tx(&mut tx, payment_id, booking_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if !matches!(status.as_str(), "pending" | "processing") {
        return Err(ApiError::BadRequest(
            "Payment is no longer pending.".to_string(),
        ));
    }

    // Defense in depth: even if a race slipped a second claim past the
    // pre-insert guard, never complete a payment when the booking already has a
    // DIFFERENT completed booking payment.
    if PaymentRepository::has_other_completed_booking_payment_tx(&mut tx, booking_id, payment_id)
        .await?
    {
        return Err(ApiError::Conflict(
            "This booking already has a completed payment.".to_string(),
        ));
    }

    let completed =
        PaymentRepository::mark_payment_completed_tx(&mut tx, payment_id, actor_user_id).await?;
    if completed.is_none() {
        return Err(ApiError::BadRequest(
            "Payment is no longer pending.".to_string(),
        ));
    }

    let confirmed = crate::repositories::bookings::confirm_booking_tx(&mut tx, booking_id).await?;
    if confirmed {
        crate::repositories::bookings::record_booking_history_tx(
            &mut tx,
            booking_id,
            Some("pending_payment"),
            "confirmed",
            actor_user_id,
            Some("Payment approved"),
            serde_json::json!({ "payment_id": payment_id }),
        )
        .await?;
    }

    recompute_payment_status_tx(&mut tx, booking_id).await?;

    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: actor_user_id,
            action: audit_action,
            resource_type: "payment",
            resource_id: Some(payment_id),
            details: Some(serde_json::json!({
                "booking_id": booking_id,
                "booking_confirmed": confirmed,
            })),
            ..Default::default()
        },
    )
    .await?;

    tx.commit().await.map_err(ApiError::from)?;

    Ok(PaymentActionResponse {
        payment_id,
        status: "completed".to_string(),
        booking_status: Some("confirmed".to_string()),
    })
}

/// Queue a guest-facing email explaining why their payment claim was
/// rejected. Mirrors `queue_paid_online_booking_room_assignment`'s use of the
/// `booking_confirmation` kind/topic — the database constraints allow that
/// pair with `campaign_id IS NULL`, so no schema change is needed for a new
/// notification kind.
async fn queue_payment_rejected_notification(
    pool: &DbPool,
    guest_id: i64,
    guest_name: &str,
    booking_number: &str,
    payment_id: i64,
    reason: &str,
) -> Result<(), ApiError> {
    let Some(email) = CommunicationsRepository::get_guest_email(pool, guest_id).await? else {
        return Ok(());
    };

    let subject = format!("Update on your payment for booking {booking_number}");
    let body_html = format!(
        "<p>Dear {},</p>\
         <p>We were unable to confirm your recent payment for booking <strong>{}</strong>.</p>\
         <p><strong>Reason:</strong> {}</p>\
         <p>Please log in to your guest portal to submit a new payment claim or contact the hotel if you need help.</p>",
        html_escape(guest_name),
        html_escape(booking_number),
        html_escape(reason),
    );
    let body_text = format!(
        "We were unable to confirm your recent payment for booking {booking_number}.\n\
         Reason: {reason}\n\
         Please log in to your guest portal to submit a new payment claim or contact the hotel if you need help.",
    );

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    CommunicationsRepository::insert_delivery_tx(
        &mut tx,
        DeliveryValues {
            campaign_id: None,
            kind: "booking_confirmation",
            guest_id,
            topic: "booking_confirmation",
            recipient_email: &email,
            subject: &subject,
            body_html: &body_html,
            body_text: Some(&body_text),
            voucher_id: None,
            idempotency_key: &format!("payment-rejected:{payment_id}"),
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(())
}

/// Best-effort wrapper: a notification failure must never undo a staff
/// rejection that has already been committed.
async fn try_queue_payment_rejected_notification(
    pool: &DbPool,
    guest_id: Option<i64>,
    guest_name: Option<&str>,
    booking_id: i64,
    booking_number: Option<&str>,
    payment_id: i64,
    reason: &str,
) {
    let Some(guest_id) = guest_id else { return };
    let booking_label = booking_number
        .map(str::to_string)
        .unwrap_or_else(|| format!("#{booking_id}"));

    if let Err(error) = queue_payment_rejected_notification(
        pool,
        guest_id,
        guest_name.unwrap_or("Guest"),
        &booking_label,
        payment_id,
        reason,
    )
    .await
    {
        log::error!(
            "Failed to queue payment-rejected notification for payment {}: {}",
            payment_id,
            error
        );
    }
}

/// Staff action: reject a pending payment. A rejected bank claim returns the
/// booking to `pending_payment` so the guest can choose another payment method.
pub async fn reject_payment(
    pool: &DbPool,
    actor_user_id: i64,
    payment_id: i64,
    reason: &str,
) -> Result<PaymentActionResponse, ApiError> {
    reject_payment_by(pool, Some(actor_user_id), payment_id, reason).await
}

/// Reject overdue receipt requests without attributing the automated decision
/// to a staff account.
pub async fn reject_expired_receipt_requests(pool: &DbPool) -> Result<usize, ApiError> {
    let ids = PaymentRepository::expired_receipt_request_payment_ids(pool).await?;
    let mut rejected = 0;
    for payment_id in ids {
        if reject_payment_by(
            pool,
            None,
            payment_id,
            "Receipt was not uploaded within 24 hours of the request.",
        )
        .await
        .is_ok()
        {
            rejected += 1;
        }
    }
    Ok(rejected)
}

async fn reject_payment_by(
    pool: &DbPool,
    actor_user_id: Option<i64>,
    payment_id: i64,
    reason: &str,
) -> Result<PaymentActionResponse, ApiError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(ApiError::BadRequest(
            "A rejection reason is required.".to_string(),
        ));
    }

    let review = PaymentRepository::get_payment_for_review(pool, payment_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if review.status != "pending" {
        return Err(ApiError::BadRequest(
            "Only pending payments can be rejected.".to_string(),
        ));
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    PaymentRepository::lock_booking_for_payment_tx(&mut tx, review.booking_id).await?;
    let status = PaymentRepository::lock_payment_status_tx(&mut tx, payment_id, review.booking_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if status != "pending" {
        return Err(ApiError::BadRequest(
            "Payment is no longer pending.".to_string(),
        ));
    }
    let rejected =
        PaymentRepository::mark_payment_rejected_tx(&mut tx, payment_id, actor_user_id, reason)
            .await?;
    if rejected.is_none() {
        return Err(ApiError::BadRequest(
            "Payment is no longer pending.".to_string(),
        ));
    }

    let reset_to_payment = crate::repositories::bookings::move_booking_to_pending_payment_tx(
        &mut tx,
        review.booking_id,
    )
    .await?;
    if reset_to_payment {
        crate::repositories::bookings::record_booking_history_tx(
            &mut tx,
            review.booking_id,
            Some("pending_confirmation"),
            "pending_payment",
            actor_user_id,
            Some("Payment claim rejected; awaiting another payment"),
            serde_json::json!({ "payment_id": payment_id }),
        )
        .await?;
    }

    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: actor_user_id,
            action: "payment_rejected",
            resource_type: "payment",
            resource_id: Some(payment_id),
            details: Some(serde_json::json!({
                "booking_id": review.booking_id,
                "reason": reason,
            })),
            ..Default::default()
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;

    try_queue_payment_rejected_notification(
        pool,
        review.guest_id,
        review.guest_name.as_deref(),
        review.booking_id,
        review.booking_number.as_deref(),
        payment_id,
        reason,
    )
    .await;

    Ok(PaymentActionResponse {
        payment_id,
        status: "void".to_string(),
        booking_status: reset_to_payment.then(|| "pending_payment".to_string()),
    })
}

/// Staff queue: paginated list of pending payment claims awaiting review.
pub async fn list_pending_payments(
    pool: &DbPool,
    limit: i64,
    offset: i64,
) -> Result<PendingPaymentPage, ApiError> {
    let limit = limit.clamp(1, 200);
    let offset = offset.max(0);
    let (items, total) = PaymentRepository::list_pending_payments(pool, limit, offset).await?;
    Ok(PendingPaymentPage { items, total })
}

/// Staff history of resolved guest payment claims.
pub async fn list_payment_approval_history(
    pool: &DbPool,
    limit: i64,
    offset: i64,
) -> Result<PendingPaymentPage, ApiError> {
    let (items, total) =
        PaymentRepository::list_payment_approval_history(pool, limit.clamp(1, 200), offset.max(0))
            .await?;
    Ok(PendingPaymentPage { items, total })
}

fn receipt_extension(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("jpg", "image/jpeg"))
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else if bytes.starts_with(b"%PDF-") {
        Some(("pdf", "application/pdf"))
    } else {
        None
    }
}

/// Store a guest-provided proof privately after validating its actual contents.
pub async fn save_payment_receipt(
    pool: &DbPool,
    payment_id: i64,
    bytes: &[u8],
) -> Result<(), ApiError> {
    if bytes.is_empty() || bytes.len() > MAX_PAYMENT_RECEIPT_BYTES {
        return Err(ApiError::BadRequest(
            "Receipt file size must be between 1 byte and 10MB".to_string(),
        ));
    }
    let receipt = PaymentRepository::get_payment_for_review(pool, payment_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if receipt.payment_method != PaymentMethod::BankTransfer.to_string()
        || receipt.status != "pending"
    {
        return Err(ApiError::BadRequest(
            "A receipt can only be uploaded for a pending bank-transfer claim.".to_string(),
        ));
    }
    let (extension, content_type) = receipt_extension(bytes).ok_or_else(|| {
        ApiError::BadRequest("Receipt must be a JPEG, PNG, WebP, or PDF file.".to_string())
    })?;
    let directory = PathBuf::from(PAYMENT_RECEIPT_UPLOAD_DIR);
    fs::create_dir_all(&directory)
        .map_err(|_| ApiError::Internal("Unable to prepare receipt storage.".to_string()))?;
    let path = directory.join(format!(
        "payment_{payment_id}_{}.{}",
        uuid::Uuid::new_v4(),
        extension
    ));
    fs::write(&path, bytes)
        .map_err(|_| ApiError::Internal("Unable to save the receipt.".to_string()))?;
    if let Err(error) = PaymentRepository::save_receipt_file(
        pool,
        payment_id,
        &path.to_string_lossy(),
        content_type,
    )
    .await
    {
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: None,
            action: "payment_receipt_uploaded",
            resource_type: "payment",
            resource_id: Some(payment_id),
            details: Some(serde_json::json!({ "booking_id": receipt.booking_id })),
            ..Default::default()
        },
    )
    .await?;
    Ok(())
}

/// Load a receipt that was saved by `save_payment_receipt`; never serve files outside its private directory.
pub async fn load_payment_receipt(
    pool: &DbPool,
    payment_id: i64,
) -> Result<(Vec<u8>, String), ApiError> {
    let receipt = PaymentRepository::receipt_file(pool, payment_id)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound("No receipt has been uploaded for this payment.".to_string())
        })?;
    let root = Path::new(PAYMENT_RECEIPT_UPLOAD_DIR)
        .canonicalize()
        .map_err(|_| ApiError::NotFound("Receipt file is unavailable.".to_string()))?;
    let path = Path::new(&receipt.path)
        .canonicalize()
        .map_err(|_| ApiError::NotFound("Receipt file is unavailable.".to_string()))?;
    if !path.starts_with(&root) {
        return Err(ApiError::NotFound(
            "Receipt file is unavailable.".to_string(),
        ));
    }
    let bytes = fs::read(path)
        .map_err(|_| ApiError::NotFound("Receipt file is unavailable.".to_string()))?;
    Ok((bytes, receipt.content_type))
}

#[cfg(test)]
mod receipt_tests {
    use super::receipt_extension;

    #[test]
    fn accepts_supported_receipt_signatures_only() {
        assert_eq!(
            receipt_extension(&[0xff, 0xd8, 0xff, 0x00]),
            Some(("jpg", "image/jpeg"))
        );
        assert_eq!(
            receipt_extension(b"%PDF-1.7"),
            Some(("pdf", "application/pdf"))
        );
        assert_eq!(receipt_extension(b"not a receipt"), None);
    }
}

#[cfg(test)]
mod idempotency_key_tests {
    use super::normalized_idempotency_key;
    use crate::core::error::ApiError;

    const INVALID_KEY_MESSAGE: &str = "Idempotency key must be between 1 and 160 characters";

    #[test]
    fn normalized_idempotency_key_trims_valid_input() {
        assert_eq!(
            normalized_idempotency_key("  payment-key  ").expect("valid key"),
            "payment-key"
        );
    }

    #[test]
    fn normalized_idempotency_key_rejects_empty_or_whitespace_input() {
        for value in ["", " \t\n "] {
            assert!(matches!(
                normalized_idempotency_key(value),
                Err(ApiError::BadRequest(message)) if message == INVALID_KEY_MESSAGE
            ));
        }
    }

    #[test]
    fn normalized_idempotency_key_accepts_exactly_160_characters() {
        let value = "x".repeat(160);
        assert_eq!(
            normalized_idempotency_key(&value).expect("160-character key"),
            value
        );
    }

    #[test]
    fn normalized_idempotency_key_rejects_161_characters() {
        let value = "x".repeat(161);
        assert!(matches!(
            normalized_idempotency_key(&value),
            Err(ApiError::BadRequest(message)) if message == INVALID_KEY_MESSAGE
        ));
    }
}

#[cfg(test)]
mod paypal_capture_verification_tests {
    use super::verify_captured_against_stored;
    use crate::services::paypal_client::PaypalCaptureOutcome;

    fn outcome(amount: &str, currency: &str) -> PaypalCaptureOutcome {
        PaypalCaptureOutcome {
            status: "COMPLETED".to_string(),
            custom_id: None,
            captured_amount: Some(amount.to_string()),
            captured_currency: Some(currency.to_string()),
        }
    }

    #[test]
    fn accepts_matching_amount_regardless_of_formatting_and_case() {
        assert_eq!(
            verify_captured_against_stored(&outcome("450.00", "MYR"), "450", "MYR"),
            Ok(())
        );
        assert_eq!(
            verify_captured_against_stored(&outcome("450", "myr"), " 450.00 ", "MYR"),
            Ok(())
        );
    }

    #[test]
    fn rejects_amount_mismatch() {
        assert!(
            verify_captured_against_stored(&outcome("449.99", "MYR"), "450.00", "MYR").is_err()
        );
    }

    #[test]
    fn rejects_currency_mismatch() {
        assert!(
            verify_captured_against_stored(&outcome("450.00", "USD"), "450.00", "MYR").is_err()
        );
    }

    #[test]
    fn rejects_unparseable_stored_amount() {
        assert_eq!(
            verify_captured_against_stored(&outcome("450.00", "MYR"), "not-a-number", "MYR"),
            Err("Stored payment amount is unparseable.".to_string())
        );
    }
}
