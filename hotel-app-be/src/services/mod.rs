//! Business logic services
//!
//! Services that encapsulate complex business logic.

pub mod analytics;
#[allow(dead_code)]
pub mod audit;
pub mod auth;
pub mod auto_checkin;
pub mod booking;
pub mod booking_channels;
pub mod bookings;
pub mod companies;
pub mod data_transfer;
// eKYC service logic now lives in modules::ekyc; the old services/ekyc.rs file
// is preserved on disk for backward reference during migration but not compiled.
pub mod guest_portal;
pub mod guests;
pub mod invoice_numbers;
pub mod ledgers;
pub mod loyalty;
pub mod night_audit;
pub mod night_audit_scheduler;
pub mod passkey;
pub mod payments;
pub mod profile;
pub mod rates;
pub mod rbac;
pub mod rooms;
pub mod search;
pub mod two_factor;
