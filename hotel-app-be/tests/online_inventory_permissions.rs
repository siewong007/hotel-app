//! HTTP-level coverage for online-inventory writes, driven through the real
//! router:
//!
//! - writes need `online_inventory:manage`: `admin` and `manager` may change
//!   cells; `receptionist`, `housekeeping` and `staff` get 403. Viewing stays
//!   on `rooms:update`, so receptionist and housekeeping can still read the
//!   window while staff cannot;
//! - optimistic concurrency: each cell carries `updated_at`; a stale
//!   `expected_updated_at` (or `null` when another admin created the row
//!   meanwhile) returns 409 `stale_write` naming every conflicting cell and
//!   writes nothing, not even the cells that were current;
//! - custom prices must be plain decimals, positive, with at most two
//!   decimal places (`"1e3"`, `"199.999"`, `"0"` and `"-5"` are 400s with a
//!   message saying why).
//!
//! Fixture users live in the `920_970_0xx` id band and fixture cells in
//! March 2036; both are removed before and after each test. Runs only with
//! `DATABASE_URL` set.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode, header};
use chrono::NaiveDate;
use hotel_app_be::AuthService;
use serde_json::{Value, json};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::collections::HashMap;
use std::net::SocketAddr;
use tower::ServiceExt;

static FIXTURE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const TEST_JWT_SECRET: &str = "hotel-app-be-online-inv-secret-32chars!";
const PEER: SocketAddr = SocketAddr::new(
    std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 241, 0, 1)),
    40_000,
);

/// (id, username, system role)
const ACTORS: [(i64, &str, &str); 5] = [
    (920_970_001, "oi_perm_admin", "admin"),
    (920_970_002, "oi_perm_manager", "manager"),
    (920_970_003, "oi_perm_receptionist", "receptionist"),
    (920_970_004, "oi_perm_housekeeping", "housekeeping"),
    (920_970_005, "oi_perm_staff", "staff"),
];
const ADMIN: i64 = 920_970_001;
const MANAGER: i64 = 920_970_002;
const RECEPTIONIST: i64 = 920_970_003;
const HOUSEKEEPING: i64 = 920_970_004;
const STAFF: i64 = 920_970_005;

const DAY_1: &str = "2036-03-02";
const DAY_2: &str = "2036-03-03";
const DAY_3: &str = "2036-03-04";

struct Fixture {
    pool: PgPool,
    app: axum::Router,
    sessions: HashMap<i64, String>,
    room_type_id: i64,
}

