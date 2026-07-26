//! Hotel Management Backend Library
//!
//! This crate provides the core functionality for the hotel management system.

pub mod constants;
pub mod core;
pub mod handlers;
pub mod models;
pub mod modules;
pub mod repositories;
pub mod routes;
pub mod services;
pub mod utils;

// Re-export commonly used types from core
pub use core::{
    ApiError, AuthService, Claims, create_pool, ensure_super_admin, require_auth,
    require_permission_helper,
};
