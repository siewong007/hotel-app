//! Customer ledger handlers
//!
//! Handles customer ledgers and accounts receivable with PAT-style support.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::Row;

use crate::core::db::{DbPool, decimal_to_db, opt_decimal_to_db};
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::row_mappers::{
    self, row_to_customer_ledger, row_to_customer_ledger_payment, row_to_pat_transaction_code,
    get_decimal,
};
use crate::models::*;

/// Query parameters for listing ledgers
#[derive(Debug, Deserialize)]
pub struct LedgerListQuery {
    pub status: Option<String>,
    pub company_name: Option<String>,
    pub expense_type: Option<String>,
    pub folio_type: Option<String>,
    pub post_type: Option<String>,
    pub department_code: Option<String>,
    pub room_number: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

// Common SELECT fields for CustomerLedger including PAT fields
const LEDGER_SELECT_FIELDS: &str = r#"
    id, company_name, company_registration_number, contact_person,
    contact_email, contact_phone, billing_address_line1, billing_city,
    billing_state, billing_postal_code, billing_country, description,
    expense_type, amount, currency, status, paid_amount, balance_due,
    payment_method, payment_reference, payment_date, booking_id, guest_id,
    invoice_number, invoice_date, due_date, notes, internal_notes,
    created_by, updated_by, created_at, updated_at,
    folio_number, folio_type, transaction_type, post_type, department_code,
    transaction_code, room_number, posting_date, transaction_date,
    reference_number, cashier_id, is_reversal, original_transaction_id,
    reversal_reason, tax_amount, service_charge, net_amount,
    is_posted, posted_at, void_at, void_by, void_reason
"#;

// SQLite query for listing ledgers
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const LIST_LEDGERS_QUERY: &str = r#"
    SELECT id, company_name, company_registration_number, contact_person,
        contact_email, contact_phone, billing_address_line1, billing_city,
        billing_state, billing_postal_code, billing_country, description,
        expense_type, amount, currency, status, paid_amount, balance_due,
        payment_method, payment_reference, payment_date, booking_id, guest_id,
        invoice_number, invoice_date, due_date, notes, internal_notes,
        created_by, updated_by, created_at, updated_at,
        folio_number, folio_type, transaction_type, post_type, department_code,
        transaction_code, room_number, posting_date, transaction_date,
        reference_number, cashier_id, is_reversal, original_transaction_id,
        reversal_reason, tax_amount, service_charge, net_amount,
        is_posted, posted_at, void_at, void_by, void_reason
    FROM customer_ledgers
    WHERE (?1 IS NULL OR status = ?1)
      AND (?2 IS NULL OR company_name LIKE '%' || ?2 || '%')
      AND (?3 IS NULL OR expense_type = ?3)
      AND (?4 IS NULL OR folio_type = ?4)
      AND (?5 IS NULL OR post_type = ?5)
      AND (?6 IS NULL OR department_code = ?6)
      AND (?7 IS NULL OR room_number = ?7)
    ORDER BY created_at DESC
    LIMIT ?8 OFFSET ?9
"#;

// PostgreSQL query for listing ledgers
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const LIST_LEDGERS_QUERY: &str = r#"
    SELECT id, company_name, company_registration_number, contact_person,
        contact_email, contact_phone, billing_address_line1, billing_city,
        billing_state, billing_postal_code, billing_country, description,
        expense_type, amount, currency, status, paid_amount, balance_due,
        payment_method, payment_reference, payment_date, booking_id, guest_id,
        invoice_number, invoice_date, due_date, notes, internal_notes,
        created_by, updated_by, created_at, updated_at,
        folio_number, folio_type, transaction_type, post_type, department_code,
        transaction_code, room_number, posting_date, transaction_date,
        reference_number, cashier_id, is_reversal, original_transaction_id,
        reversal_reason, tax_amount, service_charge, net_amount,
        is_posted, posted_at, void_at, void_by, void_reason
    FROM customer_ledgers
    WHERE ($1::text IS NULL OR status = $1)
      AND ($2::text IS NULL OR company_name ILIKE '%' || $2 || '%')
      AND ($3::text IS NULL OR expense_type = $3)
      AND ($4::text IS NULL OR folio_type = $4)
      AND ($5::text IS NULL OR post_type = $5)
      AND ($6::text IS NULL OR department_code = $6)
      AND ($7::text IS NULL OR room_number = $7)
    ORDER BY created_at DESC
    LIMIT $8 OFFSET $9
"#;

// SQLite query for getting ledger by ID
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const GET_LEDGER_BY_ID_QUERY: &str = r#"
    SELECT id, company_name, company_registration_number, contact_person,
        contact_email, contact_phone, billing_address_line1, billing_city,
        billing_state, billing_postal_code, billing_country, description,
        expense_type, amount, currency, status, paid_amount, balance_due,
        payment_method, payment_reference, payment_date, booking_id, guest_id,
        invoice_number, invoice_date, due_date, notes, internal_notes,
        created_by, updated_by, created_at, updated_at,
        folio_number, folio_type, transaction_type, post_type, department_code,
        transaction_code, room_number, posting_date, transaction_date,
        reference_number, cashier_id, is_reversal, original_transaction_id,
        reversal_reason, tax_amount, service_charge, net_amount,
        is_posted, posted_at, void_at, void_by, void_reason
    FROM customer_ledgers WHERE id = ?1
"#;

// PostgreSQL query for getting ledger by ID
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const GET_LEDGER_BY_ID_QUERY: &str = r#"
    SELECT id, company_name, company_registration_number, contact_person,
        contact_email, contact_phone, billing_address_line1, billing_city,
        billing_state, billing_postal_code, billing_country, description,
        expense_type, amount, currency, status, paid_amount, balance_due,
        payment_method, payment_reference, payment_date, booking_id, guest_id,
        invoice_number, invoice_date, due_date, notes, internal_notes,
        created_by, updated_by, created_at, updated_at,
        folio_number, folio_type, transaction_type, post_type, department_code,
        transaction_code, room_number, posting_date, transaction_date,
        reference_number, cashier_id, is_reversal, original_transaction_id,
        reversal_reason, tax_amount, service_charge, net_amount,
        is_posted, posted_at, void_at, void_by, void_reason
    FROM customer_ledgers WHERE id = $1
"#;

// SQLite query for getting ledger payments
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const GET_LEDGER_PAYMENTS_QUERY: &str = r#"
    SELECT id, ledger_id, payment_amount, payment_method, payment_reference,
           payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at
    FROM customer_ledger_payments
    WHERE ledger_id = ?1
    ORDER BY payment_date DESC
"#;

// PostgreSQL query for getting ledger payments
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const GET_LEDGER_PAYMENTS_QUERY: &str = r#"
    SELECT id, ledger_id, payment_amount, payment_method, payment_reference,
           payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at
    FROM customer_ledger_payments
    WHERE ledger_id = $1
    ORDER BY payment_date DESC
"#;

// SQLite query for checking ledger exists
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const CHECK_LEDGER_EXISTS_QUERY: &str = "SELECT 1 FROM customer_ledgers WHERE id = ?1";

// PostgreSQL query for checking ledger exists
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const CHECK_LEDGER_EXISTS_QUERY: &str = "SELECT EXISTS(SELECT 1 FROM customer_ledgers WHERE id = $1)";

// SQLite query for getting ledger status and paid_amount
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const GET_LEDGER_STATUS_QUERY: &str = "SELECT status, paid_amount FROM customer_ledgers WHERE id = ?1";

// PostgreSQL query for getting ledger status and paid_amount
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const GET_LEDGER_STATUS_QUERY: &str = "SELECT status, paid_amount FROM customer_ledgers WHERE id = $1";

// SQLite query for deleting ledger payments
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const DELETE_LEDGER_PAYMENTS_QUERY: &str = "DELETE FROM customer_ledger_payments WHERE ledger_id = ?1";

// PostgreSQL query for deleting ledger payments
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const DELETE_LEDGER_PAYMENTS_QUERY: &str = "DELETE FROM customer_ledger_payments WHERE ledger_id = $1";

// SQLite query for deleting ledger
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const DELETE_LEDGER_QUERY: &str = "DELETE FROM customer_ledgers WHERE id = ?1";

// PostgreSQL query for deleting ledger
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const DELETE_LEDGER_QUERY: &str = "DELETE FROM customer_ledgers WHERE id = $1";

// SQLite query for getting ledger info for payment
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const GET_LEDGER_FOR_PAYMENT_QUERY: &str = "SELECT amount, paid_amount, status FROM customer_ledgers WHERE id = ?1";

// PostgreSQL query for getting ledger info for payment
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const GET_LEDGER_FOR_PAYMENT_QUERY: &str = "SELECT amount, paid_amount, status FROM customer_ledgers WHERE id = $1";

// SQLite query for getting PAT transaction codes
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const GET_PAT_TRANSACTION_CODES_QUERY: &str = r#"
    SELECT id, code, name, post_type, department_code, default_amount,
           is_taxable, is_service_chargeable, gl_account_code, is_active,
           sort_order, created_at
    FROM pat_transaction_codes
    WHERE is_active = 1
    ORDER BY sort_order, code
"#;

// PostgreSQL query for getting PAT transaction codes
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const GET_PAT_TRANSACTION_CODES_QUERY: &str = r#"
    SELECT id, code, name, post_type, department_code, default_amount,
           is_taxable, is_service_chargeable, gl_account_code, is_active,
           sort_order, created_at
    FROM pat_transaction_codes
    WHERE is_active = true
    ORDER BY sort_order, code
"#;

// SQLite query for getting PAT department codes
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const GET_PAT_DEPARTMENT_CODES_QUERY: &str = r#"
    SELECT id, code, name, description, is_active, sort_order, created_at
    FROM pat_department_codes
    WHERE is_active = 1
    ORDER BY sort_order, code
"#;

// PostgreSQL query for getting PAT department codes
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const GET_PAT_DEPARTMENT_CODES_QUERY: &str = r#"
    SELECT id, code, name, description, is_active, sort_order, created_at
    FROM pat_department_codes
    WHERE is_active = true
    ORDER BY sort_order, code
"#;

// SQLite query for checking if ledger is voided
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
const CHECK_LEDGER_VOIDED_QUERY: &str = "SELECT void_at IS NOT NULL FROM customer_ledgers WHERE id = ?1";

// PostgreSQL query for checking if ledger is voided
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
const CHECK_LEDGER_VOIDED_QUERY: &str = "SELECT void_at IS NOT NULL FROM customer_ledgers WHERE id = $1";

/// List all customer ledgers with optional filters
pub async fn list_customer_ledgers_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<LedgerListQuery>,
) -> Result<Json<Vec<CustomerLedger>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let limit = query.limit.unwrap_or(100).min(500) as i64;
    let offset = query.offset.unwrap_or(0) as i64;

    let rows = sqlx::query(LIST_LEDGERS_QUERY)
        .bind(query.status.as_deref())
        .bind(query.company_name.as_deref())
        .bind(query.expense_type.as_deref())
        .bind(query.folio_type.as_deref())
        .bind(query.post_type.as_deref())
        .bind(query.department_code.as_deref())
        .bind(query.room_number.as_deref())
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledgers: Vec<CustomerLedger> = rows.iter().map(row_to_customer_ledger).collect();

    Ok(Json(ledgers))
}

