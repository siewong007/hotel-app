//! Shared domain enums and fixed protocol values.

use serde::{Deserialize, Serialize};

/// User type enum matching PostgreSQL UserType.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "usertype", rename_all = "lowercase")]
pub enum UserType {
    Staff,
    Guest,
}

/// Payment status values persisted by the payments workflow.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, sqlx::Type)]
#[sqlx(type_name = "varchar", rename_all = "snake_case")]
pub enum PaymentStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Refunded,
    Cancelled,
}

impl std::fmt::Display for PaymentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentStatus::Pending => write!(f, "pending"),
            PaymentStatus::Processing => write!(f, "processing"),
            PaymentStatus::Completed => write!(f, "completed"),
            PaymentStatus::Failed => write!(f, "failed"),
            PaymentStatus::Refunded => write!(f, "refunded"),
            PaymentStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Payment methods accepted by the payment endpoints.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    Cash,
    Card,
    BankTransfer,
    Duitnow,
    OnlineBanking,
    Cheque,
    Other,
}

impl std::fmt::Display for PaymentMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentMethod::Cash => write!(f, "cash"),
            PaymentMethod::Card => write!(f, "card"),
            PaymentMethod::BankTransfer => write!(f, "bank_transfer"),
            PaymentMethod::Duitnow => write!(f, "duitnow"),
            PaymentMethod::OnlineBanking => write!(f, "online_banking"),
            PaymentMethod::Cheque => write!(f, "cheque"),
            PaymentMethod::Other => write!(f, "other"),
        }
    }
}

/// Guest membership type for pricing differentiation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, sqlx::Type, Default)]
#[sqlx(type_name = "guest_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GuestType {
    Member,
    #[default]
    NonMember,
}

/// Tourism type for tourism tax calculation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, sqlx::Type)]
#[sqlx(type_name = "tourism_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TourismType {
    Local,
    Foreign,
}

/// eKYC review status values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, sqlx::Type)]
#[sqlx(type_name = "varchar", rename_all = "snake_case")]
pub enum EkycStatus {
    Pending,
    InProgress,
    Verified,
    Rejected,
    Expired,
}

/// Import behavior for booking data transfers.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    /// Append new records (skip duplicates by booking_number).
    Import,
    /// Delete all existing booking data and replace with imported data.
    Overwrite,
}
