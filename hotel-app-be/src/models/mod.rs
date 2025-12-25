//! Domain-specific data models
//!
//! Each module contains models for a specific domain of the application.

pub mod common;
pub mod user;
pub mod room;
pub mod guest;
pub mod booking;
pub mod auth;
pub mod rbac;
pub mod loyalty;
pub mod rewards;
pub mod payment;
pub mod rate;
pub mod ekyc;
pub mod ledger;
pub mod settings;
pub mod company;

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
