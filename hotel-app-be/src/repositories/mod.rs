//! Repository layer for database access
//!
//! Repositories encapsulate all database queries and provide a clean interface
//! for the service/handler layers to interact with the database.

pub mod user;
pub mod room;
pub mod guest;
pub mod booking;
pub mod payment;
pub mod ledger;
pub mod loyalty;
pub mod rbac;
pub mod settings;

