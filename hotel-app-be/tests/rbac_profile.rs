//! Integration tests for RBAC permission enforcement, profile/session
//! management, and two-factor setup -- the same PostgreSQL workflow pattern
//! `tests/auth_session.rs` and `tests/booking_service.rs` use: exercise the
//! `services::*` layer directly against a real database, skipping gracefully
//! when `DATABASE_URL` is unset.
//!
//! Every fixture row in this file uses a fixed id in the `920_xxx` block
//! (users `920_0xx`, roles `920_1xx`) so reruns against a persistent dev
//! database are deterministic. No custom `permissions` rows are created --
//! every scenario below is expressed with the existing seeded
//! `housekeeping:*` permissions (see `database/postgres/data.sql`), per the
//! task's preference for reusing system permissions over inserting new ones.

use hotel_app_be::core::error::ApiError;
use hotel_app_be::core::middleware;
use hotel_app_be::core::rbac_cache;
use hotel_app_be::models::{
    AssignPermissionInput, AssignRoleInput, LoginRequest, PasswordUpdateInput,
    RegenerateBackupCodesRequest, RoleInput, RolePermissionIdsInput, TwoFactorDisableRequest,
    TwoFactorEnableRequest, TwoFactorSetupRequest, TwoFactorVerifyRequest, UserRoleIdsInput,
};
use hotel_app_be::services::auth as auth_service;
use hotel_app_be::services::profile as profile_service;
use hotel_app_be::services::rbac as rbac_service;
use hotel_app_be::services::two_factor as two_factor_service;
use hotel_app_be::AuthService;
use sqlx::{PgPool, postgres::PgPoolOptions};
use totp_rs::{Algorithm, Secret, TOTP};

/// Distinct from the secret `auth_session.rs` seeds into the same JWT-secret
/// `OnceLock` -- both are 32+ chars so `AuthService::init_jwt_secret` accepts
/// whichever test binary claims it first; the two test binaries never share
/// a process, so there is no cross-file interaction.
const TEST_JWT_SECRET: &str = "hotel-app-be-rbac-profile-test-secret-32chars-minimum";

fn ensure_jwt_secret() {
    let _ = AuthService::init_jwt_secret(TEST_JWT_SECRET);
}

/// `services::auth::login` needs `core::config::get()` initialized. Only the
/// tests that call `login` (password-change, session) need this.
fn ensure_test_app_config() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        ensure_jwt_secret();
        if std::env::var("JWT_SECRET").is_err() {
            // SAFETY: runs exactly once, inside `Once::call_once`, before any
            // test in this binary reads config env vars.
            unsafe { std::env::set_var("JWT_SECRET", TEST_JWT_SECRET) };
        }
        let _ = hotel_app_be::core::config::init_from_env();
    });
}

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping PostgreSQL rbac/profile test because DATABASE_URL is not set");
            return None;
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some(pool)
}

/// Upserts a dedicated, fully-reset test user so reruns against a persistent
/// dev DB are deterministic regardless of prior runs (mirrors
/// `auth_session.rs::upsert_test_user`, plus resetting the 2FA columns since
/// this file also exercises the 2FA lifecycle on fixed ids).
async fn upsert_test_user(pool: &PgPool, user_id: i64, username: &str, email: &str, password: &str) {
    let password_hash = AuthService::hash_password(password)
        .await
        .expect("bcrypt hashing must succeed");

    sqlx::query(
        "INSERT INTO users (
            id, username, email, password_hash, full_name, user_type,
            is_active, is_verified, is_locked, failed_login_attempts,
            locked_until, two_factor_enabled, two_factor_secret, two_factor_recovery_codes,
            last_login_at, deleted_at
         )
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, 'staff', true, true, false, 0, NULL, false, NULL, NULL, NULL, NULL)
         ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            email = EXCLUDED.email,
            password_hash = EXCLUDED.password_hash,
            full_name = EXCLUDED.full_name,
            is_active = true,
            is_verified = true,
            is_locked = false,
            failed_login_attempts = 0,
            locked_until = NULL,
            two_factor_enabled = false,
            two_factor_secret = NULL,
            two_factor_recovery_codes = NULL,
            last_login_at = NULL,
            deleted_at = NULL",
    )
    .bind(user_id)
    .bind(username)
    .bind(email)
    .bind(password_hash)
    .bind(format!("Rbac Profile Test User {user_id}"))
    .execute(pool)
    .await
    .unwrap();
}

