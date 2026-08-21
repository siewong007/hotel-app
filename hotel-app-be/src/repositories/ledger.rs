//! Customer ledger repository workflows
//!
//! Query-heavy ledger workflows preserved behind the service/handler boundary.

use chrono::NaiveDate;
use rust_decimal::{Decimal, RoundingStrategy};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use crate::core::db::{DbPool, DbTransaction, hotel_today};
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::row_mappers::{
    get_decimal, row_to_customer_ledger, row_to_customer_ledger_payment,
};
use crate::models::*;
use crate::utils::pagination::normalize_pagination_with_offset;

// Common SELECT fields for CustomerLedger.
const LEDGER_SELECT_FIELDS: &str = r#"
    id, company_name, company_registration_number, contact_person,
    contact_email, contact_phone, billing_address_line1, billing_city,
    billing_state, billing_postal_code, billing_country, description,
    expense_type, amount, currency, status, paid_amount, balance_due,
    payment_method, payment_reference, payment_date, booking_id,
    (SELECT b.check_in_date FROM bookings b WHERE b.id = customer_ledgers.booking_id) AS check_in_date,
    (SELECT b.check_out_date FROM bookings b WHERE b.id = customer_ledgers.booking_id) AS check_out_date,
    guest_id,
    invoice_number, invoice_date, due_date, notes, internal_notes,
    created_by, updated_by, created_at, updated_at,
    folio_number, folio_type, transaction_type, post_type, department_code,
    transaction_code, room_number, posting_date, transaction_date,
    reference_number, cashier_id, is_reversal, original_transaction_id,
    reversal_reason, tax_amount, service_charge, net_amount,
    is_posted, posted_at, void_at, void_by, void_reason
"#;

async fn default_payment_terms_days(pool: &DbPool) -> i64 {
    settings_cache::get_positive_i32(pool, "default_payment_terms_days", 30).await as i64
}

// ----------------------------------------------------------------------------
// Ledger list filter predicates
//
// These build the `AND (...)` SQL fragments used by `list_customer_ledgers` for
// the `invoice_state`, `balance_state`, and `ui_status` filters surfaced by the
// Customer Ledger UI (the "Uninvoiced / Outstanding / Invoiced / Paid / Overdue
// / Voided" buttons). They are extracted into pure functions so the exact SQL
// share one source of truth.
//
// `null_expr` is the placeholder used for the "filter not set" check (it carries
// a `::text` cast under PostgreSQL); `p` is the placeholder for equality checks;
// `today` is the current-date SQL expression (`CURRENT_DATE` / `date('now')`).
//
// The classification mirrors the frontend `getLedgerUiStatus` helper, which is
// strictly *balance-first*: a row counts as "paid" only when nothing is
// outstanding (`balance_due <= 0`), regardless of the stored `status` column —
// so a charge that re-opens a balance correctly drops out of "Paid".

/// `invoice_state` filter: `uninvoiced` (no invoice number) / `invoiced`.
pub fn invoice_state_clause(null_expr: &str, p: &str) -> String {
    format!(
        "AND ({null_expr} IS NULL \
         OR ({p} = 'uninvoiced' AND invoice_number IS NULL AND void_at IS NULL AND status <> 'void') \
         OR ({p} = 'invoiced' AND invoice_number IS NOT NULL AND void_at IS NULL AND status <> 'void'))"
    )
}

/// `balance_state` filter: `outstanding` / `clear`.
///
/// `outstanding` means a current, not-yet-invoiced amount still owed — a
/// positive balance that is not yet overdue. Past-due and invoiced rows are
/// deliberately excluded so they surface only under the dedicated `Overdue` and
/// `Invoiced` filters. The overdue exclusion mirrors the `overdue` arm of
/// `ui_status_clause`: a row is overdue when `status = 'overdue'` or its
/// `due_date` is before `today`.
pub fn balance_state_clause(null_expr: &str, p: &str, today: &str) -> String {
    format!(
        "AND ({null_expr} IS NULL \
         OR ({p} = 'outstanding' AND COALESCE(balance_due, 0) > 0 AND invoice_number IS NULL AND void_at IS NULL AND status <> 'void' AND status <> 'overdue' AND (due_date IS NULL OR due_date >= {today})) \
         OR ({p} = 'clear' AND COALESCE(balance_due, 0) <= 0))"
    )
}

/// `ui_status` filter: matches the derived badge shown in the UI table.
pub fn ui_status_clause(null_expr: &str, p: &str, today: &str) -> String {
    format!(
        "AND ({null_expr} IS NULL \
         OR ({p} = 'voided' AND (void_at IS NOT NULL OR status = 'void')) \
         OR ({p} = 'paid' AND void_at IS NULL AND COALESCE(balance_due, 0) <= 0) \
         OR ({p} = 'overdue' AND void_at IS NULL AND COALESCE(balance_due, 0) > 0 AND (status = 'overdue' OR due_date < {today})) \
         OR ({p} = 'partial' AND void_at IS NULL AND COALESCE(balance_due, 0) > 0 AND COALESCE(paid_amount, 0) > 0 AND status <> 'overdue' AND (due_date IS NULL OR due_date >= {today})) \
         OR ({p} = 'invoiced' AND void_at IS NULL AND COALESCE(balance_due, 0) > 0 AND COALESCE(paid_amount, 0) <= 0 AND invoice_number IS NOT NULL AND status <> 'overdue' AND (due_date IS NULL OR due_date >= {today})) \
         OR ({p} = 'ready_to_invoice' AND void_at IS NULL AND COALESCE(balance_due, 0) > 0 AND COALESCE(paid_amount, 0) <= 0 AND invoice_number IS NULL AND status <> 'overdue' AND (due_date IS NULL OR due_date >= {today})) \
         OR ({p} = 'draft' AND void_at IS NULL AND COALESCE(balance_due, 0) <= 0 AND status <> 'paid'))"
    )
}

// PostgreSQL query for getting ledger by ID
const GET_LEDGER_BY_ID_QUERY: &str = r#"
    SELECT id, company_name, company_registration_number, contact_person,
        contact_email, contact_phone, billing_address_line1, billing_city,
        billing_state, billing_postal_code, billing_country, description,
        expense_type, amount, currency, status, paid_amount, balance_due,
        payment_method, payment_reference, payment_date, booking_id,
        (SELECT b.check_in_date FROM bookings b WHERE b.id = customer_ledgers.booking_id) AS check_in_date,
        (SELECT b.check_out_date FROM bookings b WHERE b.id = customer_ledgers.booking_id) AS check_out_date,
        guest_id,
        invoice_number, invoice_date, due_date, notes, internal_notes,
        created_by, updated_by, created_at, updated_at,
        folio_number, folio_type, transaction_type, post_type, department_code,
        transaction_code, room_number, posting_date, transaction_date,
        reference_number, cashier_id, is_reversal, original_transaction_id,
        reversal_reason, tax_amount, service_charge, net_amount,
        is_posted, posted_at, void_at, void_by, void_reason
    FROM customer_ledgers WHERE id = $1
"#;

// PostgreSQL query for getting ledger payments
const GET_LEDGER_PAYMENTS_QUERY: &str = r#"
    SELECT id, ledger_id, payment_amount, payment_method, payment_reference,
           payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at,
           idempotency_key, idempotency_fingerprint
    FROM customer_ledger_payments
    WHERE ledger_id = $1
    ORDER BY payment_date DESC
"#;

// PostgreSQL query for checking ledger exists
const CHECK_LEDGER_EXISTS_QUERY: &str =
    "SELECT EXISTS(SELECT 1 FROM customer_ledgers WHERE id = $1)";

