//! Domain-specific HTTP handlers
//!
//! Each module contains handlers for a specific domain of the application.
//! Handlers are organized by feature area for better maintainability.

pub mod analytics;
// audit handlers live in modules::audit.
pub mod auth;
// booking_channels handlers live in modules::booking_channels.
pub mod bookings;
// companies handlers live in modules::companies.
pub mod data_transfer;
// eKYC handlers live in modules::ekyc.
pub mod guest_portal;
pub mod guests;
// housekeeping handlers live in modules::housekeeping.
pub mod ledgers;
// Loyalty handlers live in modules::loyalty::handlers.
// maintenance handlers live in modules::maintenance.
pub mod night_audit;
// passkey handlers live in modules::passkey.
pub mod payment_retry;
pub mod payments;
// profile handlers live in modules::profile.
// rates handlers live in modules::rates.
// rbac handlers live in modules::rbac.
pub mod rooms;
// search handlers live in modules::search.
// two_factor handlers live in modules::two_factor.
// users handlers live in modules::users.
pub mod webhooks;

// Re-export all handlers for convenience

// Also re-export the ApiError for handlers
