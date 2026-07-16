//! SQLite coverage for the guest support workflow's authorization and state rules.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::core::rate_limiter::RateLimiters;
    use hotel_app_be::core::{rbac_cache, settings_cache};
    use hotel_app_be::modules::support::models::{
        CreateGuestSupportConversationRequest, GuestSupportMessageRequest, SupportActionInput,
        SupportListQuery, SupportMessageRequest,
    };
    use hotel_app_be::modules::support::{service, validation};
    use std::net::{IpAddr, Ipv4Addr};
    use std::sync::LazyLock;

    // Settings and RBAC caches are process-global while every test uses an
    // isolated in-memory database. Serialize database-backed support tests so
    // a setting loaded from one database cannot bleed into another test.
    static SUPPORT_WORKFLOW_TEST_LOCK: LazyLock<tokio::sync::Mutex<()>> =
        LazyLock::new(|| tokio::sync::Mutex::new(()));

    async fn begin_support_workflow_test() -> tokio::sync::MutexGuard<'static, ()> {
        let guard = SUPPORT_WORKFLOW_TEST_LOCK.lock().await;
        settings_cache::invalidate_all();
        rbac_cache::invalidate_all();
        guard
    }

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

    fn create_request_for_category(
        category: &str,
        client_request_id: &str,
    ) -> CreateGuestSupportConversationRequest {
        CreateGuestSupportConversationRequest {
            category: category.to_string(),
            message: "The room air conditioning needs attention.".to_string(),
            booking_id: None,
            client_request_id: client_request_id.to_string(),
        }
    }

    async fn set_support_setting(pool: &sqlx::SqlitePool, key: &str, value: &str) {
        sqlx::query("UPDATE system_settings SET value = ?1 WHERE key = ?2")
            .bind(value)
            .bind(key)
            .execute(pool)
            .await
            .unwrap();
        settings_cache::invalidate_key(key);
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

    async fn seed_staff_member(
        pool: &sqlx::SqlitePool,
        user_id: i64,
        role_name: &str,
        is_active: bool,
        permissions: &[&str],
    ) {
        sqlx::query(
            r#"
            INSERT INTO users (id, uuid, username, email, password_hash, full_name, user_type, is_active)
            VALUES (?1, ?2, ?3, ?4, 'hash', ?5, 'staff', ?6)
            "#,
        )
        .bind(user_id)
        .bind(format!("00000000-0000-0000-0000-{user_id:012}"))
        .bind(format!("support_user_{user_id}"))
        .bind(format!("support-user-{user_id}@example.com"))
        .bind(format!("Support User {user_id}"))
        .bind(is_active)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO roles (name, display_name) VALUES (?1, ?2)")
            .bind(role_name)
            .bind(format!("{role_name} test role"))
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            r#"
            INSERT INTO user_roles (user_id, role_id)
            SELECT ?1, id FROM roles WHERE name = ?2
            "#,
        )
        .bind(user_id)
        .bind(role_name)
        .execute(pool)
        .await
        .unwrap();

        for permission in permissions {
            sqlx::query(
                r#"
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id
                FROM roles r CROSS JOIN permissions p
                WHERE r.name = ?1 AND p.name = ?2
                "#,
            )
            .bind(role_name)
            .bind(permission)
            .execute(pool)
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn guest_creation_is_idempotent_and_scoped_to_its_owner() {
        let _test_lock = begin_support_workflow_test().await;
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
        let _test_lock = begin_support_workflow_test().await;
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

        seed_staff_member(&pool, 9812, "support_writer_9812", true, &["support:write"]).await;

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
    async fn guest_messages_are_owner_scoped_versioned_and_idempotent() {
        let _test_lock = begin_support_workflow_test().await;
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9831, "support-message-owner@example.com").await;
        seed_guest(&pool, 9832, "support-message-other@example.com").await;
        let created = service::create_guest_conversation(
            &pool,
            9831,
            create_request("create-9831-a"),
            None,
            None,
        )
        .await
        .unwrap();

        let missing_version = service::send_guest_message(
            &pool,
            9831,
            created.conversation.id,
            GuestSupportMessageRequest {
                message: "Could you share an update?".to_string(),
                client_message_id: Some("guest-message-9831-a".to_string()),
                expected_version: None,
            },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(missing_version, ApiError::BadRequest(_)));

        let other_guest = service::send_guest_message(
            &pool,
            9832,
            created.conversation.id,
            GuestSupportMessageRequest {
                message: "Trying another guest's conversation.".to_string(),
                client_message_id: Some("guest-message-9832-a".to_string()),
                expected_version: Some(created.conversation.version),
            },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(other_guest, ApiError::NotFound(_)));

        let request = GuestSupportMessageRequest {
            message: "Could you share an update?".to_string(),
            client_message_id: Some("guest-message-9831-a".to_string()),
            expected_version: Some(created.conversation.version),
        };
        let replied =
            service::send_guest_message(&pool, 9831, created.conversation.id, request, None, None)
                .await
                .unwrap();
        assert_eq!(replied.messages.len(), 2);
        assert_eq!(replied.conversation.status, "waiting_for_staff");

        let replay = service::send_guest_message(
            &pool,
            9831,
            created.conversation.id,
            GuestSupportMessageRequest {
                message: "Could you share an update?".to_string(),
                client_message_id: Some("guest-message-9831-a".to_string()),
                expected_version: Some(created.conversation.version),
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(replay.messages.len(), 2);
        assert_eq!(replay.conversation.version, replied.conversation.version);

        let stale_version = service::send_guest_message(
            &pool,
            9831,
            created.conversation.id,
            GuestSupportMessageRequest {
                message: "A different retry should not overwrite new work.".to_string(),
                client_message_id: Some("guest-message-9831-b".to_string()),
                expected_version: Some(created.conversation.version),
            },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(stale_version, ApiError::Conflict(_)));
    }

    #[tokio::test]
    async fn guest_support_rate_limits_are_guest_scoped_and_have_a_shared_origin_ceiling() {
        let limiters = RateLimiters::new();

        for _ in 0..30 {
            assert!(
                limiters
                    .guest_portal_support_mutation
                    .check_with_retry("guest:9833")
                    .await
                    .0
            );
        }
        let (guest_allowed, guest_retry_after) = limiters
            .guest_portal_support_mutation
            .check_with_retry("guest:9833")
            .await;
        assert!(!guest_allowed);
        assert!(guest_retry_after > 0);
        assert!(
            limiters
                .guest_portal_support_mutation
                .check_with_retry("guest:9834")
                .await
                .0,
            "a separate guest must have an independent support-mutation budget"
        );

        let origin = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 44));
        for _ in 0..120 {
            assert!(
                limiters
                    .guest_portal_support_mutation_ip
                    .check_with_retry(origin)
                    .await
                    .0
            );
        }
        let (origin_allowed, origin_retry_after) = limiters
            .guest_portal_support_mutation_ip
            .check_with_retry(origin)
            .await;
        assert!(!origin_allowed);
        assert!(origin_retry_after > 0);
    }

    #[tokio::test]
    async fn assignment_requires_an_active_support_capable_agent_and_priority_rebases_sla() {
        let _test_lock = begin_support_workflow_test().await;
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9841, "support-assignment@example.com").await;
        seed_staff_member(
            &pool,
            9842,
            "support_write_only_9842",
            true,
            &["support:write"],
        )
        .await;
        seed_staff_member(
            &pool,
            9843,
            "support_agent_9843",
            true,
            &["support:read", "support:write"],
        )
        .await;
        seed_staff_member(
            &pool,
            9844,
            "inactive_support_agent_9844",
            false,
            &["support:read", "support:write"],
        )
        .await;

        let agents = service::list_support_agents(&pool).await.unwrap();
        assert!(agents.iter().any(|agent| agent.id == 9843));
        assert!(!agents.iter().any(|agent| agent.id == 9842));
        assert!(!agents.iter().any(|agent| agent.id == 9844));

        let created = service::create_guest_conversation(
            &pool,
            9841,
            create_request("create-9841-a"),
            None,
            None,
        )
        .await
        .unwrap();

        let mut write_only_assignment = action("assign", created.conversation.version);
        write_only_assignment.assignee_id = Some(9842);
        let write_only_error = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            write_only_assignment,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(write_only_error, ApiError::BadRequest(_)));

        let mut inactive_assignment = action("assign", created.conversation.version);
        inactive_assignment.assignee_id = Some(9844);
        let inactive_error = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            inactive_assignment,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(inactive_error, ApiError::BadRequest(_)));

        let mut assign_agent = action("assign", created.conversation.version);
        assign_agent.assignee_id = Some(9843);
        let assigned = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            assign_agent,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            assigned.conversation.summary.assigned_to_user_id,
            Some(9843)
        );

        let mut agent_priority = action("set_priority", assigned.conversation.summary.version);
        agent_priority.priority = Some("urgent".to_string());
        let missing_manage_permission = service::apply_staff_action(
            &pool,
            9843,
            created.conversation.id,
            agent_priority,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(missing_manage_permission, ApiError::Forbidden(_)));

        let mut priority_action = action("set_priority", assigned.conversation.summary.version);
        priority_action.priority = Some("urgent".to_string());
        let reprioritized = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            priority_action,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(reprioritized.conversation.summary.priority, "urgent");
        assert!(
            reprioritized.conversation.summary.first_response_due_at
                < assigned.conversation.summary.first_response_due_at
        );
        assert!(
            reprioritized.conversation.summary.resolution_due_at
                < assigned.conversation.summary.resolution_due_at
        );

        sqlx::query(
            "UPDATE support_conversations SET first_response_due_at = datetime('now', '+10 minutes') WHERE id = ?1",
        )
        .bind(created.conversation.id)
        .execute(&pool)
        .await
        .unwrap();
        let at_risk = service::list_staff_conversations(
            &pool,
            1,
            SupportListQuery {
                queue: Some("at_risk".to_string()),
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
        assert_eq!(at_risk.total, 1);
        assert_eq!(at_risk.items[0].id, created.conversation.id);
        assert!(at_risk.items[0].is_sla_at_risk);
        assert_eq!(at_risk.metrics.at_risk, 1);
    }

    #[tokio::test]
    async fn resolve_sets_first_response_and_shares_the_resolution_with_the_guest() {
        let _test_lock = begin_support_workflow_test().await;
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

        let mut close_action = action("close", resolved.conversation.summary.version);
        close_action.reason = Some("The guest confirmed the room is comfortable now.".to_string());
        let closed = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            close_action,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(closed.conversation.summary.status, "closed");
        assert!(closed.conversation.summary.closed_at.is_some());

        let mut reopen_action = action("reopen", closed.conversation.summary.version);
        reopen_action.reason = Some("The guest called back with a follow-up question.".to_string());
        let reopened = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            reopen_action,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(reopened.conversation.summary.status, "waiting_for_staff");
        assert_eq!(reopened.conversation.reopen_count, 1);
        assert!(reopened.conversation.resolution_code.is_none());
        assert!(reopened.conversation.resolution_summary.is_none());
        assert!(reopened.conversation.summary.resolution_due_at.is_some());
    }

    #[tokio::test]
    async fn guest_intake_honors_runtime_enablement_and_category_configuration() {
        let _test_lock = begin_support_workflow_test().await;
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9851, "support-settings@example.com").await;

        set_support_setting(
            &pool,
            "support_categories",
            r#"["billing","not-a-category","BILLING"]"#,
        )
        .await;

        let list = service::list_guest_conversations(&pool, 9851, None, None)
            .await
            .unwrap();
        assert!(list.enabled);
        assert_eq!(list.categories, vec!["billing"]);

        let unavailable_category = service::create_guest_conversation(
            &pool,
            9851,
            create_request("create-9851-stay"),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(unavailable_category, ApiError::BadRequest(_)));

        let created = service::create_guest_conversation(
            &pool,
            9851,
            create_request_for_category(" BILLING ", "create-9851-billing"),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(created.conversation.category, "billing");

        set_support_setting(&pool, "support_enabled", "false").await;
        let disabled_list = service::list_guest_conversations(&pool, 9851, None, None)
            .await
            .unwrap();
        assert!(!disabled_list.enabled);
        assert_eq!(disabled_list.total, 1, "existing conversations remain readable");

        let disabled_intake = service::create_guest_conversation(
            &pool,
            9851,
            create_request_for_category("billing", "create-9851-disabled"),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(disabled_intake, ApiError::Forbidden(_)));
    }

    #[tokio::test]
    async fn guest_reopen_paths_enforce_the_window_and_reset_resolution_state() {
        let _test_lock = begin_support_workflow_test().await;
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9852, "support-reopen@example.com").await;

        let created = service::create_guest_conversation(
            &pool,
            9852,
            create_request("create-9852-reopen"),
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
        let mut resolve = action("resolve", claimed.conversation.summary.version);
        resolve.resolution_code = Some("maintenance_dispatched".to_string());
        resolve.resolution_summary = Some("Engineering has been notified.".to_string());
        let resolved = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            resolve,
            None,
            None,
        )
        .await
        .unwrap();

        let guest_reply = service::send_guest_message(
            &pool,
            9852,
            created.conversation.id,
            GuestSupportMessageRequest {
                message: "The issue has returned.".to_string(),
                client_message_id: Some("guest-reopen-message-9852".to_string()),
                expected_version: Some(resolved.conversation.summary.version),
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(guest_reply.conversation.status, "waiting_for_staff");
        assert!(guest_reply.conversation.resolution_summary.is_none());
        assert_eq!(
            service::get_staff_conversation(&pool, created.conversation.id)
                .await
                .unwrap()
                .conversation
                .reopen_count,
            1
        );

        let mut resolve_again = action("resolve", guest_reply.conversation.version);
        resolve_again.resolution_code = Some("maintenance_rechecked".to_string());
        resolve_again.resolution_summary = Some("Engineering completed a follow-up check.".to_string());
        let resolved_again = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            resolve_again,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(resolved_again.conversation.summary.status, "resolved");
        let explicitly_reopened = service::reopen_guest_conversation(
            &pool,
            9852,
            created.conversation.id,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(explicitly_reopened.conversation.status, "waiting_for_staff");
        assert_eq!(
            service::get_staff_conversation(&pool, created.conversation.id)
                .await
                .unwrap()
                .conversation
                .reopen_count,
            2
        );
        let reopen_replay = service::reopen_guest_conversation(
            &pool,
            9852,
            created.conversation.id,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            reopen_replay.conversation.version,
            explicitly_reopened.conversation.version,
            "an already-open conversation is a safe reopen retry"
        );

        let expired = service::create_guest_conversation(
            &pool,
            9852,
            create_request("create-9852-expired-reopen"),
            None,
            None,
        )
        .await
        .unwrap();
        let expired_claim = service::apply_staff_action(
            &pool,
            1,
            expired.conversation.id,
            action("claim", expired.conversation.version),
            None,
            None,
        )
        .await
        .unwrap();
        let mut expired_resolve = action("resolve", expired_claim.conversation.summary.version);
        expired_resolve.resolution_code = Some("completed".to_string());
        expired_resolve.resolution_summary = Some("The original request has been completed.".to_string());
        let expired_resolved = service::apply_staff_action(
            &pool,
            1,
            expired.conversation.id,
            expired_resolve,
            None,
            None,
        )
        .await
        .unwrap();
        sqlx::query(
            "UPDATE support_conversations SET resolved_at = datetime('now', '-8 days') WHERE id = ?1",
        )
        .bind(expired.conversation.id)
        .execute(&pool)
        .await
        .unwrap();

        let expired_detail = service::get_guest_conversation(&pool, 9852, expired.conversation.id)
            .await
            .unwrap();
        assert!(!expired_detail.conversation.can_reopen);
        let expired_reopen = service::reopen_guest_conversation(
            &pool,
            9852,
            expired.conversation.id,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(expired_reopen, ApiError::Conflict(_)));
        let expired_message = service::send_guest_message(
            &pool,
            9852,
            expired.conversation.id,
            GuestSupportMessageRequest {
                message: "Please reopen this old request.".to_string(),
                client_message_id: Some("guest-expired-reopen-message".to_string()),
                expected_version: Some(expired_resolved.conversation.summary.version),
            },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(expired_message, ApiError::Conflict(_)));
    }

    #[tokio::test]
    async fn staff_workflow_covers_replies_actions_ownership_and_idempotency() {
        let _test_lock = begin_support_workflow_test().await;
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9853, "support-staff-workflow@example.com").await;
        seed_staff_member(
            &pool,
            9854,
            "support_writer_9854",
            true,
            &["support:write", "support:assign"],
        )
        .await;
        seed_staff_member(
            &pool,
            9855,
            "support_replacement_9855",
            true,
            &["support:read", "support:write"],
        )
        .await;
        seed_staff_member(
            &pool,
            9856,
            "support_escalator_9856",
            true,
            &["support:escalate"],
        )
        .await;

        let created = service::create_guest_conversation(
            &pool,
            9853,
            create_request("create-9853-staff-workflow"),
            None,
            None,
        )
        .await
        .unwrap();

        let claim_request = action("claim", created.conversation.version);
        let claimed = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            claim_request.clone(),
            None,
            None,
        )
        .await
        .unwrap();
        let claim_replay = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            claim_request,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            claim_replay.conversation.summary.version,
            claimed.conversation.summary.version,
            "replaying an action key must not apply the claim twice"
        );

        let released = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            action("release", claimed.conversation.summary.version),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(released.conversation.summary.assigned_to_user_id, None);

        let staff_reply_request = SupportMessageRequest {
            message: "I am reviewing this for you now.".to_string(),
            client_message_id: Some("staff-reply-9854".to_string()),
            expected_version: Some(released.conversation.summary.version),
        };
        let replied = service::send_staff_message(
            &pool,
            9854,
            created.conversation.id,
            staff_reply_request,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(replied.conversation.summary.status, "waiting_for_guest");
        assert_eq!(replied.conversation.summary.assigned_to_user_id, Some(9854));
        assert!(replied.conversation.summary.first_response_at.is_some());
        let reply_replay = service::send_staff_message(
            &pool,
            9854,
            created.conversation.id,
            SupportMessageRequest {
                message: "I am reviewing this for you now.".to_string(),
                client_message_id: Some("staff-reply-9854".to_string()),
                expected_version: Some(released.conversation.summary.version),
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(reply_replay.messages.len(), replied.messages.len());
        assert_eq!(
            reply_replay.conversation.summary.version,
            replied.conversation.summary.version
        );

        let mut note_request = action("add_internal_note", replied.conversation.summary.version);
        note_request.reason = Some("Guest prefers a quiet follow-up call.".to_string());
        let noted = service::apply_staff_action(
            &pool,
            9854,
            created.conversation.id,
            note_request.clone(),
            None,
            None,
        )
        .await
        .unwrap();
        let internal_note = noted
            .events
            .iter()
            .find(|event| event.event_type == "internal_note")
            .expect("internal note event should be recorded");
        assert_eq!(
            internal_note.body.as_deref(),
            Some("Guest prefers a quiet follow-up call.")
        );

        let release_request = action("release", noted.conversation.summary.version);
        let released_by_writer = service::apply_staff_action(
            &pool,
            9854,
            created.conversation.id,
            release_request.clone(),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(released_by_writer.conversation.summary.assigned_to_user_id, None);
        let release_replay_after_handoff = service::apply_staff_action(
            &pool,
            9854,
            created.conversation.id,
            release_request,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(release_replay_after_handoff, ApiError::Conflict(_)));

        let mut assign_replacement = action(
            "assign",
            released_by_writer.conversation.summary.version,
        );
        assign_replacement.assignee_id = Some(9855);
        let reassigned = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            assign_replacement,
            None,
            None,
        )
        .await
        .unwrap();
        let replay_after_reassignment = service::send_staff_message(
            &pool,
            9854,
            created.conversation.id,
            SupportMessageRequest {
                message: "I am reviewing this for you now.".to_string(),
                client_message_id: Some("staff-reply-9854".to_string()),
                expected_version: Some(released.conversation.summary.version),
            },
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(replay_after_reassignment, ApiError::Forbidden(_)));

        let note_replay_after_reassignment = service::apply_staff_action(
            &pool,
            9854,
            created.conversation.id,
            note_request,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(note_replay_after_reassignment, ApiError::Forbidden(_)));

        let no_reason = service::apply_staff_action(
            &pool,
            9856,
            created.conversation.id,
            action("escalate", reassigned.conversation.summary.version),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(no_reason, ApiError::BadRequest(_)));

        let mut escalated = reassigned;
        for expected_level in 1..=4 {
            let mut escalation = action(
                "escalate",
                escalated.conversation.summary.version,
            );
            escalation.reason = Some(format!("Escalation step {expected_level}"));
            escalated = service::apply_staff_action(
                &pool,
                9856,
                created.conversation.id,
                escalation,
                None,
                None,
            )
            .await
            .unwrap();
            assert_eq!(
                escalated.conversation.summary.escalation_level,
                expected_level.min(3)
            );
            assert_eq!(escalated.conversation.summary.assigned_to_user_id, None);
            assert_eq!(escalated.conversation.summary.queue, "duty_manager");
        }

        let mut missing_version = action("set_priority", escalated.conversation.summary.version);
        missing_version.expected_version = None;
        missing_version.priority = Some("high".to_string());
        let missing_version_error = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            missing_version,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(missing_version_error, ApiError::BadRequest(_)));

        let mut stale_priority = action("set_priority", created.conversation.version);
        stale_priority.priority = Some("high".to_string());
        stale_priority.client_action_id = Some("stale-priority-9853".to_string());
        let stale_priority_error = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            stale_priority,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(stale_priority_error, ApiError::Conflict(_)));

        let mut priority = action("set_priority", escalated.conversation.summary.version);
        priority.priority = Some("high".to_string());
        let reprioritized = service::apply_staff_action(
            &pool,
            1,
            created.conversation.id,
            priority,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(reprioritized.conversation.summary.priority, "high");
    }

    #[tokio::test]
    async fn guest_message_payloads_are_an_explicit_safe_allow_list() {
        let _test_lock = begin_support_workflow_test().await;
        let pool = common::setup_test_db().await;
        seed_guest(&pool, 9857, "support-message-shape@example.com").await;
        let created = service::create_guest_conversation(
            &pool,
            9857,
            create_request("create-9857-message-shape"),
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
        let staff_detail = service::send_staff_message(
            &pool,
            1,
            created.conversation.id,
            SupportMessageRequest {
                message: "A staff-only identity must remain in the internal queue.".to_string(),
                client_message_id: Some("staff-message-shape".to_string()),
                expected_version: Some(claimed.conversation.summary.version),
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert!(
            staff_detail
                .messages
                .iter()
                .any(|message| message.author_user_id == Some(1)),
            "staff responses retain internal author linkage"
        );

        let guest_detail = service::get_guest_conversation(&pool, 9857, created.conversation.id)
            .await
            .unwrap();
        let payload = serde_json::to_value(guest_detail).unwrap();
        let staff_message = payload["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|message| message["author_type"] == "staff")
            .unwrap()
            .as_object()
            .unwrap();
        let mut fields = staff_message.keys().cloned().collect::<Vec<_>>();
        fields.sort();
        assert_eq!(fields, vec!["author_type", "body", "created_at", "id"]);
        for forbidden_field in ["author_user_id", "author_guest_id", "author_name"] {
            assert!(
                !staff_message.contains_key(forbidden_field),
                "guest messages must not expose {forbidden_field}"
            );
        }
    }

    #[test]
    fn support_validation_and_database_contracts_stay_aligned() {
        let max_code = "r".repeat(validation::MAX_RESOLUTION_CODE_CHARS);
        assert_eq!(
            validation::sanitize_resolution_code(Some(max_code.clone())).unwrap(),
            Some(max_code)
        );
        assert!(matches!(
            validation::sanitize_resolution_code(Some(
                "r".repeat(validation::MAX_RESOLUTION_CODE_CHARS + 1)
            )),
            Err(ApiError::BadRequest(_))
        ));

        let postgres_schema = include_str!("../database/schema.sql");
        let sqlite_schema = include_str!("../database/sqlite_schema.sql");
        for (schema_name, schema) in [("PostgreSQL", postgres_schema), ("SQLite", sqlite_schema)] {
            assert!(schema.contains("support_guest_request_idempotency_keys"));
            assert!(schema.contains("PRIMARY KEY (guest_id, idempotency_key)"));
            assert!(schema.contains("uq_support_messages_client_id"));
            assert!(schema.contains("resolution_summary"));
            assert!(
                schema.contains("support_conversations"),
                "{schema_name} must define the support conversation table"
            );
        }
        assert!(postgres_schema.contains("resolution_code VARCHAR(64)"));
        assert!(postgres_schema.contains("idempotency_key VARCHAR(128)"));
        assert!(sqlite_schema.contains("resolution_code TEXT"));
        assert!(sqlite_schema.contains("idempotency_key TEXT"));
    }
}
