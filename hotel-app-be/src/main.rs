mod auth;
mod db;
mod handlers;
mod middleware;
mod models;

use handlers::{get_occupancy_report_handler, get_booking_analytics_handler, get_benchmark_report_handler, get_personalized_report_handler};

use db::create_pool;
use handlers::*;
use middleware::*;
use crate::models::{Room, Guest, Booking, BookingWithDetails};
use axum::{
    extract::State,
    http::HeaderMap,
    response::Json,
    routing::{get, post, delete},
    Router,
};
use tower::ServiceBuilder;
use tower_http::{
    cors::CorsLayer,
    trace::TraceLayer,
};
use std::io::Write;
use axum::http::{Method, header};

fn setup_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("PANIC: {:?}", panic_info);
        println!("PANIC: {:?}", panic_info);
    }));
}

// App state
#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}

// Health check handler
async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

// Handler wrappers with permission checks
async fn rooms_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::RoomWithRating>>, ApiError> {
    require_permission_helper(&state.pool, &headers, "rooms:read").await?;
    get_rooms_handler(State(state.pool)).await
}

async fn search_rooms_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: axum::extract::Query<crate::models::SearchQuery>,
) -> Result<Json<Vec<crate::models::RoomWithRating>>, ApiError> {
    require_permission_helper(&state.pool, &headers, "rooms:read").await?;
    search_rooms_handler(State(state.pool), query).await
}

async fn update_room_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
    body: axum::extract::Json<crate::models::RoomUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    require_permission_helper(&state.pool, &headers, "rooms:write").await?;
    update_room_handler(State(state.pool), path, body).await
}

async fn get_room_reviews_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<String>,
) -> Result<Json<Vec<crate::models::GuestReview>>, ApiError> {
    require_permission_helper(&state.pool, &headers, "rooms:read").await?;
    get_room_reviews_handler(State(state.pool), path).await
}

async fn guests_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Guest>>, ApiError> {
    // Allow all authenticated users to access guests (filtering happens in handler)
    get_guests_handler(State(state.pool), headers).await
}

async fn create_guest_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::GuestInput>,
) -> Result<Json<Guest>, ApiError> {
    // Allow all authenticated users to create guests (they will be auto-linked)
    create_guest_handler(State(state.pool), headers, body).await
}

async fn my_guests_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Guest>>, ApiError> {
    get_my_guests_handler(State(state.pool), headers).await
}

async fn link_guest_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::LinkGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    link_guest_handler(State(state.pool), headers, body).await
}

async fn unlink_guest_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    unlink_guest_handler(State(state.pool), headers, path).await
}

async fn upgrade_guest_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::UpgradeGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    upgrade_guest_to_user_handler(State(state.pool), headers, body).await
}

async fn bookings_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_bookings_handler(State(state.pool)).await
}

async fn create_booking_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::BookingInput>,
) -> Result<Json<Booking>, ApiError> {
    let user_id = require_permission_helper(&state.pool, &headers, "bookings:write").await?;
    create_booking_handler(State(state.pool), axum::extract::Extension(user_id), body).await
}

async fn my_bookings_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    // Only requires authentication, not specific permissions
    get_my_bookings_handler(State(state.pool), headers).await
}

// RBAC handler wrappers
async fn rbac_roles_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::Role>>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_roles_handler(State(state.pool)).await
}

async fn rbac_create_role_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::RoleInput>,
) -> Result<Json<crate::models::Role>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    create_role_handler(State(state.pool), body).await
}

async fn rbac_permissions_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::Permission>>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_permissions_handler(State(state.pool)).await
}

async fn rbac_create_permission_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::PermissionInput>,
) -> Result<Json<crate::models::Permission>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    create_permission_handler(State(state.pool), body).await
}

async fn rbac_assign_role_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::AssignRoleInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    assign_role_to_user_handler(State(state.pool), body).await
}

async fn rbac_remove_role_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    remove_role_from_user_handler(State(state.pool), path).await
}

async fn rbac_assign_permission_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::AssignPermissionInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    assign_permission_to_role_handler(State(state.pool), body).await
}

async fn rbac_remove_permission_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    remove_permission_from_role_handler(State(state.pool), path).await
}

async fn rbac_get_role_permissions_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
) -> Result<Json<crate::models::RoleWithPermissions>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_role_permissions_handler(State(state.pool), path).await
}

