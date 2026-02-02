//! SQLite-specific row mapping helpers
//!
//! SQLite doesn't natively support Decimal types, so we need manual row mapping
//! for models that contain Decimal fields when using `sqlx::query()` instead of `query_as`.

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use rust_decimal::Decimal;
use sqlx::Row;

use crate::core::db::DbRow;

// =============================================================================
// Helper functions for reading Decimal values from SQLite rows
// =============================================================================

/// Read a required Decimal field from a row (tries Decimal first for PostgreSQL, then String, then f64)
pub fn get_decimal(row: &DbRow, col: &str) -> Decimal {
    // For PostgreSQL: try reading as Decimal directly (works with numeric columns)
    row.try_get::<Decimal, _>(col)
        .ok()
        .or_else(|| {
            // For SQLite or text columns: try reading as String and parse
            row.try_get::<String, _>(col)
                .ok()
                .and_then(|s| s.parse().ok())
        })
        .or_else(|| {
            // Fallback: try reading as f64 and convert
            row.try_get::<f64, _>(col)
                .ok()
                .and_then(Decimal::from_f64_retain)
        })
        .unwrap_or_default()
}

/// Read an optional Decimal field from a row
pub fn get_opt_decimal(row: &DbRow, col: &str) -> Option<Decimal> {
    // For PostgreSQL: try reading as Decimal directly (works with numeric columns)
    row.try_get::<Option<Decimal>, _>(col)
        .ok()
        .flatten()
        .or_else(|| {
            // For SQLite or text columns: try reading as String and parse
            row.try_get::<Option<String>, _>(col)
                .ok()
                .flatten()
                .and_then(|s| s.parse().ok())
        })
        .or_else(|| {
            // Fallback: try reading as f64 and convert
            row.try_get::<Option<f64>, _>(col)
                .ok()
                .flatten()
                .and_then(Decimal::from_f64_retain)
        })
}

/// Read a required bool field (SQLite stores as INTEGER 0/1)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub fn get_bool(row: &DbRow, col: &str) -> bool {
    row.try_get::<i32, _>(col)
        .map(|v| v != 0)
        .or_else(|_| row.try_get::<bool, _>(col))
        .unwrap_or(false)
}

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub fn get_bool(row: &DbRow, col: &str) -> bool {
    row.try_get::<bool, _>(col).unwrap_or(false)
}

/// Read an optional bool field
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub fn get_opt_bool(row: &DbRow, col: &str) -> Option<bool> {
    row.try_get::<Option<i32>, _>(col)
        .ok()
        .flatten()
        .map(|v| v != 0)
        .or_else(|| row.try_get::<Option<bool>, _>(col).ok().flatten())
}

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub fn get_opt_bool(row: &DbRow, col: &str) -> Option<bool> {
    row.try_get::<Option<bool>, _>(col).ok().flatten()
}

// =============================================================================
// BookingWithDetails mapper
// =============================================================================

use super::booking::BookingWithDetails;