/// Upserts a dedicated, non-system custom role fixture.
async fn upsert_custom_role(pool: &PgPool, role_id: i64, name: &str, priority: i32) {
    let display_name = name.replace('_', " ");
    sqlx::query(
        "INSERT INTO roles (id, name, display_name, description, is_system_role, priority)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, 'rbac_profile.rs test fixture role', false, $4)
         ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            display_name = EXCLUDED.display_name,
            priority = EXCLUDED.priority,
            is_system_role = false",
    )
    .bind(role_id)
    .bind(name)
    .bind(display_name)
    .bind(priority)
    .execute(pool)
    .await
    .unwrap();
}

/// Directly (re)sets a role's permission set to exactly one permission,
/// bypassing the service layer -- used only for initial fixture setup, never
/// for the assertions themselves.
async fn set_role_permission_fixture(pool: &PgPool, role_id: i64, permission_id: i64) {
    sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
        .bind(role_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)")
        .bind(role_id)
        .bind(permission_id)
        .execute(pool)
        .await
        .unwrap();
}

/// Directly assigns a role to a user, bypassing the service layer -- used
/// only for fixture setup (e.g. giving the "actor" user in a test a seeded
/// role so `ensure_actor_can_manage_roles` lets them mutate lower-priority
/// fixture roles).
async fn assign_user_role_fixture(pool: &PgPool, user_id: i64, role_id: i64) {
    sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(user_id)
        .bind(role_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn permission_id(pool: &PgPool, name: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM permissions WHERE name = $1")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("seeded permission '{name}' must exist in data.sql: {e}"))
}

async fn role_id_by_name(pool: &PgPool, name: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM roles WHERE name = $1")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("seeded role '{name}' must exist in data.sql: {e}"))
}

/// Cleans up every row this file's fixtures may have touched for the given
/// fixed ids. Children before parents: audit/session rows, then
/// `user_roles`/`role_permissions` (both reference users+roles), then the
/// roles themselves, then the users. Safe to call with empty slices.
async fn cleanup_rbac_fixture(pool: &PgPool, user_ids: &[i64], role_ids: &[i64]) {
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = ANY($1)")
        .bind(user_ids)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "DELETE FROM audit_logs \
         WHERE user_id = ANY($1) \
            OR (resource_type IN ('user', 'user_role') AND resource_id = ANY($1))",
    )
    .bind(user_ids)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM user_roles WHERE user_id = ANY($1) OR role_id = ANY($2)")
        .bind(user_ids)
        .bind(role_ids)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM role_permissions WHERE role_id = ANY($1)")
        .bind(role_ids)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM roles WHERE id = ANY($1)")
        .bind(role_ids)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = ANY($1)")
        .bind(user_ids)
        .execute(pool)
        .await
        .unwrap();
}

// ---------------------------------------------------------------------------
// Scenarios 1 & 3: exact-match grant, and denial when the role lacks it
// ---------------------------------------------------------------------------

#[tokio::test]
async fn postgres_check_permission_grants_exact_match_and_denies_missing_permission() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 920_001;
    let role_id = 920_101;

    cleanup_rbac_fixture(&pool, &[user_id], &[role_id]).await;
    upsert_test_user(
        &pool,
        user_id,
        "rbac920_user_a",
        "rbac920-user-a@hotel.local",
        "S3cure!Passw0rd-RbacA",
    )
    .await;
    upsert_custom_role(&pool, role_id, "rbac920_role_a", 10).await;
    let read_perm = permission_id(&pool, "housekeeping:read").await;
    set_role_permission_fixture(&pool, role_id, read_perm).await;
    assign_user_role_fixture(&pool, user_id, role_id).await;
    rbac_cache::invalidate_all();

    let granted = middleware::check_permission(&pool, user_id, "housekeeping:read").await;
    assert!(
        granted.is_ok(),
        "an exactly-matching permission via role assignment must be granted, got {granted:?}"
    );

    let denied = middleware::check_permission(&pool, user_id, "housekeeping:create").await;
    assert!(
        matches!(denied, Err(ApiError::Forbidden(_))),
        "a permission the user's roles do not include must be denied, got {denied:?}"
    );

    cleanup_rbac_fixture(&pool, &[user_id], &[role_id]).await;
}

// ---------------------------------------------------------------------------
// Scenario 2: `<resource>:manage` implies every action of that resource
// ---------------------------------------------------------------------------

