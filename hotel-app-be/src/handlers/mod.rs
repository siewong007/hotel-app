//! Domain-specific HTTP handlers
//!
//! Each module contains handlers for a specific domain of the application.
//! Handlers are organized by feature area for better maintainability.

// analytics handlers live in modules::analytics.
// audit handlers live in modules::audit.
// auth handlers live in modules::auth.
// booking_channels handlers live in modules::booking_channels.
pub mod bookings;
// companies handlers live in modules::companies.
pub mod data_transfer;
// eKYC handlers live in modules::ekyc.
pub mod guest_portal;
// guests handlers live in modules::guests.
// housekeeping handlers live in modules::housekeeping.
pub mod ledgers;
// Loyalty handlers live in modules::loyalty::handlers.
// maintenance handlers live in modules::maintenance.
// night_audit handlers live in modules::night_audit.
// passkey handlers live in modules::passkey.
// payment_retry handlers live in modules::payment_retry.
// payments handlers live in modules::payments.
// profile handlers live in modules::profile.
// rates handlers live in modules::rates.
// rbac handlers live in modules::rbac.
// rooms handlers live in modules::rooms.
// search handlers live in modules::search.
// two_factor handlers live in modules::two_factor.
// users handlers live in modules::users.
pub mod webhooks;

// Re-export all handlers for convenience

// Also re-export the ApiError for handlers
