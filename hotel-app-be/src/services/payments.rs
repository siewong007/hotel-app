use crate::constants::PaymentMethod;
use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::models::{
    Invoice, InvoicePreview, Payment, PaymentRequest, PaymentSummary, PaymentWorkflowSummary,
    RecordPaymentRequest, UpdatePaymentRequest,
};
use crate::modules::communications::repository::CommunicationsRepository;
use crate::modules::communications::validation::html_escape;
use crate::repositories::payment::PaymentRepository;
use crate::services::audit::AuditLog;
use rust_decimal::Decimal;

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
        None,
        "booking_confirmation",
        assignment.guest_id,
        "booking_confirmation",
        &assignment.guest_email,
        &subject,
        &body_html,
        Some(&body_text),
        None,
        &format!("online-room-assignment:{}", assignment.booking_id),
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

    let nights = (stay.check_out.date() - stay.check_in.date()).num_days();
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
    request: PaymentRequest,
) -> Result<Payment, ApiError> {
    let summary = calculate_payment_summary(pool, request.booking_id).await?;
    let payment_gateway = match &request.payment_method {
        PaymentMethod::Card => Some("card_processor"),
        PaymentMethod::Duitnow => Some("duitnow"),
        PaymentMethod::OnlineBanking => Some("online_banking"),
        _ => None,
    };

    let payment = PaymentRepository::create_completed_payment(
        pool,
        user_id,
        &request,
        &summary,
        payment_gateway,
    )
    .await?;
    recompute_payment_status(pool, payment.booking_id).await?;
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
        Some(user_id),
        "payment_created",
        "payment",
        Some(payment.id),
        Some(serde_json::json!({
            "booking_id": payment.booking_id,
            "amount": payment.total_amount,
        })),
        None,
        None,
    )
    .await;

    Ok(payment)
}

pub async fn record_payment(
    pool: &DbPool,
    user_id: i64,
    request: RecordPaymentRequest,
) -> Result<serde_json::Value, ApiError> {
    let amount = Decimal::from_f64_retain(request.amount)
        .ok_or_else(|| ApiError::BadRequest("Invalid amount".to_string()))?;

    let payment_type = request.payment_type.as_deref().unwrap_or("booking");

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

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
        }
    }

    let created_at_override = request
        .payment_date
        .as_ref()
        .map(|d| format!("{} 12:00:00", d));

    let row = PaymentRepository::record_payment(
        &mut tx,
        user_id,
        &request,
        amount,
        payment_type,
        created_at_override.as_deref(),
    )
    .await?;

    recompute_payment_status_tx(&mut tx, request.booking_id).await?;

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
        Some(user_id),
        "payment_recorded",
        "payment",
        Some(payment_id),
        Some(serde_json::json!({
            "booking_id": booking_id,
            "amount": request.amount,
        })),
        None,
        None,
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
        Some(user_id),
        "payment_refunded",
        "payment",
        Some(row.id),
        Some(serde_json::json!({
            "booking_id": booking_id,
            "amount": deposit_amount_f64,
            "payment_method": payment_method,
        })),
        None,
        None,
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
        Some(user_id),
        "payment_refund_reverted",
        "payment",
        Some(reverted_payment_id),
        Some(serde_json::json!({
            "booking_id": booking_id,
        })),
        None,
        None,
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
        Some(user_id),
        "invoice_generated",
        "invoice",
        Some(invoice.id),
        Some(serde_json::json!({
            "booking_id": booking_id,
            "invoice_number": invoice_number,
        })),
        None,
        None,
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
    let row = PaymentRepository::update_payment(pool, payment_id, &request).await?;
    recompute_payment_status(pool, row.booking_id).await?;
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
        Some(user_id),
        "payment_updated",
        "payment",
        Some(row.id),
        Some(serde_json::json!({
            "booking_id": row.booking_id,
        })),
        None,
        None,
    )
    .await;

    Ok(row.into_response())
}

pub async fn delete_payment(
    pool: &DbPool,
    user_id: i64,
    payment_id: i64,
) -> Result<serde_json::Value, ApiError> {
    let affected_booking_id = PaymentRepository::delete_payment(pool, payment_id).await?;

    if let Some(booking_id) = affected_booking_id {
        recompute_payment_status(pool, booking_id).await?;
    }

    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "payment_deleted",
        "payment",
        Some(payment_id),
        Some(serde_json::json!({
            "booking_id": affected_booking_id,
        })),
        None,
        None,
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
