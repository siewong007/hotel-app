//! Startup configuration loaded from environment variables.
//!
//! Keep infrastructure and secrets here. Hotel-facing runtime settings belong in
//! `system_settings` and should be read through the settings cache.

use axum::http::HeaderValue;
use std::path::PathBuf;
use std::sync::OnceLock;

const MIN_JWT_SECRET_LEN: usize = 32;

static CONFIG: OnceLock<AppConfig> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub database: DatabaseConfig,
    pub allowed_origins: AllowedOrigins,
    pub backend_port: u16,
    pub desktop_mode: bool,
    pub hotel_log_dir: Option<PathBuf>,
    pub jwt_secret: String,
    pub passkey_rp_id: String,
    pub rbac_cache_ttl_secs: u64,
    pub rust_log: LogLevelConfig,
    pub settings_cache_ttl_secs: u64,
    pub skip_email_verification: bool,
    pub trust_proxy_headers: bool,
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub acquire_timeout_secs: u64,
    #[allow(dead_code)]
    pub busy_timeout_secs: u64,
    #[cfg_attr(all(feature = "sqlite", not(feature = "postgres")), allow(dead_code))]
    pub idle_timeout_secs: u64,
    pub max_connections: u32,
    #[cfg_attr(all(feature = "sqlite", not(feature = "postgres")), allow(dead_code))]
    pub max_lifetime_secs: u64,
    pub min_connections: u32,
    pub slow_statement_ms: u64,
    #[allow(dead_code)]
    pub sqlite_path: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone)]
pub enum AllowedOrigins {
    Any,
    List(Vec<HeaderValue>),
}

#[derive(Debug, Clone, Copy)]
pub enum LogLevelConfig {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        let desktop_mode = env_present("HOTEL_DESKTOP_MODE");
        let jwt_secret = required_env("JWT_SECRET")?;
        validate_jwt_secret(&jwt_secret)?;

        Ok(Self {
            database: DatabaseConfig::from_env()?,
            allowed_origins: parse_allowed_origins(&env_or_string(
                "ALLOWED_ORIGINS",
                "http://localhost:3000,http://localhost:5173",
            )?)?,
            backend_port: env_or_parse("BACKEND_PORT", 3030)?,
            desktop_mode,
            hotel_log_dir: std::env::var("HOTEL_LOG_DIR").ok().map(PathBuf::from),
            jwt_secret,
            passkey_rp_id: env_or_string("PASSKEY_RP_ID", "localhost")?,
            rbac_cache_ttl_secs: env_or_parse("RBAC_CACHE_TTL_SECS", 30)?,
            rust_log: LogLevelConfig::from_env_value(std::env::var("RUST_LOG").ok().as_deref()),
            settings_cache_ttl_secs: env_or_parse("SETTINGS_CACHE_TTL_SECS", 30)?,
            skip_email_verification: env_bool("SKIP_EMAIL_VERIFICATION", false)?,
            trust_proxy_headers: env_bool("TRUST_PROXY_HEADERS", false)?,
        })
    }
}

impl DatabaseConfig {
    fn from_env() -> Result<Self, String> {
        Ok(Self {
            acquire_timeout_secs: env_or_parse("DATABASE_ACQUIRE_TIMEOUT_SECS", 30)?,
            busy_timeout_secs: env_or_parse("DATABASE_BUSY_TIMEOUT_SECS", 10)?,
            idle_timeout_secs: env_or_parse("DATABASE_IDLE_TIMEOUT_SECS", 600)?,
            max_connections: env_or_parse("DATABASE_MAX_CONNECTIONS", default_max_connections())?,
            max_lifetime_secs: env_or_parse("DATABASE_MAX_LIFETIME_SECS", 1800)?,
            min_connections: env_or_parse("DATABASE_MIN_CONNECTIONS", 0)?,
            slow_statement_ms: env_or_parse("DATABASE_SLOW_STATEMENT_MS", 500)?,
            sqlite_path: env_or_string("DATABASE_PATH", "./hotel_data.db")?,
            url: database_url_from_env()?,
        })
    }
}