#[tokio::test]
async fn postgres_manage_permission_implies_resource_actions() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 920_002;
    let role_id = 920_102;

    cleanup_rbac_fixture(&pool, &[user_id], &[role_id]).await;
    upsert_test_user(
        &pool,
        user_id,
        "rbac920_user_b",
        "rbac920-user-b@hotel.local",
        "S3cure!Passw0rd-RbacB",
    )
    .await;
    upsert_custom_role(&pool, role_id, "rbac920_role_b", 10).await;
    let manage_perm = permission_id(&pool, "housekeeping:manage").await;
    set_role_permission_fixture(&pool, role_id, manage_perm).await;
    assign_user_role_fixture(&pool, user_id, role_id).await;
    rbac_cache::invalidate_all();

    let read_via_manage = middleware::check_permission(&pool, user_id, "housekeeping:read").await;
    assert!(
        read_via_manage.is_ok(),
        "housekeeping:manage must imply housekeeping:read, got {read_via_manage:?}"
    );
    let create_via_manage = middleware::check_permission(&pool, user_id, "housekeeping:create").await;
    assert!(
        create_via_manage.is_ok(),
        "housekeeping:manage must imply housekeeping:create, got {create_via_manage:?}"
    );

    // Sanity: the implication is scoped to the resource, not global.
    let unrelated = middleware::check_permission(&pool, user_id, "bookings:read").await;
    assert!(
        matches!(unrelated, Err(ApiError::Forbidden(_))),
        "housekeeping:manage must not imply permissions on an unrelated resource, got {unrelated:?}"
    );

    cleanup_rbac_fixture(&pool, &[user_id], &[role_id]).await;
}

// ---------------------------------------------------------------------------
// Scenario 4: role CRUD + attaching/detaching a role's permissions reflects
// immediately in subsequent permission checks (cache invalidation is handled
// internally by the rbac_service functions under test).
// ---------------------------------------------------------------------------

#[tokio::test]
async fn postgres_role_and_permission_management_reflects_in_permission_checks() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let actor_id = 920_010;
    let target_id = 920_004;
    let role_id = 920_103;

    cleanup_rbac_fixture(&pool, &[actor_id, target_id], &[role_id]).await;
    // Leftover ad-hoc CRUD-test role from a prior crashed run (it has no
    // fixed id since `create_role` assigns one; clean it up by name).
    sqlx::query("DELETE FROM roles WHERE name IN ('rbac920_crud_role', 'rbac920_crud_role_renamed')")
        .execute(&pool)
        .await
        .unwrap();

    upsert_test_user(
        &pool,
        actor_id,
        "rbac920_user_actor_c",
        "rbac920-actor-c@hotel.local",
        "S3cure!Passw0rd-RbacC1",
    )
    .await;
    upsert_test_user(
        &pool,
        target_id,
        "rbac920_user_target_c",
        "rbac920-target-c@hotel.local",
        "S3cure!Passw0rd-RbacC2",
    )
    .await;

    // The actor needs a higher-priority role than anything it manages
    // (`ensure_actor_can_manage_roles` in services/rbac.rs).
    let admin_role_id = role_id_by_name(&pool, "admin").await;
    assign_user_role_fixture(&pool, actor_id, admin_role_id).await;

    upsert_custom_role(&pool, role_id, "rbac920_role_c", 10).await;
    assign_user_role_fixture(&pool, target_id, role_id).await;
    rbac_cache::invalidate_all();

    let hk_create = permission_id(&pool, "housekeeping:create").await;
    let hk_read = permission_id(&pool, "housekeeping:read").await;
    let hk_manage = permission_id(&pool, "housekeeping:manage").await;

    // Role starts with no permissions.
    let before = middleware::check_permission(&pool, target_id, "housekeeping:create").await;
    assert!(
        matches!(before, Err(ApiError::Forbidden(_))),
        "a role with no permissions must deny, got {before:?}"
    );

    // Attach.
    rbac_service::assign_permission_to_role(
        &pool,
        actor_id,
        AssignPermissionInput {
            role_id,
            permission_id: hk_create,
        },
    )
    .await
    .expect("an actor with higher role priority should be able to attach a permission");
    let after_attach = middleware::check_permission(&pool, target_id, "housekeeping:create").await;
    assert!(
        after_attach.is_ok(),
        "attaching a permission to the role must be reflected immediately, got {after_attach:?}"
    );

    // Detach.
    rbac_service::remove_permission_from_role(&pool, actor_id, role_id, hk_create)
        .await
        .expect("the actor should be able to detach the permission");
    let after_detach = middleware::check_permission(&pool, target_id, "housekeeping:create").await;
    assert!(
        matches!(after_detach, Err(ApiError::Forbidden(_))),
        "detaching a permission from the role must be reflected immediately, got {after_detach:?}"
    );

    // Bulk replace.
    let replaced_count = rbac_service::replace_role_permissions(
        &pool,
        actor_id,
        role_id,
        RolePermissionIdsInput {
            permission_ids: vec![hk_read, hk_manage],
        },
    )
    .await
    .expect("bulk replace_role_permissions should succeed");
    assert_eq!(replaced_count, 2);
    assert!(
        middleware::check_permission(&pool, target_id, "housekeeping:read")
            .await
            .is_ok()
    );
    assert!(
        middleware::check_permission(&pool, target_id, "housekeeping:create")
            .await
            .is_ok(),
        "housekeeping:manage from the bulk replace must still imply housekeeping:create"
    );

    // Role CRUD lifecycle: create (service-assigned id, self-contained) ->
    // update -> delete.
    let created = rbac_service::create_role(
        &pool,
        RoleInput {
            name: "rbac920_crud_role".to_string(),
            description: Some("rbac_profile.rs CRUD fixture".to_string()),
        },
    )
    .await
    .expect("create_role should succeed");
    assert_eq!(created.name, "rbac920_crud_role");

    let updated = rbac_service::update_role(
        &pool,
        actor_id,
        created.id,
        RoleInput {
            name: "rbac920_crud_role_renamed".to_string(),
            description: Some("rbac_profile.rs CRUD fixture renamed".to_string()),
        },
    )
    .await
    .expect("an actor with higher priority should be able to update a non-system role");
    assert_eq!(updated.name, "rbac920_crud_role_renamed");

    rbac_service::delete_role(&pool, actor_id, created.id)
        .await
        .expect("the actor should be able to delete a non-system role with no users assigned");
    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM roles WHERE id = $1")
        .bind(created.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0, "delete_role must remove the row");

    cleanup_rbac_fixture(&pool, &[actor_id, target_id], &[role_id]).await;
}

