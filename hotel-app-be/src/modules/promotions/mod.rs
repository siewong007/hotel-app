//! Promotion campaigns, guest vouchers, and their lifecycle.
//!
//! This module deliberately keeps promotion inventory and voucher ownership
//! separate from loyalty points and complimentary-room credits. Financial
//! application to a booking is added through the same domain once the booking
//! pricing snapshot is available.

pub mod handlers;
pub mod models;
pub mod repository;
pub mod routes;
pub mod service;
pub mod validation;
