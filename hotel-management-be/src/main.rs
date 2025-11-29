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
    cors::{CorsLayer, Any},
    trace::TraceLayer,
};
use std::io::Write;

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
) -> Result<Json<Vec<Room>>, ApiError> {
    require_permission_helper(&state.pool, &headers, "rooms:read").await?;
    get_rooms_handler(State(state.pool)).await
}

async fn search_rooms_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: axum::extract::Query<crate::models::SearchQuery>,
) -> Result<Json<Vec<Room>>, ApiError> {
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

async fn guests_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Guest>>, ApiError> {
    require_permission_helper(&state.pool, &headers, "guests:read").await?;
    get_guests_handler(State(state.pool)).await
}

async fn create_guest_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::extract::Json<crate::models::GuestInput>,
) -> Result<Json<Guest>, ApiError> {
    require_permission_helper(&state.pool, &headers, "guests:write").await?;
    create_guest_handler(State(state.pool), body).await
}

async fn bookings_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    require_permission_helper(&state.pool, &headers, "bookings:read").await?;
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

async fn rbac_get_user_handler_wrapper(
    State(state): State<AppState>,
    headers: HeaderMap,
    path: axum::extract::Path<i64>,
) -> Result<Json<crate::models::UserWithRolesAndPermissions>, ApiError> {
    require_admin_helper(&state.pool, &headers).await?;
    get_user_roles_permissions_handler(State(state.pool), path).await
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
    
    // CORS configuration
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods(Any);
    
    // Build application routes
    let app = Router::new()
        // Public routes
        .route("/health", get(health_handler))
        .route("/ws/status", get(websocket_status_handler))
        .route("/auth/login", post({
            let state = app_state.clone();
            move |body: axum::extract::Json<crate::models::LoginRequest>| async move {
                login_handler(State(state.pool), body).await
            }
        }))
        
        // Room routes
        .route("/rooms", get(rooms_handler_wrapper))
        .route("/rooms/available", get(search_rooms_handler_wrapper))
        .route("/rooms/:id", axum::routing::patch(update_room_handler_wrapper))
        
        // Guest routes
        .route("/guests", get(guests_handler_wrapper))
        .route("/guests", post(create_guest_handler_wrapper))
        
        // Booking routes
        .route("/bookings", get(bookings_handler_wrapper))
        .route("/bookings", post(create_booking_handler_wrapper))
        
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
        .route("/rbac/users/:user_id", get(rbac_get_user_handler_wrapper))
        
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
