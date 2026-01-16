//! Core infrastructure modules
//!
//! This module contains foundational components used across the application:
//! - `auth`: Authentication service (JWT, password hashing, 2FA, refresh tokens)
//! - `db`: Database connection pool
//! - `error`: Unified API error types
//! - `middleware`: Request authentication and authorization middleware
//! - `sql_compat`: SQL compatibility helpers for PostgreSQL/SQLite

pub mod auth;
pub mod db;
pub mod error;
pub mod middleware;
pub mod sql_compat;

// Re-export commonly used types
pub use auth::{AuthService, Claims};
pub use db::{create_pool, DbPool, DbRow};
pub use error::ApiError;
pub use sql_compat::adapt_query;
pub use middleware::{
    require_auth,
    require_permission_helper,
    require_admin_helper,
    require_super_admin_helper,
    extract_claims,
    extract_user_id,
    check_permission,
    check_admin_role,
};