impl Fixture {
    async fn new() -> Option<Self> {
        use hotel_app_be::{core, routes};

        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping online-inventory permission tests: DATABASE_URL is not set");
                return None;
            }
        };
        unsafe {
            std::env::set_var("JWT_SECRET", TEST_JWT_SECRET);
        }
        core::config::init_from_env().expect("test app configuration must initialize");
        AuthService::init_jwt_secret(TEST_JWT_SECRET)
            .expect("test JWT secret must satisfy production validation");

        let pool = PgPoolOptions::new()
            .max_connections(4)
            // Deleting a `users` fixture fires `audit_logs`'s ON DELETE SET
            // NULL into an append-only table; opt out session-locally like
            // the sibling auth fixtures do.
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
            .expect("test database must connect");

        let room_type_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM room_types WHERE is_active = true ORDER BY id LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .expect("room type query must run");
        let Some(room_type_id) = room_type_id else {
            eprintln!("Skipping online-inventory permission tests: no active room type");
            return None;
        };

        Self::cleanup(&pool, room_type_id).await;
        let mut sessions = HashMap::new();
        for (id, username, role) in ACTORS {
            sqlx::query(
                "INSERT INTO users \
                 (id, username, email, full_name, user_type, is_active, is_verified, \
                  is_locked, is_super_admin) \
                 OVERRIDING SYSTEM VALUE \
                 VALUES ($1, $2, $3, 'Online Inventory Actor', 'staff', true, true, false, false) \
                 ON CONFLICT (id) DO UPDATE SET \
                     username = EXCLUDED.username, email = EXCLUDED.email, \
                     is_active = true, is_verified = true, is_locked = false, \
                     is_super_admin = false, deleted_at = NULL",
            )
            .bind(id)
            .bind(username)
            .bind(format!("{username}@hotel.local"))
            .execute(&pool)
            .await
            .expect("actor fixture must insert");
            sqlx::query(
                "INSERT INTO user_roles (user_id, role_id) \
                 SELECT $1, id FROM roles WHERE name = $2 \
                 ON CONFLICT (user_id, role_id) DO NOTHING",
            )
            .bind(id)
            .bind(role)
            .execute(&pool)
            .await
            .expect("system role grant must insert");

            let refresh_token = AuthService::generate_refresh_token();
            let session_id = AuthService::store_refresh_token(
                &pool,
                id,
                &refresh_token,
                1,
                Some("127.0.0.1"),
                Some("online-inventory-test"),
                None,
            )
            .await
            .expect("session fixture must insert");
            let token = AuthService::generate_session_jwt(
                id,
                username.to_string(),
                vec![role.to_string()],
                session_id,
            )
            .expect("access token must encode");
            sessions.insert(id, format!("Bearer {token}"));
        }
        core::rbac_cache::clear_all();

        Some(Self {
            app: routes::create_router(pool.clone()),
            pool,
            sessions,
            room_type_id,
        })
    }

    async fn cleanup(pool: &PgPool, room_type_id: i64) {
        sqlx::query(
            "DELETE FROM online_inventory_allocations \
             WHERE room_type_id = $1 AND stay_date BETWEEN $2 AND $3",
        )
        .bind(room_type_id)
        .bind(date(DAY_1))
        .bind(date(DAY_3))
        .execute(pool)
        .await
        .expect("allocation cleanup must run");
        let ids: Vec<i64> = ACTORS.iter().map(|(id, _, _)| *id).collect();
        for table in ["refresh_tokens", "user_roles"] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DELETE FROM {table} WHERE user_id = ANY($1)"
            )))
            .bind(&ids)
            .execute(pool)
            .await
            .expect("fixture cleanup must run");
        }
        sqlx::query("DELETE FROM users WHERE id = ANY($1)")
            .bind(&ids)
            .execute(pool)
            .await
            .expect("actor cleanup must run");
        hotel_app_be::core::rbac_cache::clear_all();
    }

    async fn finish(self) {
        Self::cleanup(&self.pool, self.room_type_id).await;
    }

    async fn call(
        &self,
        method: &str,
        uri: &str,
        user: i64,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::AUTHORIZATION, &self.sessions[&user]);
        if body.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        let mut request = builder
            .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
            .expect("request must build");
        request.extensions_mut().insert(ConnectInfo(PEER));
        let response = self
            .app
            .clone()
            .oneshot(request)
            .await
            .expect("router must respond");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body must read");
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn list(&self, user: i64) -> (StatusCode, Value) {
        self.call(
            "GET",
            &format!("/api/admin/online-inventory?from={DAY_1}&to={DAY_3}"),
            user,
            None,
        )
        .await
    }

    async fn bulk(&self, user: i64, cells: Value) -> (StatusCode, Value) {
        self.call(
            "PUT",
            "/api/admin/online-inventory/bulk",
            user,
            Some(json!({ "cells": cells })),
        )
        .await
    }

    /// The fixture room type's cell for `day` as the admin sees it now.
    async fn cell(&self, day: &str) -> Value {
        let (status, body) = self.list(ADMIN).await;
        assert_eq!(status, StatusCode::OK);
        body.as_array()
            .expect("list returns an array")
            .iter()
            .find(|c| c["room_type_id"] == self.room_type_id && c["stay_date"] == day)
            .cloned()
            .expect("fixture cell must be listed")
    }

    fn set(&self, day: &str, hold: i32, price: Value, expected: Value) -> Value {
        json!({
            "room_type_id": self.room_type_id,
            "stay_date": day,
            "walk_in_reserved_rooms": hold,
            "online_booking_enabled": true,
            "custom_price": price,
            "expected_updated_at": expected,
        })
    }
}