pub fn row_to_booking_with_details(row: &DbRow) -> BookingWithDetails {
    BookingWithDetails {
        id: row.try_get("id").unwrap_or_default(),
        booking_number: row.try_get("booking_number").unwrap_or_default(),
        folio_number: row.try_get("folio_number").ok(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        guest_name: row.try_get("guest_name").unwrap_or_default(),
        guest_email: row.try_get("guest_email").ok(),
        guest_type: row.try_get("guest_type").ok(),
        room_id: row.try_get("room_id").unwrap_or_default(),
        room_number: row.try_get("room_number").unwrap_or_default(),
        room_type: row.try_get("room_type").unwrap_or_default(),
        room_type_code: row.try_get("room_type_code").ok(),
        check_in_date: row.try_get("check_in_date").unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        check_out_date: row.try_get("check_out_date").unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        room_rate: get_decimal(row, "room_rate"),
        total_amount: get_decimal(row, "total_amount"),
        status: row.try_get("status").unwrap_or_default(),
        payment_status: row.try_get("payment_status").ok(),
        payment_method: row.try_get("payment_method").ok(),
        source: row.try_get("source").ok(),
        remarks: row.try_get("remarks").ok(),
        is_complimentary: get_opt_bool(row, "is_complimentary"),
        complimentary_reason: row.try_get("complimentary_reason").ok(),
        complimentary_start_date: row.try_get("complimentary_start_date").ok(),
        complimentary_end_date: row.try_get("complimentary_end_date").ok(),
        original_total_amount: get_opt_decimal(row, "original_total_amount"),
        complimentary_nights: row.try_get("complimentary_nights").ok(),
        deposit_paid: get_opt_bool(row, "deposit_paid"),
        deposit_amount: get_opt_decimal(row, "deposit_amount"),
        room_card_deposit: get_opt_decimal(row, "room_card_deposit"),
        company_id: row.try_get("company_id").ok(),
        company_name: row.try_get("company_name").ok(),
        payment_note: row.try_get("payment_note").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        is_posted: get_opt_bool(row, "is_posted"),
        posted_date: row.try_get("posted_date").ok(),
        rate_override_weekday: get_opt_decimal(row, "rate_override_weekday"),
        rate_override_weekend: get_opt_decimal(row, "rate_override_weekend"),
    }
}

// =============================================================================
// Booking mapper
// =============================================================================

use super::booking::Booking;

pub fn row_to_booking(row: &DbRow) -> Booking {
    Booking {
        id: row.try_get("id").unwrap_or_default(),
        booking_number: row.try_get("booking_number").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        room_id: row.try_get("room_id").unwrap_or_default(),
        check_in_date: row.try_get("check_in_date").unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        check_out_date: row.try_get("check_out_date").unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        room_rate: get_decimal(row, "room_rate"),
        subtotal: get_decimal(row, "subtotal"),
        tax_amount: get_opt_decimal(row, "tax_amount"),
        discount_amount: get_opt_decimal(row, "discount_amount"),
        total_amount: get_decimal(row, "total_amount"),
        status: row.try_get("status").unwrap_or_default(),
        payment_status: row.try_get("payment_status").ok(),
        payment_method: row.try_get("payment_method").ok(),
        adults: row.try_get("adults").ok(),
        children: row.try_get("children").ok(),
        special_requests: row.try_get("special_requests").ok(),
        remarks: row.try_get("remarks").ok(),
        source: row.try_get("source").ok(),
        market_code: row.try_get("market_code").ok(),
        discount_percentage: get_opt_decimal(row, "discount_percentage"),
        rate_override_weekday: get_opt_decimal(row, "rate_override_weekday"),
        rate_override_weekend: get_opt_decimal(row, "rate_override_weekend"),
        pre_checkin_completed: get_opt_bool(row, "pre_checkin_completed"),
        pre_checkin_completed_at: row.try_get("pre_checkin_completed_at").ok(),
        pre_checkin_token: row.try_get("pre_checkin_token").ok(),
        pre_checkin_token_expires_at: row.try_get("pre_checkin_token_expires_at").ok(),
        created_by: row.try_get("created_by").ok(),
        is_complimentary: get_opt_bool(row, "is_complimentary"),
        complimentary_reason: row.try_get("complimentary_reason").ok(),
        complimentary_start_date: row.try_get("complimentary_start_date").ok(),
        complimentary_end_date: row.try_get("complimentary_end_date").ok(),
        original_total_amount: get_opt_decimal(row, "original_total_amount"),
        complimentary_nights: row.try_get("complimentary_nights").ok(),
        deposit_paid: get_opt_bool(row, "deposit_paid"),
        deposit_amount: get_opt_decimal(row, "deposit_amount"),
        deposit_paid_at: row.try_get("deposit_paid_at").ok(),
        company_id: row.try_get("company_id").ok(),
        company_name: row.try_get("company_name").ok(),
        payment_note: row.try_get("payment_note").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

// =============================================================================
// Payment mapper
// =============================================================================

use super::payment::{Payment, Invoice, KeycardDeposit};

pub fn row_to_payment(row: &DbRow) -> Payment {
    Payment {
        id: row.try_get("id").unwrap_or_default(),
        booking_id: row.try_get("booking_id").unwrap_or_default(),
        user_id: row.try_get("user_id").ok(),
        payment_method: row.try_get("payment_method").unwrap_or_default(),
        payment_status: row.try_get("payment_status").unwrap_or_default(),
        subtotal: get_decimal(row, "subtotal"),
        service_charge: get_decimal(row, "service_charge"),
        tax_amount: get_decimal(row, "tax_amount"),
        keycard_deposit: get_decimal(row, "keycard_deposit"),
        total_amount: get_decimal(row, "total_amount"),
        transaction_reference: row.try_get("transaction_reference").ok(),
        payment_gateway: row.try_get("payment_gateway").ok(),
        card_last_four: row.try_get("card_last_four").ok(),
        card_brand: row.try_get("card_brand").ok(),
        bank_name: row.try_get("bank_name").ok(),
        account_reference: row.try_get("account_reference").ok(),
        notes: row.try_get("notes").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub fn row_to_invoice(row: &DbRow) -> Invoice {
    Invoice {
        id: row.try_get("id").unwrap_or_default(),
        uuid: row.try_get("uuid").unwrap_or_default(),
        invoice_number: row.try_get("invoice_number").unwrap_or_default(),
        booking_id: row.try_get("booking_id").unwrap_or_default(),
        user_id: row.try_get("user_id").ok(),
        billing_name: row.try_get("billing_name").unwrap_or_default(),
        billing_address: row.try_get("billing_address").ok(),
        billing_email: row.try_get("billing_email").ok(),
        invoice_date: row.try_get("invoice_date").ok(),
        issue_date: row.try_get("issue_date").unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        due_date: row.try_get("due_date").ok(),
        check_in_date: row.try_get("check_in_date").ok(),
        check_out_date: row.try_get("check_out_date").ok(),
        number_of_nights: row.try_get("number_of_nights").ok(),
        room_number: row.try_get("room_number").ok(),
        room_type: row.try_get("room_type").ok(),
        subtotal: get_decimal(row, "subtotal"),
        tax_amount: get_decimal(row, "tax_amount"),
        discount_amount: get_decimal(row, "discount_amount"),
        total_amount: get_decimal(row, "total_amount"),
        paid_amount: get_decimal(row, "paid_amount"),
        balance_due: get_decimal(row, "balance_due"),
        currency: row.try_get("currency").unwrap_or_else(|_| "MYR".to_string()),
        status: row.try_get("status").unwrap_or_default(),
        notes: row.try_get("notes").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub fn row_to_keycard_deposit(row: &DbRow) -> KeycardDeposit {
    KeycardDeposit {
        id: row.try_get("id").unwrap_or_default(),
        booking_id: row.try_get("booking_id").unwrap_or_default(),
        payment_id: row.try_get("payment_id").unwrap_or_default(),
        deposit_amount: get_decimal(row, "deposit_amount"),
        deposit_status: row.try_get("deposit_status").unwrap_or_default(),
        returned_at: row.try_get("returned_at").ok(),
        returned_by: row.try_get("returned_by").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
    }
}

// =============================================================================
// Rate mappers
// =============================================================================

use super::rate::{RatePlan, RoomRate, RoomRateWithDetails};

pub fn row_to_rate_plan(row: &DbRow) -> RatePlan {
    RatePlan {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        code: row.try_get("code").unwrap_or_default(),
        description: row.try_get("description").ok(),
        plan_type: row.try_get("plan_type").unwrap_or_default(),
        adjustment_type: row.try_get("adjustment_type").unwrap_or_default(),
        adjustment_value: get_opt_decimal(row, "adjustment_value"),
        valid_from: row.try_get("valid_from").ok(),
        valid_to: row.try_get("valid_to").ok(),
        applies_monday: get_bool(row, "applies_monday"),
        applies_tuesday: get_bool(row, "applies_tuesday"),
        applies_wednesday: get_bool(row, "applies_wednesday"),
        applies_thursday: get_bool(row, "applies_thursday"),
        applies_friday: get_bool(row, "applies_friday"),
        applies_saturday: get_bool(row, "applies_saturday"),
        applies_sunday: get_bool(row, "applies_sunday"),
        min_nights: row.try_get("min_nights").unwrap_or(1),
        max_nights: row.try_get("max_nights").ok(),
        min_advance_booking: row.try_get("min_advance_booking").unwrap_or(0),
        max_advance_booking: row.try_get("max_advance_booking").ok(),
        is_active: get_bool(row, "is_active"),
        priority: row.try_get("priority").unwrap_or(0),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub fn row_to_room_rate(row: &DbRow) -> RoomRate {
    RoomRate {
        id: row.try_get("id").unwrap_or_default(),
        rate_plan_id: row.try_get("rate_plan_id").unwrap_or_default(),
        room_type_id: row.try_get("room_type_id").unwrap_or_default(),
        price: get_decimal(row, "price"),
        effective_from: row.try_get("effective_from").unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        effective_to: row.try_get("effective_to").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub fn row_to_room_rate_with_details(row: &DbRow) -> RoomRateWithDetails {
    RoomRateWithDetails {
        id: row.try_get("id").unwrap_or_default(),
        rate_plan_id: row.try_get("rate_plan_id").unwrap_or_default(),
        rate_plan_name: row.try_get("rate_plan_name").unwrap_or_default(),
        rate_plan_code: row.try_get("rate_plan_code").unwrap_or_default(),
        room_type_id: row.try_get("room_type_id").unwrap_or_default(),
        room_type_name: row.try_get("room_type_name").unwrap_or_default(),
        room_type_code: row.try_get("room_type_code").unwrap_or_default(),
        price: get_decimal(row, "price"),
        effective_from: row.try_get("effective_from").unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        effective_to: row.try_get("effective_to").ok(),
    }
}

// =============================================================================
// Ledger mappers
// =============================================================================

use super::ledger::{CustomerLedger, CustomerLedgerPayment, PatTransactionCode};

pub fn row_to_customer_ledger(row: &DbRow) -> CustomerLedger {
    CustomerLedger {
        id: row.try_get("id").unwrap_or_default(),
        company_name: row.try_get("company_name").unwrap_or_default(),
        company_registration_number: row.try_get("company_registration_number").ok(),
        contact_person: row.try_get("contact_person").ok(),
        contact_email: row.try_get("contact_email").ok(),
        contact_phone: row.try_get("contact_phone").ok(),
        billing_address_line1: row.try_get("billing_address_line1").ok(),
        billing_city: row.try_get("billing_city").ok(),
        billing_state: row.try_get("billing_state").ok(),
        billing_postal_code: row.try_get("billing_postal_code").ok(),
        billing_country: row.try_get("billing_country").ok(),
        description: row.try_get("description").unwrap_or_default(),
        expense_type: row.try_get("expense_type").unwrap_or_default(),
        amount: get_decimal(row, "amount"),
        currency: row.try_get("currency").ok(),
        status: row.try_get("status").unwrap_or_default(),
        paid_amount: get_decimal(row, "paid_amount"),
        balance_due: get_decimal(row, "balance_due"),
        payment_method: row.try_get("payment_method").ok(),
        payment_reference: row.try_get("payment_reference").ok(),
        payment_date: row.try_get("payment_date").ok(),
        booking_id: row.try_get("booking_id").ok(),
        guest_id: row.try_get("guest_id").ok(),
        invoice_number: row.try_get("invoice_number").ok(),
        invoice_date: row.try_get("invoice_date").ok(),
        due_date: row.try_get("due_date").ok(),
        notes: row.try_get("notes").ok(),
        internal_notes: row.try_get("internal_notes").ok(),
        created_by: row.try_get("created_by").ok(),
        updated_by: row.try_get("updated_by").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| NaiveDateTime::default()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| NaiveDateTime::default()),
        folio_number: row.try_get("folio_number").ok(),
        folio_type: row.try_get("folio_type").ok(),
        transaction_type: row.try_get("transaction_type").ok(),
        post_type: row.try_get("post_type").ok(),
        department_code: row.try_get("department_code").ok(),
        transaction_code: row.try_get("transaction_code").ok(),
        room_number: row.try_get("room_number").ok(),
        posting_date: row.try_get("posting_date").ok(),
        transaction_date: row.try_get("transaction_date").ok(),
        reference_number: row.try_get("reference_number").ok(),
        cashier_id: row.try_get("cashier_id").ok(),
        is_reversal: get_opt_bool(row, "is_reversal"),
        original_transaction_id: row.try_get("original_transaction_id").ok(),
        reversal_reason: row.try_get("reversal_reason").ok(),
        tax_amount: get_opt_decimal(row, "tax_amount"),
        service_charge: get_opt_decimal(row, "service_charge"),
        net_amount: get_opt_decimal(row, "net_amount"),
        is_posted: get_opt_bool(row, "is_posted"),
        posted_at: row.try_get("posted_at").ok(),
        void_at: row.try_get("void_at").ok(),
        void_by: row.try_get("void_by").ok(),
        void_reason: row.try_get("void_reason").ok(),
    }
}

pub fn row_to_customer_ledger_payment(row: &DbRow) -> CustomerLedgerPayment {
    CustomerLedgerPayment {
        id: row.try_get("id").unwrap_or_default(),
        ledger_id: row.try_get("ledger_id").unwrap_or_default(),
        payment_amount: get_decimal(row, "payment_amount"),
        payment_method: row.try_get("payment_method").unwrap_or_default(),
        payment_reference: row.try_get("payment_reference").ok(),
        payment_date: row.try_get("payment_date").unwrap_or_else(|_| NaiveDateTime::default()),
        receipt_number: row.try_get("receipt_number").ok(),
        receipt_file_url: row.try_get("receipt_file_url").ok(),
        notes: row.try_get("notes").ok(),
        processed_by: row.try_get("processed_by").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| NaiveDateTime::default()),
    }
}

pub fn row_to_pat_transaction_code(row: &DbRow) -> PatTransactionCode {
    PatTransactionCode {
        id: row.try_get("id").unwrap_or_default(),
        code: row.try_get("code").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        post_type: row.try_get("post_type").unwrap_or_default(),
        department_code: row.try_get("department_code").ok(),
        default_amount: get_opt_decimal(row, "default_amount"),
        is_taxable: get_bool(row, "is_taxable"),
        is_service_chargeable: get_bool(row, "is_service_chargeable"),
        gl_account_code: row.try_get("gl_account_code").ok(),
        is_active: get_bool(row, "is_active"),
        sort_order: row.try_get("sort_order").unwrap_or(0),
        created_at: row.try_get("created_at").unwrap_or_else(|_| NaiveDateTime::default()),
    }
}

// =============================================================================
// Company mapper
// =============================================================================

use super::company::Company;

pub fn row_to_company(row: &DbRow) -> Company {
    Company {
        id: row.try_get("id").unwrap_or_default(),
        company_name: row.try_get("company_name").unwrap_or_default(),
        registration_number: row.try_get("registration_number").ok(),
        contact_person: row.try_get("contact_person").ok(),
        contact_email: row.try_get("contact_email").ok(),
        contact_phone: row.try_get("contact_phone").ok(),
        billing_address: row.try_get("billing_address").ok(),
        billing_city: row.try_get("billing_city").ok(),
        billing_state: row.try_get("billing_state").ok(),
        billing_postal_code: row.try_get("billing_postal_code").ok(),
        billing_country: row.try_get("billing_country").ok(),
        is_active: get_bool(row, "is_active"),
        credit_limit: get_opt_decimal(row, "credit_limit"),
        payment_terms_days: row.try_get("payment_terms_days").ok(),
        notes: row.try_get("notes").ok(),
        created_by: row.try_get("created_by").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

// =============================================================================
// Rewards mapper
// =============================================================================

use super::rewards::LoyaltyReward;

pub fn row_to_loyalty_reward(row: &DbRow) -> LoyaltyReward {
    LoyaltyReward {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        description: row.try_get("description").ok(),
        category: row.try_get("category").unwrap_or_default(),
        points_cost: row.try_get("points_cost").unwrap_or_default(),
        monetary_value: get_opt_decimal(row, "monetary_value"),
        minimum_tier_level: row.try_get("minimum_tier_level").unwrap_or_default(),
        is_active: get_bool(row, "is_active"),
        stock_quantity: row.try_get("stock_quantity").ok(),
        image_url: row.try_get("image_url").ok(),
        terms_conditions: row.try_get("terms_conditions").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

// =============================================================================
// Room mappers
// =============================================================================

use super::room::{RoomType, GuestReview, RoomCurrentOccupancy, HotelOccupancySummary, OccupancyByRoomType};

pub fn row_to_room_type(row: &DbRow) -> RoomType {
    RoomType {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        code: row.try_get("code").unwrap_or_default(),
        description: row.try_get("description").ok(),
        base_price: get_decimal(row, "base_price"),
        weekday_rate: get_opt_decimal(row, "weekday_rate"),
        weekend_rate: get_opt_decimal(row, "weekend_rate"),
        max_occupancy: row.try_get("max_occupancy").unwrap_or(2),
        bed_type: row.try_get("bed_type").ok(),
        bed_count: row.try_get("bed_count").ok(),
        allows_extra_bed: get_bool(row, "allows_extra_bed"),
        max_extra_beds: row.try_get("max_extra_beds").unwrap_or(0),
        extra_bed_charge: get_decimal(row, "extra_bed_charge"),
        is_active: get_bool(row, "is_active"),
        sort_order: row.try_get("sort_order").unwrap_or(0),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub fn row_to_guest_review(row: &DbRow) -> GuestReview {
    GuestReview {
        id: row.try_get("id").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        guest_name: row.try_get("guest_name").unwrap_or_default(),
        room_type_id: row.try_get("room_type_id").ok(),
        overall_rating: get_opt_decimal(row, "overall_rating"),
        cleanliness_rating: get_opt_decimal(row, "cleanliness_rating"),
        staff_rating: get_opt_decimal(row, "staff_rating"),
        facilities_rating: get_opt_decimal(row, "facilities_rating"),
        value_rating: get_opt_decimal(row, "value_rating"),
        location_rating: get_opt_decimal(row, "location_rating"),
        title: row.try_get("title").ok(),
        review_text: row.try_get("review_text").ok(),
        pros: row.try_get("pros").ok(),
        cons: row.try_get("cons").ok(),
        recommend: get_opt_bool(row, "recommend"),
        stay_type: row.try_get("stay_type").ok(),
        is_verified: get_bool(row, "is_verified"),
        helpful_count: row.try_get("helpful_count").unwrap_or(0),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub fn row_to_room_current_occupancy(row: &DbRow) -> RoomCurrentOccupancy {
    RoomCurrentOccupancy {
        room_id: row.try_get("room_id").unwrap_or_default(),
        room_number: row.try_get("room_number").unwrap_or_default(),
        room_type_id: row.try_get("room_type_id").ok(),
        room_type_name: row.try_get("room_type_name").ok(),
        max_occupancy: row.try_get("max_occupancy").ok(),
        room_status: row.try_get("room_status").ok(),
        current_adults: row.try_get("current_adults").unwrap_or(0),
        current_children: row.try_get("current_children").unwrap_or(0),
        current_infants: row.try_get("current_infants").unwrap_or(0),
        current_total_guests: row.try_get("current_total_guests").unwrap_or(0),
        occupancy_percentage: get_opt_decimal(row, "occupancy_percentage"),
        current_booking_id: row.try_get("current_booking_id").ok(),
        current_booking_number: row.try_get("current_booking_number").ok(),
        current_guest_id: row.try_get("current_guest_id").ok(),
        check_in_date: row.try_get("check_in_date").ok(),
        check_out_date: row.try_get("check_out_date").ok(),
        is_occupied: get_bool(row, "is_occupied"),
    }
}

pub fn row_to_hotel_occupancy_summary(row: &DbRow) -> HotelOccupancySummary {
    HotelOccupancySummary {
        total_rooms: row.try_get("total_rooms").unwrap_or(0),
        occupied_rooms: row.try_get("occupied_rooms").unwrap_or(0),
        available_rooms: row.try_get("available_rooms").unwrap_or(0),
        occupancy_rate: get_opt_decimal(row, "occupancy_rate"),
        total_adults: row.try_get("total_adults").unwrap_or(0),
        total_children: row.try_get("total_children").unwrap_or(0),
        total_infants: row.try_get("total_infants").unwrap_or(0),
        total_guests: row.try_get("total_guests").unwrap_or(0),
        total_capacity: row.try_get("total_capacity").unwrap_or(0),
        guest_occupancy_rate: get_opt_decimal(row, "guest_occupancy_rate"),
    }
}

pub fn row_to_occupancy_by_room_type(row: &DbRow) -> OccupancyByRoomType {
    OccupancyByRoomType {
        room_type_id: row.try_get("room_type_id").ok(),
        room_type_name: row.try_get("room_type_name").ok(),
        capacity_per_room: row.try_get("capacity_per_room").ok(),
        total_rooms: row.try_get("total_rooms").unwrap_or(0),
        occupied_rooms: row.try_get("occupied_rooms").unwrap_or(0),
        room_occupancy_rate: get_opt_decimal(row, "room_occupancy_rate"),
        total_guests: row.try_get("total_guests").unwrap_or(0),
        total_capacity: row.try_get("total_capacity").unwrap_or(0),
        guest_occupancy_rate: get_opt_decimal(row, "guest_occupancy_rate"),
    }
}
