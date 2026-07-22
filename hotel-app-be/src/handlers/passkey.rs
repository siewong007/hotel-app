//! Passkey/WebAuthn handlers.
//!
//! Handles passkey registration and authentication.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::handlers::auth::build_refresh_cookie;
use crate::models::*;
use crate::services::passkey as svc;
use axum::{
    extract::{Extension, Path, State},
    response::Json,
};
use axum_extra::extract::cookie::CookieJar;

pub async fn list_passkeys_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<PasskeyInfo>>, ApiError> {
    Ok(Json(svc::list_passkeys(&pool, user_id).await?))
}

pub async fn delete_passkey_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(passkey_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::delete_passkey(&pool, user_id, passkey_id).await?;

    Ok(Json(
        serde_json::json!({"message": "Passkey deleted successfully"}),
    ))
}

pub async fn update_passkey_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(passkey_id): Path<uuid::Uuid>,
    Json(input): Json<PasskeyUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::update_passkey(&pool, user_id, passkey_id, input).await?;

    Ok(Json(
        serde_json::json!({"message": "Passkey updated successfully"}),
    ))
}

pub async fn passkey_register_start_handler(
    State(pool): State<DbPool>,
    Extension(authenticated_user_id): Extension<i64>,
    Json(req): Json<PasskeyRegistrationStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        svc::register_start(&pool, authenticated_user_id, req).await?,
    ))
}

pub async fn passkey_register_finish_handler(
    State(pool): State<DbPool>,
    Extension(authenticated_user_id): Extension<i64>,
    Json(req): Json<PasskeyRegistrationFinish>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::register_finish(&pool, authenticated_user_id, req).await?;

    Ok(Json(
        serde_json::json!({"message": "Passkey registered successfully"}),
    ))
}

pub async fn passkey_login_start_handler(
    State(pool): State<DbPool>,
    Json(req): Json<PasskeyLoginStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::login_start(&pool, req).await?))
}

pub async fn passkey_login_finish_handler(
    State(pool): State<DbPool>,
    jar: CookieJar,
    Json(req): Json<PasskeyLoginFinish>,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<(CookieJar, Json<AuthResponse>), ApiError> {
    let (response, refresh_token) =
        svc::login_finish(&pool, req, ip_address.as_deref(), user_agent.as_deref()).await?;
    let jar = jar.add(build_refresh_cookie(refresh_token));
    Ok((jar, Json(response)))
}