fn date(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("fixture date")
}

#[tokio::test]
async fn only_admin_and_manager_can_change_online_inventory() {
    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fx) = Fixture::new().await else {
        return;
    };

    for (user, can_view) in [
        (ADMIN, true),
        (MANAGER, true),
        (RECEPTIONIST, true),
        (HOUSEKEEPING, true),
        (STAFF, false),
    ] {
        let (status, _) = fx.list(user).await;
        let expected = if can_view {
            StatusCode::OK
        } else {
            StatusCode::FORBIDDEN
        };
        assert_eq!(status, expected, "GET as user {user}");
    }

    for user in [ADMIN, MANAGER] {
        let (status, body) = fx
            .bulk(
                user,
                json!([fx.set(DAY_1, 1, json!("120.00"), Value::Null)]),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "bulk PUT as user {user}: {body}");
        let (status, body) = fx
            .bulk(
                user,
                json!([{ "room_type_id": fx.room_type_id, "stay_date": DAY_1, "reset": true }]),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "reset as user {user}: {body}");

        let (status, body) = fx
            .call(
                "PUT",
                &format!("/api/admin/online-inventory/{}/{DAY_2}", fx.room_type_id),
                user,
                Some(json!({ "walk_in_reserved_rooms": 0, "online_booking_enabled": false, "custom_price": null })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "single PUT as user {user}: {body}");
        fx.bulk(
            user,
            json!([{ "room_type_id": fx.room_type_id, "stay_date": DAY_2, "reset": true }]),
        )
        .await;
    }

    for user in [RECEPTIONIST, HOUSEKEEPING, STAFF] {
        let (status, body) = fx
            .bulk(
                user,
                json!([fx.set(DAY_1, 1, json!("120.00"), Value::Null)]),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "bulk PUT as user {user}");
        assert_eq!(body["code"], "forbidden");
        assert!(
            body["error"]
                .as_str()
                .unwrap_or_default()
                .contains("online_inventory:manage"),
            "403 names the missing permission: {body}"
        );
        let (status, _) = fx
            .call(
                "PUT",
                &format!("/api/admin/online-inventory/{}/{DAY_1}", fx.room_type_id),
                user,
                Some(json!({ "walk_in_reserved_rooms": 0, "online_booking_enabled": false, "custom_price": null })),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "single PUT as user {user}");
    }
    assert_eq!(
        fx.cell(DAY_1).await["is_override"],
        false,
        "denied writes left no row"
    );

    fx.finish().await;
}

