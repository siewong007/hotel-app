//! Repository layer for database access
//!
//! Repositories encapsulate all database queries and provide a clean interface
//! for the service/handler layers to interact with the database.

// analytics persistence live in modules::analytics.
pub mod audit;
// auth persistence live in modules::auth.
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
// guest_portal persistence live in modules::guest_portal.
// guest_portal_session persistence live in modules::guest_portal.
// housekeeping persistence live in modules::housekeeping.
pub mod invoice_numbers;
pub mod ledger;
// Loyalty persistence lives in modules::loyalty::repository.
// maintenance persistence live in modules::maintenance.
// night_audit persistence live in modules::night_audit.
// passkey persistence live in modules::passkey.
// payment persistence live in modules::payments.
// payment_retry persistence live in modules::payment_retry.
// rate persistence live in modules::rates.
// rbac persistence live in modules::rbac.
// rooms_queries persistence live in modules::rooms.
// search persistence live in modules::search.
// user persistence live in modules::users.
