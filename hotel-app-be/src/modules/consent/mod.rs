//! Consent capture and evidence (Personal Data Protection Act 2010).
//!
//! Consent is collected at four points — registration, online booking, payment
//! and identity verification — and all four funnel through this module so the
//! evidence has one shape and one place to audit.

pub mod models;
pub mod repository;
pub mod service;
pub mod validation;
