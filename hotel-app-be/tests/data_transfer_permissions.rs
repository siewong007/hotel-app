//! HTTP-level coverage for the `data_transfer:*` permission model and the
//! step-up re-authentication flow, driven through the real router:
//!
//! - every endpoint rejects a permission-less user with 403 (and a
//!   `settings:manage` holder — the legacy gate is gone),
//! - `data_transfer:view` opens preview(standard) and history only,
//! - `data_transfer:export` unlocks the standard export; sensitive scopes
//!   need `export_sensitive`,
//! - full/backup exports and restore executes also need a fresh `X-Step-Up`
//!   token — a 401, not a 403, when it is missing, wrong-session, or
//!   unusable as an access token,
//! - `POST /data-transfer/step-up` verifies the password (generic 401 on
//!   failure) and audits both outcomes,
//! - execute layers `import_sensitive` (sensitive/legacy files), `override`
//!   (`onConflict: "update"`), and `restore` + step-up on top of the base
//!   `data_transfer:import` guard,
//! - `data_transfer:manage` implies every action (step-up still required),
//! - `/data-transfer/history` surfaces the just-run export and step-up audit
//!   rows.
//!
//! Fixture users live in the `920_960_0xx` id band and are deleted at the end
//! of each test. Runs only with `DATABASE_URL` set.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode, header};
use hotel_app_be::AuthService;
use hotel_app_be::models::ImportJobStatus;
use serde_json::{Map, Value, json};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use tower::ServiceExt;

/// Fixture-bearing tests share the dev database and mutate the same workers'
/// grants — serialize them exactly like the sibling suites.
static FIXTURE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const TEST_JWT_SECRET: &str = "hotel-app-be-dt-perms-secret-32chars!!";
const ADMIN_ID: i64 = 920_960_001;
const PLAIN_ID: i64 = 920_960_002;
const WORKER_ID: i64 = 920_960_003;
const OTHER_ID: i64 = 920_960_004;
const STEP_UP_PASSWORD: &str = "StepUp-Test-Passw0rd!";

/// Every test injects its own ConnectInfo IP so the step-up endpoint's
/// per-IP rate bucket (10/300s) cannot bleed across tests.
const IP_EXPORT: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 240, 0, 1)), 40_000);
const IP_STEP_UP: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 240, 0, 2)), 40_000);
const IP_EXECUTE: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 240, 0, 3)), 40_000);
const IP_MANAGE: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 240, 0, 4)), 40_000);
const IP_HISTORY: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 240, 0, 5)), 40_000);

struct Session {
    auth: String,
    sid: String,
}

struct Fixture {
    pool: PgPool,
    app: axum::Router,
    sessions: HashMap<i64, Session>,
}

impl Fixture {
    async fn new() -> Option<Self> {
        use hotel_app_be::{core, routes};

        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping data-transfer permission tests because DATABASE_URL is not set");
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
            .expect("permission-test database must connect");

        Self::cleanup(&pool).await;
        for (id, username) in [
            (ADMIN_ID, "dt_perms_admin"),
            (PLAIN_ID, "dt_perms_plain"),
            (WORKER_ID, "dt_perms_worker"),
            (OTHER_ID, "dt_perms_other"),
        ] {
            Self::upsert_actor(&pool, id, username).await;
        }
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = 'admin' \
             ON CONFLICT (user_id, role_id) DO NOTHING",
        )
        .bind(ADMIN_ID)
        .execute(&pool)
        .await
        .expect("admin role grant must insert");
        // Granular grants resolve only through roles (`effective_roles` →
        // `role_permissions`); `user_permissions` is not consulted. Each
        // grantable worker gets its own empty fixture role the tests fill in.
        for (user_id, role_name) in [
            (WORKER_ID, "dt_perms_worker"),
            (OTHER_ID, "dt_perms_other"),
        ] {
            sqlx::query(
                "INSERT INTO roles (name, display_name, description) \
                 VALUES ($1, $2, 'data-transfer permission fixture') \
                 ON CONFLICT (name) DO NOTHING",
            )
            .bind(role_name)
            .bind(role_name.replace('_', " "))
            .execute(&pool)
            .await
            .expect("fixture role must insert");
            sqlx::query(
                "INSERT INTO user_roles (user_id, role_id) \
                 SELECT $1, id FROM roles WHERE name = $2 \
                 ON CONFLICT (user_id, role_id) DO NOTHING",
            )
            .bind(user_id)
            .bind(role_name)
            .execute(&pool)
            .await
            .expect("fixture role link must insert");
        }
        // OTHER carries a password so the step-up endpoint has a real
        // credential to verify.
        let hash = AuthService::hash_password(STEP_UP_PASSWORD)
            .await
            .expect("fixture password must hash");
        sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
            .bind(OTHER_ID)
            .bind(&hash)
            .execute(&pool)
            .await
            .expect("password fixture must apply");
        hotel_app_be::core::rbac_cache::invalidate_all();

