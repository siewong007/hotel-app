//! SQLite coverage for the guest support workflow's authorization and state rules.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::modules::support::models::{
        CreateGuestSupportConversationRequest, SupportActionInput, SupportListQuery,
        SupportMessageRequest,
    };
    use hotel_app_be::modules::support::service;

    async fn seed_guest(pool: &sqlx::SqlitePool, guest_id: i64, email: &str) {
        sqlx::query(
            r#"
            INSERT INTO guests (id, first_name, last_name, full_name, email, phone)
            VALUES (?1, 'Support', 'Guest', 'Support Guest', ?2, '60123456789')
            "#,
        )
        .bind(guest_id)
        .bind(email)
        .execute(pool)
        .await
        .unwrap();
    }

    fn create_request(client_request_id: &str) -> CreateGuestSupportConversationRequest {
        CreateGuestSupportConversationRequest {
            category: "stay".to_string(),
            message: "The room air conditioning needs attention.".to_string(),
            booking_id: None,
            client_request_id: client_request_id.to_string(),
        }
    }

    fn action(action: &str, expected_version: i64) -> SupportActionInput {
        SupportActionInput {
            action: action.to_string(),
            expected_version: Some(expected_version),
            assignee_id: None,
            priority: None,
            reason: None,
            resolution_code: None,
            resolution_summary: None,
            client_action_id: Some(format!("{action}-{expected_version}")),
        }
    }

    #[tokio::test]
    async fn guest_creation_is_idempotent_and_scoped_to_its_owner() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9801, "support-owner@example.com").await;
        seed_guest(&pool, 9802, "support-other@example.com").await;

        let created = service::create_guest_conversation(
            &pool,
            9801,
            create_request("create-9801-a"),
            None,
            None,
        )
        .await
        .unwrap();
        let replay = service::create_guest_conversation(
            &pool,
            9801,
            create_request("create-9801-a"),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(replay.conversation.id, created.conversation.id);
        let list = service::list_guest_conversations(&pool, 9801, None, None)
            .await
            .unwrap();
        assert_eq!(list.total, 1);
        assert!(list.categories.iter().any(|category| category == "stay"));

        let staff_queue = service::list_staff_conversations(
            &pool,
            1,
            SupportListQuery {
                queue: Some("waiting_for_staff".to_string()),
                status: None,
                priority: None,
                assigned_to_user_id: None,
                search: None,
                page: None,
                page_size: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(staff_queue.total, 1);
        assert_eq!(staff_queue.items[0].id, created.conversation.id);

        let other_guest = service::get_guest_conversation(&pool, 9802, created.conversation.id)
            .await
            .unwrap_err();
        assert!(matches!(other_guest, ApiError::NotFound(_)));
    }

    #[tokio::test]
    async fn write_only_staff_cannot_auto_claim_an_unassigned_conversation() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9811, "support-write@example.com").await;
        let created = service::create_guest_conversation(
            &pool,
            9811,
            create_request("create-9811-a"),
            None,
            None,
        )
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO users (id, uuid, username, email, password_hash, full_name, user_type, is_active)
            VALUES (9812, '00000000-0000-0000-0000-000000009812', 'support_writer_9812',
                    'support-writer-9812@example.com', 'hash', 'Support Writer', 'staff', 1)
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO roles (name, display_name) VALUES ('support_writer_9812', 'Support writer test')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            INSERT INTO user_roles (user_id, role_id)
            SELECT 9812, id FROM roles WHERE name = 'support_writer_9812'
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r CROSS JOIN permissions p
            WHERE r.name = 'support_writer_9812' AND p.name = 'support:write'
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let missing_version = service::send_staff_message(
            &pool,
            9812,
            created.conversation.id,
            SupportMessageRequest {
                message: "I will look into this.".to_string(),
                client_message_id: Some("staff-message-9812-a".to_string()),
                expected_version: None,
            },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(missing_version, ApiError::BadRequest(_)));

        let without_assignment_permission = service::send_staff_message(
            &pool,
            9812,
            created.conversation.id,
            SupportMessageRequest {
                message: "I will look into this.".to_string(),
                client_message_id: Some("staff-message-9812-a".to_string()),
                expected_version: Some(created.conversation.version),
            },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(
            without_assignment_permission,
            ApiError::Forbidden(_)
        ));
    }

    #[tokio::test]
    async fn resolve_sets_first_response_and_shares_the_resolution_with_the_guest() {
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9821, "support-resolution@example.com").await;
        let created = service::create_guest_conversation(
            &pool,
            9821,
            create_request("create-9821-a"),
            None,
            None,
        )
        .await
        .unwrap();

        let claimed = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            action("claim", created.conversation.version),
            None,
            None,
        )
        .await
        .unwrap();

        let mut resolved_action = action("resolve", claimed.conversation.summary.version);
        resolved_action.resolution_code = Some("maintenance_dispatched".to_string());
        resolved_action.resolution_summary =
            Some("Engineering has been asked to inspect the air conditioning.".to_string());
        let resolved = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            resolved_action,
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(resolved.conversation.summary.status, "resolved");
        assert!(resolved.conversation.summary.first_response_at.is_some());

        let guest_detail = service::get_guest_conversation(&pool, 9821, created.conversation.id)
            .await
            .unwrap();
        assert_eq!(
            guest_detail.conversation.resolution_summary.as_deref(),
            Some("Engineering has been asked to inspect the air conditioning.")
        );

        let archived_claim = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            action("claim", resolved.conversation.summary.version),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(archived_claim, ApiError::Conflict(_)));
    }
}
