//! Repository layer for database access
//!
//! Repositories encapsulate all database queries and provide a clean interface
//! for the service/handler layers to interact with the database.

// analytics persistence live in modules::analytics.
pub mod audit;
pub mod auth;
pub mod booking;
// booking_channels persistence live in modules::booking_channels.
pub mod booking_list;
pub mod bookings;
pub mod bookings_queries;
// channel_net_revenue persistence live in modules::analytics.
// company persistence live in modules::companies.
pub mod data_transfer;
pub mod ekyc;
// guest persistence live in modules::guests.
pub mod guest_portal;
pub mod guest_portal_session;
// housekeeping persistence live in modules::housekeeping.
pub mod invoice_numbers;
pub mod ledger;
// Loyalty persistence lives in modules::loyalty::repository.
// maintenance persistence live in modules::maintenance.
// night_audit persistence live in modules::night_audit.
// passkey persistence live in modules::passkey.
pub mod payment;
pub mod payment_retry;
// rate persistence live in modules::rates.
// rbac persistence live in modules::rbac.
// rooms_queries persistence live in modules::rooms.
// search persistence live in modules::search.
// user persistence live in modules::users.
