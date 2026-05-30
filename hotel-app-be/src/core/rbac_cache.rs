//! In-memory cache for the per-request RBAC permission/role lookups.
//!
//! `check_permission` runs on nearly every authenticated request, but the
//! underlying `roles` / `permissions` / `user_roles` / `role_permissions` data
//! changes only when an admin edits RBAC. We therefore resolve each user's
//! permission- and role-name sets once, cache them for a short TTL, and answer
//! membership checks from memory — turning a 3-table join per request into an
//! occasional one.
//!
//! Correctness: the RBAC mutation handlers in [`crate::handlers::rbac`] call
//! [`invalidate_all`] after a successful change, so revocations take effect
//! immediately. The TTL (`RBAC_CACHE_TTL_SECS`, default 30s) only bounds drift
//! from out-of-band database edits.
//!
//! Single-process design (mirrors [`crate::core::rate_limiter`]): a
//! process-global cache keeps the `AuthService::check_permission` /
//! `check_role` signatures unchanged at their many call sites.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use super::db::DbPool;

/// A user's resolved permission-name and role-name sets, shared cheaply via `Arc`.
type RbacSets = (Arc<HashSet<String>>, Arc<HashSet<String>>);

static CACHE: LazyLock<RbacCache> = LazyLock::new(RbacCache::new);

fn configured_ttl() -> Duration {
    let secs = std::env::var("RBAC_CACHE_TTL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);
    Duration::from_secs(secs)
}

/// A user's resolved RBAC sets plus when they were loaded.
struct CachedUser {
    loaded_at: Instant,
    permissions: Arc<HashSet<String>>,
    roles: Arc<HashSet<String>>,
}

struct RbacCache {
    entries: Mutex<HashMap<i64, CachedUser>>,
    ttl: Duration,
}

impl RbacCache {
    fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            ttl: configured_ttl(),
        }
    }

    /// Return the cached (permissions, roles) for a user if still fresh.
    fn get(&self, user_id: i64) -> Option<RbacSets> {
        let map = self.entries.lock().unwrap();
        let entry = map.get(&user_id)?;
        if entry.loaded_at.elapsed() < self.ttl {
            Some((entry.permissions.clone(), entry.roles.clone()))
        } else {
            None
        }
    }

    fn store(
        &self,
        user_id: i64,
        permissions: Arc<HashSet<String>>,
        roles: Arc<HashSet<String>>,
    ) {
        let mut map = self.entries.lock().unwrap();
        map.insert(
            user_id,
            CachedUser {
                loaded_at: Instant::now(),
                permissions,
                roles,
            },
        );
    }
}

/// Resolve `(permissions, roles)` name sets for a user, loading from the
/// database on a cache miss and caching both together. The DB load happens
/// outside the cache lock, so concurrent misses simply each load once.
async fn resolve(pool: &DbPool, user_id: i64) -> Result<RbacSets, sqlx::Error> {
    if let Some(hit) = CACHE.get(user_id) {
        return Ok(hit);
    }

    // `$1` placeholder syntax is accepted by both PostgreSQL and SQLite, so this
    // compiles and runs under either backend (matching AuthService's own SQL).
    let permissions: HashSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT p.name \
         FROM permissions p \
         INNER JOIN role_permissions rp ON p.id = rp.permission_id \
         INNER JOIN user_roles ur ON rp.role_id = ur.role_id \
         WHERE ur.user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    let roles: HashSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT r.name \
         FROM roles r \
         INNER JOIN user_roles ur ON r.id = ur.role_id \
         WHERE ur.user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    let permissions = Arc::new(permissions);
    let roles = Arc::new(roles);
    CACHE.store(user_id, permissions.clone(), roles.clone());
    Ok((permissions, roles))
}

/// True if the user holds `permission` or the implied `<resource>:manage`.
pub async fn has_permission(
    pool: &DbPool,
    user_id: i64,
    permission: &str,
) -> Result<bool, sqlx::Error> {
    let manage = permission
        .split_once(':')
        .map(|(resource, _)| format!("{resource}:manage"));
    let (permissions, _roles) = resolve(pool, user_id).await?;
    Ok(permissions.contains(permission) || manage.is_some_and(|m| permissions.contains(&m)))
}

/// True if the user holds `role_name`.
pub async fn has_role(pool: &DbPool, user_id: i64, role_name: &str) -> Result<bool, sqlx::Error> {
    let (_permissions, roles) = resolve(pool, user_id).await?;
    Ok(roles.contains(role_name))
}

/// Drop all cached entries. Call after any RBAC mutation so changes apply
/// immediately rather than after the TTL.
pub fn invalidate_all() {
    CACHE.entries.lock().unwrap().clear();
}

/// Drop a single user's cached entry.
#[allow(dead_code)]
pub fn invalidate_user(user_id: i64) {
    CACHE.entries.lock().unwrap().remove(&user_id);
}

#[cfg(test)]
mod tests {
    #[test]
    fn manage_permission_is_derived_from_resource() {
        // Sanity-check the resource:manage derivation used by has_permission.
        let permission = "bookings:read";
        let manage = permission
            .split_once(':')
            .map(|(resource, _)| format!("{resource}:manage"));
        assert_eq!(manage.as_deref(), Some("bookings:manage"));
    }
}
