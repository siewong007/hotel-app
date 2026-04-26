//! Domain-specific data models
//!
//! Each module contains models for a specific domain of the application.

pub mod auth;
pub mod booking;
#[allow(dead_code)]
pub mod common;
pub mod company;
pub mod ekyc;
#[allow(dead_code)]
pub mod guest;
pub mod ledger;
#[allow(dead_code)]
pub mod loyalty;
pub mod night_audit;
#[allow(dead_code)]
pub mod payment;
pub mod rate;
pub mod rbac;
#[allow(dead_code)]
pub mod rewards;
#[allow(dead_code)]
pub mod room;
#[allow(dead_code)]
pub mod row_mappers;
pub mod settings;
#[allow(dead_code)]
pub mod user;

// Re-export all models for convenience
pub use auth::*;
pub use booking::*;
pub use common::*;
pub use company::*;
pub use ekyc::*;
pub use guest::*;
pub use ledger::*;
pub use loyalty::*;
pub use night_audit::*;
pub use payment::*;
pub use rate::*;
pub use rbac::*;
pub use rewards::*;
pub use room::*;
pub use settings::*;
pub use user::*;
