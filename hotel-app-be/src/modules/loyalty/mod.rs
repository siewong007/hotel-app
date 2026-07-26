//! Loyalty program portal domain.
//!
//! Guest-facing enrollment, append-only points ledger, tier progress, rewards,
//! and staff administration for the loyalty program portal.

pub mod handlers;
pub mod hub;
pub mod models;
pub mod repository;
pub mod routes;
pub mod service;
pub mod validation;
