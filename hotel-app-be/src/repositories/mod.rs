//! Repository layer for database access
//!
//! Repositories encapsulate all database queries and provide a clean interface
//! for the service/handler layers to interact with the database.

pub mod analytics;
pub mod audit;
pub mod auth;
pub mod booking;
pub mod booking_channels;
pub mod booking_list;
pub mod bookings;
pub mod bookings_queries;
pub mod channel_net_revenue;
pub mod company;
pub mod data_transfer;
pub mod ekyc;
pub mod guest;
pub mod guest_portal;
pub mod guest_portal_session;
pub mod housekeeping;
pub mod invoice_numbers;
pub mod ledger;
// Loyalty persistence lives in modules::loyalty::repository.
pub mod maintenance;
pub mod night_audit;
pub mod passkey;
pub mod payment;
pub mod rate;
pub mod rbac;
pub mod rooms_queries;
pub mod search;
pub mod user;
