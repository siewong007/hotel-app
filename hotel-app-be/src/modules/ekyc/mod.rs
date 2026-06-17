//! eKYC (Electronic Know Your Customer) module
//!
//! Handles identity verification, administrative review, and self-check-in.

pub mod models;
pub mod repository;
pub mod routes;
pub mod service;
pub mod validation;

// Re-export key types and repository for backwards compatibility
pub use models::*;
pub use repository::EkycRepository;