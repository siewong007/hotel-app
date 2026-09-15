//! Domain-specific data models
//!
//! Each module contains models for a specific domain of the application.

pub mod analytics;
pub mod audit;
pub mod auth;
pub mod booking;
pub mod common;
pub mod data_transfer;
pub mod ekyc;
pub mod guest;
pub mod guest_portal;
pub mod ledger;
pub mod night_audit;
pub mod payment;
pub mod payment_retry;
pub mod rbac;
pub mod room;
pub mod row_mappers;
pub mod user;

// Re-export all models for convenience
pub use analytics::*;
pub use audit::*;
pub use auth::*;
pub use booking::*;
pub use crate::modules::booking_channels::models::*;
pub use common::*;
pub use crate::modules::companies::models::*;
pub use data_transfer::*;
pub use ekyc::*;
pub use guest::*;
pub use guest_portal::*;
pub use crate::modules::housekeeping::models::*;
pub use ledger::*;
pub use crate::modules::maintenance::models::*;
pub use night_audit::*;
pub use payment::*;
pub use crate::modules::rates::models::*;
pub use rbac::*;
pub use room::*;
pub use crate::modules::search::models::*;
pub use user::*;