// ---------------------------------------------------------------------------
// Scenario 5: assigning/removing a role to/from a user changes their
// effective permissions.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn postgres_user_role_assignment_changes_effective_permissions() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let actor_id = 920_011;
    let target_id = 920_005;
    let role_read_id = 920_104;
    let role_manage_id = 920_105;

    cleanup_rbac_fixture(&pool, &[actor_id, target_id], &[role_read_id, role_manage_id]).await;
    upsert_test_user(
        &pool,
        actor_id,
        "rbac920_user_actor_d",
        "rbac920-actor-d@hotel.local",
        "S3cure!Passw0rd-RbacD1",
    )
    .await;
    upsert_test_user(
        &pool,
        target_id,
        "rbac920_user_target_d",
        "rbac920-target-d@hotel.local",
        "S3cure!Passw0rd-RbacD2",
    )
    .await;

    let admin_role_id = role_id_by_name(&pool, "admin").await;
    assign_user_role_fixture(&pool, actor_id, admin_role_id).await;

    upsert_custom_role(&pool, role_read_id, "rbac920_role_d", 10).await;
    upsert_custom_role(&pool, role_manage_id, "rbac920_role_e", 10).await;
    let hk_read = permission_id(&pool, "housekeeping:read").await;
    let hk_manage = permission_id(&pool, "housekeeping:manage").await;
    set_role_permission_fixture(&pool, role_read_id, hk_read).await;
    set_role_permission_fixture(&pool, role_manage_id, hk_manage).await;
    rbac_cache::invalidate_all();

    // Target begins with no roles at all.
    let before = middleware::check_permission(&pool, target_id, "housekeeping:read").await;
    assert!(
        matches!(before, Err(ApiError::Forbidden(_))),
        "a user with no roles must be denied, got {before:?}"
    );

    rbac_service::assign_role_to_user(
        &pool,
        actor_id,
        AssignRoleInput {
            user_id: target_id,
            role_id: role_read_id,
        },
    )
    .await
    .expect("the actor should be able to assign a lower-priority role");
    let after_assign = middleware::check_permission(&pool, target_id, "housekeeping:read").await;
    assert!(
        after_assign.is_ok(),
        "assigning the role must grant the permission immediately, got {after_assign:?}"
    );

    rbac_service::remove_role_from_user(&pool, actor_id, target_id, role_read_id)
        .await
        .expect("the actor should be able to remove the role");
    let after_remove = middleware::check_permission(&pool, target_id, "housekeeping:read").await;
    assert!(
        matches!(after_remove, Err(ApiError::Forbidden(_))),
        "removing the role must revoke the permission immediately, got {after_remove:?}"
    );

    // Bulk replace with two roles at once.
    let count = rbac_service::replace_user_roles(
        &pool,
        actor_id,
        target_id,
        UserRoleIdsInput {
            role_ids: vec![role_read_id, role_manage_id],
        },
    )
    .await
    .expect("bulk replace_user_roles should succeed");
    assert_eq!(count, 2);
    assert!(
        middleware::check_permission(&pool, target_id, "housekeeping:read")
            .await
            .is_ok()
    );
    assert!(
        middleware::check_permission(&pool, target_id, "housekeeping:create")
            .await
            .is_ok(),
        "the manage role from the bulk replace must imply housekeeping:create"
    );

    cleanup_rbac_fixture(&pool, &[actor_id, target_id], &[role_read_id, role_manage_id]).await;
}

