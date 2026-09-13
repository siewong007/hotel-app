use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::realtime::hub::{DataChangeHub, serve_socket};
use axum::{
    extract::{Extension, State, WebSocketUpgrade},
    http::{HeaderMap, HeaderValue},
    response::Response,
};

/// Staff data-change feed. WebSocket upgrades carry no `Authorization` header,
/// so the token arrives via `Sec-WebSocket-Protocol` (`["hotel-updates",
/// <access-token>`]) — the same pattern as the loyalty socket. Any
/// authenticated staff session may subscribe: events carry only a domain
/// name, and every data refetch still goes through the client's own
/// permission-checked queries.
pub async fn updates_socket_handler(
    State(pool): State<DbPool>,
    Extension(hub): Extension<DataChangeHub>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let token = headers
        .get(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find(|part| *part != "hotel-updates" && !part.is_empty())
        })
        .ok_or_else(|| ApiError::Unauthorized("Missing access token".to_string()))?;
    let mut auth_headers = HeaderMap::new();
    let value = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| ApiError::Unauthorized("Invalid access token".to_string()))?;
    auth_headers.insert(axum::http::header::AUTHORIZATION, value);
    // Same replay as the loyalty socket: the global `enforce_active_session`
    // middleware only inspects Authorization headers, which this request
    // lacks — so validate the session-bound claim explicitly or a revoked
    // session keeps this feed for the token's full lifetime.
    let claims = crate::core::middleware::extract_claims(&auth_headers).await?;
    let actor_user_id = crate::core::middleware::extract_user_id(&claims)?;
    let Some(session_id) = claims.sid else {
        return Err(ApiError::Unauthorized(
            "Session-bound authentication is required".to_string(),
        ));
    };
    match crate::core::auth::AuthService::is_session_active(&pool, actor_user_id, &session_id).await
    {
        Ok(true) => {}
        Ok(false) => {
            return Err(ApiError::Unauthorized(
                "Session has been logged out".to_string(),
            ));
        }
        Err(error) => {
            return Err(ApiError::Database(format!(
                "Session validation failed: {error}"
            )));
        }
    }
    Ok(websocket
        .protocols(["hotel-updates"])
        .on_upgrade(move |socket| serve_socket(socket, hub)))
}