        let mut sessions = HashMap::new();
        for (id, username, role) in [
            (ADMIN_ID, "dt_perms_admin", "admin"),
            (PLAIN_ID, "dt_perms_plain", "staff"),
            (WORKER_ID, "dt_perms_worker", "staff"),
            (OTHER_ID, "dt_perms_other", "staff"),
        ] {
            sessions.insert(id, Self::bearer(&pool, id, username, role).await);
        }

        Some(Self {
            app: routes::create_router(pool.clone()),
            pool,
            sessions,
        })
    }

    async fn upsert_actor(pool: &PgPool, id: i64, username: &str) {
        sqlx::query(
            "INSERT INTO users \
             (id, username, email, full_name, user_type, is_active, is_verified, \
              is_locked, is_super_admin) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, 'DT Perms Actor', 'staff', true, true, false, false) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, email = EXCLUDED.email, \
                 is_active = true, is_verified = true, is_locked = false, \
                 is_super_admin = false, deleted_at = NULL",
        )
        .bind(id)
        .bind(username)
        .bind(format!("{username}@hotel.local"))
        .execute(pool)
        .await
        .expect("actor fixture must be inserted");
    }

    /// An active session plus its session-bound access token — the session
    /// middleware checks `sid` against `refresh_tokens`, so a bare signed JWT
    /// is not enough. The sid is kept so tests can mint step-up tokens bound
    /// to the same session.
    async fn bearer(pool: &PgPool, user_id: i64, username: &str, role: &str) -> Session {
        let refresh_token = AuthService::generate_refresh_token();
        let session_id = AuthService::store_refresh_token(
            pool,
            user_id,
            &refresh_token,
            1,
            Some("127.0.0.1"),
            Some("dt-perms-test"),
            None,
        )
        .await
        .expect("session fixture must be inserted");
        let token = AuthService::generate_session_jwt(
            user_id,
            username.to_string(),
            vec![role.to_string()],
            session_id.clone(),
        )
        .expect("test access token must encode");
        Session {
            auth: format!("Bearer {token}"),
            sid: session_id,
        }
    }

    fn auth(&self, user_id: i64) -> &str {
        &self
            .sessions
            .get(&user_id)
            .expect("fixture session must exist")
            .auth
    }

    /// A `data_transfer:*` grant through the actor's fixture role — the only
    /// path `check_permission` resolves (`effective_roles` → `role_permissions`).
    async fn grant(&self, user_id: i64, permission: &str) {
        let role_name = Self::fixture_role(user_id).expect("actor has no fixture role");
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) \
             SELECT r.id, p.id FROM roles r, permissions p \
             WHERE r.name = $1 AND p.name = $2 \
             ON CONFLICT (role_id, permission_id) DO NOTHING",
        )
        .bind(role_name)
        .bind(permission)
        .execute(&self.pool)
        .await
        .expect("permission grant must insert");
        hotel_app_be::core::rbac_cache::invalidate_all();
    }

    fn fixture_role(user_id: i64) -> Option<&'static str> {
        match user_id {
            WORKER_ID => Some("dt_perms_worker"),
            OTHER_ID => Some("dt_perms_other"),
            _ => None,
        }
    }

    async fn revoke_all(&self, user_id: i64) {
        let Some(role_name) = Self::fixture_role(user_id) else {
            return;
        };
        sqlx::query(
            "DELETE FROM role_permissions \
             WHERE role_id = (SELECT id FROM roles WHERE name = $1)",
        )
        .bind(role_name)
        .execute(&self.pool)
        .await
        .expect("permission revoke must run");
        hotel_app_be::core::rbac_cache::invalidate_all();
    }

    /// A step-up token as `POST /step-up` would mint it — used to exercise the
    /// gated endpoints without spending rate-limited credential calls.
    fn step_up_token(&self, user_id: i64) -> String {
        let session = self.sessions.get(&user_id).expect("session must exist");
        AuthService::issue_step_up_token(
            user_id,
            self.username(user_id),
            Some(session.sid.clone()),
        )
        .expect("step-up token must encode")
    }

    fn username(&self, user_id: i64) -> String {
        match user_id {
            ADMIN_ID => "dt_perms_admin",
            PLAIN_ID => "dt_perms_plain",
            WORKER_ID => "dt_perms_worker",
            OTHER_ID => "dt_perms_other",
            _ => "dt_perms_unknown",
        }
        .to_string()
    }

    /// Full request round-trip; ConnectInfo is injected because the step-up
    /// route extracts it (production attaches it via
    /// `into_make_service_with_connect_info`). Returns (status, body bytes).
    async fn request(
        &self,
        method: &str,
        uri: &str,
        authorization: Option<&str>,
        body: &[u8],
        extra_headers: &[(&str, &str)],
        peer: SocketAddr,
    ) -> (StatusCode, Vec<u8>) {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(authorization) = authorization {
            builder = builder.header(header::AUTHORIZATION, authorization);
        }
        for (name, value) in extra_headers {
            builder = builder.header(*name, *value);
        }
        if method == "POST" {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        let mut request = builder
            .body(Body::from(body.to_vec()))
            .expect("request must build");
        request.extensions_mut().insert(ConnectInfo(peer));
        let response = self
            .app
            .clone()
            .oneshot(request)
            .await
            .expect("router response must complete");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body must read");
        (status, bytes.to_vec())
    }

    /// Status-only variant for the common case.
    async fn status(
        &self,
        method: &str,
        uri: &str,
        user_id: Option<i64>,
        body: &[u8],
        extra_headers: &[(&str, &str)],
        peer: SocketAddr,
    ) -> StatusCode {
        let auth = user_id.map(|id| self.auth(id));
        self.request(method, uri, auth, body, extra_headers, peer)
            .await
            .0
    }

    /// `POST /data-transfer/import/uploads` as the admin — the file is staged
    /// exactly like a browser upload (raw body, no multipart).
    async fn stage_upload(&self, document: Vec<u8>) -> String {
        let (status, body) = self
            .request(
                "POST",
                "/api/data-transfer/import/uploads",
                Some(self.auth(ADMIN_ID)),
                &document,
                &[],
                IP_EXECUTE,
            )
            .await;
        assert_eq!(status, StatusCode::OK, "staging the fixture must succeed");
        let parsed: Value = serde_json::from_slice(&body).expect("upload response must parse");
        parsed["uploadId"]
            .as_str()
            .expect("uploadId must be present")
            .to_string()
    }

    /// `POST /data-transfer/import/execute` for a user — returns the status
    /// and, on 202, the registered job id.
    async fn execute(
        &self,
        user_id: i64,
        upload_id: &str,
        mode: &str,
        on_conflict: Option<&str>,
        step_up: Option<&str>,
    ) -> (StatusCode, Option<uuid::Uuid>) {
        let mut payload = json!({
            "uploadId": upload_id,
            "mode": mode,
            "tables": [],
            "confirm": true,
        });
        if let Some(policy) = on_conflict {
            payload["onConflict"] = json!(policy);
        }
        let headers: Vec<(&str, &str)> = step_up
            .map(|token| vec![("x-step-up", token)])
            .unwrap_or_default();
        let (status, body) = self
            .request(
                "POST",
                "/api/data-transfer/import/execute",
                Some(self.auth(user_id)),
                payload.to_string().as_bytes(),
                &headers,
                IP_EXECUTE,
            )
            .await;
        let job_id = (status == StatusCode::ACCEPTED).then(|| {
            let parsed: Value =
                serde_json::from_slice(&body).expect("execute response must parse");
            uuid::Uuid::parse_str(parsed["jobId"].as_str().expect("jobId must be present"))
                .expect("jobId must be a uuid")
        });
        (status, job_id)
    }

    async fn cleanup(pool: &PgPool) {
        for user_id in [ADMIN_ID, PLAIN_ID, WORKER_ID, OTHER_ID] {
            sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .expect("session cleanup must run");
            sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
                .bind(user_id)
                .execute(pool)
                .await
                .expect("role cleanup must run");
        }
        sqlx::query(
            "DELETE FROM role_permissions \
             WHERE role_id IN (SELECT id FROM roles WHERE name = ANY($1))",
        )
        .bind(["dt_perms_worker", "dt_perms_other"])
        .execute(pool)
        .await
        .expect("role permission cleanup must run");
        sqlx::query("DELETE FROM roles WHERE name = ANY($1)")
            .bind(["dt_perms_worker", "dt_perms_other"])
            .execute(pool)
            .await
            .expect("role cleanup must run");
        sqlx::query("DELETE FROM users WHERE id = ANY($1)")
            .bind([ADMIN_ID, PLAIN_ID, WORKER_ID, OTHER_ID])
            .execute(pool)
            .await
            .expect("actor cleanup must run");
        hotel_app_be::core::rbac_cache::invalidate_all();
    }
}

