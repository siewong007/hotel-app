//! Domain-specific HTTP handlers
//!
//! Each module contains handlers for a specific domain of the application.
//! Handlers are organized by feature area for better maintainability.

pub mod analytics;
#[allow(dead_code)]
pub mod audit;
pub mod auth;
pub mod bookings;
#[allow(dead_code)]
pub mod bookings_queries;
pub mod companies;
pub mod data_transfer;
pub mod ekyc;
pub mod guest_portal;
pub mod guests;
pub mod ledgers;
#[allow(dead_code)]
pub mod loyalty;
pub mod night_audit;
pub mod passkey;
pub mod payments;
pub mod profile;
pub mod rates;
pub mod rbac;
pub mod rooms;
#[allow(dead_code)]
pub mod rooms_queries;
pub mod settings;
pub mod two_factor;

// Re-export all handlers for convenience

// Also re-export the ApiError for handlers
