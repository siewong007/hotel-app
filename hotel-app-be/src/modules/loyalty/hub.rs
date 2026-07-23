use axum::extract::ws::{Message, WebSocket};
use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
pub struct LoyaltyMemberUpdatedEvent {
    pub event_type: &'static str,
    pub member_id: i64,
    pub guest_id: i64,
}

#[derive(Debug, Clone)]
pub struct LoyaltyHub {
    sender: broadcast::Sender<LoyaltyMemberUpdatedEvent>,
}

impl Default for LoyaltyHub {
    fn default() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { sender }
    }
}

impl LoyaltyHub {
    pub fn publish_member_updated(&self, member_id: i64, guest_id: i64) {
        let _ = self.sender.send(LoyaltyMemberUpdatedEvent {
            event_type: "loyalty_member_updated",
            member_id,
            guest_id,
        });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<LoyaltyMemberUpdatedEvent> {
        self.sender.subscribe()
    }
}

pub async fn serve_guest_socket(mut socket: WebSocket, hub: LoyaltyHub, guest_id: i64) {
    let mut events = hub.subscribe();
    while let Ok(event) = events.recv().await {
        if event.guest_id != guest_id {
            continue;
        }
        let Ok(payload) = serde_json::to_string(&event) else {
            continue;
        };
        if socket.send(Message::Text(payload.into())).await.is_err() {
            break;
        }
    }
}

pub async fn serve_socket(mut socket: WebSocket, hub: LoyaltyHub) {
    let mut events = hub.subscribe();
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Ok(event) => {
                    let Ok(payload) = serde_json::to_string(&event) else { continue; };
                    if socket.send(Message::Text(payload.into())).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!("loyalty websocket lagged; skipped {skipped} events");
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