impl LogLevelConfig {
    pub fn as_level_filter(self) -> simplelog::LevelFilter {
        match self {
            Self::Trace => simplelog::LevelFilter::Trace,
            Self::Debug => simplelog::LevelFilter::Debug,
            Self::Info => simplelog::LevelFilter::Info,
            Self::Warn => simplelog::LevelFilter::Warn,
            Self::Error => simplelog::LevelFilter::Error,
        }
    }

    fn from_env_value(value: Option<&str>) -> Self {
        match value {
            Some("trace") => Self::Trace,
            Some("debug") => Self::Debug,
            Some("warn") => Self::Warn,
            Some("error") => Self::Error,
            _ => Self::Info,
        }
    }
}

pub fn init_from_env() -> Result<&'static AppConfig, String> {
    let config = AppConfig::from_env()?;
    let _ = CONFIG.set(config);
    CONFIG
        .get()
        .ok_or_else(|| "Application config failed to initialize".to_string())
}

pub fn get() -> &'static AppConfig {
    CONFIG
        .get()
        .expect("application config must be initialized at startup")
}

pub fn try_get() -> Option<&'static AppConfig> {
    CONFIG.get()
}

pub fn validate_jwt_secret(secret: &str) -> Result<(), String> {
    if secret.len() < MIN_JWT_SECRET_LEN {
        return Err(format!(
            "JWT_SECRET must be at least {} characters long",
            MIN_JWT_SECRET_LEN
        ));
    }

    Ok(())
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
fn database_url_from_env() -> Result<Option<String>, String> {
    Ok(std::env::var("DATABASE_URL").ok())
}

#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
fn database_url_from_env() -> Result<Option<String>, String> {
    required_env("DATABASE_URL").map(Some)
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
fn default_max_connections() -> u32 {
    5
}

#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
fn default_max_connections() -> u32 {
    20
}

fn env_present(key: &str) -> bool {
    std::env::var_os(key).is_some()
}

fn required_env(key: &str) -> Result<String, String> {
    std::env::var(key).map_err(|_| format!("{key} must be set"))
}

fn env_or_string(key: &str, default: &str) -> Result<String, String> {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        Ok(_) => Err(format!("{key} must not be empty")),
        Err(_) => Ok(default.to_string()),
    }
}

fn env_or_parse<T>(key: &str, default: T) -> Result<T, String>
where
    T: std::str::FromStr,
{
    match std::env::var(key) {
        Ok(value) => value
            .parse::<T>()
            .map_err(|_| format!("{key} has invalid value: {value}")),
        Err(_) => Ok(default),
    }
}

fn env_bool(key: &str, default: bool) -> Result<bool, String> {
    match std::env::var(key) {
        Ok(value) if value.eq_ignore_ascii_case("true") => Ok(true),
        Ok(value) if value.eq_ignore_ascii_case("false") => Ok(false),
        Ok(value) => Err(format!("{key} must be true or false, got: {value}")),
        Err(_) => Ok(default),
    }
}

fn parse_allowed_origins(value: &str) -> Result<AllowedOrigins, String> {
    if value.trim() == "*" {
        return Ok(AllowedOrigins::Any);
    }

    let origins: Result<Vec<_>, _> = value
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(|origin| {
            origin
                .parse::<HeaderValue>()
                .map_err(|_| format!("ALLOWED_ORIGINS contains invalid origin: {origin}"))
        })
        .collect();

    let origins = origins?;
    if origins.is_empty() {
        return Err("ALLOWED_ORIGINS must include at least one origin".to_string());
    }

    Ok(AllowedOrigins::List(origins))
}

#[cfg(test)]
mod tests {
    use super::{AllowedOrigins, parse_allowed_origins, validate_jwt_secret};

    #[test]
    fn jwt_secret_validation_enforces_minimum_length() {
        let short_secret = "too-short";
        let valid_secret = "x".repeat(32);

        assert!(validate_jwt_secret(short_secret).is_err());
        assert!(validate_jwt_secret(&valid_secret).is_ok());
    }

    #[test]
    fn allowed_origins_accepts_wildcard_or_header_values() {
        assert!(matches!(
            parse_allowed_origins("*").unwrap(),
            AllowedOrigins::Any
        ));

        let origins = parse_allowed_origins("http://localhost:3000,http://localhost:5173").unwrap();
        assert!(matches!(origins, AllowedOrigins::List(values) if values.len() == 2));
    }
}
