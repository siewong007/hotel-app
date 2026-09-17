use std::borrow::Cow;
use std::sync::OnceLock;

use axum::extract::ws::{Message, WebSocket};
use serde::Serialize;
use tokio::sync::broadcast;

use crate::core::db::DbPool;

/// Broadcast when any client's mutation lands so other staff sessions can
/// refresh the affected data domain. Carries only the domain name — clients
/// refetch the data themselves through their own authenticated queries.
#[derive(Debug, Clone, Serialize)]
pub struct DataChangeEvent {
    pub event_type: &'static str,
    pub domain: Cow<'static, str>,
}

/// One sender per process, registered by the first hub built. The cache-bus
/// listener uses it to rebroadcast remote `hotel_data_changed`
/// notifications into this replica's connected sockets.
static FANOUT: OnceLock<broadcast::Sender<DataChangeEvent>> = OnceLock::new();

/// The broadcast sender remote events are rebroadcast through, once a hub
/// exists. `None` before router construction (e.g. listener tests).
pub fn fanout_sender() -> Option<broadcast::Sender<DataChangeEvent>> {
    FANOUT.get().cloned()
}

#[derive(Debug, Clone)]
pub struct DataChangeHub {
    sender: broadcast::Sender<DataChangeEvent>,
    /// `None` in tests (`Default`); `Some` in production so publishes also
    /// NOTIFY the other replicas.
    pool: Option<DbPool>,
}

impl Default for DataChangeHub {
    fn default() -> Self {
        let (sender, _) = broadcast::channel(256);
        let _ = FANOUT.set(sender.clone());
        Self { sender, pool: None }
    }
}

impl DataChangeHub {
    pub fn new(pool: DbPool) -> Self {
        let hub = Self::default();
        Self {
            sender: hub.sender,
            pool: Some(pool),
        }
    }

    /// A hub over the registered fan-out sender, for publishers outside the
    /// router (e.g. a data-transfer restore) that must reach this replica's
    /// connected sockets as well as remote ones. `None` before router
    /// construction — `new()` would publish into a channel nobody listens to.
    pub fn for_fanout(pool: DbPool) -> Option<Self> {
        Some(Self {
            sender: fanout_sender()?,
            pool: Some(pool),
        })
    }

    /// Notify this replica's sockets and — when a pool is attached — every
    /// other replica via `hotel_data_changed`, stamped with this instance's
    /// id so the echo is dropped on arrival.
    pub fn publish_data_changed(&self, domain: &'static str) {
        let _ = self.sender.send(DataChangeEvent {
            event_type: "data_changed",
            domain: Cow::Borrowed(domain),
        });
        if let Some(pool) = &self.pool {
            let pool = pool.clone();
            let payload = format!("{}:{domain}", crate::core::cache_bus::instance_id());
            tokio::spawn(async move {
                let _ = sqlx::query("SELECT pg_notify($1, $2)")
                    .bind(crate::core::cache_bus::DATA_CHANNEL)
                    .bind(payload)
                    .execute(&pool)
                    .await
                    .inspect_err(|e| log::warn!("data-change notify failed: {e}"));
            });
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DataChangeEvent> {
        self.sender.subscribe()
    }
}

pub async fn serve_socket(mut socket: WebSocket, hub: DataChangeHub) {
    let mut events = hub.subscribe();
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Ok(event) => {
                    let Ok(payload) = serde_json::to_string(&event) else { continue; };
                    if socket.send(Message::Text(payload.into())).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!("updates websocket lagged; skipped {skipped} events");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            message = socket.recv() => match message {
                Some(Ok(Message::Ping(payload))) if socket.send(Message::Pong(payload.clone())).await.is_err() => break,
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            }
        }
    }
}
