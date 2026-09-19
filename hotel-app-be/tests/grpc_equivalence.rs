//! REST↔gRPC equivalence tests for the Phase 2 pilot services.
//!
//! The gRPC adapters call the same service functions the REST handlers call,
//! so these tests assert the *adapter layer* preserves behavior: identical
//! rows come back, route-equivalent permission checks deny identically, and
//! resource names / Money / dates / pagination convert correctly. They drive
//! the tonic service traits in-process (`RoomGrpc::list_rooms(...)`), which
//! exercises every line of adapter code short of the HTTP/2 framing itself.
//!
//! Auth parity is tested at the same depth REST enforces it:
//! `enforce_active_session` requires a session-bound JWT (`sid` claim) whose
//! refresh session is still live — the tests mint real sessions through
//! `AuthService::store_refresh_token` + `generate_session_jwt`, and assert
//! sid-less and revoked-session tokens are rejected.
//!
//! Fixture ids live in the 981_xxx block (rooms_housekeeping.rs owns 980_xxx).
//! All tests share the process-global serial lock because the housekeeping
//! board and room-status surfaces read every active room.

use chrono::{Duration, Utc};
use hotel_app_be::{AuthService, Claims};
use jsonwebtoken::{EncodingKey, Header, encode};
use tonic::Request;

/// Mirrors the per-binary secret pattern in tests/rooms_housekeeping.rs.
const TEST_JWT_SECRET: &str = "hotel-app-be-grpc-equivalence-test-secret-32chars-min";

fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn ensure_jwt_secret() {
    let _ = AuthService::init_jwt_secret(TEST_JWT_SECRET);
}