// ---------------------------------------------------------------------------
// Scenario 6: password change -- wrong current password rejected, correct
// current password succeeds, the stored hash changes, and login works with
// the new (and only the new) password.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn postgres_password_change_rejects_wrong_current_and_login_works_with_new_password() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    ensure_test_app_config();
    let user_id = 920_006;
    let username = "rbac920_user_pwd".to_string();
    let email = "rbac920-pwd@hotel.local".to_string();
    let old_password = "S3cure!Passw0rd-Old1";
    let new_password = "S3cure!Passw0rd-New2";

    cleanup_rbac_fixture(&pool, &[user_id], &[]).await;
    upsert_test_user(&pool, user_id, &username, &email, old_password).await;

    let old_hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let wrong = profile_service::update_password(
        &pool,
        user_id,
        PasswordUpdateInput {
            current_password: "totally-wrong-password".to_string(),
            new_password: new_password.to_string(),
        },
    )
    .await;
    assert!(
        matches!(wrong, Err(ApiError::Unauthorized(_))),
        "an incorrect current password must be rejected, got {wrong:?}"
    );

    let unchanged_hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        old_hash, unchanged_hash,
        "a rejected password change must not touch the stored hash"
    );

    profile_service::update_password(
        &pool,
        user_id,
        PasswordUpdateInput {
            current_password: old_password.to_string(),
            new_password: new_password.to_string(),
        },
    )
    .await
    .expect("the correct current password should allow the change");

    let new_hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(
        old_hash, new_hash,
        "the stored bcrypt hash must change after a successful password update"
    );

    let login_new = auth_service::login(
        &pool,
        LoginRequest {
            username: username.clone(),
            password: new_password.to_string(),
            totp_code: None,
        },
        None,
        None,
    )
    .await;
    assert!(
        login_new.is_ok(),
        "login with the new password should succeed, got {login_new:?}"
    );

    let login_old = auth_service::login(
        &pool,
        LoginRequest {
            username,
            password: old_password.to_string(),
            totp_code: None,
        },
        None,
        None,
    )
    .await;
    assert!(login_old.is_err(), "login with the old password must fail after the change");

    cleanup_rbac_fixture(&pool, &[user_id], &[]).await;
}

