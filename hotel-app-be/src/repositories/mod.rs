//! Repository layer for database access
//!
//! Repositories encapsulate all database queries and provide a clean interface
//! for the service/handler layers to interact with the database.

pub mod analytics;
pub mod audit;
pub mod auth;
pub mod booking;
// booking_channels persistence live in modules::booking_channels.
pub mod booking_list;
pub mod bookings;
pub mod bookings_queries;
pub mod channel_net_revenue;
// company persistence live in modules::companies.
pub mod data_transfer;
pub mod ekyc;
pub mod guest;
pub mod guest_portal;
pub mod guest_portal_session;
// housekeeping persistence live in modules::housekeeping.
pub mod invoice_numbers;
pub mod ledger;
// Loyalty persistence lives in modules::loyalty::repository.
// maintenance persistence live in modules::maintenance.
pub mod night_audit;
pub mod passkey;
pub mod payment;
pub mod payment_retry;
// rate persistence live in modules::rates.
pub mod rbac;
pub mod rooms_queries;
// search persistence live in modules::search.
// user persistence live in modules::users.
