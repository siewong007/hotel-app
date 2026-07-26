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
pub mod db;
pub mod error;
pub mod metrics;
pub mod middleware;
pub mod rate_limiter;
pub mod rbac_cache;
pub mod settings_cache;
pub mod sql_compat;

// Re-export commonly used types. `main.rs` re-declares every module, so the bin
// recompiles this crate without ever going through these re-exports; the lib
// target (and `tests/`, which link it) are the real consumers, which is why the
// bin compile reports several of them unused.
#[allow(unused_imports)]
pub use auth::{AuthService, Claims};
pub use config::AppConfig;
pub use db::create_pool;
#[allow(unused_imports)]
pub use error::ApiError;
#[allow(unused_imports)]
pub use middleware::{
    ensure_super_admin, require_any_permission_helper, require_auth, require_permission_helper,
};
