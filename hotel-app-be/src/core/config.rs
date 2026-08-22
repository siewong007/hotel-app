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
    pub environment: Environment,
    pub google_client_id: Option<String>,
    pub hotel_log_dir: Option<PathBuf>,
    pub jwt_secret: String,
    pub jwt_issuer: String,
    pub jwt_audience: String,
    pub passkey_rp_id: String,
    pub rbac_cache_ttl_secs: u64,
    pub rust_log: LogLevelConfig,
    pub settings_cache_ttl_secs: u64,
    pub skip_email_verification: bool,
    pub trust_proxy_headers: bool,
    pub paypal: PaypalConfig,
    pub bank_details: BankDetails,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Staging,
    Production,
}

impl Environment {
    fn from_env() -> Result<Self, String> {
        let value = std::env::var("APP_ENV")
            .or_else(|_| std::env::var("ENVIRONMENT"))
            .unwrap_or_else(|_| "development".to_string());

        Self::from_env_value(&value)
    }

    fn from_env_value(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "development" | "dev" => Ok(Self::Development),
            "staging" => Ok(Self::Staging),
            "production" | "prod" => Ok(Self::Production),
            _ => Err("APP_ENV must be development, staging, or production".to_string()),
        }
    }
}

/// PayPal REST API configuration. Scaffolded against PayPal's real sandbox API
/// (`https://api-m.sandbox.paypal.com` by default). Disabled unless
/// `PAYPAL_ENABLED=true` and both client id + secret are present; when disabled
/// the PayPal endpoints return a clear 503 rather than fabricating a gateway.
#[derive(Debug, Clone)]
pub struct PaypalConfig {
    pub enabled: bool,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub api_base: String,
    /// Webhook id from the PayPal developer dashboard; required input to the
    /// verify-webhook-signature call that authenticates `/api/webhooks/paypal`
    /// deliveries. When absent, the webhook endpoint refuses events (503).
    pub webhook_id: Option<String>,
}

impl PaypalConfig {
    /// True only when the integration is turned on AND fully credentialed.
    pub fn is_configured(&self) -> bool {
        self.enabled
            && self
                .client_id
                .as_deref()
                .is_some_and(|v| !v.trim().is_empty())
            && self
                .client_secret
                .as_deref()
                .is_some_and(|v| !v.trim().is_empty())
    }

    /// The client id safe to expose to the browser (public by design), only
    /// when the integration is actually configured.
    pub fn public_client_id(&self) -> Option<String> {
        if self.is_configured() {
            self.client_id.clone()
        } else {
            None
        }
    }
}

/// Hotel bank-transfer display details shown to guests choosing the manual
/// bank-transfer payment path. Sourced from env for this pass; a follow-up
/// moves these into `system_settings` with an admin editor.
#[derive(Debug, Clone)]
pub struct BankDetails {
    pub bank_name: Option<String>,
    pub account_name: Option<String>,
    pub account_number: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub acquire_timeout_secs: u64,
    pub idle_timeout_secs: u64,
    pub max_connections: u32,
    pub max_lifetime_secs: u64,
    pub min_connections: u32,
    pub slow_statement_ms: u64,
    pub url: String,
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

