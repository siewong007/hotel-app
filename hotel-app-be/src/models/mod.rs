//! Domain-specific data models
//!
//! Each module contains models for a specific domain of the application.

#[allow(dead_code)]
pub mod common;
#[allow(dead_code)]
pub mod user;
#[allow(dead_code)]
pub mod room;
#[allow(dead_code)]
pub mod guest;
pub mod booking;
pub mod auth;
pub mod rbac;
#[allow(dead_code)]
pub mod loyalty;
#[allow(dead_code)]
pub mod rewards;
#[allow(dead_code)]
pub mod payment;
pub mod rate;
pub mod ekyc;
pub mod ledger;
pub mod settings;
pub mod company;
#[allow(dead_code)]
pub mod row_mappers;
pub mod night_audit;

// Re-export all models for convenience
pub use common::*;
pub use user::*;
pub use room::*;
pub use guest::*;
pub use booking::*;
pub use auth::*;
pub use rbac::*;
pub use loyalty::*;
pub use rewards::*;
pub use payment::*;
pub use rate::*;
pub use ekyc::*;
pub use ledger::*;
pub use settings::*;
pub use company::*;
pub use night_audit::*;
