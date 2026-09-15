//! Domain-specific HTTP handlers
//!
//! Each module contains handlers for a specific domain of the application.
//! Handlers are organized by feature area for better maintainability.

pub mod analytics;
pub mod audit;
pub mod auth;
// booking_channels handlers live in modules::booking_channels.
pub mod bookings;
pub mod companies;
pub mod data_transfer;
// eKYC handlers live in modules::ekyc.
pub mod guest_portal;
pub mod guests;
// housekeeping handlers live in modules::housekeeping.
pub mod ledgers;
// Loyalty handlers live in modules::loyalty::handlers.
// maintenance handlers live in modules::maintenance.
pub mod night_audit;
pub mod passkey;
pub mod payment_retry;
pub mod payments;
pub mod profile;
pub mod rates;
pub mod rbac;
pub mod rooms;
// search handlers live in modules::search.
pub mod two_factor;
pub mod users;
pub mod webhooks;

// Re-export all handlers for convenience

// Also re-export the ApiError for handlers
