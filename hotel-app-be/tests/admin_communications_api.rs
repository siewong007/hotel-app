//! Integration tests for the admin notification-center delivery feed
//! (`GET /api/admin/communications/deliveries`).
//!
//! Covers permission denial, tier derivation vs `TRANSACTIONAL_KINDS`,
//! masking, unread math, pagination, and param validation against live
//! PostgreSQL. Skipped without `DATABASE_URL`.

use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
};
use chrono::Utc;
use jsonwebtoken::{EncodingKey, Header, encode};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

const TEST_JWT_SECRET: &str = "hotel-app-be-comms-center-test-secret-32chars";
const ACTOR_ID: i64 = 979_001;
const GUEST_ID: i64 = 979_201;

fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn ensure_jwt_secret() {
    let _ = hotel_app_be::core::auth::AuthService::init_jwt_secret(TEST_JWT_SECRET);
}

fn auth_headers(user_id: i64) -> HeaderMap {
    ensure_jwt_secret();
    let claims = hotel_app_be::core::auth::Claims {
        sub: user_id.to_string(),
        username: format!("comms_actor_{user_id}"),
        iss: "hotel-app-be".to_string(),
        aud: "hotel-web".to_string(),
        exp: Some((Utc::now().timestamp() + 1_800) as usize),
        iat: Utc::now().timestamp() as usize,
        roles: vec!["staff".to_string()],
        sid: None,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .expect("encoding a test JWT must succeed");

    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().expect("valid bearer"),
    );
    headers
}

async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return None,
    };
    let guard = pg_serial_lock().lock_owned().await;
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some((pool, guard))
}

mod postgres_tests {
    use super::*;

    async fn seed_actor(pool: &PgPool, actor_id: i64) {
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
             ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, is_active = true",
        )
        .bind(actor_id)
        .bind(format!("comms_actor_{actor_id}"))
        .bind(format!("comms-actor-{actor_id}@hotel.local"))
        .bind(format!("Comms Actor {actor_id}"))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn grant_permissions(pool: &PgPool, actor_id: i64, permissions: &[&str]) {
        let role_name = format!("comms_center_role_{actor_id}");
        sqlx::query(
            "INSERT INTO roles (name, display_name, description, is_system_role, priority) \
             VALUES ($1, $1, 'notification center test role', false, 50) \
             ON CONFLICT (name) DO NOTHING",
        )
        .bind(&role_name)
        .execute(pool)
        .await
        .unwrap();
        for permission in permissions {
            let (resource, action) = permission.split_once(':').unwrap();
            sqlx::query(
                "INSERT INTO permissions (name, resource, action, description, is_system_permission) \
                 VALUES ($1, $2, $3, $1, true) \
                 ON CONFLICT (name) DO NOTHING",
            )
            .bind(permission)
            .bind(resource)
            .bind(action)
            .execute(pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO role_permissions (role_id, permission_id) \
                 SELECT r.id, p.id FROM roles r CROSS JOIN permissions p \
                 WHERE r.name = $1 AND p.name = $2 \
                 ON CONFLICT DO NOTHING",
            )
            .bind(&role_name)
            .bind(permission)
            .execute(pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = $2 \
             ON CONFLICT DO NOTHING",
        )
        .bind(actor_id)
        .bind(&role_name)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Insert one outbox row straight through the repository so kind/topic
    /// vocabulary stays honest.
    async fn seed_delivery(
        pool: &PgPool,
        suffix: &str,
        kind: &str,
        topic: &str,
        status: &str,
    ) {
        let mut tx = pool.begin().await.unwrap();
        hotel_app_be::modules::communications::repository::CommunicationsRepository::insert_delivery_tx(
            &mut tx,
            hotel_app_be::modules::communications::repository::DeliveryValues {
                campaign_id: None,
                kind,
                guest_id: GUEST_ID,
                topic,
                recipient_email: "center-guest@hotel.local",
                subject: "Notification center fixture",
                body_html: "<p>fixture</p>",
                body_text: None,
                voucher_id: None,
                idempotency_key: &format!("center-test:{suffix}"),
            },
        )
        .await
        .unwrap();
        // Force the requested status post-insert (default is queued).
        if status != "queued" {
            sqlx::query("UPDATE email_deliveries SET status = $1 WHERE idempotency_key = $2")
                .bind(status)
                .bind(format!("center-test:{suffix}"))
                .execute(&mut *tx)
                .await
                .unwrap();
        }
        tx.commit().await.unwrap();
    }

    async fn cleanup(pool: &PgPool) {
        sqlx::query("DELETE FROM email_deliveries WHERE guest_id = $1")
            .bind(GUEST_ID)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM team_members WHERE user_id = $1")
            .bind(ACTOR_ID)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(ACTOR_ID)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM roles WHERE name = $1 AND is_system_role = false",
        )
        .bind(format!("comms_center_role_{ACTOR_ID}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(GUEST_ID)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn call_feed(
        pool: &PgPool,
        actor_id: i64,
        tier: Option<&str>,
        status: Option<&str>,
        page: Option<i64>,
        page_size: Option<i64>,
    ) -> Result<
        hotel_app_be::modules::communications::models::DeliveryFeedResponse,
        hotel_app_be::core::error::ApiError,
    > {
        let query = hotel_app_be::modules::communications::models::DeliveryFeedQuery {
            tier: tier.map(str::to_string),
            status: status.map(str::to_string),
            page,
            page_size,
        };
        hotel_app_be::modules::communications::handlers::list_admin_deliveries_handler(
            State(pool.clone()),
            auth_headers(actor_id),
            Query(query),
        )
        .await
        .map(|Json(body)| body)
    }

    #[tokio::test]
    async fn delivery_feed_enforces_permission_tiers_unread_and_pagination() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        cleanup(&pool).await;
        seed_actor(&pool, ACTOR_ID).await;

        // Actor WITHOUT the permission first.
        grant_permissions(&pool, ACTOR_ID, &[]).await;
        let denied = call_feed(&pool, ACTOR_ID, None, None, None, None).await;
        assert!(
            matches!(denied, Err(hotel_app_be::core::error::ApiError::Forbidden(_))),
            "feed must deny actors without communications:read, got {denied:?}"
        );

        grant_permissions(&pool, ACTOR_ID, &["communications:read"]).await;
        // The deny-check above resolved the actor through the TTL-cached
        // permission reader; drop the cache so the fresh grant is visible.
        hotel_app_be::core::rbac_cache::invalidate_all();

        // Seed a guest plus a mixed-status spread across both tiers.
        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name, email) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'Center Guest', 'Center', 'Guest', 'center-guest@hotel.local')",
        )
        .bind(GUEST_ID)
        .execute(&pool)
        .await
        .unwrap();

