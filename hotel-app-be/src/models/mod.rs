//! Domain-specific data models
//!
//! Each module contains models for a specific domain of the application.

pub mod analytics;
pub mod audit;
pub mod auth;
pub mod booking;
pub mod booking_channel;
pub mod common;
pub mod company;
pub mod data_transfer;
pub mod ekyc;
pub mod guest;
pub mod guest_portal;
pub mod housekeeping;
pub mod ledger;
pub mod maintenance;
pub mod night_audit;
pub mod payment;
pub mod rate;
pub mod rbac;
pub mod room;
pub mod row_mappers;
pub mod search;
pub mod user;

// Re-export all models for convenience
pub use analytics::*;
pub use audit::*;
pub use auth::*;
pub use booking::*;
pub use booking_channel::*;
pub use common::*;
pub use company::*;
pub use data_transfer::*;
pub use ekyc::*;
pub use guest::*;
pub use guest_portal::*;
pub use housekeeping::*;
pub use ledger::*;
pub use maintenance::*;
pub use night_audit::*;
pub use payment::*;
pub use rate::*;
pub use rbac::*;
pub use room::*;
pub use search::*;
pub use user::*;