#[tokio::test]
async fn stale_saves_return_409_and_write_nothing() {
    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fx) = Fixture::new().await else {
        return;
    };

    // Both admins loaded the window before either saved: no rows, so every
    // cell's updated_at is null.
    let loaded = fx.cell(DAY_1).await;
    assert_eq!(loaded["is_override"], false);
    assert_eq!(loaded["updated_at"], Value::Null);

    // Admin A creates DAY_1 against the "no row" precondition.
    let (status, body) = fx
        .bulk(
            ADMIN,
            json!([fx.set(DAY_1, 0, json!("180.00"), Value::Null)]),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let after_a = fx.cell(DAY_1).await;
    assert_eq!(after_a["custom_price"], "180.00");
    let version_a = after_a["updated_at"].clone();
    assert!(version_a.is_string(), "a stored row reports its updated_at");

    // Admin B (manager) still believes DAY_1 has no row: creating it again
    // is a conflict. B's DAY_2 edit is current, yet must not be applied.
    let (status, body) = fx
        .bulk(
            MANAGER,
            json!([
                fx.set(DAY_1, 1, json!("190.00"), Value::Null),
                fx.set(DAY_2, 2, json!("210.00"), Value::Null),
            ]),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "stale_write");
    assert_eq!(
        body["conflicts"],
        json!([{ "room_type_id": fx.room_type_id, "stay_date": DAY_1 }])
    );
    assert!(
        body["error"]
            .as_str()
            .unwrap_or_default()
            .contains("Reload")
    );
    assert_eq!(
        fx.cell(DAY_1).await["custom_price"],
        "180.00",
        "A's value survives"
    );
    assert_eq!(
        fx.cell(DAY_2).await["is_override"],
        false,
        "all-or-nothing: DAY_2 untouched"
    );

    // A saves again from its current version; B's stale timestamp now fails,
    // for an update and for a reset alike.
    let (status, body) = fx
        .bulk(
            ADMIN,
            json!([fx.set(DAY_1, 0, json!("185.00"), version_a.clone())]),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let version_a2 = fx.cell(DAY_1).await["updated_at"].clone();
    assert_ne!(version_a2, version_a, "every write moves updated_at");

    let (status, body) = fx
        .bulk(
            MANAGER,
            json!([fx.set(DAY_1, 1, json!("190.00"), version_a.clone())]),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (status, body) = fx
        .bulk(
            MANAGER,
            json!([{ "room_type_id": fx.room_type_id, "stay_date": DAY_1, "reset": true, "expected_updated_at": version_a }]),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(fx.cell(DAY_1).await["custom_price"], "185.00");

    // The single-cell endpoint honours the same precondition.
    let (status, body) = fx
        .call(
            "PUT",
            &format!("/api/admin/online-inventory/{}/{DAY_1}", fx.room_type_id),
            MANAGER,
            Some(json!({
                "walk_in_reserved_rooms": 0, "online_booking_enabled": false,
                "custom_price": null, "expected_updated_at": null
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    // With the current version, B's reset goes through and removes the row.
    let (status, body) = fx
        .bulk(
            MANAGER,
            json!([{ "room_type_id": fx.room_type_id, "stay_date": DAY_1, "reset": true, "expected_updated_at": version_a2 }]),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let reset = fx.cell(DAY_1).await;
    assert_eq!(reset["is_override"], false);
    assert_eq!(reset["updated_at"], Value::Null);

    // Clients that send no precondition keep the old last-write-wins path.
    let (status, body) = fx
        .bulk(
            ADMIN,
            json!([{
                "room_type_id": fx.room_type_id, "stay_date": DAY_3,
                "walk_in_reserved_rooms": 0, "online_booking_enabled": false, "custom_price": null
            }]),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    fx.finish().await;
}

#[tokio::test]
async fn custom_price_must_be_a_plain_positive_two_decimal_number() {
    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fx) = Fixture::new().await else {
        return;
    };

    for (price, needle) in [
        (json!("1e3"), "plain number"),
        (json!("1E3"), "plain number"),
        (json!("12,50"), "plain number"),
        (json!(""), "plain number"),
        (json!("199.999"), "two decimal places"),
        (json!(199.999), "two decimal places"),
        (json!("0"), "greater than zero"),
        (json!("-5"), "greater than zero"),
    ] {
        let (status, body) = fx
            .bulk(ADMIN, json!([fx.set(DAY_1, 0, price.clone(), Value::Null)]))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "price {price}: {body}");
        assert_eq!(body["code"], "bad_request");
        assert!(
            body["error"].as_str().unwrap_or_default().contains(needle),
            "price {price} message mentions {needle:?}: {body}"
        );
    }
    assert_eq!(
        fx.cell(DAY_1).await["is_override"],
        false,
        "rejected prices wrote nothing"
    );

    for (price, stored) in [
        (json!("149.5"), "149.50"),
        (json!(175.25), "175.25"),
        (json!("99"), "99.00"),
    ] {
        let current = fx.cell(DAY_1).await["updated_at"].clone();
        let (status, body) = fx
            .bulk(ADMIN, json!([fx.set(DAY_1, 0, price.clone(), current)]))
            .await;
        assert_eq!(status, StatusCode::OK, "price {price}: {body}");
        assert_eq!(
            fx.cell(DAY_1).await["custom_price"],
            stored,
            "price {price}"
        );
    }

    fx.finish().await;
}