// PostgreSQL query for getting ledger status and paid_amount
const GET_LEDGER_STATUS_QUERY: &str =
    "SELECT status, paid_amount FROM customer_ledgers WHERE id = $1";

// PostgreSQL query for deleting ledger payments
const DELETE_LEDGER_PAYMENTS_QUERY: &str =
    "DELETE FROM customer_ledger_payments WHERE ledger_id = $1";

// PostgreSQL query for deleting ledger
const DELETE_LEDGER_QUERY: &str = "DELETE FROM customer_ledgers WHERE id = $1";

/// List all customer ledgers with optional filters
pub async fn list_customer_ledgers(
    pool: &DbPool,
    query: LedgerListQuery,
) -> Result<LedgerPaginatedResponse, ApiError> {
    let pagination = normalize_pagination_with_offset(
        query.page,
        query.page_size.or(query.limit.map(i64::from)),
        query.offset.map(i64::from),
        50,
        500,
    );

    // Whitelisted sort column and direction — safe to interpolate via format!
    let sort_col = match query.sort_by.as_deref() {
        Some("company_name") => "company_name",
        Some("amount") => "amount",
        Some("balance_due") => "balance_due",
        Some("status") => "status",
        Some("due_date") => "due_date",
        _ => "created_at",
    };
    let sort_dir = if query.sort_order.as_deref() == Some("asc") {
        "ASC"
    } else {
        "DESC"
    };

    // Normalise the free-text search (None when blank)
    let search = query.search.as_deref().filter(|s| !s.trim().is_empty());
    let invoice_state = match query.invoice_state.as_deref().filter(|s| !s.is_empty()) {
        Some("uninvoiced") => Some("uninvoiced"),
        Some("invoiced") => Some("invoiced"),
        Some(_) => {
            return Err(ApiError::BadRequest(
                "Invalid invoice_state filter".to_string(),
            ));
        }
        None => None,
    };
    let balance_state = match query.balance_state.as_deref().filter(|s| !s.is_empty()) {
        Some("outstanding") => Some("outstanding"),
        Some("clear") => Some("clear"),
        Some(_) => {
            return Err(ApiError::BadRequest(
                "Invalid balance_state filter".to_string(),
            ));
        }
        None => None,
    };
    let ui_status = match query.ui_status.as_deref().filter(|s| !s.is_empty()) {
        Some(
            status @ ("draft" | "ready_to_invoice" | "invoiced" | "partial" | "paid" | "overdue"
            | "voided"),
        ) => Some(status),
        Some(_) => {
            return Err(ApiError::BadRequest("Invalid ui_status filter".to_string()));
        }
        None => None,
    };

    // Build queries dynamically so we can inject the safe ORDER BY and the
    // optional search clause. All user-supplied values still go through bindings.

    let (count_sql, data_sql) = {
        let search_clause = if search.is_some() {
            "AND ($8::text IS NULL OR (CAST(id AS TEXT) ILIKE '%' || $8 || '%' OR company_name ILIKE '%' || $8 || '%' OR description ILIKE '%' || $8 || '%' OR COALESCE(invoice_number,'') ILIKE '%' || $8 || '%' OR COALESCE(folio_number,'') ILIKE '%' || $8 || '%' OR COALESCE(contact_person,'') ILIKE '%' || $8 || '%' OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = customer_ledgers.booking_id AND b.booking_number ILIKE '%' || $8 || '%')))"
        } else {
            "AND ($8::text IS NULL OR TRUE)"
        };
        let invoice_clause = invoice_state_clause("$9::text", "$9");
        let balance_clause = balance_state_clause("$10::text", "$10", "CURRENT_DATE");
        let ui_clause = ui_status_clause("$11::text", "$11", "CURRENT_DATE");
        let base_where = format!(
            "WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR company_name ILIKE '%' || $2 || '%') AND ($3::text IS NULL OR expense_type = $3) AND ($4::text IS NULL OR folio_type = $4) AND ($5::text IS NULL OR post_type = $5) AND ($6::text IS NULL OR department_code = $6) AND ($7::text IS NULL OR room_number = $7) {search_clause} {invoice_clause} {balance_clause} {ui_clause}"
        );
        let count = format!("SELECT COUNT(*) FROM customer_ledgers {base_where}");
        let data = format!(
            "SELECT {LEDGER_SELECT_FIELDS} FROM customer_ledgers {base_where} ORDER BY {sort_col} {sort_dir} LIMIT $12 OFFSET $13"
        );
        (count, data)
    };

    let total: i64 = sqlx::query_scalar(&count_sql)
        .bind(query.status.as_deref())
        .bind(query.company_name.as_deref())
        .bind(query.expense_type.as_deref())
        .bind(query.folio_type.as_deref())
        .bind(query.post_type.as_deref())
        .bind(query.department_code.as_deref())
        .bind(query.room_number.as_deref())
        .bind(search)
        .bind(invoice_state)
        .bind(balance_state)
        .bind(ui_status)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let rows = sqlx::query(&data_sql)
        .bind(query.status.as_deref())
        .bind(query.company_name.as_deref())
        .bind(query.expense_type.as_deref())
        .bind(query.folio_type.as_deref())
        .bind(query.post_type.as_deref())
        .bind(query.department_code.as_deref())
        .bind(query.room_number.as_deref())
        .bind(search)
        .bind(invoice_state)
        .bind(balance_state)
        .bind(ui_status)
        .bind(pagination.page_size)
        .bind(pagination.offset)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledgers: Vec<CustomerLedger> = rows.iter().map(row_to_customer_ledger).collect();

    Ok(LedgerPaginatedResponse {
        data: ledgers,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    })
}

/// Get a single customer ledger by ID
pub async fn get_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<CustomerLedger, ApiError> {
    let row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Customer ledger not found".to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(ledger)
}

