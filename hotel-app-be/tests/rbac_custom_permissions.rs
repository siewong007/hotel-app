//! Integration tests for custom permissions: every permission read reports
//! whether it is built in, and a permission a page access rule still names
//! can be neither deleted nor renamed (rules hold names, not ids).
//!
//! Same pattern as `rbac_route_policies.rs`: the service layer against a real
//! PostgreSQL database, skipping when `DATABASE_URL` is unset. Fixtures use
//! the fixed `927_xxx` block (users `927_0xx`, roles `927_1xx`); the custom
//! permissions are `test_*_927:*` and the policy row is `test-route-927-*`.

use hotel_app_be::core::error::ApiError;
use hotel_app_be::models::{Permission, PermissionInput};
use hotel_app_be::modules::rbac::repository::RbacRepository;
use hotel_app_be::modules::rbac::service as rbac_service;
use sqlx::{PgPool, postgres::PgPoolOptions};

const ACTOR_USER_ID: i64 = 927_001;
const HOLDER_ROLE_ID: i64 = 927_101;

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping PostgreSQL custom-permission test because DATABASE_URL is not set");
            return None;
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(5)
        // The append-only trigger on audit_logs forbids the fixture cleanups
        // below; test pools opt out session-locally.
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET app.allow_audit_mutation = 'on'")
                    .execute(conn)
                    .await
                    .map(|_| ())
            })
        })
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some(pool)
}

/// The staff user the audit entries name. Inserts skip any unique conflict
/// because the tests in this binary run concurrently.
async fn upsert_actor(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO users (
            id, username, email, password_hash, full_name, user_type,
            is_active, is_verified, is_locked, failed_login_attempts, deleted_at
         )
         OVERRIDING SYSTEM VALUE
         VALUES ($1, 'custom_permission_actor_927', 'custom_permission_actor_927@example.test',
                 'not-a-real-hash', 'Custom Permission Actor 927', 'staff',
                 true, true, false, 0, NULL)
         ON CONFLICT DO NOTHING",
    )
    .bind(ACTOR_USER_ID)
    .execute(pool)
    .await
    .unwrap();
}

/// Removes a test permission (its role grants cascade), the policy rows that
/// name it, and the audit rows written about it, so reruns start clean.
async fn remove_permission(pool: &PgPool, name: &str) {
    sqlx::query(
        "DELETE FROM audit_logs \
         WHERE resource_type IN ('permission', 'route_access_policy') \
           AND (details->>'name' = $1 OR details->>'route_id' LIKE 'test-route-927-%')",
    )
    .bind(name)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM route_access_policies WHERE route_id LIKE 'test-route-927-%' AND (required_permissions ? $1 OR nav_permissions ? $1)")
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM permissions WHERE name = $1")
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
}

fn input(resource: &str, action: &str, description: &str) -> PermissionInput {
    PermissionInput {
        name: format!("{resource}:{action}"),
        resource: resource.to_string(),
        action: action.to_string(),
        description: Some(description.to_string()),
    }
}

fn find<'a>(permissions: &'a [Permission], name: &str) -> &'a Permission {
    permissions
        .iter()
        .find(|permission| permission.name == name)
        .unwrap_or_else(|| panic!("permission {name} must be listed"))
}

fn expect_bad_request<T: std::fmt::Debug>(result: Result<T, ApiError>) -> String {
    match result {
        Err(ApiError::BadRequest(message)) => message,
        other => panic!("expected BadRequest, got {other:?}"),
    }
}

