//! Integration tests for editing a page's access rule (`PUT
//! /api/rbac/route-policies/{route_id}`): every permission or role a rule
//! newly names must exist, the audit trail records the rule before and after
//! the change, and the Access Control page's own rule cannot lock out the
//! person saving it.
//!
//! Same pattern as `rbac_profile.rs`: the service layer against a real
//! PostgreSQL database, skipping when `DATABASE_URL` is unset. Fixtures use
//! the fixed `926_xxx` block (users `926_0xx`, roles `926_1xx`), and the
//! policy rows this file creates are named `test-route-926-*`. The only seeded
//! row it changes is `rbac`, in a single test that restores it.

use hotel_app_be::core::error::ApiError;
use hotel_app_be::models::{RouteAccessPolicy, RouteAccessPolicyInput};
use hotel_app_be::modules::rbac::repository::RbacRepository;
use hotel_app_be::modules::rbac::service as rbac_service;
use sqlx::{PgPool, postgres::PgPoolOptions};

const ACTOR_USER_ID: i64 = 926_001;
const ACTOR_ROLE_ID: i64 = 926_101;
const ACTOR_ROLE_NAME: &str = "route_policy_editor_926";

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping PostgreSQL route-policy test because DATABASE_URL is not set");
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

/// A staff user holding one custom role whose only permission is
/// `roles:read`: enough to open Access Control under the seeded rule, and
/// nothing else that rule accepts.
async fn upsert_actor(pool: &PgPool) {
    // Tests in this binary run concurrently and each calls this, so every
    // statement tolerates a concurrent twin: inserts skip any unique conflict
    // (a targeted `ON CONFLICT (id)` still fails on the email key when two
    // first-run inserts race), and grants are only ever added or trimmed.
    // Deleting and re-inserting them would leave a moment where the actor
    // holds no role, which a concurrent lockout check would read as "locked
    // out".
    sqlx::query(
        "INSERT INTO users (
            id, username, email, password_hash, full_name, user_type,
            is_active, is_verified, is_locked, failed_login_attempts, deleted_at
         )
         OVERRIDING SYSTEM VALUE
         VALUES ($1, 'route_policy_actor_926', 'route_policy_actor_926@example.test',
                 'not-a-real-hash', 'Route Policy Actor 926', 'staff',
                 true, true, false, 0, NULL)
         ON CONFLICT DO NOTHING",
    )
    .bind(ACTOR_USER_ID)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE users SET is_active = true, is_locked = false, deleted_at = NULL WHERE id = $1",
    )
    .bind(ACTOR_USER_ID)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO roles (id, name, display_name, description, is_system_role, priority)
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, 'Route policy editor 926', 'rbac_route_policies.rs fixture role', false, 10)
         ON CONFLICT DO NOTHING",
    )
    .bind(ACTOR_ROLE_ID)
    .bind(ACTOR_ROLE_NAME)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE name = 'roles:read'
         ON CONFLICT DO NOTHING",
    )
    .bind(ACTOR_ROLE_ID)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "DELETE FROM role_permissions
         WHERE role_id = $1
           AND permission_id <> (SELECT id FROM permissions WHERE name = 'roles:read')",
    )
    .bind(ACTOR_ROLE_ID)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(ACTOR_USER_ID)
        .bind(ACTOR_ROLE_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM user_roles WHERE user_id = $1 AND role_id <> $2")
        .bind(ACTOR_USER_ID)
        .bind(ACTOR_ROLE_ID)
        .execute(pool)
        .await
        .unwrap();
}

/// (Re)creates a test-only policy row with the given page rule, and drops
/// any audit rows earlier runs left for it.
async fn reset_test_policy(pool: &PgPool, route_id: &str, required_permissions: &[&str]) {
    remove_test_policy(pool, route_id).await;
    sqlx::query(
        "INSERT INTO route_access_policies (
            route_id, path, nav_label, nav_group, required_permissions, is_navigation, is_system_policy
         ) VALUES ($1, $2, 'Test page', 'admin', $3::jsonb, true, false)",
    )
    .bind(route_id)
    .bind(format!("/{route_id}"))
    .bind(serde_json::to_string(required_permissions).unwrap())
    .execute(pool)
    .await
    .unwrap();
}

