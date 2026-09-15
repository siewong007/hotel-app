//! Company models for direct billing

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Company entity for direct billing
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Query parameters for listing companies.
#[derive(Debug, Deserialize)]
pub struct CompanyListQuery {
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for Company {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Company {
            id: row.try_get("id")?,
            company_name: row.try_get("company_name")?,
            registration_number: row.try_get("registration_number")?,
            contact_person: row.try_get("contact_person")?,
            contact_email: row.try_get("contact_email")?,
            contact_phone: row.try_get("contact_phone")?,
            billing_address: row.try_get("billing_address")?,
            billing_city: row.try_get("billing_city")?,
            billing_state: row.try_get("billing_state")?,
            billing_postal_code: row.try_get("billing_postal_code")?,
            billing_country: row.try_get("billing_country")?,
            is_active: row.try_get("is_active")?,
            credit_limit: { row.try_get("credit_limit")? },
            payment_terms_days: row.try_get("payment_terms_days")?,
            notes: row.try_get("notes")?,
            created_by: row.try_get("created_by")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}