/// Get a single customer ledger by ID
pub async fn get_customer_ledger_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Customer ledger not found".to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(Json(ledger))
}

/// Get customer ledger with payment history
pub async fn get_customer_ledger_with_payments_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
) -> Result<Json<CustomerLedgerWithPayments>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Customer ledger not found".to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    let payment_rows = sqlx::query(GET_LEDGER_PAYMENTS_QUERY)
        .bind(ledger_id)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let payments: Vec<CustomerLedgerPayment> = payment_rows
        .iter()
        .map(row_to_customer_ledger_payment)
        .collect();

    Ok(Json(CustomerLedgerWithPayments { ledger, payments }))
}

/// Create a new customer ledger entry with PAT-style support
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn create_customer_ledger_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<CustomerLedgerCreateRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let invoice_date = request.invoice_date.as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let due_date = request.due_date.as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let posting_date = request.posting_date.as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let transaction_date = request.transaction_date.as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    let amount = Decimal::from_f64_retain(request.amount)
        .ok_or_else(|| ApiError::BadRequest("Invalid amount".to_string()))?;
    let tax_amount = request.tax_amount
        .and_then(|v| Decimal::from_f64_retain(v));
    let service_charge = request.service_charge
        .and_then(|v| Decimal::from_f64_retain(v));

    // SQLite INSERT without RETURNING
    sqlx::query(
        r#"
        INSERT INTO customer_ledgers (
            company_name, company_registration_number, contact_person,
            contact_email, contact_phone, billing_address_line1, billing_city,
            billing_state, billing_postal_code, billing_country, description,
            expense_type, amount, currency, status, paid_amount,
            booking_id, guest_id, invoice_date, due_date, notes, internal_notes,
            created_by, updated_by, cashier_id,
            folio_type, transaction_type, post_type, department_code,
            transaction_code, room_number, posting_date, transaction_date,
            reference_number, tax_amount, service_charge
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'pending', 0,
                ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21, ?21,
                ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32)
        "#,
    )
    .bind(&request.company_name)
    .bind(&request.company_registration_number)
    .bind(&request.contact_person)
    .bind(&request.contact_email)
    .bind(&request.contact_phone)
    .bind(&request.billing_address_line1)
    .bind(&request.billing_city)
    .bind(&request.billing_state)
    .bind(&request.billing_postal_code)
    .bind(&request.billing_country)
    .bind(&request.description)
    .bind(&request.expense_type)
    .bind(decimal_to_db(amount))
    .bind(&request.currency)
    .bind(&request.booking_id)
    .bind(&request.guest_id)
    .bind(invoice_date)
    .bind(due_date)
    .bind(&request.notes)
    .bind(&request.internal_notes)
    .bind(user_id)
    // PAT-style fields
    .bind(request.folio_type.as_deref().unwrap_or("city_ledger"))
    .bind(request.transaction_type.as_deref().unwrap_or("debit"))
    .bind(&request.post_type)
    .bind(&request.department_code)
    .bind(&request.transaction_code)
    .bind(&request.room_number)
    .bind(posting_date)
    .bind(transaction_date)
    .bind(&request.reference_number)
    .bind(opt_decimal_to_db(tax_amount))
    .bind(opt_decimal_to_db(service_charge))
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get the inserted ID and fetch the record
    let ledger_id: i64 = sqlx::query_scalar::<_, i64>("SELECT last_insert_rowid()")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(Json(ledger))
}

