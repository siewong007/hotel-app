//! Company models for direct billing

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Company entity for direct billing
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Company {
    pub id: i64,
    pub company_name: String,
    pub registration_number: Option<String>,
    pub contact_person: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub billing_address: Option<String>,
    pub billing_city: Option<String>,
    pub billing_state: Option<String>,
    pub billing_postal_code: Option<String>,
    pub billing_country: Option<String>,
    pub is_active: bool,
    pub credit_limit: Option<rust_decimal::Decimal>,
    pub payment_terms_days: Option<i32>,
    pub notes: Option<String>,
    pub created_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating a company
#[derive(Debug, Serialize, Deserialize)]
pub struct CompanyCreateRequest {
    pub company_name: String,
    pub registration_number: Option<String>,
    pub contact_person: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub billing_address: Option<String>,
    pub billing_city: Option<String>,
    pub billing_state: Option<String>,
    pub billing_postal_code: Option<String>,
    pub billing_country: Option<String>,
    pub credit_limit: Option<f64>,
    pub payment_terms_days: Option<i32>,
    pub notes: Option<String>,
}

/// Input for updating a company
#[derive(Debug, Serialize, Deserialize)]
pub struct CompanyUpdateRequest {
    pub company_name: Option<String>,
    pub registration_number: Option<String>,
    pub contact_person: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub billing_address: Option<String>,
    pub billing_city: Option<String>,
    pub billing_state: Option<String>,
    pub billing_postal_code: Option<String>,
    pub billing_country: Option<String>,
    pub is_active: Option<bool>,
    pub credit_limit: Option<f64>,
    pub payment_terms_days: Option<i32>,
    pub notes: Option<String>,
}