/// A JWT with NO `sid` — valid signature, but not session-bound. REST's
/// `enforce_active_session` rejects these on every staff endpoint; the gRPC
/// `authenticate` helper must reject them identically.
fn sid_less_token(user_id: i64) -> String {
    ensure_jwt_secret();
    let claims = Claims {
        sub: user_id.to_string(),
        username: format!("rm981_actor_{user_id}"),
        iss: "hotel-app-be".to_string(),
        aud: "hotel-web".to_string(),
        exp: Some((Utc::now() + Duration::minutes(30)).timestamp() as usize),
        iat: Utc::now().timestamp() as usize,
        roles: vec!["staff".to_string()],
        sid: None,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .expect("encoding a test JWT must succeed")
}

fn request_with_token<T>(msg: T, token: &str) -> Request<T> {
    let mut req = Request::new(msg);
    req.metadata_mut().insert(
        "authorization",
        format!("Bearer {token}")
            .parse()
            .expect("bearer metadata value must be valid"),
    );
    req
}

mod postgres_tests {
    use super::{ensure_jwt_secret, pg_serial_lock, request_with_token, sid_less_token};
    use axum::extract::State;
    use hotel_app_be::AuthService;
    use hotel_app_be::grpc::pb::hotel::guests::v1 as gpb;
    use hotel_app_be::grpc::pb::hotel::guests::v1::guest_service_server::GuestService;
    use hotel_app_be::grpc::pb::hotel::housekeeping::v1 as hkpb;
    use hotel_app_be::grpc::pb::hotel::housekeeping::v1::housekeeping_service_server::HousekeepingService;
    use hotel_app_be::grpc::pb::hotel::housekeeping::v1::maintenance_service_server::MaintenanceService;
    use hotel_app_be::grpc::pb::hotel::rooms::v1 as rmpb;
    use hotel_app_be::grpc::pb::hotel::rooms::v1::room_service_server::RoomService;
    use hotel_app_be::grpc::{GuestGrpc, HousekeepingGrpc, MaintenanceGrpc, RoomGrpc};
    use hotel_app_be::models::{
        CreateHousekeepingTaskRequest, CreateMaintenanceTicketRequest, GuestPaginationParams,
        GuestUpdateInput, ListHousekeepingTasksQuery, ListMaintenanceTicketsQuery,
    };
    use hotel_app_be::modules::guests::service as guest_service;
    use hotel_app_be::modules::housekeeping::service as hk_service;
    use hotel_app_be::modules::maintenance::service as mt_service;
    use hotel_app_be::modules::rooms::service as room_service;
    use rust_decimal::prelude::ToPrimitive;
    use sqlx::{PgPool, postgres::PgPoolOptions};
    use tonic::{Code, Request};

    const ACTOR: i64 = 981_001;
    const NO_PERMS_ACTOR: i64 = 981_002;
    const ROOM_TYPE: i64 = 981_010;
    const ROOM_A: i64 = 981_020;
    const ROOM_B: i64 = 981_021;
    const GUEST_A: i64 = 981_030;
    const GUEST_B: i64 = 981_031;

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping gRPC equivalence test because DATABASE_URL is not set");
                return None;
            }
        };
        let guard = pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
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
        Some((pool, guard))
    }

    async fn seed_actor(pool: &PgPool, actor_id: i64) {
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
             ON CONFLICT (id) DO UPDATE SET \
                username = EXCLUDED.username, \
                email = EXCLUDED.email, \
                full_name = EXCLUDED.full_name, \
                is_active = true, \
                is_verified = true",
        )
        .bind(actor_id)
        .bind(format!("rm981_actor_{actor_id}"))
        .bind(format!("rm981-actor-{actor_id}@hotel.local"))
        .bind(format!("RM981 Actor {actor_id}"))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn grant_permission(pool: &PgPool, actor_id: i64, permission: &str) {
        let (resource, action) = permission
            .split_once(':')
            .expect("permission must be \"resource:action\"");
        sqlx::query(
            "INSERT INTO roles (name, display_name, description, is_system_role, priority) \
             VALUES ('admin', 'Administrator', 'Test admin role', true, 100) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
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
             WHERE r.name = 'admin' AND p.name = $1 \
             ON CONFLICT DO NOTHING",
        )
        .bind(permission)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = 'admin' \
             ON CONFLICT DO NOTHING",
        )
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_room_type(pool: &PgPool) {
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'RM981T', 'RM981 Type', 150.00, 2) \
             ON CONFLICT (id) DO UPDATE SET \
                code = EXCLUDED.code, name = EXCLUDED.name, base_price = EXCLUDED.base_price",
        )
        .bind(ROOM_TYPE)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_room(pool: &PgPool, room_id: i64, status: &str) {
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4) \
             ON CONFLICT (id) DO UPDATE SET \
                room_number = EXCLUDED.room_number, \
                room_type_id = EXCLUDED.room_type_id, \
                status = EXCLUDED.status, \
                last_cleaned_at = NULL",
        )
        .bind(room_id)
        .bind(format!("R981-{room_id}"))
        .bind(ROOM_TYPE)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn cleanup_room(pool: &PgPool, room_id: i64) {
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_events WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_history WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM audit_logs \
             WHERE resource_type = 'housekeeping' \
               AND resource_id IN (SELECT id FROM housekeeping_tasks WHERE room_id = $1)",
        )
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM housekeeping_tasks WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM audit_logs \
             WHERE resource_type = 'maintenance' \
               AND resource_id IN (SELECT id FROM maintenance_tickets WHERE room_id = $1)",
        )
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM maintenance_tickets WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'room' AND resource_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn seed_guest(pool: &PgPool, guest_id: i64) {
        // last_name carries the id: update_guest recomputes nick_name from
        // first+last and enforces uniqueness, so the two fixtures must not
        // share a name on a fresh database.
        sqlx::query(
            "INSERT INTO guests (id, nick_name, first_name, last_name, email, guest_type, \
             tourism_type, discount_percentage, company_name, vip_status, created_by) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Riley', $3, $4, 'member', \
             'foreign', 15, 'RM981 Co', 'vip-gold', $5) \
             ON CONFLICT (id) DO UPDATE SET \
                nick_name = EXCLUDED.nick_name, \
                first_name = EXCLUDED.first_name, \
                last_name = EXCLUDED.last_name, \
                email = EXCLUDED.email, \
                company_name = EXCLUDED.company_name",
        )
        .bind(guest_id)
        .bind(format!("RM981 Guest {guest_id}"))
        .bind(format!("Nine{guest_id}"))
        .bind(format!("rm981-guest-{guest_id}@hotel.local"))
        .bind(ACTOR)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn cleanup_guest(pool: &PgPool, guest_id: i64) {
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'guest' AND resource_id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn cleanup_actor(pool: &PgPool, actor_id: i64) {
        sqlx::query(
            "DELETE FROM audit_logs WHERE user_id = $1 AND resource_type IN ('housekeeping', 'maintenance')",
        )
        .bind(actor_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_history WHERE changed_by = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .unwrap();
    }

    /// Mints a *session-bound* staff token: persists a refresh session and
    /// returns a JWT whose `sid` points at it — the exact credential shape
    /// `enforce_active_session` requires.
    async fn session_token(pool: &PgPool, user_id: i64) -> String {
        ensure_jwt_secret();
        let session_id = AuthService::store_refresh_token(
            pool,
            user_id,
            &format!(
                "rm981-rt-{user_id}-{}",
                hotel_app_be::core::db::generate_uuid()
            ),
            1,
            None,
            None,
            None,
        )
        .await
        .expect("storing a refresh session must succeed");
        AuthService::generate_session_jwt(
            user_id,
            format!("rm981_actor_{user_id}"),
            vec!["staff".to_string()],
            session_id,
        )
        .expect("session JWT must mint")
    }

    async fn fixtures(pool: &PgPool) -> String {
        seed_actor(pool, ACTOR).await;
        for perm in [
            "rooms:read",
            "housekeeping:read",
            "housekeeping:create",
            "housekeeping:update",
            "maintenance:read",
            "maintenance:write",
            "guests:read",
            "guests:create",
            "guests:update",
            "guests:delete",
        ] {
            grant_permission(pool, ACTOR, perm).await;
        }
        seed_room_type(pool).await;
        seed_room(pool, ROOM_A, "available").await;
        seed_room(pool, ROOM_B, "occupied").await;
        seed_guest(pool, GUEST_A).await;
        seed_guest(pool, GUEST_B).await;
        session_token(pool, ACTOR).await
    }

    async fn teardown(pool: &PgPool) {
        cleanup_room(pool, ROOM_A).await;
        cleanup_room(pool, ROOM_B).await;
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(ROOM_TYPE)
            .execute(pool)
            .await
            .unwrap();
        cleanup_guest(pool, GUEST_A).await;
        cleanup_guest(pool, GUEST_B).await;
        cleanup_actor(pool, ACTOR).await;
        cleanup_actor(pool, NO_PERMS_ACTOR).await;
    }

    /// REST `GET /api/rooms` vs `RoomService/ListRooms`: same rooms, same
    /// order, name/money/status conversions correct.
    #[tokio::test]
    async fn list_rooms_matches_rest() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;

        let rest = room_service::get_rooms_handler(State(pool.clone()))
            .await
            .expect("REST list_rooms")
            .0;
        let grpc = RoomGrpc::new(pool.clone())
            .list_rooms(request_with_token(
                rmpb::ListRoomsRequest {
                    page_size: 0,
                    page_token: String::new(),
                },
                &token,
            ))
            .await
            .expect("gRPC list_rooms")
            .into_inner();

        assert_eq!(grpc.total_size, rest.len() as i64);
        assert_eq!(grpc.rooms.len(), rest.len());
        for (g, r) in grpc.rooms.iter().zip(rest.iter()) {
            assert_eq!(g.name, format!("rooms/{}", r.id));
            assert_eq!(g.room_number, r.room_number);
            let expected_minor = (r.price_per_night * rust_decimal::Decimal::from(100))
                .round()
                .to_i64()
                .expect("room price must fit i64 minor units");
            assert_eq!(
                g.price_per_night.as_ref().map(|m| m.amount_minor),
                Some(expected_minor),
                "Money conversion must carry the REST price into minor units"
            );
            assert_ne!(
                g.status,
                rmpb::RoomStatus::Unspecified as i32,
                "room {} status must map to a real enum",
                r.id
            );
        }

        teardown(&pool).await;
    }

    /// AIP pagination: `page_size` bounds the page, `next_page_token` resumes
    /// where the first page stopped, pages are disjoint and cover the set.
    #[tokio::test]
    async fn list_rooms_paginates() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;
        let svc = RoomGrpc::new(pool.clone());

        let page1 = svc
            .list_rooms(request_with_token(
                rmpb::ListRoomsRequest {
                    page_size: 1,
                    page_token: String::new(),
                },
                &token,
            ))
            .await
            .unwrap()
            .into_inner();
        assert_eq!(page1.rooms.len(), 1);
        assert!(
            !page1.next_page_token.is_empty(),
            "full table must yield a token"
        );

        let page2 = svc
            .list_rooms(request_with_token(
                rmpb::ListRoomsRequest {
                    page_size: 1,
                    page_token: page1.next_page_token.clone(),
                },
                &token,
            ))
            .await
            .unwrap()
            .into_inner();
        assert_eq!(page2.rooms.len(), 1);
        assert_ne!(
            page1.rooms[0].name, page2.rooms[0].name,
            "pages must be disjoint"
        );
        assert_eq!(page1.total_size, page2.total_size);

        teardown(&pool).await;
    }

    /// REST `GET /api/housekeeping/tasks` vs `ListHousekeepingTasks` —
    /// including a task created through the REST service path.
    #[tokio::test]
    async fn housekeeping_tasks_match_rest() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;

        let created = hk_service::create_task(
            &pool,
            ACTOR,
            CreateHousekeepingTaskRequest {
                room_id: ROOM_A,
                task_type: Some("cleaning".to_string()),
                priority: Some("high".to_string()),
                assigned_to: None,
                scheduled_date: None,
                notes: Some("rm981 equivalence task".to_string()),
                inspection_notes: None,
                items_used: None,
            },
        )
        .await
        .expect("REST create_task");

        let rest = hk_service::list_tasks(
            &pool,
            ListHousekeepingTasksQuery {
                status: None,
                task_type: None,
                room_id: Some(ROOM_A),
                assigned_to: None,
                unassigned: None,
                scheduled_date: None,
                page: None,
                page_size: None,
            },
        )
        .await
        .expect("REST list_tasks");

        let grpc = HousekeepingGrpc::new(pool.clone())
            .list_housekeeping_tasks(request_with_token(
                hkpb::ListHousekeepingTasksRequest {
                    status: 0,
                    task_type: 0,
                    room: format!("rooms/{ROOM_A}"),
                    assigned_to: String::new(),
                    unassigned: None,
                    scheduled_date: None,
                    page_size: 0,
                    page_token: String::new(),
                },
                &token,
            ))
            .await
            .expect("gRPC list_housekeeping_tasks")
            .into_inner();

        assert_eq!(grpc.total_size, rest.total);
        assert_eq!(grpc.tasks.len(), rest.items.len());
        let g = grpc
            .tasks
            .iter()
            .find(|t| t.name == format!("housekeepingTasks/{}", created.id))
            .expect("created task must appear in gRPC listing");
        assert_eq!(g.room, format!("rooms/{ROOM_A}"));
        assert_eq!(g.notes, "rm981 equivalence task");
        assert_eq!(g.status, hkpb::HousekeepingTaskStatus::Pending as i32);

        teardown(&pool).await;
    }

    /// REST `GET /api/housekeeping/board` vs `GetHousekeepingBoard`.
    #[tokio::test]
    async fn housekeeping_board_matches_rest() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;

        let rest = hk_service::board(&pool).await.expect("REST board");
        let grpc = HousekeepingGrpc::new(pool.clone())
            .get_housekeeping_board(request_with_token(
                hkpb::GetHousekeepingBoardRequest {},
                &token,
            ))
            .await
            .expect("gRPC board")
            .into_inner();

        assert_eq!(grpc.rooms.len(), rest.rooms.len());
        for (g, r) in grpc.rooms.iter().zip(rest.rooms.iter()) {
            assert_eq!(g.room, format!("rooms/{}", r.id));
            assert_eq!(
                g.open_task.is_some(),
                r.open_task.is_some(),
                "open-task presence must match for room {}",
                r.id
            );
        }

        teardown(&pool).await;
    }

    /// REST `GET /api/maintenance/tickets` vs `ListMaintenanceTickets`.
    #[tokio::test]
    async fn maintenance_tickets_match_rest() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;

        let created = mt_service::create_ticket(
            &pool,
            ACTOR,
            CreateMaintenanceTicketRequest {
                room_id: Some(ROOM_A),
                title: "rm981 equivalence ticket".to_string(),
                description: Some("dripping tap".to_string()),
                category: Some("plumbing".to_string()),
                priority: Some("high".to_string()),
                assigned_to: None,
                estimated_cost: None,
                estimated_hours: None,
                scheduled_date: None,
                images: None,
            },
        )
        .await
        .expect("REST create_ticket");

        let rest = mt_service::list_tickets(
            &pool,
            ListMaintenanceTicketsQuery {
                status: None,
                room_id: Some(ROOM_A),
                assigned_to: None,
                category: None,
                priority: None,
                page: None,
                page_size: None,
            },
        )
        .await
        .expect("REST list_tickets");

        let grpc = MaintenanceGrpc::new(pool.clone())
            .list_maintenance_tickets(request_with_token(
                hkpb::ListMaintenanceTicketsRequest {
                    status: 0,
                    room: format!("rooms/{ROOM_A}"),
                    assigned_to: String::new(),
                    category: 0,
                    priority: 0,
                    page_size: 0,
                    page_token: String::new(),
                },
                &token,
            ))
            .await
            .expect("gRPC list_maintenance_tickets")
            .into_inner();

        assert_eq!(grpc.total_size, rest.total);
        let g = grpc
            .tickets
            .iter()
            .find(|t| t.name == format!("maintenanceTickets/{}", created.id))
            .expect("created ticket must appear in gRPC listing");
        assert_eq!(g.title, "rm981 equivalence ticket");
        assert_eq!(g.room, format!("rooms/{ROOM_A}"));
        assert_eq!(g.status, hkpb::MaintenanceStatus::Open as i32);

        teardown(&pool).await;
    }

    /// Auth parity with `enforce_active_session`: no token, a sid-less JWT,
    /// and a revoked session must all map to UNAUTHENTICATED — the same
    /// requests REST turns away with 401.
    #[tokio::test]
    async fn unauthenticated_variants() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;
        let svc = RoomGrpc::new(pool.clone());
        let msg = || rmpb::ListRoomsRequest {
            page_size: 0,
            page_token: String::new(),
        };

        let no_auth = svc.list_rooms(Request::new(msg())).await.unwrap_err();
        assert_eq!(no_auth.code(), Code::Unauthenticated);

        let sid_less = svc
            .list_rooms(request_with_token(msg(), &sid_less_token(ACTOR)))
            .await
            .unwrap_err();
        assert_eq!(sid_less.code(), Code::Unauthenticated);
        assert!(
            sid_less.message().contains("Session-bound"),
            "sid-less rejection should mirror the REST message, got: {}",
            sid_less.message()
        );

        // Revoking the session row invalidates the still-valid JWT.
        AuthService::revoke_all_user_tokens(&pool, ACTOR)
            .await
            .unwrap();
        let revoked = svc
            .list_rooms(request_with_token(msg(), &token))
            .await
            .unwrap_err();
        assert_eq!(revoked.code(), Code::Unauthenticated);

        teardown(&pool).await;
    }

    /// An authenticated user without `rooms:read` gets PERMISSION_DENIED —
    /// the gRPC twin of REST's 403.
    #[tokio::test]
    async fn permission_denied() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let _token = fixtures(&pool).await;
        seed_actor(&pool, NO_PERMS_ACTOR).await;
        let weak_token = session_token(&pool, NO_PERMS_ACTOR).await;

        let err = RoomGrpc::new(pool.clone())
            .list_rooms(request_with_token(
                rmpb::ListRoomsRequest {
                    page_size: 0,
                    page_token: String::new(),
                },
                &weak_token,
            ))
            .await
            .unwrap_err();
        assert_eq!(err.code(), Code::PermissionDenied);

        teardown(&pool).await;
    }

    /// Malformed and wrong-collection resource names reject with
    /// INVALID_ARGUMENT before touching the service layer.
    #[tokio::test]
    async fn bad_resource_name_is_invalid_argument() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;
        let svc = RoomGrpc::new(pool.clone());

        for bad in ["rooms/abc", "guests/1", "", "rooms"] {
            let err = svc
                .get_room(request_with_token(
                    rmpb::GetRoomRequest {
                        name: bad.to_string(),
                    },
                    &token,
                ))
                .await
                .unwrap_err();
            assert_eq!(
                err.code(),
                Code::InvalidArgument,
                "name {bad:?} must be INVALID_ARGUMENT"
            );
        }

        teardown(&pool).await;
    }

    /// A repeated mutating call with the same `request_id` replays the first
    /// response — no second task row is written.
    #[tokio::test]
    async fn idempotent_create_replays() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;
        let svc = HousekeepingGrpc::new(pool.clone());

        let make_req = || hkpb::CreateHousekeepingTaskRequest {
            task: Some(hkpb::HousekeepingTask {
                room: format!("rooms/{ROOM_B}"),
                task_type: hkpb::HousekeepingTaskType::Cleaning as i32,
                priority: hkpb::HousekeepingPriority::Normal as i32,
                notes: "rm981 idempotent".to_string(),
                ..Default::default()
            }),
            request_id: "rm981-idem-1".to_string(),
        };

        let first = svc
            .create_housekeeping_task(request_with_token(make_req(), &token))
            .await
            .expect("first create")
            .into_inner();
        let second = svc
            .create_housekeeping_task(request_with_token(make_req(), &token))
            .await
            .expect("replayed create")
            .into_inner();

        assert_eq!(
            first.task.as_ref().map(|t| t.name.as_str()),
            second.task.as_ref().map(|t| t.name.as_str()),
            "replay must return the originally created resource"
        );

        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM housekeeping_tasks WHERE room_id = $1 AND notes = 'rm981 idempotent'",
        )
        .bind(ROOM_B)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1, "idempotent replay must not double-insert");

        teardown(&pool).await;
    }

    /// REST `GET /api/guests?search=` vs `GuestService/ListGuests`: same
    /// filtered page, resource names and enum mapping correct.
    #[tokio::test]
    async fn list_guests_matches_rest() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;
        let search = format!("rm981-guest-{GUEST_A}@hotel.local");

        let rest = guest_service::list_guests(
            &pool,
            ACTOR,
            GuestPaginationParams {
                page: None,
                page_size: None,
                search: Some(search.clone()),
                guest_type: None,
                tourism_type: None,
                missing_tourism: None,
                missing_info: None,
                vip: None,
                blacklisted: None,
                has_open_support: None,
                segment: None,
            },
        )
        .await
        .expect("REST list_guests");

        let grpc = GuestGrpc::new(pool.clone())
            .list_guests(request_with_token(
                gpb::ListGuestsRequest {
                    page: 0,
                    page_size: 0,
                    search,
                    guest_type: gpb::GuestType::Unspecified as i32,
                    tourism_type: gpb::TourismType::Unspecified as i32,
                    missing_tourism: None,
                    missing_info: None,
                    vip: None,
                    blacklisted: None,
                    has_open_support: None,
                    segment: gpb::GuestSegment::Unspecified as i32,
                },
                &token,
            ))
            .await
            .expect("gRPC list_guests")
            .into_inner();

        assert_eq!(grpc.total, rest.total);
        assert_eq!(grpc.page, rest.page);
        assert_eq!(grpc.page_size, rest.page_size);
        assert_eq!(grpc.guests.len(), rest.data.len());
        for (g, r) in grpc.guests.iter().zip(rest.data.iter()) {
            assert_eq!(g.name, format!("guests/{}", r.id));
            assert_eq!(g.nick_name, r.nick_name);
            assert_eq!(g.guest_type, gpb::GuestType::Member as i32);
            assert_eq!(g.tourism_type, Some(gpb::TourismType::Foreign as i32));
            assert_eq!(g.discount_percentage, Some(15));
            assert!(g.ekyc_summary.is_some(), "ekyc_summary must be present");
        }

        teardown(&pool).await;
    }

    /// REST `GET /api/guests/{id}` vs `GetGuest`: every mapped field equal.
    #[tokio::test]
    async fn get_guest_maps_fields() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;

        let rest = guest_service::get_guest(&pool, GUEST_A)
            .await
            .expect("REST get_guest");
        let grpc = GuestGrpc::new(pool.clone())
            .get_guest(request_with_token(
                gpb::GetGuestRequest {
                    name: format!("guests/{GUEST_A}"),
                },
                &token,
            ))
            .await
            .expect("gRPC get_guest")
            .into_inner();
        let g = grpc.guest.expect("guest payload");

        assert_eq!(g.name, format!("guests/{}", rest.id));
        assert_eq!(g.nick_name, rest.nick_name);
        assert_eq!(g.first_name, rest.first_name);
        assert_eq!(g.last_name, rest.last_name);
        assert_eq!(g.email, rest.email);
        assert_eq!(g.guest_type, gpb::GuestType::Member as i32);
        assert_eq!(g.tourism_type, Some(gpb::TourismType::Foreign as i32));
        assert_eq!(g.discount_percentage, Some(rest.discount_percentage));
        assert_eq!(g.company_name, rest.company_name);
        assert_eq!(g.vip_status, rest.vip_status);
        let ekyc = g.ekyc_summary.expect("ekyc_summary present");
        assert_eq!(ekyc.guest, format!("guests/{}", rest.id));
        assert_eq!(ekyc.status, rest.ekyc_summary.status);

        teardown(&pool).await;
    }

    /// `CreateGuest` drives the same service function REST POST uses: the
    /// response maps every field and the row persists identically.
    #[tokio::test]
    async fn create_guest_via_rpc_matches_service() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;

        let res = GuestGrpc::new(pool.clone())
            .create_guest(request_with_token(
                gpb::CreateGuestRequest {
                    guest: Some(gpb::Guest {
                        first_name: Some("Grpc".to_string()),
                        last_name: Some("Guest".to_string()),
                        email: Some("rm981-created@hotel.local".to_string()),
                        guest_type: gpb::GuestType::Member as i32,
                        tourism_type: Some(gpb::TourismType::Local as i32),
                        discount_percentage: Some(20),
                        company_name: Some("RM981 Created Co".to_string()),
                        ..Default::default()
                    }),
                    request_id: String::new(),
                },
                &token,
            ))
            .await
            .expect("gRPC create_guest")
            .into_inner();
        let g = res.guest.expect("created guest");

        let created_id: i64 = g
            .name
            .strip_prefix("guests/")
            .expect("resource name must be guests/{id}")
            .parse()
            .expect("numeric id");
        let persisted = guest_service::get_guest(&pool, created_id)
            .await
            .expect("created guest must persist");
        assert_eq!(persisted.first_name.as_deref(), Some("Grpc"));
        assert_eq!(persisted.last_name.as_deref(), Some("Guest"));
        assert_eq!(persisted.email.as_deref(), Some("rm981-created@hotel.local"));
        assert_eq!(
            persisted.tourism_type,
            Some(hotel_app_be::constants::TourismType::Local)
        );
        assert_eq!(persisted.discount_percentage, 20);
        assert_eq!(persisted.company_name.as_deref(), Some("RM981 Created Co"));
        assert_eq!(g.first_name.as_deref(), Some("Grpc"));
        assert_eq!(g.guest_type, gpb::GuestType::Member as i32);
        assert_eq!(g.discount_percentage, Some(20));

        cleanup_guest(&pool, created_id).await;
        teardown(&pool).await;
    }

    /// `UpdateGuest` with a field mask produces the same service result as
    /// REST PATCH on an identical guest — updated fields land, untouched
    /// fields are preserved.
    #[tokio::test]
    async fn update_guest_via_mask_matches_rest() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;

        // REST PATCH path on GUEST_A.
        let rest = guest_service::update_guest(
            &pool,
            ACTOR,
            GUEST_A,
            GuestUpdateInput {
                email: Some("rm981-updated@hotel.local".to_string()),
                vip_status: Some("vip-platinum".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("REST update_guest");

        // Same mutation through gRPC on GUEST_B.
        let res = GuestGrpc::new(pool.clone())
            .update_guest(request_with_token(
                gpb::UpdateGuestRequest {
                    guest: Some(gpb::Guest {
                        name: format!("guests/{GUEST_B}"),
                        email: Some("rm981-updated@hotel.local".to_string()),
                        vip_status: Some("vip-platinum".to_string()),
                        ..Default::default()
                    }),
                    update_mask: Some(prost_types::FieldMask {
                        paths: vec!["email".to_string(), "vip_status".to_string()],
                    }),
                    request_id: String::new(),
                },
                &token,
            ))
            .await
            .expect("gRPC update_guest")
            .into_inner();
        let g = res.guest.expect("updated guest");

        assert_eq!(g.email, rest.email);
        assert_eq!(g.vip_status, rest.vip_status);
        // Untouched fields must survive — same as REST unwrap_or(existing).
        assert_eq!(g.company_name, rest.company_name);
        assert_eq!(g.nick_name, rest.nick_name.replace(GUEST_A.to_string().as_str(), GUEST_B.to_string().as_str()));

        teardown(&pool).await;
    }

    /// `guests:read`-gated RPCs reject a no-permission caller with
    /// PERMISSION_DENIED; the bare-auth list returns an empty page instead
    /// (mirroring REST, where the service decides access).
    #[tokio::test]
    async fn guest_permission_denied() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let _token = fixtures(&pool).await;
        seed_actor(&pool, NO_PERMS_ACTOR).await;
        let weak_token = session_token(&pool, NO_PERMS_ACTOR).await;
        let svc = GuestGrpc::new(pool.clone());

        let err = svc
            .get_guest(request_with_token(
                gpb::GetGuestRequest {
                    name: format!("guests/{GUEST_A}"),
                },
                &weak_token,
            ))
            .await
            .unwrap_err();
        assert_eq!(err.code(), Code::PermissionDenied);

        let list = svc
            .list_guests(request_with_token(
                gpb::ListGuestsRequest {
                    page: 0,
                    page_size: 0,
                    search: String::new(),
                    guest_type: gpb::GuestType::Unspecified as i32,
                    tourism_type: gpb::TourismType::Unspecified as i32,
                    missing_tourism: None,
                    missing_info: None,
                    vip: None,
                    blacklisted: None,
                    has_open_support: None,
                    segment: gpb::GuestSegment::Unspecified as i32,
                },
                &weak_token,
            ))
            .await
            .expect("bare-auth list succeeds without guests:read")
            .into_inner();
        assert_eq!(list.total, 0, "no-perm list must be the REST empty page");
        assert!(list.guests.is_empty());

        teardown(&pool).await;
    }

    /// Malformed and wrong-collection resource names reject with
    /// INVALID_ARGUMENT before touching the service layer.
    #[tokio::test]
    async fn guest_bad_resource_name_is_invalid_argument() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let token = fixtures(&pool).await;
        let svc = GuestGrpc::new(pool.clone());

        for bad in ["guests/abc", "rooms/1", "", "guests"] {
            let err = svc
                .get_guest(request_with_token(
                    gpb::GetGuestRequest {
                        name: bad.to_string(),
                    },
                    &token,
                ))
                .await
                .unwrap_err();
            assert_eq!(
                err.code(),
                Code::InvalidArgument,
                "name {bad:?} must be INVALID_ARGUMENT"
            );
        }

        teardown(&pool).await;
    }
}
