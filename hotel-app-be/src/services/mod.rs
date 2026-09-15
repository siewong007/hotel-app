//! Business logic services
//!
//! Services that encapsulate complex business logic.

pub mod account_emails;
pub mod analytics;
pub mod audit;
pub mod auth;
pub mod auto_checkin;
pub mod booking;
pub mod booking_channels;
pub mod booking_emails;
pub mod bookings;
pub mod companies;
pub mod data_transfer;
// Import staging/jobs for data transfer — kept in a sibling file so
// data_transfer.rs does not grow past its maintainable size.
pub mod data_transfer_jobs;
// Step-up re-authentication for privileged data-transfer operations.
pub mod data_transfer_step_up;
// eKYC service logic lives in modules::ekyc.
pub mod google_identity;
pub mod guest_portal;
pub mod guests;
pub mod housekeeping;
pub mod invoice_numbers;
pub mod ledgers;
// Loyalty service logic lives in modules::loyalty::service.
pub mod maintenance;
pub mod night_audit;
pub mod night_audit_scheduler;
pub mod passkey;
pub mod payment_receipt_scheduler;
pub mod payment_retry;
pub mod payments;
pub mod paypal_client;
pub mod profile;
pub mod promotion_pricing;
pub mod rates;
pub mod rbac;
pub mod rooms;
pub mod search;
pub mod turnstile;
pub mod two_factor;
pub mod unpaid_hold_scheduler;
pub mod users;