// ---------------------------------------------------------------------------
// Scenario 7: session listing + revoking a session removes only the target.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn postgres_session_listing_and_revoke_removes_only_target_session() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    ensure_test_app_config();
    let user_id = 920_007;
    let username = "rbac920_user_sess".to_string();
    let email = "rbac920-sess@hotel.local".to_string();
    let password = "S3cure!Passw0rd-Sess1";

    cleanup_rbac_fixture(&pool, &[user_id], &[]).await;
    upsert_test_user(&pool, user_id, &username, &email, password).await;

    let (auth_a, _refresh_a) = auth_service::login(
        &pool,
        LoginRequest {
            username: username.clone(),
            password: password.to_string(),
            totp_code: None,
        },
        Some("127.0.0.1"),
        Some("rbac-profile-test-agent-a"),
    )
    .await
    .expect("first login should succeed");
    let (auth_b, _refresh_b) = auth_service::login(
        &pool,
        LoginRequest {
            username: username.clone(),
            password: password.to_string(),
            totp_code: None,
        },
        Some("127.0.0.2"),
        Some("rbac-profile-test-agent-b"),
    )
    .await
    .expect("second login should succeed");

    let sid_a = AuthService::verify_jwt(&auth_a.access_token)
        .expect("first access token must verify")
        .sid
        .expect("first access token must carry a sid");
    let sid_b = AuthService::verify_jwt(&auth_b.access_token)
        .expect("second access token must verify")
        .sid
        .expect("second access token must carry a sid");

    let sessions = profile_service::list_sessions(&pool, user_id, Some(sid_b.as_str()))
        .await
        .expect("list_sessions should succeed");
    assert_eq!(sessions.len(), 2, "both active sessions should be listed");
    assert!(sessions.iter().any(|s| s.id == sid_a));
    let current = sessions
        .iter()
        .find(|s| s.id == sid_b)
        .expect("session b must be listed");
    assert!(current.is_current, "the session matching current_session_id must be flagged is_current");
    let other = sessions
        .iter()
        .find(|s| s.id == sid_a)
        .expect("session a must be listed");
    assert!(!other.is_current, "a session other than the current one must not be flagged is_current");

    profile_service::revoke_session(&pool, user_id, &sid_a)
        .await
        .expect("revoking an owned session should succeed");

    let remaining = profile_service::list_sessions(&pool, user_id, Some(sid_b.as_str()))
        .await
        .expect("list_sessions after revoke should succeed");
    assert_eq!(remaining.len(), 1, "only the target session should be removed");
    assert_eq!(remaining[0].id, sid_b, "the untouched session must remain listed");

    assert!(
        !AuthService::is_session_active(&pool, user_id, &sid_a)
            .await
            .unwrap(),
        "the revoked session must no longer be active"
    );
    assert!(
        AuthService::is_session_active(&pool, user_id, &sid_b)
            .await
            .unwrap(),
        "the untouched session must remain active"
    );

    let re_revoke = profile_service::revoke_session(&pool, user_id, &sid_a).await;
    assert!(
        matches!(re_revoke, Err(ApiError::NotFound(_))),
        "revoking an already-revoked session must report not found, got {re_revoke:?}"
    );

    cleanup_rbac_fixture(&pool, &[user_id], &[]).await;
}

// ---------------------------------------------------------------------------
// Scenario 8: two-factor status/verify/disable lifecycle with a live TOTP
// code, and confirmation that disable clears the secret + backup codes.
//
// This scenario seeds the "2FA enabled" end state directly (native text[]
// array bind) rather than going through setup/enable, so it stays valid even
// if the setup flow changes; the full setup -> enable -> regenerate ->
// recovery-code disable flow is exercised end-to-end in Scenario 9 below.
// `totp-rs` is already a normal (non-dev) dependency of this crate (used by
// `src/core/auth.rs`), so generating a real, verifiable code here adds no
// new dependency.
// ---------------------------------------------------------------------------

fn build_totp(secret_base32: &str) -> TOTP {
    let secret_bytes = Secret::Encoded(secret_base32.to_string())
        .to_bytes()
        .expect("decoding the base32 TOTP secret must succeed");
    TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes, None, "".to_string())
        .expect("constructing a TOTP instance must succeed")
}

