//! Router-level coverage for the guest support chat and staff support queue.
//!
//! These tests use the real Axum router in memory instead of opening a TCP
//! listener, which keeps the coverage portable to restricted test sandboxes
//! while still exercising route registration, authentication, middleware, and
//! the `ConnectInfo` extractor used by mutation handlers.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use axum::{
        body::{Body, to_bytes},
        extract::ConnectInfo,
        http::{Method, Request, StatusCode, header},
        response::Response,
    };
    use hotel_app_be::core::{AuthService, config, rbac_cache, settings_cache};
    use hotel_app_be::routes::create_router;
    use serde_json::{Value, json};
    use sha2::{Digest, Sha256};
    use std::{
        net::SocketAddr,
        sync::Once,
    };
    use tower::ServiceExt;

    static INIT: Once = Once::new();

    fn init_config() {
        INIT.call_once(|| {
            // The configuration singleton is per integration-test binary. Set
            // the JWT secret before the router or test token generator reads it.
            unsafe {
                std::env::set_var(
                    "JWT_SECRET",
                    "support-routes-test-secret-key-32-chars",
                );
            }
            config::init_from_env().expect("test configuration should initialize");
        });
    }

    async fn seed_guest(pool: &sqlx::SqlitePool, guest_id: i64, email: &str) {
        sqlx::query(
            r#"
            INSERT INTO guests (id, first_name, last_name, full_name, email, phone)
            VALUES (?1, 'Portal', 'Support', 'Portal Support Guest', ?2, '60123456789')
            "#,
        )
        .bind(guest_id)
        .bind(email)
        .execute(pool)
        .await
        .unwrap();
    }

    fn session_hash(token: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        hex::encode(hasher.finalize())
    }

    async fn seed_guest_session(pool: &sqlx::SqlitePool, guest_id: i64, token: &str) {
        sqlx::query(
            "INSERT INTO guest_portal_sessions (guest_id, token_hash, expires_at) \
             VALUES (?1, ?2, datetime('now', '+1 day'))",
        )
        .bind(guest_id)
        .bind(session_hash(token))
        .execute(pool)
        .await
        .unwrap();
    }

    fn request(
        method: Method,
        uri: &str,
        bearer_token: Option<&str>,
        payload: Option<Value>,
    ) -> Request<Body> {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            // Production serves the app through `into_make_service_with_connect_info`.
            // Adding this extension mirrors that connection metadata in-process.
            .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 43123))));
        if let Some(token) = bearer_token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let body = if let Some(payload) = payload {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(serde_json::to_vec(&payload).unwrap())
        } else {
            Body::empty()
        };
        builder.body(body).unwrap()
    }

    async fn json_body(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn support_routes_enforce_auth_and_run_the_full_chat_cycle() {
        init_config();
        settings_cache::invalidate_all();
        rbac_cache::invalidate_all();
        let pool = common::setup_test_db().await;
        const OWNER_ID: i64 = 9861;
        const OTHER_GUEST_ID: i64 = 9862;
        const OWNER_TOKEN: &str = "portal-support-owner-token";
        const OTHER_TOKEN: &str = "portal-support-other-token";
        seed_guest(&pool, OWNER_ID, "portal-support-owner@example.com").await;
        seed_guest(&pool, OTHER_GUEST_ID, "portal-support-other@example.com").await;
        seed_guest_session(&pool, OWNER_ID, OWNER_TOKEN).await;
        seed_guest_session(&pool, OTHER_GUEST_ID, OTHER_TOKEN).await;

        let app = create_router(pool);
        let unauthorized_staff = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/api/support/conversations",
                None,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(unauthorized_staff.status(), StatusCode::UNAUTHORIZED);
        let unauthorized_guest = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/api/guest-portal/me/support/conversations",
                None,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(unauthorized_guest.status(), StatusCode::UNAUTHORIZED);

        let created_response = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/api/guest-portal/me/support/conversations",
                Some(OWNER_TOKEN),
                Some(json!({
                    "category": "stay",
                    "message": "The room air conditioning needs attention.",
                    "client_request_id": "route-create-9861"
                })),
            ))
            .await
            .unwrap();
        assert_eq!(created_response.status(), StatusCode::OK);
        let created = json_body(created_response).await;
        let conversation_id = created["conversation"]["id"].as_i64().unwrap();
        let create_version = created["conversation"]["version"].as_i64().unwrap();
        let guest_message = created["messages"][0].as_object().unwrap();
        assert!(!guest_message.contains_key("author_guest_id"));
        assert!(!guest_message.contains_key("author_name"));

        let foreign_detail = app
            .clone()
            .oneshot(request(
                Method::GET,
                &format!("/api/guest-portal/me/support/conversations/{conversation_id}"),
                Some(OTHER_TOKEN),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(foreign_detail.status(), StatusCode::NOT_FOUND);

        let admin_token = AuthService::generate_jwt(1, "admin".to_string(), vec!["admin".to_string()])
            .unwrap();
        let staff_list = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/api/support/conversations?queue=waiting_for_staff",
                Some(&admin_token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(staff_list.status(), StatusCode::OK);
        let staff_list_body = json_body(staff_list).await;
        assert!(staff_list_body["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|conversation| conversation["id"] == conversation_id));

        let agents = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/api/support/agents",
                Some(&admin_token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(agents.status(), StatusCode::OK);

        let staff_detail = app
            .clone()
            .oneshot(request(
                Method::GET,
                &format!("/api/support/conversations/{conversation_id}"),
                Some(&admin_token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(staff_detail.status(), StatusCode::OK);

        let claimed_response = app
            .clone()
            .oneshot(request(
                Method::POST,
                &format!("/api/support/conversations/{conversation_id}/actions"),
                Some(&admin_token),
                Some(json!({
                    "action": "claim",
                    "expected_version": create_version,
                    "client_action_id": "route-claim-9861"
                })),
            ))
            .await
            .unwrap();
        assert_eq!(claimed_response.status(), StatusCode::OK);
        let claimed = json_body(claimed_response).await;
        let claim_version = claimed["conversation"]["version"].as_i64().unwrap();

        let staff_reply_response = app
            .clone()
            .oneshot(request(
                Method::POST,
                &format!("/api/support/conversations/{conversation_id}/messages"),
                Some(&admin_token),
                Some(json!({
                    "message": "Engineering is checking the unit now.",
                    "client_message_id": "route-staff-message-9861",
                    "expected_version": claim_version
                })),
            ))
            .await
            .unwrap();
        assert_eq!(staff_reply_response.status(), StatusCode::OK);
        let staff_reply = json_body(staff_reply_response).await;
        let staff_reply_version = staff_reply["conversation"]["version"].as_i64().unwrap();

        let guest_detail = app
            .clone()
            .oneshot(request(
                Method::GET,
                &format!("/api/guest-portal/me/support/conversations/{conversation_id}"),
                Some(OWNER_TOKEN),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(guest_detail.status(), StatusCode::OK);
        let guest_detail = json_body(guest_detail).await;
        let staff_message = guest_detail["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|message| message["author_type"] == "staff")
            .unwrap()
            .as_object()
            .unwrap();
        assert!(!staff_message.contains_key("author_user_id"));
        assert!(!staff_message.contains_key("author_name"));

        let guest_reply_response = app
            .clone()
            .oneshot(request(
                Method::POST,
                &format!("/api/guest-portal/me/support/conversations/{conversation_id}/messages"),
                Some(OWNER_TOKEN),
                Some(json!({
                    "message": "Thank you. Please let me know when it is fixed.",
                    "client_message_id": "route-guest-message-9861",
                    "expected_version": staff_reply_version
                })),
            ))
            .await
            .unwrap();
        assert_eq!(guest_reply_response.status(), StatusCode::OK);
        let guest_reply = json_body(guest_reply_response).await;
        let guest_reply_version = guest_reply["conversation"]["version"].as_i64().unwrap();

        let resolved_response = app
            .clone()
            .oneshot(request(
                Method::POST,
                &format!("/api/support/conversations/{conversation_id}/actions"),
                Some(&admin_token),
                Some(json!({
                    "action": "resolve",
                    "expected_version": guest_reply_version,
                    "resolution_code": "maintenance_completed",
                    "resolution_summary": "Engineering repaired the air conditioning.",
                    "client_action_id": "route-resolve-9861"
                })),
            ))
            .await
            .unwrap();
        assert_eq!(resolved_response.status(), StatusCode::OK);

        let reopened_response = app
            .clone()
            .oneshot(request(
                Method::POST,
                &format!("/api/guest-portal/me/support/conversations/{conversation_id}/reopen"),
                Some(OWNER_TOKEN),
                Some(json!({})),
            ))
            .await
            .unwrap();
        assert_eq!(reopened_response.status(), StatusCode::OK);
        let reopened = json_body(reopened_response).await;
        assert_eq!(reopened["conversation"]["status"], "waiting_for_staff");
    }
}