/// Create a new customer ledger entry with PAT-style support (PostgreSQL)
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub async fn create_customer_ledger_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<CustomerLedgerCreateRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let invoice_date = request.invoice_date.as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let due_date = request.due_date.as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let posting_date = request.posting_date.as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let transaction_date = request.transaction_date.as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    let amount = Decimal::from_f64_retain(request.amount)
        .ok_or_else(|| ApiError::BadRequest("Invalid amount".to_string()))?;
    let tax_amount = request.tax_amount
        .and_then(|v| Decimal::from_f64_retain(v));
    let service_charge = request.service_charge
        .and_then(|v| Decimal::from_f64_retain(v));

    let query_str = format!(
        r#"
        INSERT INTO customer_ledgers (
            company_name, company_registration_number, contact_person,
            contact_email, contact_phone, billing_address_line1, billing_city,
            billing_state, billing_postal_code, billing_country, description,
            expense_type, amount, currency, status, paid_amount,
            booking_id, guest_id, invoice_date, due_date, notes, internal_notes,
            created_by, updated_by, cashier_id,
            folio_type, transaction_type, post_type, department_code,
            transaction_code, room_number, posting_date, transaction_date,
            reference_number, tax_amount, service_charge
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', 0,
                $15, $16, $17, $18, $19, $20, $21, $21, $21,
                $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
        RETURNING {}
        "#,
        LEDGER_SELECT_FIELDS
    );

    let row = sqlx::query(&query_str)
        .bind(&request.company_name)
        .bind(&request.company_registration_number)
        .bind(&request.contact_person)
        .bind(&request.contact_email)
        .bind(&request.contact_phone)
        .bind(&request.billing_address_line1)
        .bind(&request.billing_city)
        .bind(&request.billing_state)
        .bind(&request.billing_postal_code)
        .bind(&request.billing_country)
        .bind(&request.description)
        .bind(&request.expense_type)
        .bind(amount)
        .bind(&request.currency)
        .bind(&request.booking_id)
        .bind(&request.guest_id)
        .bind(invoice_date)
        .bind(due_date)
        .bind(&request.notes)
        .bind(&request.internal_notes)
        .bind(user_id)
        // PAT-style fields
        .bind(request.folio_type.as_deref().unwrap_or("city_ledger"))
        .bind(request.transaction_type.as_deref().unwrap_or("debit"))
        .bind(&request.post_type)
        .bind(&request.department_code)
        .bind(&request.transaction_code)
        .bind(&request.room_number)
        .bind(posting_date)
        .bind(transaction_date)
        .bind(&request.reference_number)
        .bind(tax_amount)
        .bind(service_charge)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(Json(ledger))
}

