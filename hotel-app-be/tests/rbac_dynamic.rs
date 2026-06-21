//! Focused tests for dynamic RBAC policy and privilege boundaries.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::UserUpdateInput;
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

    #[tokio::test]
    async fn admin_can_update_user_profile_fields() {
        let pool = common::setup_test_db().await;
        insert_target_user(&pool, 9103, "rbacupdate").await;

        let updated = rbac::update_user(
            &pool,
            1,
            9103,
            UserUpdateInput {
                username: Some("RBACUpdated".to_string()),
                email: Some(" RBACUpdated@Hotel.Local ".to_string()),
                full_name: Some("Updated User".to_string()),
                phone: Some("+1 (555) 0100".to_string()),
                is_active: Some(true),
                password: None,
            },
        )
        .await
        .expect("admin should update a lower-priority user");

        assert_eq!(updated.username, "rbacupdated");
        assert_eq!(updated.email, "rbacupdated@hotel.local");
        assert_eq!(updated.full_name.as_deref(), Some("Updated User"));
        assert_eq!(updated.phone.as_deref(), Some("+15550100"));
        assert!(updated.is_active);
    }

    #[tokio::test]
    async fn admin_delete_user_soft_deletes_and_clears_roles() {
        let pool = common::setup_test_db().await;
        insert_target_user(&pool, 9104, "rbacdelete").await;

        rbac::replace_user_roles(
            &pool,
            1,
            9104,
            hotel_app_be::models::UserRoleIdsInput { role_ids: vec![2] },
        )
        .await
        .expect("role assignment should succeed");

        rbac::delete_user(&pool, 1, 9104)
            .await
            .expect("admin should delete a lower-priority user");

        let active_user_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = ?1 AND deleted_at IS NULL")
                .bind(9104_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let role_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM user_roles WHERE user_id = ?1")
                .bind(9104_i64)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(active_user_count, 0);
        assert_eq!(role_count, 0);
    }
}
