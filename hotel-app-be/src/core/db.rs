use super::config::DatabaseConfig;
use sqlx::Row;

pub type DbPool = sqlx::PgPool;
pub type DbRow = sqlx::postgres::PgRow;
pub type DbDatabase = sqlx::Postgres;
pub type DbTransaction<'c> = sqlx::Transaction<'c, DbDatabase>;

/// Create the application's PostgreSQL connection pool.
pub async fn create_pool(config: &DatabaseConfig) -> Result<DbPool, sqlx::Error> {
    use sqlx::ConnectOptions;
    use sqlx::Executor;
    use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
    use std::str::FromStr;
    use std::time::Duration;

    log::info!("Connecting to PostgreSQL database");

    let connect_opts = PgConnectOptions::from_str(&config.url)?.log_slow_statements(
        log::LevelFilter::Warn,
        Duration::from_millis(config.slow_statement_ms),
    );

    PgPoolOptions::new()
        .max_connections(config.max_connections)
        .min_connections(config.min_connections)
        .acquire_timeout(Duration::from_secs(config.acquire_timeout_secs))
        .idle_timeout(Duration::from_secs(config.idle_timeout_secs))
        .max_lifetime(Duration::from_secs(config.max_lifetime_secs))
        .test_before_acquire(false)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                let tz: Option<String> =
                    sqlx::query_scalar("SELECT value FROM system_settings WHERE key = 'timezone'")
                        .fetch_optional(&mut *conn)
                        .await?;
                let tz = tz.unwrap_or_else(|| "UTC".to_string());
                if !tz
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '/' || c == '_' || c == '+' || c == '-')
                {
                    log::warn!("Invalid timezone value in system_settings: {}", tz);
                    conn.execute("SET timezone = 'UTC'").await?;
                } else {
                    conn.execute(format!("SET timezone = '{}'", tz).as_str())
                        .await?;
                }
                Ok(())
            })
        })
        .connect_with(connect_opts)
        .await
}

/// Generate a time-ordered UUIDv7 string for application-generated identifiers.
pub fn generate_uuid() -> String {
    uuid::Uuid::now_v7().to_string()
}

pub fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn array_to_json<T: serde::Serialize>(arr: &[T]) -> String {
    serde_json::to_string(arr).unwrap_or_else(|_| "[]".to_string())
}

pub fn json_to_array<T: serde::de::DeserializeOwned>(json: &str) -> Vec<T> {
    serde_json::from_str(json).unwrap_or_default()
}

pub fn decimal_to_db(d: rust_decimal::Decimal) -> rust_decimal::Decimal {
    d
}

pub fn opt_decimal_to_db(d: Option<rust_decimal::Decimal>) -> Option<rust_decimal::Decimal> {
    d
}

pub trait DbRowExt {
    fn get_decimal(&self, index: usize) -> rust_decimal::Decimal;
    fn get_opt_decimal(&self, index: usize) -> Option<rust_decimal::Decimal>;
}

impl DbRowExt for DbRow {
    fn get_decimal(&self, index: usize) -> rust_decimal::Decimal {
        self.get::<rust_decimal::Decimal, _>(index)
    }

    fn get_opt_decimal(&self, index: usize) -> Option<rust_decimal::Decimal> {
        self.get::<Option<rust_decimal::Decimal>, _>(index)
    }
}

pub fn parse_decimal(s: &str) -> rust_decimal::Decimal {
    s.parse().unwrap_or_default()
}

pub fn parse_opt_decimal(s: Option<String>) -> Option<rust_decimal::Decimal> {
    s.and_then(|v| v.parse().ok())
}

pub fn f64_to_decimal(f: f64) -> rust_decimal::Decimal {
    rust_decimal::Decimal::from_f64_retain(f).unwrap_or_default()
}

pub fn opt_f64_to_decimal(f: Option<f64>) -> Option<rust_decimal::Decimal> {
    f.and_then(rust_decimal::Decimal::from_f64_retain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct TestCode {
        code: String,
    }

    #[test]
    fn array_json_helpers_round_trip_serializable_values() {
        let values = vec![
            TestCode {
                code: "ABCD-1234".to_string(),
            },
            TestCode {
                code: "WXYZ-9876".to_string(),
            },
        ];
        let json = array_to_json(&values);
        let decoded: Vec<TestCode> = json_to_array(&json);
        assert_eq!(decoded, values);
    }

    #[test]
    fn json_to_array_returns_empty_vec_for_invalid_json() {
        let decoded: Vec<String> = json_to_array("not json");
        assert!(decoded.is_empty());
    }

    #[test]
    fn decimal_parsers_fall_back_safely_for_invalid_values() {
        assert_eq!(parse_decimal("12.34"), Decimal::new(1234, 2));
        assert_eq!(parse_decimal("not-a-decimal"), Decimal::ZERO);
        assert_eq!(
            parse_opt_decimal(Some("9.99".to_string())),
            Some(Decimal::new(999, 2))
        );
        assert_eq!(parse_opt_decimal(Some("invalid".to_string())), None);
        assert_eq!(parse_opt_decimal(None), None);
    }

    #[test]
    fn float_decimal_helpers_preserve_valid_values_and_ignore_none() {
        assert_eq!(f64_to_decimal(12.5), Decimal::new(125, 1));
        assert_eq!(opt_f64_to_decimal(Some(1.25)), Some(Decimal::new(125, 2)));
        assert_eq!(opt_f64_to_decimal(None), None);
    }

    #[test]
    fn generate_uuid_returns_parseable_uuid_string() {
        assert!(uuid::Uuid::parse_str(&generate_uuid()).is_ok());
    }
}
