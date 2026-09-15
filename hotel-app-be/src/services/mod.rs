//! Business logic services
//!
//! Services that encapsulate complex business logic.

pub mod account_emails;
// analytics service logic live in modules::analytics.
pub mod audit;
// auth service logic live in modules::auth.
// auto_checkin service logic live in modules::bookings.
// booking service logic live in modules::bookings.
// booking_channels service logic live in modules::booking_channels.
// booking_emails service logic live in modules::bookings.
// bookings service logic live in modules::bookings.
// companies service logic live in modules::companies.
pub mod data_transfer;
// Import staging/jobs for data transfer — kept in a sibling file so
// data_transfer.rs does not grow past its maintainable size.
pub mod data_transfer_jobs;
// Step-up re-authentication for privileged data-transfer operations.
pub mod data_transfer_step_up;
// eKYC service logic lives in modules::ekyc.
pub mod google_identity;
// guest_portal service logic live in modules::guest_portal.
// guests service logic live in modules::guests.
// housekeeping service logic live in modules::housekeeping.
pub mod invoice_numbers;
// ledgers service logic live in modules::ledgers.
// Loyalty service logic lives in modules::loyalty::service.
// maintenance service logic live in modules::maintenance.
// night_audit service logic live in modules::night_audit.
// night_audit_scheduler service logic live in modules::night_audit.
// passkey service logic live in modules::passkey.
// payment_receipt_scheduler service logic live in modules::payments.
// payment_retry service logic live in modules::payment_retry.
// payments service logic live in modules::payments.
// paypal_client service logic live in modules::payments.
// profile service logic live in modules::profile.
pub mod promotion_pricing;
// rates service logic live in modules::rates.
// rbac service logic live in modules::rbac.
// rooms service logic live in modules::rooms.
// search service logic live in modules::search.
// turnstile service logic live in modules::auth.
// two_factor service logic live in modules::two_factor.
// unpaid_hold_scheduler service logic live in modules::bookings.
// users service logic live in modules::users.
