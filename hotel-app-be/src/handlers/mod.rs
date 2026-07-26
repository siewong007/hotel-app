//! Domain-specific HTTP handlers
//!
//! Each module contains handlers for a specific domain of the application.
//! Handlers are organized by feature area for better maintainability.

pub mod analytics;
pub mod audit;
pub mod auth;
pub mod booking_channels;
pub mod bookings;
pub mod companies;
pub mod data_transfer;
// eKYC handlers now live in modules::ekyc; the old handlers/ekyc.rs file is
// preserved on disk for backward reference during migration but not compiled.
pub mod guest_portal;
pub mod guests;
pub mod housekeeping;
pub mod ledgers;
#[allow(dead_code)]
pub mod loyalty;
pub mod maintenance;
pub mod night_audit;
pub mod passkey;
pub mod payments;
pub mod profile;
pub mod rates;
pub mod rbac;
pub mod rooms;
pub mod search;
pub mod two_factor;
pub mod webhooks;

// Re-export all handlers for convenience

// Also re-export the ApiError for handlers
