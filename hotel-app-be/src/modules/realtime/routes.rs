use super::handlers;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use axum::{
    Router,
    extract::{Extension, State},
    http::HeaderMap,
    response::Response,
    routing::get,
};

pub fn routes() -> Router<DbPool> {
    Router::new().route("/updates/socket", get(updates_socket))
}

async fn updates_socket(
    State(pool): State<DbPool>,
    Extension(hub): Extension<crate::modules::realtime::hub::DataChangeHub>,
    headers: HeaderMap,
    websocket: axum::extract::WebSocketUpgrade,
) -> Result<Response, ApiError> {
    handlers::updates_socket_handler(State(pool), Extension(hub), headers, websocket).await
}