async fn rbac_users_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::User>>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_users_handler(State(state.pool)).await
}

async fn rbac_create_user_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::UserCreateInput>,
) -> Result<Json<crate::models::User>, ApiError> {
    let user_id = require_auth(&headers).await?;
    create_user_handler(State(state.pool), axum::extract::Extension(user_id), body).await
}

async fn rbac_get_user_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
) -> Result<Json<crate::models::UserWithRolesAndPermissions>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_user_roles_permissions_handler(State(state.pool), path).await
}

// Loyalty routes wrappers
async fn loyalty_programs_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::LoyaltyProgram>>, ApiError> {
    require_permission_helper(&state.pool, &headers, "analytics:read").await?;
    get_loyalty_programs_handler(State(state.pool)).await
}

async fn loyalty_memberships_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::LoyaltyMembershipWithDetails>>, ApiError> {
    require_permission_helper(&state.pool, &headers, "analytics:read").await?;
    get_loyalty_memberships_handler(State(state.pool)).await
}

async fn loyalty_statistics_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<crate::models::LoyaltyStatistics>, ApiError> {
    require_permission_helper(&state.pool, &headers, "analytics:read").await?;
    get_loyalty_statistics_handler(State(state.pool)).await
}

async fn add_points_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
    body: axum::extract::Json<crate::models::AddPointsInput>,
) -> Result<Json<crate::models::PointsTransaction>, ApiError> {
    require_permission_helper(&state.pool, &headers, "analytics:write").await?;
    add_points_handler(State(state.pool), path, body).await
}

async fn redeem_points_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
    body: axum::extract::Json<crate::models::AddPointsInput>,
) -> Result<Json<crate::models::PointsTransaction>, ApiError> {
    require_permission_helper(&state.pool, &headers, "analytics:write").await?;
    redeem_points_handler(State(state.pool), path, body).await
}

// User profile route wrappers
// User loyalty route wrappers
async fn get_user_loyalty_membership_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<crate::models::UserLoyaltyMembership>, ApiError> {
    let user_id = require_auth(&headers).await?;
    get_user_loyalty_membership_handler(State(state.pool), axum::extract::Extension(user_id)).await
}

async fn get_loyalty_rewards_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::LoyaltyReward>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    get_loyalty_rewards_handler(State(state.pool), axum::extract::Extension(user_id)).await
}

async fn redeem_reward_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::RedeemRewardInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    redeem_reward_handler(State(state.pool), axum::extract::Extension(user_id), body).await
}

// Admin reward CRUD route wrappers
async fn get_all_rewards_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<crate::models::LoyaltyReward>>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_rewards_handler(State(state.pool), query).await
}

async fn get_single_reward_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
) -> Result<Json<crate::models::LoyaltyReward>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_reward_handler(State(state.pool), path).await
}

async fn create_reward_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::RewardInput>,
) -> Result<Json<crate::models::LoyaltyReward>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    create_reward_handler(State(state.pool), body).await
}

async fn update_reward_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
    body: axum::extract::Json<crate::models::RewardUpdateInput>,
) -> Result<Json<crate::models::LoyaltyReward>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    update_reward_handler(State(state.pool), path, body).await
}

async fn delete_reward_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    delete_reward_handler(State(state.pool), path).await
}

async fn get_redemptions_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::RewardRedemptionWithDetails>>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_reward_redemptions_handler(State(state.pool)).await
}

async fn redeem_reward_by_id_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
    body: axum::extract::Json<crate::models::RedeemRewardInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    redeem_reward_for_user_handler(State(state.pool), axum::extract::Extension(user_id), path, body).await
}

async fn get_profile_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<crate::models::UserProfile>, ApiError> {
    let user_id = require_auth(&headers).await?;
    get_user_profile_handler(State(state.pool), axum::extract::Extension(user_id)).await
}

async fn update_profile_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::UserProfileUpdate>,
) -> Result<Json<crate::models::UserProfile>, ApiError> {
    let user_id = require_auth(&headers).await?;
    update_user_profile_handler(State(state.pool), axum::extract::Extension(user_id), body).await
}

async fn update_password_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::PasswordUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    update_password_handler(State(state.pool), axum::extract::Extension(user_id), body).await
}

// Passkey management route wrappers
async fn list_passkeys_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::PasskeyInfo>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    list_passkeys_handler(State(state.pool), axum::extract::Extension(user_id)).await
}