#[tokio::test]
async fn postgres_two_factor_status_verify_and_disable_lifecycle_with_live_totp() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 920_008;
    let username = "rbac920_user_2fa".to_string();
    let email = "rbac920-2fa@hotel.local".to_string();
    let password = "S3cure!Passw0rd-2fa1";

    cleanup_rbac_fixture(&pool, &[user_id], &[]).await;
    upsert_test_user(&pool, user_id, &username, &email, password).await;

    // Seed the "2FA enabled" end state directly (see NOTE ON SCOPE above) --
    // a real secret plus real hashed backup codes bound as a native Postgres
    // array, which is what a bug-free `enable_2fa` would have persisted.
    let (secret, _qr_url) = AuthService::generate_totp_secret(&username, "Hotel App Test")
        .expect("generating a TOTP secret must succeed");
    let backup_codes = AuthService::generate_backup_codes();
    let hashed_backup_codes: Vec<String> = backup_codes
        .iter()
        .map(|code| AuthService::hash_recovery_code(code))
        .collect();
    sqlx::query(
        "UPDATE users \
         SET two_factor_enabled = true, two_factor_secret = $2, two_factor_recovery_codes = $3 \
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(&secret)
    .bind(&hashed_backup_codes)
    .execute(&pool)
    .await
    .expect("seeding the enabled 2FA precondition must succeed");

    let totp = build_totp(&secret);

    let status = two_factor_service::get_2fa_status(&pool, user_id)
        .await
        .expect("get_2fa_status should succeed");
    assert!(status.enabled, "2FA must be reported enabled once the secret + flag are set");
    assert!(status.has_backup_codes);
    assert_eq!(status.backup_codes_remaining, hashed_backup_codes.len());

    let wrong_verify = two_factor_service::verify_2fa_code(
        &pool,
        user_id,
        TwoFactorVerifyRequest {
            code: "000000".to_string(),
        },
    )
    .await;
    assert!(
        matches!(wrong_verify, Err(ApiError::Unauthorized(_))),
        "an incorrect TOTP code must be rejected, got {wrong_verify:?}"
    );

    let verify_result = two_factor_service::verify_2fa_code(
        &pool,
        user_id,
        TwoFactorVerifyRequest {
            code: totp.generate_current().expect("generating a live TOTP code must succeed"),
        },
    )
    .await;
    assert!(verify_result.is_ok(), "a valid live TOTP code should verify, got {verify_result:?}");

    let disable_wrong = two_factor_service::disable_2fa(
        &pool,
        user_id,
        TwoFactorDisableRequest {
            code: "000000".to_string(),
        },
    )
    .await;
    assert!(
        matches!(disable_wrong, Err(ApiError::BadRequest(_))),
        "disabling with an invalid code must be rejected, got {disable_wrong:?}"
    );

    two_factor_service::disable_2fa(
        &pool,
        user_id,
        TwoFactorDisableRequest {
            code: totp.generate_current().expect("generating a live TOTP code must succeed"),
        },
    )
    .await
    .expect("disabling with a valid live TOTP code should succeed");

    let status_after = two_factor_service::get_2fa_status(&pool, user_id)
        .await
        .expect("get_2fa_status after disable should succeed");
    assert!(!status_after.enabled, "2FA must be reported disabled after disable_2fa");
    assert!(!status_after.has_backup_codes, "backup codes must be cleared after disable_2fa");

    let (secret_after, codes_after): (Option<String>, Option<Vec<String>>) = sqlx::query_as(
        "SELECT two_factor_secret, two_factor_recovery_codes FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(secret_after.is_none(), "disable_2fa must clear the stored secret");
    assert!(codes_after.is_none(), "disable_2fa must clear the stored recovery codes");

    cleanup_rbac_fixture(&pool, &[user_id], &[]).await;
}

// ---------------------------------------------------------------------------
// Scenario 9: the FULL two-factor lifecycle through the service layer --
// setup (writes a `two_factor_challenges` row), enable (persists hashed
// backup codes as a native Postgres text[]), regenerate backup codes, and
// finally disable via a RECOVERY code (the consumption branch that removes
// the used code through `update_recovery_codes` before disabling).
//
// This is the regression test for the two 2026-07-26 bugs: a missing
// `two_factor_challenges` table (every `setup_2fa` call 500'd) and
// `array_to_json` binding a JSON string against the `text[]` column
// `users.two_factor_recovery_codes` (every `enable_2fa` /
// `update_recovery_codes` call failed at the database). Both paths must now
// round-trip for real against live PostgreSQL.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn postgres_two_factor_setup_enable_regenerate_and_recovery_code_disable() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 920_009;
    let username = "rbac920_user_2fa_full".to_string();
    let email = "rbac920-2fa-full@hotel.local".to_string();
    let password = "S3cure!Passw0rd-2fa2";

    cleanup_rbac_fixture(&pool, &[user_id], &[]).await;
    upsert_test_user(&pool, user_id, &username, &email, password).await;

    // --- setup_2fa: must create a two_factor_challenges row ------------------
    let setup = two_factor_service::setup_2fa(&pool, user_id, TwoFactorSetupRequest {})
        .await
        .expect("setup_2fa must succeed now that two_factor_challenges exists");
    let first_challenge = setup["challenge_code"]
        .as_str()
        .expect("setup_2fa must return a challenge_code")
        .to_string();

    // Calling setup again must hit the ON CONFLICT (user_id, purpose) branch:
    // same single row, replaced challenge code, fresh secret.
    let setup_again = two_factor_service::setup_2fa(&pool, user_id, TwoFactorSetupRequest {})
        .await
        .expect("a second setup_2fa call must upsert, not error");
    let second_challenge = setup_again["challenge_code"]
        .as_str()
        .expect("second setup_2fa must return a challenge_code")
        .to_string();
    assert_ne!(
        first_challenge, second_challenge,
        "re-running setup must mint a fresh challenge code"
    );
    let (challenge_rows,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM two_factor_challenges WHERE user_id = $1 AND purpose = 'setup'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("counting challenge rows must succeed");
    assert_eq!(
        challenge_rows, 1,
        "ON CONFLICT (user_id, purpose) must keep exactly one setup challenge per user"
    );

    // The secret from the LATEST setup call is the one persisted on the user.
    let secret = setup_again["secret"]
        .as_str()
        .expect("setup_2fa must return the TOTP secret")
        .to_string();
    let totp = build_totp(&secret);

    // --- enable_2fa: must persist hashed backup codes as native text[] -------
    let enable_code = totp
        .generate_current()
        .expect("generating a live TOTP code must succeed");
    let enable = two_factor_service::enable_2fa(
        &pool,
        user_id,
        TwoFactorEnableRequest { code: enable_code },
    )
    .await
    .expect("enable_2fa must succeed with a valid live TOTP code");
    let original_backup_codes: Vec<String> = enable["backup_codes"]
        .as_array()
        .expect("enable_2fa must return backup_codes")
        .iter()
        .map(|v| v.as_str().expect("backup codes must be strings").to_string())
        .collect();
    assert_eq!(original_backup_codes.len(), 10);

    let (enabled_now, stored_hashes): (bool, Option<Vec<String>>) = sqlx::query_as(
        "SELECT two_factor_enabled, two_factor_recovery_codes FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("reading the enabled user row must succeed");
    assert!(enabled_now, "enable_2fa must set two_factor_enabled");
    let stored_hashes = stored_hashes.expect("enable_2fa must persist recovery codes");
    assert_eq!(stored_hashes.len(), 10);
    assert!(
        stored_hashes
            .iter()
            .all(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())),
        "recovery codes must be stored as sha-256 hex hashes, got {stored_hashes:?}"
    );
    assert!(
        stored_hashes.contains(&AuthService::hash_recovery_code(&original_backup_codes[0])),
        "stored hashes must correspond to the plaintext codes returned to the caller"
    );

    // --- regenerate_backup_codes: exercises update_recovery_codes ------------
    let regen_code = totp
        .generate_current()
        .expect("generating a live TOTP code must succeed");
    let regen = two_factor_service::regenerate_backup_codes(
        &pool,
        user_id,
        RegenerateBackupCodesRequest { code: regen_code },
    )
    .await
    .expect("regenerate_backup_codes must succeed with a valid live TOTP code");
    let new_backup_codes: Vec<String> = regen["backup_codes"]
        .as_array()
        .expect("regenerate must return backup_codes")
        .iter()
        .map(|v| v.as_str().expect("backup codes must be strings").to_string())
        .collect();
    assert_eq!(new_backup_codes.len(), 10);

    let (rotated_hashes,): (Option<Vec<String>>,) = sqlx::query_as(
        "SELECT two_factor_recovery_codes FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("reading rotated codes must succeed");
    let rotated_hashes = rotated_hashes.expect("rotation must leave recovery codes present");
    assert!(
        rotated_hashes.contains(&AuthService::hash_recovery_code(&new_backup_codes[0])),
        "rotated storage must contain the new codes"
    );
    assert!(
        !rotated_hashes.contains(&AuthService::hash_recovery_code(&original_backup_codes[0])),
        "rotation must invalidate every original backup code"
    );

    // --- disable_2fa via recovery code ---------------------------------------
    // A revoked (pre-rotation) code must be rejected...
    let disable_revoked = two_factor_service::disable_2fa(
        &pool,
        user_id,
        TwoFactorDisableRequest {
            code: original_backup_codes[0].clone(),
        },
    )
    .await;
    assert!(
        matches!(disable_revoked, Err(ApiError::BadRequest(_))),
        "a rotated-away recovery code must not disable 2FA, got {disable_revoked:?}"
    );

    // ...while a current recovery code must consume itself (update_recovery_codes)
    // and then disable 2FA entirely.
    two_factor_service::disable_2fa(
        &pool,
        user_id,
        TwoFactorDisableRequest {
            code: new_backup_codes[0].clone(),
        },
    )
    .await
    .expect("a current recovery code must disable 2FA");

    let (enabled_after, secret_after, codes_after): (bool, Option<String>, Option<Vec<String>>) =
        sqlx::query_as(
            "SELECT two_factor_enabled, two_factor_secret, two_factor_recovery_codes \
             FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("reading the disabled user row must succeed");
    assert!(!enabled_after, "disable_2fa must clear the enabled flag");
    assert!(secret_after.is_none(), "disable_2fa must clear the stored secret");
    assert!(codes_after.is_none(), "disable_2fa must clear the stored recovery codes");

    cleanup_rbac_fixture(&pool, &[user_id], &[]).await;
}