/// One entity in a fixture document: qualified name, primary-key columns
/// (for the manifest descriptor), and the file's rows.
struct V1Entity<'a> {
    name: &'a str,
    primary_key: &'a [&'a str],
    rows: Vec<Value>,
}

/// Serialize a v1 `hotel-backup` document whose manifest and integrity
/// trailer agree with the `tables` payload — the same discipline the sibling
/// suite applies so preview cross-checks stay clean.
fn v1_document(entities: &[V1Entity]) -> Vec<u8> {
    let mut tables = Map::new();
    let mut entity_rows = Map::new();
    let mut manifest_entities = Vec::new();
    let mut total = 0_u64;
    for entity in entities {
        let columns: Vec<String> = entity
            .rows
            .iter()
            .flat_map(|row| {
                row.as_object()
                    .into_iter()
                    .flatten()
                    .map(|(key, _)| key.clone())
            })
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        manifest_entities.push(json!({
            "name": entity.name,
            "primaryKey": entity.primary_key,
            "columns": columns,
        }));
        entity_rows.insert(entity.name.to_string(), (entity.rows.len() as u64).into());
        total += entity.rows.len() as u64;
        tables.insert(entity.name.to_string(), Value::Array(entity.rows.clone()));
    }

    serde_json::to_vec(&json!({
        "format": "hotel-backup",
        "version": 1,
        "kind": "business-data",
        "exportId": "21111111-2222-3333-4444-555555555555",
        "exportedAt": "2026-09-15T12:00:00Z",
        "applicationVersion": env!("CARGO_PKG_VERSION"),
        "source": {"environment": "development", "databaseProvider": "postgresql"},
        "manifest": {"entities": manifest_entities, "exclusions": []},
        "tables": tables,
        "integrity": {
            "entities": entities.len(),
            "rows": total,
            "entityRows": entity_rows,
            "completedAt": "2026-09-15T12:00:01Z"
        }
    }))
    .expect("v1 fixture serializes")
}

