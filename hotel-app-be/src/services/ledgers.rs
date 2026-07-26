//! Customer ledger service layer.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::repositories::ledger as repo;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;

pub async fn list_customer_ledgers(
    pool: &DbPool,
    query: LedgerListQuery,
) -> Result<LedgerPaginatedResponse, ApiError> {
    repo::list_customer_ledgers(pool, query).await
}

pub async fn get_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<CustomerLedger, ApiError> {
    repo::get_customer_ledger(pool, ledger_id).await
}

pub async fn get_customer_ledger_with_payments(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<CustomerLedgerWithPayments, ApiError> {
    repo::get_customer_ledger_with_payments(pool, ledger_id).await
}

pub async fn create_customer_ledger(
    pool: &DbPool,
    user_id: i64,
    mut request: CustomerLedgerCreateRequest,
) -> Result<CustomerLedger, ApiError> {
    // Sanitize free-text fields before they reach the repository layer.
    request.company_name = Sanitizer::sanitize_text(&request.company_name);
    request.contact_person = request
        .contact_person
        .as_deref()
        .map(Sanitizer::sanitize_text);
    request.billing_address_line1 = request
        .billing_address_line1
        .as_deref()
        .map(Sanitizer::sanitize_text);
    request.description = Sanitizer::sanitize_text(&request.description);
    request.notes = request.notes.as_deref().map(Sanitizer::sanitize_notes);
    request.internal_notes = request
        .internal_notes
        .as_deref()
        .map(Sanitizer::sanitize_notes);

    let ledger = repo::create_customer_ledger(pool, user_id, request).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "customer_ledger_created",
            resource_type: "customer_ledger",
            resource_id: Some(ledger.id),
            details: Some(serde_json::json!({
                "company_name": ledger.company_name,
                "amount": ledger.amount,
                "expense_type": ledger.expense_type,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(ledger)
}

pub async fn update_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    mut request: CustomerLedgerUpdateRequest,
) -> Result<CustomerLedger, ApiError> {
    // Mirror the create path: free-text fields are sanitized before they
    // reach the repository layer (CONTRIBUTING.md "Sanitize free text").
    request.company_name = request
        .company_name
        .as_deref()
        .map(Sanitizer::sanitize_text);
    request.contact_person = request
        .contact_person
        .as_deref()
        .map(Sanitizer::sanitize_text);
    request.billing_address_line1 = request
        .billing_address_line1
        .as_deref()
        .map(Sanitizer::sanitize_text);
    request.description = request.description.as_deref().map(Sanitizer::sanitize_text);
    request.notes = request.notes.as_deref().map(Sanitizer::sanitize_notes);
    request.internal_notes = request
        .internal_notes
        .as_deref()
        .map(Sanitizer::sanitize_notes);
    request.department_code = request
        .department_code
        .as_deref()
        .map(Sanitizer::sanitize_text);
    request.transaction_code = request
        .transaction_code
        .as_deref()
        .map(Sanitizer::sanitize_text);
    request.room_number = request.room_number.as_deref().map(Sanitizer::sanitize_text);
    request.reference_number = request
        .reference_number
        .as_deref()
        .map(Sanitizer::sanitize_text);

    // `post_type` is constrained by the `valid_post_type` CHECK on
    // customer_ledgers. Reject an unknown value as a 400 here rather than
    // letting it surface as an opaque database 500.
    if let Some(post_type) = request.post_type.as_deref()
        && !VALID_POST_TYPES.contains(&post_type)
    {
        return Err(ApiError::BadRequest(format!(
            "Invalid post type '{post_type}'"
        )));
    }

    let ledger = repo::update_customer_ledger(pool, ledger_id, user_id, request).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "customer_ledger_updated",
            resource_type: "customer_ledger",
            resource_id: Some(ledger_id),
            details: Some(serde_json::json!({
                "company_name": ledger.company_name,
                "amount": ledger.amount,
                "status": ledger.status,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(ledger)
}

pub async fn delete_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
) -> Result<serde_json::Value, ApiError> {
    let result = repo::delete_customer_ledger(pool, ledger_id).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "customer_ledger_deleted",
            resource_type: "customer_ledger",
            resource_id: Some(ledger_id),
            details: None,
            ..Default::default()
        },
    )
    .await;

    Ok(result)
}

pub async fn create_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: CustomerLedgerPaymentRequest,
) -> Result<CustomerLedgerPayment, ApiError> {
    let payment = repo::create_ledger_payment(pool, ledger_id, user_id, request).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "ledger_payment_created",
            resource_type: "customer_ledger",
            resource_id: Some(ledger_id),
            details: Some(serde_json::json!({
                "payment_id": payment.id,
                "payment_amount": payment.payment_amount,
                "payment_method": payment.payment_method,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(payment)
}

pub async fn get_ledger_payments(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<Vec<CustomerLedgerPayment>, ApiError> {
    repo::get_ledger_payments(pool, ledger_id).await
}

pub async fn get_ledger_summary(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    repo::get_ledger_summary(pool).await
}

pub async fn void_ledger(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: LedgerVoidRequest,
) -> Result<CustomerLedger, ApiError> {
    let reason = request.reason.clone();
    let ledger = repo::void_ledger(pool, ledger_id, user_id, request).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "customer_ledger_voided",
            resource_type: "customer_ledger",
            resource_id: Some(ledger_id),
            details: Some(serde_json::json!({ "reason": reason })),
            ..Default::default()
        },
    )
    .await;

    Ok(ledger)
}

pub async fn create_ledger_reversal(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: LedgerReversalRequest,
) -> Result<CustomerLedger, ApiError> {
    let reason = request.reason.clone();
    let reversal = repo::create_ledger_reversal(pool, ledger_id, user_id, request).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "customer_ledger_reversed",
            resource_type: "customer_ledger",
            resource_id: Some(ledger_id),
            details: Some(serde_json::json!({
                "reason": reason,
                "reversal_id": reversal.id,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(reversal)
}

pub async fn update_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    payment_id: i64,
    user_id: i64,
    request: UpdateLedgerPaymentRequest,
) -> Result<CustomerLedgerPayment, ApiError> {
    let payment = repo::update_ledger_payment(pool, ledger_id, payment_id, request).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "ledger_payment_updated",
            resource_type: "customer_ledger",
            resource_id: Some(ledger_id),
            details: Some(serde_json::json!({ "payment_id": payment_id })),
            ..Default::default()
        },
    )
    .await;

    Ok(payment)
}

pub async fn delete_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    payment_id: i64,
    user_id: i64,
) -> Result<serde_json::Value, ApiError> {
    let result = repo::delete_ledger_payment(pool, ledger_id, payment_id).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "ledger_payment_deleted",
            resource_type: "customer_ledger",
            resource_id: Some(ledger_id),
            details: Some(serde_json::json!({ "payment_id": payment_id })),
            ..Default::default()
        },
    )
    .await;

    Ok(result)
}