#[tokio::test]
async fn every_permission_read_says_whether_it_is_built_in() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    upsert_actor(&pool).await;
    let name = "test_builtin_927:read";
    remove_permission(&pool, name).await;

    let created = rbac_service::create_permission(
        &pool,
        ACTOR_USER_ID,
        input("test_builtin_927", "read", "Custom permission"),
    )
    .await
    .expect("a custom permission must be created");
    assert!(!created.is_system_permission);

    let listed = rbac_service::permissions(&pool).await.unwrap();
    assert!(find(&listed, "rooms:read").is_system_permission);
    assert!(!find(&listed, name).is_system_permission);

    // A role holding it, and a user holding that role, read it back through
    // the role and effective-permission queries.
    sqlx::query(
        "INSERT INTO roles (id, name, display_name, description, is_system_role, priority)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, 'custom_permission_holder_927', 'Custom permission holder 927',
                 'rbac_custom_permissions.rs fixture role', false, 5)
         ON CONFLICT DO NOTHING",
    )
    .bind(HOLDER_ROLE_ID)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(HOLDER_ROLE_ID)
    .bind(created.id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(ACTOR_USER_ID)
        .bind(HOLDER_ROLE_ID)
        .execute(&pool)
        .await
        .unwrap();

    let by_role = RbacRepository::get_role_permissions(&pool, HOLDER_ROLE_ID)
        .await
        .unwrap();
    let effective = RbacRepository::get_user_effective_permissions(&pool, ACTOR_USER_ID)
        .await
        .unwrap();
    let updated = rbac_service::update_permission(
        &pool,
        ACTOR_USER_ID,
        created.id,
        input("test_builtin_927", "read", "Described again"),
    )
    .await;

    sqlx::query("DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2")
        .bind(ACTOR_USER_ID)
        .bind(HOLDER_ROLE_ID)
        .execute(&pool)
        .await
        .unwrap();
    remove_permission(&pool, name).await;

    assert!(!find(&by_role, name).is_system_permission);
    assert!(!find(&effective, name).is_system_permission);
    let updated = updated.expect("a description change must save");
    assert!(!updated.is_system_permission);
    assert_eq!(updated.description.as_deref(), Some("Described again"));
}

#[tokio::test]
async fn a_permission_a_page_rule_names_cannot_be_deleted_or_renamed() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    upsert_actor(&pool).await;
    let name = "test_rule_927:view";
    remove_permission(&pool, name).await;

    let created = rbac_service::create_permission(
        &pool,
        ACTOR_USER_ID,
        input("test_rule_927", "view", "Shows a test page"),
    )
    .await
    .expect("a custom permission must be created");
    sqlx::query(
        "INSERT INTO route_access_policies (route_id, path, nav_permissions, is_navigation, is_system_policy)
         VALUES ('test-route-927-rule', '/test-route-927-rule', jsonb_build_array($1::text), true, false)",
    )
    .bind(name)
    .execute(&pool)
    .await
    .unwrap();

    let deleted = rbac_service::delete_permission(&pool, ACTOR_USER_ID, created.id).await;
    let renamed = rbac_service::update_permission(
        &pool,
        ACTOR_USER_ID,
        created.id,
        input("test_rule_927", "read", "Shows a test page"),
    )
    .await;
    let described = rbac_service::update_permission(
        &pool,
        ACTOR_USER_ID,
        created.id,
        input("test_rule_927", "view", "Opens the test page"),
    )
    .await;

    // Once no rule names it, it can go.
    sqlx::query("DELETE FROM route_access_policies WHERE route_id = 'test-route-927-rule'")
        .execute(&pool)
        .await
        .unwrap();
    let deleted_after = rbac_service::delete_permission(&pool, ACTOR_USER_ID, created.id).await;
    let audit_name: Option<String> = sqlx::query_scalar(
        "SELECT details->>'name' FROM audit_logs \
         WHERE action = 'permission_deleted' AND resource_id = $1 \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(created.id)
    .fetch_optional(&pool)
    .await
    .unwrap();

    remove_permission(&pool, name).await;

    assert_eq!(
        expect_bad_request(deleted),
        "Cannot delete permission test_rule_927:view: 1 page access rule(s) still use it"
    );
    assert_eq!(
        expect_bad_request(renamed),
        "Cannot rename permission test_rule_927:view: 1 page access rule(s) still use it"
    );
    let described = described.expect("a description change keeps the name, so it must save");
    assert_eq!(described.name, name);
    assert_eq!(
        described.description.as_deref(),
        Some("Opens the test page")
    );
    deleted_after.expect("a permission no rule names must delete");
    assert_eq!(audit_name.as_deref(), Some(name));
}