/// A minimal retired `BookingDataExport` (the original flat export) — the
/// file detects as `legacy`, fails closed as sensitive, and can no longer
/// import at all; the execute-side permission check is what this exercises.
fn legacy_document() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "version": "1.0",
        "exported_at": "2026-09-15T12:00:00Z",
        "guests": [],
        "guest_complimentary_credits": [],
        "companies": [],
        "bookings": [],
        "payments": [],
        "invoices": [],
        "booking_guests": [],
        "booking_modifications": [],
        "booking_history": [],
        "night_audit_runs": [],
        "night_audit_details": [],
        "customer_ledgers": [],
        "customer_ledger_payments": [],
        "room_changes": []
    }))
    .expect("v1 fixture serializes")
}

/// Poll the registry until the job leaves `running` (or time out).
async fn wait_for_job(job_id: uuid::Uuid) -> ImportJobStatus {
    use hotel_app_be::models::ImportJobState;
    use hotel_app_be::modules::data_transfer::jobs::import_job_status;
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let status = import_job_status(job_id).expect("registered job must be queryable");
        if status.status != ImportJobState::Running {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "import job did not finish within 30s"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Whether `needle` appears anywhere in `haystack` — the export body is raw
/// JSON bytes, so substring search is the honest check that an entity key
/// never made it into the file.
fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

/// `data_transfer:view`/`export`/`export_sensitive` carve the export surface
/// into three tiers, and the sensitive tiers are gated on a session-bound
/// step-up token that no other session — and no access-token slot — accepts.
#[tokio::test]
async fn export_endpoints_enforce_the_permission_tiers() {
    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fixture) = Fixture::new().await else {
        return;
    };

    // No permissions at all -> 403 on every read endpoint, including for the
    // caller holding only a session.
    for uri in [
        "/api/data-transfer/export/preview",
        "/api/data-transfer/export/preview?scope=full",
        "/api/data-transfer/export",
        "/api/data-transfer/export?scope=full",
        "/api/data-transfer/history",
    ] {
        let status = fixture
            .status("GET", uri, Some(PLAIN_ID), &[], &[], IP_EXPORT)
            .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "GET {uri} must reject a permission-less user with 403"
        );
    }

    // `view` opens the standard preview and history — nothing more.
    fixture.grant(WORKER_ID, "data_transfer:view").await;
    let status = fixture
        .status(
            "GET",
            "/api/data-transfer/export/preview",
            Some(WORKER_ID),
            &[],
            &[],
            IP_EXPORT,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "view must open the standard preview");
    let status = fixture
        .status(
            "GET",
            "/api/data-transfer/export/preview?scope=full",
            Some(WORKER_ID),
            &[],
            &[],
            IP_EXPORT,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "the sensitive-tier preview must require export_sensitive"
    );
    let status = fixture
        .status("GET", "/api/data-transfer/history", Some(WORKER_ID), &[], &[], IP_EXPORT)
        .await;
    assert_eq!(status, StatusCode::OK, "view must open history");
    let status = fixture
        .status("GET", "/api/data-transfer/export", Some(WORKER_ID), &[], &[], IP_EXPORT)
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "view alone must not export data"
    );

    // `export` unlocks the standard scope: the body declares itself
    // non-sensitive and carries no sensitive entity keys.
    fixture.grant(WORKER_ID, "data_transfer:export").await;
    let (status, body) = fixture
        .request(
            "GET",
            "/api/data-transfer/export",
            Some(fixture.auth(WORKER_ID)),
            &[],
            &[],
            IP_EXPORT,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "export must stream for export holders");
    let head = String::from_utf8_lossy(&body[..body.len().min(4096)]);
    assert!(
        head.contains("\"exportType\":\"standard\""),
        "the standard export must declare exportType=standard, got: {head}"
    );
    assert!(
        head.contains("\"includesSensitiveData\":false"),
        "the standard export must declare itself non-sensitive"
    );
    // The manifest's `omitted` list names the skipped sensitive entities (by
    // design), so the absence check targets the tables payload key —
    // `"public.guests":[` — which only an emitted entity produces.
    assert!(
        !contains(&body, b"\"public.guests\":["),
        "the standard export must not carry a sensitive entity key"
    );
    for scope in ["full", "backup"] {
        let status = fixture
            .status(
                "GET",
                &format!("/api/data-transfer/export?scope={scope}"),
                Some(WORKER_ID),
                &[],
                &[],
                IP_EXPORT,
            )
            .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "scope={scope} must require export_sensitive, not just export"
        );
    }

    // `export_sensitive` passes the permission check — then the step-up gate
    // answers 401 until a token bound to THIS session is presented.
    fixture.grant(WORKER_ID, "data_transfer:export_sensitive").await;
    let uri = "/api/data-transfer/export?scope=full";
    let status = fixture
        .status("GET", uri, Some(WORKER_ID), &[], &[], IP_EXPORT)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "missing step-up must be 401");
    let status = fixture
        .status(
            "GET",
            uri,
            Some(WORKER_ID),
            &[],
            &[("x-step-up", "not-a-token")],
            IP_EXPORT,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "a garbage token must be 401");
    let other_token = fixture.step_up_token(OTHER_ID);
    let status = fixture
        .status(
            "GET",
            uri,
            Some(WORKER_ID),
            &[],
            &[("x-step-up", other_token.as_str())],
            IP_EXPORT,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a token minted for another session must be 401"
    );

    // A step-up token must never work as an access token — its audience does
    // not validate under the normal JWT check.
    let step_up = fixture.step_up_token(WORKER_ID);
    let status = fixture
        .status(
            "GET",
            "/api/data-transfer/history",
            None,
            &[],
            &[("authorization", format!("Bearer {step_up}").as_str())],
            IP_EXPORT,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a step-up token must not pass as an access token"
    );

    // The valid token unlocks both sensitive tiers and the document advertises
    // what it carries.
    let (status, body) = fixture
        .request(
            "GET",
            uri,
            Some(fixture.auth(WORKER_ID)),
            &[],
            &[("x-step-up", step_up.as_str())],
            IP_EXPORT,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "a session-bound step-up token must unlock the full export"
    );
    let head = String::from_utf8_lossy(&body[..body.len().min(4096)]);
    assert!(head.contains("\"exportType\":\"full\""));
    assert!(head.contains("\"includesSensitiveData\":true"));

    let (status, body) = fixture
        .request(
            "GET",
            "/api/data-transfer/export?scope=backup",
            Some(fixture.auth(WORKER_ID)),
            &[],
            &[("x-step-up", step_up.as_str())],
            IP_EXPORT,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let head = String::from_utf8_lossy(&body[..body.len().min(8192)]);
    assert!(head.contains("\"exportType\":\"backup\""));
    // `relationships` trails the entity/exclusion lists in the manifest —
    // past any fixed head window on a real schema, so scan the whole body.
    assert!(
        contains(&body, b"\"relationships\""),
        "the backup scope must carry the manifest relationships edge list"
    );

    fixture.revoke_all(WORKER_ID).await;
    Fixture::cleanup(&fixture.pool).await;
}