        let config = Self {
            database: DatabaseConfig::from_env()?,
            allowed_origins: parse_allowed_origins(&env_or_string(
                "ALLOWED_ORIGINS",
                "http://localhost:3000,http://localhost:5173",
            )?)?,
            backend_port: env_or_parse("BACKEND_PORT", 3030)?,
            desktop_mode,
            environment: Environment::from_env()?,
            google_client_id: env_opt("GOOGLE_CLIENT_ID"),
            hotel_log_dir: std::env::var("HOTEL_LOG_DIR").ok().map(PathBuf::from),
            jwt_secret,
            jwt_issuer: env_or_string("JWT_ISSUER", "hotel-app-be")?,
            jwt_audience: env_or_string("JWT_AUDIENCE", "hotel-web")?,
            passkey_rp_id: env_or_string("PASSKEY_RP_ID", "localhost")?,
            rbac_cache_ttl_secs: env_or_parse("RBAC_CACHE_TTL_SECS", 30)?,
            rust_log: LogLevelConfig::from_env_value(std::env::var("RUST_LOG").ok().as_deref()),
            settings_cache_ttl_secs: env_or_parse("SETTINGS_CACHE_TTL_SECS", 30)?,
            skip_email_verification: env_bool("SKIP_EMAIL_VERIFICATION", false)?,
            trust_proxy_headers: env_bool("TRUST_PROXY_HEADERS", false)?,
            paypal: PaypalConfig {
                enabled: env_bool("PAYPAL_ENABLED", false)?,
                client_id: env_opt("PAYPAL_CLIENT_ID"),
                client_secret: env_opt("PAYPAL_CLIENT_SECRET"),
                api_base: env_or_string("PAYPAL_API_BASE", "https://api-m.sandbox.paypal.com")?
                    .trim_end_matches('/')
                    .to_string(),
                webhook_id: env_opt("PAYPAL_WEBHOOK_ID"),
            },
            bank_details: BankDetails {
                bank_name: env_opt("HOTEL_BANK_NAME"),
                account_name: env_opt("HOTEL_BANK_ACCOUNT_NAME"),
                account_number: env_opt("HOTEL_BANK_ACCOUNT_NUMBER"),
            },
        };
        config.validate_security()?;
        Ok(config)
    }

    fn validate_security(&self) -> Result<(), String> {
        if self.desktop_mode || self.environment != Environment::Production {
            return Ok(());
        }

        if matches!(self.allowed_origins, AllowedOrigins::Any) {
            return Err("ALLOWED_ORIGINS must not be '*' in production".to_string());
        }
        if let AllowedOrigins::List(origins) = &self.allowed_origins {
            for origin in origins {
                let origin = origin
                    .to_str()
                    .map_err(|_| "ALLOWED_ORIGINS contains a non-text origin")?;
                if !origin.starts_with("https://") || origin.contains("localhost") {
                    return Err(
                        "ALLOWED_ORIGINS must contain only non-localhost HTTPS origins in production"
                            .to_string(),
                    );
                }
            }
        }
        if self.skip_email_verification {
            return Err("SKIP_EMAIL_VERIFICATION must be false in production".to_string());
        }
        if self.passkey_rp_id == "localhost" {
            return Err("PASSKEY_RP_ID must be a production domain in production".to_string());
        }
        Ok(())
    }
}

impl DatabaseConfig {
    fn from_env() -> Result<Self, String> {
        Ok(Self {
            acquire_timeout_secs: env_or_parse("DATABASE_ACQUIRE_TIMEOUT_SECS", 30)?,
            idle_timeout_secs: env_or_parse("DATABASE_IDLE_TIMEOUT_SECS", 600)?,
            max_connections: env_or_parse("DATABASE_MAX_CONNECTIONS", default_max_connections())?,
            max_lifetime_secs: env_or_parse("DATABASE_MAX_LIFETIME_SECS", 1800)?,
            min_connections: env_or_parse("DATABASE_MIN_CONNECTIONS", 0)?,
            slow_statement_ms: env_or_parse("DATABASE_SLOW_STATEMENT_MS", 500)?,
            url: required_env("DATABASE_URL")?,
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

/// Secrets that pass a length check but are publicly known placeholders.
/// The root compose file used to default JWT_SECRET to the CHANGE_ME literal
/// below (62 chars — it sailed past the length rule), so anyone who read the
/// repo could forge tokens for any user in such a deployment. The compose
/// files now use the `:?` required form; this blocklist is the second lock.
const FORBIDDEN_SECRET_PREFIXES: [&str; 2] = ["CHANGE_ME", "REPLACE_WITH"];

pub fn validate_jwt_secret(secret: &str) -> Result<(), String> {
    if secret.len() < MIN_JWT_SECRET_LEN {
        return Err(format!(
            "JWT_SECRET must be at least {} characters long",
            MIN_JWT_SECRET_LEN
        ));
    }
    for prefix in FORBIDDEN_SECRET_PREFIXES {
        if secret.starts_with(prefix) {
            return Err(format!(
                "JWT_SECRET must not use the publicly-known placeholder prefix '{prefix}'"
            ));
        }
    }

    Ok(())
}

fn default_max_connections() -> u32 {
    20
}

fn env_present(key: &str) -> bool {
    std::env::var_os(key).is_some()
}

fn required_env(key: &str) -> Result<String, String> {
    std::env::var(key).map_err(|_| format!("{key} must be set"))
}

/// Read an optional env var, treating empty/whitespace-only as absent.
fn env_opt(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
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
    use super::{AllowedOrigins, Environment, parse_allowed_origins, validate_jwt_secret};

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

    #[test]
    fn environment_parses_supported_names() {
        assert_eq!(
            Environment::Development,
            Environment::from_env_value("development").unwrap()
        );
        assert_eq!(
            Environment::Staging,
            Environment::from_env_value("staging").unwrap()
        );
        assert_eq!(
            Environment::Production,
            Environment::from_env_value("production").unwrap()
        );
        assert!(Environment::from_env_value("preview").is_err());
    }
}