/// Get customer ledger with payment history
pub async fn get_customer_ledger_with_payments(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<CustomerLedgerWithPayments, ApiError> {
    let row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Customer ledger not found".to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    let payment_rows = sqlx::query(GET_LEDGER_PAYMENTS_QUERY)
        .bind(ledger_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let payments: Vec<CustomerLedgerPayment> = payment_rows
        .iter()
        .map(row_to_customer_ledger_payment)
        .collect();

    Ok(CustomerLedgerWithPayments { ledger, payments })
}

/// Create a new customer ledger entry.
pub async fn create_customer_ledger(
    pool: &DbPool,
    user_id: i64,
    request: CustomerLedgerCreateRequest,
) -> Result<CustomerLedger, ApiError> {
    let invoice_date = request
        .invoice_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let posting_date = request
        .posting_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let transaction_date = request
        .transaction_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    // due_date: prefer the caller's value; otherwise look up the company's
    // payment_terms_days; otherwise fall back to default_payment_terms_days.
    // Without this, auto-created ledgers (company check-in / checkout) leave
    // due_date NULL and the UI shows "-".
    let due_date = match request
        .due_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
    {
        Some(d) => Some(d),
        None => {
            let default_terms_days = default_payment_terms_days(pool).await;
            let terms_days: i32 = sqlx::query_scalar::<_, Option<i32>>(
                "SELECT payment_terms_days FROM companies WHERE company_name = $1 LIMIT 1",
            )
            .bind(&request.company_name)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .flatten()
            .unwrap_or(default_terms_days as i32);
            let base = match posting_date {
                Some(date) => date,
                // Hotel business day, not server OS time (see core/db.rs::hotel_today)
                None => hotel_today(pool).await?,
            };
            Some(base + chrono::Duration::days(terms_days as i64))
        }
    };

    let amount = Decimal::from_f64_retain(request.amount)
        .ok_or_else(|| ApiError::BadRequest("Invalid amount".to_string()))?;
    let tax_amount = request.tax_amount.and_then(Decimal::from_f64_retain);
    let service_charge = request.service_charge.and_then(Decimal::from_f64_retain);

    if let Some(booking_id) = request.booking_id {
        let existing_query = format!(
            r#"
            SELECT {}
            FROM customer_ledgers
            WHERE booking_id = $1
              AND company_name = $2
              AND description = $3
              AND expense_type = $4
              AND amount = $5
              AND post_type IS NOT DISTINCT FROM $6
              AND room_number IS NOT DISTINCT FROM $7
              AND posting_date IS NOT DISTINCT FROM $8
              AND transaction_date IS NOT DISTINCT FROM $9
              AND void_at IS NULL
            ORDER BY id DESC
            LIMIT 1
            "#,
            LEDGER_SELECT_FIELDS
        );

        let existing = sqlx::query(&existing_query)
            .bind(booking_id)
            .bind(&request.company_name)
            .bind(&request.description)
            .bind(&request.expense_type)
            .bind(amount)
            .bind(&request.post_type)
            .bind(&request.room_number)
            .bind(posting_date)
            .bind(transaction_date)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        if let Some(row) = existing {
            return Ok(row_to_customer_ledger(&row));
        }
    }

    let invoice_number = crate::services::invoice_numbers::next_invoice_number(pool).await?;

    let query_str = format!(
        r#"
        INSERT INTO customer_ledgers (
            company_name, company_registration_number, contact_person,
            contact_email, contact_phone, billing_address_line1, billing_city,
            billing_state, billing_postal_code, billing_country, description,
            expense_type, amount, currency, status, paid_amount,
            booking_id, guest_id, invoice_number, invoice_date, due_date, notes, internal_notes,
            created_by, updated_by, cashier_id,
            folio_type, transaction_type, post_type, department_code,
            transaction_code, room_number, posting_date, transaction_date,
            reference_number, tax_amount, service_charge
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', 0,
                $15, $16, $33, $17, $18, $19, $20, $21, $21, $21,
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
        .bind(request.booking_id)
        .bind(request.guest_id)
        .bind(invoice_date)
        .bind(due_date)
        .bind(&request.notes)
        .bind(&request.internal_notes)
        .bind(user_id)
        // Ledger accounting fields
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
        .bind(&invoice_number)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(ledger)
}

// Mirrors the `valid_post_type` CHECK constraint on `customer_ledgers`
// (database/postgres/migrations/0001_v1_baseline.sql). Kept in sync by hand -
// an unknown value must be refused here as a 400, not left to hit the
// database CHECK as an opaque 500.
const VALID_POST_TYPES: &[&str] = &[
    "room_charge",
    "room_tax",
    "service_charge",
    "tourism_tax",
    "fnb_restaurant",
    "fnb_room_service",
    "fnb_minibar",
    "fnb_banquet",
    "laundry",
    "telephone",
    "internet",
    "parking",
    "spa",
    "gym",
    "transportation",
    "miscellaneous",
    "advance_deposit",
    "payment",
    "adjustment",
    "rebate",
    "discount",
    "commission",
    "refund",
    "transfer_in",
    "transfer_out",
    "city_ledger_transfer",
];

/// Update a customer ledger entry (PostgreSQL version)
pub async fn update_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: CustomerLedgerUpdateRequest,
) -> Result<CustomerLedger, ApiError> {
    let current_row =
        sqlx::query("SELECT status, amount, paid_amount FROM customer_ledgers WHERE id = $1")
            .bind(ledger_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    let Some(current_row) = current_row else {
        return Err(ApiError::NotFound("Customer ledger not found".to_string()));
    };

    let current_status: String = current_row
        .try_get("status")
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let current_amount = get_decimal(&current_row, "amount");
    let current_paid = get_decimal(&current_row, "paid_amount");

    // Only `void_ledger` may TRANSITION status to 'void' - that path stamps
    // void_at/void_by/void_reason. This generic update is gated by
    // `ledgers:update` at the route layer (not `ledgers:void`), so letting a
    // pending/other row flip to status='void' through here would produce an
    // unattributable void. An already-void row echoing status='void' back
    // unchanged (e.g. editing notes on a voided ledger) is not a transition
    // and must be allowed through.
    if request.status.as_deref() == Some("void") && current_status != "void" {
        return Err(ApiError::BadRequest(
            "Cannot set status to 'void' via update; use the void endpoint instead".to_string(),
        ));
    }

    // 'paid' must be EARNED by money actually recorded, not typed in. This
    // update writes the `status` column alone - it inserts no
    // customer_ledger_payments row and never touches paid_amount, so a
    // hand-set 'paid' left `balance_due` (GENERATED as amount - paid_amount)
    // positive. The UI badge is balance-first (`ui_status_clause` keys 'paid'
    // off `balance_due <= 0`) and so ignored the typed-in value entirely,
    // while the stored column still, invisibly: made `delete_customer_ledger`
    // refuse the row forever ("Cannot delete a paid ledger entry"), and
    // reported it as settled to anything filtering on raw `status`.
    // `record_ledger_payment` derives 'paid' from this same comparison, so a
    // genuinely settled row reaches it without help.
    //
    // Only the TRANSITION is blocked, matching the void guard above: rows
    // already carrying a hand-set 'paid' (written before this guard existed)
    // must stay editable, or changing their notes would be impossible.
    if request.status.as_deref() == Some("paid")
        && current_status != "paid"
        && current_paid < current_amount
    {
        let outstanding = current_amount - current_paid;
        return Err(ApiError::BadRequest(format!(
            "Cannot set status to 'paid' while {outstanding} is still outstanding; \
             record a payment for the full balance instead"
        )));
    }

    if let Some(post_type) = request.post_type.as_deref()
        && !VALID_POST_TYPES.contains(&post_type)
    {
        return Err(ApiError::BadRequest(format!(
            "Invalid post_type '{post_type}'"
        )));
    }

    let mut updates = Vec::new();
    let mut param_index = 1;
    // Placeholder numbers for the three inputs of `net_amount`, so the derived
    // clause below can reference the NEW value of any input this request
    // changes without binding that value a second time.
    let mut amount_param: Option<i32> = None;
    let mut tax_amount_param: Option<i32> = None;
    let mut service_charge_param: Option<i32> = None;

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
        amount_param = Some(param_index);
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
    if request.invoice_date.is_some() {
        updates.push(format!("invoice_date = ${}", param_index));
        param_index += 1;
    }
    if request.due_date.is_some() {
        updates.push(format!("due_date = ${}", param_index));
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
    if request.post_type.is_some() {
        updates.push(format!("post_type = ${}", param_index));
        param_index += 1;
    }
    if request.department_code.is_some() {
        updates.push(format!("department_code = ${}", param_index));
        param_index += 1;
    }
    if request.transaction_code.is_some() {
        updates.push(format!("transaction_code = ${}", param_index));
        param_index += 1;
    }
    if request.room_number.is_some() {
        updates.push(format!("room_number = ${}", param_index));
        param_index += 1;
    }
    if request.reference_number.is_some() {
        updates.push(format!("reference_number = ${}", param_index));
        param_index += 1;
    }
    if request.tax_amount.is_some() {
        tax_amount_param = Some(param_index);
        updates.push(format!("tax_amount = ${}", param_index));
        param_index += 1;
    }
    if request.service_charge.is_some() {
        service_charge_param = Some(param_index);
        updates.push(format!("service_charge = ${}", param_index));
        param_index += 1;
    }

    // Checked BEFORE the derived/unconditional pushes below: those always add
    // entries, so any check placed after them can never fire and an all-`None`
    // request would silently no-op instead of erroring. `updates` must still
    // hold only caller-supplied fields at this point.
    if updates.is_empty() {
        return Err(ApiError::BadRequest("No fields to update".to_string()));
    }

    // `net_amount` is populated only by the `generate_folio_number` BEFORE
    // INSERT trigger (and only when it is NULL); nothing recomputes it on
    // UPDATE. Whenever this request changes one of its three inputs, recompute
    // it in the same statement so the stored total cannot drift away from
    // amount/tax_amount/service_charge.
    //
    // SQL evaluates every SET expression against the OLD row, so a bare column
    // name below reads the pre-update value — exactly what is wanted for an
    // input this request is NOT changing. For an input it IS changing, the
    // field's own placeholder is reused, so no extra bind is added and the
    // bind order stays in step with the clause order.
    if amount_param.is_some() || tax_amount_param.is_some() || service_charge_param.is_some() {
        let input_expr = |param: Option<i32>, column: &str| match param {
            Some(index) => format!("${}", index),
            None => column.to_string(),
        };
        updates.push(format!(
            "net_amount = {} - COALESCE({}, 0) - COALESCE({}, 0)",
            input_expr(amount_param, "amount"),
            input_expr(tax_amount_param, "tax_amount"),
            input_expr(service_charge_param, "service_charge"),
        ));
    }

    updates.push(format!("updated_by = ${}", param_index));
    param_index += 1;
    updates.push("updated_at = CURRENT_TIMESTAMP".to_string());

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
    if let Some(ref v) = request.invoice_date {
        let parsed = NaiveDate::parse_from_str(v, "%Y-%m-%d").map_err(|_| {
            ApiError::BadRequest("Invalid invoice date. Use YYYY-MM-DD".to_string())
        })?;
        query_builder = query_builder.bind(parsed);
    }
    if let Some(ref v) = request.due_date {
        let parsed = NaiveDate::parse_from_str(v, "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest("Invalid due date. Use YYYY-MM-DD".to_string()))?;
        query_builder = query_builder.bind(parsed);
    }
    if let Some(ref v) = request.notes {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.internal_notes {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.post_type {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.department_code {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.transaction_code {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.room_number {
        query_builder = query_builder.bind(v);
    }
    if let Some(ref v) = request.reference_number {
        query_builder = query_builder.bind(v);
    }
    if let Some(tax_amount) = request.tax_amount {
        let decimal_tax = Decimal::from_f64_retain(tax_amount)
            .ok_or_else(|| ApiError::BadRequest("Invalid tax amount".to_string()))?;
        query_builder = query_builder.bind(decimal_tax);
    }
    if let Some(service_charge) = request.service_charge {
        let decimal_service_charge = Decimal::from_f64_retain(service_charge)
            .ok_or_else(|| ApiError::BadRequest("Invalid service charge".to_string()))?;
        query_builder = query_builder.bind(decimal_service_charge);
    }

    query_builder = query_builder.bind(user_id);
    query_builder = query_builder.bind(ledger_id);

    let row = query_builder
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    Ok(ledger)
}

/// Delete a customer ledger entry
pub async fn delete_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<serde_json::Value, ApiError> {
    // Fetch ledger status and paid_amount
    let ledger_row = sqlx::query(GET_LEDGER_STATUS_QUERY)
        .bind(ledger_id)
        .fetch_optional(pool)
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
                    "Cannot delete a ledger with partial payments. Mark it as voided instead."
                        .to_string(),
                ));
            }
        }
    }

    sqlx::query(DELETE_LEDGER_PAYMENTS_QUERY)
        .bind(ledger_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let result = sqlx::query(DELETE_LEDGER_QUERY)
        .bind(ledger_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Customer ledger not found".to_string()));
    }

    Ok(serde_json::json!({
        "message": "Customer ledger deleted successfully",
        "ledger_id": ledger_id
    }))
}

#[derive(Debug)]
struct LockedLedger {
    id: i64,
    company_name: String,
    amount: Decimal,
    paid_amount: Decimal,
    status: String,
    is_voided: bool,
}

#[derive(Debug)]
struct LedgerPaymentValues {
    amount: Decimal,
    payment_method: String,
    payment_reference: Option<String>,
    receipt_number: Option<String>,
    receipt_file_url: Option<String>,
    notes: Option<String>,
    payment_date: Option<NaiveDate>,
}

pub(crate) struct LedgerPaymentOutcome {
    pub payment: CustomerLedgerPayment,
    pub was_inserted: bool,
}

pub(crate) struct CompanyLedgerPaymentOutcome {
    pub response: CompanyLedgerPaymentResponse,
    pub was_inserted: bool,
}

fn normalized_option(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalized_payment_date(value: Option<&str>) -> Result<Option<NaiveDate>, ApiError> {
    match normalized_option(value) {
        Some(value) => NaiveDate::parse_from_str(&value, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| ApiError::BadRequest("Payment date must use YYYY-MM-DD".to_string())),
        None => Ok(None),
    }
}

fn payment_values(
    amount: f64,
    payment_method: &str,
    payment_reference: Option<&str>,
    receipt_number: Option<&str>,
    receipt_file_url: Option<&str>,
    notes: Option<&str>,
    payment_date: Option<&str>,
) -> Result<LedgerPaymentValues, ApiError> {
    let amount = Decimal::from_f64_retain(amount)
        .ok_or_else(|| ApiError::BadRequest("Invalid payment amount".to_string()))?
        .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    if amount <= Decimal::ZERO {
        return Err(ApiError::BadRequest(
            "Payment amount must be positive".to_string(),
        ));
    }

    Ok(LedgerPaymentValues {
        amount,
        payment_method: payment_method.trim().to_string(),
        payment_reference: normalized_option(payment_reference),
        receipt_number: normalized_option(receipt_number),
        receipt_file_url: normalized_option(receipt_file_url),
        notes: normalized_option(notes),
        payment_date: normalized_payment_date(payment_date)?,
    })
}

fn append_fingerprint_field(payload: &mut String, name: &str, value: Option<&str>) {
    payload.push_str(name);
    payload.push(':');
    match value {
        Some(value) => {
            payload.push_str("S:");
            payload.push_str(&value.len().to_string());
            payload.push(':');
            payload.push_str(value);
        }
        None => payload.push('N'),
    }
    payload.push('|');
}

fn fingerprint(payload: String) -> String {
    let digest = Sha256::digest(payload.as_bytes());
    let mut result = String::with_capacity(64);
    for byte in digest {
        write!(&mut result, "{byte:02x}").expect("writing to String cannot fail");
    }
    result
}

fn canonical_ledger_payment_fingerprint(ledger_id: i64, values: &LedgerPaymentValues) -> String {
    let amount = values.amount.normalize().to_string();
    let payment_date = values.payment_date.map(|value| value.to_string());
    let mut payload = String::new();
    append_fingerprint_field(&mut payload, "kind", Some("ledger-payment-v1"));
    append_fingerprint_field(&mut payload, "ledger_id", Some(&ledger_id.to_string()));
    append_fingerprint_field(&mut payload, "payment_amount", Some(&amount));
    append_fingerprint_field(&mut payload, "payment_method", Some(&values.payment_method));
    append_fingerprint_field(
        &mut payload,
        "payment_reference",
        values.payment_reference.as_deref(),
    );
    append_fingerprint_field(
        &mut payload,
        "receipt_number",
        values.receipt_number.as_deref(),
    );
    append_fingerprint_field(
        &mut payload,
        "receipt_file_url",
        values.receipt_file_url.as_deref(),
    );
    append_fingerprint_field(&mut payload, "notes", values.notes.as_deref());
    append_fingerprint_field(&mut payload, "payment_date", payment_date.as_deref());
    fingerprint(payload)
}

fn canonical_company_payment_fingerprint(
    request: &CompanyLedgerPaymentRequest,
    values: &LedgerPaymentValues,
) -> String {
    let amount = values.amount.normalize().to_string();
    let payment_date = values.payment_date.map(|value| value.to_string());
    let ledger_ids = request
        .ledger_ids
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let mut payload = String::new();
    append_fingerprint_field(&mut payload, "kind", Some("company-ledger-payment-v1"));
    append_fingerprint_field(&mut payload, "ledger_ids", Some(&ledger_ids));
    append_fingerprint_field(&mut payload, "payment_amount", Some(&amount));
    append_fingerprint_field(&mut payload, "payment_method", Some(&values.payment_method));
    append_fingerprint_field(
        &mut payload,
        "payment_reference",
        values.payment_reference.as_deref(),
    );
    append_fingerprint_field(
        &mut payload,
        "receipt_number",
        values.receipt_number.as_deref(),
    );
    append_fingerprint_field(&mut payload, "notes", values.notes.as_deref());
    append_fingerprint_field(&mut payload, "payment_date", payment_date.as_deref());
    fingerprint(payload)
}

fn canonical_company_allocation_fingerprint(
    batch_fingerprint: &str,
    ordinal: usize,
    payment: &CustomerLedgerPayment,
) -> String {
    let amount = payment.payment_amount.normalize().to_string();
    let payment_date = payment.payment_date.to_rfc3339();
    let processed_by = payment.processed_by.map(|value| value.to_string());
    let created_at = payment.created_at.to_rfc3339();
    let mut payload = String::new();
    append_fingerprint_field(&mut payload, "kind", Some("company-ledger-allocation-v1"));
    append_fingerprint_field(&mut payload, "batch_fingerprint", Some(batch_fingerprint));
    append_fingerprint_field(&mut payload, "payment_id", Some(&payment.id.to_string()));
    append_fingerprint_field(
        &mut payload,
        "ledger_id",
        Some(&payment.ledger_id.to_string()),
    );
    append_fingerprint_field(&mut payload, "ordinal", Some(&ordinal.to_string()));
    append_fingerprint_field(&mut payload, "payment_amount", Some(&amount));
    append_fingerprint_field(
        &mut payload,
        "payment_method",
        Some(&payment.payment_method),
    );
    append_fingerprint_field(
        &mut payload,
        "payment_reference",
        payment.payment_reference.as_deref(),
    );
    append_fingerprint_field(&mut payload, "payment_date", Some(&payment_date));
    append_fingerprint_field(
        &mut payload,
        "receipt_number",
        payment.receipt_number.as_deref(),
    );
    append_fingerprint_field(
        &mut payload,
        "receipt_file_url",
        payment.receipt_file_url.as_deref(),
    );
    append_fingerprint_field(&mut payload, "notes", payment.notes.as_deref());
    append_fingerprint_field(&mut payload, "processed_by", processed_by.as_deref());
    append_fingerprint_field(&mut payload, "created_at", Some(&created_at));
    fingerprint(payload)
}

fn batch_storage_key(raw_key: &str) -> String {
    let digest = Sha256::digest(raw_key.as_bytes());
    let mut key = String::from("batch:v1:");
    for byte in digest {
        write!(&mut key, "{byte:02x}").expect("writing to String cannot fail");
    }
    key
}

async fn lock_ledger_for_payment_tx(
    tx: &mut DbTransaction<'_>,
    ledger_id: i64,
) -> Result<LockedLedger, ApiError> {
    let sql = format!(
        "SELECT id, company_name, amount, paid_amount, status, void_at FROM customer_ledgers WHERE id = {} FOR UPDATE",
        crate::param!(1),
    );
    let row = sqlx::query(&sql)
        .bind(ledger_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::NotFound("Customer ledger not found".to_string()))?;

    Ok(LockedLedger {
        id: row.try_get("id").map_err(ApiError::from)?,
        company_name: row.try_get("company_name").map_err(ApiError::from)?,
        amount: get_decimal(&row, "amount"),
        paid_amount: get_decimal(&row, "paid_amount"),
        status: row.try_get("status").map_err(ApiError::from)?,
        is_voided: row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("void_at")
            .map_err(ApiError::from)?
            .is_some(),
    })
}

fn ensure_payable(ledger: &LockedLedger) -> Result<(), ApiError> {
    if ledger.status == "void" || ledger.is_voided {
        return Err(ApiError::BadRequest(
            "Cannot record payment for a voided ledger".to_string(),
        ));
    }
    if !matches!(ledger.status.as_str(), "pending" | "partial" | "overdue")
        || ledger.amount - ledger.paid_amount <= Decimal::ZERO
    {
        return Err(ApiError::BadRequest(
            "All selected ledgers must have an outstanding payable balance".to_string(),
        ));
    }
    Ok(())
}

async fn find_ledger_payment_by_key_tx(
    tx: &mut DbTransaction<'_>,
    ledger_id: i64,
    idempotency_key: &str,
) -> Result<Option<CustomerLedgerPayment>, ApiError> {
    let sql = format!(
        r#"
        SELECT id, ledger_id, payment_amount, payment_method, payment_reference,
               payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at,
               idempotency_key, idempotency_fingerprint
        FROM customer_ledger_payments
        WHERE ledger_id = {} AND idempotency_key = {}
        LIMIT 1
        "#,
        crate::param!(1),
        crate::param!(2),
    );
    sqlx::query(&sql)
        .bind(ledger_id)
        .bind(idempotency_key)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)
        .map(|row| row.as_ref().map(row_to_customer_ledger_payment))
}

async fn insert_locked_ledger_payment_tx(
    tx: &mut DbTransaction<'_>,
    ledger: &LockedLedger,
    user_id: i64,
    values: &LedgerPaymentValues,
    idempotency_key: &str,
    idempotency_fingerprint: &str,
) -> Result<LedgerPaymentOutcome, ApiError> {
    if let Some(existing) = find_ledger_payment_by_key_tx(tx, ledger.id, idempotency_key).await? {
        if existing.idempotency_fingerprint.as_deref() == Some(idempotency_fingerprint) {
            return Ok(LedgerPaymentOutcome {
                payment: existing,
                was_inserted: false,
            });
        }
        return Err(ApiError::Conflict(
            "Idempotency key was already used with different payment data".to_string(),
        ));
    }

    ensure_payable(ledger)?;
    let outstanding = ledger.amount - ledger.paid_amount;
    if values.amount > outstanding {
        return Err(ApiError::BadRequest(
            "Payment amount cannot exceed outstanding balance".to_string(),
        ));
    }

    if let Some(receipt_number) = values.receipt_number.as_deref() {
        let receipt_sql = format!(
            "SELECT EXISTS(SELECT 1 FROM customer_ledger_payments WHERE ledger_id = {} AND LOWER(TRIM(receipt_number)) = LOWER({}))",
            crate::param!(1),
            crate::param!(2),
        );
        let receipt_exists: bool = sqlx::query_scalar(&receipt_sql)
            .bind(ledger.id)
            .bind(receipt_number)
            .fetch_one(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        if receipt_exists {
            return Err(ApiError::BadRequest(
                "Receipt number already exists for this ledger".to_string(),
            ));
        }
    }

    let payment_sql = format!(
        r#"
        INSERT INTO customer_ledger_payments (
            ledger_id, payment_amount, payment_method, payment_reference, payment_date,
            receipt_number, receipt_file_url, notes, processed_by, idempotency_key,
            idempotency_fingerprint
        )
        VALUES ({}, {}, {}, {}, COALESCE({} + INTERVAL '12 hours', {}), {}, {}, {}, {}, {}, {})
        RETURNING id, ledger_id, payment_amount, payment_method, payment_reference,
                  payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at,
                  idempotency_key, idempotency_fingerprint
        "#,
        crate::param!(1),
        crate::param!(2),
        crate::param!(3),
        crate::param!(4),
        crate::param!(5),
        crate::core::sql_compat::current_timestamp(),
        crate::param!(6),
        crate::param!(7),
        crate::param!(8),
        crate::param!(9),
        crate::param!(10),
        crate::param!(11),
    );
    let payment_row = sqlx::query(&payment_sql)
        .bind(ledger.id)
        .bind(values.amount)
        .bind(&values.payment_method)
        .bind(&values.payment_reference)
        .bind(values.payment_date)
        .bind(&values.receipt_number)
        .bind(&values.receipt_file_url)
        .bind(&values.notes)
        .bind(user_id)
        .bind(idempotency_key)
        .bind(idempotency_fingerprint)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)?;

    let new_total_paid = ledger.paid_amount + values.amount;
    let new_status = if new_total_paid >= ledger.amount {
        "paid"
    } else {
        "partial"
    };
    let update_sql = format!(
        r#"
        UPDATE customer_ledgers
        SET paid_amount = {}, status = {}, payment_method = {}, payment_reference = {},
            payment_date = COALESCE({} + INTERVAL '12 hours', {}),
            updated_at = {}, updated_by = {}
        WHERE id = {}
        "#,
        crate::param!(1),
        crate::param!(2),
        crate::param!(3),
        crate::param!(4),
        crate::param!(5),
        crate::core::sql_compat::current_timestamp(),
        crate::core::sql_compat::current_timestamp(),
        crate::param!(6),
        crate::param!(7),
    );
    sqlx::query(&update_sql)
        .bind(new_total_paid)
        .bind(new_status)
        .bind(&values.payment_method)
        .bind(&values.payment_reference)
        .bind(values.payment_date)
        .bind(user_id)
        .bind(ledger.id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;

    Ok(LedgerPaymentOutcome {
        payment: row_to_customer_ledger_payment(&payment_row),
        was_inserted: true,
    })
}

/// The service needs the replay flag to suppress duplicate audits; the public
/// wrapper below preserves the original repository return type for callers.
pub(crate) async fn create_ledger_payment_with_outcome(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: CustomerLedgerPaymentRequest,
) -> Result<LedgerPaymentOutcome, ApiError> {
    let key = crate::services::payments::normalized_idempotency_key(&request.idempotency_key)?;
    let values = payment_values(
        request.payment_amount,
        &request.payment_method,
        request.payment_reference.as_deref(),
        request.receipt_number.as_deref(),
        request.receipt_file_url.as_deref(),
        request.notes.as_deref(),
        request.payment_date.as_deref(),
    )?;
    let fingerprint = canonical_ledger_payment_fingerprint(ledger_id, &values);
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let ledger = lock_ledger_for_payment_tx(&mut tx, ledger_id).await?;
    let outcome =
        insert_locked_ledger_payment_tx(&mut tx, &ledger, user_id, &values, key, &fingerprint)
            .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(outcome)
}

/// Record a payment against a customer ledger (PostgreSQL version).
#[allow(dead_code)] // Public compatibility wrapper; services require the replay flag below.
pub async fn create_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: CustomerLedgerPaymentRequest,
) -> Result<CustomerLedgerPayment, ApiError> {
    Ok(
        create_ledger_payment_with_outcome(pool, ledger_id, user_id, request)
            .await?
            .payment,
    )
}

async fn find_company_batch_replay_tx(
    tx: &mut DbTransaction<'_>,
    batch_key: &str,
    request: &CompanyLedgerPaymentRequest,
    fingerprint: &str,
    expected_amount: Decimal,
) -> Result<Option<Vec<CustomerLedgerPayment>>, ApiError> {
    let sql = format!(
        r#"
        SELECT id, ledger_id, payment_amount, payment_method, payment_reference,
               payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at,
               idempotency_key, idempotency_fingerprint
        FROM customer_ledger_payments
        WHERE idempotency_key = {}
        "#,
        crate::param!(1),
    );
    let rows = sqlx::query(&sql)
        .bind(batch_key)
        .fetch_all(&mut **tx)
        .await
        .map_err(ApiError::from)?;
    if rows.is_empty() {
        return Ok(None);
    }

    let payments: Vec<_> = rows.iter().map(row_to_customer_ledger_payment).collect();
    let allocated_amount = payments
        .iter()
        .map(|payment| payment.payment_amount)
        .sum::<Decimal>();
    if payments.len() > request.ledger_ids.len()
        || allocated_amount != expected_amount
        || payments.iter().any(|payment| {
            let expected_fingerprint = request
                .ledger_ids
                .iter()
                .position(|ledger_id| *ledger_id == payment.ledger_id)
                .map(|ordinal| {
                    canonical_company_allocation_fingerprint(fingerprint, ordinal, payment)
                });
            payment.payment_amount <= Decimal::ZERO
                || payment.idempotency_fingerprint.as_deref() != expected_fingerprint.as_deref()
        })
    {
        return Err(ApiError::Conflict(
            "Idempotency key was already used with different company payment data".to_string(),
        ));
    }

    let payment_count = payments.len();
    let by_ledger: BTreeMap<_, _> = payments
        .into_iter()
        .map(|payment| (payment.ledger_id, payment))
        .collect();
    if by_ledger.len() != payment_count
        || by_ledger
            .keys()
            .any(|ledger_id| !request.ledger_ids.contains(ledger_id))
    {
        return Err(ApiError::Conflict(
            "Idempotency key was already used with different company payment data".to_string(),
        ));
    }
    let mut ordered = Vec::with_capacity(request.ledger_ids.len());
    for ledger_id in &request.ledger_ids {
        if let Some(payment) = by_ledger.get(ledger_id) {
            ordered.push(payment.clone());
        }
    }
    Ok(Some(ordered))
}

async fn lock_company_batch_key_tx(
    tx: &mut DbTransaction<'_>,
    batch_key: &str,
) -> Result<(), ApiError> {
    let sql = format!(
        "SELECT pg_advisory_xact_lock(hashtextextended({}, 0))",
        crate::param!(1),
    );
    sqlx::query(&sql)
        .bind(batch_key)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

pub(crate) async fn create_company_ledger_payment_with_outcome(
    pool: &DbPool,
    user_id: i64,
    request: CompanyLedgerPaymentRequest,
) -> Result<CompanyLedgerPaymentOutcome, ApiError> {
    if request.ledger_ids.is_empty() {
        return Err(ApiError::BadRequest(
            "At least one ledger is required for a company payment".to_string(),
        ));
    }
    let unique_ids: BTreeSet<_> = request.ledger_ids.iter().copied().collect();
    if unique_ids.len() != request.ledger_ids.len() {
        return Err(ApiError::BadRequest(
            "A company payment cannot include the same ledger twice".to_string(),
        ));
    }

    let key = crate::services::payments::normalized_idempotency_key(&request.idempotency_key)?;
    let values = payment_values(
        request.payment_amount,
        &request.payment_method,
        request.payment_reference.as_deref(),
        request.receipt_number.as_deref(),
        None,
        request.notes.as_deref(),
        request.payment_date.as_deref(),
    )?;
    let fingerprint = canonical_company_payment_fingerprint(&request, &values);
    let batch_key = batch_storage_key(key);
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    lock_company_batch_key_tx(&mut tx, &batch_key).await?;

    if let Some(payments) =
        find_company_batch_replay_tx(&mut tx, &batch_key, &request, &fingerprint, values.amount)
            .await?
    {
        tx.commit().await.map_err(ApiError::from)?;
        return Ok(CompanyLedgerPaymentOutcome {
            response: CompanyLedgerPaymentResponse {
                payments,
                payment_amount: values.amount,
            },
            was_inserted: false,
        });
    }

    let mut locked_ledgers = BTreeMap::new();
    for ledger_id in unique_ids {
        let ledger = lock_ledger_for_payment_tx(&mut tx, ledger_id).await?;
        locked_ledgers.insert(ledger_id, ledger);
    }

    // A same-key request that began before another transaction committed must
    // check again after acquiring the shared ledger locks, before allocation.
    if let Some(payments) =
        find_company_batch_replay_tx(&mut tx, &batch_key, &request, &fingerprint, values.amount)
            .await?
    {
        tx.commit().await.map_err(ApiError::from)?;
        return Ok(CompanyLedgerPaymentOutcome {
            response: CompanyLedgerPaymentResponse {
                payments,
                payment_amount: values.amount,
            },
            was_inserted: false,
        });
    }

    let company_name = locked_ledgers
        .values()
        .next()
        .expect("non-empty validated ledger ids")
        .company_name
        .clone();
    if locked_ledgers
        .values()
        .any(|ledger| ledger.company_name != company_name)
    {
        return Err(ApiError::BadRequest(
            "All selected ledgers must belong to the same company".to_string(),
        ));
    }
    for ledger in locked_ledgers.values() {
        ensure_payable(ledger)?;
    }
    let mut remaining = values.amount;
    let mut payments = Vec::with_capacity(request.ledger_ids.len());
    for (ordinal, ledger_id) in request.ledger_ids.iter().enumerate() {
        if remaining <= Decimal::ZERO {
            break;
        }
        let ledger = locked_ledgers
            .get(ledger_id)
            .expect("every caller id was locked");
        let outstanding = ledger.amount - ledger.paid_amount;
        let allocation = remaining.min(outstanding);
        let allocation_values = LedgerPaymentValues {
            amount: allocation,
            payment_method: values.payment_method.clone(),
            payment_reference: values.payment_reference.clone(),
            receipt_number: values.receipt_number.clone(),
            receipt_file_url: None,
            notes: values.notes.clone(),
            payment_date: values.payment_date,
        };
        let mut outcome = insert_locked_ledger_payment_tx(
            &mut tx,
            ledger,
            user_id,
            &allocation_values,
            &batch_key,
            &fingerprint,
        )
        .await?;
        if !outcome.was_inserted {
            return Err(ApiError::Conflict(
                "Idempotency key was already used with different company payment data".to_string(),
            ));
        }
        let allocation_fingerprint =
            canonical_company_allocation_fingerprint(&fingerprint, ordinal, &outcome.payment);
        let fingerprint_sql = format!(
            "UPDATE customer_ledger_payments SET idempotency_fingerprint = {} WHERE id = {}",
            crate::param!(1),
            crate::param!(2),
        );
        sqlx::query(&fingerprint_sql)
            .bind(&allocation_fingerprint)
            .bind(outcome.payment.id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;
        outcome.payment.idempotency_fingerprint = Some(allocation_fingerprint);
        remaining -= allocation;
        payments.push(outcome.payment);
    }
    if remaining > Decimal::ZERO {
        return Err(ApiError::BadRequest(
            "Payment amount cannot exceed the selected ledgers' outstanding balance".to_string(),
        ));
    }

    tx.commit().await.map_err(ApiError::from)?;
    Ok(CompanyLedgerPaymentOutcome {
        response: CompanyLedgerPaymentResponse {
            payments,
            payment_amount: values.amount,
        },
        was_inserted: true,
    })
}

#[allow(dead_code)] // Public compatibility wrapper; services require the replay flag below.
pub async fn create_company_ledger_payment(
    pool: &DbPool,
    user_id: i64,
    request: CompanyLedgerPaymentRequest,
) -> Result<CompanyLedgerPaymentResponse, ApiError> {
    Ok(
        create_company_ledger_payment_with_outcome(pool, user_id, request)
            .await?
            .response,
    )
}

/// Get payment history for a ledger
pub async fn get_ledger_payments(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<Vec<CustomerLedgerPayment>, ApiError> {
    // Check if ledger exists
    let exists = sqlx::query(CHECK_LEDGER_EXISTS_QUERY)
        .bind(ledger_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if exists.is_none() {
        return Err(ApiError::NotFound("Customer ledger not found".to_string()));
    }

    let rows = sqlx::query(GET_LEDGER_PAYMENTS_QUERY)
        .bind(ledger_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let payments: Vec<CustomerLedgerPayment> =
        rows.iter().map(row_to_customer_ledger_payment).collect();

    Ok(payments)
}

/// Get summary statistics for ledgers (PostgreSQL version)
pub async fn get_ledger_summary(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
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
        WHERE status NOT IN ('void')
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total_entries: i64 = row.try_get("total_entries").unwrap_or(0);
    let total_amount = get_decimal(&row, "total_amount");
    let total_paid = get_decimal(&row, "total_paid");
    let total_outstanding = get_decimal(&row, "total_outstanding");
    let pending_count: i64 = row.try_get("pending_count").unwrap_or(0);
    let partial_count: i64 = row.try_get("partial_count").unwrap_or(0);
    let overdue_count: i64 = row.try_get("overdue_count").unwrap_or(0);

    Ok(serde_json::json!({
        "total_entries": total_entries,
        "total_amount": total_amount,
        "total_paid": total_paid,
        "total_outstanding": total_outstanding,
        "pending_count": pending_count,
        "partial_count": partial_count,
        "overdue_count": overdue_count
    }))
}

/// Void a ledger entry (PostgreSQL version)
pub async fn void_ledger(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: LedgerVoidRequest,
) -> Result<CustomerLedger, ApiError> {
    // Check if ledger exists, is not already voided, and has not already
    // collected any payments - get_ledger_summary excludes status = 'void'
    // rows entirely, so voiding a ledger with paid_amount > 0 would make
    // collected money vanish from every outstanding/collected total.
    //
    // The probe and the UPDATE must run in one transaction against a row
    // locked FOR UPDATE - otherwise a concurrent create_ledger_payment can
    // insert a payment (taking the row lock first) while this probe reads
    // the pre-payment paid_amount = 0 under MVCC and passes the guard; the
    // UPDATE would then block on the payment's lock and, once released,
    // apply against the new row version - voiding a ledger that now has
    // paid_amount > 0, exactly the state this guard exists to forbid.
    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    let existing_row = sqlx::query(
        "SELECT void_at IS NOT NULL AS is_voided, paid_amount FROM customer_ledgers WHERE id = $1 FOR UPDATE",
    )
    .bind(ledger_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let row = match existing_row {
        None => return Err(ApiError::NotFound("Customer ledger not found".to_string())),
        Some(row) => row,
    };

    let is_voided: bool = row.try_get("is_voided").unwrap_or(false);
    if is_voided {
        return Err(ApiError::BadRequest("Ledger is already voided".to_string()));
    }

    let paid_amount = get_decimal(&row, "paid_amount");
    if paid_amount > Decimal::ZERO {
        return Err(ApiError::BadRequest(
            "Cannot void a ledger with a paid_amount greater than zero; collected payments cannot be voided away".to_string(),
        ));
    }

    let query_str = format!(
        r#"
        UPDATE customer_ledgers
        SET void_at = CURRENT_TIMESTAMP,
            void_by = $1,
            void_reason = $2,
            status = 'void',
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
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let ledger = row_to_customer_ledger(&row);

    tx.commit().await.map_err(ApiError::from)?;

    Ok(ledger)
}

/// Create a reversal for a ledger entry (PostgreSQL version)
pub async fn create_ledger_reversal(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: LedgerReversalRequest,
) -> Result<CustomerLedger, ApiError> {
    // Get the original ledger
    let original_row = sqlx::query(GET_LEDGER_BY_ID_QUERY)
        .bind(ledger_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Customer ledger not found".to_string()))?;

    let original = row_to_customer_ledger(&original_row);

    if original.is_reversal.unwrap_or(false) {
        return Err(ApiError::BadRequest(
            "Cannot reverse a reversal entry".to_string(),
        ));
    }

    // Create the reversal entry with opposite transaction type
    let reversal_type = if original.transaction_type.as_deref() == Some("debit") {
        "credit"
    } else {
        "debit"
    };

    let invoice_number = crate::services::invoice_numbers::next_invoice_number(pool).await?;

    let reversal_query = format!(
        r#"
        INSERT INTO customer_ledgers (
            company_name, company_registration_number, contact_person,
            contact_email, contact_phone, billing_address_line1, billing_city,
            billing_state, billing_postal_code, billing_country, description,
            expense_type, amount, currency, status, paid_amount,
            booking_id, guest_id, invoice_number, notes, internal_notes,
            created_by, updated_by, cashier_id,
            folio_type, transaction_type, post_type, department_code,
            transaction_code, room_number, posting_date, transaction_date,
            reference_number, tax_amount, service_charge,
            is_reversal, original_transaction_id, reversal_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'paid', $13,
                $15, $16, $31, $17, $18, $19, $19, $19,
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
        .bind(&invoice_number)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let reversal = row_to_customer_ledger(&row);

    Ok(reversal)
}

/// Update an existing ledger payment (PostgreSQL version). `payment_date` is
/// always applied; `payment_amount`/`payment_method`/`payment_reference`/`notes`
/// are applied only when provided. The ledger's `paid_amount`, `status` and
/// `payment_date` are recomputed from the resulting set of payments.
async fn ensure_ledger_payment_is_mutable_tx(
    tx: &mut DbTransaction<'_>,
    ledger_id: i64,
    payment_id: i64,
) -> Result<(), ApiError> {
    let sql = format!(
        "SELECT idempotency_key FROM customer_ledger_payments WHERE id = {} AND ledger_id = {}",
        crate::param!(1),
        crate::param!(2),
    );
    let row = sqlx::query(&sql)
        .bind(payment_id)
        .bind(ledger_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::NotFound("Payment not found".to_string()))?;
    let idempotency_key: Option<String> = row.try_get("idempotency_key")?;
    if idempotency_key.is_some_and(|key| !key.trim().is_empty()) {
        return Err(ApiError::Conflict(
            "Idempotent ledger payments cannot be updated or deleted".to_string(),
        ));
    }
    Ok(())
}

pub async fn update_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    payment_id: i64,
    request: UpdateLedgerPaymentRequest,
) -> Result<CustomerLedgerPayment, ApiError> {
    // One transaction for the whole read-modify-write, with the ledger row
    // locked FOR UPDATE up front, so a concurrent payment write on the same
    // ledger cannot read a stale total/paid_amount and lose a contribution.
    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    ensure_ledger_payment_is_mutable_tx(&mut tx, ledger_id, payment_id).await?;

    let payment_date_ts = chrono::NaiveDate::parse_from_str(&request.payment_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date. Use YYYY-MM-DD".to_string()))?;

    // Lock the ledger row now; its amount is used both for the over-payment
    // guard below and for the final status recompute.
    let total_amount: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(amount, 0) FROM customer_ledgers WHERE id = $1 FOR UPDATE",
    )
    .bind(ledger_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Validate the optional new amount and guard against over-payment (the sum
    // of the other payments plus this one must not exceed the ledger total).
    let new_amount = match request.payment_amount {
        Some(a) => {
            let dec = Decimal::from_f64_retain(a)
                .ok_or_else(|| ApiError::BadRequest("Invalid payment amount".to_string()))?;
            if dec <= Decimal::ZERO {
                return Err(ApiError::BadRequest(
                    "Payment amount must be positive".to_string(),
                ));
            }
            let others_paid: Decimal = sqlx::query_scalar(
                "SELECT COALESCE(SUM(payment_amount), 0) FROM customer_ledger_payments WHERE ledger_id = $1 AND id <> $2",
            )
            .bind(ledger_id)
            .bind(payment_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
            if others_paid + dec > total_amount {
                return Err(ApiError::BadRequest(
                    "Payment amount cannot exceed outstanding balance".to_string(),
                ));
            }
            Some(dec)
        }
        None => None,
    };

    // Update the payment row. COALESCE keeps the existing value when a field is
    // omitted from the request (NULL parameters are cast so Postgres can infer
    // the column type).
    let payment_row = sqlx::query(
        r#"
        UPDATE customer_ledger_payments
        SET payment_date = $1 + INTERVAL '12 hours',
            payment_amount = COALESCE($2::numeric, payment_amount),
            payment_method = COALESCE($3::text, payment_method),
            payment_reference = COALESCE($4::text, payment_reference),
            notes = COALESCE($5::text, notes)
        WHERE id = $6
        RETURNING id, ledger_id, payment_amount, payment_method, payment_reference,
                  payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at
        "#,
    )
    .bind(payment_date_ts)
    .bind(new_amount)
    .bind(request.payment_method.as_deref())
    .bind(request.payment_reference.as_deref())
    .bind(request.notes.as_deref())
    .bind(payment_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Recalculate paid_amount + status from all remaining payments.
    let new_paid: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(payment_amount), 0) FROM customer_ledger_payments WHERE ledger_id = $1",
    )
    .bind(ledger_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let new_status = if new_paid >= total_amount {
        "paid"
    } else if new_paid > Decimal::ZERO {
        "partial"
    } else {
        "pending"
    };

    sqlx::query(
        r#"
        UPDATE customer_ledgers
        SET paid_amount = $1,
            status = $2,
            payment_date = (SELECT MAX(payment_date) FROM customer_ledger_payments WHERE ledger_id = $3),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        "#,
    )
    .bind(new_paid)
    .bind(new_status)
    .bind(ledger_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await.map_err(ApiError::from)?;

    Ok(row_to_customer_ledger_payment(&payment_row))
}

/// Delete a payment from a customer ledger (PostgreSQL version)
pub async fn delete_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    payment_id: i64,
) -> Result<serde_json::Value, ApiError> {
    // One transaction for the whole read-modify-write, with the ledger row
    // locked FOR UPDATE before the delete, so a concurrent payment write on
    // the same ledger cannot read a stale paid_amount.
    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    ensure_ledger_payment_is_mutable_tx(&mut tx, ledger_id, payment_id).await?;

    let total_amount: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(amount, 0) FROM customer_ledgers WHERE id = $1 FOR UPDATE",
    )
    .bind(ledger_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Delete the payment
    sqlx::query("DELETE FROM customer_ledger_payments WHERE id = $1")
        .bind(payment_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Recalculate paid_amount and status from remaining payments
    let new_paid: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(payment_amount), 0) FROM customer_ledger_payments WHERE ledger_id = $1"
    )
    .bind(ledger_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let new_status = if new_paid >= total_amount {
        "paid"
    } else if new_paid > Decimal::ZERO {
        "partial"
    } else {
        "pending"
    };

    sqlx::query(
        r#"
        UPDATE customer_ledgers
        SET paid_amount = $1,
            status = $2,
            payment_date = (SELECT MAX(payment_date) FROM customer_ledger_payments WHERE ledger_id = $3),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        "#,
    )
    .bind(new_paid)
    .bind(new_status)
    .bind(ledger_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await.map_err(ApiError::from)?;

    Ok(serde_json::json!({
        "message": "Payment deleted successfully",
        "payment_id": payment_id
    }))
}
