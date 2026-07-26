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

use super::{config, db::DbPool};

/// A user's resolved permission-name and role-name sets, shared cheaply via `Arc`.
type RbacSets = (Arc<HashSet<String>>, Arc<HashSet<String>>);

static CACHE: LazyLock<RbacCache> = LazyLock::new(RbacCache::new);

fn configured_ttl() -> Duration {
    let secs = config::try_get()
        .map(|config| config.rbac_cache_ttl_secs)
        .unwrap_or(30);
    Duration::from_secs(secs)
}

/// The set of roles a user effectively holds.
///
/// Two sources, unioned: roles assigned directly, and roles conferred by every
/// active team they are a current member of. Both sides filter `expires_at`,
/// so a lapsed grant confers nothing — the column existed for a long time
/// without any query consulting it, which made every "temporary" role
/// permanent.
///
/// Defined once and shared with [`crate::core::auth::AuthService`]; the two
/// used to carry separate copies of this join, and a copy that drifts is an
/// authorization bug that nothing would catch.
pub(crate) const EFFECTIVE_ROLES_CTE: &str = "\
    WITH effective_roles AS ( \
        SELECT ur.role_id \
        FROM user_roles ur \
        WHERE ur.user_id = $1 \
          AND (ur.expires_at IS NULL OR ur.expires_at > CURRENT_TIMESTAMP) \
        UNION \
        SELECT tr.role_id \
        FROM team_roles tr \
        INNER JOIN team_members tm ON tm.team_id = tr.team_id \
        INNER JOIN teams t ON t.id = tm.team_id \
        WHERE tm.user_id = $1 \
          AND t.is_active \
          AND t.deleted_at IS NULL \
          AND (tm.expires_at IS NULL OR tm.expires_at > CURRENT_TIMESTAMP) \
    ) ";

/// Effective permission names for `$1`.
pub(crate) const EFFECTIVE_PERMISSIONS_SQL: &str = "\
    SELECT DISTINCT p.name \
    FROM permissions p \
    INNER JOIN role_permissions rp ON p.id = rp.permission_id \
    INNER JOIN effective_roles er ON er.role_id = rp.role_id";

/// Effective role names for `$1`.
pub(crate) const EFFECTIVE_ROLE_NAMES_SQL: &str = "\
    SELECT DISTINCT r.name \
    FROM roles r \
    INNER JOIN effective_roles er ON er.role_id = r.id";

/// The soonest instant at which any of `$1`'s grants lapses, so the cache
/// entry can be expired then rather than at the end of a fixed TTL.
const NEXT_GRANT_EXPIRY_SQL: &str = "\
    SELECT LEAST( \
        (SELECT MIN(ur.expires_at) FROM user_roles ur \
          WHERE ur.user_id = $1 AND ur.expires_at > CURRENT_TIMESTAMP), \
        (SELECT MIN(tm.expires_at) FROM team_members tm \
          WHERE tm.user_id = $1 AND tm.expires_at > CURRENT_TIMESTAMP) \
    )";

/// A user's resolved RBAC sets plus when they were loaded.
struct CachedUser {
    loaded_at: Instant,
    /// Shorter than the configured TTL when a grant lapses sooner, so an
    /// expiry takes effect at the stated time rather than up to a TTL late.
    ttl: Duration,
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
        if entry.loaded_at.elapsed() < entry.ttl {
            Some((entry.permissions.clone(), entry.roles.clone()))
        } else {
            None
        }
    }

    fn store(
        &self,
        user_id: i64,
        ttl: Duration,
        permissions: Arc<HashSet<String>>,
        roles: Arc<HashSet<String>>,
    ) {
        let mut map = self.entries.lock().unwrap();
        map.insert(
            user_id,
            CachedUser {
                loaded_at: Instant::now(),
                ttl,
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

    let permissions: HashSet<String> = sqlx::query_scalar::<_, String>(&format!(
        "{EFFECTIVE_ROLES_CTE}{EFFECTIVE_PERMISSIONS_SQL}"
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    let roles: HashSet<String> = sqlx::query_scalar::<_, String>(&format!(
        "{EFFECTIVE_ROLES_CTE}{EFFECTIVE_ROLE_NAMES_SQL}"
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    // Cap the entry's lifetime at the next grant expiry. Without this a grant
    // that lapses at 09:00 would keep working until the TTL rolls over, which
    // makes "expires at" merely advisory.
    let next_expiry: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar(NEXT_GRANT_EXPIRY_SQL)
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    let ttl = match next_expiry {
        Some(at) => {
            let secs = (at - chrono::Utc::now()).num_seconds().max(0) as u64;
            CACHE.ttl.min(Duration::from_secs(secs))
        }
        None => CACHE.ttl,
    };

    let permissions = Arc::new(permissions);
    let roles = Arc::new(roles);
    CACHE.store(user_id, ttl, permissions.clone(), roles.clone());
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
