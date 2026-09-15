//! Domain-specific HTTP handlers
//!
//! Each module contains handlers for a specific domain of the application.
//! Handlers are organized by feature area for better maintainability.

// analytics handlers live in modules::analytics.
// audit handlers live in modules::audit.
// auth handlers live in modules::auth.
// booking_channels handlers live in modules::booking_channels.
// bookings handlers live in modules::bookings.
// companies handlers live in modules::companies.
// data_transfer handlers live in modules::data_transfer.
// eKYC handlers live in modules::ekyc.
// guest_portal handlers live in modules::guest_portal.
// guests handlers live in modules::guests.
// housekeeping handlers live in modules::housekeeping.
// ledgers handlers live in modules::ledgers.
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
// webhooks handlers live in modules::webhooks.

// Re-export all handlers for convenience

// Also re-export the ApiError for handlers
