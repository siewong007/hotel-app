//! Hotel Management Backend Library
//!
//! This crate provides the core functionality for the hotel management system.

pub mod core;
pub mod handlers;
pub mod models;
pub mod repositories;
pub mod routes;
pub mod services;
pub mod utils;

// Re-export commonly used types from core
pub use core::{
    create_pool,
    ApiError,
    AuthService,
    Claims,
    require_auth,
    require_permission_helper,
    require_admin_helper,
    require_super_admin_helper,
};
