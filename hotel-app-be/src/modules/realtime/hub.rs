use axum::extract::ws::{Message, WebSocket};
use serde::Serialize;
use tokio::sync::broadcast;

/// Broadcast when any client's mutation lands so other staff sessions can
/// refresh the affected data domain. Carries only the domain name — clients
/// refetch the data themselves through their own authenticated queries.
#[derive(Debug, Clone, Serialize)]
pub struct DataChangeEvent {
    pub event_type: &'static str,
    pub domain: &'static str,
}

#[derive(Debug, Clone)]
pub struct DataChangeHub {
    sender: broadcast::Sender<DataChangeEvent>,
}

impl Default for DataChangeHub {
    fn default() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { sender }
    }
}

impl DataChangeHub {
    pub fn publish_data_changed(&self, domain: &'static str) {
        let _ = self.sender.send(DataChangeEvent {
            event_type: "data_changed",
            domain,
        });
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
