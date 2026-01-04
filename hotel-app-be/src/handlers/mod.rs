//! Domain-specific HTTP handlers
//!
//! Each module contains handlers for a specific domain of the application.
//! Handlers are organized by feature area for better maintainability.

pub mod auth;
pub mod two_factor;
pub mod passkey;
pub mod rooms;
pub mod guests;
pub mod bookings;
pub mod rbac;
pub mod loyalty;
pub mod profile;
pub mod analytics;
pub mod settings;
pub mod ekyc;
pub mod payments;
pub mod rates;
pub mod ledgers;
pub mod guest_portal;
pub mod companies;
pub mod audit;
pub mod night_audit;

// Re-export all handlers for convenience
pub use auth::*;
pub use two_factor::*;
pub use passkey::*;
pub use rooms::*;
pub use guests::*;
pub use bookings::*;
pub use rbac::*;
pub use loyalty::*;
pub use profile::*;
pub use analytics::*;
pub use settings::*;
pub use companies::*;

// Also re-export the ApiError for handlers
pub use crate::core::error::ApiError;
