//! Repository layer for database access
//!
//! Repositories encapsulate all database queries and provide a clean interface
//! for the service/handler layers to interact with the database.

pub mod analytics;
#[allow(dead_code)]
pub mod audit;
pub mod auth;
#[allow(dead_code)]
pub mod booking;
pub mod booking_channels;
#[allow(dead_code)]
pub mod booking_list;
pub mod bookings;
#[allow(dead_code)]
pub mod bookings_queries;
pub mod channel_net_revenue;
pub mod company;
pub mod data_transfer;
pub mod ekyc;
#[allow(dead_code)]
pub mod guest;
pub mod guest_portal;
pub mod guest_portal_session;
pub mod housekeeping;
pub mod invoice_numbers;
#[allow(dead_code)]
pub mod ledger;
#[allow(dead_code)]
pub mod loyalty;
pub mod night_audit;
pub mod passkey;
#[allow(dead_code)]
pub mod payment;
pub mod rate;
#[allow(dead_code)]
pub mod rbac;
#[allow(dead_code)]
pub mod room;
#[allow(dead_code)]
pub mod rooms_queries;
pub mod search;
#[allow(dead_code)]
pub mod user;