async fn remove_test_policy(pool: &PgPool, route_id: &str) {
    sqlx::query(
        "DELETE FROM audit_logs \
         WHERE action = 'route_policy_updated' AND details->>'route_id' = $1",
    )
    .bind(route_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM route_access_policies WHERE route_id = $1")
        .bind(route_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn find_policy(pool: &PgPool, route_id: &str) -> RouteAccessPolicy {
    RbacRepository::find_all_route_access_policies(pool)
        .await
        .unwrap()
        .into_iter()
        .find(|policy| policy.route_id == route_id)
        .unwrap_or_else(|| panic!("route policy {route_id} must exist"))
}

fn input_from(policy: &RouteAccessPolicy) -> RouteAccessPolicyInput {
    RouteAccessPolicyInput {
        nav_label: policy.nav_label.clone(),
        nav_group: policy.nav_group.clone(),
        required_permissions: policy.required_permissions.clone(),
        required_roles: policy.required_roles.clone(),
        excluded_roles: policy.excluded_roles.clone(),
        nav_permissions: policy.nav_permissions.clone(),
        nav_roles: policy.nav_roles.clone(),
        nav_excluded_roles: policy.nav_excluded_roles.clone(),
        is_navigation: policy.is_navigation,
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

fn expect_bad_request<T: std::fmt::Debug>(result: Result<T, ApiError>) -> String {
    match result {
        Err(ApiError::BadRequest(message)) => message,
        other => panic!("expected BadRequest, got {other:?}"),
    }
}

#[tokio::test]
async fn names_a_rule_newly_adds_must_exist() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    upsert_actor(&pool).await;
    let route_id = "test-route-926-names";
    // `legacy_retired:read` stands for a name a rule kept after its
    // permission was retired: saving must not trip over it.
    reset_test_policy(&pool, route_id, &["rooms:read", "legacy_retired:read"]).await;
    let stored = find_policy(&pool, route_id).await;

    let mut unknown_permission = input_from(&stored);
    unknown_permission
        .nav_permissions
        .push("no_such_area:read".to_string());
    unknown_permission
        .required_permissions
        .push("another_missing:view".to_string());
    let message = expect_bad_request(
        rbac_service::update_route_policy(
            &pool,
            ACTOR_USER_ID,
            route_id.to_string(),
            unknown_permission,
        )
        .await,
    );
    assert_eq!(
        message,
        "Unknown permission in route policy: another_missing:view, no_such_area:read"
    );

    let mut unknown_role = input_from(&stored);
    unknown_role.nav_excluded_roles = strings(&["guest", "no_such_role_926"]);
    let message = expect_bad_request(
        rbac_service::update_route_policy(&pool, ACTOR_USER_ID, route_id.to_string(), unknown_role)
            .await,
    );
    assert_eq!(message, "Unknown role in route policy: no_such_role_926");

    // A refused change writes nothing.
    assert_eq!(find_policy(&pool, route_id).await, stored);

    let mut valid = input_from(&stored);
    valid.required_permissions.push("bookings:read".to_string());
    valid.excluded_roles = strings(&["guest"]);
    valid.nav_roles = strings(&[ACTOR_ROLE_NAME]);
    let saved =
        rbac_service::update_route_policy(&pool, ACTOR_USER_ID, route_id.to_string(), valid)
            .await
            .expect("known names and a kept legacy name must save");
    assert_eq!(
        saved.required_permissions,
        strings(&["rooms:read", "legacy_retired:read", "bookings:read"])
    );
    assert_eq!(saved.excluded_roles, strings(&["guest"]));
    assert_eq!(saved.nav_roles, strings(&[ACTOR_ROLE_NAME]));
    assert_eq!(find_policy(&pool, route_id).await, saved);

    remove_test_policy(&pool, route_id).await;
}

#[tokio::test]
async fn the_audit_trail_records_the_rule_before_and_after() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    upsert_actor(&pool).await;
    let route_id = "test-route-926-audit";
    reset_test_policy(&pool, route_id, &["rooms:read"]).await;
    let stored = find_policy(&pool, route_id).await;

    let mut change = input_from(&stored);
    change.required_permissions = strings(&["rooms:read", "rooms:update"]);
    change.nav_excluded_roles = strings(&["guest"]);
    rbac_service::update_route_policy(&pool, ACTOR_USER_ID, route_id.to_string(), change)
        .await
        .expect("a valid change must save");

    let (user_id, details): (Option<i64>, serde_json::Value) = sqlx::query_as(
        "SELECT user_id, details FROM audit_logs \
         WHERE action = 'route_policy_updated' AND details->>'route_id' = $1 \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(route_id)
    .fetch_one(&pool)
    .await
    .expect("the update must be audited");

    remove_test_policy(&pool, route_id).await;

    assert_eq!(user_id, Some(ACTOR_USER_ID));
    assert_eq!(
        details["before"]["required_permissions"],
        serde_json::json!(["rooms:read"])
    );
    assert_eq!(
        details["after"]["required_permissions"],
        serde_json::json!(["rooms:read", "rooms:update"])
    );
    assert_eq!(
        details["before"]["nav_excluded_roles"],
        serde_json::json!([])
    );
    assert_eq!(
        details["after"]["nav_excluded_roles"],
        serde_json::json!(["guest"])
    );
    assert_eq!(details["after"]["nav_group"], serde_json::json!("admin"));
}

#[tokio::test]
async fn a_missing_route_is_not_found() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let input = RouteAccessPolicyInput {
        nav_label: None,
        nav_group: None,
        required_permissions: Vec::new(),
        required_roles: Vec::new(),
        excluded_roles: Vec::new(),
        nav_permissions: Vec::new(),
        nav_roles: Vec::new(),
        nav_excluded_roles: Vec::new(),
        is_navigation: false,
    };
    let result = rbac_service::update_route_policy(
        &pool,
        ACTOR_USER_ID,
        "test-route-926-missing".to_string(),
        input,
    )
    .await;
    assert!(
        matches!(result, Err(ApiError::NotFound(_))),
        "expected NotFound, got {result:?}"
    );
}

#[tokio::test]
async fn the_access_control_rule_cannot_lock_out_its_editor() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    upsert_actor(&pool).await;
    let original = find_policy(&pool, "rbac").await;

    let outcome = async {
        // The actor holds roles:read only, so a rule that asks for users:manage
        // alone would lock them out of the page they are saving it from.
        let mut without_actor = input_from(&original);
        without_actor.required_permissions = strings(&["users:manage"]);
        let lockout = rbac_service::update_route_policy(
            &pool,
            ACTOR_USER_ID,
            "rbac".to_string(),
            without_actor,
        )
        .await;

        // Excluding a role the actor holds locks them out just the same.
        let mut excluding_actor = input_from(&original);
        excluding_actor.excluded_roles = strings(&[ACTOR_ROLE_NAME]);
        let excluded = rbac_service::update_route_policy(
            &pool,
            ACTOR_USER_ID,
            "rbac".to_string(),
            excluding_actor,
        )
        .await;
        let unchanged = find_policy(&pool, "rbac").await;

        // Naming the actor's role keeps them in, so the change saves.
        let mut by_role = input_from(&original);
        by_role.required_permissions = strings(&["users:manage"]);
        by_role.required_roles = strings(&[ACTOR_ROLE_NAME]);
        let kept =
            rbac_service::update_route_policy(&pool, ACTOR_USER_ID, "rbac".to_string(), by_role)
                .await;

        (lockout, excluded, unchanged, kept)
    }
    .await;

    // Restore the seeded rule before asserting, so a failure cannot leave the
    // shared database with a changed Access Control rule.
    RbacRepository::update_route_access_policy(&pool, "rbac", &input_from(&original))
        .await
        .expect("restoring the seeded rbac rule must succeed");
    // Only this test's rows: the audit test runs concurrently as the same
    // actor and reads its own row back.
    sqlx::query(
        "DELETE FROM audit_logs \
         WHERE action = 'route_policy_updated' AND user_id = $1 \
           AND details->>'route_id' = 'rbac'",
    )
    .bind(ACTOR_USER_ID)
    .execute(&pool)
    .await
    .unwrap();

    let (lockout, excluded, unchanged, kept) = outcome;
    let message = expect_bad_request(lockout);
    assert!(
        message.contains("lock you out of Access Control"),
        "unexpected message: {message}"
    );
    expect_bad_request(excluded);
    assert_eq!(unchanged, original, "a refused change must write nothing");
    let kept = kept.expect("a rule that still admits the actor's role must save");
    assert_eq!(kept.required_roles, strings(&[ACTOR_ROLE_NAME]));
}
