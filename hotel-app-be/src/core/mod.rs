//! Core infrastructure modules
//!
//! This module contains foundational components used across the application:
//! - `auth`: Authentication service (JWT, password hashing, 2FA, refresh tokens)
//! - `db`: Database connection pool
//! - `error`: Unified API error types
//! - `middleware`: Request authentication and authorization middleware
//! - `metrics`: In-process counters for operational alerting
//! - `sql_compat`: PostgreSQL SQL helpers

pub mod auth;
pub mod config;
#[allow(dead_code)]
pub mod db;
pub mod error;
pub mod metrics;
pub mod middleware;
pub mod rate_limiter;
pub mod rbac_cache;
pub mod settings_cache;
#[allow(dead_code)]
pub mod sql_compat;

// Re-export commonly used types
#[allow(unused_imports)]
pub use auth::{AuthService, Claims};
#[allow(unused_imports)]
pub use config::AppConfig;
pub use db::create_pool;
#[allow(unused_imports)]
pub use error::ApiError;
#[allow(unused_imports)]
pub use middleware::{
    require_admin_helper, require_any_permission_helper, require_auth, require_permission_helper,
    require_super_admin_helper,
};