        seed_delivery(&pool, "tx-queued", "checkout_receipt", "checkout_receipt", "queued").await;
        seed_delivery(&pool, "tx-sending", "booking_confirmation", "booking_confirmation", "sending").await;
        seed_delivery(&pool, "mkt-done", "birthday_voucher", "birthday_voucher", "sent").await;

        // Unknown tier must be rejected outright.
        assert!(call_feed(&pool, ACTOR_ID, Some("urgent"), None, None, None).await.is_err());

        // ---- all ----
        let all = call_feed(&pool, ACTOR_ID, Some("all"), None, None, None)
            .await
            .expect("all-tier feed should succeed");
        assert_eq!(all.items.len(), 3);
        assert_eq!(all.total, 3);
        // Unread counts queued+sending only, independent of filters.
        assert_eq!(all.unread, 2);

        // Masking invariant: raw local-part never appears in any payload item.
        for item in &all.items {
            assert!(
                !item.summary.recipient_masked.contains("center-guest"),
                "raw recipient leaked: {}",
                item.summary.recipient_masked
            );
        }

        // Tier split matches TRANSACTIONAL_KINDS exactly.
        let transactional = call_feed(&pool, ACTOR_ID, Some("transactional"), None, None, None)
            .await
            .expect("transactional feed should succeed");
        assert_eq!(transactional.total, 2);
        assert!(
            transactional
                .items
                .iter()
                .all(|item| item.tier == "transactional")
        );

        let marketing = call_feed(&pool, ACTOR_ID, Some("marketing"), None, None, None)
            .await
            .expect("marketing feed should succeed");
        assert_eq!(marketing.total, 1);
        assert_eq!(marketing.items[0].tier, "marketing");
        assert_eq!(marketing.items[0].summary.kind, "birthday_voucher");

        // Status filter narrows within a tier.
        let queued_tx =
            call_feed(&pool, ACTOR_ID, Some("transactional"), Some("queued"), None, None)
                .await
                .expect("status-filtered feed should succeed");
        assert_eq!(queued_tx.total, 1);
        assert_eq!(queued_tx.items[0].summary.status, "queued");

        // Pagination math: page_size=2 on `all` yields 2 rows but total=3.
        let page_one = call_feed(&pool, ACTOR_ID, Some("all"), None, Some(1), Some(2))
            .await
            .expect("paged feed should succeed");
        assert_eq!(page_one.items.len(), 2);
        assert_eq!(page_one.total, 3);

        cleanup(&pool).await;
    }
}
