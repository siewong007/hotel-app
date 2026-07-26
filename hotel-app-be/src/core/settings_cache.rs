//! Small TTL cache for `system_settings` reads used in request hot paths.
//!
//! Settings are hotel-facing runtime values, so they live in the database. This
//! cache keeps repeated reads like login limits and tax rates from issuing SQL
//! on every request while still allowing admin changes to take effect quickly.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use rust_decimal::Decimal;

use super::{config, db::DbPool};

static CACHE: LazyLock<SettingsCache> = LazyLock::new(SettingsCache::new);

struct CachedSetting {
    loaded_at: Instant,
    value: Option<String>,
}

struct SettingsCache {
    entries: Mutex<HashMap<String, CachedSetting>>,
    ttl: Duration,
}

impl SettingsCache {
    fn new() -> Self {
        let ttl_secs = config::try_get()
            .map(|config| config.settings_cache_ttl_secs)
            .unwrap_or(30);

        Self {
            entries: Mutex::new(HashMap::new()),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    fn get(&self, key: &str) -> Option<Option<String>> {
        let map = self.entries.lock().unwrap();
        let entry = map.get(key)?;
        if entry.loaded_at.elapsed() < self.ttl {
            Some(entry.value.clone())
        } else {
            None
        }
    }

    fn store(&self, key: &str, value: Option<String>) {
        let mut map = self.entries.lock().unwrap();
        map.insert(
            key.to_string(),
            CachedSetting {
                loaded_at: Instant::now(),
                value,
            },
        );
    }
}

async fn get_optional_string(pool: &DbPool, key: &str) -> Option<String> {
    if let Some(cached) = CACHE.get(key) {
        return cached;
    }

    let value =
        sqlx::query_scalar::<_, Option<String>>("SELECT value FROM system_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .flatten();

    CACHE.store(key, value.clone());
    value
}

pub async fn get_string(pool: &DbPool, key: &str, default: &str) -> String {
    get_optional_string(pool, key)
        .await
        .and_then(|value| {
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_string())
        })
        .unwrap_or_else(|| default.to_string())
}

pub async fn get_i32(pool: &DbPool, key: &str, default: i32) -> i32 {
    get_optional_string(pool, key)
        .await
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(default)
}

pub async fn get_decimal(pool: &DbPool, key: &str, default: Decimal) -> Decimal {
    get_optional_string(pool, key)
        .await
        .and_then(|value| value.parse::<Decimal>().ok())
        .unwrap_or(default)
}

pub async fn get_positive_i32(pool: &DbPool, key: &str, default: i32) -> i32 {
    let value = get_i32(pool, key, default).await;
    if value > 0 { value } else { default }
}

pub async fn get_positive_decimal(pool: &DbPool, key: &str, default: Decimal) -> Decimal {
    let value = get_decimal(pool, key, default).await;
    if value > Decimal::ZERO {
        value
    } else {
        default
    }
}

pub fn invalidate_key(key: &str) {
    CACHE.entries.lock().unwrap().remove(key);
}