/// Update a customer ledger entry (SQLite version)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn update_customer_ledger_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
    Json(request): Json<CustomerLedgerUpdateRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Check if ledger exists
    let exists = sqlx::query(CHECK_LEDGER_EXISTS_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if exists.is_none() {
        return Err(ApiError::NotFound(
            "Customer ledger not found".to_string(),
        ));
    }

    let mut updates = Vec::new();
    let mut param_index = 1;

    if request.company_name.is_some() {
        updates.push(format!("company_name = ?{}", param_index));
        param_index += 1;
    }
    if request.company_registration_number.is_some() {
        updates.push(format!("company_registration_number = ?{}", param_index));
        param_index += 1;
    }
    if request.contact_person.is_some() {
        updates.push(format!("contact_person = ?{}", param_index));
        param_index += 1;
    }
    if request.contact_email.is_some() {
        updates.push(format!("contact_email = ?{}", param_index));
        param_index += 1;
    }
    if request.contact_phone.is_some() {
        updates.push(format!("contact_phone = ?{}", param_index));
        param_index += 1;
    }
    if request.billing_address_line1.is_some() {
        updates.push(format!("billing_address_line1 = ?{}", param_index));
        param_index += 1;
    }
    if request.billing_city.is_some() {
        updates.push(format!("billing_city = ?{}", param_index));
        param_index += 1;
    }
    if request.billing_state.is_some() {
        updates.push(format!("billing_state = ?{}", param_index));
        param_index += 1;
    }
    if request.billing_postal_code.is_some() {
        updates.push(format!("billing_postal_code = ?{}", param_index));
        param_index += 1;
    }
    if request.billing_country.is_some() {
        updates.push(format!("billing_country = ?{}", param_index));
        param_index += 1;
    }
    if request.description.is_some() {
        updates.push(format!("description = ?{}", param_index));
        param_index += 1;
    }
    if request.expense_type.is_some() {
        updates.push(format!("expense_type = ?{}", param_index));
        param_index += 1;
    }
    if request.amount.is_some() {
        updates.push(format!("amount = ?{}", param_index));
        param_index += 1;
    }
    if request.currency.is_some() {
        updates.push(format!("currency = ?{}", param_index));
        param_index += 1;
    }
    if request.status.is_some() {
        updates.push(format!("status = ?{}", param_index));
        param_index += 1;
    }
    if request.notes.is_some() {
        updates.push(format!("notes = ?{}", param_index));
        param_index += 1;
    }
    if request.internal_notes.is_some() {
        updates.push(format!("internal_notes = ?{}", param_index));
        param_index += 1;
    }

    updates.push(format!("updated_by = ?{}", param_index));
    param_index += 1;
    updates.push("updated_at = datetime('now')".to_string());

    if updates.len() < 2 {
        return Err(ApiError::BadRequest("No fields to update".to_string()));
    }

    let query = format!(
        r#"
        UPDATE customer_ledgers
        SET {}
        WHERE id = ?{}
        "#,
        updates.join(", "),
        param_index
    );

    let mut query_builder = sqlx::query(&query);

    if let Some(ref v) = request.company_name {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.company_registration_number {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.contact_person {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.contact_email {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.contact_phone {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_address_line1 {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_city {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_state {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_postal_code {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_country {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.description {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.expense_type {
        query_builder = query_builder.bind(v);
    }
    if let Some(amount) = request.amount {
        let decimal_amount = Decimal::from_f64_retain(amount)
            .ok_or_else(|| ApiError::BadRequest("Invalid amount".to_string()))?;
        query_builder = query_builder.bind(decimal_to_db(decimal_amount));
    }
    if let Some(ref v) = request.currency {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.status {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.notes {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.internal_notes {
        query_builder = query_builder.bind(v);
    }

    query_builder = query_builder.bind(user_id);
    query_builder = query_builder.bind(ledger_id);

    query_builder
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Fetch the updated ledger
    let row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(Json(ledger))
}

/// Update a customer ledger entry (PostgreSQL version)
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub async fn update_customer_ledger_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
    Json(request): Json<CustomerLedgerUpdateRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM customer_ledgers WHERE id = $1)")
            .bind(ledger_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    if !exists {
        return Err(ApiError::NotFound(
            "Customer ledger not found".to_string(),
        ));
    }

    let mut updates = Vec::new();
    let mut param_index = 1;

    if request.company_name.is_some() {
        updates.push(format!("company_name = ${}", param_index));
        param_index += 1;
    }
    if request.company_registration_number.is_some() {
        updates.push(format!("company_registration_number = ${}", param_index));
        param_index += 1;
    }
    if request.contact_person.is_some() {
        updates.push(format!("contact_person = ${}", param_index));
        param_index += 1;
    }
    if request.contact_email.is_some() {
        updates.push(format!("contact_email = ${}", param_index));
        param_index += 1;
    }
    if request.contact_phone.is_some() {
        updates.push(format!("contact_phone = ${}", param_index));
        param_index += 1;
    }
    if request.billing_address_line1.is_some() {
        updates.push(format!("billing_address_line1 = ${}", param_index));
        param_index += 1;
    }
    if request.billing_city.is_some() {
        updates.push(format!("billing_city = ${}", param_index));
        param_index += 1;
    }
    if request.billing_state.is_some() {
        updates.push(format!("billing_state = ${}", param_index));
        param_index += 1;
    }
    if request.billing_postal_code.is_some() {
        updates.push(format!("billing_postal_code = ${}", param_index));
        param_index += 1;
    }
    if request.billing_country.is_some() {
        updates.push(format!("billing_country = ${}", param_index));
        param_index += 1;
    }
    if request.description.is_some() {
        updates.push(format!("description = ${}", param_index));
        param_index += 1;
    }
    if request.expense_type.is_some() {
        updates.push(format!("expense_type = ${}", param_index));
        param_index += 1;
    }
    if request.amount.is_some() {
        updates.push(format!("amount = ${}", param_index));
        param_index += 1;
    }
    if request.currency.is_some() {
        updates.push(format!("currency = ${}", param_index));
        param_index += 1;
    }
    if request.status.is_some() {
        updates.push(format!("status = ${}", param_index));
        param_index += 1;
    }
    if request.notes.is_some() {
        updates.push(format!("notes = ${}", param_index));
        param_index += 1;
    }
    if request.internal_notes.is_some() {
        updates.push(format!("internal_notes = ${}", param_index));
        param_index += 1;
    }

    updates.push(format!("updated_by = ${}", param_index));
    param_index += 1;
    updates.push("updated_at = CURRENT_TIMESTAMP".to_string());

    if updates.len() < 2 {
        return Err(ApiError::BadRequest("No fields to update".to_string()));
    }

    let query = format!(
        r#"
        UPDATE customer_ledgers
        SET {}
        WHERE id = ${}
        RETURNING {}
        "#,
        updates.join(", "),
        param_index,
        LEDGER_SELECT_FIELDS
    );

    let mut query_builder = sqlx::query(&query);

    if let Some(ref v) = request.company_name {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.company_registration_number {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.contact_person {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.contact_email {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.contact_phone {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_address_line1 {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_city {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_state {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_postal_code {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.billing_country {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.description {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.expense_type {
        query_builder = query_builder.bind(v);
    }
    if let Some(amount) = request.amount {
        let decimal_amount = Decimal::from_f64_retain(amount)
            .ok_or_else(|| ApiError::BadRequest("Invalid amount".to_string()))?;
        query_builder = query_builder.bind(decimal_amount);
    }
    if let Some(ref v) = request.currency {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.status {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.notes {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.internal_notes {
        query_builder = query_builder.bind(v);
    }

    query_builder = query_builder.bind(user_id);
    query_builder = query_builder.bind(ledger_id);

    let row = query_builder
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(Json(ledger))
}

/// Delete a customer ledger entry
pub async fn delete_customer_ledger_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    // Fetch ledger status and paid_amount
    let ledger_row = sqlx::query(GET_LEDGER_STATUS_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    match ledger_row {
        None => return Err(ApiError::NotFound("Customer ledger not found".to_string())),
        Some(row) => {
            let status: String = row.try_get("status").unwrap_or_default();
            let paid_amount = get_decimal(&row, "paid_amount");
            if status == "paid" {
                return Err(ApiError::BadRequest(
                    "Cannot delete a paid ledger entry".to_string(),
                ));
            }
            if paid_amount > Decimal::ZERO {
                return Err(ApiError::BadRequest(
                    "Cannot delete a ledger with partial payments. Mark it as cancelled instead."
                        .to_string(),
                ));
            }
        }
    }

    sqlx::query(DELETE_LEDGER_PAYMENTS_QUERY)
        .bind(ledger_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let result = sqlx::query(DELETE_LEDGER_QUERY)
        .bind(ledger_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound(
            "Customer ledger not found".to_string(),
        ));
    }

    Ok(Json(serde_json::json!({
        "message": "Customer ledger deleted successfully",
        "ledger_id": ledger_id
    })))
}

/// Record a payment against a customer ledger (SQLite version)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn create_ledger_payment_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
    Json(request): Json<CustomerLedgerPaymentRequest>,
) -> Result<Json<CustomerLedgerPayment>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let ledger_row = sqlx::query(GET_LEDGER_FOR_PAYMENT_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let (total_amount, current_paid, current_status) = match ledger_row {
        Some(row) => {
            let amount = get_decimal(&row, "amount");
            let paid = get_decimal(&row, "paid_amount");
            let status: String = row.try_get("status").unwrap_or_default();
            (amount, paid, status)
        }
        None => return Err(ApiError::NotFound("Customer ledger not found".to_string())),
    };

    if current_status == "cancelled" {
        return Err(ApiError::BadRequest(
            "Cannot record payment for a cancelled ledger".to_string(),
        ));
    }

    let payment_amount = Decimal::from_f64_retain(request.payment_amount)
        .ok_or_else(|| ApiError::BadRequest("Invalid payment amount".to_string()))?;

    if payment_amount <= Decimal::ZERO {
        return Err(ApiError::BadRequest(
            "Payment amount must be positive".to_string(),
        ));
    }

    let new_total_paid = current_paid + payment_amount;

    let new_status = if new_total_paid >= total_amount {
        "paid"
    } else if new_total_paid > Decimal::ZERO {
        "partial"
    } else {
        "pending"
    };

    // Insert payment without RETURNING
    sqlx::query(
        r#"
        INSERT INTO customer_ledger_payments (
            ledger_id, payment_amount, payment_method, payment_reference,
            payment_date, receipt_number, receipt_file_url, notes, processed_by
        )
        VALUES (?1, ?2, ?3, ?4, datetime('now'), ?5, ?6, ?7, ?8)
        "#,
    )
    .bind(ledger_id)
    .bind(decimal_to_db(payment_amount))
    .bind(&request.payment_method)
    .bind(&request.payment_reference)
    .bind(&request.receipt_number)
    .bind(&request.receipt_file_url)
    .bind(&request.notes)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get the inserted payment
    let payment_id: i64 = sqlx::query_scalar::<_, i64>("SELECT last_insert_rowid()")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let payment_row = sqlx::query(
        r#"
        SELECT id, ledger_id, payment_amount, payment_method, payment_reference,
               payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at
        FROM customer_ledger_payments
        WHERE id = ?1
        "#,
    )
    .bind(payment_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let payment = row_to_customer_ledger_payment(&payment_row);

    // Update ledger totals
    sqlx::query(
        r#"
        UPDATE customer_ledgers
        SET paid_amount = ?1,
            status = ?2,
            payment_method = ?3,
            payment_reference = ?4,
            payment_date = datetime('now'),
            updated_at = datetime('now'),
            updated_by = ?5
        WHERE id = ?6
        "#,
    )
    .bind(decimal_to_db(new_total_paid))
    .bind(new_status)
    .bind(&request.payment_method)
    .bind(&request.payment_reference)
    .bind(user_id)
    .bind(ledger_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(payment))
}

/// Record a payment against a customer ledger (PostgreSQL version)
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub async fn create_ledger_payment_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
    Json(request): Json<CustomerLedgerPaymentRequest>,
) -> Result<Json<CustomerLedgerPayment>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let ledger_row = sqlx::query(GET_LEDGER_FOR_PAYMENT_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let (total_amount, current_paid, current_status) = match ledger_row {
        Some(row) => {
            let amount = get_decimal(&row, "amount");
            let paid = get_decimal(&row, "paid_amount");
            let status: String = row.try_get("status").unwrap_or_default();
            (amount, paid, status)
        }
        None => return Err(ApiError::NotFound("Customer ledger not found".to_string())),
    };

    if current_status == "cancelled" {
        return Err(ApiError::BadRequest(
            "Cannot record payment for a cancelled ledger".to_string(),
        ));
    }

    let payment_amount = Decimal::from_f64_retain(request.payment_amount)
        .ok_or_else(|| ApiError::BadRequest("Invalid payment amount".to_string()))?;

    if payment_amount <= Decimal::ZERO {
        return Err(ApiError::BadRequest(
            "Payment amount must be positive".to_string(),
        ));
    }

    let new_total_paid = current_paid + payment_amount;

    let new_status = if new_total_paid >= total_amount {
        "paid"
    } else if new_total_paid > Decimal::ZERO {
        "partial"
    } else {
        "pending"
    };

    let payment_row = sqlx::query(
        r#"
        INSERT INTO customer_ledger_payments (
            ledger_id, payment_amount, payment_method, payment_reference,
            payment_date, receipt_number, receipt_file_url, notes, processed_by
        )
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7, $8)
        RETURNING id, ledger_id, payment_amount, payment_method, payment_reference,
                  payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at
        "#,
    )
    .bind(ledger_id)
    .bind(payment_amount)
    .bind(&request.payment_method)
    .bind(&request.payment_reference)
    .bind(&request.receipt_number)
    .bind(&request.receipt_file_url)
    .bind(&request.notes)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let payment = row_to_customer_ledger_payment(&payment_row);

    sqlx::query(
        r#"
        UPDATE customer_ledgers
        SET paid_amount = $1,
            status = $2,
            payment_method = $3,
            payment_reference = $4,
            payment_date = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = $5
        WHERE id = $6
        "#,
    )
    .bind(new_total_paid)
    .bind(new_status)
    .bind(&request.payment_method)
    .bind(&request.payment_reference)
    .bind(user_id)
    .bind(ledger_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(payment))
}

/// Get payment history for a ledger
pub async fn get_ledger_payments_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
) -> Result<Json<Vec<CustomerLedgerPayment>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    // Check if ledger exists
    let exists = sqlx::query(CHECK_LEDGER_EXISTS_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if exists.is_none() {
        return Err(ApiError::NotFound(
            "Customer ledger not found".to_string(),
        ));
    }

    let rows = sqlx::query(GET_LEDGER_PAYMENTS_QUERY)
        .bind(ledger_id)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let payments: Vec<CustomerLedgerPayment> = rows
        .iter()
        .map(row_to_customer_ledger_payment)
        .collect();

    Ok(Json(payments))
}

/// Get summary statistics for ledgers (SQLite version)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn get_ledger_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let row = sqlx::query(
        r#"
        SELECT
            COUNT(*) as total_entries,
            COALESCE(SUM(CAST(amount AS REAL)), 0) as total_amount,
            COALESCE(SUM(CAST(paid_amount AS REAL)), 0) as total_paid,
            COALESCE(SUM(CAST(balance_due AS REAL)), 0) as total_outstanding,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial_count,
            SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue_count
        FROM customer_ledgers
        WHERE status NOT IN ('cancelled')
        "#,
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total_entries: i64 = row.try_get("total_entries").unwrap_or(0);
    let total_amount: f64 = row.try_get("total_amount").unwrap_or(0.0);
    let total_paid: f64 = row.try_get("total_paid").unwrap_or(0.0);
    let total_outstanding: f64 = row.try_get("total_outstanding").unwrap_or(0.0);
    let pending_count: i64 = row.try_get("pending_count").unwrap_or(0);
    let partial_count: i64 = row.try_get("partial_count").unwrap_or(0);
    let overdue_count: i64 = row.try_get("overdue_count").unwrap_or(0);

    Ok(Json(serde_json::json!({
        "total_entries": total_entries,
        "total_amount": total_amount,
        "total_paid": total_paid,
        "total_outstanding": total_outstanding,
        "pending_count": pending_count,
        "partial_count": partial_count,
        "overdue_count": overdue_count
    })))
}

/// Get summary statistics for ledgers (PostgreSQL version)
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub async fn get_ledger_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let row = sqlx::query(
        r#"
        SELECT
            COUNT(*) as total_entries,
            COALESCE(SUM(amount), 0) as total_amount,
            COALESCE(SUM(paid_amount), 0) as total_paid,
            COALESCE(SUM(balance_due), 0) as total_outstanding,
            COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
            COUNT(*) FILTER (WHERE status = 'partial') as partial_count,
            COUNT(*) FILTER (WHERE status = 'overdue') as overdue_count
        FROM customer_ledgers
        WHERE status NOT IN ('cancelled')
        "#,
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total_entries: i64 = row.try_get("total_entries").unwrap_or(0);
    let total_amount = get_decimal(&row, "total_amount");
    let total_paid = get_decimal(&row, "total_paid");
    let total_outstanding = get_decimal(&row, "total_outstanding");
    let pending_count: i64 = row.try_get("pending_count").unwrap_or(0);
    let partial_count: i64 = row.try_get("partial_count").unwrap_or(0);
    let overdue_count: i64 = row.try_get("overdue_count").unwrap_or(0);

    Ok(Json(serde_json::json!({
        "total_entries": total_entries,
        "total_amount": total_amount,
        "total_paid": total_paid,
        "total_outstanding": total_outstanding,
        "pending_count": pending_count,
        "partial_count": partial_count,
        "overdue_count": overdue_count
    })))
}

/// Get all PAT transaction codes
pub async fn get_pat_transaction_codes_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<PatTransactionCode>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let rows = sqlx::query(GET_PAT_TRANSACTION_CODES_QUERY)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let codes: Vec<PatTransactionCode> = rows.iter().map(row_to_pat_transaction_code).collect();

    Ok(Json(codes))
}

/// Get all PAT department codes
pub async fn get_pat_department_codes_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<PatDepartmentCode>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    // PatDepartmentCode doesn't have Decimal fields, so we can use query_as
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let codes: Vec<PatDepartmentCode> = sqlx::query_as(GET_PAT_DEPARTMENT_CODES_QUERY)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let codes: Vec<PatDepartmentCode> = sqlx::query_as(GET_PAT_DEPARTMENT_CODES_QUERY)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(codes))
}

/// Void a ledger entry (SQLite version)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn void_ledger_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
    Json(request): Json<LedgerVoidRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Check if ledger exists and is not already voided
    let exists_row = sqlx::query(CHECK_LEDGER_VOIDED_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    match exists_row {
        None => return Err(ApiError::NotFound("Customer ledger not found".to_string())),
        Some(row) => {
            // SQLite returns 0/1 for boolean expressions
            let is_voided: i32 = row.try_get(0).unwrap_or(0);
            if is_voided != 0 {
                return Err(ApiError::BadRequest("Ledger is already voided".to_string()));
            }
        }
    }

    sqlx::query(
        r#"
        UPDATE customer_ledgers
        SET void_at = datetime('now'),
            void_by = ?1,
            void_reason = ?2,
            status = 'cancelled',
            updated_at = datetime('now'),
            updated_by = ?1
        WHERE id = ?3
        "#,
    )
    .bind(user_id)
    .bind(&request.reason)
    .bind(ledger_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(Json(ledger))
}

/// Void a ledger entry (PostgreSQL version)
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub async fn void_ledger_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
    Json(request): Json<LedgerVoidRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Check if ledger exists and is not already voided
    let exists: Option<bool> = sqlx::query_scalar(
        "SELECT void_at IS NOT NULL FROM customer_ledgers WHERE id = $1"
    )
    .bind(ledger_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    match exists {
        None => return Err(ApiError::NotFound("Customer ledger not found".to_string())),
        Some(true) => return Err(ApiError::BadRequest("Ledger is already voided".to_string())),
        Some(false) => {}
    }

    let query_str = format!(
        r#"
        UPDATE customer_ledgers
        SET void_at = CURRENT_TIMESTAMP,
            void_by = $1,
            void_reason = $2,
            status = 'cancelled',
            updated_at = CURRENT_TIMESTAMP,
            updated_by = $1
        WHERE id = $3
        RETURNING {}
        "#,
        LEDGER_SELECT_FIELDS
    );

    let row = sqlx::query(&query_str)
        .bind(user_id)
        .bind(&request.reason)
        .bind(ledger_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(Json(ledger))
}

/// Create a reversal for a ledger entry (SQLite version)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub async fn create_ledger_reversal_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
    Json(request): Json<LedgerReversalRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Get the original ledger
    let original_row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Customer ledger not found".to_string()))?;

    let original = row_to_customer_ledger(&original_row);

    if original.is_reversal.unwrap_or(false) {
        return Err(ApiError::BadRequest("Cannot reverse a reversal entry".to_string()));
    }

    // Create the reversal entry with opposite transaction type
    let reversal_type = if original.transaction_type.as_deref() == Some("debit") {
        "credit"
    } else {
        "debit"
    };

    let description = format!("REVERSAL: {}", original.description);

    // Insert reversal without RETURNING
    sqlx::query(
        r#"
        INSERT INTO customer_ledgers (
            company_name, company_registration_number, contact_person,
            contact_email, contact_phone, billing_address_line1, billing_city,
            billing_state, billing_postal_code, billing_country, description,
            expense_type, amount, currency, status, paid_amount,
            booking_id, guest_id, notes, internal_notes,
            created_by, updated_by, cashier_id,
            folio_type, transaction_type, post_type, department_code,
            transaction_code, room_number, posting_date, transaction_date,
            reference_number, tax_amount, service_charge,
            is_reversal, original_transaction_id, reversal_reason
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'paid', ?13,
                ?15, ?16, ?17, ?18, ?19, ?19, ?19,
                ?20, ?21, ?22, ?23, ?24, ?25, date('now'), date('now'),
                ?26, ?27, ?28, 1, ?29, ?30)
        "#,
    )
    .bind(&original.company_name)
    .bind(&original.company_registration_number)
    .bind(&original.contact_person)
    .bind(&original.contact_email)
    .bind(&original.contact_phone)
    .bind(&original.billing_address_line1)
    .bind(&original.billing_city)
    .bind(&original.billing_state)
    .bind(&original.billing_postal_code)
    .bind(&original.billing_country)
    .bind(&description)
    .bind(&original.expense_type)
    .bind(decimal_to_db(original.amount))
    .bind(&original.currency)
    .bind(original.booking_id)
    .bind(original.guest_id)
    .bind(&request.notes)
    .bind(&original.internal_notes)
    .bind(user_id)
    .bind(&original.folio_type)
    .bind(reversal_type)
    .bind(&original.post_type)
    .bind(&original.department_code)
    .bind(&original.transaction_code)
    .bind(&original.room_number)
    .bind(&original.reference_number)
    .bind(opt_decimal_to_db(original.tax_amount))
    .bind(opt_decimal_to_db(original.service_charge))
    .bind(ledger_id)
    .bind(&request.reason)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get the inserted reversal
    let reversal_id: i64 = sqlx::query_scalar::<_, i64>("SELECT last_insert_rowid()")
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(reversal_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let reversal = row_to_customer_ledger(&row);

    Ok(Json(reversal))
}

/// Create a reversal for a ledger entry (PostgreSQL version)
#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub async fn create_ledger_reversal_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ledger_id): Path<i64>,
    Json(request): Json<LedgerReversalRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Get the original ledger
    let original_row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Customer ledger not found".to_string()))?;

    let original = row_to_customer_ledger(&original_row);

    if original.is_reversal.unwrap_or(false) {
        return Err(ApiError::BadRequest("Cannot reverse a reversal entry".to_string()));
    }

    // Create the reversal entry with opposite transaction type
    let reversal_type = if original.transaction_type.as_deref() == Some("debit") {
        "credit"
    } else {
        "debit"
    };

    let reversal_query = format!(
        r#"
        INSERT INTO customer_ledgers (
            company_name, company_registration_number, contact_person,
            contact_email, contact_phone, billing_address_line1, billing_city,
            billing_state, billing_postal_code, billing_country, description,
            expense_type, amount, currency, status, paid_amount,
            booking_id, guest_id, notes, internal_notes,
            created_by, updated_by, cashier_id,
            folio_type, transaction_type, post_type, department_code,
            transaction_code, room_number, posting_date, transaction_date,
            reference_number, tax_amount, service_charge,
            is_reversal, original_transaction_id, reversal_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'paid', $13,
                $15, $16, $17, $18, $19, $19, $19,
                $20, $21, $22, $23, $24, $25, CURRENT_DATE, CURRENT_DATE,
                $26, $27, $28, TRUE, $29, $30)
        RETURNING {}
        "#,
        LEDGER_SELECT_FIELDS
    );

    let row = sqlx::query(&reversal_query)
        .bind(&original.company_name)
        .bind(&original.company_registration_number)
        .bind(&original.contact_person)
        .bind(&original.contact_email)
        .bind(&original.contact_phone)
        .bind(&original.billing_address_line1)
        .bind(&original.billing_city)
        .bind(&original.billing_state)
        .bind(&original.billing_postal_code)
        .bind(&original.billing_country)
        .bind(format!("REVERSAL: {}", original.description))
        .bind(&original.expense_type)
        .bind(original.amount)
        .bind(&original.currency)
        .bind(original.booking_id)
        .bind(original.guest_id)
        .bind(&request.notes)
        .bind(&original.internal_notes)
        .bind(user_id)
        .bind(&original.folio_type)
        .bind(reversal_type)
        .bind(&original.post_type)
        .bind(&original.department_code)
        .bind(&original.transaction_code)
        .bind(&original.room_number)
        .bind(&original.reference_number)
        .bind(original.tax_amount)
        .bind(original.service_charge)
        .bind(ledger_id)
        .bind(&request.reason)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let reversal = row_to_customer_ledger(&row);

    Ok(Json(reversal))
}
