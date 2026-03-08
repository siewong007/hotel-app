//! Domain-specific HTTP handlers
//!
//! Each module contains handlers for a specific domain of the application.
//! Handlers are organized by feature area for better maintainability.

pub mod auth;
pub mod two_factor;
pub mod passkey;
pub mod rooms;
#[allow(dead_code)]
pub mod rooms_queries;
pub mod guests;
pub mod bookings;
#[allow(dead_code)]
pub mod bookings_queries;
pub mod rbac;
#[allow(dead_code)]
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
#[allow(dead_code)]
pub mod audit;
pub mod night_audit;
pub mod data_transfer;

// Re-export all handlers for convenience

// Also re-export the ApiError for handlers
