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

/// Today's business date as the database sees it.
///
/// Every pooled connection has its `timezone` set from `system_settings.timezone`
/// (see `create_pool`), so `CURRENT_DATE` is the hotel's business day rather than
/// the server OS's local day. Use this for any date math that ends up stored or
/// compared against `bookings`/`customer_ledgers` dates — never
/// `chrono::Local::now().date_naive()`.
///
/// Pass the pool (`&pool`) outside a transaction, or the transaction itself
/// (`&mut *tx`) inside one, so the date matches the rest of that unit of work.
pub async fn hotel_today<'e, E>(executor: E) -> Result<chrono::NaiveDate, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = DbDatabase>,
{
    sqlx::query_scalar("SELECT CURRENT_DATE")
        .fetch_one(executor)
        .await
}

/// Generate a time-ordered UUIDv7 string for application-generated identifiers.
pub fn generate_uuid() -> String {
    uuid::Uuid::now_v7().to_string()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_uuid_returns_parseable_uuid_string() {
        assert!(uuid::Uuid::parse_str(&generate_uuid()).is_ok());
    }
}