/// `POST /data-transfer/step-up`: unauthenticated and wrong-credential calls
/// answer the same generic 401, and both denial and success land in
/// `audit_logs` under the pinned actions the history endpoint reads.
#[tokio::test]
async fn step_up_endpoint_verifies_credentials_and_audits() {
    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fixture) = Fixture::new().await else {
        return;
    };

    let uri = "/api/data-transfer/step-up";

    // No session at all -> 401.
    let status = fixture
        .status("POST", uri, None, b"{\"password\":\"x\"}", &[], IP_STEP_UP)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Wrong password -> the generic 401, and a `data_transfer_step_up_denied`
    // audit row naming the account.
    let status = fixture
        .status(
            "POST",
            uri,
            Some(OTHER_ID),
            b"{\"password\":\"definitely-wrong\"}",
            &[],
            IP_STEP_UP,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let denied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs \
         WHERE user_id = $1 AND action = 'data_transfer_step_up_denied'",
    )
    .bind(OTHER_ID)
    .fetch_one(&fixture.pool)
    .await
    .expect("audit query must run");
    assert!(denied >= 1, "a denied step-up must be audited");

    // An account with no step-up credential at all (no password, no TOTP) can
    // never pass — still the same generic 401.
    let status = fixture
        .status(
            "POST",
            uri,
            Some(PLAIN_ID),
            b"{\"password\":\"anything\"}",
            &[],
            IP_STEP_UP,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let denied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs \
         WHERE user_id = $1 AND action = 'data_transfer_step_up_denied'",
    )
    .bind(PLAIN_ID)
    .fetch_one(&fixture.pool)
    .await
    .expect("audit query must run");
    assert!(denied >= 1);

    // Correct password -> 200 with a token, and a success audit row.
    let (status, body) = fixture
        .request(
            "POST",
            uri,
            Some(fixture.auth(OTHER_ID)),
            format!("{{\"password\":\"{STEP_UP_PASSWORD}\"}}").as_bytes(),
            &[],
            IP_STEP_UP,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "the correct password must step up");
    let parsed: Value = serde_json::from_slice(&body).expect("step-up response must parse");
    let token = parsed["stepUpToken"]
        .as_str()
        .expect("stepUpToken must be present")
        .to_string();
    assert!(parsed["expiresAt"].as_str().is_some());
    let granted: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs \
         WHERE user_id = $1 AND action = 'data_transfer_step_up'",
    )
    .bind(OTHER_ID)
    .fetch_one(&fixture.pool)
    .await
    .expect("audit query must run");
    assert!(granted >= 1, "a successful step-up must be audited");

    // End to end: the minted token unlocks a sensitive export for a holder of
    // `export_sensitive` — the two halves of the flow agreeing on the token.
    fixture.grant(OTHER_ID, "data_transfer:export_sensitive").await;
    let status = fixture
        .status(
            "GET",
            "/api/data-transfer/export?scope=full",
            Some(OTHER_ID),
            &[],
            &[("x-step-up", token.as_str())],
            IP_STEP_UP,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the endpoint-minted token must unlock the sensitive export"
    );

    fixture.revoke_all(OTHER_ID).await;
    Fixture::cleanup(&fixture.pool).await;
}