async fn delete_passkey_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    delete_passkey_handler(State(state.pool), axum::extract::Extension(user_id), path).await
}

async fn update_passkey_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<uuid::Uuid>,
    body: axum::extract::Json<crate::models::PasskeyUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    update_passkey_handler(State(state.pool), axum::extract::Extension(user_id), path, body).await
}

#[tokio::main]
async fn main() {
    setup_panic_hook();
    
    // Print immediately to stdout and stderr
    println!("=== Hotel Management Backend Starting ===");
    eprintln!("=== Hotel Management Backend Starting ===");
    std::io::stdout().flush().ok();
    std::io::stderr().flush().ok();
    
    // Initialize logging
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    
    println!("Logging initialized");
    log::info!("Starting Hotel Management API server...");
    
    // Initialize database pool
    let pool = match create_pool().await {
        Ok(pool) => {
            log::info!("✓ Database connection established");
            pool
        },
        Err(e) => {
            log::error!("✗ Failed to create database pool: {}", e);
            let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "not set".to_string());
            log::error!("DATABASE_URL: {}", db_url);
            eprintln!("FATAL: Database connection failed: {}", e);
            std::process::exit(1);
        }
    };
    
    // Create app state
    let app_state = AppState { pool };

    // Get allowed origins from environment variable, default to localhost for development
    let allowed_origins = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000,http://localhost:5173".to_string());

    let origins: Vec<_> = allowed_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    log::info!("CORS allowed origins: {:?}", origins);

    // CORS configuration - restrict to specific origins
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_credentials(true);
    
    // Build application routes
    let app = Router::new()
        // Public routes
        .route("/health", get(health_handler))
        .route("/ws/status", get(websocket_status_handler))

        // Auth routes
        // TODO: Add rate limiting to prevent brute force attacks
        .route("/auth/login", post({
            let state = app_state.clone();
            move |body: axum::extract::Json<crate::models::LoginRequest>| async move {
                login_handler(State(state.pool), body).await
            }
        }))
        .route("/auth/refresh", post({
            let state = app_state.clone();
            move |body: axum::extract::Json<crate::models::RefreshTokenRequest>| async move {
                refresh_token_handler(State(state.pool), body).await
            }
        }))
        .route("/auth/logout", post({
            let state = app_state.clone();
            move |body: axum::extract::Json<crate::models::RefreshTokenRequest>| async move {
                logout_handler(State(state.pool), body).await
            }
        }))

        // Passkey authentication routes
        .route("/auth/passkey/register/start", post({
            let state = app_state.clone();
            move |body: axum::extract::Json<crate::models::PasskeyRegistrationStart>| async move {
                passkey_register_start_handler(State(state.pool), body).await
            }
        }))
        .route("/auth/passkey/register/finish", post({
            let state = app_state.clone();
            move |body: axum::extract::Json<crate::models::PasskeyRegistrationFinish>| async move {
                passkey_register_finish_handler(State(state.pool), body).await
            }
        }))
        .route("/auth/passkey/login/start", post({
            let state = app_state.clone();
            move |body: axum::extract::Json<crate::models::PasskeyLoginStart>| async move {
                passkey_login_start_handler(State(state.pool), body).await
            }
        }))
        .route("/auth/passkey/login/finish", post({
            let state = app_state.clone();
            move |body: axum::extract::Json<crate::models::PasskeyLoginFinish>| async move {
                passkey_login_finish_handler(State(state.pool), body).await
            }
        }))
        
        // Room routes
        .route("/rooms", get(rooms_handler_wrapper))
        .route("/rooms/available", get(search_rooms_handler_wrapper))
        .route("/rooms/:id", axum::routing::patch(update_room_handler_wrapper))
        .route("/rooms/:room_type/reviews", get(get_room_reviews_handler_wrapper))

        // Guest routes
        .route("/guests", get(guests_handler_wrapper))
        .route("/guests", post(create_guest_handler_wrapper))
        .route("/guests/my-guests", get(my_guests_handler_wrapper))
        .route("/guests/link", post(link_guest_handler_wrapper))
        .route("/guests/unlink/:guest_id", axum::routing::delete(unlink_guest_handler_wrapper))
        .route("/guests/upgrade", post(upgrade_guest_handler_wrapper))

        // Booking routes
        .route("/bookings", get(bookings_handler_wrapper))
        .route("/bookings", post(create_booking_handler_wrapper))
        .route("/bookings/my-bookings", get(my_bookings_handler_wrapper))

        // Analytics routes (MCP-compatible endpoints)
        .route("/analytics/occupancy", get({
            let state = app_state.clone();
            move |headers: HeaderMap| async move {
                get_occupancy_report_handler(State(state.pool), headers).await
            }
        }))
        .route("/analytics/bookings", get({
            let state = app_state.clone();
            move |headers: HeaderMap| async move {
                get_booking_analytics_handler(State(state.pool), headers).await
            }
        }))
        .route("/analytics/benchmark", get({
            let state = app_state.clone();
            move |headers: HeaderMap| async move {
                get_benchmark_report_handler(State(state.pool), headers).await
            }
        }))
        .route("/analytics/personalized", get({
            let state = app_state.clone();
            move |headers: HeaderMap, query: axum::extract::Query<std::collections::HashMap<String, String>>| async move {
                get_personalized_report_handler(State(state.pool), headers, query).await
            }
        }))
        
        // RBAC routes (admin only)
        .route("/rbac/roles", get(rbac_roles_handler_wrapper))
        .route("/rbac/roles", post(rbac_create_role_handler_wrapper))
        .route("/rbac/permissions", get(rbac_permissions_handler_wrapper))
        .route("/rbac/permissions", post(rbac_create_permission_handler_wrapper))
        .route("/rbac/users/roles", post(rbac_assign_role_handler_wrapper))
        .route("/rbac/users/:user_id/roles/:role_id", delete(rbac_remove_role_handler_wrapper))
        .route("/rbac/roles/permissions", post(rbac_assign_permission_handler_wrapper))
        .route("/rbac/roles/:role_id/permissions/:permission_id", delete(rbac_remove_permission_handler_wrapper))
        .route("/rbac/roles/:role_id/permissions", get(rbac_get_role_permissions_handler_wrapper))
        .route("/rbac/users", get(rbac_users_handler_wrapper))
        .route("/rbac/users", post(rbac_create_user_handler_wrapper))
        .route("/rbac/users/:user_id", get(rbac_get_user_handler_wrapper))

        // Loyalty program routes (admin)
        .route("/loyalty/programs", get(loyalty_programs_handler_wrapper))
        .route("/loyalty/memberships", get(loyalty_memberships_handler_wrapper))
        .route("/loyalty/statistics", get(loyalty_statistics_handler_wrapper))
        .route("/loyalty/memberships/:id/points/add", post(add_points_handler_wrapper))
        .route("/loyalty/memberships/:id/points/redeem", post(redeem_points_handler_wrapper))

        // Admin reward CRUD routes
        .route("/api/rewards", get(get_all_rewards_handler_wrapper))
        .route("/api/rewards/:id", get(get_single_reward_handler_wrapper))
        .route("/api/rewards", post(create_reward_handler_wrapper))
        .route("/api/rewards/:id", axum::routing::put(update_reward_handler_wrapper))
        .route("/api/rewards/:id", delete(delete_reward_handler_wrapper))
        .route("/api/rewards/redemptions", get(get_redemptions_handler_wrapper))
        .route("/api/rewards/:id/redeem", post(redeem_reward_by_id_handler_wrapper))

        // User loyalty routes (user-facing)
        .route("/loyalty/my-membership", get(get_user_loyalty_membership_handler_wrapper))
        .route("/loyalty/rewards", get(get_loyalty_rewards_handler_wrapper))
        .route("/loyalty/rewards/redeem", post(redeem_reward_handler_wrapper))

        // User profile routes
        .route("/profile", get(get_profile_handler_wrapper))
        .route("/profile", axum::routing::patch(update_profile_handler_wrapper))
        .route("/profile/password", post(update_password_handler_wrapper))

        // Passkey management routes
        .route("/profile/passkeys", get(list_passkeys_handler_wrapper))
        .route("/profile/passkeys/:id", delete(delete_passkey_handler_wrapper))
        .route("/profile/passkeys/:id", axum::routing::patch(update_passkey_handler_wrapper))

        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(cors)
        )
        .with_state(app_state);
    
    log::info!("Hotel Management API server starting on http://0.0.0.0:3030");
    println!("Hotel Management API server starting on http://0.0.0.0:3030");
    eprintln!("Hotel Management API server starting on http://0.0.0.0:3030");
    
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3030").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
