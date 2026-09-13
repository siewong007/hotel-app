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
    /// Optional AES-256 key material for TOTP secrets at rest (L4). Absent =
    /// plaintext storage (legacy behaviour).
    pub totp_encryption_key: Option<String>,
    pub paypal: PaypalConfig,
    pub bank_details: BankDetails,
    pub turnstile: TurnstileConfig,
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

/// Cloudflare Turnstile bot-protection configuration for the public,
/// unauthenticated auth surfaces (login and registration).
///
/// Both halves come from the Cloudflare dashboard and are NOT interchangeable:
/// the site key is public by design (it ships inside the page HTML and is also
/// baked into the frontend image as `VITE_TURNSTILE_SITE_KEY`), while the
/// secret key never leaves this process — it is the only thing that makes the
/// `siteverify` call trustworthy. A deployment that sets them to the same value
/// has copied one over the other and is not protected; `is_configured` rejects
/// that outright rather than letting siteverify fail closed on every login.
#[derive(Debug, Clone)]
pub struct TurnstileConfig {
    pub enabled: bool,
    /// Held by the backend only so `keys_are_identical` can catch the
    /// site-key-pasted-over-the-secret mistake at startup. The browser gets its
    /// copy from `VITE_TURNSTILE_SITE_KEY`, baked into the frontend image.
    pub site_key: Option<String>,
    pub secret_key: Option<String>,
    /// Cloudflare's verification endpoint. Overridable so tests can point at a
    /// local stub without reaching the network.
    pub verify_url: String,
}

impl TurnstileConfig {
    pub const DEFAULT_VERIFY_URL: &'static str =
        "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    fn from_env() -> Result<Self, String> {
        let config = Self {
            enabled: env_bool("TURNSTILE_ENABLED", false)?,
            site_key: env_opt("TURNSTILE_SITE_KEY"),
            secret_key: env_opt("TURNSTILE_SECRET_KEY"),
            verify_url: env_or_string("TURNSTILE_VERIFY_URL", Self::DEFAULT_VERIFY_URL)?
                .trim()
                .to_string(),
        };
        if config.enabled && config.keys_are_identical() {
            return Err(
                "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must not be the same value —                  Cloudflare issues two distinct keys per widget"
                    .to_string(),
            );
        }
        Ok(config)
    }

    fn trimmed(value: &Option<String>) -> Option<&str> {
        value.as_deref().map(str::trim).filter(|v| !v.is_empty())
    }

    /// True when the same string was supplied for both keys — the single most
    /// likely operator mistake, and one that silently disables the protection.
    pub fn keys_are_identical(&self) -> bool {
        match (
            Self::trimmed(&self.site_key),
            Self::trimmed(&self.secret_key),
        ) {
            (Some(site), Some(secret)) => site == secret,
            _ => false,
        }
    }

    /// True only when the challenge is turned on AND both distinct keys exist.
    pub fn is_configured(&self) -> bool {
        self.enabled
            && Self::trimmed(&self.site_key).is_some()
            && Self::trimmed(&self.secret_key).is_some()
            && !self.keys_are_identical()
    }

    /// The secret used to sign the `siteverify` call, only when usable.
    pub fn active_secret(&self) -> Option<&str> {
        if self.is_configured() {
            Self::trimmed(&self.secret_key)
        } else {
            None
        }
    }
}

