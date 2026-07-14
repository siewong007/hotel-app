//! Guest support conversations.
//!
//! This module owns the durable support workflow shared by the guest portal
//! and the staff queue. Public messages and staff-only operational history are
//! deliberately represented separately so guest endpoints cannot accidentally
//! disclose assignments, SLA state, or internal notes.

pub mod handlers;
pub mod models;
pub mod repository;
pub mod routes;
pub mod service;
pub mod validation;
