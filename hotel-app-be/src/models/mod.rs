//! Domain-specific data models
//!
//! Each module contains models for a specific domain of the application.

pub mod audit;
pub mod booking;
pub mod common;
pub mod data_transfer;
pub mod ekyc;
pub mod ledger;
pub mod row_mappers;

// Re-export all models for convenience
pub use crate::modules::analytics::models::*;
pub use audit::*;
pub use crate::modules::auth::models::*;
pub use booking::*;
pub use crate::modules::booking_channels::models::*;
pub use common::*;
pub use crate::modules::companies::models::*;
pub use data_transfer::*;
pub use ekyc::*;
pub use crate::modules::guests::models::*;
pub use crate::modules::guest_portal::models::*;
pub use crate::modules::housekeeping::models::*;
pub use ledger::*;
pub use crate::modules::maintenance::models::*;
pub use crate::modules::night_audit::models::*;
pub use crate::modules::payments::models::*;
pub use crate::modules::rates::models::*;
pub use crate::modules::rbac::models::*;
pub use crate::modules::rooms::models::*;
pub use crate::modules::search::models::*;
pub use crate::modules::users::models::*;
