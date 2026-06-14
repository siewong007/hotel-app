//! Focused tests for dynamic RBAC policy and privilege boundaries.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::services::rbac;

    async fn insert_target_user(pool: &sqlx::SqlitePool, id: i64, username: &str) {
        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, password_hash, full_name, is_active, is_verified)
             VALUES (?1, ?2, ?3, ?4, 'hash', 'Target User', 1, 1)",
        )
        .bind(id)
        .bind(format!("00000000-0000-0000-0000-{id:012}"))
        .bind(username)
        .bind(format!("{username}@hotel.local"))
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn route_access_policies_load_from_database() {
        let pool = common::setup_test_db().await;

        let policies = rbac::route_policies(&pool)
            .await
            .expect("route policies should load");
        let rbac_policy = policies
            .iter()
            .find(|policy| policy.route_id == "rbac")
            .expect("rbac route policy should be seeded");

        assert!(rbac_policy.is_navigation);
        assert!(
            rbac_policy
                .required_permissions
                .contains(&"roles:read".to_string())
        );
        assert!(
            rbac_policy
                .nav_permissions
                .contains(&"navigation_rbac:read".to_string())
        );
    }

    #[tokio::test]
    async fn admin_can_assign_lower_priority_role() {
        let pool = common::setup_test_db().await;
        insert_target_user(&pool, 9101, "rbaclower").await;

        let count = rbac::replace_user_roles(
            &pool,
            1,
            9101,
            hotel_app_be::models::UserRoleIdsInput { role_ids: vec![2] },
        )
        .await
        .expect("admin should be able to assign manager");

        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn admin_cannot_assign_admin_priority_role() {
        let pool = common::setup_test_db().await;
        insert_target_user(&pool, 9102, "rbacequal").await;

        let err = rbac::replace_user_roles(
            &pool,
            1,
            9102,
            hotel_app_be::models::UserRoleIdsInput { role_ids: vec![1] },
        )
        .await
        .expect_err("admin should not grant an admin-equivalent role");

        assert!(matches!(err, ApiError::Forbidden(message) if message.contains("at or above")));
    }
}
