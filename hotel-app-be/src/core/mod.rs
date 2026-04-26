//! Core infrastructure modules
//!
//! This module contains foundational components used across the application:
//! - `auth`: Authentication service (JWT, password hashing, 2FA, refresh tokens)
//! - `db`: Database connection pool
//! - `error`: Unified API error types
//! - `middleware`: Request authentication and authorization middleware
//! - `sql_compat`: SQL compatibility helpers for PostgreSQL/SQLite

pub mod auth;
#[allow(dead_code)]
pub mod db;
pub mod error;
pub mod middleware;
pub mod rate_limiter;
#[allow(dead_code)]
pub mod sql_compat;

// Re-export commonly used types
#[allow(unused_imports)]
pub use auth::{AuthService, Claims};
pub use db::create_pool;
#[allow(unused_imports)]
pub use error::ApiError;
#[allow(unused_imports)]
pub use middleware::{
    require_admin_helper, require_auth, require_permission_helper, require_super_admin_helper,
};