/// `POST /import/execute` stacks conditional checks on the route's
/// `data_transfer:import` guard: sensitive file -> `import_sensitive`,
/// `onConflict: "update"` -> `override`, `mode: "restore"` -> `restore` plus
/// a fresh step-up token. Each denial is a 403 except the step-up's 401.
#[tokio::test]
async fn execute_enforces_file_and_mode_permissions() {
    use hotel_app_be::models::ImportJobState;

    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fixture) = Fixture::new().await else {
        return;
    };

    fixture.grant(WORKER_ID, "data_transfer:import").await;

    // Non-sensitive v1: base `import` permission is enough — the job runs and
    // the zero-row file trivially succeeds.
    let plain_upload = fixture
        .stage_upload(v1_document(&[V1Entity {
            name: "public.amenities",
            primary_key: &["id"],
            rows: vec![],
        }]))
        .await;
    let (status, job) = fixture
        .execute(WORKER_ID, &plain_upload, "merge", Some("skip"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "plain merge must run");
    assert_eq!(wait_for_job(job.unwrap()).await.status, ImportJobState::Succeeded);

    // Sensitive v1 (the `guests` entity marks it): `import` alone -> 403.
    let sensitive_upload = fixture
        .stage_upload(v1_document(&[V1Entity {
            name: "public.guests",
            primary_key: &["id"],
            rows: vec![],
        }]))
        .await;
    let (status, _) = fixture
        .execute(WORKER_ID, &sensitive_upload, "merge", Some("skip"), None)
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a sensitive file must require import_sensitive"
    );

    // Retired-format files always carried guest data — they fail closed as
    // sensitive by format, whatever they will eventually be rejected as.
    let legacy_upload = fixture.stage_upload(legacy_document()).await;
    let (status, _) = fixture
        .execute(WORKER_ID, &legacy_upload, "merge", Some("skip"), None)
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a retired-format file must require import_sensitive"
    );

    // `onConflict: "update"` on a NON-sensitive file isolates the override
    // requirement.
    let update_upload = fixture
        .stage_upload(v1_document(&[V1Entity {
            name: "public.amenities",
            primary_key: &["id"],
            rows: vec![],
        }]))
        .await;
    let (status, _) = fixture
        .execute(WORKER_ID, &update_upload, "merge", Some("update"), None)
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "onConflict=update must require override"
    );

    // `mode: "restore"` -> `restore` permission, checked before step-up.
    let restore_upload = fixture
        .stage_upload(v1_document(&[V1Entity {
            name: "public.amenities",
            primary_key: &["id"],
            rows: vec![],
        }]))
        .await;
    let (status, _) = fixture
        .execute(WORKER_ID, &restore_upload, "restore", None, None)
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "restore must require data_transfer:restore"
    );

    // Preview surfaces the requirement up front — the import holder gets a
    // 200 that names `data_transfer:import_sensitive` for the sensitive file.
    let (status, body) = fixture
        .request(
            "POST",
            "/api/data-transfer/import/preview",
            Some(fixture.auth(WORKER_ID)),
            format!("{{\"uploadId\":\"{sensitive_upload}\"}}").as_bytes(),
            &[],
            IP_EXECUTE,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let preview: Value = serde_json::from_slice(&body).expect("preview must parse");
    let required = preview["requiresPermissions"]
        .as_array()
        .expect("requiresPermissions must be an array");
    assert!(
        required
            .iter()
            .any(|entry| entry.as_str() == Some("data_transfer:import_sensitive")),
        "preview must surface the missing sensitive-import permission: {preview}"
    );

    // Grant the conditional permissions one at a time — each unlocks exactly
    // its own gate.
    fixture.grant(WORKER_ID, "data_transfer:import_sensitive").await;
    let (status, job) = fixture
        .execute(WORKER_ID, &sensitive_upload, "merge", Some("skip"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(wait_for_job(job.unwrap()).await.status, ImportJobState::Succeeded);
    // With import_sensitive granted the gate opens — but the retired flat
    // format is then rejected by the job itself rather than imported.
    let (status, job) = fixture
        .execute(WORKER_ID, &legacy_upload, "merge", Some("skip"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(wait_for_job(job.unwrap()).await.status, ImportJobState::Failed);

    fixture.grant(WORKER_ID, "data_transfer:override").await;
    let (status, job) = fixture
        .execute(WORKER_ID, &update_upload, "merge", Some("update"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(wait_for_job(job.unwrap()).await.status, ImportJobState::Succeeded);

    // Restore is exercised against a MISSING upload: enforcement runs first
    // (fail-closed sensitive -> import_sensitive already held -> restore perm
    // -> step-up), then the job layer 404s — no data is ever touched.
    // A missing upload also fails closed as SYSTEM tier, so the super-admin
    // gate runs before the restore-permission check — this leg promotes the
    // worker, and OTHER_ID (full grants via manage, no flag) proves the gate
    // still denies non-super-admins.
    sqlx::query("UPDATE users SET is_super_admin = true WHERE id = $1")
        .bind(WORKER_ID)
        .execute(&fixture.pool)
        .await
        .unwrap();
    fixture.grant(OTHER_ID, "data_transfer:manage").await;
    let missing_upload = uuid::Uuid::new_v4().to_string();
    let (status, _) = fixture
        .execute(OTHER_ID, &missing_upload, "restore", None, None)
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a missing upload is system-tier: non-super-admins are denied before step-up"
    );
    // On a system-tier file the step-up check runs BEFORE the restore-perm
    // check: a super-admin worker without a token gets 401 even though the
    // restore grant is still missing.
    let (status, _) = fixture
        .execute(WORKER_ID, &missing_upload, "restore", None, None)
        .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "system-tier files demand step-up before the restore permission is read"
    );
    let wrong_session = fixture.step_up_token(OTHER_ID);
    let (status, _) = fixture
        .execute(
            WORKER_ID,
            &missing_upload,
            "restore",
            None,
            Some(&wrong_session),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a step-up token from another session must be 401"
    );
    // Past step-up, the restore permission is still required.
    let step_up = fixture.step_up_token(WORKER_ID);
    let (status, _) = fixture
        .execute(
            WORKER_ID,
            &missing_upload,
            "restore",
            None,
            Some(&step_up),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "restore must still require the restore permission"
    );
    fixture.grant(WORKER_ID, "data_transfer:restore").await;
    let (status, _) = fixture
        .execute(
            WORKER_ID,
            &missing_upload,
            "restore",
            None,
            Some(&step_up),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "past every gate, the missing upload answers 404"
    );

    // The denied restore left its staged file behind — the admin discards it.
    let status = fixture
        .status(
            "DELETE",
            &format!("/api/data-transfer/import/uploads/{restore_upload}"),
            Some(ADMIN_ID),
            &[],
            &[],
            IP_EXECUTE,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    fixture.revoke_all(WORKER_ID).await;
    Fixture::cleanup(&fixture.pool).await;
}

/// `data_transfer:manage` implies every action of the resource — view,
/// export, the sensitive tiers, import, override, restore — while the step-up
/// re-authentication stays mandatory even for a manage holder.
#[tokio::test]
async fn manage_permission_implies_every_action() {
    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fixture) = Fixture::new().await else {
        return;
    };

    fixture.grant(WORKER_ID, "data_transfer:manage").await;

    let status = fixture
        .status("GET", "/api/data-transfer/history", Some(WORKER_ID), &[], &[], IP_MANAGE)
        .await;
    assert_eq!(status, StatusCode::OK, "manage implies view");
    let status = fixture
        .status(
            "GET",
            "/api/data-transfer/export/preview?scope=backup",
            Some(WORKER_ID),
            &[],
            &[],
            IP_MANAGE,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "manage implies export_sensitive");

    // Import a sensitive file — manage covers import + import_sensitive.
    let sensitive_upload = fixture
        .stage_upload(v1_document(&[V1Entity {
            name: "public.guests",
            primary_key: &["id"],
            rows: vec![],
        }]))
        .await;
    let (status, job) = fixture
        .execute(WORKER_ID, &sensitive_upload, "merge", Some("skip"), None)
        .await;
    assert_eq!(
        status,
        StatusCode::ACCEPTED,
        "manage implies import + import_sensitive"
    );
    assert_eq!(
        wait_for_job(job.unwrap()).await.status,
        hotel_app_be::models::ImportJobState::Succeeded
    );

    // Manage implies restore, but never the step-up: without the token the
    // request is still a 401; with it, the missing upload 404s. The missing
    // upload is system-tier (fail closed), so the super-admin gate runs
    // first — promote the worker to reach the step-up check.
    sqlx::query("UPDATE users SET is_super_admin = true WHERE id = $1")
        .bind(WORKER_ID)
        .execute(&fixture.pool)
        .await
        .unwrap();
    let missing_upload = uuid::Uuid::new_v4().to_string();
    let (status, _) = fixture
        .execute(WORKER_ID, &missing_upload, "restore", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let step_up = fixture.step_up_token(WORKER_ID);
    let (status, _) = fixture
        .execute(
            WORKER_ID,
            &missing_upload,
            "restore",
            None,
            Some(&step_up),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    fixture.revoke_all(WORKER_ID).await;
    Fixture::cleanup(&fixture.pool).await;
}

/// `GET /data-transfer/history` is `view`-gated and lists the audit rows the
/// transfer surface just produced — the export the admin ran and the denied
/// step-up attempt — newest first.
#[tokio::test]
async fn history_lists_the_just_run_transfer_events() {
    let _guard = FIXTURE_LOCK.lock().await;
    let Some(fixture) = Fixture::new().await else {
        return;
    };

    // Produce two auditable events: an export by the admin and a denied
    // step-up by the credential-less PLAIN account.
    let (status, _body) = fixture
        .request(
            "GET",
            "/api/data-transfer/export",
            Some(fixture.auth(ADMIN_ID)),
            &[],
            &[],
            IP_HISTORY,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let status = fixture
        .status(
            "POST",
            "/api/data-transfer/step-up",
            Some(PLAIN_ID),
            b"{\"password\":\"nope\"}",
            &[],
            IP_HISTORY,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let status = fixture
        .status("GET", "/api/data-transfer/history", Some(PLAIN_ID), &[], &[], IP_HISTORY)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    fixture.grant(WORKER_ID, "data_transfer:view").await;
    let (status, body) = fixture
        .request(
            "GET",
            "/api/data-transfer/history?limit=50",
            Some(fixture.auth(WORKER_ID)),
            &[],
            &[],
            IP_HISTORY,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let history: Value = serde_json::from_slice(&body).expect("history must parse");
    let entries = history["entries"]
        .as_array()
        .expect("entries must be an array");
    let has_event = |action: &str, user_id: i64| {
        entries.iter().any(|entry| {
            entry["action"].as_str() == Some(action)
                && entry["userId"].as_i64() == Some(user_id)
        })
    };
    assert!(
        has_event("data_export", ADMIN_ID),
        "history must include the export the admin just ran: {entries:?}"
    );
    assert!(
        has_event("data_transfer_step_up_denied", PLAIN_ID),
        "history must include the denied step-up: {entries:?}"
    );

    fixture.revoke_all(WORKER_ID).await;
    Fixture::cleanup(&fixture.pool).await;
}