/// Hotel bank-transfer display details shown to guests choosing the manual
/// bank-transfer payment path. Always configured (env with general defaults);
/// a follow-up may move these into `system_settings` with an admin editor.
#[derive(Debug, Clone)]
pub struct BankDetails {
    pub bank_name: String,
    pub account_name: String,
    pub account_number: String,
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
            totp_encryption_key: env_opt("TOTP_ENCRYPTION_KEY"),
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
                bank_name: env_or_nonempty("HOTEL_BANK_NAME", "Maybank")?,
                account_name: env_or_nonempty("HOTEL_BANK_ACCOUNT_NAME", "Salim Inn")?,
                account_number: env_or_nonempty("HOTEL_BANK_ACCOUNT_NUMBER", "511270052595")?,
            },
            turnstile: TurnstileConfig::from_env()?,
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
        // Turnstile is the only bot control in front of login and registration;
        // IP rate limiting alone does not survive a distributed credential stuffing
        // run. Half-configured is worse than off, because the operator believes
        // they are covered — so refuse to boot rather than serve an open door.
        if self.turnstile.enabled && !self.turnstile.is_configured() {
            return Err(
                "TURNSTILE_ENABLED is true but TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY are \
                 missing or identical"
                    .to_string(),
            );
        }
        // Without this key TOTP seeds are stored in plaintext (the fallback
        // exists so dev and pre-key deployments keep booting). In production a
        // database leak must not hand out live second factors — refuse to boot.
        if crate::core::auth::AuthService::totp_encryption_key_from_config(
            self.totp_encryption_key.clone(),
        )
        .is_none()
        {
            return Err(
                "TOTP_ENCRYPTION_KEY must be set to base64/hex of 32 bytes, or an ASCII \
                 string of at least 32 characters, in production"
                    .to_string(),
            );
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
fn env_or_nonempty(key: &str, default: &str) -> Result<String, String> {
    match env_opt(key) {
        Some(value) if !value.trim().is_empty() => Ok(value),
        _ => Ok(default.to_string()),
    }
}

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
    use super::{
        AllowedOrigins, Environment, TurnstileConfig, parse_allowed_origins, validate_jwt_secret,
    };

    fn turnstile(site: Option<&str>, secret: Option<&str>, enabled: bool) -> TurnstileConfig {
        TurnstileConfig {
            enabled,
            site_key: site.map(str::to_string),
            secret_key: secret.map(str::to_string),
            verify_url: TurnstileConfig::DEFAULT_VERIFY_URL.to_string(),
        }
    }

    #[test]
    fn turnstile_rejects_identical_site_and_secret_keys() {
        // The exact operator mistake this guard exists for: one key pasted into
        // both variables. Without it the widget renders and every siteverify
        // call fails with invalid-input-secret, locking out real users.
        let same = "0x4AAAAAAEuac28XgcpK8ydqMDHjXde-4_M";
        let config = turnstile(Some(same), Some(same), true);
        assert!(config.keys_are_identical());
        assert!(!config.is_configured());
        assert_eq!(config.active_secret(), None);
    }

    #[test]
    fn turnstile_ignores_surrounding_whitespace_when_comparing_keys() {
        let config = turnstile(Some(" dup "), Some("dup"), true);
        assert!(config.keys_are_identical());
        assert!(!config.is_configured());
    }

    #[test]
    fn turnstile_is_configured_with_two_distinct_keys() {
        let config = turnstile(Some("site-key"), Some("secret-key"), true);
        assert!(!config.keys_are_identical());
        assert!(config.is_configured());
        assert_eq!(config.active_secret(), Some("secret-key"));
    }

    #[test]
    fn turnstile_disabled_never_verifies_even_with_valid_keys() {
        let config = turnstile(Some("site-key"), Some("secret-key"), false);
        assert!(!config.is_configured());
        assert_eq!(config.active_secret(), None);
    }

    #[test]
    fn turnstile_half_configured_is_not_configured() {
        assert!(!turnstile(Some("site-key"), None, true).is_configured());
        assert!(!turnstile(None, Some("secret-key"), true).is_configured());
        assert!(!turnstile(Some("site-key"), Some("  "), true).is_configured());
    }

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

    fn production_config(totp_key: Option<&str>) -> super::AppConfig {
        use super::{AppConfig, BankDetails, DatabaseConfig, LogLevelConfig, PaypalConfig};
        AppConfig {
            database: DatabaseConfig {
                acquire_timeout_secs: 30,
                idle_timeout_secs: 60,
                max_connections: 10,
                max_lifetime_secs: 3600,
                min_connections: 1,
                slow_statement_ms: 500,
                url: "postgres://localhost/test".to_string(),
            },
            allowed_origins: AllowedOrigins::List(vec![axum::http::HeaderValue::from_static(
                "https://hotel.example.com",
            )]),
            backend_port: 3030,
            desktop_mode: false,
            environment: Environment::Production,
            google_client_id: None,
            hotel_log_dir: None,
            jwt_secret: "x".repeat(32),
            jwt_issuer: "test".to_string(),
            jwt_audience: "test".to_string(),
            passkey_rp_id: "hotel.example.com".to_string(),
            rbac_cache_ttl_secs: 60,
            rust_log: LogLevelConfig::Info,
            settings_cache_ttl_secs: 60,
            skip_email_verification: false,
            trust_proxy_headers: false,
            totp_encryption_key: totp_key.map(str::to_string),
            paypal: PaypalConfig {
                enabled: false,
                client_id: None,
                client_secret: None,
                api_base: String::new(),
                webhook_id: None,
            },
            bank_details: BankDetails {
                bank_name: "b".to_string(),
                account_name: "a".to_string(),
                account_number: "n".to_string(),
            },
            turnstile: turnstile(None, None, false),
        }
    }

    #[test]
    fn production_requires_totp_encryption_key() {
        // Without the key, TOTP seeds persist as plaintext — the fallback exists
        // for dev only. Production must refuse to boot rather than silently
        // store live second factors unencrypted.
        let missing = production_config(None).validate_security();
        assert!(missing.is_err());
        assert!(missing.unwrap_err().contains("TOTP_ENCRYPTION_KEY"));

        let malformed = production_config(Some("too-short")).validate_security();
        assert!(malformed.is_err());
    }

    #[test]
    fn production_accepts_valid_totp_encryption_key() {
        let ascii = production_config(Some("a-32-plus-character-ascii-secret!!"));
        assert!(ascii.validate_security().is_ok());

        let hex_key = "ab".repeat(32);
        let hexed = production_config(Some(&hex_key));
        assert!(hexed.validate_security().is_ok());
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
